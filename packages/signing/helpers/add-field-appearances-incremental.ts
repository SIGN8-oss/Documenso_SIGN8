import type { PDFDict, PDFRef } from '@cantoo/pdf-lib';
import zlib from 'node:zlib';

import {
  buildIncrementalUpdate,
  findStartXref,
  getAnnotRefs,
  getMaxObjectNumber,
  getObjectNumberFromRef,
  parsePdfStructure,
} from './incremental-pdf-utils';

export type FieldAppearance = {
  page: number; // 1-indexed
  x: number; // PDF points from left
  y: number; // PDF points from bottom
  width: number; // PDF points
  height: number; // PDF points
  imageRgba: Buffer; // RGBA pixel data
  imageWidth: number;
  imageHeight: number;
};

export type AddFieldAppearancesIncrementalOptions = {
  pdf: Buffer;
  appearances: FieldAppearance[];
};

/**
 * Add visual-only stamp annotations to a PDF using an incremental update.
 * The original PDF bytes are preserved unmodified — new objects are appended.
 * This preserves any existing CMS/PKCS#7 signatures in the PDF.
 *
 * Unlike embedImageIncremental (which modifies page content streams and invalidates
 * CMS signatures), this function uses /Stamp annotations with /AP appearance streams.
 * Stamp annotations are added to the page's /Annots array without touching /Contents.
 */
