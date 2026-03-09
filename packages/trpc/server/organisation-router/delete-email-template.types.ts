import { z } from 'zod';

import { EmailTemplateType } from '@documenso/prisma/client';

export const ZDeleteEmailTemplateRequestSchema = z.object({
  organisationId: z.string(),
  type: z.nativeEnum(EmailTemplateType),
});

export const ZDeleteEmailTemplateResponseSchema = z.void();
