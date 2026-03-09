import type { Transporter } from 'nodemailer';
import { createTransport } from 'nodemailer';

import { decryptSecondaryData } from '@documenso/lib/server-only/crypto/decrypt';
import { prisma } from '@documenso/prisma';
import type { SmtpTransportType } from '@documenso/prisma/client';

import { mailer } from './mailer';

export type GetMailerOptions = {
  organisationId?: string;
  teamId?: number;
};

type OrganisationSmtpConfig = {
  enabled: boolean;
  transportType: SmtpTransportType;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  apiKey: string;
  apiKeyUser: string;
  fromName: string;
  fromAddress: string;
};

/**
 * Creates an organization-specific mailer or falls back to the global mailer.
 *
 * This function checks if the organization has custom SMTP settings configured.
 * If enabled, it creates a transporter using those settings. Otherwise, it returns
 * the global mailer configured via environment variables.
 *
 * @param options.organisationId - The organization ID to get SMTP settings for
 * @param options.teamId - The team ID (will resolve to organisation)
 * @returns A Nodemailer transporter instance
 */
export const getMailer = async (options: GetMailerOptions = {}): Promise<Transporter> => {
  const { organisationId, teamId } = options;

  // Resolve organisationId from teamId if needed
  let resolvedOrgId = organisationId;

  if (!resolvedOrgId && teamId) {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { organisationId: true },
    });

    resolvedOrgId = team?.organisationId;
  }

  // If no organisation context, use global mailer
  if (!resolvedOrgId) {
    return mailer;
  }

  // Load organisation SMTP settings
  const smtpSettings = await prisma.organisationSmtpSettings.findUnique({
    where: { organisationId: resolvedOrgId },
  });

  // If no custom SMTP settings or not enabled, use global mailer
  if (!smtpSettings || !smtpSettings.enabled) {
    return mailer;
  }

  // Create organisation-specific transporter
  return createOrganisationTransporter(smtpSettings);
};

/**
 * Creates a transporter based on organisation SMTP settings.
 */
const createOrganisationTransporter = (config: OrganisationSmtpConfig): Transporter => {
  if (config.transportType === 'SMTP_API') {
    // Decrypt API key
    const decryptedApiKey = decryptCredential(config.apiKey);

    if (!config.host || !decryptedApiKey) {
      throw new Error('SMTP API transport requires host and API key');
    }

    return createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.apiKeyUser || 'apikey',
        pass: decryptedApiKey,
      },
    });
  }

  // Default: SMTP_AUTH
  const decryptedPassword = decryptCredential(config.password);

  return createTransport({
    host: config.host || '127.0.0.1',
    port: config.port || 587,
    secure: config.secure,
    auth: config.username
      ? {
          user: config.username,
          pass: decryptedPassword || '',
        }
      : undefined,
  });
};

/**
 * Decrypts a credential if it's encrypted, otherwise returns as-is.
 */
const decryptCredential = (encryptedValue: string): string => {
  if (!encryptedValue) {
    return '';
  }

  // Try to decrypt - if it fails, the value might not be encrypted
  const decrypted = decryptSecondaryData(encryptedValue);

  return decrypted ?? encryptedValue;
};

/**
 * Gets the sender email configuration for an organisation.
 */
export const getOrganisationSenderEmail = async (
  organisationId: string,
): Promise<{ name: string; address: string } | null> => {
  const smtpSettings = await prisma.organisationSmtpSettings.findUnique({
    where: { organisationId },
    select: {
      enabled: true,
      fromName: true,
      fromAddress: true,
    },
  });

  if (!smtpSettings?.enabled || !smtpSettings.fromAddress) {
    return null;
  }

  return {
    name: smtpSettings.fromName || '',
    address: smtpSettings.fromAddress,
  };
};

/**
 * Tests SMTP connection by verifying the transporter.
 */
export const testSmtpConnection = async (
  config: Omit<OrganisationSmtpConfig, 'fromName' | 'fromAddress'>,
): Promise<{ success: boolean; error?: string }> => {
  try {
    const transporter = createOrganisationTransporter({
      ...config,
      fromName: '',
      fromAddress: '',
    });

    await transporter.verify();

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};
