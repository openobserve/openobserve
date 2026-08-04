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

import { ref, computed, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { searchState } from "@/composables/useLogs/searchState";
import usePatterns from "@/composables/useLogs/usePatterns";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  extractConstantsFromPattern,
  escapeForMatchAll,
  MAX_PATTERNS_PER_ALERT,
} from "./patternUtils";
import { buildPrefillFromPatterns } from "@/utils/alerts/prefill/fromPatterns";

/** Tri-state per pattern: unselected → include → exclude → unselected. */
export type PatternSelection = "include" | "exclude";

/**
 * Module-scoped so every caller of usePatternActions() sees the same selection.
 * The pattern list, the selection bar, and the detail drawer are separate
 * call sites; a per-call ref would let them disagree about what is selected.
 * Mirrors how searchState keeps searchObj a singleton.
 */
const patternSelection = ref(new Map<string, PatternSelection>());

export const usePatternActions = () => {
  const store = useStore();
  const router = useRouter();
  const { t } = useI18n();
  const { searchObj } = searchState();
  const { patternsState } = usePatterns();

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

  // ── Alert selection (include / exclude) ─────────────────────────────────
  //
  // Distinct from addPatternToSearch above: those actions filter the SEARCH,
  // these build an ALERT. Tri-state per pattern, keyed by pattern_id.

  const selectionOf = (pattern: any): PatternSelection | null =>
    patternSelection.value.get(pattern?.pattern_id) ?? null;

  /** A pattern with no invariant constants cannot be expressed as a filter. */
  const isPatternSelectable = (pattern: any): boolean =>
    extractConstantsFromPattern(pattern?.template ?? "").length > 0;

  const cycleSelection = (pattern: any) => {
    if (!isPatternSelectable(pattern)) {
      toast({ variant: "warning", message: t("logs.patternList.noMatchTerms") });
      return;
    }

    const id = pattern.pattern_id;
    const next = new Map(patternSelection.value);
    const current = next.get(id) ?? null;

    if (current === null) {
      if (next.size >= MAX_PATTERNS_PER_ALERT) {
        toast({
          variant: "warning",
          message: t("logs.patternList.alertPatternLimit", { max: MAX_PATTERNS_PER_ALERT }),
        });
        return;
      }
      next.set(id, "include");
    } else if (current === "include") {
      next.set(id, "exclude");
    } else {
      next.delete(id);
    }

    patternSelection.value = next;
  };

  const clearSelection = () => {
    patternSelection.value = new Map();
  };

  const templatesFor = (kind: PatternSelection): string[] => {
    const all = patternsState.value.patterns?.patterns ?? [];
    return all
      .filter((p: any) => patternSelection.value.get(p.pattern_id) === kind)
      .map((p: any) => p.template);
  };

  const includedCount = computed(
    () => [...patternSelection.value.values()].filter((v) => v === "include").length,
  );
  const excludedCount = computed(
    () => [...patternSelection.value.values()].filter((v) => v === "exclude").length,
  );
  const hasSelection = computed(() => patternSelection.value.size > 0);

  // pattern_ids are not stable across runs, so a stale selection would point at
  // patterns that no longer exist. Drop it when the result set is replaced.
  watch(
    () => patternsState.value.patterns?.patterns,
    (next, previous) => {
      if (previous && next !== previous && patternSelection.value.size) {
        clearSelection();
        toast({ variant: "info", message: t("logs.patternList.alertSelectionCleared") });
      }
    },
  );

  const alertDisabledReason = computed(() => {
    if (!searchObj.data.stream.selectedStream?.[0]) {
      return t("logs.patternList.noStreamSelected");
    }
    if (!hasSelection.value) return t("logs.patternList.alertNoSelection");
    return null;
  });

  /**
   * The patterns tab's contribution to alert creation. In SQL mode the editor
   * holds a whole statement rather than a WHERE fragment, so it cannot be
   * spliced in front of the pattern terms — we say so instead of silently
   * dropping the user's query.
   */
  const buildPatternsAlertPrefill = () => {
    const dt = (searchObj.data as any).datetime;
    const sqlMode = !!searchObj.meta.sqlMode;
    const rawQuery = (searchObj.data.query ?? "").trim();

    return buildPrefillFromPatterns({
      streamName: searchObj.data.stream.selectedStream?.[0] ?? "",
      streamType: searchObj.data.stream.streamType,
      includes: templatesFor("include"),
      excludes: templatesFor("exclude"),
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
      includes: [pattern?.template ?? ""],
      excludes: [],
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
    patternSelection,
    selectionOf,
    isPatternSelectable,
    cycleSelection,
    clearSelection,
    includedCount,
    excludedCount,
    hasSelection,
    alertDisabledReason,
    buildPatternsAlertPrefill,
    buildSinglePatternAlertPrefill,
  };
};
