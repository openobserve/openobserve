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

// Type-level i18n enforcement — the half ESLint can't do.
//
// Lint guards <template>. It cannot guard a string in <script> (a column `label`,
// a toast `message`), because deciding "is this user-facing?" from the string alone
// is guesswork. Declaring the field `I18nText` moves that decision to the author.
// Nothing here is hand-maintained: `I18nKey` derives from en-US.json at compile time.
//
// See I18N_ENFORCEMENT_GUIDE.md for the full design.

import type { JsonPaths } from "@intlify/core-base";
import { useI18n } from "vue-i18n";

import i18nInstance from "@/locales";

import type enLocale from "@/locales/languages/en-US.json";

/**
 * Every dotted leaf path in en-US.json, e.g. `"common.save"`. Derived, never
 * hand-written. Use for fields storing an i18n KEY as data (`titleKey`), not text.
 *
 * `JsonPaths` is vue-i18n's own key-path type, so the vocabulary matches the
 * library's exactly. Caveat: for the one array-valued message it also admits array
 * members (`…Aliases.length`); that key is read via `tm()`, so nothing is affected.
 */
export type I18nKey = JsonPaths<typeof enLocale>;

declare const i18nTextBrand: unique symbol;

/**
 * A string that has passed through translation. A plain literal is not assignable,
 * so `label: "Save"` is a compile error while `label: t("common.save")` passes.
 * Composed forms (`"a" + b`, ternaries, templates) widen to `string` and fail too.
 */
export type I18nText = string & { readonly [i18nTextBrand]: true };

/**
 * The opt-out: marks a string as deliberately untranslated (code token, unit,
 * field name). Preferred over an eslint-disable — it is type-checked, survives
 * refactors, and `grep -rn "raw(" src` lists every exemption in the app.
 *
 * @example { label: raw("trace_id"), field: "trace_id" } // a field name, not prose
 */
export const raw = (value: string | number | null | undefined): I18nText =>
  (value ?? "") as unknown as I18nText;

/**
 * `t()` — branded text out.
 *
 * The key stays permissive (`I18nKey | (string & {})`) ON PURPOSE: `I18nKey` gives
 * autocomplete, while the open half keeps the dynamic call sites
 * (`` t(`about.feature_${id}`) ``) compiling. Do not tighten it — literal keys are
 * already validated by `no-missing-keys` at lint time, and keys stored as *data*
 * use the strict `I18nKey`, which is the case lint cannot see.
 */
export type TranslateFn = {
  (key: I18nKey | (string & {})): I18nText;
  (key: I18nKey | (string & {}), named: Record<string, unknown>): I18nText;
  (key: I18nKey | (string & {}), plural: number): I18nText;
  (key: I18nKey | (string & {}), named: Record<string, unknown>, plural: number): I18nText;
};

/** The vue-i18n composer with `t` retyped to return {@link I18nText}. */
export type TypedComposer = Omit<ReturnType<typeof useI18n>, "t"> & { t: TranslateFn };

/**
 * `useI18n()` with `t` retyped. A pure type-level cast — the same composer, no
 * runtime wrapper, so reactivity is unchanged. Use instead of `useI18n()`.
 */
export function useI18nTyped(): TypedComposer {
  return useI18n() as unknown as TypedComposer;
}

/**
 * `t()` for code OUTSIDE a setup context (utils, service-layer error handling),
 * where `useI18n()` would throw. Prefer `useI18nTyped()` inside components so the
 * locale stays reactive to the component's scope.
 */
export const gt: TranslateFn = ((...args: unknown[]) =>
  (i18nInstance.global as unknown as { t: (...a: unknown[]) => string }).t(
    ...args,
  )) as unknown as TranslateFn;
