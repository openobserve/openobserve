// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Type-level i18n enforcement.
//
// The ESLint rules (`vue/no-bare-strings-in-template`, `local/no-bare-bound-text-props`,
// `@intlify/vue-i18n/no-missing-keys`) guard <template>. They cannot guard a string
// that lives in <script> — a table column's `label`, a toast `message`, an i18n key
// stored as data — because deciding "is this string user-facing?" from the string
// itself is guesswork.
//
// This module moves that decision to the type declaration, where the author already
// knows the answer. It follows the same pattern the library already uses for icons
// (`iconLeft?: IconName`, where `IconName = keyof typeof iconRegistry`): a constrained
// type, derived from a source of truth, enforced by `npm run type-check:app`.
//
// Nothing here needs a maintained list — `I18nKey` is derived from en-US.json at
// compile time, so adding a key makes it instantly valid and deleting one turns every
// reference into a type error.

import { useI18n } from "vue-i18n";

import type enLocale from "@/locales/languages/en-US.json";

/**
 * Every dotted leaf path in en-US.json, e.g. `"common.save"`.
 *
 * Derived, never hand-written. Use for any field that stores an i18n KEY as data
 * (`titleKey`, `labelKey`, …) rather than the resolved text.
 */
export type I18nKey = Leaves<typeof enLocale>;

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? P extends ""
      ? K
      : `${P}.${K}`
    : Leaves<T[K], P extends "" ? K : `${P}.${K}`>;
}[keyof T & string];

declare const i18nTextBrand: unique symbol;

/**
 * A string that has passed through translation.
 *
 * A plain string literal is NOT assignable to it, so declaring a field as
 * `I18nText` makes `label: "Save"` a compile error while `label: t("common.save")`
 * passes. Composed forms (`"a" + b`, `cond ? "Yes" : "No"`, `` `a ${b}` ``) are
 * rejected too — they all widen to `string`.
 */
export type I18nText = string & { readonly [i18nTextBrand]: true };

/**
 * Marks a string as deliberately untranslated — a code token, unit, identifier or
 * field name that must read identically in every language.
 *
 * This is the opt-out. Prefer it to an eslint-disable comment: it is type-checked,
 * survives refactors, and `grep -rn "raw(" src` lists every exemption in the app.
 *
 * @example
 * const columns = [
 *   { label: t("logs.timestamp"), field: "ts" },
 *   { label: raw("trace_id"),     field: "trace_id" }, // a field name, not prose
 * ];
 */
export const raw = (value: string): I18nText => value as I18nText;

/** `t()` narrowed to real keys in, branded text out. */
export type TranslateFn = (key: I18nKey, named?: Record<string, unknown>) => I18nText;

/**
 * `useI18n()` with the key/return types above.
 *
 * Drop-in for `const { t } = useI18n()` at any call site that assigns into an
 * `I18nText` field. Call sites that do not need the stricter typing can keep using
 * `useI18n()` directly — adoption is incremental and per-file.
 */
export function useI18nTyped(): { t: TranslateFn } {
  const { t } = useI18n();
  return { t: t as unknown as TranslateFn };
}
