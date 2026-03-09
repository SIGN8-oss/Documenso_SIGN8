import { z } from 'zod';

import { SmtpTransportType } from '@documenso/prisma/client';

export const ZGetOrganisationSmtpSettingsRequestSchema = z.object({
  organisationId: z.string(),
});

export const ZGetOrganisationSmtpSettingsResponseSchema = z
  .object({
    enabled: z.boolean(),
    transportType: z.nativeEnum(SmtpTransportType),
    host: z.string(),
    port: z.number(),
    secure: z.boolean(),
    username: z.string(),
    passwordProvided: z.boolean(),
    apiKeyProvided: z.boolean(),
    apiKeyUser: z.string(),
    fromName: z.string(),
    fromAddress: z.string(),
  })
  .nullable();
