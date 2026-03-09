import { useEffect, useRef, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Trans, useLingui } from '@lingui/react/macro';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { EmailTemplateType } from '@documenso/prisma/generated/types';
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
import { Switch } from '@documenso/ui/primitives/switch';
import { Textarea } from '@documenso/ui/primitives/textarea';
import { useToast } from '@documenso/ui/primitives/use-toast';

const ZEmailTemplateFormSchema = z.object({
  enabled: z.boolean(),
  subject: z.string().nullable(),
  body: z.string().nullable(),
});

export type TEmailTemplateFormSchema = z.infer<typeof ZEmailTemplateFormSchema>;

export type EmailTemplateData = {
  type: EmailTemplateType;
  enabled: boolean;
  subject: string | null;
  body: string | null;
  isCustom: boolean;
  defaultSubject: string;
  defaultBody: string;
  label: string;
  description: string;
  variables: Record<string, string>;
};

export type EmailTemplateFormProps = {
  template: EmailTemplateData;
  onFormSubmit: (data: TEmailTemplateFormSchema) => Promise<void>;
  onReset: () => Promise<void>;
  onPreview: (subject: string, body: string | undefined) => void;
};

export const EmailTemplateForm = ({
  template,
  onFormSubmit,
  onReset,
  onPreview,
}: EmailTemplateFormProps) => {
  const { t } = useLingui();
  const { toast } = useToast();
  const [isResetting, setIsResetting] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const form = useForm<TEmailTemplateFormSchema>({
    defaultValues: {
      enabled: template.enabled,
      subject: template.subject,
      body: template.body,
    },
    resolver: zodResolver(ZEmailTemplateFormSchema),
  });

  const enabled = form.watch('enabled');
  const subject = form.watch('subject');
  const body = form.watch('body');

  // Reset form when template changes
  useEffect(() => {
    form.reset({
      enabled: template.enabled,
      subject: template.subject,
      body: template.body,
    });
  }, [template, form]);

  const handleReset = async () => {
    setIsResetting(true);
    try {
      await onReset();
      form.reset({
        enabled: true,
        subject: null,
        body: null,
      });
      toast({
        title: t`Template reset`,
        description: t`The template has been reset to default.`,
      });
    } catch {
      toast({
        title: t`Reset failed`,
        description: t`Failed to reset the template.`,
        variant: 'destructive',
      });
    } finally {
      setIsResetting(false);
    }
  };

  const insertVariable = (variableName: string, target: 'subject' | 'body') => {
    const variable = `{${variableName}}`;
    const ref = target === 'subject' ? subjectRef.current : bodyRef.current;
    const fieldName = target === 'subject' ? 'subject' : 'body';
    const currentValue = form.getValues(fieldName) || '';

    if (ref) {
      const start = ref.selectionStart || currentValue.length;
      const end = ref.selectionEnd || currentValue.length;
      const newValue = currentValue.slice(0, start) + variable + currentValue.slice(end);
      form.setValue(fieldName, newValue);

      // Move cursor after inserted variable
      setTimeout(() => {
        if (ref) {
          const newPosition = start + variable.length;
          ref.setSelectionRange(newPosition, newPosition);
          ref.focus();
        }
      }, 0);
    } else {
      form.setValue(fieldName, currentValue + variable);
    }
  };

  const handlePreview = () => {
    onPreview(subject || template.defaultSubject, body || template.defaultBody);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onFormSubmit)}>
        <fieldset className="flex h-full flex-col gap-y-6" disabled={form.formState.isSubmitting}>
          <div className="rounded-lg border p-4">
            <h3 className="mb-2 font-semibold">{template.label}</h3>
            <p className="text-sm text-muted-foreground">{template.description}</p>
          </div>

          <FormField
            control={form.control}
            name="enabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">
                    <Trans>Enable Template</Trans>
                  </FormLabel>
                  <FormDescription>
                    <Trans>When disabled, the default template will be used.</Trans>
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
              <div className="rounded-lg border p-4">
                <h4 className="mb-2 text-sm font-medium">
                  <Trans>Available Variables</Trans>
                </h4>
                <p className="mb-3 text-xs text-muted-foreground">
                  <Trans>Click a variable to insert it at the cursor position.</Trans>
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(template.variables).map(([name, description]) => (
                    <div key={name} className="flex gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => insertVariable(name, 'subject')}
                        title={`${description} (insert in subject)`}
                        className="h-7 px-2 text-xs"
                      >
                        {`{${name}}`}
                        <span className="ml-1 text-muted-foreground">S</span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => insertVariable(name, 'body')}
                        title={`${description} (insert in body)`}
                        className="h-7 px-2 text-xs"
                      >
                        {`{${name}}`}
                        <span className="ml-1 text-muted-foreground">B</span>
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <FormField
                control={form.control}
                name="subject"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <Trans>Subject</Trans>
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        ref={subjectRef}
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value || null)}
                        placeholder={template.defaultSubject}
                      />
                    </FormControl>
                    <FormDescription>
                      <Trans>Leave empty to use the default subject.</Trans>
                      <span className="ml-2 text-muted-foreground">
                        ({(field.value ?? '').length}/200)
                      </span>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="body"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <Trans>Body</Trans>
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        ref={bodyRef}
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value || null)}
                        placeholder={template.defaultBody}
                        rows={6}
                      />
                    </FormControl>
                    <FormDescription>
                      <Trans>Leave empty to use the default body.</Trans>
                      <span className="ml-2 text-muted-foreground">
                        ({(field.value ?? '').length}/2000)
                      </span>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}

          <div className="flex flex-row justify-between">
            <div className="flex gap-2">
              {template.isCustom && (
                <Button type="button" variant="outline" onClick={handleReset} loading={isResetting}>
                  <Trans>Reset to Default</Trans>
                </Button>
              )}
              <Button type="button" variant="secondary" onClick={handlePreview}>
                <Trans>Preview</Trans>
              </Button>
            </div>
            <Button type="submit" loading={form.formState.isSubmitting}>
              <Trans>Save Template</Trans>
            </Button>
          </div>
        </fieldset>
      </form>
    </Form>
  );
};
