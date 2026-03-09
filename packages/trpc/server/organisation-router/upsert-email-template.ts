import { ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP } from '@documenso/lib/constants/organisations';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { buildOrganisationWhereQuery } from '@documenso/lib/utils/organisations';
import { prisma } from '@documenso/prisma';

import { authenticatedProcedure } from '../trpc';
import {
  ZUpsertEmailTemplateRequestSchema,
  ZUpsertEmailTemplateResponseSchema,
} from './upsert-email-template.types';

export const upsertEmailTemplateRoute = authenticatedProcedure
  .input(ZUpsertEmailTemplateRequestSchema)
  .output(ZUpsertEmailTemplateResponseSchema)
  .mutation(async ({ ctx, input }) => {
    const { user } = ctx;
    const { organisationId, type, data } = input;

    ctx.logger.info({
      input: {
        organisationId,
        type,
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

    const { enabled, subject, body } = data;

    const template = await prisma.organisationEmailTemplate.upsert({
      where: {
        organisationId_type: {
          organisationId,
          type,
        },
      },
      create: {
        organisationId,
        type,
        enabled: enabled ?? true,
        subject: subject ?? null,
        body: body ?? null,
      },
      update: {
        ...(enabled !== undefined && { enabled }),
        ...(subject !== undefined && { subject }),
        ...(body !== undefined && { body }),
      },
    });

    return {
      id: template.id,
      type: template.type,
      enabled: template.enabled,
      subject: template.subject,
      body: template.body,
    };
  });
