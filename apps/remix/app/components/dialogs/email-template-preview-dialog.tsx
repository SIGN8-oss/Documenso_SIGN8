import { useState } from 'react';

import { Trans, useLingui } from '@lingui/react/macro';
import type * as DialogPrimitive from '@radix-ui/react-dialog';
import { Loader2Icon, SendIcon } from 'lucide-react';

import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@documenso/ui/primitives/dialog';
import { Input } from '@documenso/ui/primitives/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@documenso/ui/primitives/tabs';

export type EmailTemplatePreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: string;
  body: string | undefined;
  templateLabel: string;
  onSendExample?: (recipientEmail: string) => Promise<{ success: boolean; error?: string }>;
} & Omit<DialogPrimitive.DialogProps, 'children' | 'open' | 'onOpenChange'>;

export const EmailTemplatePreviewDialog = ({
  open,
  onOpenChange,
  subject,
  body,
  templateLabel,
  onSendExample,
  ...props
}: EmailTemplatePreviewDialogProps) => {
  const { t } = useLingui();
  const [viewMode, setViewMode] = useState<'preview' | 'plain'>('preview');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleSendExample = async () => {
    if (!onSendExample || !recipientEmail) {
      return;
    }

    setIsSending(true);

    try {
      await onSendExample(recipientEmail);
    } finally {
      setIsSending(false);
    }
  };

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail);

  return (
    <Dialog {...props} open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <Trans>Email Preview - {templateLabel}</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Preview how your email will look with sample data.</Trans>
          </DialogDescription>
        </DialogHeader>

        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'preview' | 'plain')}>
          <TabsList>
            <TabsTrigger value="preview">
              <Trans>Preview</Trans>
            </TabsTrigger>
            <TabsTrigger value="plain">
              <Trans>Plain Text</Trans>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="preview" className="mt-4">
            <div className="rounded-lg border bg-white p-6 dark:bg-gray-900">
              <div className="border-b pb-4">
                <div className="text-sm text-muted-foreground">
                  <Trans>Subject:</Trans>
                </div>
                <div className="mt-1 font-semibold">{subject}</div>
              </div>
              {body && (
                <div className="prose mt-4 max-w-none dark:prose-invert">
                  <div className="whitespace-pre-wrap">{body}</div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="plain" className="mt-4">
            <div className="rounded-lg border bg-gray-50 p-4 font-mono text-sm dark:bg-gray-900">
              <div className="mb-4">
                <span className="text-muted-foreground">Subject: </span>
                {subject}
              </div>
              <hr className="my-2" />
              {body && <div className="whitespace-pre-wrap">{body}</div>}
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            <Trans>
              This preview uses sample data. Actual emails will contain real recipient and document
              information.
            </Trans>
          </p>
        </div>

        <DialogFooter className="flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          {onSendExample && (
            <div className="flex w-full flex-1 flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                type="email"
                placeholder={t`Recipient email address`}
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={handleSendExample}
                disabled={!isValidEmail || isSending}
              >
                {isSending ? (
                  <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <SendIcon className="mr-2 h-4 w-4" />
                )}
                <Trans>Send Example</Trans>
              </Button>
            </div>
          )}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            <Trans>Close</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
