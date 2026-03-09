import { z } from 'zod';

import { SmtpTransportType } from '@documenso/prisma/client';

export const ZTestOrganisationSmtpSettingsRequestSchema = z.object({
  organisationId: z.string(),
  data: z.object({
    transportType: z.nativeEnum(SmtpTransportType),
    host: z.string().min(1, 'Host is required'),
    port: z.coerce.number().min(1).max(65535),
    secure: z.boolean(),
    username: z.string().optional(),
    password: z.string().optional(),
    apiKey: z.string().optional(),
    apiKeyUser: z.string().optional(),
    fromName: z.string().optional(),
    fromAddress: z.string().email('Valid email address required'),
    testRecipientEmail: z.string().email('Valid recipient email required'),
  }),
});

export const ZTestOrganisationSmtpSettingsResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
