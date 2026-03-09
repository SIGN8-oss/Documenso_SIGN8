import { PDFDocument } from '@cantoo/pdf-lib';
import { FieldType, Prisma } from '@prisma/client';
import crypto from 'node:crypto';
import { redirect } from 'react-router';

import { insertFieldsIntoPdf } from '@documenso/lib/server-only/pdf/insert-fields-into-pdf';
import { renderAndAddFieldsIncremental } from '@documenso/lib/server-only/pdf/render-fields-incremental';
import { renderFieldsToImage } from '@documenso/lib/server-only/pdf/render-fields-to-image';
import { getSign8AuthorizationUrl } from '@documenso/lib/server-only/sign8/sign8-oauth';
import { getFileServerSide } from '@documenso/lib/universal/upload/get-file.server';
import { prisma } from '@documenso/prisma';
import type { FieldWithSignature } from '@documenso/prisma/types/field-with-signature';
import { addSigningPlaceholderIncremental } from '@documenso/signing/helpers/add-signing-placeholder-incremental';
import { updateSigningPlaceholder } from '@documenso/signing/helpers/update-signing-placeholder';

import type { Route } from './+types/sign8.authorize';

/**
 * API endpoint to initiate Sign8 OAuth flow for QES signing
 *
 * POST Body (form data):
 * - token: The recipient token
 * - returnUrl: URL to redirect to after signing
 * - fullName: Optional full name for visual signature
 * - signature: Optional signature (base64 image or text)
 *
 * Flow (CAdES detached - documentDigests approach):
 * 1. Get the original PDF
 * 2. Render existing fields from other recipients + current recipient's visual signature
 * 3. Add signing placeholder to PDF (empty signature container)
 * 4. Update placeholder to calculate ByteRange offsets
 * 5. Extract ByteRange content (excluding placeholder) and compute SHA-256 hash
 * 6. Store prepared PDF, hash, and ByteRange in database
 * 7. Redirect to Sign8 OAuth with the hash
 * 8. After callback, call signDoc with documentDigests (not full document)
 * 9. Sign8 returns CMS/PKCS#7 signature (SignatureObject)
 * 10. Embed CMS signature into prepared PDF at placeholder position
 */
