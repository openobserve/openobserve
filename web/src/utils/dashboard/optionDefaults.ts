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

import type { I18nText, TranslateFn } from "@/types/i18n";

// A type alias, not an interface, so a list of these stays assignable to OSelect's indexable option type.
export type ChoiceOption<V = unknown> = { label: I18nText; value: V };

/** "Default (value)": names what an unset option falls back to. */
export const defaultHint = (t: TranslateFn, value: I18nText | string | number): I18nText =>
  t("dashboard.defaultWithValue", { value });

/** "Default: value" for the placeholder of a field whose empty state falls back to `value`. */
export const defaultPlaceholder = (t: TranslateFn, value: I18nText | string | number): I18nText =>
  t("dashboard.defaultPlaceholder", { value });

/** "Default (auto from data)" for a default the chart works out from the query result. */
export const defaultFromData = (t: TranslateFn): I18nText =>
  defaultHint(t, t("dashboard.defaultAutoFromData"));

/** The Default entry of a choice list, labelled with the option the renderer falls back to; `sentinel` means unset. */
export const defaultChoice = <S>(
  t: TranslateFn,
  sentinel: S,
  options: readonly ChoiceOption[],
  fallback: unknown,
): ChoiceOption<S> => {
  const shown = options.find((option) => option.value === fallback)?.label;
  return { label: shown ? defaultHint(t, shown) : t("dashboard.default"), value: sentinel };
};

/** `options` with the Default entry for `fallback` in front. */
export const withDefaultChoice = <S, O extends ChoiceOption>(
  t: TranslateFn,
  sentinel: S,
  options: readonly O[],
  fallback: unknown,
): (O | ChoiceOption<S>)[] => [defaultChoice(t, sentinel, options, fallback), ...options];
