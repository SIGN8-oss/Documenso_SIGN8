import { z } from 'zod';

import { EmailTemplateType } from '@documenso/prisma/client';

export const ZUpsertEmailTemplateRequestSchema = z.object({
  organisationId: z.string(),
  type: z.nativeEnum(EmailTemplateType),
  data: z.object({
    enabled: z.boolean().optional(),
    subject: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
  }),
});

export const ZUpsertEmailTemplateResponseSchema = z.object({
  id: z.string(),
  type: z.nativeEnum(EmailTemplateType),
  enabled: z.boolean(),
  subject: z.string().nullable(),
  body: z.string().nullable(),
});
