import {
  PDFDocument,
  RotationTypes,
  popGraphicsState,
  pushGraphicsState,
  radiansToDegrees,
  rotateDegrees,
  translate,
} from '@cantoo/pdf-lib';
import { groupBy } from 'remeda';
import { match } from 'ts-pattern';

import type { FieldWithSignature } from '@documenso/prisma/types/field-with-signature';

import { getPageSize } from './get-page-size';
import { insertFieldInPDFV2 } from './insert-field-in-pdf-v2';

export type InsertFieldsIntoPdfOptions = {
  pdf: Buffer;
  fields: FieldWithSignature[];
};

/**
 * Insert field appearances into a PDF.
 * This is used for QES signing where fields need to be visually rendered
 * before the PDF is cryptographically signed.
 */
export const insertFieldsIntoPdf = async ({
  pdf,
  fields,
}: InsertFieldsIntoPdfOptions): Promise<Buffer> => {
  if (fields.length === 0) {
    return pdf;
  }

  const pdfDoc = await PDFDocument.load(pdf);

  // Group fields by page
  const fieldsGroupedByPage = groupBy(fields, (field) => field.page);

  for (const [pageNumber, pageFields] of Object.entries(fieldsGroupedByPage)) {
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
    // degrees.
    if (pageRotationInDegrees === 90 || pageRotationInDegrees === 270) {
      [pageWidth, pageHeight] = [pageHeight, pageWidth];
    }

    // Rotate the page to the orientation that the react-pdf renders on the frontend.
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
      fields: pageFields,
    });

    const [embeddedPage] = await pdfDoc.embedPdf(renderedPdfOverlay);

    // Draw the overlay on the page
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

  const pdfBytes = await pdfDoc.save();

  return Buffer.from(pdfBytes);
};
