import forge from 'node-forge';
import crypto from 'node:crypto';

import { env } from '@documenso/lib/utils/env';

import { createSign8Client } from '../clients/sign8-csc';
import type { SignatureFieldPosition } from '../helpers/add-signing-placeholder';
import { addSigningPlaceholder } from '../helpers/add-signing-placeholder';
import { updateSigningPlaceholder } from '../helpers/update-signing-placeholder';

export type SignWithSign8CSCOptions = {
  pdf: Buffer;
  signatureFields?: SignatureFieldPosition[];
};

/**
 * Create a CMS/PKCS#7 SignedData structure for PDF signing
 * This creates a detached signature compatible with PDF digital signatures
 *
 * @param content - The ByteRange content that was signed (PDF minus signature placeholder)
 * @param signature - The raw RSA signature from Sign8
 * @param certificates - Certificate chain from Sign8 (Base64 encoded DER)
 * @param signingTime - When the signature was created
 */
export const createCMSSignedData = (options: {
  content: Buffer;
  signature: Buffer;
  certificates: string[];
  signingTime: Date;
}): Buffer => {
  const { content, signature, certificates, signingTime } = options;

  // Parse all certificates
  const parsedCerts: forge.pki.Certificate[] = [];
  for (const certBase64 of certificates) {
    try {
      const certDer = forge.util.decode64(certBase64);
      const certAsn1 = forge.asn1.fromDer(certDer);
      parsedCerts.push(forge.pki.certificateFromAsn1(certAsn1));
    } catch (e) {
      console.warn('Failed to parse certificate:', e);
    }
  }

  if (parsedCerts.length === 0) {
    throw new Error('No valid certificates provided');
  }

  const signingCert = parsedCerts[0];

  // Compute message digest
  const md = forge.md.sha256.create();
  md.update(content.toString('binary'));
  const messageDigest = md.digest().bytes();

  // Build signed attributes
  const signedAttrsAsn1 = forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
    // Content Type attribute
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.OID,
        false,
        forge.asn1.oidToDer(forge.pki.oids.contentType).getBytes(),
      ),
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
        forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.OID,
          false,
          forge.asn1.oidToDer(forge.pki.oids.data).getBytes(),
        ),
      ]),
    ]),
    // Signing Time attribute
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.OID,
        false,
        forge.asn1.oidToDer(forge.pki.oids.signingTime).getBytes(),
      ),
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
        forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.UTCTIME,
          false,
          forge.asn1.dateToUtcTime(signingTime),
        ),
      ]),
    ]),
    // Message Digest attribute
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.OID,
        false,
        forge.asn1.oidToDer(forge.pki.oids.messageDigest).getBytes(),
      ),
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
        forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.OCTETSTRING,
          false,
          messageDigest,
        ),
      ]),
    ]),
  ]);

  // Build certificate sequence
  const certSequence: forge.asn1.Asn1[] = parsedCerts.map((cert) =>
    forge.pki.certificateToAsn1(cert),
  );

  // Get issuer and serial number from signing certificate
  const issuerAsn1 = forge.pki.distinguishedNameToAsn1(signingCert.issuer);
  const serialNumber = signingCert.serialNumber;

  // Build SignerInfo
  const signerInfo = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    // Version
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, '\x01'),
    // IssuerAndSerialNumber
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      issuerAsn1,
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.INTEGER,
        false,
        forge.util.hexToBytes(serialNumber),
      ),
    ]),
    // DigestAlgorithm (SHA-256)
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.OID,
        false,
        forge.asn1.oidToDer(forge.pki.oids.sha256).getBytes(),
      ),
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
    ]),
    // Signed Attributes
    signedAttrsAsn1,
    // Signature Algorithm (RSA)
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.OID,
        false,
        forge.asn1.oidToDer(forge.pki.oids.rsaEncryption).getBytes(),
      ),
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
    ]),
    // Signature Value
    forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.OCTETSTRING,
      false,
      signature.toString('binary'),
    ),
  ]);

  // Build SignedData
  const signedData = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    // Version
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, '\x01'),
    // DigestAlgorithms
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
        forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.OID,
          false,
          forge.asn1.oidToDer(forge.pki.oids.sha256).getBytes(),
        ),
        forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
      ]),
    ]),
    // ContentInfo (encapContentInfo - empty for detached signature)
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.OID,
        false,
        forge.asn1.oidToDer(forge.pki.oids.data).getBytes(),
      ),
    ]),
    // Certificates [0] IMPLICIT
    forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, certSequence),
    // SignerInfos
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [signerInfo]),
  ]);

  // Wrap in ContentInfo
  const contentInfo = forge.asn1.create(
    forge.asn1.Class.UNIVERSAL,
    forge.asn1.Type.SEQUENCE,
    true,
    [
      // ContentType (signedData)
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.OID,
        false,
        forge.asn1.oidToDer(forge.pki.oids.signedData).getBytes(),
      ),
      // Content [0] EXPLICIT
      forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedData]),
    ],
  );

  const der = forge.asn1.toDer(contentInfo);
  return Buffer.from(der.getBytes(), 'binary');
};

