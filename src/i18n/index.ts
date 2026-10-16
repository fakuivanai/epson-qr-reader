import * as i18n from "@solid-primitives/i18n";
import { createSignal } from "solid-js";
import type { ParseError } from "../epson";
import { en } from "./en";
import { es } from "./es";

const dictionaries = { en, es };
export type Locale = keyof typeof dictionaries;
export const locales = Object.keys(dictionaries) as Locale[];

const isLocale = (value: string): value is Locale => value in dictionaries;
const STORAGE_KEY = "locale";

/** First supported language in the browser's preference list, English otherwise. */
function negotiate(preferences: readonly string[]): Locale {
  for (const tag of preferences) {
    const language = new Intl.Locale(tag).language;
    if (isLocale(language)) return language;
  }
  return "en";
}

function storedLocale(): Locale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value !== null && isLocale(value) ? value : null;
  } catch {
    // Storage can be blocked, for example in private windows.
    return null;
  }
}

const [locale, setLocaleSignal] = createSignal<Locale>(storedLocale() ?? negotiate(navigator.languages));
export { locale };

export function setLocale(next: Locale) {
  setLocaleSignal(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The choice still applies for this visit.
  }
}

const flattened = { en: i18n.flatten(en), es: i18n.flatten(es) } satisfies Record<Locale, unknown>;
export const t = i18n.translator(() => flattened[locale()], i18n.resolveTemplate);

export const formatTime = (date: Date) =>
  new Intl.DateTimeFormat(locale(), { timeStyle: "medium" }).format(date);

export function describeParseError(error: ParseError): string {
  switch (error.kind) {
    case "too-short":
      return t("error.tooShort");
    case "length-exceeds-data":
    case "missing-end-marker":
      return t("error.notEpson");
    case "unsupported-version":
      return t("error.unsupportedVersion", { version: error.version });
    case "reserved-bit-set":
    case "unknown-record-type":
      return t("error.malformed");
    case "truncated":
      return t("error.truncated");
    case "string-too-long":
      return t("error.tooLong");
  }
}
