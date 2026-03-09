import { createElement } from 'react';

import { msg } from '@lingui/core/macro';
import { DocumentSource, EnvelopeType } from '@prisma/client';

import { getMailer } from '@documenso/email/mailer-factory';
import { DocumentCompletedEmailTemplate } from '@documenso/email/templates/document-completed';
import { prisma } from '@documenso/prisma';

import { getI18nInstance } from '../../client-only/providers/i18n-server';
import { NEXT_PUBLIC_WEBAPP_URL } from '../../constants/app';
import { DOCUMENT_AUDIT_LOG_TYPE } from '../../types/document-audit-logs';
import { extractDerivedDocumentEmailSettings } from '../../types/document-email';
import type { RequestMetadata } from '../../universal/extract-request-metadata';
import { getFileServerSide } from '../../universal/upload/get-file.server';
import { createDocumentAuditLogData } from '../../utils/document-audit-logs';
import type { EnvelopeIdOptions } from '../../utils/envelope';
import { unsafeBuildEnvelopeIdQuery } from '../../utils/envelope';
import { isRecipientEmailValidForSending } from '../../utils/recipients';
import { renderCustomEmailTemplate } from '../../utils/render-custom-email-template';
import { renderEmailWithI18N } from '../../utils/render-email-with-i18n';
import { formatDocumentsPath } from '../../utils/teams';
import { getEmailContext } from '../email/get-email-context';
import { getEmailTemplate } from '../email/get-email-template';

export interface SendDocumentOptions {
  id: EnvelopeIdOptions;
  requestMetadata?: RequestMetadata;
}

