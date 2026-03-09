import { z } from 'zod';

import { EmailTemplateType } from '@documenso/prisma/client';

export const ZGetEmailTemplatesRequestSchema = z.object({
  organisationId: z.string(),
});

export const ZGetEmailTemplatesResponseSchema = z.array(
  z.object({
    type: z.nativeEnum(EmailTemplateType),
    enabled: z.boolean(),
    subject: z.string().nullable(),
    body: z.string().nullable(),
    isCustom: z.boolean(),
    defaultSubject: z.string(),
    defaultBody: z.string(),
    label: z.string(),
    description: z.string(),
    variables: z.record(z.string(), z.string()),
  }),
);
