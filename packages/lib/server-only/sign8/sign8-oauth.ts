import crypto from 'node:crypto';

import { env } from '@documenso/lib/utils/env';

export type Sign8OAuthConfig = {
  apiUrl: string; // CSC API URL (e.g., https://api.uat.sign8.eu)
  oauthUrl: string; // OAuth2 URL (e.g., https://auth.uat.sign8.eu)
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type Sign8OAuthTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  credentialID?: string; // Returned by Sign8 when scope=credential
};

export type Sign8OAuthState = {
  recipientToken: string;
  documentHash: string;
  returnUrl: string;
  nonce: string;
  codeVerifier: string; // PKCE code verifier
  pendingSignatureId: string; // ID of prepared PDF data stored in database
};

/**
 * Convert Standard Base64 to Base64URL format
 * Sign8 expects Base64URL format for hashes everywhere (OAuth URL and API bodies)
 */
const toBase64Url = (base64: string): string => {
  return base64.replace(/\+/g, '-').replace(/\//g, '_');
};

/**
 * Derive OAuth URL from API URL
 * api.uat.sign8.eu -> auth.uat.sign8.eu
 * api.sign8.eu -> auth.sign8.eu
 */
const deriveOAuthUrl = (apiUrl: string): string => {
  try {
    const url = new URL(apiUrl);
    url.hostname = url.hostname.replace(/^api\./, 'auth.');
    return url.origin;
  } catch {
    // Fallback: just replace api with auth
    return apiUrl.replace('://api.', '://auth.');
  }
};

const getSign8OAuthConfig = (): Sign8OAuthConfig & { credentialId?: string } => {
  const apiUrl = env('NEXT_PRIVATE_SIGNING_SIGN8_BASE_URL');
  const clientId = env('NEXT_PRIVATE_SIGNING_SIGN8_CLIENT_ID');
  const clientSecret = env('NEXT_PRIVATE_SIGNING_SIGN8_CLIENT_SECRET');
  const credentialId = env('NEXT_PRIVATE_SIGNING_SIGN8_CREDENTIAL_ID');
  const redirectUri =
    env('NEXT_PRIVATE_SIGNING_SIGN8_OAUTH_REDIRECT_URI') ||
    `${env('NEXT_PUBLIC_WEBAPP_URL')}/api/sign8/callback`;

  if (!apiUrl || !clientId || !clientSecret) {
    throw new Error('Sign8 OAuth configuration is incomplete');
  }

  // OAuth2 is on a different domain (auth.* instead of api.*)
  const oauthUrl = env('NEXT_PRIVATE_SIGNING_SIGN8_OAUTH_URL') || deriveOAuthUrl(apiUrl);

  return {
    apiUrl,
    oauthUrl,
    clientId,
    clientSecret,
    redirectUri,
    credentialId,
  };
};

/**
 * Generate PKCE code verifier and challenge
 * https://datatracker.ietf.org/doc/html/rfc7636
 */
const generatePKCE = (): { codeVerifier: string; codeChallenge: string } => {
  // Generate a random code verifier (43-128 characters)
  const codeVerifier = crypto.randomBytes(32).toString('base64url');

  // Generate code challenge using SHA256
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  return { codeVerifier, codeChallenge };
};

/**
 * Generate a secure state parameter for OAuth flow
 */
export const generateSign8OAuthState = (options: {
  recipientToken: string;
  documentHash: string;
  returnUrl: string;
  codeVerifier: string;
  pendingSignatureId: string;
}): string => {
  const state: Sign8OAuthState = {
    recipientToken: options.recipientToken,
    documentHash: options.documentHash,
    returnUrl: options.returnUrl,
    nonce: crypto.randomBytes(16).toString('hex'),
    codeVerifier: options.codeVerifier,
    pendingSignatureId: options.pendingSignatureId,
  };

  // Encode state as base64 to pass through OAuth flow
  return Buffer.from(JSON.stringify(state)).toString('base64url');
};

/**
 * Parse and validate the OAuth state parameter
 */
export const parseSign8OAuthState = (stateString: string): Sign8OAuthState => {
  try {
    const decoded = Buffer.from(stateString, 'base64url').toString('utf-8');
    const state = JSON.parse(decoded) as Sign8OAuthState;

    if (
      !state.recipientToken ||
      !state.documentHash ||
      !state.returnUrl ||
      !state.nonce ||
      !state.pendingSignatureId
    ) {
      throw new Error('Invalid OAuth state structure');
    }

    return state;
  } catch (error) {
    throw new Error('Failed to parse OAuth state');
  }
};

/**
 * Generate the Sign8 OAuth authorization URL for user authentication
 * This redirects the recipient to Sign8 to authenticate and authorize signing
 */
export const getSign8AuthorizationUrl = (options: {
  recipientToken: string;
  documentHash: string;
  returnUrl: string;
  pendingSignatureId: string;
  signatureLevel?: 'QES' | 'AES';
}): string => {
  const config = getSign8OAuthConfig();

  // Generate PKCE parameters
  const { codeVerifier, codeChallenge } = generatePKCE();

  const state = generateSign8OAuthState({
    recipientToken: options.recipientToken,
    documentHash: options.documentHash,
    returnUrl: options.returnUrl,
    codeVerifier,
    pendingSignatureId: options.pendingSignatureId,
  });

  // CSC API credential scope authorization parameters
  // Note: credentialID is NOT sent here - it comes back in the token response
  // Use SHA-256 to match signDoc with digest approach
  //
  // IMPORTANT: Sign8 expects Base64URL format for hashes everywhere
  // (using - and _ instead of + and /), with padding kept (will be URL-encoded to %3D)
  const hashBase64Url = toBase64Url(options.documentHash);

  console.log('Sign8 auth URL - hash Standard Base64:', options.documentHash);
  console.log('Sign8 auth URL - hash Base64URL:', hashBase64Url);

  // Determine the signature qualifier based on signature level
  // QES = Qualified Electronic Signature (eu_eidas_qes)
  // AES = Advanced Electronic Signature (eu_eidas_aes)
  const signatureQualifier = options.signatureLevel === 'AES' ? 'eu_eidas_aes' : 'eu_eidas_qes';

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'credential', // Request credential scope for signing
    state,
    // PKCE parameters
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // CSC spec parameters for credential authorization
    signatureQualifier, // eu_eidas_qes for QES, eu_eidas_aes for AES
    numSignatures: '1',
    hashes: hashBase64Url, // Base64URL format (NOT URL-encoded Standard Base64)
    hashAlgorithmOID: '2.16.840.1.101.3.4.2.1', // SHA-256 OID (to match signDoc with digest)
  });

  // Note: account_token is optional and only needed for pre-authenticated flows
  // If not provided, Sign8 will prompt the user to authenticate

  // Sign8 OAuth2 authorization endpoint is /authorize (not /oauth2/authorize)
  return `${config.oauthUrl}/authorize?${params.toString()}`;
};

