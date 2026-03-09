import { createTransport } from 'nodemailer';

import { ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP } from '@documenso/lib/constants/organisations';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { decryptSecondaryData } from '@documenso/lib/server-only/crypto/decrypt';
import {
  getSampleVariablesForType,
  previewTemplate,
} from '@documenso/lib/server-only/email/get-email-template';
import { buildOrganisationWhereQuery } from '@documenso/lib/utils/organisations';
import { prisma } from '@documenso/prisma';

import { authenticatedProcedure } from '../trpc';
import {
  ZSendExampleEmailTemplateRequestSchema,
  ZSendExampleEmailTemplateResponseSchema,
} from './send-example-email-template.types';

export const sendExampleEmailTemplateRoute = authenticatedProcedure
  .input(ZSendExampleEmailTemplateRequestSchema)
  .output(ZSendExampleEmailTemplateResponseSchema)
  .mutation(async ({ ctx, input }) => {
    const { user } = ctx;
    const { organisationId, templateType, subject, body, recipientEmail } = input;

    const organisation = await prisma.organisation.findFirst({
      where: buildOrganisationWhereQuery({
        organisationId,
        userId: user.id,
        roles: ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP['MANAGE_ORGANISATION'],
      }),
      select: {
        name: true,
        smtpSettings: true,
      },
    });

    if (!organisation) {
      throw new AppError(AppErrorCode.UNAUTHORIZED, {
        message: 'You do not have permission to send example emails for this organisation.',
      });
    }

    if (!organisation.smtpSettings) {
      return {
        success: false,
        error: 'SMTP settings are not configured for this organisation.',
      };
    }

    const { smtpSettings } = organisation;

    try {
      let transporter;

      const resolvedPassword = smtpSettings.password
        ? decryptSecondaryData(smtpSettings.password)
        : undefined;
      const resolvedApiKey = smtpSettings.apiKey
        ? decryptSecondaryData(smtpSettings.apiKey)
        : undefined;

      if (smtpSettings.transportType === 'SMTP_API') {
        if (!resolvedApiKey) {
          return {
            success: false,
            error: 'API key is required for SMTP API transport',
          };
        }

        transporter = createTransport({
          host: smtpSettings.host,
          port: smtpSettings.port,
          secure: smtpSettings.secure,
          auth: {
            user: smtpSettings.apiKeyUser || 'apikey',
            pass: resolvedApiKey,
          },
        });
      } else {
        transporter = createTransport({
          host: smtpSettings.host,
          port: smtpSettings.port,
          secure: smtpSettings.secure,
          auth: smtpSettings.username
            ? {
                user: smtpSettings.username,
                pass: resolvedPassword || '',
              }
            : undefined,
        });
      }

      // Preview the template with sample variables
      const sampleVariables = getSampleVariablesForType(templateType);
      const renderedTemplate = previewTemplate(subject, body, sampleVariables);

      // Send the example email
      await transporter.sendMail({
        from: {
          name: smtpSettings.fromName || organisation.name,
          address: smtpSettings.fromAddress,
        },
        to: recipientEmail,
        subject: `[Example] ${renderedTemplate.subject}`,
        text: renderedTemplate.body || '',
        html: renderedTemplate.body
          ? `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f0f9ff; border: 1px solid #bae6fd; padding: 12px; margin-bottom: 20px; border-radius: 4px;">
              <p style="margin: 0; color: #0369a1; font-size: 14px;">
                <strong>Example Email</strong> - This is a preview of your email template with sample data.
              </p>
            </div>
            <div style="white-space: pre-wrap;">${renderedTemplate.body}</div>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
            <p style="color: #666; font-size: 12px;">This example email was sent from SIGN8 to preview your email template.</p>
          </div>
        `
          : undefined,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  });