export const sendCompletedEmail = async ({ id, requestMetadata }: SendDocumentOptions) => {
  const envelope = await prisma.envelope.findUnique({
    where: unsafeBuildEnvelopeIdQuery(id, EnvelopeType.DOCUMENT),
    include: {
      envelopeItems: {
        include: {
          documentData: {
            select: {
              type: true,
              id: true,
              data: true,
            },
          },
        },
      },
      documentMeta: true,
      recipients: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      team: {
        select: {
          id: true,
          url: true,
        },
      },
    },
  });

  if (!envelope) {
    throw new Error('Document not found');
  }

  const isDirectTemplate = envelope?.source === DocumentSource.TEMPLATE_DIRECT_LINK;

  if (envelope.recipients.length === 0) {
    throw new Error('Document has no recipients');
  }

  const { branding, emailLanguage, senderEmail, replyToEmail, organisationId } =
    await getEmailContext({
      emailType: 'RECIPIENT',
      source: {
        type: 'team',
        teamId: envelope.teamId,
      },
      meta: envelope.documentMeta,
    });

  const mailer = await getMailer({ organisationId });

  const { user: owner } = envelope;

  const completedDocumentEmailAttachments = await Promise.all(
    envelope.envelopeItems.map(async (envelopeItem) => {
      const file = await getFileServerSide(envelopeItem.documentData);

      // Use the envelope title for version 1, and the envelope item title for version 2.
      const fileNameToUse =
        envelope.internalVersion === 1 ? envelope.title : envelopeItem.title + '.pdf';

      return {
        filename: fileNameToUse.endsWith('.pdf') ? fileNameToUse : fileNameToUse + '.pdf',
        content: Buffer.from(file),
        contentType: 'application/pdf',
      };
    }),
  );

  const assetBaseUrl = NEXT_PUBLIC_WEBAPP_URL() || 'http://localhost:3000';

  let documentOwnerDownloadLink = `${NEXT_PUBLIC_WEBAPP_URL()}${formatDocumentsPath(
    envelope.team?.url,
  )}/${envelope.id}`;

  if (envelope.team?.url) {
    documentOwnerDownloadLink = `${NEXT_PUBLIC_WEBAPP_URL()}/t/${envelope.team.url}/documents/${
      envelope.id
    }`;
  }

  const emailSettings = extractDerivedDocumentEmailSettings(envelope.documentMeta);
  const isDocumentCompletedEmailEnabled = emailSettings.documentCompleted;
  const isOwnerDocumentCompletedEmailEnabled = emailSettings.ownerDocumentCompleted;

  const i18n = await getI18nInstance(emailLanguage);

  // Get organisation-level template for completed emails
  const orgCompletedTemplate = await getEmailTemplate({
    type: 'DOCUMENT_COMPLETED',
    organisationId,
    variables: {
      'signer.name': owner.name || '',
      'signer.email': owner.email,
      'document.name': envelope.title,
    },
    defaultSubject: i18n._(msg`Signing Complete!`),
  });

  // Send email to document owner if:
  // 1. Owner document completed emails are enabled AND
  // 2. Either:
  //    - The owner is not a recipient, OR
  //    - Recipient emails are disabled
  if (
    isOwnerDocumentCompletedEmailEnabled &&
    (!envelope.recipients.find((recipient) => recipient.email === owner.email) ||
      !isDocumentCompletedEmailEnabled)
  ) {
    const template = createElement(DocumentCompletedEmailTemplate, {
      documentName: envelope.title,
      assetBaseUrl,
      downloadLink: documentOwnerDownloadLink,
    });

    const [html, text] = await Promise.all([
      renderEmailWithI18N(template, { lang: emailLanguage, branding }),
      renderEmailWithI18N(template, {
        lang: emailLanguage,
        branding,
        plainText: true,
      }),
    ]);

    await mailer.sendMail({
      to: [
        {
          name: owner.name || '',
          address: owner.email,
        },
      ],
      from: senderEmail,
      replyTo: replyToEmail,
      subject: orgCompletedTemplate.subject,
      html,
      text,
      attachments: completedDocumentEmailAttachments,
    });

    await prisma.documentAuditLog.create({
      data: createDocumentAuditLogData({
        type: DOCUMENT_AUDIT_LOG_TYPE.EMAIL_SENT,
        envelopeId: envelope.id,
        user: null,
        requestMetadata,
        data: {
          emailType: 'DOCUMENT_COMPLETED',
          recipientEmail: owner.email,
          recipientName: owner.name ?? '',
          recipientId: owner.id,
          recipientRole: 'OWNER',
          isResending: false,
        },
      }),
    });
  }

  if (!isDocumentCompletedEmailEnabled) {
    return;
  }

  const recipientsToNotify = envelope.recipients.filter((recipient) =>
    isRecipientEmailValidForSending(recipient),
  );

  await Promise.all(
    recipientsToNotify.map(async (recipient) => {
      const customEmailTemplate = {
        'signer.name': recipient.name,
        'signer.email': recipient.email,
        'document.name': envelope.title,
      };

      const downloadLink = `${NEXT_PUBLIC_WEBAPP_URL()}/sign/${recipient.token}/complete`;

      const template = createElement(DocumentCompletedEmailTemplate, {
        documentName: envelope.title,
        assetBaseUrl,
        downloadLink: recipient.email === owner.email ? documentOwnerDownloadLink : downloadLink,
        customBody:
          isDirectTemplate && envelope.documentMeta?.message
            ? renderCustomEmailTemplate(envelope.documentMeta.message, customEmailTemplate)
            : undefined,
      });

      const [html, text] = await Promise.all([
        renderEmailWithI18N(template, { lang: emailLanguage, branding }),
        renderEmailWithI18N(template, {
          lang: emailLanguage,
          branding,
          plainText: true,
        }),
      ]);

      // Get organisation-level template for this recipient
      const recipientOrgTemplate = await getEmailTemplate({
        type: 'DOCUMENT_COMPLETED',
        organisationId,
        variables: customEmailTemplate,
        defaultSubject: i18n._(msg`Signing Complete!`),
      });

      // Determine subject: document-level subject takes precedence, then org template, then default
      let emailSubject = recipientOrgTemplate.subject;
      if (isDirectTemplate && envelope.documentMeta?.subject) {
        emailSubject = renderCustomEmailTemplate(
          envelope.documentMeta.subject,
          customEmailTemplate,
        );
      }

      await mailer.sendMail({
        to: [
          {
            name: recipient.name,
            address: recipient.email,
          },
        ],
        from: senderEmail,
        replyTo: replyToEmail,
        subject: emailSubject,
        html,
        text,
        attachments: completedDocumentEmailAttachments,
      });

      await prisma.documentAuditLog.create({
        data: createDocumentAuditLogData({
          type: DOCUMENT_AUDIT_LOG_TYPE.EMAIL_SENT,
          envelopeId: envelope.id,
          user: null,
          requestMetadata,
          data: {
            emailType: 'DOCUMENT_COMPLETED',
            recipientEmail: recipient.email,
            recipientName: recipient.name,
            recipientId: recipient.id,
            recipientRole: recipient.role,
            isResending: false,
          },
        }),
      });
    }),
  );
};
