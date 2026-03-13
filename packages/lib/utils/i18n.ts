import type { I18n, MessageDescriptor } from '@lingui/core';
import { i18n } from '@lingui/core';
import type { MacroMessageDescriptor } from '@lingui/core/macro';

import type { I18nLocaleData, SupportedLanguageCodes } from '../constants/i18n';
import { APP_I18N_OPTIONS } from '../constants/i18n';
import { env } from './env';

// Statically analyzed by Vite to generate lazy translation chunks for the client build.
// In the rollup server bundle this call is replaced with {} by the stubImportMetaGlob plugin.
const translationModules = import.meta.glob<{ messages: Record<string, string> }>(
  '../translations/*/web.{po,mjs}',
);

export async function getTranslations(locale: string) {
  // Normalise locale: "de-DE" → "de", "pt-BR" stays "pt-BR"
  const candidates = [locale, locale.split('-')[0]];

  // Vite client path: use the pre-analyzed glob map (non-empty after Vite transform).
  if (Object.keys(translationModules).length > 0) {
    for (const candidate of candidates) {
      for (const ext of ['po', 'mjs']) {
        const key = `../translations/${candidate}/web.${ext}`;

        if (translationModules[key]) {
          const mod = await translationModules[key]();
          return mod.messages;
        }
      }
    }

    for (const ext of ['po', 'mjs']) {
      const key = `../translations/en/web.${ext}`;

      if (translationModules[key]) {
        const mod = await translationModules[key]();
        return mod.messages;
      }
    }
  }

  // Server/rollup path: translationModules is {} (stubbed), load from filesystem.
  const extension = env('NODE_ENV') === 'development' ? 'po' : 'mjs';

  for (const candidate of candidates) {
    try {
      const { messages } = await import(
        /* @vite-ignore */ `../translations/${candidate}/web.${extension}`
      );
      return messages;
    } catch {
      // locale not found, try next candidate
    }
  }

  const { messages } = await import(/* @vite-ignore */ `../translations/en/web.${extension}`);
  return messages;
}

export async function dynamicActivate(locale: string) {
  const messages = await getTranslations(locale);

  i18n.loadAndActivate({ locale, messages });
}

const parseLanguageFromLocale = (locale: string): SupportedLanguageCodes | null => {
  const [language, _country] = locale.split('-');

  const foundSupportedLanguage = APP_I18N_OPTIONS.supportedLangs.find(
    (lang): lang is SupportedLanguageCodes => lang === language,
  );

  if (!foundSupportedLanguage) {
    return null;
  }

  return foundSupportedLanguage;
};

/**
 * Extracts the language from the `accept-language` header.
 */
export const extractLocaleDataFromHeaders = (
  headers: Headers,
): { lang: SupportedLanguageCodes | null; locales: string[] } => {
  const headerLocales = (headers.get('accept-language') ?? '').split(',');

  const language = parseLanguageFromLocale(headerLocales[0]);

  return {
    lang: language,
    locales: [headerLocales[0]],
  };
};

type ExtractLocaleDataOptions = {
  headers: Headers;
};

/**
 * Extract the supported language from the header.
 *
 * Will return the default fallback language if not found.
 */
export const extractLocaleData = ({ headers }: ExtractLocaleDataOptions): I18nLocaleData => {
  const headerLocales = (headers.get('accept-language') ?? '').split(',');

  const unknownLanguages = headerLocales
    .map((locale) => parseLanguageFromLocale(locale))
    .filter((value): value is SupportedLanguageCodes => value !== null);

  // Filter out locales that are not valid.
  const languages = (unknownLanguages ?? []).filter((language) => {
    try {
      new Intl.Locale(language);
      return true;
    } catch {
      return false;
    }
  });

  return {
    lang: languages[0] || APP_I18N_OPTIONS.sourceLang,
    locales: headerLocales,
  };
};

export const parseMessageDescriptor = (_: I18n['_'], value: string | MessageDescriptor) => {
  return typeof value === 'string' ? value : _(value);
};

export const parseMessageDescriptorMacro = (
  t: (descriptor: MacroMessageDescriptor) => string,
  value: string | MessageDescriptor,
) => {
  return typeof value === 'string' ? value : t(value);
};