/**
 * Exchange the authorization code for an access token
 */
export const exchangeSign8AuthorizationCode = async (
  code: string,
  codeVerifier: string,
): Promise<Sign8OAuthTokenResponse> => {
  const config = getSign8OAuthConfig();

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: codeVerifier, // PKCE code verifier
  });

  // OAuth2 token endpoint is on auth.* domain
  const response = await fetch(`${config.oauthUrl}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Sign8 token exchange failed: ${error.error_description || error.error || response.statusText}`,
    );
  }

  return response.json() as Promise<Sign8OAuthTokenResponse>;
};

/**
 * Extend transaction to get SAD (Signature Activation Data)
 * Required by Sign8 before calling signDoc
 *
 * Reference: CSC API v2 specification
 */
export const extendSign8Transaction = async (options: {
  accessToken: string;
  credentialId: string;
  documentHashes: string[]; // Base64 encoded hashes (Standard Base64 format)
}): Promise<{ sad: string }> => {
  const config = getSign8OAuthConfig();

  // API calls use Standard Base64 format (A-Za-z0-9+/=)
  const requestBody = {
    SAD: options.accessToken,
    credentialID: options.credentialId,
    hashes: options.documentHashes,
    hashAlgorithmOID: '2.16.840.1.101.3.4.2.1', // SHA-256 to match signDoc with digest
  };

  console.log('Sign8 extendTransaction - credentialId:', options.credentialId);
  console.log('Sign8 extendTransaction - hashes (Standard Base64):', options.documentHashes);
  console.log(
    'Sign8 extendTransaction - accessToken (first 20 chars):',
    options.accessToken.substring(0, 20) + '...',
  );

  const response = await fetch(`${config.apiUrl}/csc/v2/credentials/extendTransaction`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.accessToken}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error('Sign8 extendTransaction error response:', response.status, errorText);
    let errorMessage = response.statusText;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error_description || errorJson.error || errorMessage;
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(`Sign8 extendTransaction failed: ${errorMessage}`);
  }

  const data = (await response.json()) as { SAD: string };
  console.log('Sign8 extendTransaction - got new SAD');

  return { sad: data.SAD };
};

