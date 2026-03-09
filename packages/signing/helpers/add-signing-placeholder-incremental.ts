import type { PDFDict, PDFRef } from '@cantoo/pdf-lib';
import zlib from 'node:zlib';

import { BYTE_RANGE_PLACEHOLDER } from '../constants/byte-range';
import type { SignatureFieldPosition } from './add-signing-placeholder';
import {
  buildIncrementalUpdate,
  findStartXref,
  getAnnotRefs,
  getFieldRefs,
  getMaxObjectNumber,
  getObjectNumberFromRef,
  parsePdfStructure,
} from './incremental-pdf-utils';

export type SignatureAppearance = {
  imageRgba: Buffer; // Raw RGBA pixel data
  imageWidth: number; // Pixel width
  imageHeight: number; // Pixel height
};

export type AddSigningPlaceholderIncrementalOptions = {
  pdf: Buffer;
  signatureFields?: SignatureFieldPosition[];
  appearance?: SignatureAppearance;
  appearances?: SignatureAppearance[];
};

/**
 * Add a signing placeholder to a PDF using incremental update.
 * The original PDF bytes are preserved unmodified - new objects are appended.
 * This preserves any existing CMS/PKCS#7 signatures in the PDF.
 *
 * When `appearance` is provided, the widget annotation gets an /AP (appearance stream)
 * containing the rendered signature image. This is the standard PDF mechanism for
 * showing visual content on a signature widget without modifying the page's content
 * streams (which would invalidate prior signatures).
 */
