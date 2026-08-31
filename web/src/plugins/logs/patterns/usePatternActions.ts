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

import { ref, computed } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import { searchState } from "@/composables/useLogs/searchState";
import usePatterns from "@/composables/useLogs/usePatterns";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  extractConstantsFromPattern,
  escapeForMatchAll,
  patternSeverityKeyForPattern,
  type PatternSeverityKey,
} from "./patternUtils";
import { buildPrefillFromPatterns } from "@/utils/alerts/prefill/fromPatterns";
import type { AlertBuildOptions } from "@/ts/interfaces/alertPrefill";

/**
 * The severity chips' state, module-scoped so it is shared between the pattern
 * list that owns the chips and the alert builder that has to know which
 * patterns are actually on screen. A per-call ref would let the two disagree.
 * Mirrors how searchState keeps searchObj a singleton.
 */
const activeSeverities = ref<PatternSeverityKey[]>([]);

const setActiveSeverities = (next: PatternSeverityKey[]) => {
  activeSeverities.value = next;
};

/** The patterns the user can currently see — the chips narrow this set. */
const visiblePatterns = (all: any[]): any[] => {
  if (!activeSeverities.value.length) return all;
  const active = new Set(activeSeverities.value);
  return all.filter((p) => active.has(patternSeverityKeyForPattern(p)));
};

export const usePatternActions = () => {
  const store = useStore();
  const { t } = useI18nTyped();
  const { searchObj } = searchState();
  const { patternsState } = usePatterns(t);

  const selectedPattern = ref<any>(null);
  const showPatternDetails = ref(false);

  // The exact list being navigated — snapshotted at open time from the list the
  // user clicked (the severity-filtered view when a filter is active), so the
  // index, Next/Prev, and "X of Y" all agree. Falls back to the full pattern set
  // when the caller doesn't supply a list.
  const navPatterns = ref<any[]>([]);

  /** The list to navigate: the snapshot when there is one, otherwise the full
   * pattern set. Without the fallback, navigation silently does nothing if the
   * drawer's state was set without going through `openPatternDetails`. */
  const navigablePatterns = computed<any[]>(() =>
    navPatterns.value.length ? navPatterns.value : (patternsState.value.patterns?.patterns ?? []),
  );
  const navTotal = computed(() => navigablePatterns.value.length);

  const openPatternDetails = (pattern: any, index: number, visiblePatterns?: any[]) => {
    navPatterns.value = visiblePatterns ?? patternsState.value.patterns?.patterns ?? [];
    selectedPattern.value = { pattern, index };
    showPatternDetails.value = true;
  };

  const navigatePatternDetail = (next: boolean, prev: boolean) => {
    if (!selectedPattern.value) return;

    const list = navigablePatterns.value;
    const currentIndex = (selectedPattern.value as any).index;

    let newIndex = currentIndex;
    if (next && currentIndex < list.length - 1) {
      newIndex = currentIndex + 1;
    } else if (prev && currentIndex > 0) {
      newIndex = currentIndex - 1;
    }

    if (newIndex !== currentIndex && list[newIndex]) {
      selectedPattern.value = { pattern: list[newIndex], index: newIndex };
    }
  };

  const addPatternToSearch = (pattern: any, action: "include" | "exclude") => {
    // Only the pattern's invariant constant text identifies the pattern. An
    // all-wildcard template has none — its sample values are per-log examples,
    // not invariants — so there's no reliable filter and we warn instead of
    // applying a misleading one (see extractConstantsFromPattern).
    const terms = extractConstantsFromPattern(pattern.template);

    if (terms.length === 0) {
      toast({
        variant: "warning",
        message: t("logs.patternList.noMatchTerms"),
      });
      return;
    }

    const matchAllClauses = terms.map((term) => `match_all('${escapeForMatchAll(term)}')`);

    let filterExpression = matchAllClauses.join(" AND ");

    if (action === "exclude") {
      filterExpression =
        matchAllClauses.length > 1 ? `NOT (${filterExpression})` : `NOT ${filterExpression}`;
    }

    searchObj.data.stream.addToFilter = filterExpression;
    searchObj.meta.logsVisualizeToggle = "logs";
  };

  const addWildcardValueToSearch = (value: string, action: "include" | "exclude") => {
    const escaped = escapeForMatchAll(value);
    let filterExpression = `match_all('${escaped}')`;

    if (action === "exclude") {
      filterExpression = `NOT ${filterExpression}`;
    }

    searchObj.data.stream.addToFilter = filterExpression;
    searchObj.meta.logsVisualizeToggle = "logs";
  };

  // ── Alert creation from the visible patterns ────────────────────────────

  /**
   * The patterns tab's contribution to alert creation: fold the patterns the
   * user can currently see into the alert's filter.
   *
   * `mode` comes from the confirm dialog, which re-invokes this builder when the
   * user switches between including and ignoring — the dialog never rewrites SQL
   * itself, so it stays ignorant of what a pattern is.
   *
   * In SQL mode the editor holds a whole statement rather than a WHERE fragment,
   * so it cannot be spliced in front of the pattern terms; we say so instead of
   * silently dropping the user's query.
   */
  const buildPatternsAlertPrefill = (options: AlertBuildOptions = {}) => {
    const dt = (searchObj.data as any).datetime;
    const sqlMode = !!searchObj.meta.sqlMode;
    const rawQuery = (searchObj.data.query ?? "").trim();

    const all = patternsState.value.patterns?.patterns ?? [];
    const visible = visiblePatterns(all);

    return buildPrefillFromPatterns({
      streamName: searchObj.data.stream.selectedStream?.[0] ?? "",
      streamType: searchObj.data.stream.streamType,
      templates: visible.map((p: any) => p.template),
      totalCount: all.length,
      filtered: visible.length !== all.length,
      mode: options.patternMode ?? "exclude",
      baseFilter: sqlMode ? undefined : rawQuery,
      baseFilterDropped: sqlMode && !!rawQuery,
      datetime: dt
        ? {
            type: dt.type,
            relativeTimePeriod: dt.relativeTimePeriod,
            startTime: dt.startTime,
            endTime: dt.endTime,
          }
        : null,
      timezone: store.state.timezone,
    });
  };

  /** Single-pattern entry point (the pattern detail drawer). */
  const buildSinglePatternAlertPrefill = (pattern: any) => {
    const dt = (searchObj.data as any).datetime;

    return buildPrefillFromPatterns({
      streamName: searchObj.data.stream.selectedStream?.[0] ?? "",
      streamType: searchObj.data.stream.streamType,
      templates: [pattern?.template ?? ""],
      totalCount: 1,
      mode: "include",
      // The user named this pattern; falling back to an alert on the whole
      // stream would not be what they asked for.
      requirePatterns: true,
      datetime: dt
        ? {
            type: dt.type,
            relativeTimePeriod: dt.relativeTimePeriod,
            startTime: dt.startTime,
            endTime: dt.endTime,
          }
        : null,
      timezone: store.state.timezone,
    });
  };

  return {
    selectedPattern,
    showPatternDetails,
    openPatternDetails,
    navigatePatternDetail,
    navTotal,
    addPatternToSearch,
    addWildcardValueToSearch,
    activeSeverities,
    setActiveSeverities,
    buildPatternsAlertPrefill,
    buildSinglePatternAlertPrefill,
  };
};