/**
 * Sign a document using the Sign8 CSC API signDoc endpoint (PAdES mode)
 * This sends the full PDF document to Sign8 and receives back a fully signed PDF.
 *
 * Reference: CSC API v2 specification - signatures/signDoc endpoint
 *
 * Flow:
 * 1. Compute SHA-256 hash of document
 * 2. Call extendTransaction to get SAD
 * 3. Call signDoc with the SAD
 */
export const signDocWithSign8 = async (options: {
  accessToken: string;
  credentialId: string;
  documentBase64: string; // Full PDF document, Base64 encoded
  signAlgo?: string; // Signing algorithm OID (from credentials/info key.algo)
}): Promise<{ signatures: string[]; signedDocument?: string }> => {
  const config = getSign8OAuthConfig();

  // Step 1: Compute SHA-256 hash of document (to match extendTransaction hashAlgorithmOID)
  // Use Standard Base64 format (with + and /) for API calls
  const documentBuffer = Buffer.from(options.documentBase64, 'base64');
  const sha256Hash = crypto.createHash('sha256').update(documentBuffer).digest('base64');
  console.log('Sign8 signDoc - Step 1: SHA-256 hash computed (Standard Base64):', sha256Hash);

  // Step 2: Call extendTransaction to get SAD
  console.log('Sign8 signDoc - Step 2: Calling extendTransaction...');
  const { sad } = await extendSign8Transaction({
    accessToken: options.accessToken,
    credentialId: options.credentialId,
    documentHashes: [sha256Hash],
  });
  console.log('Sign8 signDoc - Step 2: Got SAD from extendTransaction');

  // Step 3: Call signDoc with SAD as Bearer token, NO SAD in request body
  // Use the credential's actual key algorithm (ECDSA for our credential)
  // Use PAdES format ("P") for PDF signing
  const effectiveSignAlgo = options.signAlgo || '1.2.840.10045.4.3.2'; // ECDSA SHA-256

  const requestBody = {
    credentialID: options.credentialId,
    // NO SAD here - reference implementation only uses it as Bearer token
    operationMode: 'S', // Synchronous
    documents: [
      {
        document: options.documentBase64,
        signAlgo: effectiveSignAlgo, // Use credential's actual key algorithm
        signature_format: 'P', // PAdES for PDF signing
        conformance_level: 'Ades-B-B',
      },
    ],
  };

  console.log('Sign8 signDoc - Step 3: Calling signDoc with SAD as Bearer token');
  console.log('Sign8 signDoc - credentialId:', options.credentialId);
  console.log('Sign8 signDoc - signAlgo:', effectiveSignAlgo);
  console.log(
    'Sign8 signDoc - request body (without document):',
    JSON.stringify(
      {
        ...requestBody,
        documents: [{ ...requestBody.documents[0], document: '[BASE64_PDF_OMITTED]' }],
      },
      null,
      2,
    ),
  );

  const signResponse = await fetch(`${config.apiUrl}/csc/v2/signatures/signDoc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sad}`, // Use SAD from extendTransaction as Bearer token
    },
    body: JSON.stringify(requestBody),
  });

  if (!signResponse.ok) {
    const errorText = await signResponse.text().catch(() => '');
    console.error('Sign8 signDoc error response:', signResponse.status, errorText);
    let errorMessage = signResponse.statusText;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error_description || errorJson.error || errorMessage;
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(`Sign8 signDoc failed: ${errorMessage}`);
  }

  const signData = (await signResponse.json()) as {
    SignatureObject?: { signature: string }[];
    signatures?: string[];
    DocumentWithSignature?: string[];
  };

  console.log('Sign8 signDoc response keys:', Object.keys(signData));
  console.log(
    'Sign8 signDoc response (first 500 chars):',
    JSON.stringify(signData).substring(0, 500),
  );

  // Check for signed document (PAdES - full signed PDF)
  if (signData.DocumentWithSignature && signData.DocumentWithSignature.length > 0) {
    return { signatures: [], signedDocument: signData.DocumentWithSignature[0] };
  }

  // Check for signature container (CAdES)
  if (signData.SignatureObject && signData.SignatureObject.length > 0) {
    return { signatures: signData.SignatureObject.map((s) => s.signature) };
  }

  if (signData.signatures && signData.signatures.length > 0) {
    return { signatures: signData.signatures };
  }

  throw new Error('No signature data returned from Sign8 signDoc');
};

