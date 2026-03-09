import { ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP } from '@documenso/lib/constants/organisations';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { encryptSecondaryData } from '@documenso/lib/server-only/crypto/encrypt';
import { buildOrganisationWhereQuery } from '@documenso/lib/utils/organisations';
import { prisma } from '@documenso/prisma';

import { authenticatedProcedure } from '../trpc';
import {
  ZUpdateOrganisationSmtpSettingsRequestSchema,
  ZUpdateOrganisationSmtpSettingsResponseSchema,
} from './update-organisation-smtp-settings.types';

export const updateOrganisationSmtpSettingsRoute = authenticatedProcedure
  .input(ZUpdateOrganisationSmtpSettingsRequestSchema)
  .output(ZUpdateOrganisationSmtpSettingsResponseSchema)
  .mutation(async ({ ctx, input }) => {
    const { user } = ctx;
    const { organisationId, data } = input;

    ctx.logger.info({
      input: {
        organisationId,
      },
    });

    const organisation = await prisma.organisation.findFirst({
      where: buildOrganisationWhereQuery({
        organisationId,
        userId: user.id,
        roles: ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP['MANAGE_ORGANISATION'],
      }),
    });

    if (!organisation) {
      throw new AppError(AppErrorCode.UNAUTHORIZED, {
        message: 'You do not have permission to update this organisation.',
      });
    }

    const {
      enabled,
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
    } = data;

    // Encrypt password and API key if provided
    const encryptedPassword = password ? encryptSecondaryData({ data: password }) : undefined;
    const encryptedApiKey = apiKey ? encryptSecondaryData({ data: apiKey }) : undefined;

    await prisma.organisationSmtpSettings.upsert({
      where: { organisationId },
      create: {
        organisationId,
        enabled: enabled ?? false,
        transportType: transportType ?? 'SMTP_AUTH',
        host: host ?? '',
        port: port ?? 587,
        secure: secure ?? false,
        username: username ?? '',
        password: encryptedPassword ?? '',
        apiKey: encryptedApiKey ?? '',
        apiKeyUser: apiKeyUser ?? 'apikey',
        fromName: fromName ?? '',
        fromAddress: fromAddress ?? '',
      },
      update: {
        ...(enabled !== undefined && { enabled }),
        ...(transportType !== undefined && { transportType }),
        ...(host !== undefined && { host }),
        ...(port !== undefined && { port }),
        ...(secure !== undefined && { secure }),
        ...(username !== undefined && { username }),
        ...(encryptedPassword !== undefined && { password: encryptedPassword }),
        ...(encryptedApiKey !== undefined && { apiKey: encryptedApiKey }),
        ...(apiKeyUser !== undefined && { apiKeyUser }),
        ...(fromName !== undefined && { fromName }),
        ...(fromAddress !== undefined && { fromAddress }),
      },
    });
  });
