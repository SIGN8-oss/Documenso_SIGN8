import type { EmailTemplateType } from '@documenso/prisma/client';

/**
 * Template variables available for each email template type.
 */
export const EMAIL_TEMPLATE_VARIABLES: Record<EmailTemplateType, Record<string, string>> = {
  DOCUMENT_INVITE: {
    'signer.name': 'Name of the recipient',
    'signer.email': 'Email of the recipient',
    'document.name': 'Document title',
    'sender.name': 'Name of the sender',
    'sender.email': 'Email of the sender',
    action: 'Action verb (sign, approve, view, etc.)',
  },
  DOCUMENT_COMPLETED: {
    'signer.name': 'Name of the recipient',
    'signer.email': 'Email of the recipient',
    'document.name': 'Document title',
  },
  DOCUMENT_PENDING: {
    'signer.name': 'Name of the recipient',
    'signer.email': 'Email of the recipient',
    'document.name': 'Document title',
  },
  DOCUMENT_REJECTED: {
    'signer.name': 'Name of the recipient who rejected',
    'signer.email': 'Email of the recipient who rejected',
    'document.name': 'Document title',
    'rejection.reason': 'Reason for rejection',
  },
  DOCUMENT_CANCELLED: {
    'signer.name': 'Name of the recipient',
    'signer.email': 'Email of the recipient',
    'document.name': 'Document title',
    'cancellation.reason': 'Reason for cancellation',
  },
  RECIPIENT_SIGNED: {
    'signer.name': 'Name of the recipient who signed',
    'signer.email': 'Email of the recipient who signed',
    'document.name': 'Document title',
    'owner.name': 'Name of the document owner',
    'owner.email': 'Email of the document owner',
  },
};

/**
 * Default email templates for each template type.
 */
export const EMAIL_TEMPLATE_DEFAULTS: Record<EmailTemplateType, { subject: string; body: string }> =
  {
    DOCUMENT_INVITE: {
      subject: 'Please {action} this document',
      body: '{sender.name} has invited you to {action} the document "{document.name}".',
    },
    DOCUMENT_COMPLETED: {
      subject: 'Document signing complete!',
      body: 'The document "{document.name}" has been signed by all parties.',
    },
    DOCUMENT_PENDING: {
      subject: 'Waiting for others to complete signing',
      body: 'You have completed your part for "{document.name}". We are waiting for other recipients to complete their actions.',
    },
    DOCUMENT_REJECTED: {
      subject: 'Document "{document.name}" - Rejected',
      body: 'The document "{document.name}" has been rejected by {signer.name}.',
    },
    DOCUMENT_CANCELLED: {
      subject: 'Document "{document.name}" Cancelled',
      body: 'The document "{document.name}" has been cancelled.',
    },
    RECIPIENT_SIGNED: {
      subject: '{signer.name} has signed "{document.name}"',
      body: '{signer.name} ({signer.email}) has signed the document "{document.name}".',
    },
  };

/**
 * Get the display name for an email template type.
 */
export const EMAIL_TEMPLATE_TYPE_LABELS: Record<EmailTemplateType, string> = {
  DOCUMENT_INVITE: 'Document Invitation',
  DOCUMENT_COMPLETED: 'Document Completed',
  DOCUMENT_PENDING: 'Document Pending',
  DOCUMENT_REJECTED: 'Document Rejected',
  DOCUMENT_CANCELLED: 'Document Cancelled',
  RECIPIENT_SIGNED: 'Recipient Signed',
};

/**
 * Get descriptions for each template type.
 */
export const EMAIL_TEMPLATE_TYPE_DESCRIPTIONS: Record<EmailTemplateType, string> = {
  DOCUMENT_INVITE: 'Sent when a recipient is invited to sign, approve, or view a document.',
  DOCUMENT_COMPLETED: 'Sent when all recipients have completed their actions on a document.',
  DOCUMENT_PENDING: 'Sent to recipients who have completed their part while waiting for others.',
  DOCUMENT_REJECTED: 'Sent when a recipient rejects a document.',
  DOCUMENT_CANCELLED: 'Sent when a document is cancelled by the sender.',
  RECIPIENT_SIGNED: 'Sent to the document owner when a recipient signs the document.',
};
