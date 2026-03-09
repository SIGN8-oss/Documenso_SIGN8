import {
  PDFDocument,
  RotationTypes,
  popGraphicsState,
  pushGraphicsState,
  radiansToDegrees,
  rotateDegrees,
  translate,
} from '@cantoo/pdf-lib';
import type { DocumentData, Envelope, EnvelopeItem, Field } from '@prisma/client';
import {
  DocumentStatus,
  EnvelopeType,
  FieldType,
  RecipientRole,
  SignatureLevel,
  SigningStatus,
  WebhookTriggerEvents,
} from '@prisma/client';
import { nanoid } from 'nanoid';
import path from 'node:path';
import { groupBy } from 'remeda';
import { match } from 'ts-pattern';

import { generateCertificatePdf } from '@documenso/lib/server-only/pdf/generate-certificate-pdf';
import { prisma } from '@documenso/prisma';
import { signPdf, signPdfIncremental } from '@documenso/signing';
import { extractQESSignatures } from '@documenso/signing/helpers/embed-external-signature';

import { NEXT_PRIVATE_USE_PLAYWRIGHT_PDF } from '../../../constants/app';
import { PDF_SIZE_A4_72PPI } from '../../../constants/pdf';
import { AppError, AppErrorCode } from '../../../errors/app-error';
import { sendCompletedEmail } from '../../../server-only/document/send-completed-email';
import { getCertificatePdf } from '../../../server-only/htmltopdf/get-certificate-pdf';
import { addRejectionStampToPdf } from '../../../server-only/pdf/add-rejection-stamp-to-pdf';
import { flattenAnnotations } from '../../../server-only/pdf/flatten-annotations';
import { flattenForm } from '../../../server-only/pdf/flatten-form';
import { getPageSize } from '../../../server-only/pdf/get-page-size';
import { insertFieldInPDFV1 } from '../../../server-only/pdf/insert-field-in-pdf-v1';
import { insertFieldInPDFV2 } from '../../../server-only/pdf/insert-field-in-pdf-v2';
import { legacy_insertFieldInPDF } from '../../../server-only/pdf/legacy-insert-field-in-pdf';
import { normalizeSignatureAppearances } from '../../../server-only/pdf/normalize-signature-appearances';
import { renderAndAddFieldsIncremental } from '../../../server-only/pdf/render-fields-incremental';
import { getTeamSettings } from '../../../server-only/team/get-team-settings';
import { triggerWebhook } from '../../../server-only/webhooks/trigger/trigger-webhook';
import { DOCUMENT_AUDIT_LOG_TYPE } from '../../../types/document-audit-logs';
import {
  ZWebhookDocumentSchema,
  mapEnvelopeToWebhookDocumentPayload,
} from '../../../types/webhook-payload';
import { prefixedId } from '../../../universal/id';
import { getFileServerSide } from '../../../universal/upload/get-file.server';
import { putPdfFileServerSide } from '../../../universal/upload/put-file.server';
import { fieldsContainUnsignedRequiredField } from '../../../utils/advanced-fields-helpers';
import { isDocumentCompleted } from '../../../utils/document';
import { createDocumentAuditLogData } from '../../../utils/document-audit-logs';
import { mapDocumentIdToSecondaryId } from '../../../utils/envelope';
import type { JobRunIO } from '../../client/_internal/job';
import type { TSealDocumentJobDefinition } from './seal-document';

