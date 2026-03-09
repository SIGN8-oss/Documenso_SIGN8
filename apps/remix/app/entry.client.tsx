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
