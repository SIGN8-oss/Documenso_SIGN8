import { z } from 'zod';

import { EmailTemplateType } from '@documenso/prisma/client';

export const ZSendExampleEmailTemplateRequestSchema = z.object({
  organisationId: z.string(),
  templateType: z.nativeEnum(EmailTemplateType),
  subject: z.string(),
  body: z.string().optional(),
  recipientEmail: z.string().email('Valid recipient email required'),
});

export const ZSendExampleEmailTemplateResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
