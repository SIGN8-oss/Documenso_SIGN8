import { PDFDocument } from '@cantoo/pdf-lib';
import { Prisma } from '@prisma/client';

import type { FieldWithSignature } from '@documenso/prisma/types/field-with-signature';
import {
  type FieldAppearance,
  addFieldAppearancesIncremental,
} from '@documenso/signing/helpers/add-field-appearances-incremental';

import { renderFieldsToImage } from './render-fields-to-image';

/**
 * Render fields and add them as stamp annotations to a PDF using incremental updates.
 * Preserves any existing CMS/PKCS#7 signatures.
 *
 * Each field is rendered to RGBA pixel data via Konva, then embedded as a
 * /Stamp annotation with an /AP appearance stream. Page content streams are
 * not modified, so existing byte ranges remain valid.
 */
export const renderAndAddFieldsIncremental = async (
  pdf: Buffer,
  fields: FieldWithSignature[],
): Promise<Buffer> => {
  if (fields.length === 0) {
    return pdf;
  }

  // Load PDF read-only for page dimensions
  const pdfDoc = await PDFDocument.load(pdf);
  const appearances: FieldAppearance[] = [];
  const scale = 3; // Render at 3x PDF point dimensions for crisp appearance

  for (const field of fields) {
    const pageIndex = field.page - 1;

    if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) {
      continue;
    }

    const page = pdfDoc.getPage(pageIndex);
    const { width: pageWidth, height: pageHeight } = page.getSize();

    const widthPercent = Number(field.width);
    const heightPercent = Number(field.height);

    if (widthPercent <= 0 || heightPercent <= 0) {
      continue;
    }

    const fieldWidth = (widthPercent / 100) * pageWidth;
    const fieldHeight = (heightPercent / 100) * pageHeight;
    const fieldX = (Number(field.positionX) / 100) * pageWidth;
    const fieldY = pageHeight - (Number(field.positionY) / 100) * pageHeight - fieldHeight;

    const renderW = Math.round(fieldWidth * scale);
    const renderH = Math.round(fieldHeight * scale);

    if (renderW <= 0 || renderH <= 0) {
      continue;
    }

    // Render the field to RGBA at 3x scale (field fills entire render canvas)
    const imageData = await renderFieldsToImage({
      pageWidth: renderW,
      pageHeight: renderH,
      fields: [
        {
          ...field,
          positionX: new Prisma.Decimal(0),
          positionY: new Prisma.Decimal(0),
          width: new Prisma.Decimal(100),
          height: new Prisma.Decimal(100),
        },
      ],
    });

    if (imageData) {
      appearances.push({
        page: field.page,
        x: fieldX,
        y: fieldY,
        width: fieldWidth,
        height: fieldHeight,
        imageRgba: imageData.rgba,
        imageWidth: imageData.width,
        imageHeight: imageData.height,
      });
    }
  }

  if (appearances.length === 0) {
    return pdf;
  }

  return addFieldAppearancesIncremental({ pdf, appearances });
};
