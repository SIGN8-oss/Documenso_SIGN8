import { redirect } from 'react-router';

import {
  exchangeSign8AuthorizationCode,
  getSign8CertificateInfo,
  parseSign8OAuthState,
  signDocWithDigests,
} from '@documenso/lib/server-only/sign8/sign8-oauth';
import { prisma } from '@documenso/prisma';
import { embedSignatureInPdf } from '@documenso/signing/helpers/embed-signature-in-pdf';

import type { Route } from './+types/sign8.callback';

/**
 * OAuth callback endpoint for Sign8 QES signing (CAdES detached approach)
 *
 * This is called by Sign8 after the user authenticates.
 * Flow (CAdES detached - documentDigests):
 * 1. Exchange authorization code for access token (includes credentialID)
 * 2. Get certificate info from Sign8 (for signAlgo)
 * 3. Call signDoc with documentDigests (hash only, not full document)
 * 4. Sign8 returns CMS/PKCS#7 signature (SignatureObject)
 * 5. Embed CMS signature into prepared PDF at placeholder position
 * 6. Store signed PDF and redirect back
 */
export const loader = async ({ request }: Route.LoaderArgs) => {
  const url = new URL(request.url);

  // Log the full callback URL for debugging
  console.log('Sign8 callback received:', url.toString());
  console.log('Sign8 callback params:', Object.fromEntries(url.searchParams));

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  // Handle OAuth errors from Sign8
  if (error) {
    console.error('Sign8 OAuth error:', error, errorDescription);

    // Try to get returnUrl from state if available
    let returnUrl = url.origin;
    if (state) {
      try {
        const parsedState = parseSign8OAuthState(state);
        returnUrl = parsedState.returnUrl;
      } catch {
        // State parsing failed, use origin
      }
    }

    // Redirect back to the signing page with error
    const errorUrl = new URL(returnUrl);
    errorUrl.searchParams.set('sign8_error', 'true');
    errorUrl.searchParams.set('sign8_error_message', errorDescription || error);
    return redirect(errorUrl.toString());
  }

  if (!code || !state) {
    return Response.json({ error: 'Missing authorization code or state' }, { status: 400 });
  }

  let parsedState;
  try {
    parsedState = parseSign8OAuthState(state);
  } catch (e) {
    console.error('Invalid OAuth state:', e);
    return Response.json({ error: 'Invalid OAuth state' }, { status: 400 });
  }

  const { recipientToken, documentHash, returnUrl, codeVerifier, pendingSignatureId } = parsedState;

  // Verify the recipient exists and is pending
  const recipient = await prisma.recipient.findFirst({
    where: { token: recipientToken },
    select: {
      id: true,
      name: true,
      email: true,
      signatureLevel: true,
      signingStatus: true,
      envelopeId: true,
    },
  });

  if (!recipient) {
    return Response.json({ error: 'Recipient not found' }, { status: 404 });
  }

  if (recipient.signingStatus === 'SIGNED') {
    // Already signed, redirect to return URL
    return redirect(returnUrl);
  }

  // Verify the pending signature exists and hasn't expired
  const pendingSignature = await prisma.sign8QESPendingSignature.findUnique({
    where: { id: pendingSignatureId },
  });

  if (!pendingSignature) {
    const errorUrl = new URL(returnUrl);
    errorUrl.searchParams.set('sign8_error', 'true');
    errorUrl.searchParams.set('sign8_error_message', 'Signing session not found');
    return redirect(errorUrl.toString());
  }

  if (new Date() > pendingSignature.expiresAt) {
    // Clean up expired pending signature
    await prisma.sign8QESPendingSignature.delete({
      where: { id: pendingSignatureId },
    });

    const errorUrl = new URL(returnUrl);
    errorUrl.searchParams.set('sign8_error', 'true');
    errorUrl.searchParams.set('sign8_error_message', 'Signing session expired. Please try again.');
    return redirect(errorUrl.toString());
  }

  if (pendingSignature.documentHash !== documentHash) {
    const errorUrl = new URL(returnUrl);
    errorUrl.searchParams.set('sign8_error', 'true');
    errorUrl.searchParams.set('sign8_error_message', 'Document hash mismatch');
    return redirect(errorUrl.toString());
  }

  try {
    // Exchange authorization code for access token (with PKCE code_verifier)
    // According to Sign8 CSC API, the token response includes credentialID when scope=credential
    console.log('Sign8 callback - Exchanging authorization code for token...');
    const tokenResponse = await exchangeSign8AuthorizationCode(code, codeVerifier);

    // credentialID comes from the token response in the Optimized Flow
    const credentialId = tokenResponse.credentialID;

    if (!credentialId) {
      throw new Error('No credentialID returned from Sign8 token exchange');
    }

    console.log('Sign8 callback - Got credentialID:', credentialId);

    // Get certificate info from Sign8 for signAlgo
    console.log('Sign8 callback - Getting certificate info...');
    const certInfo = await getSign8CertificateInfo(tokenResponse.access_token, credentialId);

    console.log('Sign8 callback - Key algo:', certInfo.keyAlgo);
    console.log('Sign8 callback - Sign algo (from authInfo):', certInfo.signAlgo);
    console.log('Sign8 callback - Certificates count:', certInfo.certificates?.length || 0);

    // Use keyAlgo from credentials/info response directly as signAlgo
    // Sign8 expects the key algorithm OID (e.g., 1.2.840.113549.1.1.1 for RSA)
    // The hash algorithm is specified separately via hashAlgorithmOID
    const signAlgo = certInfo.keyAlgo || '1.2.840.113549.1.1.1'; // Default to RSA
    console.log('Sign8 callback - Using signAlgo:', signAlgo);

    // Get the prepared PDF (with placeholder) and ByteRange from pending signature
    const preparedPdfBase64 = pendingSignature.preparedPdfData;
    const preparedPdf = Buffer.from(preparedPdfBase64, 'base64');

    // Parse ByteRange from stored JSON
    if (!pendingSignature.byteRange) {
      throw new Error(
        'ByteRange not found in pending signature - required for CAdES detached signing',
      );
    }
    const byteRange = JSON.parse(pendingSignature.byteRange) as number[];

    console.log('Sign8 callback - Prepared PDF size:', Math.round(preparedPdf.length / 1024), 'KB');
    console.log('Sign8 callback - ByteRange:', byteRange);
    console.log('Sign8 callback - documentHash from DB:', pendingSignature.documentHash);
    console.log('Sign8 callback - documentHash length:', pendingSignature.documentHash?.length);

    // Sign using signDoc with documentDigests (CAdES detached)
    // This sends only the hash to Sign8, which returns a CMS/PKCS#7 signature
    console.log('Sign8 callback - Signing with signDoc (documentDigests mode)...');
    const signResult = await signDocWithDigests({
      accessToken: tokenResponse.access_token,
      credentialId,
      hashes: [pendingSignature.documentHash], // Hash computed from ByteRange content
      hashAlgorithmOID: '2.16.840.1.101.3.4.2.1', // SHA-256
      signAlgo,
    });

    // Sign8 returns CMS/PKCS#7 signature in SignatureObject
    if (!signResult.signatures || signResult.signatures.length === 0) {
      throw new Error('Sign8 did not return a signature (SignatureObject)');
    }

    console.log('Sign8 callback - Got CMS signature from Sign8');
    const cmsSignature = Buffer.from(signResult.signatures[0], 'base64');
    console.log('Sign8 callback - CMS signature size:', cmsSignature.length, 'bytes');

    // Embed the CMS signature into the prepared PDF at the placeholder position
    const signedPdf = embedSignatureInPdf({
      pdf: preparedPdf,
      signature: cmsSignature,
      byteRange,
    });
    console.log('Sign8 callback - Signed PDF size:', Math.round(signedPdf.length / 1024), 'KB');

    // Store the signed PDF for later retrieval
    await prisma.sign8QESPendingSignature.update({
      where: { id: pendingSignatureId },
      data: { preparedPdfData: signedPdf.toString('base64') },
    });

    // Redirect back with success
    const redirectUrl = new URL(returnUrl);
    redirectUrl.searchParams.set('sign8_signed_pdf', 'true');
    redirectUrl.searchParams.set('sign8_credential', credentialId);
    redirectUrl.searchParams.set('sign8_pending_id', pendingSignatureId);
    redirectUrl.searchParams.set('sign8_success', 'true');

    console.log('Sign8 callback - Success, redirecting to:', redirectUrl.toString());

    return redirect(redirectUrl.toString());
  } catch (error) {
    console.error('Sign8 signing error:', error);
    console.error('Sign8 signing error stack:', error instanceof Error ? error.stack : 'No stack');
    console.error('Sign8 signing - documentHash used:', documentHash);
    console.error('Sign8 signing - pendingSignature hash:', pendingSignature?.documentHash);

    // Redirect back with error
    const errorUrl = new URL(returnUrl);
    errorUrl.searchParams.set('sign8_error', 'true');
    errorUrl.searchParams.set(
      'sign8_error_message',
      error instanceof Error ? error.message : 'Failed to complete Sign8 signing',
    );

    return redirect(errorUrl.toString());
  }
};
