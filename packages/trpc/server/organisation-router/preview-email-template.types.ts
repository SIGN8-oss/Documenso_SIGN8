import { z } from 'zod';

import { EmailTemplateType } from '@documenso/prisma/client';

export const ZPreviewEmailTemplateRequestSchema = z.object({
  type: z.nativeEnum(EmailTemplateType),
  subject: z.string(),
  body: z.string().optional(),
});

export const ZPreviewEmailTemplateResponseSchema = z.object({
  subject: z.string(),
  body: z.string().optional(),
});
