import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Trans, useLingui } from '@lingui/react/macro';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { SmtpTransportType } from '@documenso/prisma/generated/types';
import { Button } from '@documenso/ui/primitives/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@documenso/ui/primitives/form/form';
import { Input } from '@documenso/ui/primitives/input';
import { PasswordInput } from '@documenso/ui/primitives/password-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@documenso/ui/primitives/select';
import { Switch } from '@documenso/ui/primitives/switch';
import { useToast } from '@documenso/ui/primitives/use-toast';

const ZSmtpSettingsFormSchema = z.object({
  enabled: z.boolean(),
  transportType: z.nativeEnum(SmtpTransportType),
  host: z.string(),
  port: z.coerce.number().min(1).max(65535),
  secure: z.boolean(),
  username: z.string(),
  password: z.string(),
  apiKey: z.string(),
  apiKeyUser: z.string(),
  fromName: z.string(),
  fromAddress: z.string().email().or(z.literal('')),
});

export type TSmtpSettingsFormSchema = z.infer<typeof ZSmtpSettingsFormSchema>;

export type SmtpSettingsData = {
  enabled: boolean;
  transportType: SmtpTransportType;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  passwordProvided: boolean;
  apiKeyProvided: boolean;
  apiKeyUser: string;
  fromName: string;
  fromAddress: string;
} | null;

export type SmtpSettingsFormProps = {
  settings: SmtpSettingsData;
  onFormSubmit: (data: TSmtpSettingsFormSchema) => Promise<void>;
  onTestConnection: (
    data: TSmtpSettingsFormSchema & { testRecipientEmail: string },
  ) => Promise<{ success: boolean; error?: string }>;
};

export const SmtpSettingsForm = ({
  settings,
  onFormSubmit,
  onTestConnection,
}: SmtpSettingsFormProps) => {
  const { t } = useLingui();
  const { toast } = useToast();
  const [testEmail, setTestEmail] = useState('');
  const [isTesting, setIsTesting] = useState(false);

  const form = useForm<TSmtpSettingsFormSchema>({
    defaultValues: {
      enabled: settings?.enabled ?? false,
      transportType: settings?.transportType ?? SmtpTransportType.SMTP_AUTH,
      host: settings?.host ?? '',
      port: settings?.port ?? 587,
      secure: settings?.secure ?? false,
      username: settings?.username ?? '',
      password: '',
      apiKey: '',
      apiKeyUser: settings?.apiKeyUser ?? 'apikey',
      fromName: settings?.fromName ?? '',
      fromAddress: settings?.fromAddress ?? '',
    },
    resolver: zodResolver(ZSmtpSettingsFormSchema),
  });

  const enabled = form.watch('enabled');
  const transportType = form.watch('transportType');
  const isSmtpApi = transportType === SmtpTransportType.SMTP_API;

  const handleTestConnection = async () => {
    if (!testEmail) {
      toast({
        title: t`Test email required`,
        description: t`Please enter an email address to send the test email to.`,
        variant: 'destructive',
      });
      return;
    }

    setIsTesting(true);

    try {
      const formValues = form.getValues();
      const result = await onTestConnection({
        ...formValues,
        testRecipientEmail: testEmail,
      });

      if (result.success) {
        toast({
          title: t`Test successful`,
          description: t`A test email has been sent to ${testEmail}.`,
        });
      } else {
        toast({
          title: t`Test failed`,
          description: result.error || t`Failed to send test email.`,
          variant: 'destructive',
        });
      }
    } catch {
      toast({
        title: t`Test failed`,
        description: t`An unexpected error occurred.`,
        variant: 'destructive',
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onFormSubmit)}>
        <fieldset
          className="flex h-full max-w-2xl flex-col gap-y-6"
          disabled={form.formState.isSubmitting}
        >
          <FormField
            control={form.control}
            name="enabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">
                    <Trans>Enable Custom SMTP</Trans>
                  </FormLabel>
                  <FormDescription>
                    <Trans>Use your own SMTP server to send emails from this organisation.</Trans>
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />

          {enabled && (
            <>
              <FormField
                control={form.control}
                name="transportType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <Trans>Transport Type</Trans>
                    </FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SmtpTransportType.SMTP_AUTH}>
                            <Trans>SMTP with Username/Password</Trans>
                          </SelectItem>
                          <SelectItem value={SmtpTransportType.SMTP_API}>
                            <Trans>SMTP with API Key</Trans>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription>
                      <Trans>Choose how to authenticate with your SMTP server.</Trans>
                    </FormDescription>
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="host"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <Trans>SMTP Host</Trans>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="smtp.example.com" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="port"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <Trans>SMTP Port</Trans>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} type="number" placeholder="587" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="secure"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">
                        <Trans>Use TLS/SSL</Trans>
                      </FormLabel>
                      <FormDescription>
                        <Trans>Enable secure connection (recommended for port 465).</Trans>
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              {isSmtpApi ? (
                <>
                  <FormField
                    control={form.control}
                    name="apiKeyUser"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <Trans>API Key User</Trans>
                        </FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="apikey" />
                        </FormControl>
                        <FormDescription>
                          <Trans>The username for API key authentication (usually "apikey").</Trans>
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="apiKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <Trans>API Key</Trans>
                        </FormLabel>
                        <FormControl>
                          <PasswordInput
                            {...field}
                            placeholder={
                              settings?.apiKeyProvided ? t`Leave blank to keep current` : undefined
                            }
                          />
                        </FormControl>
                        <FormDescription>
                          {settings?.apiKeyProvided && (
                            <Trans>
                              An API key is currently configured. Enter a new one to change it.
                            </Trans>
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              ) : (
                <>
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <Trans>Username</Trans>
                        </FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="your-email@example.com" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <Trans>Password</Trans>
                        </FormLabel>
                        <FormControl>
                          <PasswordInput
                            {...field}
                            placeholder={
                              settings?.passwordProvided
                                ? t`Leave blank to keep current`
                                : undefined
                            }
                          />
                        </FormControl>
                        <FormDescription>
                          {settings?.passwordProvided && (
                            <Trans>
                              A password is currently configured. Enter a new one to change it.
                            </Trans>
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="fromName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <Trans>From Name</Trans>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="My Organisation" />
                      </FormControl>
                      <FormDescription>
                        <Trans>The display name for outgoing emails.</Trans>
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="fromAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <Trans>From Address</Trans>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} type="email" placeholder="noreply@example.com" />
                      </FormControl>
                      <FormDescription>
                        <Trans>The sender email address.</Trans>
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="rounded-lg border p-4">
                <h4 className="mb-2 font-medium">
                  <Trans>Test Connection</Trans>
                </h4>
                <p className="mb-4 text-sm text-muted-foreground">
                  <Trans>Send a test email to verify your SMTP configuration.</Trans>
                </p>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder={t`test@example.com`}
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleTestConnection}
                    loading={isTesting}
                  >
                    <Trans>Send Test</Trans>
                  </Button>
                </div>
              </div>
            </>
          )}

          <div className="flex flex-row justify-end space-x-4">
            <Button type="submit" loading={form.formState.isSubmitting}>
              <Trans>Save Settings</Trans>
            </Button>
          </div>
        </fieldset>
      </form>
    </Form>
  );
};
