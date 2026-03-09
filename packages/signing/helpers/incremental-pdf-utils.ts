import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from '@cantoo/pdf-lib';

/**
 * Find the offset of the last xref table by scanning backwards from %%EOF.
 */
export const findStartXref = (pdf: Buffer): number => {
  // Search the last 256 bytes for "startxref"
  const tail = pdf.subarray(Math.max(0, pdf.length - 256));
  const tailStr = tail.toString('latin1');

  const idx = tailStr.lastIndexOf('startxref');

  if (idx === -1) {
    throw new Error('Could not find startxref in PDF');
  }

  // The offset number is on the next line after "startxref"
  const afterKeyword = tailStr.substring(idx + 'startxref'.length).trim();
  const lines = afterKeyword.split(/[\r\n]+/);
  const offset = parseInt(lines[0], 10);

  if (isNaN(offset)) {
    throw new Error('Could not parse startxref offset');
  }

  return offset;
};

/**
 * Get the highest object number in the PDF (read-only, no save).
 *
 * Uses the trailer /Size value (which equals max object number + 1) as the
 * authoritative source. pdf-lib's `largestObjectNumber` doesn't account for
 * objects stored inside Object Streams (ObjStm, PDF 1.5+), which can cause
 * new objects to collide with and overwrite critical ObjStm entries (fonts,
 * page resources, etc.).
 */
export const getMaxObjectNumber = async (pdf: Buffer): Promise<number> => {
  const doc = await PDFDocument.load(pdf);

  // Parse /Size from the last trailer in the raw PDF.
  // /Size is "one greater than the highest object number defined in the file" (ISO 32000-1 §7.5.5).
  // Search the last 2048 bytes to find the most recent trailer's /Size.
  const tail = pdf.subarray(Math.max(0, pdf.length - 2048)).toString('latin1');
  const sizeMatches = [...tail.matchAll(/\/Size\s+(\d+)/g)];
  const trailerSize =
    sizeMatches.length > 0 ? parseInt(sizeMatches[sizeMatches.length - 1][1], 10) : 0;

  return Math.max(doc.context.largestObjectNumber, trailerSize - 1);
};

export type PdfStructureInfo = {
  rootRef: PDFRef;
  catalogDict: PDFDict;
  acroFormRef: PDFRef | null;
  acroFormDict: PDFDict | null;
  pageRef: PDFRef;
  pageDict: PDFDict;
  /** Serialized /Info reference from the trailer, e.g. "14 0 R" */
  infoRef: string | null;
  /** Serialized /ID array from the trailer, e.g. "[ <hex> <hex> ]" */
  idArray: string | null;
};

/**
 * Parse PDF structure using pdf-lib (read-only). Extracts refs for root, AcroForm, and page.
 */
export const parsePdfStructure = async (
  pdf: Buffer,
  pageIndex: number,
): Promise<PdfStructureInfo> => {
  const doc = await PDFDocument.load(pdf);

  const rootRef = doc.context.trailerInfo.Root;

  if (!rootRef || !(rootRef instanceof PDFRef)) {
    throw new Error('Could not find Root reference in PDF trailer');
  }

  const pages = doc.getPages();

  if (pageIndex < 0 || pageIndex >= pages.length) {
    throw new Error(`Page index ${pageIndex} out of range (0-${pages.length - 1})`);
  }

  const page = pages[pageIndex];
  const pageRef = page.ref;
  const pageDict = page.node;

  // Get catalog dict
  const catalogDict = doc.context.lookup(rootRef, PDFDict);

  // Get AcroForm if it exists
  const acroFormRaw = doc.catalog.get(PDFName.of('AcroForm'));
  let acroFormRef: PDFRef | null = null;
  let acroFormDict: PDFDict | null = null;

  if (acroFormRaw instanceof PDFRef) {
    acroFormRef = acroFormRaw;
    acroFormDict = doc.context.lookup(acroFormRaw, PDFDict);
  } else if (acroFormRaw instanceof PDFDict) {
    acroFormDict = acroFormRaw;
  }

  // Extract /Info and /ID from trailer for incremental update propagation
  const infoRaw = doc.context.trailerInfo.Info;
  const idRaw = doc.context.trailerInfo.ID;

  return {
    rootRef,
    catalogDict,
    acroFormRef,
    acroFormDict,
    pageRef,
    pageDict,
    infoRef: infoRaw ? infoRaw.toString() : null,
    idArray: idRaw ? idRaw.toString() : null,
  };
};

export type IncrementalObject = {
  objectNumber: number;
  generationNumber?: number;
  content: string; // The dictionary content (without "N 0 obj" / "endobj" wrapper)
  stream?: Buffer; // Optional binary stream data (for Image XObjects, content streams, etc.)
};

/**
 * Build an incremental update section to append to a PDF.
 *
 * Format:
 *   [new/modified objects]
 *   xref
 *   [entries only for new/modified objects]
 *   trailer
 *   << /Size N /Root R /Prev [old startxref offset] >>
 *   startxref
 *   [new xref offset]
 *   %%EOF
 */
