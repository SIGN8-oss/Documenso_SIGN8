import {
  EMAIL_TEMPLATE_DEFAULTS,
  EMAIL_TEMPLATE_TYPE_DESCRIPTIONS,
  EMAIL_TEMPLATE_TYPE_LABELS,
  EMAIL_TEMPLATE_VARIABLES,
} from '@documenso/lib/constants/email-template-variables';
import { ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP } from '@documenso/lib/constants/organisations';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { buildOrganisationWhereQuery } from '@documenso/lib/utils/organisations';
import { prisma } from '@documenso/prisma';
import { EmailTemplateType } from '@documenso/prisma/client';

import { authenticatedProcedure } from '../trpc';
import {
  ZGetEmailTemplatesRequestSchema,
  ZGetEmailTemplatesResponseSchema,
} from './get-email-templates.types';

export const getEmailTemplatesRoute = authenticatedProcedure
  .input(ZGetEmailTemplatesRequestSchema)
  .output(ZGetEmailTemplatesResponseSchema)
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

    // Load all custom templates for this organisation
    const customTemplates = await prisma.organisationEmailTemplate.findMany({
      where: { organisationId },
    });

    // Build response with all template types
    const templateTypes = Object.values(EmailTemplateType);

    return templateTypes.map((type) => {
      const customTemplate = customTemplates.find((t) => t.type === type);
      const defaults = EMAIL_TEMPLATE_DEFAULTS[type];
      const isCustom =
        customTemplate !== undefined &&
        (customTemplate.subject !== null || customTemplate.body !== null);

      return {
        type,
        enabled: customTemplate?.enabled ?? true,
        subject: customTemplate?.subject ?? null,
        body: customTemplate?.body ?? null,
        isCustom,
        defaultSubject: defaults.subject,
        defaultBody: defaults.body,
        label: EMAIL_TEMPLATE_TYPE_LABELS[type],
        description: EMAIL_TEMPLATE_TYPE_DESCRIPTIONS[type],
        variables: EMAIL_TEMPLATE_VARIABLES[type],
      };
    });
  });
