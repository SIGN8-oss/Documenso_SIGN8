import { createTransport } from 'nodemailer';

import { ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP } from '@documenso/lib/constants/organisations';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { decryptSecondaryData } from '@documenso/lib/server-only/crypto/decrypt';
import { buildOrganisationWhereQuery } from '@documenso/lib/utils/organisations';
import { prisma } from '@documenso/prisma';

import { authenticatedProcedure } from '../trpc';
import {
  ZTestOrganisationSmtpSettingsRequestSchema,
  ZTestOrganisationSmtpSettingsResponseSchema,
} from './test-organisation-smtp-settings.types';

export const testOrganisationSmtpSettingsRoute = authenticatedProcedure
  .input(ZTestOrganisationSmtpSettingsRequestSchema)
  .output(ZTestOrganisationSmtpSettingsResponseSchema)
  .mutation(async ({ ctx, input }) => {
    const { user } = ctx;
    const { organisationId, data } = input;

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
        message: 'You do not have permission to test SMTP settings for this organisation.',
      });
    }

    const {
      transportType,
      host,
      port,
      secure,
      username,
      password,
      apiKey,
      apiKeyUser,
      fromName,
      fromAddress,
      testRecipientEmail,
    } = data;

    try {
      let transporter;

      // Resolve password/apiKey - use provided value, or try to get from stored settings
      let resolvedPassword = password;
      let resolvedApiKey = apiKey;

      if (!resolvedPassword && organisation.smtpSettings?.password) {
        resolvedPassword = decryptSecondaryData(organisation.smtpSettings.password) ?? '';
      }

      if (!resolvedApiKey && organisation.smtpSettings?.apiKey) {
        resolvedApiKey = decryptSecondaryData(organisation.smtpSettings.apiKey) ?? '';
      }

      if (transportType === 'SMTP_API') {
        if (!resolvedApiKey) {
          return {
            success: false,
            error: 'API key is required for SMTP API transport',
          };
        }

        transporter = createTransport({
          host,
          port,
          secure,
          auth: {
            user: apiKeyUser || 'apikey',
            pass: resolvedApiKey,
          },
        });
      } else {
        transporter = createTransport({
          host,
          port,
          secure,
          auth: username
            ? {
                user: username,
                pass: resolvedPassword || '',
              }
            : undefined,
        });
      }

      // First verify the connection
      await transporter.verify();

      // Then send a test email
      await transporter.sendMail({
        from: {
          name: fromName || organisation.name,
          address: fromAddress,
        },
        to: testRecipientEmail,
        subject: `Test Email from ${organisation.name}`,
        text: `This is a test email to verify your SMTP configuration for ${organisation.name} on SIGN8.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>SMTP Test Successful</h2>
            <p>This is a test email to verify your SMTP configuration for <strong>${organisation.name}</strong> on SIGN8.</p>
            <p>If you received this email, your SMTP settings are configured correctly.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
            <p style="color: #666; font-size: 12px;">This email was sent from SIGN8 to verify SMTP settings.</p>
          </div>
        `,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  });
