import { FieldType } from '@prisma/client';

import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import type { TFieldSignature } from '@documenso/lib/types/field';
import type { TSignEnvelopeFieldValue } from '@documenso/trpc/server/envelope-router/sign-envelope-field.types';

import { SignFieldSignatureDialog } from '~/components/dialogs/sign-field-signature-dialog';

type Sign8SignatureData = {
  signature: string;
  credentialId: string;
  pendingSignatureId: string;
};

type HandleSignatureFieldClickOptions = {
  field: TFieldSignature;
  fullName?: string;
  signature: string | null;
  typedSignatureEnabled?: boolean;
  uploadSignatureEnabled?: boolean;
  drawSignatureEnabled?: boolean;
  sign8SignatureData?: Sign8SignatureData | null;
};

export const handleSignatureFieldClick = async (
  options: HandleSignatureFieldClickOptions,
): Promise<Extract<TSignEnvelopeFieldValue, { type: typeof FieldType.SIGNATURE }> | null> => {
  const {
    field,
    fullName,
    signature,
    typedSignatureEnabled,
    uploadSignatureEnabled,
    drawSignatureEnabled,
    sign8SignatureData,
  } = options;

  if (field.type !== FieldType.SIGNATURE) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Invalid field type',
    });
  }

  if (field.inserted) {
    return {
      type: FieldType.SIGNATURE,
      value: null,
    };
  }

  let signatureToInsert = signature;

  // For QES signing, use full name as visual representation (signature is cryptographic)
  if (!signatureToInsert && sign8SignatureData) {
    signatureToInsert = fullName || 'QES Signature';
  }

  if (!signatureToInsert) {
    signatureToInsert = await SignFieldSignatureDialog.call({
      fullName,
      typedSignatureEnabled,
      uploadSignatureEnabled,
      drawSignatureEnabled,
    });
  }

  if (!signatureToInsert) {
    return null;
  }

  return {
    type: FieldType.SIGNATURE,
    value: signatureToInsert,
    ...(sign8SignatureData && { sign8SignatureData }),
  };
};
