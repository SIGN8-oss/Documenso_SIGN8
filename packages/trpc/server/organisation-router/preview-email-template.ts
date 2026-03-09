import {
  getSampleVariablesForType,
  previewTemplate,
} from '@documenso/lib/server-only/email/get-email-template';

import { authenticatedProcedure } from '../trpc';
import {
  ZPreviewEmailTemplateRequestSchema,
  ZPreviewEmailTemplateResponseSchema,
} from './preview-email-template.types';

export const previewEmailTemplateRoute = authenticatedProcedure
  .input(ZPreviewEmailTemplateRequestSchema)
  .output(ZPreviewEmailTemplateResponseSchema)
  .query(({ input }) => {
    const { type, subject, body } = input;

    const sampleVariables = getSampleVariablesForType(type);

    return previewTemplate(subject, body, sampleVariables);
  });
