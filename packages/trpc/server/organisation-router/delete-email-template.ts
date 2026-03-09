import { ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP } from '@documenso/lib/constants/organisations';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { buildOrganisationWhereQuery } from '@documenso/lib/utils/organisations';
import { prisma } from '@documenso/prisma';

import { authenticatedProcedure } from '../trpc';
import {
  ZDeleteEmailTemplateRequestSchema,
  ZDeleteEmailTemplateResponseSchema,
} from './delete-email-template.types';

export const deleteEmailTemplateRoute = authenticatedProcedure
  .input(ZDeleteEmailTemplateRequestSchema)
  .output(ZDeleteEmailTemplateResponseSchema)
  .mutation(async ({ ctx, input }) => {
    const { user } = ctx;
    const { organisationId, type } = input;

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

    // Delete the custom template (this will reset to default)
    await prisma.organisationEmailTemplate.deleteMany({
      where: {
        organisationId,
        type,
      },
    });
  });
