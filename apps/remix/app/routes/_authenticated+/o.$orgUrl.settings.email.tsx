import { Trans, useLingui } from '@lingui/react/macro';

import { useCurrentOrganisation } from '@documenso/lib/client-only/providers/organisation';
import { trpc } from '@documenso/trpc/react';
import { SpinnerBox } from '@documenso/ui/primitives/spinner';
import { useToast } from '@documenso/ui/primitives/use-toast';

import {
  EmailPreferencesForm,
  type TEmailPreferencesFormSchema,
} from '~/components/forms/email-preferences-form';
import {
  SmtpSettingsForm,
  type TSmtpSettingsFormSchema,
} from '~/components/forms/smtp-settings-form';
import { SettingsHeader } from '~/components/general/settings-header';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Email Preferences');
}

export default function OrganisationSettingsGeneral() {
  const { t } = useLingui();
  const { toast } = useToast();

  const organisation = useCurrentOrganisation();

  const { data: organisationWithSettings, isLoading: isLoadingOrganisation } =
    trpc.organisation.get.useQuery({
      organisationReference: organisation.url,
    });

  const { data: smtpSettings, isLoading: isLoadingSmtp } = trpc.organisation.smtp.get.useQuery({
    organisationId: organisation.id,
  });

  const { mutateAsync: updateOrganisationSettings } =
    trpc.organisation.settings.update.useMutation();

  const { mutateAsync: updateSmtpSettings } = trpc.organisation.smtp.update.useMutation();

  const { mutateAsync: testSmtpSettings } = trpc.organisation.smtp.test.useMutation();

  const onEmailPreferencesSubmit = async (data: TEmailPreferencesFormSchema) => {
    try {
      const { emailId, emailReplyTo, emailDocumentSettings } = data;

      await updateOrganisationSettings({
        organisationId: organisation.id,
        data: {
          emailId,
          emailReplyTo: emailReplyTo || null,
          // emailReplyToName,
          emailDocumentSettings,
        },
      });

      toast({
        title: t`Email preferences updated`,
        description: t`Your email preferences have been updated`,
      });
    } catch {
      toast({
        title: t`Something went wrong!`,
        description: t`We were unable to update your email preferences at this time, please try again later`,
        variant: 'destructive',
      });
    }
  };

  const onSmtpSettingsSubmit = async (data: TSmtpSettingsFormSchema) => {
    try {
      await updateSmtpSettings({
        organisationId: organisation.id,
        data: {
          enabled: data.enabled,
          transportType: data.transportType,
          host: data.host,
          port: data.port,
          secure: data.secure,
          username: data.username,
          password: data.password || undefined,
          apiKey: data.apiKey || undefined,
          apiKeyUser: data.apiKeyUser,
          fromName: data.fromName,
          fromAddress: data.fromAddress,
        },
      });

      toast({
        title: t`SMTP settings updated`,
        description: t`Your SMTP settings have been updated`,
      });
    } catch {
      toast({
        title: t`Something went wrong!`,
        description: t`We were unable to update your SMTP settings at this time, please try again later`,
        variant: 'destructive',
      });
    }
  };

  const onTestSmtpConnection = async (
    data: TSmtpSettingsFormSchema & { testRecipientEmail: string },
  ) => {
    return testSmtpSettings({
      organisationId: organisation.id,
      data: {
        transportType: data.transportType,
        host: data.host,
        port: data.port,
        secure: data.secure,
        username: data.username || undefined,
        password: data.password || undefined,
        apiKey: data.apiKey || undefined,
        apiKeyUser: data.apiKeyUser || undefined,
        fromName: data.fromName || undefined,
        fromAddress: data.fromAddress,
        testRecipientEmail: data.testRecipientEmail,
      },
    });
  };

  if (isLoadingOrganisation || !organisationWithSettings || isLoadingSmtp) {
    return <SpinnerBox />;
  }

  return (
    <div className="max-w-2xl space-y-8">
      <section>
        <SettingsHeader
          title={t`Email Preferences`}
          subtitle={t`You can manage your email preferences here.`}
        />

        <EmailPreferencesForm
          canInherit={false}
          settings={organisationWithSettings.organisationGlobalSettings}
          onFormSubmit={onEmailPreferencesSubmit}
        />
      </section>

      <hr className="border-border" />

      <section>
        <SettingsHeader
          title={t`SMTP Configuration`}
          subtitle={t`Configure a custom SMTP server to send emails from your organisation.`}
        />

        <p className="mb-4 text-sm text-muted-foreground">
          <Trans>
            By default, emails are sent through SIGN8's email servers. You can configure your own
            SMTP server to send emails with your own domain and branding.
          </Trans>
        </p>

        <SmtpSettingsForm
          settings={smtpSettings ?? null}
          onFormSubmit={onSmtpSettingsSubmit}
          onTestConnection={onTestSmtpConnection}
        />
      </section>
    </div>
  );
}