export const run = async ({
  payload,
  io,
}: {
  payload: TSealDocumentJobDefinition;
  io: JobRunIO;
}) => {
  const { documentId, sendEmail = true, isResealing = false, requestMetadata } = payload;

  const { envelopeId, envelopeStatus, isRejected } = await io.runTask('seal-document', async () => {
    const envelope = await prisma.envelope.findFirstOrThrow({
      where: {
        type: EnvelopeType.DOCUMENT,
        secondaryId: mapDocumentIdToSecondaryId(documentId),
      },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
        documentMeta: true,
        recipients: true,
        fields: {
          include: {
            signature: true,
          },
        },
        envelopeItems: {
          include: {
            documentData: true,
            field: {
              include: {
                signature: true,
              },
            },
          },
        },
      },
    });

    if (envelope.envelopeItems.length === 0) {
      throw new Error('At least one envelope item required');
    }

    const settings = await getTeamSettings({
      userId: envelope.userId,
      teamId: envelope.teamId,
    });

    // Ensure all CC recipients are marked as signed
    await prisma.recipient.updateMany({
      where: {
        envelopeId: envelope.id,
        role: RecipientRole.CC,
      },
      data: {
        signingStatus: SigningStatus.SIGNED,
      },
    });

    const isComplete =
      envelope.recipients.some((recipient) => recipient.signingStatus === SigningStatus.REJECTED) ||
      envelope.recipients.every(
        (recipient) =>
          recipient.signingStatus === SigningStatus.SIGNED || recipient.role === RecipientRole.CC,
      );

    if (!isComplete) {
      throw new AppError(AppErrorCode.UNKNOWN_ERROR, {
        message: 'Document is not complete',
      });
    }

    let { envelopeItems } = envelope;

    const fields = envelope.fields;

    if (envelopeItems.length < 1) {
      throw new Error(`Document ${envelope.id} has no envelope items`);
    }

    const recipientsWithoutCCers = envelope.recipients.filter(
      (recipient) => recipient.role !== RecipientRole.CC,
    );

    // Determine if the document has been rejected by checking if any recipient has rejected it
    const rejectedRecipient = recipientsWithoutCCers.find(
      (recipient) => recipient.signingStatus === SigningStatus.REJECTED,
    );

    const isRejected = Boolean(rejectedRecipient);

    // Get the rejection reason from the rejected recipient
    const rejectionReason = rejectedRecipient?.rejectionReason ?? '';

    // Skip the field check if the document is rejected
    if (!isRejected && fieldsContainUnsignedRequiredField(fields)) {
      throw new Error(`Document ${envelope.id} has unsigned required fields`);
    }

    if (isResealing) {
      // If we're resealing we want to use the initial data for the document
      // so we aren't placing fields on top of eachother.
      envelopeItems = envelopeItems.map((envelopeItem) => ({
        ...envelopeItem,
        documentData: {
          ...envelopeItem.documentData,
          data: envelopeItem.documentData.initialData,
        },
      }));
    }

    if (!envelope.qrToken) {
      await prisma.envelope.update({
        where: {
          id: envelope.id,
        },
        data: {
          qrToken: prefixedId('qr'),
        },
      });
    }

    let certificateDoc: PDFDocument | null = null;

    if (settings.includeSigningCertificate) {
      const certificatePayload = {
        envelope,
        recipients: envelope.recipients, // Need to use the recipients from envelope which contains ALL recipients.
        fields,
        language: envelope.documentMeta.language,
        envelopeOwner: {
          email: envelope.user.email,
          name: envelope.user.name || '',
        },
        envelopeItems: envelopeItems.map((item) => item.title),
        pageWidth: PDF_SIZE_A4_72PPI.width,
        pageHeight: PDF_SIZE_A4_72PPI.height,
      };

      // Use Playwright-based PDF generation if enabled, otherwise use Konva-based generation.
      // This is a temporary toggle while we validate the Konva-based approach.
      const usePlaywrightPdf = NEXT_PRIVATE_USE_PLAYWRIGHT_PDF();

      certificateDoc = usePlaywrightPdf
        ? await getCertificatePdf({
            documentId,
            language: envelope.documentMeta.language,
          }).then(async (buffer) => PDFDocument.load(buffer))
        : await generateCertificatePdf(certificatePayload);
    }

    const newDocumentData: Array<{ oldDocumentDataId: string; newDocumentDataId: string }> = [];

    // Query for Sign8 pending signatures that contain signed PDFs (QES or AES)
    const sign8RecipientIds = envelope.recipients
      .filter(
        (r) => r.signatureLevel === SignatureLevel.QES || r.signatureLevel === SignatureLevel.AES,
      )
      .map((r) => r.id);

    const sign8PendingSignatures = await prisma.sign8QESPendingSignature.findMany({
      where: {
        recipientId: {
          in: sign8RecipientIds,
        },
      },
      select: {
        id: true,
        recipientId: true,
        preparedPdfData: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Warn if any Sign8 recipient is missing their pending signature
    const missingPending = sign8RecipientIds.filter(
      (id) => !sign8PendingSignatures.some((sig) => sig.recipientId === id),
    );

    if (missingPending.length > 0) {
      console.error(
        `Sign8 pending signatures missing for recipient IDs: ${missingPending.join(', ')}. ` +
          'CMS signatures for these recipients will be lost.',
      );
    }

    // Get the first Sign8-signed PDF if available (there should only be one per document)
    // Note: this may be updated below if fields need to be rendered incrementally
    let qesSignedPdfData =
      sign8PendingSignatures.length > 0 ? sign8PendingSignatures[0].preparedPdfData : null;

    // Determine if all non-QES/AES recipients signed BEFORE the QES PDF was prepared.
    // sign8.authorize renders only fields that were inserted at that time.
    // If any non-QES recipient signed AFTER QES preparation, their visual fields
    // are NOT in the QES PDF and we must fall back to the normal rendering path.
    const qesPreparedAt =
      sign8PendingSignatures.length > 0 ? sign8PendingSignatures[0].createdAt : null;

    let hasUnrenderedFieldsInQesPdf =
      qesPreparedAt !== null &&
      envelope.recipients.some(
        (r) =>
          r.role !== RecipientRole.CC &&
          !sign8RecipientIds.includes(r.id) &&
          r.signingStatus === SigningStatus.SIGNED &&
          r.signedAt !== null &&
          r.signedAt > qesPreparedAt,
      );

    // If SES recipients signed after QES preparation, render their fields incrementally
    // instead of destroying the QES CMS signature by falling back to PDFDocument.load().
    if (hasUnrenderedFieldsInQesPdf && qesSignedPdfData !== null) {
      const unrenderedRecipientIds = envelope.recipients
        .filter(
          (r) =>
            !sign8RecipientIds.includes(r.id) &&
            r.role !== RecipientRole.CC &&
            r.signingStatus === SigningStatus.SIGNED &&
            r.signedAt !== null &&
            r.signedAt > qesPreparedAt!,
        )
        .map((r) => r.id);

      const unrenderedFields = envelope.fields.filter(
        (f) => f.inserted && unrenderedRecipientIds.includes(f.recipientId),
      );

      if (unrenderedFields.length > 0) {
        console.log(
          'Rendering',
          unrenderedFields.length,
          'fields incrementally for recipients who signed after QES preparation',
        );

        try {
          const qesPdfBuffer = Buffer.from(qesSignedPdfData, 'base64');
          const augmentedPdf = await renderAndAddFieldsIncremental(qesPdfBuffer, unrenderedFields);

          // Update the signed PDF data so decorateAndSignPdf uses the
          // version with all fields visible
          qesSignedPdfData = augmentedPdf.toString('base64');
          hasUnrenderedFieldsInQesPdf = false;
        } catch (error) {
          console.error(
            'Failed to render fields incrementally, falling back to normal path:',
            error,
          );
        }
      } else {
        hasUnrenderedFieldsInQesPdf = false;
      }
    }

    // Skip org SES when ALL non-CC recipients are Sign8 (AES/QES) — their CMS signatures
    // are already legally binding, and an additional org SES would be redundant.
    const allRecipientsAreSign8 = recipientsWithoutCCers.every(
      (r) => r.signatureLevel === SignatureLevel.QES || r.signatureLevel === SignatureLevel.AES,
    );

    for (const envelopeItem of envelopeItems) {
      const envelopeItemFields = envelope.envelopeItems.find(
        (item) => item.id === envelopeItem.id,
      )?.field;

      if (!envelopeItemFields) {
        throw new Error(`Envelope item fields not found for envelope item ${envelopeItem.id}`);
      }

      const result = await decorateAndSignPdf({
        envelope,
        envelopeItem,
        envelopeItemFields,
        isRejected,
        rejectionReason,
        certificateDoc,
        qesSignedPdfData: hasUnrenderedFieldsInQesPdf ? null : qesSignedPdfData,
        qesRecipientIds: sign8RecipientIds,
        skipOrgSes: allRecipientsAreSign8,
      });

      newDocumentData.push(result);
    }

    await prisma.$transaction(async (tx) => {
      for (const { oldDocumentDataId, newDocumentDataId } of newDocumentData) {
        const newData = await tx.documentData.findFirstOrThrow({
          where: {
            id: newDocumentDataId,
          },
        });

        await tx.documentData.update({
          where: {
            id: oldDocumentDataId,
          },
          data: {
            data: newData.data,
          },
        });
      }

      await tx.envelope.update({
        where: {
          id: envelope.id,
        },
        data: {
          status: isRejected ? DocumentStatus.REJECTED : DocumentStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      // Extract Sign8 signatures (QES, AES) for audit logging
      const recipientsWithFields = await tx.recipient.findMany({
        where: {
          envelopeId: envelope.id,
          signatureLevel: {
            in: [SignatureLevel.QES, SignatureLevel.AES],
          },
        },
        include: {
          fields: {
            include: {
              signature: true,
            },
          },
        },
      });

      const qesSignatures = extractQESSignatures(recipientsWithFields);

      await tx.documentAuditLog.create({
        data: createDocumentAuditLogData({
          type: DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_COMPLETED,
          envelopeId: envelope.id,
          requestMetadata,
          user: null,
          data: {
            transactionId: nanoid(),
            ...(isRejected ? { isRejected: true, rejectionReason: rejectionReason } : {}),
            ...(qesSignatures.length > 0
              ? {
                  qesSignatures: qesSignatures.map((sig) => ({
                    recipientName: sig.recipientName,
                    recipientEmail: sig.recipientEmail,
                    signatureLevel: sig.signatureLevel,
                    signedAt: sig.signedAt.toISOString(),
                  })),
                }
              : {}),
          },
        }),
      });

      // Clean up Sign8 pending signatures after successful sealing
      if (sign8PendingSignatures.length > 0) {
        await tx.sign8QESPendingSignature.deleteMany({
          where: {
            id: {
              in: sign8PendingSignatures.map((sig) => sig.id),
            },
          },
        });
      }
    });

    return {
      envelopeId: envelope.id,
      envelopeStatus: envelope.status,
      isRejected,
    };
  });

  await io.runTask('send-completed-email', async () => {
    let shouldSendCompletedEmail = sendEmail && !isResealing && !isRejected;

    if (isResealing && !isDocumentCompleted(envelopeStatus)) {
      shouldSendCompletedEmail = sendEmail;
    }

    if (shouldSendCompletedEmail) {
      await sendCompletedEmail({
        id: { type: 'envelopeId', id: envelopeId },
        requestMetadata,
      });
    }
  });

  const updatedEnvelope = await prisma.envelope.findFirstOrThrow({
    where: {
      id: envelopeId,
    },
    include: {
      documentMeta: true,
      recipients: true,
    },
  });

  await triggerWebhook({
    event: isRejected
      ? WebhookTriggerEvents.DOCUMENT_REJECTED
      : WebhookTriggerEvents.DOCUMENT_COMPLETED,
    data: ZWebhookDocumentSchema.parse(mapEnvelopeToWebhookDocumentPayload(updatedEnvelope)),
    userId: updatedEnvelope.userId,
    teamId: updatedEnvelope.teamId ?? undefined,
  });
};

type DecorateAndSignPdfOptions = {
  envelope: Pick<Envelope, 'id' | 'title' | 'useLegacyFieldInsertion' | 'internalVersion'>;
  envelopeItem: EnvelopeItem & { documentData: DocumentData };
  envelopeItemFields: Field[];
  isRejected: boolean;
  rejectionReason: string;
  certificateDoc: PDFDocument | null;
  qesSignedPdfData: string | null;
  qesRecipientIds: number[];
  skipOrgSes: boolean;
};

/**
 * Fetch, normalize, flatten and insert fields into a PDF document.
 */
const decorateAndSignPdf = async ({
  envelope,
  envelopeItem,
  envelopeItemFields,
  isRejected,
  rejectionReason,
  certificateDoc,
  qesSignedPdfData,
  qesRecipientIds,
  skipOrgSes,
}: DecorateAndSignPdfOptions) => {
  // When a QES/AES-signed PDF exists, use it directly (optionally adding org SES).
  if (qesSignedPdfData !== null && qesRecipientIds.length > 0) {
    const qesPdfBuffer = Buffer.from(qesSignedPdfData, 'base64');

    let finalPdf: Buffer;

    if (skipOrgSes) {
      // All signers used Sign8 (AES/QES) — no org SES needed
      console.log('All recipients are Sign8 - using signed PDF without org SES');
      finalPdf = qesPdfBuffer;
    } else {
      // Mixed signers — add org SES incrementally to certify non-Sign8 fields
      console.log('QES-signed PDF found - adding org SES signature incrementally');

      // Collect signature field positions for non-Sign8 (SES) recipients
      // so the org SES widget is visible and clickable in Adobe
      const sesSignatureFields: Array<{
        page: number;
        x: number;
        y: number;
        width: number;
        height: number;
      }> = [];

      try {
        const tempDoc = await PDFDocument.load(qesPdfBuffer);
        const sesSignatureItemFields = envelopeItemFields.filter(
          (field) =>
            (field.type === FieldType.SIGNATURE || field.type === FieldType.FREE_SIGNATURE) &&
            field.inserted &&
            !qesRecipientIds.includes(field.recipientId),
        );

        for (const field of sesSignatureItemFields) {
          const widthPercent = Number(field.width);
          const heightPercent = Number(field.height);

          if (widthPercent <= 0 || heightPercent <= 0) {
            continue;
          }

          const pageIndex = field.page - 1;
          if (pageIndex < 0 || pageIndex >= tempDoc.getPageCount()) {
            continue;
          }

          const page = tempDoc.getPage(pageIndex);
          const { width: pageWidth, height: pageHeight } = getPageSize(page);

          const fieldWidth = (widthPercent / 100) * pageWidth;
          const fieldHeight = (heightPercent / 100) * pageHeight;
          const fieldX = (Number(field.positionX) / 100) * pageWidth;
          const fieldY = pageHeight - (Number(field.positionY) / 100) * pageHeight - fieldHeight;

          sesSignatureFields.push({
            page: field.page,
            x: fieldX,
            y: fieldY,
            width: fieldWidth,
            height: fieldHeight,
          });
        }
      } catch (error) {
        console.error('Error collecting SES signature field positions:', error);
      }

      finalPdf = await signPdfIncremental({
        pdf: qesPdfBuffer,
        signatureFields: sesSignatureFields,
      });
    }

    const { name } = path.parse(envelopeItem.title);
    const suffix = isRejected ? '_rejected.pdf' : '_signed.pdf';

    const newDocumentData = await putPdfFileServerSide({
      name: `${name}${suffix}`,
      type: 'application/pdf',
      arrayBuffer: async () => Promise.resolve(finalPdf),
    });

    return {
      oldDocumentDataId: envelopeItem.documentData.id,
      newDocumentDataId: newDocumentData.id,
    };
  }

  let pdfDoc: PDFDocument;
  const fieldsToInsert = envelopeItemFields;

  {
    const pdfData = await getFileServerSide(envelopeItem.documentData);
    pdfDoc = await PDFDocument.load(pdfData);
  }

  // Normalize and flatten layers that could cause issues with the signature
  normalizeSignatureAppearances(pdfDoc);
  await flattenForm(pdfDoc);
  flattenAnnotations(pdfDoc);

  // Add rejection stamp if the document is rejected
  if (isRejected && rejectionReason) {
    await addRejectionStampToPdf(pdfDoc, rejectionReason);
  }

  if (certificateDoc) {
    const certificatePages = await pdfDoc.copyPages(
      certificateDoc,
      certificateDoc.getPageIndices(),
    );

    certificatePages.forEach((page) => {
      pdfDoc.addPage(page);
    });
  }

  // Handle V1 and legacy insertions.
  if (envelope.internalVersion === 1) {
    for (const field of fieldsToInsert) {
      if (field.inserted) {
        if (envelope.useLegacyFieldInsertion) {
          await legacy_insertFieldInPDF(pdfDoc, field);
        } else {
          await insertFieldInPDFV1(pdfDoc, field);
        }
      }
    }
  }

  // Handle V2 envelope insertions.
  if (envelope.internalVersion === 2) {
    const fieldsGroupedByPage = groupBy(fieldsToInsert, (field) => field.page);

    for (const [pageNumber, fields] of Object.entries(fieldsGroupedByPage)) {
      const page = pdfDoc.getPage(Number(pageNumber) - 1);
      const pageRotation = page.getRotation();

      let { width: pageWidth, height: pageHeight } = getPageSize(page);

      let pageRotationInDegrees = match(pageRotation.type)
        .with(RotationTypes.Degrees, () => pageRotation.angle)
        .with(RotationTypes.Radians, () => radiansToDegrees(pageRotation.angle))
        .exhaustive();

      // Round to the closest multiple of 90 degrees.
      pageRotationInDegrees = Math.round(pageRotationInDegrees / 90) * 90;

      // PDFs can have pages that are rotated, which are correctly rendered in the frontend.
      // However when we load the PDF in the backend, the rotation is applied.
      // To account for this, we swap the width and height for pages that are rotated by 90/270
      // degrees. This is so we can calculate the virtual position the field was placed if it
      // was correctly oriented in the frontend.
      if (pageRotationInDegrees === 90 || pageRotationInDegrees === 270) {
        [pageWidth, pageHeight] = [pageHeight, pageWidth];
      }

      // Rotate the page to the orientation that the react-pdf renders on the frontend.
      // Note: These transformations are undone at the end of the function.
      // If you change this if statement, update the if statement at the end as well
      if (pageRotationInDegrees !== 0) {
        let translateX = 0;
        let translateY = 0;

        switch (pageRotationInDegrees) {
          case 90:
            translateX = pageHeight;
            translateY = 0;
            break;
          case 180:
            translateX = pageWidth;
            translateY = pageHeight;
            break;
          case 270:
            translateX = 0;
            translateY = pageWidth;
            break;
          case 0:
          default:
            translateX = 0;
            translateY = 0;
        }

        page.pushOperators(pushGraphicsState());
        page.pushOperators(translate(translateX, translateY), rotateDegrees(pageRotationInDegrees));
      }

      const renderedPdfOverlay = await insertFieldInPDFV2({
        pageWidth,
        pageHeight,
        fields,
      });

      const [embeddedPage] = await pdfDoc.embedPdf(renderedPdfOverlay);

      // Draw the SVG on the page
      page.drawPage(embeddedPage, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      });

      // Remove the transformations applied to the page if any were applied.
      if (pageRotationInDegrees !== 0) {
        page.pushOperators(popGraphicsState());
      }
    }
  }

  // Re-flatten the form to handle our checkbox and radio fields that
  // create native arcoFields
  await flattenForm(pdfDoc);

  const pdfBytes = await pdfDoc.save();

  // Collect all inserted signature field positions for clickable widgets
  const signatureFields: Array<{
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [];

  try {
    const sigFields = envelopeItemFields.filter(
      (field) =>
        (field.type === FieldType.SIGNATURE || field.type === FieldType.FREE_SIGNATURE) &&
        field.inserted,
    );

    for (const field of sigFields) {
      const widthPercent = Number(field.width);
      const heightPercent = Number(field.height);

      // Skip fields with invalid dimensions (default is -1)
      if (widthPercent <= 0 || heightPercent <= 0) {
        continue;
      }

      const pageIndex = field.page - 1;
      if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) {
        continue;
      }

      const page = pdfDoc.getPage(pageIndex);
      const { width: pageWidth, height: pageHeight } = getPageSize(page);

      // Field dimensions are stored as percentages (0-100)
      const fieldWidth = (widthPercent / 100) * pageWidth;
      const fieldHeight = (heightPercent / 100) * pageHeight;

      // Convert from frontend coordinates (origin top-left) to PDF coordinates (origin bottom-left)
      const fieldX = (Number(field.positionX) / 100) * pageWidth;
      const fieldY = pageHeight - (Number(field.positionY) / 100) * pageHeight - fieldHeight;

      signatureFields.push({
        page: field.page,
        x: fieldX,
        y: fieldY,
        width: fieldWidth,
        height: fieldHeight,
      });
    }
  } catch (error) {
    console.error('Error collecting signature field positions:', error);
    // Continue with empty signatureFields - will use fallback invisible widget
  }

  // Sign with organization certificate
  const pdfBuffer = await signPdf({ pdf: Buffer.from(pdfBytes), signatureFields });

  const { name } = path.parse(envelopeItem.title);

  // Add suffix based on document status
  const suffix = isRejected ? '_rejected.pdf' : '_signed.pdf';

  const newDocumentData = await putPdfFileServerSide({
    name: `${name}${suffix}`,
    type: 'application/pdf',
    arrayBuffer: async () => Promise.resolve(pdfBuffer),
  });

  return {
    oldDocumentDataId: envelopeItem.documentData.id,
    newDocumentDataId: newDocumentData.id,
  };
};
