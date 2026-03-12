import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from '@cantoo/pdf-lib';

import { BYTE_RANGE_PLACEHOLDER } from '../constants/byte-range';
import { formatPdfDate, parseAllTrailerSizes } from './incremental-pdf-utils';

export type SignatureFieldPosition = {
  page: number; // 1-indexed page number
  x: number; // Position from left (in PDF points)
  y: number; // Position from bottom (in PDF points)
  width: number; // Width in PDF points
  height: number; // Height in PDF points
};

export type AddSigningPlaceholderOptions = {
  pdf: Buffer;
  // Optional signature field positions for clickable areas (multiple widgets)
  signatureFields?: SignatureFieldPosition[];
  useCadesSubFilter?: boolean;
};

export const addSigningPlaceholder = async ({
  pdf,
  signatureFields,
  useCadesSubFilter,
}: AddSigningPlaceholderOptions) => {
  const doc = await PDFDocument.load(pdf);

  // ObjStm safety: ensure pdf-lib's largestObjectNumber accounts for objects
  // inside Object Streams (ObjStm, PDF 1.5+) by checking the trailer /Size chain
  const rawMaxObj = parseAllTrailerSizes(pdf) - 1;

  if (rawMaxObj > doc.context.largestObjectNumber) {
    doc.context.assign(PDFRef.of(rawMaxObj + 1, 0), doc.context.obj({}));
  }

  const pages = doc.getPages();

  // Create ByteRange array with placeholders
  const byteRange = PDFArray.withContext(doc.context);
  byteRange.push(PDFNumber.of(0));
  byteRange.push(PDFName.of(BYTE_RANGE_PLACEHOLDER));
  byteRange.push(PDFName.of(BYTE_RANGE_PLACEHOLDER));
  byteRange.push(PDFName.of(BYTE_RANGE_PLACEHOLDER));

  // Create the signature dictionary (shared by all widgets)
  const signature = doc.context.register(
    doc.context.obj({
      Type: 'Sig',
      Filter: 'Adobe.PPKLite',
      SubFilter: useCadesSubFilter ? 'ETSI.CAdES.detached' : 'adbe.pkcs7.detached',
      ByteRange: byteRange,
      Contents: PDFHexString.fromText(' '.repeat(32768)),
      Reason: PDFString.of('Signed with SIGN8'),
      M: PDFString.of(formatPdfDate(new Date())),
    }),
  );

  // Get or create AcroForm
  let acroForm: PDFDict;
  try {
    acroForm = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
  } catch {
    const newAcroForm = doc.context.obj({
      Fields: PDFArray.withContext(doc.context),
    });
    const acroFormRef = doc.context.register(newAcroForm);
    doc.catalog.set(PDFName.of('AcroForm'), acroFormRef);
    acroForm = newAcroForm;
  }

  // Get or create Fields array in AcroForm
  let fields: PDFArray;
  try {
    fields = acroForm.lookup(PDFName.of('Fields'), PDFArray);
  } catch {
    fields = PDFArray.withContext(doc.context);
    acroForm.set(PDFName.of('Fields'), fields);
  }

  // Prepare list of positions (use invisible widget if none provided)
  const positions: SignatureFieldPosition[] =
    signatureFields && signatureFields.length > 0
      ? signatureFields
      : [{ page: 1, x: 0, y: 0, width: 0, height: 0 }];

  // If only one position, create a simple widget-field (combined)
  if (positions.length === 1) {
    const pos = positions[0];
    const pageIndex = pos.page - 1;
    const page = pages[pageIndex] || pages[0];

    const rect: [number, number, number, number] = [
      pos.x,
      pos.y,
      pos.x + pos.width,
      pos.y + pos.height,
    ];

    // Create combined widget+field annotation
    const widget = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Widget',
        FT: 'Sig',
        Rect: rect,
        V: signature,
        T: PDFString.of('Signature1'),
        F: 4, // Print flag
        P: page.ref,
      }),
    );

    // Add to page annotations
    let pageAnnots: PDFArray;
    try {
      pageAnnots = page.node.lookup(PDFName.of('Annots'), PDFArray);
    } catch {
      pageAnnots = PDFArray.withContext(doc.context);
      page.node.set(PDFName.of('Annots'), pageAnnots);
    }
    pageAnnots.push(widget);

    // Add to AcroForm fields
    fields.push(widget);
  } else {
    // Multiple positions: create N standalone merged Field+Widget objects per
    // ISO 32000-1 §12.7.4.5. Each has its own /FT /Sig and unique /T name but all
    // share the same /V (sig dict). No parent-kids hierarchy.
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const pageIndex = pos.page - 1;
      const page = pages[pageIndex] || pages[0];

      const rect: [number, number, number, number] = [
        pos.x,
        pos.y,
        pos.x + pos.width,
        pos.y + pos.height,
      ];

      const widget = doc.context.register(
        doc.context.obj({
          Type: 'Annot',
          Subtype: 'Widget',
          FT: 'Sig',
          Rect: rect,
          V: signature,
          T: PDFString.of(`Signature${i + 1}`),
          F: 4,
          P: page.ref,
        }),
      );

      // Add to page annotations
      let pageAnnots: PDFArray;
      try {
        pageAnnots = page.node.lookup(PDFName.of('Annots'), PDFArray);
      } catch {
        pageAnnots = PDFArray.withContext(doc.context);
        page.node.set(PDFName.of('Annots'), pageAnnots);
      }
      pageAnnots.push(widget);

      // Each standalone field goes into AcroForm fields
      fields.push(widget);
    }
  }

  acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3));

  return Buffer.from(await doc.save({ useObjectStreams: false }));
};
