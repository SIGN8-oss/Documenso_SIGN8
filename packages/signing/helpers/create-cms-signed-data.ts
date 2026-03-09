import forge from 'node-forge';

import { sign8Logger } from '@documenso/lib/server-only/sign8/sign8-logger';

// Common signature algorithm OIDs
const SIGNATURE_ALGORITHM_OIDS: Record<string, string> = {
  // RSA algorithms
  '1.2.840.113549.1.1.1': '1.2.840.113549.1.1.1', // rsaEncryption
  '1.2.840.113549.1.1.11': '1.2.840.113549.1.1.11', // sha256WithRSAEncryption
  '1.2.840.113549.1.1.12': '1.2.840.113549.1.1.12', // sha384WithRSAEncryption
  '1.2.840.113549.1.1.13': '1.2.840.113549.1.1.13', // sha512WithRSAEncryption
  // ECDSA algorithms
  '1.2.840.10045.2.1': '1.2.840.10045.4.3.2', // ecPublicKey -> map to ecdsa-with-SHA256
  '1.2.840.10045.4.3.2': '1.2.840.10045.4.3.2', // ecdsa-with-SHA256
  '1.2.840.10045.4.3.3': '1.2.840.10045.4.3.3', // ecdsa-with-SHA384
  '1.2.840.10045.4.3.4': '1.2.840.10045.4.3.4', // ecdsa-with-SHA512
};

// Check if an OID represents an ECDSA algorithm
const isECDSA = (oid: string): boolean => {
  return oid.startsWith('1.2.840.10045');
};

/**
 * Create a CMS/PKCS#7 SignedData structure for PDF signing
 * This creates a detached signature compatible with PDF digital signatures
 *
 * @param content - The ByteRange content that was signed (PDF minus signature placeholder)
 * @param signature - The raw RSA/ECDSA signature value
 * @param certificates - Certificate chain (Base64 encoded DER)
 * @param signingTime - When the signature was created
 * @param signatureAlgorithmOID - Optional signature algorithm OID (defaults to RSA)
 * @param precomputedDigest - Optional pre-computed message digest (Base64). Use when rebuilding CMS
 *                            with an already-signed signature to avoid hash mismatch.
 */
export const createCMSSignedData = (options: {
  content: Buffer;
  signature: Buffer;
  certificates: string[];
  signingTime: Date;
  signatureAlgorithmOID?: string;
  precomputedDigest?: string;
}): Buffer => {
  const {
    content,
    signature,
    certificates,
    signingTime,
    signatureAlgorithmOID,
    precomputedDigest,
  } = options;

  // Parse all certificates
  const parsedCerts: forge.pki.Certificate[] = [];
  for (const certBase64 of certificates) {
    try {
      const certDer = forge.util.decode64(certBase64);
      const certAsn1 = forge.asn1.fromDer(certDer);
      parsedCerts.push(forge.pki.certificateFromAsn1(certAsn1));
    } catch (e) {
      sign8Logger.warn('Failed to parse certificate:', e);
    }
  }

  if (parsedCerts.length === 0) {
    throw new Error('No valid certificates provided for CMS signature');
  }

  const signingCert = parsedCerts[0];

  // Get or compute message digest
  // When rebuilding CMS with pre-signed signature, use the pre-computed digest
  // to avoid hash mismatch (the signature was computed over this exact digest)
  let messageDigest: string;
  if (precomputedDigest) {
    // Decode Base64 digest to binary string
    messageDigest = forge.util.decode64(precomputedDigest);
    sign8Logger.debug('Using pre-computed message digest for CMS rebuild');
  } else {
    // Compute fresh digest from content
    const md = forge.md.sha256.create();
    md.update(content.toString('binary'));
    messageDigest = md.digest().bytes();
  }

  // Determine signature algorithm OID
  const sigAlgoOID = signatureAlgorithmOID
    ? SIGNATURE_ALGORITHM_OIDS[signatureAlgorithmOID] || signatureAlgorithmOID
    : forge.pki.oids.rsaEncryption;

  const isECDSASignature = isECDSA(sigAlgoOID);
  sign8Logger.debug('CMS signature algorithm:', sigAlgoOID, isECDSASignature ? '(ECDSA)' : '(RSA)');

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
    // Signature Algorithm (RSA or ECDSA based on key type)
    forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.SEQUENCE,
      true,
      isECDSASignature
        ? [
            // ECDSA algorithms don't include NULL parameter
            forge.asn1.create(
              forge.asn1.Class.UNIVERSAL,
              forge.asn1.Type.OID,
              false,
              forge.asn1.oidToDer(sigAlgoOID).getBytes(),
            ),
          ]
        : [
            // RSA algorithms include NULL parameter
            forge.asn1.create(
              forge.asn1.Class.UNIVERSAL,
              forge.asn1.Type.OID,
              false,
              forge.asn1.oidToDer(sigAlgoOID).getBytes(),
            ),
            forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
          ],
    ),
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
 * Check if a CMS/PKCS#7 signature contains certificates
 */
export const cmsContainsCertificates = (cmsData: Buffer): boolean => {
  try {
    const asn1 = forge.asn1.fromDer(cmsData.toString('binary'));

    // Navigate to SignedData content
    if (asn1.value && Array.isArray(asn1.value) && asn1.value.length >= 2) {
      const signedDataWrapper = asn1.value[1];
      if (signedDataWrapper.value && Array.isArray(signedDataWrapper.value)) {
        const signedData = signedDataWrapper.value[0];
        if (signedData && signedData.value && Array.isArray(signedData.value)) {
          // Look for certificates [0] IMPLICIT (context-specific tag 0)
          for (const element of signedData.value) {
            if (element.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && element.type === 0) {
              // Found certificates section
              return Array.isArray(element.value) && element.value.length > 0;
            }
          }
        }
      }
    }
    return false;
  } catch {
    return false;
  }
};

/**
 * Extract the raw signature value from a CMS/PKCS#7 structure
 */
export const extractSignatureFromCMS = (cmsData: Buffer): Buffer | null => {
  try {
    const asn1 = forge.asn1.fromDer(cmsData.toString('binary'));

    // Navigate: ContentInfo -> SignedData -> SignerInfos -> SignerInfo -> signature
    if (asn1.value && Array.isArray(asn1.value) && asn1.value.length >= 2) {
      const signedDataWrapper = asn1.value[1];
      if (signedDataWrapper.value && Array.isArray(signedDataWrapper.value)) {
        const signedData = signedDataWrapper.value[0];
        if (signedData && signedData.value && Array.isArray(signedData.value)) {
          // Find SignerInfos (last element, SET)
          const signerInfos = signedData.value[signedData.value.length - 1];
          if (signerInfos && signerInfos.value && Array.isArray(signerInfos.value)) {
            const signerInfo = signerInfos.value[0];
            if (signerInfo && signerInfo.value && Array.isArray(signerInfo.value)) {
              // Signature is the last element in SignerInfo (OCTET STRING)
              const signatureElement = signerInfo.value[signerInfo.value.length - 1];
              if (
                signatureElement &&
                signatureElement.value &&
                typeof signatureElement.value === 'string'
              ) {
                return Buffer.from(signatureElement.value, 'binary');
              }
            }
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
};
