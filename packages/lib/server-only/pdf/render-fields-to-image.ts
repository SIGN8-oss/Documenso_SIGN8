// sort-imports-ignore
import '../konva/skia-backend';

import Konva from 'konva';
import path from 'node:path';
import sharp from 'sharp';
import type { Canvas } from 'skia-canvas';
import { FontLibrary } from 'skia-canvas';

import type { FieldWithSignature } from '@documenso/prisma/types/field-with-signature';

import { renderField } from '../../universal/field-renderer/render-field';

export type RenderFieldsToImageOptions = {
  pageWidth: number;
  pageHeight: number;
  fields: FieldWithSignature[];
};

export type RenderedImageData = {
  rgba: Buffer;
  width: number;
  height: number;
};

/**
 * Render fields to raw RGBA pixel data using the Konva/skia-canvas pipeline.
 * Same rendering as insertFieldInPDFV2 but returns pixel data instead of a PDF buffer.
 * Used for incremental image embedding that preserves existing CMS signatures.
 *
 * Uses canvas.toBuffer('png') + sharp for reliable RGBA extraction
 * (ctx.getImageData can return blank data in some skia-canvas/Konva scenarios).
 */
export const renderFieldsToImage = async ({
  pageWidth,
  pageHeight,
  fields,
}: RenderFieldsToImageOptions): Promise<RenderedImageData | null> => {
  if (fields.length === 0) {
    return null;
  }

  const fontPath = path.join(process.cwd(), 'public/fonts');

  // eslint-disable-next-line react-hooks/rules-of-hooks
  FontLibrary.use({
    ['Caveat']: [path.join(fontPath, 'caveat.ttf')],
    ['Noto Sans']: [path.join(fontPath, 'noto-sans.ttf')],
    ['Noto Sans Japanese']: [path.join(fontPath, 'noto-sans-japanese.ttf')],
    ['Noto Sans Chinese']: [path.join(fontPath, 'noto-sans-chinese.ttf')],
    ['Noto Sans Korean']: [path.join(fontPath, 'noto-sans-korean.ttf')],
  });

  const w = Math.round(pageWidth);
  const h = Math.round(pageHeight);

  let stage: Konva.Stage | null = new Konva.Stage({ width: w, height: h });
  let layer: Konva.Layer | null = new Konva.Layer();

  for (const field of fields) {
    renderField({
      scale: 1,
      field: {
        renderId: field.id.toString(),
        ...field,
        width: Number(field.width),
        height: Number(field.height),
        positionX: Number(field.positionX),
        positionY: Number(field.positionY),
      },
      translations: null,
      pageLayer: layer,
      pageWidth: w,
      pageHeight: h,
      mode: 'export',
    });
  }

  stage.add(layer);

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const canvas = layer.canvas._canvas as unknown as Canvas;

  // Use canvas.toBuffer('png') + sharp to extract RGBA pixel data.
  // This is more reliable than ctx.getImageData which can return blank data
  // in certain skia-canvas/Konva rendering scenarios.
  const pngBuffer = await canvas.toBuffer('png');
  const { data, info } = await sharp(pngBuffer)
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });

  const rgba = Buffer.from(data);

  stage.destroy();
  layer.destroy();

  stage = null;
  layer = null;

  return { rgba, width: info.width, height: info.height };
};
