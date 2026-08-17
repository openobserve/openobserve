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

/**
 * The dimension-filter plumbing every DBM list page shares.
 *
 * The Databases, Samples and Top-queries toolbars each build a set of
 * `DbmScopeFilter` entries, and every entry's `onChange` used to repeat the
 * same four lines: write the ref, publish the scope to the URL, reload. Eleven
 * copies of that handler is eleven chances for one of them to drop the URL
 * write — which narrows the table while the route (and everything reading it:
 * the shell's badge fan-out, a shared link, a reload) still describes the
 * unfiltered question.
 *
 * `createDbmFilterEntry` owns the handler ONCE per page: the page states what
 * happens after a filter changes (`syncUrl(); load();`) a single time, and
 * each entry shrinks to its actual content — which dimension, which ref,
 * which options.
 */

import type { Ref } from "vue";

import type { DbmScopeFilter } from "@/components/dbm/DbmScopeFilters.vue";
import { raw, type I18nText } from "@/types/i18n";

/**
 * Dropdown options from whatever values the current response carries —
 * deduplicated, blanks dropped, `raw` because a data value is not prose.
 */
// `null` is accepted alongside `undefined` because the server-vantage rows
// spell an absent dimension as `null` (`db_instance: string | null`), and the
// fallback lists are unioned into these options. The runtime filter below
// already drops both — only the type was narrower than the behaviour.
export const optionsFrom = (
  values: (string | null | undefined)[],
): { value: string; label: I18nText }[] =>
  [...new Set(values.filter((v): v is string => !!v))].map((value) => ({
    value,
    label: raw(value),
  }));

/** One entry's actual content — everything except the shared handler. */
export interface DbmFilterEntrySpec {
  key: string;
  /** Plain-language name of the axis — see `DbmScopeFilter.dimension`. */
  dimension: I18nText;
  placeholder: I18nText;
  options: { value: string; label: I18nText }[];
  /** The page ref the filter reads and writes. Cleared to `null`, never `""`. */
  model: Ref<string | null>;
}

/**
 * The per-page entry builder. `apply` is what a change triggers — the page
 * passes its `syncUrl(); load();` pair once, so no entry can forget the URL
 * half and leave the route describing a different table than the one shown.
 */
export const createDbmFilterEntry =
  (apply: () => void) =>
  (spec: DbmFilterEntrySpec): DbmScopeFilter => ({
    key: spec.key,
    dimension: spec.dimension,
    value: spec.model.value,
    placeholder: spec.placeholder,
    options: spec.options,
    onChange: (value) => {
      spec.model.value = (value as string) || null;
      apply();
    },
  });
