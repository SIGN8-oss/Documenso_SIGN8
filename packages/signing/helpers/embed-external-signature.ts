import type { SignatureLevel } from '@prisma/client';

/**
 * Information about an external QES signature from Sign8
 */
export type ExternalSignatureInfo = {
  recipientId: number;
  recipientName: string;
  recipientEmail: string;
  signatureLevel: SignatureLevel;
  sign8SignatureData: string; // Base64 encoded PKCS#7/CMS signature
  signedAt: Date;
};

/**
 * Extract Sign8 signature information from recipients and their signatures.
 * This handles QES and AES signature levels that go through Sign8.
 * Used for audit logging and certificate generation.
 *
 * Note: Full PDF multi-signature embedding would require significant PDF
 * structure modifications. For the initial implementation, we store the
 * Sign8 signatures in the database and include them in the audit trail.
 * The final document is sealed with the organization's certificate.
 */
export const extractQESSignatures = (
  recipients: Array<{
    id: number;
    name: string;
    email: string;
    signatureLevel: SignatureLevel;
    signedAt?: Date | null;
    fields?: Array<{
      signature?: {
        signatureLevel?: SignatureLevel | null;
        sign8SignatureData?: string | null;
        created: Date;
      } | null;
    }>;
  }>,
): ExternalSignatureInfo[] => {
  const sign8Signatures: ExternalSignatureInfo[] = [];

  const sign8Levels: SignatureLevel[] = ['QES', 'AES'];

  for (const recipient of recipients) {
    // Check if recipient has a Sign8 signature level (QES or AES)
    if (!sign8Levels.includes(recipient.signatureLevel)) {
      continue;
    }

    // Find signature with Sign8 data for the recipient's signature level
    const sign8Field = recipient.fields?.find(
      (field) =>
        field.signature?.signatureLevel &&
        sign8Levels.includes(field.signature.signatureLevel) &&
        field.signature?.sign8SignatureData,
    );

    if (sign8Field?.signature?.sign8SignatureData) {
      sign8Signatures.push({
        recipientId: recipient.id,
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        signatureLevel: recipient.signatureLevel,
        sign8SignatureData: sign8Field.signature.sign8SignatureData,
        signedAt: sign8Field.signature.created,
      });
    }
  }

  return sign8Signatures;
};

/**
 * Format Sign8 signature information for audit log purposes
 */
export const formatQESSignaturesForAuditLog = (signatures: ExternalSignatureInfo[]): string[] => {
  return signatures.map(
    (sig) =>
      `${sig.signatureLevel} Signature by ${sig.recipientName} (${sig.recipientEmail}) at ${sig.signedAt.toISOString()}`,
  );
};
