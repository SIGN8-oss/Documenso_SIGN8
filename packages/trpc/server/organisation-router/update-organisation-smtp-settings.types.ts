import { z } from 'zod';

import { SmtpTransportType } from '@documenso/prisma/client';

export const ZUpdateOrganisationSmtpSettingsRequestSchema = z.object({
  organisationId: z.string(),
  data: z.object({
    enabled: z.boolean().optional(),
    transportType: z.nativeEnum(SmtpTransportType).optional(),
    host: z.string().optional(),
    port: z.coerce.number().min(1).max(65535).optional(),
    secure: z.boolean().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    apiKey: z.string().optional(),
    apiKeyUser: z.string().optional(),
    fromName: z.string().optional(),
    fromAddress: z.string().email().or(z.literal('')).optional(),
  }),
});

export const ZUpdateOrganisationSmtpSettingsResponseSchema = z.void();
