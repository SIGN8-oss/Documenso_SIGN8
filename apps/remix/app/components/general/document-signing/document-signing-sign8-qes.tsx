import { useCallback, useEffect, useRef, useState } from 'react';

import { Trans, useLingui } from '@lingui/react/macro';
import { SignatureLevel } from '@prisma/client';
import { BadgeCheckIcon, ExternalLinkIcon, Loader2Icon, ShieldAlertIcon } from 'lucide-react';
import { useLocation, useSearchParams } from 'react-router';

import { Alert, AlertDescription, AlertTitle } from '@documenso/ui/primitives/alert';
import { Button } from '@documenso/ui/primitives/button';
import { useToast } from '@documenso/ui/primitives/use-toast';

export type DocumentSigningSign8QESProps = {
  recipientToken: string;
  recipientName: string;
  recipientEmail: string;
  fullName?: string;
  signature?: string | null;
  signatureLevel: SignatureLevel;
  onSign8Complete: (signatureData: {
    signature: string;
    credentialId: string;
    pendingSignatureId: string;
    hasSignedPdf?: boolean; // True when Sign8 returned a fully signed PDF (PAdES)
  }) => void;
  onSign8Error?: (error: string) => void;
  disabled?: boolean;
};

export const DocumentSigningSign8QES = ({
  recipientToken,
  recipientName,
  recipientEmail,
  fullName: fullNameProp,
  signature: signatureProp,
  signatureLevel,
  onSign8Complete,
  onSign8Error,
  disabled = false,
}: DocumentSigningSign8QESProps) => {
  const { t } = useLingui();
  const { toast } = useToast();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sign8Error, setSign8Error] = useState<string | null>(null);
  const processedCallbackRef = useRef(false);

  // Check if we're returning from Sign8 OAuth
  const sign8Success = searchParams.get('sign8_success');
  const sign8Signature = searchParams.get('sign8_signature');
  const sign8SignedPdf = searchParams.get('sign8_signed_pdf');
  const sign8Credential = searchParams.get('sign8_credential');
  const sign8PendingId = searchParams.get('sign8_pending_id');
  const sign8ErrorParam = searchParams.get('sign8_error');
  const sign8ErrorMessage = searchParams.get('sign8_error_message');

  // Handle Sign8 callback parameters - runs once on mount
  useEffect(() => {
    if (processedCallbackRef.current) {
      return;
    }

    // Success case: we have either a signature (CAdES) or a signed PDF (PAdES)
    const hasSignature = sign8Signature !== null;
    const hasSignedPdf = sign8SignedPdf === 'true';

    if (
      sign8Success === 'true' &&
      (hasSignature || hasSignedPdf) &&
      sign8Credential &&
      sign8PendingId
    ) {
      processedCallbackRef.current = true;

      // Clear the URL parameters
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('sign8_success');
      newParams.delete('sign8_signature');
      newParams.delete('sign8_signed_pdf');
      newParams.delete('sign8_credential');
      newParams.delete('sign8_pending_id');
      setSearchParams(newParams, { replace: true });

      // Mark as authenticated and notify parent
      setIsAuthenticated(true);
      onSign8Complete({
        signature: sign8Signature || '',
        credentialId: sign8Credential,
        pendingSignatureId: sign8PendingId,
        hasSignedPdf,
      });

      toast({
        title: t`Signed with Sign8`,
        description: t`Your qualified electronic signature has been applied.`,
      });
    } else if (sign8ErrorParam === 'true') {
      const errorMsg = sign8ErrorMessage || t`Failed to sign with Sign8`;

      // Clear the URL parameters
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('sign8_error');
      newParams.delete('sign8_error_message');
      setSearchParams(newParams, { replace: true });

      setSign8Error(errorMsg);
      setIsAuthenticating(false);
      onSign8Error?.(errorMsg);

      toast({
        title: t`Sign8 Error`,
        description: errorMsg,
        variant: 'destructive',
      });
    }
  }, [
    sign8Success,
    sign8Signature,
    sign8SignedPdf,
    sign8Credential,
    sign8PendingId,
    sign8ErrorParam,
    sign8ErrorMessage,
    searchParams,
    setSearchParams,
    onSign8Complete,
    onSign8Error,
    toast,
    t,
  ]);

  const handleSign8Auth = useCallback(() => {
    setIsAuthenticating(true);
    setSign8Error(null);

    // Build the return URL (current page)
    const returnUrl = `${window.location.origin}${location.pathname}`;

    // Use form POST to send signature data (can be large base64 image)
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/api/sign8/authorize';

    const addField = (name: string, value: string) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    };

    addField('token', recipientToken);
    addField('returnUrl', returnUrl);

    if (fullNameProp) {
      addField('fullName', fullNameProp);
    }

    if (signatureProp) {
      addField('signature', signatureProp);
    }

    document.body.appendChild(form);
    form.submit();
  }, [location.pathname, recipientToken, fullNameProp, signatureProp]);

  // Only show for QES and AES recipients (SES uses local signing)
  if (signatureLevel !== SignatureLevel.QES && signatureLevel !== SignatureLevel.AES) {
    return null;
  }

  if (isAuthenticated) {
    return (
      <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
        <BadgeCheckIcon className="h-5 w-5 text-green-600" />
        <AlertTitle className="text-green-800 dark:text-green-200">
          <Trans>Qualified Electronic Signature Applied</Trans>
        </AlertTitle>
        <AlertDescription className="text-green-700 dark:text-green-300">
          <Trans>
            Your document has been signed with a qualified electronic signature via Sign8. This
            signature is legally equivalent to a handwritten signature under eIDAS.
          </Trans>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <Alert className="border-blue-500 bg-blue-50 dark:bg-blue-950">
        <BadgeCheckIcon className="h-5 w-5 text-blue-600" />
        <AlertTitle className="text-blue-800 dark:text-blue-200">
          <Trans>
            {signatureLevel === SignatureLevel.QES
              ? 'Qualified Electronic Signature (QES) Required'
              : 'Advanced Electronic Signature (AES) Required'}
          </Trans>
        </AlertTitle>
        <AlertDescription className="text-blue-700 dark:text-blue-300">
          <Trans>
            This document requires a qualified electronic signature. You will be redirected to Sign8
            to authenticate with your qualified certificate and sign the document.
          </Trans>
        </AlertDescription>
      </Alert>

      {sign8Error && (
        <Alert variant="destructive">
          <ShieldAlertIcon className="h-5 w-5" />
          <AlertTitle>
            <Trans>Sign8 Authentication Failed</Trans>
          </AlertTitle>
          <AlertDescription>{sign8Error}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-lg border bg-card p-4">
        <div className="mb-4">
          <h3 className="text-sm font-medium text-muted-foreground">
            <Trans>Signing as</Trans>
          </h3>
          <p className="text-base font-semibold">{recipientName}</p>
          <p className="text-sm text-muted-foreground">{recipientEmail}</p>
        </div>

        <Button
          onClick={handleSign8Auth}
          disabled={disabled || isAuthenticating}
          className="w-full"
          size="lg"
        >
          {isAuthenticating ? (
            <>
              <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              <Trans>Redirecting to Sign8...</Trans>
            </>
          ) : (
            <>
              <BadgeCheckIcon className="mr-2 h-4 w-4" />
              <Trans>Sign with Sign8 ({signatureLevel})</Trans>
              <ExternalLinkIcon className="ml-2 h-3 w-3" />
            </>
          )}
        </Button>

        <p className="mt-3 text-center text-xs text-muted-foreground">
          <Trans>
            You will be redirected to Sign8 to authenticate with your qualified certificate. After
            authentication, you will be returned here to complete the signing process.
          </Trans>
        </p>
      </div>
    </div>
  );
};
