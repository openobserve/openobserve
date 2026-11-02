// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { computed, type Ref } from "vue";
import type {
  FilterBarExtraRow,
  FilterBarExtraSection,
} from "@/components/filterBar/QueryFilterBar.types";
import { relativeTimeText } from "@/lib/core/Table/cells/relativeTime";
import type { HistorySource, HistoryStatus, QueryHistoryEntry } from "@/services/query_history";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  buildRecents,
  defaultRestoreTime,
  type RecentRow,
  type RestoreTime,
} from "@/utils/queryHistory/recentSearches";
import { useRecentEntryText } from "./useRecentEntryText";
import {
  useRecentFailedCount,
  useRecentSearches,
  useRecentSearchesList,
} from "./useRecentSearches";

type PickEvent = MouseEvent | KeyboardEvent;

interface RecentFilterOptions {
  /** Fetches while true, so a bar never opened costs nothing. */
  active: Ref<boolean>;
  /** Offered while there is no history yet. */
  examples: Ref<string[]>;
  run: (entry: QueryHistoryEntry, when: RestoreTime) => void;
  load: (entry: QueryHistoryEntry, when: RestoreTime) => void;
  viewAll: (status: HistoryStatus | null) => void;
  example: (query: string) => void;
}

/** The focus dropdown's list as rows of the filter builder's picker. */
export const useRecentFilterSuggestions = (source: HistorySource, options: RecentFilterOptions) => {
  const { t } = useI18nTyped();
  const { zone } = useRecentEntryText();
  const { enabled } = useRecentSearches();
  const list = useRecentSearchesList(source, options.active);
  const failed = useRecentFailedCount(source, options.active);

  const whenFor = (entry: QueryHistoryEntry) => defaultRestoreTime(entry, Date.now(), zone.value);

  const entryRow = ({ entry, starred }: RecentRow): FilterBarExtraRow => ({
    key: `recent-${entry.id}`,
    label: raw(entry.query.replace(/\s+/g, " ").trim()),
    detail: raw(relativeTimeText(entry.updated_at / 1000, Date.now())),
    icon: starred ? "star" : "history",
    mono: true,
  });

  const built = computed(() => {
    const rows: FilterBarExtraRow[] = [];
    const actions = new Map<string, (event: PickEvent) => void>();
    const add = (row: FilterBarExtraRow, action: (event: PickEvent) => void) => {
      rows.push(row);
      actions.set(row.key, action);
    };
    if (!enabled.value || !list.isSuccess.value) return { rows, actions };

    const { pinnedFailure, rows: recents } = buildRecents(list.data.value ?? []);
    // A failed row always loads, since running it again fails again.
    if (pinnedFailure) {
      const { entry } = pinnedFailure;
      add({ ...entryRow(pinnedFailure), icon: "error", detail: t("recentSearches.failed") }, () =>
        options.load(entry, whenFor(entry)),
      );
    }
    for (const row of recents) {
      const { entry } = row;
      add(entryRow(row), (event) =>
        (event.shiftKey ? options.load : options.run)(entry, whenFor(entry)),
      );
    }
    if (!rows.length) {
      options.examples.value.forEach((query, index) =>
        add(
          { key: `recent-example-${index}`, label: raw(query), icon: "lightbulb", mono: true },
          () => options.example(query),
        ),
      );
      return { rows, actions };
    }
    add({ key: "recent-view-all", label: t("recentSearches.viewAll"), icon: "history" }, () =>
      options.viewAll(null),
    );
    // The server counts the pinned failure too.
    const failures = Math.max(0, (failed.data.value ?? 0) - (pinnedFailure ? 1 : 0));
    if (failures) {
      add(
        { key: "recent-view-failed", label: t("recentSearches.failedCount", { count: failures }) },
        () => options.viewAll("error"),
      );
    }
    return { rows, actions };
  });

  const section = computed<FilterBarExtraSection | undefined>(() =>
    built.value.rows.length
      ? { title: t("recentSearches.title"), rows: built.value.rows }
      : undefined,
  );

  const pick = (key: string, event: PickEvent) => built.value.actions.get(key)?.(event);

  return { section, pick };
};