/**
 * Sign document hashes using the Sign8 CSC API signDoc endpoint (CAdES detached mode)
 * This sends only the document hashes to Sign8 and receives back CMS/PKCS#7 signatures.
 *
 * Reference: CSC API v2 specification - signatures/signDoc endpoint with documentDigests
 *
 * Flow:
 * 1. Call extendTransaction with hashes to get SAD
 * 2. Call signDoc with documentDigests containing the hashes
 * 3. Sign8 returns SignatureObject with CMS signatures
 */
export const signDocWithDigests = async (options: {
  accessToken: string;
  credentialId: string;
  hashes: string[]; // Base64 encoded SHA-256 hashes
  hashAlgorithmOID: string; // Hash algorithm OID (e.g., "2.16.840.1.101.3.4.2.1" for SHA-256)
  signAlgo: string; // Signing algorithm OID from credentials/info
}): Promise<{ signatures: string[] }> => {
  const config = getSign8OAuthConfig();

  // Get conformance level from environment variable (default: Ades-B-T)
  const conformanceLevel = env('NEXT_PRIVATE_SIGNING_SIGN8_CONFORMANCE_LEVEL') || 'Ades-B-T';

  // Validate and log hash format
  const hash = options.hashes[0];
  console.log('Sign8 signDocWithDigests - hash value:', hash);
  console.log('Sign8 signDocWithDigests - hash length:', hash?.length);
  console.log(
    'Sign8 signDocWithDigests - hash chars:',
    hash ? [...new Set(hash.split(''))].sort().join('') : 'null',
  );

  // Check for invalid Base64 characters
  const validBase64Regex = /^[A-Za-z0-9+/]+=*$/;
  if (hash && !validBase64Regex.test(hash)) {
    console.error('Sign8 signDocWithDigests - INVALID Base64 detected!');
    console.error(
      'Sign8 signDocWithDigests - Invalid chars:',
      hash.split('').filter((c) => !/[A-Za-z0-9+/=]/.test(c)),
    );
  }

  console.log('Sign8 signDocWithDigests - credentialId:', options.credentialId);
  console.log('Sign8 signDocWithDigests - signAlgo:', options.signAlgo);
  console.log('Sign8 signDocWithDigests - conformanceLevel:', conformanceLevel);

  // Step 1: Call extendTransaction to get SAD
  console.log('Sign8 signDocWithDigests - Step 1: Calling extendTransaction...');
  const { sad } = await extendSign8Transaction({
    accessToken: options.accessToken,
    credentialId: options.credentialId,
    documentHashes: options.hashes,
  });
  console.log('Sign8 signDocWithDigests - Step 1: Got SAD from extendTransaction');

  // Step 2: Call signDoc with documentDigests (CAdES detached)
  // API calls use Standard Base64 format (A-Za-z0-9+/=)
  const requestBody = {
    credentialID: options.credentialId,
    operationMode: 'S', // Synchronous
    returnValidationInfo: true,
    documentDigests: [
      {
        hashes: options.hashes,
        hashAlgorithmOID: options.hashAlgorithmOID,
        signAlgo: options.signAlgo,
        signature_format: 'C', // CAdES
        conformance_level: conformanceLevel,
        signed_envelope_property: 'Detached',
      },
    ],
  };

  console.log('Sign8 signDocWithDigests - Step 2: Calling signDoc with documentDigests');
  console.log('Sign8 signDocWithDigests - request body:', JSON.stringify(requestBody, null, 2));

  const signResponse = await fetch(`${config.apiUrl}/csc/v2/signatures/signDoc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sad}`, // Use SAD from extendTransaction as Bearer token
    },
    body: JSON.stringify(requestBody),
  });

  if (!signResponse.ok) {
    const errorText = await signResponse.text().catch(() => '');
    console.error('Sign8 signDocWithDigests error response:', signResponse.status, errorText);
    let errorMessage = signResponse.statusText;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error_description || errorJson.error || errorMessage;
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(`Sign8 signDocWithDigests failed: ${errorMessage}`);
  }

  const signData = (await signResponse.json()) as {
    SignatureObject?: Array<
      string | { signature?: string; Signature?: string; signatureValue?: string }
    >;
    signatures?: string[];
  };

  console.log('Sign8 signDocWithDigests response keys:', Object.keys(signData));
  console.log('Sign8 signDocWithDigests full response:', JSON.stringify(signData, null, 2));

  // Extract CMS signatures from SignatureObject
  // Sign8 CSC API can return SignatureObject in different formats:
  // 1. Array of strings: ["base64sig1", "base64sig2"]
  // 2. Array of objects with signature property: [{signature: "base64sig"}]
  // 3. Array of objects with Signature property: [{Signature: "base64sig"}]
  if (signData.SignatureObject && signData.SignatureObject.length > 0) {
    const signatures = signData.SignatureObject.map((s) => {
      if (typeof s === 'string') {
        return s;
      }
      const sig = s.signature || s.Signature || s.signatureValue;
      if (!sig) {
        throw new Error(`Unknown SignatureObject structure: ${JSON.stringify(s)}`);
      }
      return sig;
    });
    console.log('Sign8 signDocWithDigests - Got', signatures.length, 'signature(s)');
    return { signatures };
  }

  // Fallback to signatures array if present
  if (signData.signatures && signData.signatures.length > 0) {
    console.log(
      'Sign8 signDocWithDigests - Got',
      signData.signatures.length,
      'signature(s) from array',
    );
    return { signatures: signData.signatures };
  }

  throw new Error('No signature data returned from Sign8 signDocWithDigests');
};