export const buildIncrementalUpdate = (options: {
  originalPdfLength: number;
  prevStartXref: number;
  rootRef: string; // e.g. "1 0 R"
  objects: IncrementalObject[];
  totalObjectCount: number; // /Size value = max obj num + 1
  infoRef?: string | null; // e.g. "14 0 R" — propagated from original trailer
  idArray?: string | null; // e.g. "[ <hex> <hex> ]" — propagated from original trailer
}): Buffer => {
  const { originalPdfLength, prevStartXref, rootRef, objects, totalObjectCount, infoRef, idArray } =
    options;

  // Use Buffer array for proper binary stream support
  const parts: Buffer[] = [];
  let currentLength = originalPdfLength;

  const addText = (text: string) => {
    const buf = Buffer.from(text, 'latin1');
    parts.push(buf);
    currentLength += buf.length;
  };

  const addBuffer = (buf: Buffer) => {
    parts.push(buf);
    currentLength += buf.length;
  };

  addText('\n');

  // Track byte offsets for each object (relative to start of original PDF)
  const objectOffsets: Array<{ objectNumber: number; offset: number }> = [];

  for (const obj of objects) {
    const gen = obj.generationNumber ?? 0;
    objectOffsets.push({ objectNumber: obj.objectNumber, offset: currentLength });

    addText(`${obj.objectNumber} ${gen} obj\n`);
    addText(obj.content);

    if (obj.stream) {
      addText('\nstream\n');
      addBuffer(obj.stream);
      addText('\nendstream');
    }

    addText('\nendobj\n\n');
  }

  // Build xref section
  const xrefOffset = currentLength;

  let xrefAndTrailer = 'xref\n';

  // Sort objects by number for xref
  const sorted = [...objectOffsets].sort((a, b) => a.objectNumber - b.objectNumber);

  // Group consecutive object numbers into subsections
  const subsections: Array<{ start: number; entries: Array<{ offset: number }> }> = [];

  for (const item of sorted) {
    const last = subsections[subsections.length - 1];

    if (last && item.objectNumber === last.start + last.entries.length) {
      last.entries.push({ offset: item.offset });
    } else {
      subsections.push({
        start: item.objectNumber,
        entries: [{ offset: item.offset }],
      });
    }
  }

  for (const sub of subsections) {
    xrefAndTrailer += `${sub.start} ${sub.entries.length}\n`;

    for (const entry of sub.entries) {
      // Each xref entry MUST be exactly 20 bytes (PDF spec ISO 32000-1):
      // 10-digit offset + SP + 5-digit gen + SP + 'n' + SP + LF = 20 bytes
      const offsetStr = String(entry.offset).padStart(10, '0');
      xrefAndTrailer += `${offsetStr} 00000 n \n`;
    }
  }

  // Trailer — must propagate /Info and /ID from the original trailer (PDF spec ISO 32000-1 §7.5.5)
  xrefAndTrailer += 'trailer\n';
  let trailerDict = `<< /Size ${totalObjectCount} /Root ${rootRef} /Prev ${prevStartXref}`;

  if (infoRef) {
    trailerDict += ` /Info ${infoRef}`;
  }

  if (idArray) {
    trailerDict += ` /ID ${idArray}`;
  }

  trailerDict += ' >>\n';
  xrefAndTrailer += trailerDict;
  xrefAndTrailer += 'startxref\n';
  xrefAndTrailer += `${xrefOffset}\n`;
  xrefAndTrailer += '%%EOF\n';

  addText(xrefAndTrailer);

  return Buffer.concat(parts);
};

/**
 * Serialize a PDFDict to a PDF dictionary string.
 * Uses pdf-lib's toString() which produces valid PDF syntax.
 */
export const serializePdfDict = (dict: PDFDict): string => {
  return dict.toString();
};

/**
 * Get existing annotation refs from a page as an array of ref strings.
 */
export const getAnnotRefs = (pageDict: PDFDict): string[] => {
  const annotsRaw = pageDict.get(PDFName.of('Annots'));
  const refs: string[] = [];

  if (annotsRaw instanceof PDFArray) {
    for (let i = 0; i < annotsRaw.size(); i++) {
      const item = annotsRaw.get(i);

      if (item) {
        refs.push(item.toString());
      }
    }
  }

  return refs;
};

/**
 * Get existing field refs from an AcroForm dict.
 */
export const getFieldRefs = (acroFormDict: PDFDict): string[] => {
  const fieldsRaw = acroFormDict.get(PDFName.of('Fields'));
  const refs: string[] = [];

  if (fieldsRaw instanceof PDFArray) {
    for (let i = 0; i < fieldsRaw.size(); i++) {
      const item = fieldsRaw.get(i);

      if (item) {
        refs.push(item.toString());
      }
    }
  }

  return refs;
};

/**
 * Get the object number from a PDFRef or a ref string like "5 0 R".
 */
export const getObjectNumberFromRef = (ref: PDFRef | string): number => {
  if (ref instanceof PDFRef) {
    return ref.objectNumber;
  }

  const match = ref.match(/^(\d+)\s+\d+\s+R$/);

  if (!match) {
    throw new Error(`Invalid PDF reference: ${ref}`);
  }

  return parseInt(match[1], 10);
};
