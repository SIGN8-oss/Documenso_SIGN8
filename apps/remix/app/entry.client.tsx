import { StrictMode, startTransition, useEffect } from 'react';

import { i18n } from '@lingui/core';
import { detect, fromHtmlTag } from '@lingui/detect-locale';
import { I18nProvider } from '@lingui/react';
import posthog from 'posthog-js';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';

import { extractPostHogConfig } from '@documenso/lib/constants/feature-flags';
import { dynamicActivate } from '@documenso/lib/utils/i18n';

import './utils/polyfills/promise-with-resolvers';

const CONSOLE_METHODS_TO_SUPPRESS: Array<keyof Console> = [
  'error',
  'warn',
  'log',
  'info',
  'debug',
  'trace',
  'table',
  'group',
  'groupCollapsed',
  'groupEnd',
];

const suppressFrontendConsoleInProd = () => {
  if (typeof window === 'undefined' || window.__ENV__?.ENVIRONMENT !== 'PROD') {
    return;
  }

  const noop = () => undefined;

  CONSOLE_METHODS_TO_SUPPRESS.forEach((method) => {
    if (typeof console[method] === 'function') {
      Object.defineProperty(console, method, {
        configurable: true,
        writable: true,
        value: noop,
      });
    }
  });

  window.onerror = () => true;
  window.addEventListener('error', (event) => {
    event.preventDefault();
  });
  window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
  });
};

suppressFrontendConsoleInProd();

// Suppress known React hydration warnings from Radix UI components
// These warnings don't affect functionality - they occur because Radix UI
// generates dynamic IDs that differ between server and client
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const originalError = console.error;
  const originalWarn = console.warn;

  const suppressedPatterns = [
    /Prop `(id|aria-controls|data-theme)` did not match/,
    /Function components cannot be given refs/,
    /Download the React DevTools/,
    /Warning: Prop .* did not match\. Server:/,
    /RenderingCancelledException/,
    /File prop passed to <Document \/> changed/,
  ];

  const shouldSuppress = (args: unknown[]) => {
    const message = args[0];
    if (typeof message !== 'string') return false;
    return suppressedPatterns.some((pattern) => pattern.test(message));
  };

  console.error = (...args: unknown[]) => {
    if (!shouldSuppress(args)) {
      originalError.apply(console, args);
    }
  };

  console.warn = (...args: unknown[]) => {
    if (!shouldSuppress(args)) {
      originalWarn.apply(console, args);
    }
  };

  // Suppress unhandled promise rejections for known non-critical errors
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason?.name === 'RenderingCancelledException') {
      event.preventDefault();
    }
  });
}

function PosthogInit() {
  const postHogConfig = extractPostHogConfig();

  useEffect(() => {
    if (postHogConfig) {
      posthog.init(postHogConfig.key, {
        api_host: postHogConfig.host,
        capture_exceptions: true,
      });
    }
  }, []);

  return null;
}

async function main() {
  suppressFrontendConsoleInProd();

  const locale = detect(fromHtmlTag('lang')) || 'en';

  await dynamicActivate(locale);

  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <I18nProvider i18n={i18n}>
          <HydratedRouter />
        </I18nProvider>

        <PosthogInit />
      </StrictMode>,
    );
  });
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
