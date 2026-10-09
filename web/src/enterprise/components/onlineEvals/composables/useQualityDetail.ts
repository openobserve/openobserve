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

import { computed, ref, watch, type Ref } from "vue";
import { useQuery, type Query } from "@tanstack/vue-query";
import { useOrgId } from "@/composables/query/useOrgId";
import type { QualityAgentParams, QualityScorePage } from "@/services/online-evals.service";
import { qualityScoresQuery } from "@/services/online-evals.service.queries";
import {
  chartFilterParams,
  summarizeDistribution,
  type QualityChartFilter,
  type QualityOnly,
  type QualityScope,
} from "../utils/qualityFormat";
import { httpStatus, type DateWindow } from "./useQualityList";

export const SCORES_PAGE_SIZE = 10;

export function useQualityDetail(opts: {
  configId: Ref<string>;
  scope: Ref<QualityScope>;
  only: Ref<QualityOnly>;
  dateWindow: Ref<DateWindow>;
  agentParams: Ref<QualityAgentParams>;
  enabled: Ref<boolean>;
  /** Page and score to reopen, read from the URL once. */
  initial?: { page: number; scoreId: string | null };
}) {
  const orgId = useOrgId();
  const filter = ref<QualityChartFilter | null>(null);
  /** Zero-based page of the score list. */
  const page = ref(opts.initial?.page ?? 0);
  /** Selected score; when it is not on the page, `selectedIndex` picks the row. */
  const selectedId = ref<string | null>(opts.initial?.scoreId ?? null);
  const selectedIndex = ref(0);

  // What the list shows; a change starts it over. The window stays out, so a Refresh keeps the page.
  const listParams = computed(() => ({
    ...opts.agentParams.value,
    ...(opts.scope.value !== "all" ? { scope: opts.scope.value } : {}),
    ...(opts.only.value === "unhealthy" ? { unhealthy_only: true } : {}),
    ...chartFilterParams(filter.value),
  }));

  function goToPage(next: number, index = 0) {
    page.value = next;
    selectedIndex.value = index;
    selectedId.value = null;
  }

  // Sync, so no request goes out with the previous config's or scope's bucket filter.
  watch([opts.configId, opts.scope], () => (filter.value = null), { flush: "sync" });
  // Before the first read the agent levels are still being restored from the URL, so they must not reset a restored page.
  watch(
    () => [opts.configId.value, JSON.stringify(listParams.value)],
    () => {
      if (opts.enabled.value) goToPage(0);
    },
    { flush: "sync" },
  );

  const scoresQuery = useQuery(() =>
    Object.assign(
      qualityScoresQuery(orgId.value, opts.configId.value, {
        start_time: opts.dateWindow.value.startUs,
        end_time: opts.dateWindow.value.endUs,
        ...listParams.value,
        from: page.value * SCORES_PAGE_SIZE,
        size: SCORES_PAGE_SIZE,
      }),
      {
        enabled: !!orgId.value && !!opts.configId.value && opts.enabled.value,
        // Keep the chart and counts on screen while another page or filter loads, but never across configs (key[5] is the entity id).
        placeholderData: (
          previous: QualityScorePage | undefined,
          previousQuery?: Query<any, any, any, any>,
        ) => (previousQuery?.queryKey?.[5] === opts.configId.value ? previous : undefined),
      },
    ),
  );

  const data = computed(() => scoresQuery.data.value);
  const distribution = computed(() => data.value?.distribution ?? []);
  const summary = computed(() => summarizeDistribution(distribution.value));
  const list = computed(() => data.value?.list ?? []);
  const total = computed(() => data.value?.total ?? 0);
  const listLoading = computed(
    () => scoresQuery.isPending.value || scoresQuery.isPlaceholderData.value,
  );
  const selected = computed(() => {
    if (listLoading.value || !list.value.length) return null;
    return (
      list.value.find((score) => score.id === selectedId.value) ??
      list.value[Math.min(selectedIndex.value, list.value.length - 1)]
    );
  });
  const selectedRow = computed(() => (selected.value ? list.value.indexOf(selected.value) : -1));
  const position = computed(() => page.value * SCORES_PAGE_SIZE + selectedRow.value);
  const canPrev = computed(() => !!selected.value && position.value > 0);
  const canNext = computed(() => !!selected.value && position.value < total.value - 1);

  // A shorter window can leave the page past the end; step back to the last page.
  watch(total, (count) => {
    const last = Math.max(0, Math.ceil(count / SCORES_PAGE_SIZE) - 1);
    if (!listLoading.value && page.value > last) goToPage(last);
  });

  function selectAt(index: number) {
    selectedIndex.value = index;
    selectedId.value = list.value[index]?.id ?? null;
  }

  /** Next score; past the last row it loads the next page and selects its first row. */
  function next() {
    if (!canNext.value) return;
    if (selectedRow.value < list.value.length - 1) selectAt(selectedRow.value + 1);
    else goToPage(page.value + 1);
  }

  /** Previous score; before the first row it loads the previous page and selects its last row. */
  function prev() {
    if (!canPrev.value) return;
    if (selectedRow.value > 0) selectAt(selectedRow.value - 1);
    else goToPage(page.value - 1, SCORES_PAGE_SIZE - 1);
  }

  function select(id: string) {
    const index = list.value.findIndex((score) => score.id === id);
    if (index >= 0) selectAt(index);
  }

  return {
    scoresQuery,
    filter,
    page,
    distribution,
    summary,
    list,
    total,
    listLoading,
    selected,
    canPrev,
    canNext,
    next,
    prev,
    select,
    setPage: (next: number) => goToPage(next),
    average: computed(() => data.value?.average ?? null),
    errorStatus: computed(() => httpStatus(scoresQuery.error.value)),
  };
}
