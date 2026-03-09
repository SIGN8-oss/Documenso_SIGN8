import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
} from '@cantoo/pdf-lib';

import { BYTE_RANGE_PLACEHOLDER } from '../constants/byte-range';

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
};

export const addSigningPlaceholder = async ({
  pdf,
  signatureFields,
}: AddSigningPlaceholderOptions) => {
  const doc = await PDFDocument.load(pdf);
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
      SubFilter: 'adbe.pkcs7.detached',
      ByteRange: byteRange,
      Contents: PDFHexString.fromText(' '.repeat(8192)),
      Reason: PDFString.of('Signed with SIGN8'),
      M: PDFString.fromDate(new Date()),
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
    // Multiple positions: create parent field with Kids array
    // Each widget is a child that inherits /FT and /V from the parent

    const kidsArray = PDFArray.withContext(doc.context);

    // Create widget annotations for each position
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

      // Widget annotation - child of the parent field
      // It only needs Subtype, Rect, P, F - inherits FT and V from Parent
      const widget = doc.context.register(
        doc.context.obj({
          Type: 'Annot',
          Subtype: 'Widget',
          Rect: rect,
          F: 4, // Print flag
          P: page.ref,
        }),
      );

      kidsArray.push(widget);

      // Add to page annotations
      let pageAnnots: PDFArray;
      try {
        pageAnnots = page.node.lookup(PDFName.of('Annots'), PDFArray);
      } catch {
        pageAnnots = PDFArray.withContext(doc.context);
        page.node.set(PDFName.of('Annots'), pageAnnots);
      }
      pageAnnots.push(widget);
    }

    // Create parent signature field with Kids
    const parentField = doc.context.register(
      doc.context.obj({
        FT: 'Sig',
        T: PDFString.of('Signature1'),
        V: signature,
        Kids: kidsArray,
      }),
    );

    // Set Parent reference in each widget
    for (let i = 0; i < kidsArray.size(); i++) {
      const widgetRef = kidsArray.get(i);
      if (widgetRef) {
        const widgetDict = doc.context.lookup(widgetRef, PDFDict);
        widgetDict.set(PDFName.of('Parent'), parentField);
      }
    }

    // Add parent field to AcroForm fields (NOT the widgets)
    fields.push(parentField);
  }

  acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3));

  return Buffer.from(await doc.save({ useObjectStreams: false }));
};
