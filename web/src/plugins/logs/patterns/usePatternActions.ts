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

import { ref } from "vue";
import { useQuasar } from "quasar";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { searchState } from "@/composables/useLogs/searchState";
import usePatterns from "@/composables/useLogs/usePatterns";
import {
  extractConstantsFromPattern,
  escapeForMatchAll,
  buildPatternAlertData,
} from "./patternUtils";

export const usePatternActions = () => {
  const $q = useQuasar();
  const store = useStore();
  const router = useRouter();
  const { searchObj } = searchState();
  const { patternsState } = usePatterns();

  const selectedPattern = ref<any>(null);
  const showPatternDetails = ref(false);

  const openPatternDetails = (pattern: any, index: number) => {
    selectedPattern.value = { pattern, index };
    showPatternDetails.value = true;
  };

  const navigatePatternDetail = (next: boolean, prev: boolean) => {
    if (!selectedPattern.value) return;

    const currentIndex = (selectedPattern.value as any).index;
    const totalPatterns = patternsState.value.patterns?.patterns?.length || 0;

    let newIndex = currentIndex;
    if (next && currentIndex < totalPatterns - 1) {
      newIndex = currentIndex + 1;
    } else if (prev && currentIndex > 0) {
      newIndex = currentIndex - 1;
    }

    if (newIndex !== currentIndex && patternsState.value.patterns?.patterns) {
      const newPattern = patternsState.value.patterns.patterns[newIndex];
      selectedPattern.value = { pattern: newPattern, index: newIndex };
    }
  };

  const addPatternToSearch = (
    pattern: any,
    action: "include" | "exclude",
  ) => {
    const constants = extractConstantsFromPattern(pattern.template);

    if (constants.length === 0) {
      $q.notify({
        type: "warning",
        message: "No strings longer than 10 characters found in pattern",
        timeout: 2000,
      });
      return;
    }

    const matchAllClauses = constants.map(
      (constant) => `match_all('${escapeForMatchAll(constant)}')`,
    );

    let filterExpression = matchAllClauses.join(" AND ");

    if (action === "exclude") {
      filterExpression =
        matchAllClauses.length > 1
          ? `NOT (${filterExpression})`
          : `NOT ${filterExpression}`;
    }

    searchObj.data.stream.addToFilter = filterExpression;
    searchObj.meta.logsVisualizeToggle = "logs";
  };

  const addWildcardValueToSearch = (
    value: string,
    action: "include" | "exclude",
  ) => {
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
      $q.notify({
        type: "warning",
        message:
          "No stream selected. Please select a stream before creating an alert.",
        timeout: 2000,
      });
      return;
    }

    const constants = extractConstantsFromPattern(pattern.template);
    if (constants.length === 0) {
      $q.notify({
        type: "warning",
        message:
          "Pattern has very short constant segments. The alert query will match all logs in this stream — consider adding manual filters.",
        timeout: 5000,
      });
      return;
    }

    const dt = (searchObj.data as any).datetime;
    const start = dt?.startTime;
    const end = dt?.endTime;
    const periodMinutes =
      start && end
        ? Math.max(5, Math.min(60, Math.round((end - start) / 60_000_000)))
        : 15;

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
    addPatternToSearch,
    addWildcardValueToSearch,
    createAlertFromPattern,
  };
};
