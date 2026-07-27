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
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { searchState } from "@/composables/useLogs/searchState";
import usePatterns from "@/composables/useLogs/usePatterns";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  extractConstantsFromPattern,
  escapeForMatchAll,
  buildPatternAlertData,
} from "./patternUtils";

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

  const createAlertFromPattern = (pattern: any) => {
    const streamName = searchObj.data.stream.selectedStream[0];
    if (!streamName) {
      toast({
        variant: "warning",
        message: t("logs.patternList.noStreamSelected"),
      });
      return;
    }

    // Block when the alert query would have no distinctive constants — without
    // them buildPatternSqlQuery produces a WHERE-less SELECT that matches every
    // log in the stream, which is almost never a useful alert.
    if (extractConstantsFromPattern(pattern.template).length === 0) {
      toast({
        variant: "warning",
        message: t("logs.patternList.alertBroadMatch"),
        timeout: 5000,
      });
      return;
    }

    const dt = (searchObj.data as any).datetime;
    const start = dt?.startTime;
    const end = dt?.endTime;
    const periodMinutes =
      start && end ? Math.max(5, Math.min(60, Math.round((end - start) / 60_000_000))) : 15;

    const patternData = buildPatternAlertData(
      pattern,
      streamName,
      periodMinutes,
      searchObj.data.queryResults?.scan_records || 0,
    );

    sessionStorage.setItem("patternData", JSON.stringify(patternData));
    router.push({
      name: "addAlert",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
        fromPattern: "true",
      },
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
    createAlertFromPattern,
  };
};