/**
 * Get certificate information for a specific credential
 */
export const getSign8CertificateInfo = async (
  accessToken: string,
  credentialId: string,
): Promise<{
  certificates: string[];
  issuerDN?: string;
  subjectDN?: string;
  validFrom?: string;
  validTo?: string;
  keyAlgo?: string; // Key algorithm (RSA, ECDSA, etc.)
  signAlgo?: string[]; // Supported signing algorithm OIDs from authInfo
}> => {
  const config = getSign8OAuthConfig();

  // CSC API endpoints are on api.* domain
  // Request authInfo to get supported algorithms
  const response = await fetch(`${config.apiUrl}/csc/v2/credentials/info`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      credentialID: credentialId,
      certificates: 'chain',
      certInfo: true,
      authInfo: true, // Also request auth info for supported algorithms
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Sign8 credential info failed: ${error.error_description || error.error || response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    cert: { certificates: string[] } & Record<string, unknown>;
    key?: { algo?: string | string[]; len?: number };
    authInfo?: { signAlgo?: string[] };
  };

  console.log('Sign8 credentials/info response:', JSON.stringify(data, null, 2));

  // key.algo can be a string or array - normalize to string
  const keyAlgo = Array.isArray(data.key?.algo) ? data.key.algo[0] : data.key?.algo;

  return {
    certificates: data.cert?.certificates || [],
    issuerDN: data.cert?.issuerDN as string | undefined,
    subjectDN: data.cert?.subjectDN as string | undefined,
    validFrom: data.cert?.validFrom as string | undefined,
    validTo: data.cert?.validTo as string | undefined,
    keyAlgo, // Key algorithm OID (e.g., 1.2.840.113549.1.1.1 for RSA)
    signAlgo: data.authInfo?.signAlgo, // Supported signing algorithm OIDs from authInfo
  };
};
