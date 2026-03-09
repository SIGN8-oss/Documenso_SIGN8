import { useState } from 'react';

export type CopiedValue = string | null;
export type CopyFn = (_text: CopyValue, _blobType?: string) => Promise<boolean>;

type CopyValue = Promise<string> | string;

export function useCopyToClipboard(): [CopiedValue, CopyFn] {
  const [copiedText, setCopiedText] = useState<CopiedValue>(null);

  const copy: CopyFn = async (text, blobType = 'text/plain') => {
    const resolvedText = await text;

    // Only attempt modern Clipboard API in secure contexts (HTTPS).
    // Attempting it on HTTP consumes the user gesture context with a failed async
    // call, which then causes the legacy execCommand fallback to also fail.
    if (window.isSecureContext && navigator?.clipboard) {
      const isClipboardApiSupported = Boolean(
        typeof ClipboardItem !== 'undefined' && navigator.clipboard.write,
      );

      try {
        if (isClipboardApiSupported) {
          await handleClipboardApiCopy(resolvedText, blobType);
        } else {
          await navigator.clipboard.writeText(resolvedText);
        }

        setCopiedText(resolvedText);
        return true;
      } catch (error) {
        // Clipboard API failed, try legacy fallback
        console.warn('Clipboard API failed, trying legacy fallback', error);
      }
    }

    // Legacy fallback using execCommand for non-secure contexts (HTTP)
    try {
      const success = handleLegacyCopy(resolvedText);
      if (success) {
        setCopiedText(resolvedText);
        return true;
      }
    } catch (error) {
      console.warn('Legacy copy failed', error);
    }

    console.warn('All copy methods failed');
    setCopiedText(null);
    return false;
  };

  /**
   * Handle copying values to the clipboard using the ClipboardItem API.
   *
   * Works in all browsers except FireFox.
   *
   * https://caniuse.com/mdn-api_clipboarditem
   */
  const handleClipboardApiCopy = async (value: string, blobType = 'text/plain') => {
    const blob = new Blob([value], { type: blobType });
    await navigator.clipboard.write([new ClipboardItem({ [blobType]: blob })]);
  };

  /**
   * Legacy fallback for copying text in non-secure contexts (HTTP).
   * Uses a temporary textarea and document.execCommand('copy').
   */
  const handleLegacyCopy = (value: string): boolean => {
    const textArea = document.createElement('textarea');
    textArea.value = value;

    // Avoid scrolling to bottom
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    let success = false;
    try {
      success = document.execCommand('copy');
    } finally {
      document.body.removeChild(textArea);
    }

    return success;
  };

  return [copiedText, copy];
}
