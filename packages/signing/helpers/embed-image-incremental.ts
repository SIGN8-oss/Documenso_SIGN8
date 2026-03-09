import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from '@cantoo/pdf-lib';
import zlib from 'node:zlib';

import {
  buildIncrementalUpdate,
  findStartXref,
  getMaxObjectNumber,
  getObjectNumberFromRef,
  parsePdfStructure,
} from './incremental-pdf-utils';

export type EmbedImageIncrementalOptions = {
  pdf: Buffer;
  imageRgba: Buffer; // Raw RGBA pixel data (width * height * 4 bytes)
  imageWidth: number;
  imageHeight: number;
  pageIndex: number; // 0-based
  // Draw position in PDF coordinates (origin bottom-left)
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
};

/**
 * Embed an RGBA image into a PDF page using an incremental update.
 * The original PDF bytes are preserved unmodified — new objects are appended.
 * This preserves any existing CMS/PKCS#7 signatures in the PDF.
 */
export const embedImageIncremental = async ({
  pdf,
  imageRgba,
  imageWidth,
  imageHeight,
  pageIndex,
  drawX,
  drawY,
  drawWidth,
  drawHeight,
}: EmbedImageIncrementalOptions): Promise<Buffer> => {
  const pixelCount = imageWidth * imageHeight;

  // Separate RGBA into RGB and Alpha channels
  const rgbData = Buffer.alloc(pixelCount * 3);
  const alphaData = Buffer.alloc(pixelCount);
  let hasNonOpaquePixel = false;

  for (let i = 0; i < pixelCount; i++) {
    rgbData[i * 3] = imageRgba[i * 4];
    rgbData[i * 3 + 1] = imageRgba[i * 4 + 1];
    rgbData[i * 3 + 2] = imageRgba[i * 4 + 2];
    const alpha = imageRgba[i * 4 + 3];
    alphaData[i] = alpha;
    if (alpha < 255) hasNonOpaquePixel = true;
  }

  // Compress with zlib (Flate)
  const rgbCompressed = zlib.deflateSync(rgbData);
  const alphaCompressed = hasNonOpaquePixel ? zlib.deflateSync(alphaData) : null;

  // Parse PDF structure
  const maxObjNum = await getMaxObjectNumber(pdf);
  const prevStartXref = findStartXref(pdf);
  const structure = await parsePdfStructure(pdf, pageIndex);

  let nextObj = maxObjNum + 1;

  const objects: Array<{
    objectNumber: number;
    content: string;
    stream?: Buffer;
  }> = [];

  // Build SMask (alpha channel) XObject if needed
  let smaskObjNum: number | null = null;

  if (hasNonOpaquePixel && alphaCompressed) {
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

  // Build Image XObject (RGB data)
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

  // Build content stream that draws the image overlay
  const xobjectName = `/SigOverlay_${Date.now()}`;
  const contentStreamText = [
    'q',
    `${drawWidth} 0 0 ${drawHeight} ${drawX} ${drawY} cm`,
    `${xobjectName} Do`,
    'Q',
    '',
  ].join('\n');

  const contentStreamData = Buffer.from(contentStreamText, 'latin1');
  const contentStreamObjNum = nextObj++;

  objects.push({
    objectNumber: contentStreamObjNum,
    content: `<< /Length ${contentStreamData.length} >>`,
    stream: contentStreamData,
  });

  // Build modified page dictionary with updated /Contents and /Resources
  const pageObjNum = getObjectNumberFromRef(structure.pageRef);

  // Parse existing /Contents to build new array
  const contentsRaw = structure.pageDict.get(PDFName.of('Contents'));
  const existingContentRefs: string[] = [];

  if (contentsRaw instanceof PDFArray) {
    for (let i = 0; i < contentsRaw.size(); i++) {
      const item = contentsRaw.get(i);
      if (item) existingContentRefs.push(item.toString());
    }
  } else if (contentsRaw) {
    existingContentRefs.push(contentsRaw.toString());
  }

  existingContentRefs.push(`${contentStreamObjNum} 0 R`);
  const contentsStr = `[ ${existingContentRefs.join(' ')} ]`;

  // Build modified /Resources with new XObject entry
  const doc = await PDFDocument.load(pdf);
  const resourcesStr = buildResourcesWithXObject(structure.pageDict, doc, xobjectName, imageObjNum);

  // Build complete modified page dictionary
  const modifiedPageEntries: string[] = ['<<'];

  for (const [key, val] of structure.pageDict.entries()) {
    const keyStr = key.toString();
    if (keyStr === '/Contents' || keyStr === '/Resources') continue;
    modifiedPageEntries.push(`  ${keyStr} ${val.toString()}`);
  }

  modifiedPageEntries.push(`  /Contents ${contentsStr}`);
  modifiedPageEntries.push(`  /Resources ${resourcesStr}`);
  modifiedPageEntries.push('>>');

  objects.push({
    objectNumber: pageObjNum,
    content: modifiedPageEntries.join('\n'),
  });

  const totalObjectCount = nextObj;

  const incrementalSection = buildIncrementalUpdate({
    originalPdfLength: pdf.length,
    prevStartXref,
    rootRef: structure.rootRef.toString(),
    objects,
    totalObjectCount,
  });

  return Buffer.concat([pdf, incrementalSection]);
};

/**
 * Serialize the page's Resources dictionary with an additional XObject entry.
 */
const buildResourcesWithXObject = (
  pageDict: PDFDict,
  doc: PDFDocument,
  xobjectName: string,
  xobjectObjNum: number,
): string => {
  const resourcesRaw = pageDict.get(PDFName.of('Resources'));
  let resourcesDict: PDFDict | null = null;

  if (resourcesRaw instanceof PDFRef) {
    resourcesDict = doc.context.lookup(resourcesRaw, PDFDict);
  } else if (resourcesRaw instanceof PDFDict) {
    resourcesDict = resourcesRaw;
  }

  // Build /XObject sub-dict: existing entries + new image reference
  let xobjectEntries = '';

  if (resourcesDict) {
    const xobjectRaw = resourcesDict.get(PDFName.of('XObject'));
    let xobjectDict: PDFDict | null = null;

    if (xobjectRaw instanceof PDFRef) {
      xobjectDict = doc.context.lookup(xobjectRaw, PDFDict);
    } else if (xobjectRaw instanceof PDFDict) {
      xobjectDict = xobjectRaw;
    }

    if (xobjectDict) {
      for (const [key, val] of xobjectDict.entries()) {
        xobjectEntries += ` ${key.toString()} ${val.toString()}`;
      }
    }
  }

  xobjectEntries += ` ${xobjectName} ${xobjectObjNum} 0 R`;
  const xobjectStr = `<<${xobjectEntries} >>`;

  // Build full Resources dict: existing entries + modified XObject
  let entries = '';

  if (resourcesDict) {
    for (const [key, val] of resourcesDict.entries()) {
      if (key.toString() === '/XObject') continue;
      entries += `  ${key.toString()} ${val.toString()}\n`;
    }
  }

  entries += `  /XObject ${xobjectStr}\n`;

  return `<<\n${entries}>>`;
};