export const action = async ({ request }: Route.ActionArgs) => {
  const formData = await request.formData();
  const token = formData.get('token') as string | null;
  const returnUrl = formData.get('returnUrl') as string | null;
  const fullName = formData.get('fullName') as string | null;
  const signatureParam = formData.get('signature') as string | null;

  if (!token) {
    return Response.json({ error: 'Missing recipient token' }, { status: 400 });
  }

  if (!returnUrl) {
    return Response.json({ error: 'Missing return URL' }, { status: 400 });
  }

  // Get the recipient with envelope, document data, and fields
  const recipient = await prisma.recipient.findFirst({
    where: { token },
    select: {
      id: true,
      name: true,
      signatureLevel: true,
      signingStatus: true,
      fields: {
        include: {
          signature: true,
        },
      },
      envelope: {
        select: {
          id: true,
          recipients: {
            select: {
              id: true,
              name: true,
              role: true,
              signatureLevel: true,
              signingStatus: true,
            },
          },
          envelopeItems: {
            select: {
              id: true,
              documentData: true,
            },
            orderBy: {
              order: 'asc',
            },
            take: 1,
          },
        },
      },
    },
  });

  if (!recipient) {
    return Response.json({ error: 'Recipient not found' }, { status: 404 });
  }

  if (recipient.signatureLevel !== 'QES' && recipient.signatureLevel !== 'AES') {
    return Response.json(
      { error: 'This recipient is not configured for QES or AES signing' },
      { status: 400 },
    );
  }

  if (recipient.signingStatus === 'SIGNED') {
    return Response.json({ error: 'Document already signed' }, { status: 400 });
  }

  const firstEnvelopeItem = recipient.envelope?.envelopeItems[0];
  if (!firstEnvelopeItem?.documentData) {
    return Response.json({ error: 'Document data not found' }, { status: 404 });
  }

  // Check if another Sign8 signer has already completed — if so, chain on their signed PDF
  const otherSign8Recipients = (recipient.envelope?.recipients ?? []).filter(
    (r) =>
      r.id !== recipient.id &&
      (r.signatureLevel === 'QES' || r.signatureLevel === 'AES') &&
      r.signingStatus === 'SIGNED',
  );

  let chainBasePdf: Buffer | null = null;
  if (otherSign8Recipients.length > 0) {
    const existingPending = await prisma.sign8QESPendingSignature.findFirst({
      where: { recipientId: { in: otherSign8Recipients.map((r) => r.id) } },
      select: { preparedPdfData: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existingPending) {
      chainBasePdf = Buffer.from(existingPending.preparedPdfData, 'base64');
      console.log(
        'Sign8 authorize - Chaining on existing Sign8 signature, base PDF size:',
        chainBasePdf.length,
        'bytes',
      );
    }
  }

  // Block if another Sign8 signer is currently in progress (has active pending signature)
  // This prevents two concurrent Sign8 signers from both building off the original PDF,
  // which would cause the first signer's CMS signature to be silently lost.
  const inProgressSign8Recipients = (recipient.envelope?.recipients ?? []).filter(
    (r) =>
      r.id !== recipient.id &&
      (r.signatureLevel === 'QES' || r.signatureLevel === 'AES') &&
      r.signingStatus !== 'SIGNED',
  );

  if (inProgressSign8Recipients.length > 0 && chainBasePdf === null) {
    const activePending = await prisma.sign8QESPendingSignature.findFirst({
      where: {
        recipientId: { in: inProgressSign8Recipients.map((r) => r.id) },
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    if (activePending) {
      return Response.json(
        {
          error:
            'Another signer is currently completing their signature. Please try again shortly.',
        },
        { status: 409 },
      );
    }
  }

  // Build visual signature fields for current recipient (needed in both paths)
  const isBase64Signature = signatureParam?.startsWith('data:image/');
  const signatureValue = signatureParam || fullName || recipient.name || 'Digital Signature';

  const fieldsToRender: FieldWithSignature[] = recipient.fields
    .filter((field) => field.type === FieldType.SIGNATURE)
    .map((field) => ({
      ...field,
      inserted: true,
      customText: isBase64Signature ? '' : signatureValue,
      signature: {
        id: 0,
        created: new Date(),
        recipientId: recipient.id,
        fieldId: field.id,
        signatureImageAsBase64: isBase64Signature ? signatureParam : null,
        typedSignature: isBase64Signature ? null : signatureValue,
        signatureLevel: recipient.signatureLevel,
        sign8SignatureData: null,
        sign8PendingSignatureId: null,
        sign8CredentialId: null,
      },
    }));

  try {
    let pdfBuffer: Buffer;
    const signatureFieldPositions: Array<{
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];
    const widgetAppearances: Array<{
      imageRgba: Buffer;
      imageWidth: number;
      imageHeight: number;
    }> = [];

    if (chainBasePdf !== null) {
      // === CHAINING PATH ===
      // A prior Sign8 signer's PDF already contains CMS signature(s).
      // We use the widget's /AP appearance stream for the visual signature
      // (not page content modification, which would invalidate the prior CMS).
      pdfBuffer = chainBasePdf;

      // Render fields from non-Sign8 recipients (e.g. SES signers) that signed
      // after the chain base was prepared — their fields are not in the chain base PDF
      const nonSign8SignedRecipientIds = (recipient.envelope?.recipients ?? [])
        .filter(
          (r) =>
            r.id !== recipient.id &&
            r.signatureLevel !== 'QES' &&
            r.signatureLevel !== 'AES' &&
            r.signingStatus === 'SIGNED',
        )
        .map((r) => r.id);

      if (nonSign8SignedRecipientIds.length > 0) {
        const missingFields = await prisma.field.findMany({
          where: {
            envelopeId: recipient.envelope!.id,
            inserted: true,
            recipientId: { in: nonSign8SignedRecipientIds },
          },
          include: { signature: true },
        });

        if (missingFields.length > 0) {
          pdfBuffer = await renderAndAddFieldsIncremental(pdfBuffer, missingFields);
          console.log(
            'Sign8 authorize - Chaining: rendered',
            missingFields.length,
            'fields from non-Sign8 recipients incrementally',
          );
        }
      }

      // Load PDF read-only for page dimensions and field positions
      const pdfDoc = await PDFDocument.load(pdfBuffer);

      const signatureFieldsFromRecipient = recipient.fields.filter(
        (f) => f.type === FieldType.SIGNATURE,
      );

      for (const signatureField of signatureFieldsFromRecipient) {
        const page = pdfDoc.getPage(signatureField.page - 1);
        const { width: pageWidth, height: pageHeight } = page.getSize();

        const fieldPosX = Number(signatureField.positionX);
        const fieldPosY = Number(signatureField.positionY);
        const fieldWidth = Number(signatureField.width);
        const fieldHeight = Number(signatureField.height);

        if (fieldWidth <= 0 || fieldHeight <= 0) {
          continue;
        }

        const x = (fieldPosX / 100) * pageWidth;
        const y = pageHeight - (fieldPosY / 100) * pageHeight - (fieldHeight / 100) * pageHeight;
        const width = (fieldWidth / 100) * pageWidth;
        const height = (fieldHeight / 100) * pageHeight;

        signatureFieldPositions.push({ page: signatureField.page, x, y, width, height });
      }

      // Render ALL signature fields at field dimensions (3x scale) for widget appearances
      for (let i = 0; i < signatureFieldPositions.length && i < fieldsToRender.length; i++) {
        const pos = signatureFieldPositions[i];
        const fieldToRender = fieldsToRender[i];
        const scale = 3;
        const renderW = Math.round(pos.width * scale);
        const renderH = Math.round(pos.height * scale);

        if (renderW > 0 && renderH > 0 && fieldToRender) {
          const imageData = await renderFieldsToImage({
            pageWidth: renderW,
            pageHeight: renderH,
            fields: [
              {
                ...fieldToRender,
                positionX: new Prisma.Decimal(0),
                positionY: new Prisma.Decimal(0),
                width: new Prisma.Decimal(100),
                height: new Prisma.Decimal(100),
              },
            ],
          });

          if (imageData) {
            widgetAppearances.push({
              imageRgba: imageData.rgba,
              imageWidth: imageData.width,
              imageHeight: imageData.height,
            });
          }
        }
      }

      console.log(
        'Sign8 authorize - Chaining: rendered',
        widgetAppearances.length,
        'widget appearances for',
        signatureFieldPositions.length,
        'field positions',
      );
    } else {
      // === FIRST SIGNER PATH (existing flow) ===
      const pdfContent = await getFileServerSide(firstEnvelopeItem.documentData);
      pdfBuffer = Buffer.isBuffer(pdfContent) ? pdfContent : Buffer.from(pdfContent);

      console.log('Sign8 authorize - Original PDF size:', pdfBuffer.length, 'bytes');

      // Render all already-inserted fields from OTHER recipients into the PDF
      const allInsertedFields = await prisma.field.findMany({
        where: {
          envelopeId: recipient.envelope!.id,
          inserted: true,
          recipientId: { not: recipient.id },
        },
        include: { signature: true },
      });

      if (allInsertedFields.length > 0) {
        pdfBuffer = await insertFieldsIntoPdf({ pdf: pdfBuffer, fields: allInsertedFields });
        console.log(
          'Sign8 authorize - PDF with prior fields size:',
          pdfBuffer.length,
          'bytes',
          '(rendered',
          allInsertedFields.length,
          'fields from other recipients)',
        );
      }

      // Render ALL current recipient's fields (including signatures) into page content.
      // This uses insertFieldsIntoPdf which renders via Konva→pdf-lib — reliable pipeline.
      console.log('Sign8 authorize - Fields to render:', fieldsToRender.length);

      if (fieldsToRender.length > 0) {
        pdfBuffer = await insertFieldsIntoPdf({
          pdf: pdfBuffer,
          fields: fieldsToRender,
        });
        console.log('Sign8 authorize - PDF with fields size:', pdfBuffer.length, 'bytes');
      }

      // Compute signature field positions for clickable widgets
      const signatureFieldsFromRecipient = recipient.fields.filter(
        (f) => f.type === FieldType.SIGNATURE,
      );

      if (signatureFieldsFromRecipient.length > 0) {
        const pdfDoc = await PDFDocument.load(pdfBuffer);

        for (const signatureField of signatureFieldsFromRecipient) {
          const page = pdfDoc.getPage(signatureField.page - 1);
          const { width: pageWidth, height: pageHeight } = page.getSize();

          const fieldPosX = Number(signatureField.positionX);
          const fieldPosY = Number(signatureField.positionY);
          const fieldWidth = Number(signatureField.width);
          const fieldHeight = Number(signatureField.height);

          if (fieldWidth <= 0 || fieldHeight <= 0) {
            continue;
          }

          const x = (fieldPosX / 100) * pageWidth;
          const y = pageHeight - (fieldPosY / 100) * pageHeight - (fieldHeight / 100) * pageHeight;
          const width = (fieldWidth / 100) * pageWidth;
          const height = (fieldHeight / 100) * pageHeight;

          signatureFieldPositions.push({ page: signatureField.page, x, y, width, height });
        }

        console.log('Sign8 authorize - Signature field positions:', signatureFieldPositions);
      }
    }

    // Render non-signature fields (DATE, NAME, EMAIL, TEXT) incrementally when chaining.
    // These must be added before the signing placeholder so they're covered by the ByteRange.
    if (chainBasePdf !== null) {
      const nonSigFields: FieldWithSignature[] = recipient.fields
        .filter((f) => f.type !== FieldType.SIGNATURE && f.inserted)
        .map((f) => ({
          ...f,
          signature: null,
        }));

      if (nonSigFields.length > 0) {
        pdfBuffer = await renderAndAddFieldsIncremental(pdfBuffer, nonSigFields);
        console.log(
          'Sign8 authorize - Rendered',
          nonSigFields.length,
          'non-signature fields incrementally',
        );
      }
    }

    // Normalize the base PDF when this is the first Sign8 signer.
    // Many source PDFs (from Word, Chrome print-to-PDF, etc.) use XRef streams and
    // Object Streams (ObjStm) which are PDF 1.5+ optimizations. Our incremental updates
    // use traditional xref tables, and mixing styles causes Adobe Acrobat's signature
    // verifier to reject the signatures ("Expected a dict object").
    // Re-serializing through pdf-lib converts to traditional xref, which is safe here
    // because no prior CMS signatures exist yet in the first signer path.
    if (chainBasePdf === null) {
      const normalizedDoc = await PDFDocument.load(pdfBuffer);
      pdfBuffer = Buffer.from(await normalizedDoc.save({ useObjectStreams: false }));
      console.log('Sign8 authorize - Normalized PDF size:', pdfBuffer.length, 'bytes');
    }

    // CAdES detached flow: Prepare PDF with signature placeholder
    // Always use incremental placeholder (preserves existing CMS signatures and supports appearances)
    const pdfWithPlaceholder = await addSigningPlaceholderIncremental({
      pdf: pdfBuffer,
      signatureFields: signatureFieldPositions.length > 0 ? signatureFieldPositions : undefined,
      appearances: widgetAppearances.length > 0 ? widgetAppearances : undefined,
    });
    console.log('Sign8 authorize - PDF with placeholder size:', pdfWithPlaceholder.length, 'bytes');

    // Update placeholder to calculate ByteRange offsets
    const { pdf: preparedPdf, byteRange } = updateSigningPlaceholder({ pdf: pdfWithPlaceholder });
    console.log('Sign8 authorize - ByteRange:', byteRange);

    // Extract ByteRange content (excluding signature placeholder) and hash it
    const contentToSign = Buffer.concat([
      preparedPdf.subarray(0, byteRange[1]),
      preparedPdf.subarray(byteRange[2]),
    ]);

    // Compute SHA-256 hash of ByteRange content in Standard Base64 format
    const documentHash = crypto.createHash('sha256').update(contentToSign).digest('base64');

    console.log('Sign8 authorize - Content to sign size:', contentToSign.length, 'bytes');
    console.log('Sign8 authorize - Document hash (SHA-256, Standard Base64):', documentHash);

    // Delete any existing pending signature for this recipient
    await prisma.sign8QESPendingSignature.deleteMany({
      where: { recipientId: recipient.id },
    });

    // Store prepared PDF (with placeholder), hash, and ByteRange for callback
    // CAdES detached approach - Sign8 will return CMS signature to embed
    const pendingSignature = await prisma.sign8QESPendingSignature.create({
      data: {
        recipientId: recipient.id,
        preparedPdfData: preparedPdf.toString('base64'), // PDF with signature placeholder
        documentHash, // SHA-256 of ByteRange content (Standard Base64)
        byteRange: JSON.stringify(byteRange), // ByteRange for signature embedding
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes expiry
      },
    });

    const authorizationUrl = getSign8AuthorizationUrl({
      recipientToken: token,
      documentHash,
      returnUrl,
      pendingSignatureId: pendingSignature.id,
      signatureLevel: recipient.signatureLevel as 'QES' | 'AES',
    });

    console.log('Sign8 authorize - Redirecting to:', authorizationUrl);

    return redirect(authorizationUrl);
  } catch (error) {
    console.error('Sign8 authorization error:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
    return Response.json(
      {
        error: 'Failed to initiate Sign8 authentication',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
};
