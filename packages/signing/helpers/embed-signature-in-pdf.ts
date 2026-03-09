export type EmbedSignatureInPdfOptions = {
  pdf: Buffer;
  signature: Buffer; // CMS/PKCS#7 DER-encoded signature
  byteRange: number[]; // [offset1, length1, offset2, length2]
};

/**
 * Embed a CMS/PKCS#7 signature into a PDF at the placeholder position.
 *
 * The PDF must have been prepared with a signature placeholder using
 * addSigningPlaceholder() and updateSigningPlaceholder().
 *
 * The ByteRange indicates where the signature should be embedded:
 * - byteRange[0]: Start offset of first range (always 0)
 * - byteRange[1]: Length of first range (position before signature placeholder)
 * - byteRange[2]: Start offset of second range (position after signature placeholder)
 * - byteRange[3]: Length of second range (remaining bytes to end of file)
 *
 * The signature is inserted as a hex-encoded string between the two ranges,
 * padded with zeros to fill the placeholder space.
 */
export const embedSignatureInPdf = (options: EmbedSignatureInPdfOptions): Buffer => {
  const { pdf, signature, byteRange } = options;

  // Convert signature to hex string
  const signatureHex = signature.toString('hex');

  // Calculate the available space for the signature
  // The placeholder spans from byteRange[1] to byteRange[2]
  // Format: <hex_signature_padded_with_zeros>
  // So available hex chars = (byteRange[2] - byteRange[1]) - 2 (for < and >)
  const placeholderLength = byteRange[2] - byteRange[1];
  const availableHexChars = placeholderLength - 2; // Subtract 2 for < and >

  if (signatureHex.length > availableHexChars) {
    throw new Error(
      `Signature too large for placeholder: ${signatureHex.length} hex chars > ${availableHexChars} available`,
    );
  }

  // Pad the signature hex with zeros to fill the placeholder
  const paddedSignatureHex = signatureHex.padEnd(availableHexChars, '0');

  // Create the signature content with angle brackets
  const signatureContent = `<${paddedSignatureHex}>`;

  // Verify the signature content length matches the placeholder
  if (signatureContent.length !== placeholderLength) {
    throw new Error(
      `Signature content length mismatch: ${signatureContent.length} != ${placeholderLength}`,
    );
  }

  // Build the signed PDF by replacing the placeholder with the actual signature
  // Structure: [first range] [signature] [second range]
  return Buffer.concat([
    pdf.subarray(0, byteRange[1]), // First range (up to placeholder)
    Buffer.from(signatureContent), // Hex-encoded signature
    pdf.subarray(byteRange[2]), // Second range (after placeholder)
  ]);
};