export const addFieldAppearancesIncremental = async ({
  pdf,
  appearances,
}: AddFieldAppearancesIncrementalOptions): Promise<Buffer> => {
  if (appearances.length === 0) {
    return pdf;
  }

  const maxObjNum = await getMaxObjectNumber(pdf);
  const prevStartXref = findStartXref(pdf);

  let nextObj = maxObjNum + 1;
  const objects: Array<{ objectNumber: number; content: string; stream?: Buffer }> = [];

  // Group appearances by page
  const byPage = new Map<number, FieldAppearance[]>();

  for (const app of appearances) {
    const pageIdx = Math.max(0, app.page - 1);
    const existing = byPage.get(pageIdx) ?? [];
    existing.push(app);
    byPage.set(pageIdx, existing);
  }

  // Parse structure for each affected page
  const pageStructures = new Map<number, { pageRef: PDFRef; pageDict: PDFDict }>();

  // We need the first page's structure for catalog/root info
  const firstPageIdx = byPage.keys().next().value!;
  const firstStructure = await parsePdfStructure(pdf, firstPageIdx);
  pageStructures.set(firstPageIdx, {
    pageRef: firstStructure.pageRef,
    pageDict: firstStructure.pageDict,
  });

  for (const pageIdx of byPage.keys()) {
    if (!pageStructures.has(pageIdx)) {
      const struct = await parsePdfStructure(pdf, pageIdx);
      pageStructures.set(pageIdx, {
        pageRef: struct.pageRef,
        pageDict: struct.pageDict,
      });
    }
  }

  // Track which annotation refs to add to each page
  const pageAnnotRefs = new Map<number, string[]>();

  for (const [pageIdx, pageAppearances] of byPage) {
    const annotRefs: string[] = [];

    for (const app of pageAppearances) {
      const { imageRgba, imageWidth, imageHeight } = app;
      const pixelCount = imageWidth * imageHeight;

      // Separate RGBA into RGB and Alpha
      const rgbData = Buffer.alloc(pixelCount * 3);
      const alphaData = Buffer.alloc(pixelCount);
      let hasAlpha = false;

      for (let i = 0; i < pixelCount; i++) {
        rgbData[i * 3] = imageRgba[i * 4];
        rgbData[i * 3 + 1] = imageRgba[i * 4 + 1];
        rgbData[i * 3 + 2] = imageRgba[i * 4 + 2];
        const a = imageRgba[i * 4 + 3];
        alphaData[i] = a;
        if (a < 255) hasAlpha = true;
      }

      const rgbCompressed = zlib.deflateSync(rgbData);

      // Create SMask (alpha) if needed
      let smaskObjNum: number | null = null;

      if (hasAlpha) {
        const alphaCompressed = zlib.deflateSync(alphaData);
        smaskObjNum = nextObj++;
        objects.push({
          objectNumber: smaskObjNum,
          content: [
            '<<',
            '  /Type /XObject',
            '  /Subtype /Image',
            `  /Width ${imageWidth}`,
            `  /Height ${imageHeight}`,
            '  /ColorSpace /DeviceGray',
            '  /BitsPerComponent 8',
            '  /Filter /FlateDecode',
            `  /Length ${alphaCompressed.length}`,
            '>>',
          ].join('\n'),
          stream: alphaCompressed,
        });
      }

      // Create Image XObject (RGB)
      const imageObjNum = nextObj++;
      const smaskLine = smaskObjNum !== null ? `\n  /SMask ${smaskObjNum} 0 R` : '';
      objects.push({
        objectNumber: imageObjNum,
        content: [
          '<<',
          '  /Type /XObject',
          '  /Subtype /Image',
          `  /Width ${imageWidth}`,
          `  /Height ${imageHeight}`,
          '  /ColorSpace /DeviceRGB',
          '  /BitsPerComponent 8',
          '  /Filter /FlateDecode',
          `  /Length ${rgbCompressed.length}${smaskLine}`,
          '>>',
        ].join('\n'),
        stream: rgbCompressed,
      });

      // Create Form XObject (appearance stream) that draws the image
      const bboxW = app.width;
      const bboxH = app.height;
      const apStreamText = `q\n${bboxW} 0 0 ${bboxH} 0 0 cm\n/Img Do\nQ\n`;
      const apStreamData = Buffer.from(apStreamText, 'latin1');
      const apFormObjNum = nextObj++;
      objects.push({
        objectNumber: apFormObjNum,
        content: [
          '<<',
          '  /Type /XObject',
          '  /Subtype /Form',
          `  /BBox [ 0 0 ${bboxW} ${bboxH} ]`,
          `  /Resources << /XObject << /Img ${imageObjNum} 0 R >> >>`,
          `  /Length ${apStreamData.length}`,
          '>>',
        ].join('\n'),
        stream: apStreamData,
      });

      // Create Stamp annotation
      const pageInfo = pageStructures.get(pageIdx)!;
      const rect = `[ ${app.x} ${app.y} ${app.x + app.width} ${app.y + app.height} ]`;
      const stampObjNum = nextObj++;

      objects.push({
        objectNumber: stampObjNum,
        content: [
          '<<',
          '  /Type /Annot',
          '  /Subtype /Stamp',
          `  /Rect ${rect}`,
          `  /AP << /N ${apFormObjNum} 0 R >>`,
          '  /F 196',
          `  /P ${pageInfo.pageRef.toString()}`,
          '>>',
        ].join('\n'),
      });

      annotRefs.push(`${stampObjNum} 0 R`);
    }

    pageAnnotRefs.set(pageIdx, annotRefs);
  }

  // Update page Annots arrays for each affected page
  for (const [pageIdx, newAnnotRefs] of pageAnnotRefs) {
    const pageInfo = pageStructures.get(pageIdx)!;
    const pageObjNum = getObjectNumberFromRef(pageInfo.pageRef);
    const existingAnnots = getAnnotRefs(pageInfo.pageDict);

    const entries: string[] = ['<<'];

    for (const [key, value] of pageInfo.pageDict.entries()) {
      const keyStr = key.toString();
      if (keyStr === '/Annots') continue;
      entries.push(`${keyStr} ${value.toString()}`);
    }

    entries.push(`/Annots [ ${[...existingAnnots, ...newAnnotRefs].join(' ')} ]`);
    entries.push('>>');

    objects.push({
      objectNumber: pageObjNum,
      content: entries.join('\n'),
    });
  }

  const totalObjectCount = nextObj;

  const incrementalSection = buildIncrementalUpdate({
    originalPdfLength: pdf.length,
    prevStartXref,
    rootRef: firstStructure.rootRef.toString(),
    objects,
    totalObjectCount,
    infoRef: firstStructure.infoRef,
    idArray: firstStructure.idArray,
  });

  return Buffer.concat([pdf, incrementalSection]);
};
