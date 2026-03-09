import { describe, expect, it } from 'vitest';

import { buildIncrementalUpdate, findStartXref } from './incremental-pdf-utils';

describe('findStartXref', () => {
  it('should find startxref offset in a minimal PDF', () => {
    const pdf = Buffer.from(
      [
        '%PDF-1.4',
        '1 0 obj << /Type /Catalog >> endobj',
        'xref',
        '0 2',
        '0000000000 65535 f \r\n',
        '0000000009 00000 n \r\n',
        'trailer << /Size 2 /Root 1 0 R >>',
        'startxref',
        '44',
        '%%EOF',
      ].join('\n'),
    );

    const result = findStartXref(pdf);
    expect(result).toBe(44);
  });

  it('should find the last startxref when multiple exist', () => {
    const pdf = Buffer.from(
      [
        '%PDF-1.4',
        'startxref',
        '100',
        '%%EOF',
        '',
        'startxref',
        '200',
        '%%EOF',
      ].join('\n'),
    );

    const result = findStartXref(pdf);
    expect(result).toBe(200);
  });

  it('should throw if no startxref found', () => {
    const pdf = Buffer.from('not a pdf');
    expect(() => findStartXref(pdf)).toThrow('Could not find startxref');
  });
});

describe('buildIncrementalUpdate', () => {
  it('should produce valid xref entries of exactly 20 bytes', () => {
    const result = buildIncrementalUpdate({
      originalPdfLength: 1000,
      prevStartXref: 500,
      rootRef: '1 0 R',
      objects: [
        { objectNumber: 5, content: '<< /Type /Sig >>' },
        { objectNumber: 6, content: '<< /Type /Annot >>' },
      ],
      totalObjectCount: 7,
    });

    const text = result.toString('latin1');

    // Should contain xref keyword
    expect(text).toContain('xref');

    // Should contain trailer with /Prev
    expect(text).toContain('/Prev 500');

    // Should contain /Size 7
    expect(text).toContain('/Size 7');

    // Should end with %%EOF
    expect(text.trimEnd()).toMatch(/%%EOF$/);

    // Should contain /Root reference
    expect(text).toContain('/Root 1 0 R');

    // Verify xref entries are exactly 20 bytes
    const xrefStart = text.indexOf('xref\n');
    const trailerStart = text.indexOf('trailer\n');
    const xrefSection = text.substring(xrefStart + 'xref\n'.length, trailerStart);

    // Parse the subsection header
    const lines = xrefSection.split('\n').filter((l) => l.length > 0);

    // First line is subsection header "5 2"
    expect(lines[0]).toBe('5 2');

    // Next lines are xref entries - each must be exactly 20 bytes (SP+LF ending)
    for (let i = 1; i < lines.length; i++) {
      // After split by \n, each entry is 19 chars: "OOOOOOOOOO GGGGG n "
      expect(lines[i]).toMatch(/^\d{10} \d{5} n $/);
      // Verify exactly 19 chars (20 bytes minus the \n that was split off)
      expect(lines[i].length).toBe(19);
    }
  });

  it('should create separate subsections for non-consecutive objects', () => {
    const result = buildIncrementalUpdate({
      originalPdfLength: 1000,
      prevStartXref: 500,
      rootRef: '1 0 R',
      objects: [
        { objectNumber: 3, content: '<< /Test 1 >>' },
        { objectNumber: 7, content: '<< /Test 2 >>' },
      ],
      totalObjectCount: 8,
    });

    const text = result.toString('latin1');

    // Should have two subsection headers
    expect(text).toContain('3 1');
    expect(text).toContain('7 1');
  });

  it('should set startxref to the xref offset', () => {
    const result = buildIncrementalUpdate({
      originalPdfLength: 500,
      prevStartXref: 100,
      rootRef: '1 0 R',
      objects: [{ objectNumber: 3, content: '<< /Type /Sig >>' }],
      totalObjectCount: 4,
    });

    const text = result.toString('latin1');

    // Find the actual xref offset
    const xrefPos = 500 + text.indexOf('xref\n');

    // Find the startxref value
    const startxrefIdx = text.lastIndexOf('startxref\n');
    const afterStartxref = text.substring(startxrefIdx + 'startxref\n'.length);
    const parsedOffset = parseInt(afterStartxref.split('\n')[0], 10);

    expect(parsedOffset).toBe(xrefPos);
  });
});
