import { describe, expect, it } from 'vitest';

import { addSigningPlaceholder } from './add-signing-placeholder';
import { addSigningPlaceholderIncremental } from './add-signing-placeholder-incremental';
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

describe('addSigningPlaceholderIncremental', () => {
  it('should preserve original PDF bytes as prefix', async () => {
    const originalPdf = createMinimalPdf();
    const result = await addSigningPlaceholderIncremental({ pdf: originalPdf });

    // The result should start with the exact original bytes
    const prefix = result.subarray(0, originalPdf.length);
    expect(Buffer.compare(prefix, originalPdf)).toBe(0);

    // The result should be longer than the original
    expect(result.length).toBeGreaterThan(originalPdf.length);
  });

  it('should produce a PDF where updateSigningPlaceholder can find the ByteRange', async () => {
    const originalPdf = createMinimalPdf();
    const result = await addSigningPlaceholderIncremental({ pdf: originalPdf });

    // updateSigningPlaceholder should work on the result
    const { pdf: updatedPdf, byteRange } = updateSigningPlaceholder({ pdf: result });

    expect(updatedPdf.length).toBe(result.length);
    expect(byteRange[0]).toBe(0);
    expect(byteRange[1]).toBeGreaterThan(0);
    expect(byteRange[2]).toBeGreaterThan(byteRange[1]);
    expect(byteRange[3]).toBeGreaterThan(0);
  });

  it('should contain signature dictionary and widget annotation', async () => {
    const originalPdf = createMinimalPdf();
    const result = await addSigningPlaceholderIncremental({ pdf: originalPdf });
    const appendedSection = result.subarray(originalPdf.length).toString('latin1');

    // Should contain signature dictionary
    expect(appendedSection).toContain('/Type /Sig');
    expect(appendedSection).toContain('/Filter /Adobe.PPKLite');
    expect(appendedSection).toContain('/SubFilter /adbe.pkcs7.detached');
    expect(appendedSection).toContain('/ByteRange');
    expect(appendedSection).toContain('/Contents');

    // Should contain widget annotation
    expect(appendedSection).toContain('/Type /Annot');
    expect(appendedSection).toContain('/Subtype /Widget');
    expect(appendedSection).toContain('/FT /Sig');

    // Should contain xref and trailer
    expect(appendedSection).toContain('xref');
    expect(appendedSection).toContain('trailer');
    expect(appendedSection).toContain('startxref');
    expect(appendedSection).toContain('%%EOF');
  });

  it('should work with addSigningPlaceholder output (dual signature)', async () => {
    const originalPdf = createMinimalPdf();

    // First signature: standard (full rewrite)
    const firstSignedPdf = await addSigningPlaceholder({ pdf: originalPdf });

    // Second signature: incremental (preserves first)
    const dualSignedPdf = await addSigningPlaceholderIncremental({ pdf: firstSignedPdf });

    // Should contain TWO /Type /Sig entries
    const fullText = dualSignedPdf.toString('latin1');
    const sigMatches = fullText.match(/\/Type \/Sig\b/g);
    expect(sigMatches).not.toBeNull();
    expect(sigMatches!.length).toBe(2);

    // Original first-signed PDF should be preserved as prefix
    const prefix = dualSignedPdf.subarray(0, firstSignedPdf.length);
    expect(Buffer.compare(prefix, firstSignedPdf)).toBe(0);

    // updateSigningPlaceholder should find the LAST ByteRange (the incremental one)
    const { byteRange } = updateSigningPlaceholder({ pdf: dualSignedPdf });
    expect(byteRange[0]).toBe(0);
    expect(byteRange[1]).toBeGreaterThan(firstSignedPdf.length);
  });
});
