import { ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP } from '@documenso/lib/constants/organisations';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { buildOrganisationWhereQuery } from '@documenso/lib/utils/organisations';
import { prisma } from '@documenso/prisma';

import { authenticatedProcedure } from '../trpc';
import {
  ZGetOrganisationSmtpSettingsRequestSchema,
  ZGetOrganisationSmtpSettingsResponseSchema,
} from './get-organisation-smtp-settings.types';

export const getOrganisationSmtpSettingsRoute = authenticatedProcedure
  .input(ZGetOrganisationSmtpSettingsRequestSchema)
  .output(ZGetOrganisationSmtpSettingsResponseSchema)
  .query(async ({ ctx, input }) => {
    const { user } = ctx;
    const { organisationId } = input;

    const organisation = await prisma.organisation.findFirst({
      where: buildOrganisationWhereQuery({
        organisationId,
        userId: user.id,
        roles: ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP['MANAGE_ORGANISATION'],
      }),
    });

    if (!organisation) {
      throw new AppError(AppErrorCode.UNAUTHORIZED, {
        message: 'You do not have permission to view this organisation.',
      });
    }

    const smtpSettings = await prisma.organisationSmtpSettings.findUnique({
      where: { organisationId },
    });

    if (!smtpSettings) {
      return null;
    }

    return {
      enabled: smtpSettings.enabled,
      transportType: smtpSettings.transportType,
      host: smtpSettings.host,
      port: smtpSettings.port,
      secure: smtpSettings.secure,
      username: smtpSettings.username,
      passwordProvided: smtpSettings.password !== '',
      apiKeyProvided: smtpSettings.apiKey !== '',
      apiKeyUser: smtpSettings.apiKeyUser,
      fromName: smtpSettings.fromName,
      fromAddress: smtpSettings.fromAddress,
    };
  });
