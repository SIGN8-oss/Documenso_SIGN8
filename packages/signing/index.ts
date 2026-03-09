import { match } from 'ts-pattern';

import { env } from '@documenso/lib/utils/env';

import {
  signWithGoogleCloudHSM,
  signWithGoogleCloudHSMIncremental,
} from './transports/google-cloud-hsm';
import { signWithLocalCert, signWithLocalCertIncremental } from './transports/local-cert';
import { signWithSign8CSC } from './transports/sign8-csc';

export type SignatureFieldPosition = {
  page: number; // 1-indexed page number
  x: number; // Position from left (in PDF points)
  y: number; // Position from bottom (in PDF points)
  width: number; // Width in PDF points
  height: number; // Height in PDF points
};

export type SignOptions = {
  pdf: Buffer;
  signatureFields?: SignatureFieldPosition[];
};

export const signPdf = async ({ pdf, signatureFields }: SignOptions) => {
  const transport = env('NEXT_PRIVATE_SIGNING_TRANSPORT') || 'local';

  return await match(transport)
    .with('local', async () => signWithLocalCert({ pdf, signatureFields }))
    .with('gcloud-hsm', async () => signWithGoogleCloudHSM({ pdf, signatureFields }))
    .with('sign8-csc', async () => signWithSign8CSC({ pdf, signatureFields }))
    .otherwise(() => {
      throw new Error(`Unsupported signing transport: ${transport}`);
    });
};

/**
 * Sign a PDF incrementally - preserves existing signatures.
 * Supports 'local' and 'gcloud-hsm' transports.
 */
export const signPdfIncremental = async ({ pdf, signatureFields }: SignOptions) => {
  const transport = env('NEXT_PRIVATE_SIGNING_TRANSPORT') || 'local';

  return await match(transport)
    .with('local', async () => signWithLocalCertIncremental({ pdf, signatureFields }))
    .with('gcloud-hsm', async () => signWithGoogleCloudHSMIncremental({ pdf, signatureFields }))
    .otherwise(() => {
      throw new Error(`Incremental signing not supported for transport: ${transport}`);
    });
};
