import fs from 'node:fs';

import { env } from '@documenso/lib/utils/env';
import { signWithGCloud } from '@documenso/pdf-sign';

import type { SignatureFieldPosition } from '../helpers/add-signing-placeholder';
import { addSigningPlaceholder } from '../helpers/add-signing-placeholder';
import { addSigningPlaceholderIncremental } from '../helpers/add-signing-placeholder-incremental';
import { updateSigningPlaceholder } from '../helpers/update-signing-placeholder';

export type SignWithGoogleCloudHSMOptions = {
  pdf: Buffer;
  signatureFields?: SignatureFieldPosition[];
};

/**
 * Ensure GCloud credentials and key path are available. Returns the key path.
 */
const ensureGCloudCredentials = (): string => {
  const keyPath = env('NEXT_PRIVATE_SIGNING_GCLOUD_HSM_KEY_PATH');

  if (!keyPath) {
    throw new Error('No certificate path provided for Google Cloud HSM signing');
  }

  const googleApplicationCredentials = env('GOOGLE_APPLICATION_CREDENTIALS');
  const googleApplicationCredentialsContents = env(
    'NEXT_PRIVATE_SIGNING_GCLOUD_APPLICATION_CREDENTIALS_CONTENTS',
  );

  // To handle hosting in serverless environments like Vercel we can supply the base64 encoded
  // application credentials as an environment variable and write it to a file if it doesn't exist
  if (googleApplicationCredentials && googleApplicationCredentialsContents) {
    if (!fs.existsSync(googleApplicationCredentials)) {
      const contents = new Uint8Array(Buffer.from(googleApplicationCredentialsContents, 'base64'));

      fs.writeFileSync(googleApplicationCredentials, contents);
    }
  }

  return keyPath;
};

/**
 * Load the public certificate for GCloud HSM signing.
 */
const loadGCloudCert = (): Buffer => {
  const googleCloudHsmPublicCrtFileContents = env(
    'NEXT_PRIVATE_SIGNING_GCLOUD_HSM_PUBLIC_CRT_FILE_CONTENTS',
  );

  if (googleCloudHsmPublicCrtFileContents) {
    return Buffer.from(googleCloudHsmPublicCrtFileContents, 'base64');
  }

  return Buffer.from(
    fs.readFileSync(
      env('NEXT_PRIVATE_SIGNING_GCLOUD_HSM_PUBLIC_CRT_FILE_PATH') || './example/cert.crt',
    ),
  );
};

/**
 * Sign the prepared PDF (with placeholder and updated byte range) using GCloud HSM.
 */
const signPdfWithGCloudHSM = (
  pdfWithPlaceholder: Buffer,
  byteRange: number[],
  keyPath: string,
): Buffer => {
  const pdfWithoutSignature = Buffer.concat([
    new Uint8Array(pdfWithPlaceholder.subarray(0, byteRange[1])),
    new Uint8Array(pdfWithPlaceholder.subarray(byteRange[2])),
  ]);

  const signatureLength = byteRange[2] - byteRange[1];
  const cert = loadGCloudCert();

  const signature = signWithGCloud({
    keyPath,
    cert,
    content: pdfWithoutSignature,
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
export const signWithGoogleCloudHSM = async ({
  pdf,
  signatureFields,
}: SignWithGoogleCloudHSMOptions) => {
  const keyPath = ensureGCloudCredentials();

  const { pdf: pdfWithPlaceholder, byteRange } = updateSigningPlaceholder({
    pdf: await addSigningPlaceholder({ pdf, signatureFields }),
  });

  return signPdfWithGCloudHSM(pdfWithPlaceholder, byteRange, keyPath);
};

/**
 * Incremental signing: appends signature without modifying existing PDF bytes.
 * Preserves any existing CMS/PKCS#7 signatures.
 */
export const signWithGoogleCloudHSMIncremental = async ({
  pdf,
  signatureFields,
}: SignWithGoogleCloudHSMOptions) => {
  const keyPath = ensureGCloudCredentials();

  const { pdf: pdfWithPlaceholder, byteRange } = updateSigningPlaceholder({
    pdf: await addSigningPlaceholderIncremental({ pdf, signatureFields }),
  });

  return signPdfWithGCloudHSM(pdfWithPlaceholder, byteRange, keyPath);
};
