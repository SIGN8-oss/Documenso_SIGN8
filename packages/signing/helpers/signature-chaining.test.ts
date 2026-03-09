import { describe, expect, it } from 'vitest';

import { addFieldAppearancesIncremental } from './add-field-appearances-incremental';
import { addSigningPlaceholder } from './add-signing-placeholder';
import { addSigningPlaceholderIncremental } from './add-signing-placeholder-incremental';
import { embedSignatureInPdf } from './embed-signature-in-pdf';
import { updateSigningPlaceholder } from './update-signing-placeholder';

/**
 * Create a minimal valid PDF that pdf-lib can parse.
 */
const createMinimalPdf = (): Buffer => {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj',
  ];

  const offsets: number[] = [];
  let body = '%PDF-1.4\n';

  for (const obj of objects) {
    offsets.push(body.length);
    body += obj + '\n';
  }

  const xrefOffset = body.length;

  body += 'xref\n';
  body += '0 4\n';
  body += '0000000000 65535 f \r\n';

  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \r\n`;
  }

  body += 'trailer\n';
  body += '<< /Size 4 /Root 1 0 R >>\n';
  body += 'startxref\n';
  body += `${xrefOffset}\n`;
  body += '%%EOF\n';

  return Buffer.from(body, 'latin1');
};

/**
 * Create a fake CMS signature (just random bytes, not cryptographically valid).
 */
const createFakeCmsSignature = (size = 256): Buffer => {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    buf[i] = Math.floor(Math.random() * 256);
  }
  return buf;
};

describe('Signature chaining', () => {
  describe('Two-signature chaining', () => {
    it('should create valid dual-signature PDF with correct xref chain', async () => {
      const originalPdf = createMinimalPdf();

      // First signature: standard (full rewrite)
      const firstPdfWithPlaceholder = await addSigningPlaceholder({ pdf: originalPdf });
      const { pdf: firstPrepared, byteRange: firstByteRange } = updateSigningPlaceholder({
        pdf: firstPdfWithPlaceholder,
      });
      const firstCms = createFakeCmsSignature();
      const firstSigned = embedSignatureInPdf({
        pdf: firstPrepared,
        signature: firstCms,
        byteRange: firstByteRange,
      });

      // Second signature: incremental (preserves first)
      const secondPdfWithPlaceholder = await addSigningPlaceholderIncremental({
        pdf: firstSigned,
      });
      const { pdf: secondPrepared, byteRange: secondByteRange } = updateSigningPlaceholder({
        pdf: secondPdfWithPlaceholder,
      });
      const secondCms = createFakeCmsSignature();
      const dualSigned = embedSignatureInPdf({
        pdf: secondPrepared,
        signature: secondCms,
        byteRange: secondByteRange,
      });

      // Should contain TWO /Type /Sig entries
      const fullText = dualSigned.toString('latin1');
      const sigMatches = fullText.match(/\/Type \/Sig\b/g);
      expect(sigMatches).not.toBeNull();
      expect(sigMatches!.length).toBe(2);

      // Both ByteRanges should be valid (start at 0)
      expect(firstByteRange[0]).toBe(0);
      expect(secondByteRange[0]).toBe(0);

      // Second ByteRange should reference positions beyond the first signed PDF
      expect(secondByteRange[1]).toBeGreaterThan(firstSigned.length);

      // Should have two %%EOF markers (original + incremental)
      const eofMatches = fullText.match(/%%EOF/g);
      expect(eofMatches).not.toBeNull();
      expect(eofMatches!.length).toBeGreaterThanOrEqual(2);

      // xref chain: should have at least two xref sections
      const xrefMatches = fullText.match(/^xref$/gm);
      expect(xrefMatches).not.toBeNull();
      expect(xrefMatches!.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Byte preservation invariant', () => {
    it('should preserve original PDF bytes as exact prefix after incremental update', async () => {
      const originalPdf = createMinimalPdf();

      // First: standard placeholder + fake signature
      const firstPdfWithPlaceholder = await addSigningPlaceholder({ pdf: originalPdf });
      const { pdf: firstPrepared, byteRange: firstByteRange } = updateSigningPlaceholder({
        pdf: firstPdfWithPlaceholder,
      });
      const firstSigned = embedSignatureInPdf({
        pdf: firstPrepared,
        signature: createFakeCmsSignature(),
        byteRange: firstByteRange,
      });

      // Second: incremental
      const secondPdfWithPlaceholder = await addSigningPlaceholderIncremental({
        pdf: firstSigned,
      });

      // Verify: first N bytes of result exactly match firstSigned
      const prefix = secondPdfWithPlaceholder.subarray(0, firstSigned.length);
      expect(Buffer.compare(prefix, firstSigned)).toBe(0);
    });

    it('should preserve bytes after embedding CMS signature', async () => {
      const originalPdf = createMinimalPdf();
      const pdfWithPlaceholder = await addSigningPlaceholderIncremental({ pdf: originalPdf });
      const { pdf: prepared, byteRange } = updateSigningPlaceholder({ pdf: pdfWithPlaceholder });

      // The first N bytes of prepared should match original
      const prefix = prepared.subarray(0, originalPdf.length);
      expect(Buffer.compare(prefix, originalPdf)).toBe(0);

      // Embedding CMS should not change file length
      const signed = embedSignatureInPdf({
        pdf: prepared,
        signature: createFakeCmsSignature(),
        byteRange,
      });
      expect(signed.length).toBe(prepared.length);
    });
  });

  describe('embedSignatureInPdf', () => {
    it('should place CMS hex at correct offset', async () => {
      const originalPdf = createMinimalPdf();
      const pdfWithPlaceholder = await addSigningPlaceholderIncremental({ pdf: originalPdf });
      const { pdf: prepared, byteRange } = updateSigningPlaceholder({ pdf: pdfWithPlaceholder });

      const fakeCms = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
      const signed = embedSignatureInPdf({ pdf: prepared, signature: fakeCms, byteRange });

      // The signature should appear at byteRange[1] position
      const sigContent = signed.subarray(byteRange[1], byteRange[2]).toString('latin1');
      expect(sigContent.startsWith('<deadbeef')).toBe(true);
      expect(sigContent.endsWith('>')).toBe(true);

      // File length should not change
      expect(signed.length).toBe(prepared.length);
    });

    it('should throw if signature is too large for placeholder', async () => {
      const originalPdf = createMinimalPdf();
      const pdfWithPlaceholder = await addSigningPlaceholderIncremental({ pdf: originalPdf });
      const { pdf: prepared, byteRange } = updateSigningPlaceholder({ pdf: pdfWithPlaceholder });

      // Create a signature larger than the placeholder (24576 hex chars = 12288 bytes)
      const oversizedCms = Buffer.alloc(13000);
      expect(() =>
        embedSignatureInPdf({ pdf: prepared, signature: oversizedCms, byteRange }),
      ).toThrow('Signature too large');
    });
  });

  describe('Appearance streams', () => {
    it('should include /AP with Form/Image XObjects when appearance provided', async () => {
      const originalPdf = createMinimalPdf();

      // Create a small 2x2 RGBA test image (red pixels with full opacity)
      const testImage = Buffer.alloc(2 * 2 * 4);
      for (let i = 0; i < 4; i++) {
        testImage[i * 4] = 255; // R
        testImage[i * 4 + 1] = 0; // G
        testImage[i * 4 + 2] = 0; // B
        testImage[i * 4 + 3] = 255; // A
      }

      const result = await addSigningPlaceholderIncremental({
        pdf: originalPdf,
        signatureFields: [{ page: 1, x: 100, y: 100, width: 200, height: 50 }],
        appearance: {
          imageRgba: testImage,
          imageWidth: 2,
          imageHeight: 2,
        },
      });

      const appendedSection = result.subarray(originalPdf.length).toString('latin1');

      // Should contain appearance reference on the widget
      expect(appendedSection).toContain('/AP <<');

      // Should contain Image XObject
      expect(appendedSection).toContain('/Subtype /Image');
      expect(appendedSection).toContain('/ColorSpace /DeviceRGB');
      expect(appendedSection).toContain('/Width 2');
      expect(appendedSection).toContain('/Height 2');

      // Should contain Form XObject (appearance stream)
      expect(appendedSection).toContain('/Subtype /Form');
      expect(appendedSection).toContain('/BBox [ 0 0 200 50 ]');
      expect(appendedSection).toContain('/Img Do');
    });

    it('should support multiple appearances for multiple signature fields', async () => {
      const originalPdf = createMinimalPdf();

      const testImage = Buffer.alloc(2 * 2 * 4, 255); // White 2x2

      const result = await addSigningPlaceholderIncremental({
        pdf: originalPdf,
        signatureFields: [
          { page: 1, x: 100, y: 700, width: 200, height: 50 },
          { page: 1, x: 100, y: 600, width: 200, height: 50 },
        ],
        appearances: [
          { imageRgba: testImage, imageWidth: 2, imageHeight: 2 },
          { imageRgba: testImage, imageWidth: 2, imageHeight: 2 },
        ],
      });

      const appendedSection = result.subarray(originalPdf.length).toString('latin1');

      // With parent-kids: only ONE /FT /Sig (on the parent, not on widgets)
      const ftMatches = appendedSection.match(/\/FT \/Sig/g);
      expect(ftMatches).not.toBeNull();
      expect(ftMatches!.length).toBe(1);

      // Should contain two /AP appearance entries (one per widget)
      const apMatches = appendedSection.match(/\/AP <</g);
      expect(apMatches).not.toBeNull();
      expect(apMatches!.length).toBe(2);

      // Parent should have /Kids array
      expect(appendedSection).toContain('/Kids [');

      // Widgets should have /Parent reference (exclude page's /Parent which refs Pages obj)
      // Count widgets that have /Parent by looking at /Subtype /Widget blocks
      const widgetBlocks = appendedSection.split(/\d+ 0 obj/).filter((b) => b.includes('/Subtype /Widget'));
      const widgetsWithParent = widgetBlocks.filter((b) => b.includes('/Parent'));
      expect(widgetsWithParent.length).toBe(2);

      // Only ONE /Type /Sig (the signature dictionary is shared)
      const sigMatches = appendedSection.match(/\/Type \/Sig\b/g);
      expect(sigMatches).not.toBeNull();
      expect(sigMatches!.length).toBe(1);
    });

    it('should include SMask for transparent images', async () => {
      const originalPdf = createMinimalPdf();

      // Create 2x2 RGBA with semi-transparent pixels
      const testImage = Buffer.alloc(2 * 2 * 4);
      for (let i = 0; i < 4; i++) {
        testImage[i * 4] = 0;
        testImage[i * 4 + 1] = 0;
        testImage[i * 4 + 2] = 0;
        testImage[i * 4 + 3] = 128; // Semi-transparent
      }

      const result = await addSigningPlaceholderIncremental({
        pdf: originalPdf,
        signatureFields: [{ page: 1, x: 0, y: 0, width: 100, height: 50 }],
        appearance: {
          imageRgba: testImage,
          imageWidth: 2,
          imageHeight: 2,
        },
      });

      const appendedSection = result.subarray(originalPdf.length).toString('latin1');

      // Should include SMask reference
      expect(appendedSection).toContain('/SMask');
      expect(appendedSection).toContain('/ColorSpace /DeviceGray');
    });
  });

  describe('Parent-kids structure for multi-widget signatures', () => {
    it('should use parent-kids structure with 2+ positions, producing 1 /FT /Sig', async () => {
      const originalPdf = createMinimalPdf();

      const result = await addSigningPlaceholderIncremental({
        pdf: originalPdf,
        signatureFields: [
          { page: 1, x: 100, y: 700, width: 200, height: 50 },
          { page: 1, x: 100, y: 600, width: 200, height: 50 },
        ],
      });

      const appended = result.subarray(originalPdf.length).toString('latin1');

      // Only 1 /FT /Sig (on parent field, not on widgets)
      const ftMatches = appended.match(/\/FT \/Sig/g);
      expect(ftMatches).not.toBeNull();
      expect(ftMatches!.length).toBe(1);

      // Parent has /Kids array
      expect(appended).toContain('/Kids [');

      // Each widget has /Parent reference (check within widget blocks, not page /Parent)
      const widgetBlocks = appended.split(/\d+ 0 obj/).filter((b) => b.includes('/Subtype /Widget'));
      expect(widgetBlocks.length).toBe(2);
      for (const block of widgetBlocks) {
        expect(block).toContain('/Parent');
        // Widgets should NOT have /FT, /V, or /T
        expect(block).not.toContain('/FT /Sig');
        expect(block).not.toContain('/V ');
        expect(block).not.toMatch(/\/T \(/);
      }
    });

    it('should use combined widget-field for single position (no parent)', async () => {
      const originalPdf = createMinimalPdf();

      const result = await addSigningPlaceholderIncremental({
        pdf: originalPdf,
        signatureFields: [{ page: 1, x: 100, y: 700, width: 200, height: 50 }],
      });

      const appended = result.subarray(originalPdf.length).toString('latin1');

      // Single widget has /FT /Sig directly
      expect(appended).toContain('/FT /Sig');

      // No parent-kids structure
      expect(appended).not.toContain('/Kids [');
      // Widget should not have /Parent (page /Parent is fine)
      const widgetBlocks = appended.split(/\d+ 0 obj/).filter((b) => b.includes('/Subtype /Widget'));
      expect(widgetBlocks.length).toBe(1);
      expect(widgetBlocks[0]).not.toContain('/Parent');
    });
  });

  describe('addFieldAppearancesIncremental', () => {
    it('should add stamp annotations without modifying page content', async () => {
      const originalPdf = createMinimalPdf();

      // Create a small test image
      const testImage = Buffer.alloc(4 * 4 * 4, 200); // 4x4 gray

      const result = await addFieldAppearancesIncremental({
        pdf: originalPdf,
        appearances: [
          {
            page: 1,
            x: 50,
            y: 50,
            width: 150,
            height: 40,
            imageRgba: testImage,
            imageWidth: 4,
            imageHeight: 4,
          },
        ],
      });

      // Original bytes preserved
      const prefix = result.subarray(0, originalPdf.length);
      expect(Buffer.compare(prefix, originalPdf)).toBe(0);

      const appended = result.subarray(originalPdf.length).toString('latin1');

      // Should contain stamp annotation (not /Widget)
      expect(appended).toContain('/Subtype /Stamp');
      expect(appended).not.toContain('/Subtype /Widget');

      // Should have appearance stream
      expect(appended).toContain('/AP <<');
      expect(appended).toContain('/Subtype /Form');
      expect(appended).toContain('/Img Do');

      // Should NOT modify page /Contents (which would invalidate CMS)
      expect(appended).not.toContain('/Contents');
    });

    it('should return pdf unchanged when appearances array is empty', async () => {
      const originalPdf = createMinimalPdf();
      const result = await addFieldAppearancesIncremental({
        pdf: originalPdf,
        appearances: [],
      });

      expect(Buffer.compare(result, originalPdf)).toBe(0);
    });

    it('should handle multiple appearances on the same page', async () => {
      const originalPdf = createMinimalPdf();
      const testImage = Buffer.alloc(2 * 2 * 4, 128);

      const result = await addFieldAppearancesIncremental({
        pdf: originalPdf,
        appearances: [
          {
            page: 1, x: 10, y: 700, width: 100, height: 30,
            imageRgba: testImage, imageWidth: 2, imageHeight: 2,
          },
          {
            page: 1, x: 10, y: 650, width: 100, height: 30,
            imageRgba: testImage, imageWidth: 2, imageHeight: 2,
          },
          {
            page: 1, x: 10, y: 600, width: 100, height: 30,
            imageRgba: testImage, imageWidth: 2, imageHeight: 2,
          },
        ],
      });

      const appended = result.subarray(originalPdf.length).toString('latin1');

      // Should have three stamp annotations
      const stampMatches = appended.match(/\/Subtype \/Stamp/g);
      expect(stampMatches).not.toBeNull();
      expect(stampMatches!.length).toBe(3);
    });
  });
});