export const addSigningPlaceholderIncremental = async ({
  pdf,
  signatureFields,
  appearance,
  appearances,
}: AddSigningPlaceholderIncrementalOptions): Promise<Buffer> => {
  const maxObjNum = await getMaxObjectNumber(pdf);
  const prevStartXref = findStartXref(pdf);

  // Resolve the effective appearances array: prefer `appearances`, fall back to single `appearance`
  const effectiveAppearances = appearances ?? (appearance ? [appearance] : []);

  // Determine field positions - use all provided fields, or a default invisible one
  const positions =
    signatureFields && signatureFields.length > 0
      ? signatureFields
      : [{ page: 1, x: 0, y: 0, width: 0, height: 0 }];

  // We need page structures for each unique page referenced by field positions
  const uniquePages = [...new Set(positions.map((p) => Math.max(0, p.page - 1)))];

  // Parse structure for the first page (needed for catalog/AcroForm)
  const structure = await parsePdfStructure(pdf, uniquePages[0]);

  // Parse additional pages if widgets span multiple pages
  const pageStructures = new Map<number, { pageRef: PDFRef; pageDict: PDFDict }>();
  pageStructures.set(uniquePages[0], {
    pageRef: structure.pageRef,
    pageDict: structure.pageDict,
  });

  for (const pageIdx of uniquePages.slice(1)) {
    const pageStruct = await parsePdfStructure(pdf, pageIdx);
    pageStructures.set(pageIdx, {
      pageRef: pageStruct.pageRef,
      pageDict: pageStruct.pageDict,
    });
  }

  // Assign new object numbers
  let nextObj = maxObjNum + 1;
  const sigObjNum = nextObj++;

  // Build the signature dictionary content
  const byteRangePlaceholder = `[ 0 /${BYTE_RANGE_PLACEHOLDER} /${BYTE_RANGE_PLACEHOLDER} /${BYTE_RANGE_PLACEHOLDER} ]`;
  // 24576 hex chars = 12288 bytes of signature space (AES/QES CMS signatures can exceed 8KB)
  const contentsPlaceholder = '<' + '0'.repeat(24576) + '>';
  const dateStr = formatPdfDate(new Date());

  const sigContent = [
    '<<',
    '  /Type /Sig',
    '  /Filter /Adobe.PPKLite',
    '  /SubFilter /adbe.pkcs7.detached',
    `  /ByteRange ${byteRangePlaceholder}`,
    `  /Contents ${contentsPlaceholder}`,
    '  /Reason (Signed with SIGN8)',
    `  /M (${dateStr})`,
    '>>',
  ].join('\n');

  const objects: Array<{ objectNumber: number; content: string; stream?: Buffer }> = [
    { objectNumber: sigObjNum, content: sigContent },
  ];

  // Create a widget annotation for each signature field position
  const widgetObjNums: number[] = [];
  const widgetPageIndices: number[] = [];

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const fieldAppearance = effectiveAppearances[i] ?? null;
    const widgetObjNum = nextObj++;
    widgetObjNums.push(widgetObjNum);
    widgetPageIndices.push(Math.max(0, pos.page - 1));

    // Build appearance stream objects for this widget
    // When appearance data is provided, embed the rendered signature image.
    // When no appearance data exists but the widget has non-zero dimensions,
    // create a transparent /AP so the widget doesn't hide page content underneath.
    let apLine = '';

    if (fieldAppearance) {
      const { imageRgba, imageWidth, imageHeight } = fieldAppearance;
      const pixelCount = imageWidth * imageHeight;

      // Separate RGBA into RGB and Alpha
      const rgbData = Buffer.alloc(pixelCount * 3);
      const alphaData = Buffer.alloc(pixelCount);
      let hasAlpha = false;

      for (let j = 0; j < pixelCount; j++) {
        rgbData[j * 3] = imageRgba[j * 4];
        rgbData[j * 3 + 1] = imageRgba[j * 4 + 1];
        rgbData[j * 3 + 2] = imageRgba[j * 4 + 2];
        const a = imageRgba[j * 4 + 3];
        alphaData[j] = a;
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
      const bboxW = pos.width;
      const bboxH = pos.height;
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

      apLine = `\n  /AP << /N ${apFormObjNum} 0 R >>`;
    } else if (pos.width > 0 && pos.height > 0) {
      // No appearance data but visible widget — create transparent Form XObject
      // so the widget doesn't hide page content rendered underneath
      const emptyStreamText = 'q Q\n';
      const emptyStreamData = Buffer.from(emptyStreamText, 'latin1');
      const emptyFormObjNum = nextObj++;
      objects.push({
        objectNumber: emptyFormObjNum,
        content: [
          '<<',
          '  /Type /XObject',
          '  /Subtype /Form',
          `  /BBox [ 0 0 ${pos.width} ${pos.height} ]`,
          `  /Length ${emptyStreamData.length}`,
          '>>',
        ].join('\n'),
        stream: emptyStreamData,
      });

      apLine = `\n  /AP << /N ${emptyFormObjNum} 0 R >>`;
    }

    // Build the widget annotation
    const pageIdx = Math.max(0, pos.page - 1);
    const pageInfo = pageStructures.get(pageIdx)!;
    const rect = `[ ${pos.x} ${pos.y} ${pos.x + pos.width} ${pos.y + pos.height} ]`;
    const fieldName = `Signature_Org_${Date.now()}_${i}`;

    const widgetContent = [
      '<<',
      '  /Type /Annot',
      '  /Subtype /Widget',
      '  /FT /Sig',
      `  /Rect ${rect}`,
      `  /V ${sigObjNum} 0 R`,
      `  /T (${fieldName})`,
      `  /F 4${apLine}`,
      `  /P ${pageInfo.pageRef.toString()}`,
      '>>',
    ].join('\n');

    objects.push({ objectNumber: widgetObjNum, content: widgetContent });
  }

  // If multiple positions, refactor into parent-kids structure so Adobe counts only 1 signature
  let acroFormFieldObjNums: number[];

  if (positions.length > 1) {
    const parentObjNum = nextObj++;
    const kidsStr = widgetObjNums.map((n) => `${n} 0 R`).join(' ');
    const parentContent = [
      '<<',
      '  /FT /Sig',
      `  /T (Signature_Org_${Date.now()})`,
      `  /V ${sigObjNum} 0 R`,
      `  /Kids [ ${kidsStr} ]`,
      '>>',
    ].join('\n');
    objects.push({ objectNumber: parentObjNum, content: parentContent });

    // Rebuild each widget without /FT, /V, /T — add /Parent instead
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const widgetObjNum2 = widgetObjNums[i];
      const pageIdx = Math.max(0, pos.page - 1);
      const pageInfo = pageStructures.get(pageIdx)!;
      const rect = `[ ${pos.x} ${pos.y} ${pos.x + pos.width} ${pos.y + pos.height} ]`;

      // Reconstruct the /AP line from the original widget (image or transparent)
      let apLine = '';
      const existingWidget = objects.find((o) => o.objectNumber === widgetObjNum2);
      if (existingWidget) {
        const apMatch = existingWidget.content.match(/\/AP << \/N (\d+ 0 R) >>/);
        if (apMatch) {
          apLine = `\n  /AP << /N ${apMatch[1]} >>`;
        }
      }

      const childContent = [
        '<<',
        '  /Type /Annot',
        '  /Subtype /Widget',
        `  /Rect ${rect}`,
        `  /F 4${apLine}`,
        `  /P ${pageInfo.pageRef.toString()}`,
        `  /Parent ${parentObjNum} 0 R`,
        '>>',
      ].join('\n');

      // Replace existing widget object content
      const objIdx = objects.findIndex((o) => o.objectNumber === widgetObjNum2);
      if (objIdx !== -1) {
        objects[objIdx] = { objectNumber: widgetObjNum2, content: childContent };
      }
    }

    // Only parent goes in AcroForm /Fields
    acroFormFieldObjNums = [parentObjNum];
  } else {
    // Single position: widget is the field itself
    acroFormFieldObjNums = [...widgetObjNums];
  }

  // Update page Annots arrays for each affected page
  for (const pageIdx of uniquePages) {
    const pageInfo = pageStructures.get(pageIdx)!;
    const pageObjNum = getObjectNumberFromRef(pageInfo.pageRef);

    // Collect widget refs that belong to this page
    const pageWidgetRefs = widgetObjNums
      .filter((_, idx) => widgetPageIndices[idx] === pageIdx)
      .map((num) => `${num} 0 R`);

    objects.push({
      objectNumber: pageObjNum,
      content: buildModifiedDict(pageInfo.pageDict, {
        replace: {
          '/Annots': `[ ${[...getAnnotRefs(pageInfo.pageDict), ...pageWidgetRefs].join(' ')} ]`,
        },
      }),
    });
  }

  // Handle AcroForm
  let acroFormObjNum: number;

  if (structure.acroFormRef) {
    acroFormObjNum = getObjectNumberFromRef(structure.acroFormRef);
  } else {
    // AcroForm is inline or doesn't exist - create a new object
    acroFormObjNum = nextObj++;
  }

  const existingFieldRefs = structure.acroFormDict ? getFieldRefs(structure.acroFormDict) : [];
  const allFieldRefs = [...existingFieldRefs, ...acroFormFieldObjNums.map((n) => `${n} 0 R`)];
  const fieldsStr = `[ ${allFieldRefs.join(' ')} ]`;

  const acroFormContent = buildModifiedDict(structure.acroFormDict, {
    replace: {
      '/Fields': fieldsStr,
      '/SigFlags': '3',
    },
  });

  objects.push({ objectNumber: acroFormObjNum, content: acroFormContent });

  // If AcroForm was inline or new, update the catalog to reference the new AcroForm object
  if (!structure.acroFormRef) {
    const rootObjNum = getObjectNumberFromRef(structure.rootRef);
    const modifiedCatalogContent = buildModifiedDict(structure.catalogDict, {
      replace: { '/AcroForm': `${acroFormObjNum} 0 R` },
    });

    objects.push({ objectNumber: rootObjNum, content: modifiedCatalogContent });
  }

  const totalObjectCount = nextObj;

  const incrementalSection = buildIncrementalUpdate({
    originalPdfLength: pdf.length,
    prevStartXref,
    rootRef: structure.rootRef.toString(),
    objects,
    totalObjectCount,
    infoRef: structure.infoRef,
    idArray: structure.idArray,
  });

  return Buffer.concat([pdf, incrementalSection]);
};

/**
 * Build a modified PDF dictionary string from an existing dict (or create a new one).
 * Keys listed in `replace` are substituted with the given values.
 * All other keys are preserved from the original dict.
 */
const buildModifiedDict = (
  existingDict: PDFDict | null,
  options: { replace: Record<string, string> },
): string => {
  const { replace } = options;
  const entries: string[] = ['<<'];

  if (existingDict) {
    for (const [key, value] of existingDict.entries()) {
      const keyStr = key.toString();

      if (keyStr in replace) {
        continue; // Will be added below
      }

      entries.push(`${keyStr} ${value.toString()}`);
    }
  }

  for (const [key, value] of Object.entries(replace)) {
    entries.push(`${key} ${value}`);
  }

  entries.push('>>');

  return entries.join('\n');
};

/**
 * Format a Date as a PDF date string: D:YYYYMMDDHHmmssZ
 */
const formatPdfDate = (date: Date): string => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');

  return `D:${y}${m}${d}${h}${min}${s}Z`;
};
