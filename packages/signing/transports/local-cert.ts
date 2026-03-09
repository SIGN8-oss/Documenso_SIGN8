import * as fs from 'node:fs';

import { getCertificateStatus } from '@documenso/lib/server-only/cert/cert-status';
import { env } from '@documenso/lib/utils/env';
import { signWithP12 } from '@documenso/pdf-sign';

import type { SignatureFieldPosition } from '../helpers/add-signing-placeholder';
import { addSigningPlaceholder } from '../helpers/add-signing-placeholder';
import { addSigningPlaceholderIncremental } from '../helpers/add-signing-placeholder-incremental';
import { updateSigningPlaceholder } from '../helpers/update-signing-placeholder';

export type SignWithLocalCertOptions = {
  pdf: Buffer;
  signatureFields?: SignatureFieldPosition[];
};

/**
 * Load the local P12 certificate for signing.
 */
const loadLocalCert = (): Buffer => {
  const certStatus = getCertificateStatus();

  if (!certStatus.isAvailable) {
    console.error('Certificate error: Certificate not available for document signing');
    throw new Error('Document signing failed: Certificate not available');
  }

  const localFileContents = env('NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS');

  if (localFileContents) {
    try {
      return Buffer.from(localFileContents, 'base64');
    } catch {
      throw new Error('Failed to decode certificate contents');
    }
  }

  let certPath = env('NEXT_PRIVATE_SIGNING_LOCAL_FILE_PATH') || '/opt/documenso/cert.p12';

  if (env('NODE_ENV') !== 'production') {
    certPath = env('NEXT_PRIVATE_SIGNING_LOCAL_FILE_PATH') || './example/cert.p12';
  }

  try {
    return Buffer.from(fs.readFileSync(certPath));
  } catch {
    console.error('Certificate error: Failed to read certificate file');
    throw new Error('Document signing failed: Certificate file not accessible');
  }
};

/**
 * Sign the prepared PDF (with placeholder and updated byte range) using the local cert.
 */
const signPdfWithCert = (pdfWithPlaceholder: Buffer, byteRange: number[]): Buffer => {
  const pdfWithoutSignature = Buffer.concat([
    new Uint8Array(pdfWithPlaceholder.subarray(0, byteRange[1])),
    new Uint8Array(pdfWithPlaceholder.subarray(byteRange[2])),
  ]);

  const signatureLength = byteRange[2] - byteRange[1];
  const cert = loadLocalCert();

  const signature = signWithP12({
    cert,
    content: pdfWithoutSignature,
    password: env('NEXT_PRIVATE_SIGNING_PASSPHRASE') || undefined,
  });

  const signatureAsHex = signature.toString('hex');

  return Buffer.concat([
    new Uint8Array(pdfWithPlaceholder.subarray(0, byteRange[1])),
    new Uint8Array(Buffer.from(`<${signatureAsHex.padEnd(signatureLength - 2, '0')}>`)),
    new Uint8Array(pdfWithPlaceholder.subarray(byteRange[2])),
  ]);
};

/**
 * Standard signing: rewrites the entire PDF (destroys existing signatures).
 */
export const signWithLocalCert = async ({ pdf, signatureFields }: SignWithLocalCertOptions) => {
  const pdfWithPlaceholder = await addSigningPlaceholder({ pdf, signatureFields });
  const { pdf: updatedPdf, byteRange } = updateSigningPlaceholder({ pdf: pdfWithPlaceholder });

  return signPdfWithCert(updatedPdf, byteRange);
};

/**
 * Incremental signing: appends signature without modifying existing PDF bytes.
 * Preserves any existing CMS/PKCS#7 signatures.
 */
export const signWithLocalCertIncremental = async ({
  pdf,
  signatureFields,
}: SignWithLocalCertOptions) => {
  const pdfWithPlaceholder = await addSigningPlaceholderIncremental({ pdf, signatureFields });
  const { pdf: updatedPdf, byteRange } = updateSigningPlaceholder({ pdf: pdfWithPlaceholder });

  return signPdfWithCert(updatedPdf, byteRange);
};
