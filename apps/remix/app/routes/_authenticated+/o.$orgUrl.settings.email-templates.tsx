import { useState } from 'react';

import { Trans, useLingui } from '@lingui/react/macro';

import { useCurrentOrganisation } from '@documenso/lib/client-only/providers/organisation';
import type { EmailTemplateType } from '@documenso/prisma/generated/types';
import { trpc } from '@documenso/trpc/react';
import { Badge } from '@documenso/ui/primitives/badge';
import { SpinnerBox } from '@documenso/ui/primitives/spinner';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { EmailTemplatePreviewDialog } from '~/components/dialogs/email-template-preview-dialog';
import {
  type EmailTemplateData,
  EmailTemplateForm,
  type TEmailTemplateFormSchema,
} from '~/components/forms/email-template-form';
import { SettingsHeader } from '~/components/general/settings-header';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Email Templates');
}

export default function OrganisationSettingsEmailTemplates() {
  const { t } = useLingui();
  const { toast } = useToast();

  const organisation = useCurrentOrganisation();
  const trpcUtils = trpc.useUtils();

  const [selectedTemplateType, setSelectedTemplateType] = useState<EmailTemplateType | null>(null);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{
    subject: string;
    body: string | undefined;
    label: string;
  } | null>(null);

  const { data: templates, isLoading: isLoadingTemplates } =
    trpc.organisation.emailTemplate.getAll.useQuery({
      organisationId: organisation.id,
    });

  const { mutateAsync: upsertTemplate } = trpc.organisation.emailTemplate.upsert.useMutation({
    onSuccess: () => {
      void trpcUtils.organisation.emailTemplate.getAll.invalidate({
        organisationId: organisation.id,
      });
    },
  });

  const { mutateAsync: deleteTemplate } = trpc.organisation.emailTemplate.delete.useMutation({
    onSuccess: () => {
      void trpcUtils.organisation.emailTemplate.getAll.invalidate({
        organisationId: organisation.id,
      });
    },
  });

  const { mutateAsync: sendExampleEmail } =
    trpc.organisation.emailTemplate.sendExample.useMutation();

  const { data: previewResult } = trpc.organisation.emailTemplate.preview.useQuery(
    {
      type: selectedTemplateType!,
      subject: previewData?.subject ?? '',
      body: previewData?.body,
    },
    {
      enabled: !!selectedTemplateType && !!previewData,
    },
  );

  const selectedTemplate = templates?.find((t) => t.type === selectedTemplateType);

  const handleTemplateSubmit = async (data: TEmailTemplateFormSchema) => {
    if (!selectedTemplateType) {
      return;
    }

    try {
      await upsertTemplate({
        organisationId: organisation.id,
        type: selectedTemplateType,
        data: {
          enabled: data.enabled,
          subject: data.subject,
          body: data.body,
        },
      });

      toast({
        title: t`Template saved`,
        description: t`Your email template has been updated.`,
      });
    } catch {
      toast({
        title: t`Error`,
        description: t`Failed to save the template. Please try again.`,
        variant: 'destructive',
      });
    }
  };

  const handleTemplateReset = async () => {
    if (!selectedTemplateType) {
      return;
    }

    await deleteTemplate({
      organisationId: organisation.id,
      type: selectedTemplateType,
    });
  };

  const handlePreview = (subject: string, body: string | undefined) => {
    if (!selectedTemplate) {
      return;
    }

    setPreviewData({
      subject,
      body,
      label: selectedTemplate.label,
    });
    setPreviewDialogOpen(true);
  };

  const handleSendExample = async (recipientEmail: string) => {
    if (!selectedTemplateType || !previewData) {
      return { success: false, error: 'No template selected' };
    }

    try {
      const result = await sendExampleEmail({
        organisationId: organisation.id,
        templateType: selectedTemplateType,
        subject: previewData.subject,
        body: previewData.body,
        recipientEmail,
      });

      if (result.success) {
        toast({
          title: t`Example email sent`,
          description: t`The example email has been sent to ${recipientEmail}.`,
        });
      } else {
        toast({
          title: t`Failed to send email`,
          description: result.error || t`An unknown error occurred.`,
          variant: 'destructive',
        });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t`An unknown error occurred.`;

      toast({
        title: t`Failed to send email`,
        description: errorMessage,
        variant: 'destructive',
      });

      return { success: false, error: errorMessage };
    }
  };

  if (isLoadingTemplates) {
    return <SpinnerBox />;
  }

  return (
    <div className="max-w-4xl">
      <SettingsHeader
        title={t`Email Templates`}
        subtitle={t`Customize the emails sent from your organisation.`}
      />

      <p className="mb-6 text-sm text-muted-foreground">
        <Trans>
          Configure custom email templates for different notification types. You can use variables
          to personalize your emails.
        </Trans>{' '}
        <Trans>Example:</Trans> <code className="rounded bg-muted px-1">{'{{signer.name}}'}</code>,{' '}
        <code className="rounded bg-muted px-1">{'{{document.name}}'}</code>
      </p>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Template List */}
        <div className="lg:col-span-1">
          <div className="rounded-lg border">
            <div className="border-b p-3">
              <h3 className="font-semibold">
                <Trans>Templates</Trans>
              </h3>
            </div>
            <div className="divide-y">
              {templates?.map((template) => (
                <button
                  key={template.type}
                  type="button"
                  className={`flex w-full items-center justify-between p-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 ${
                    selectedTemplateType === template.type ? 'bg-gray-50 dark:bg-gray-800' : ''
                  }`}
                  onClick={() => setSelectedTemplateType(template.type)}
                >
                  <div className="flex-1">
                    <div className="text-sm font-medium">{template.label}</div>
                    <div className="text-xs text-muted-foreground">{template.description}</div>
                  </div>
                  <div className="ml-2">
                    {template.isCustom ? (
                      <Badge variant="default" className="text-xs">
                        <Trans>Custom</Trans>
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        <Trans>Default</Trans>
                      </Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Template Editor */}
        <div className="lg:col-span-2">
          {selectedTemplate ? (
            <div className="rounded-lg border p-6">
              <EmailTemplateForm
                template={selectedTemplate as EmailTemplateData}
                onFormSubmit={handleTemplateSubmit}
                onReset={handleTemplateReset}
                onPreview={handlePreview}
              />
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-lg border border-dashed">
              <div className="text-center">
                <p className="text-muted-foreground">
                  <Trans>Select a template from the list to edit it.</Trans>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Preview Dialog */}
      <EmailTemplatePreviewDialog
        open={previewDialogOpen}
        onOpenChange={setPreviewDialogOpen}
        subject={previewResult?.subject ?? previewData?.subject ?? ''}
        body={previewResult?.body ?? previewData?.body}
        templateLabel={previewData?.label ?? ''}
        onSendExample={handleSendExample}
      />
    </div>
  );
}