/**
 * Sign a PDF document using Sign8 CSC API (Cloud Signature Consortium)
 *
 * This transport integrates with Sign8's remote signing service using the
 * CSC API v2 standard for qualified electronic signatures.
 *
 * Required environment variables:
 * - NEXT_PRIVATE_SIGNING_SIGN8_BASE_URL: Sign8 API base URL
 * - NEXT_PRIVATE_SIGNING_SIGN8_CLIENT_ID: OAuth2 client ID
 * - NEXT_PRIVATE_SIGNING_SIGN8_CLIENT_SECRET: OAuth2 client secret
 *
 * Optional environment variables:
 * - NEXT_PRIVATE_SIGNING_SIGN8_CREDENTIAL_ID: Specific credential to use
 * - NEXT_PRIVATE_SIGNING_SIGN8_PIN: PIN for credential authorization
 */
export const signWithSign8CSC = async ({
  pdf,
  signatureFields,
}: SignWithSign8CSCOptions): Promise<Buffer> => {
  // Validate required configuration
  const baseUrl = env('NEXT_PRIVATE_SIGNING_SIGN8_BASE_URL');
  const clientId = env('NEXT_PRIVATE_SIGNING_SIGN8_CLIENT_ID');
  const clientSecret = env('NEXT_PRIVATE_SIGNING_SIGN8_CLIENT_SECRET');

  if (!baseUrl) {
    throw new Error('Sign8 CSC signing failed: NEXT_PRIVATE_SIGNING_SIGN8_BASE_URL is required');
  }

  if (!clientId) {
    throw new Error('Sign8 CSC signing failed: NEXT_PRIVATE_SIGNING_SIGN8_CLIENT_ID is required');
  }

  if (!clientSecret) {
    throw new Error(
      'Sign8 CSC signing failed: NEXT_PRIVATE_SIGNING_SIGN8_CLIENT_SECRET is required',
    );
  }

  // Create Sign8 client
  const sign8Client = createSign8Client();

  // Prepare PDF with signing placeholder
  const { pdf: pdfWithPlaceholder, byteRange } = updateSigningPlaceholder({
    pdf: await addSigningPlaceholder({ pdf, signatureFields }),
  });

  // Extract content to be signed (excluding the signature placeholder)
  const pdfWithoutSignature = Buffer.concat([
    new Uint8Array(pdfWithPlaceholder.subarray(0, byteRange[1])),
    new Uint8Array(pdfWithPlaceholder.subarray(byteRange[2])),
  ]);

  const signatureLength = byteRange[2] - byteRange[1];

  // Get credential ID
  const credentialId = await sign8Client.getCredentialId();

  // Get credential info including certificate chain
  const credentialInfo = await sign8Client.getCredentialInfo(credentialId, {
    certificates: 'chain',
  });

  if (!credentialInfo.cert?.certificates || credentialInfo.cert.certificates.length === 0) {
    throw new Error('Sign8 CSC signing failed: No certificate available for credential');
  }

  // Compute hash of the content to be signed
  const hash = crypto.createHash('sha256');
  hash.update(pdfWithoutSignature);
  const hashBase64 = hash.digest('base64');

  // Authorize credential for signing
  const authResponse = await sign8Client.authorizeCredential({
    credentialID: credentialId,
    numSignatures: 1,
    hash: [hashBase64],
    PIN: env('NEXT_PRIVATE_SIGNING_SIGN8_PIN'),
  });

  // Sign the hash using Sign8 CSC API
  const signResponse = await sign8Client.signHash({
    credentialID: credentialId,
    SAD: authResponse.SAD,
    hashes: [hashBase64],
    hashAlgorithmOID: '2.16.840.1.101.3.4.2.1', // OID for SHA-256
  });

  if (!signResponse.signatures || signResponse.signatures.length === 0) {
    throw new Error('Sign8 CSC signing failed: No signature returned');
  }

  // Get the raw signature
  const rawSignature = Buffer.from(signResponse.signatures[0], 'base64');
  const signingTime = new Date();

  // Create CMS/PKCS#7 SignedData structure
  const cmsSignature = createCMSSignedData({
    content: pdfWithoutSignature,
    signature: rawSignature,
    certificates: credentialInfo.cert.certificates,
    signingTime,
  });

  const signatureAsHex = cmsSignature.toString('hex');

  // Embed signature into PDF
  const signedPdf = Buffer.concat([
    new Uint8Array(pdfWithPlaceholder.subarray(0, byteRange[1])),
    new Uint8Array(Buffer.from(`<${signatureAsHex.padEnd(signatureLength - 2, '0')}>`)),
    new Uint8Array(pdfWithPlaceholder.subarray(byteRange[2])),
  ]);

  return signedPdf;
};
