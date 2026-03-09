import { prisma } from '@documenso/prisma';
import type { EmailTemplateType } from '@documenso/prisma/client';

import { EMAIL_TEMPLATE_DEFAULTS } from '../../constants/email-template-variables';

export type GetEmailTemplateOptions = {
  type: EmailTemplateType;
  organisationId: string;
  variables: Record<string, string>;
  defaultSubject?: string;
  defaultBody?: string;
};

export type EmailTemplateResult = {
  subject: string;
  body: string | undefined;
  isCustom: boolean;
};

/**
 * Resolves an email template for an organisation.
 *
 * If the organisation has a custom template for the given type and it's enabled,
 * returns the custom template with variables replaced.
 * Otherwise, returns the default template.
 *
 * @param options.type - The email template type
 * @param options.organisationId - The organisation ID
 * @param options.variables - Variables to replace in the template (e.g., { 'signer.name': 'John' })
 * @param options.defaultSubject - Optional default subject (overrides built-in defaults)
 * @param options.defaultBody - Optional default body (overrides built-in defaults)
 * @returns The resolved email template with variables replaced
 */
export const getEmailTemplate = async (
  options: GetEmailTemplateOptions,
): Promise<EmailTemplateResult> => {
  const { type, organisationId, variables, defaultSubject, defaultBody } = options;

  // Load custom template from database
  const customTemplate = await prisma.organisationEmailTemplate.findUnique({
    where: {
      organisationId_type: {
        organisationId,
        type,
      },
    },
  });

  // Get built-in defaults
  const builtInDefaults = EMAIL_TEMPLATE_DEFAULTS[type];

  // Determine what subject and body to use
  let subject: string;
  let body: string | undefined;
  let isCustom = false;

  if (customTemplate && customTemplate.enabled) {
    // Use custom template values if set, otherwise fall back to defaults
    subject = customTemplate.subject ?? defaultSubject ?? builtInDefaults.subject;
    body = customTemplate.body ?? defaultBody ?? builtInDefaults.body;
    isCustom = customTemplate.subject !== null || customTemplate.body !== null;
  } else {
    // No custom template or disabled - use defaults
    subject = defaultSubject ?? builtInDefaults.subject;
    body = defaultBody ?? builtInDefaults.body;
  }

  // Replace variables in the template
  subject = replaceTemplateVariables(subject, variables);
  body = body ? replaceTemplateVariables(body, variables) : undefined;

  return {
    subject,
    body,
    isCustom,
  };
};

/**
 * Replaces template variables in a string.
 *
 * Variables are in the format {variable.name} and will be replaced
 * with the corresponding value from the variables object.
 *
 * @param template - The template string containing variables
 * @param variables - Object mapping variable names to values
 * @returns The template with variables replaced
 */
export const replaceTemplateVariables = (
  template: string,
  variables: Record<string, string>,
): string => {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    // Replace {variable.name} format
    const pattern = new RegExp(`\\{${escapeRegExp(key)}\\}`, 'g');
    result = result.replace(pattern, value ?? '');
  }

  return result;
};

/**
 * Escapes special regex characters in a string.
 */
const escapeRegExp = (string: string): string => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Validates that all required variables are present in the variables object.
 *
 * @param template - The template string to check
 * @param variables - The variables object to validate against
 * @returns Array of missing variable names, or empty array if all present
 */
export const validateTemplateVariables = (
  template: string,
  variables: Record<string, string>,
): string[] => {
  const variablePattern = /\{([^}]+)\}/g;
  const matches = [...template.matchAll(variablePattern)];
  const requiredVariables = matches.map((match) => match[1]);

  return requiredVariables.filter((varName) => !(varName in variables));
};

/**
 * Preview a template with sample data.
 *
 * @param subject - The subject template
 * @param body - The body template
 * @param type - The template type (determines available variables)
 * @returns Preview with sample data
 */
export const previewTemplate = (
  subject: string,
  body: string | undefined,
  sampleVariables: Record<string, string>,
): { subject: string; body: string | undefined } => {
  return {
    subject: replaceTemplateVariables(subject, sampleVariables),
    body: body ? replaceTemplateVariables(body, sampleVariables) : undefined,
  };
};

/**
 * Get sample variables for preview based on template type.
 */
export const getSampleVariablesForType = (type: EmailTemplateType): Record<string, string> => {
  const commonVariables = {
    'signer.name': 'John Doe',
    'signer.email': 'john.doe@example.com',
    'document.name': 'Sample Contract',
    'sender.name': 'Jane Smith',
    'sender.email': 'jane.smith@company.com',
    'owner.name': 'Jane Smith',
    'owner.email': 'jane.smith@company.com',
    action: 'sign',
    'rejection.reason': 'The terms are not acceptable.',
    'cancellation.reason': 'The document is no longer needed.',
  };

  return commonVariables;
};
