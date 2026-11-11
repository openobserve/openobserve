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

import { computed } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import useTraces from "@/composables/useTraces";
import searchService from "@/services/search";
import { requestAlertCreation } from "@/composables/alerts/useAlertCreation";
import { warn } from "@/utils/alerts/alertPrefill";
import {
  buildPrefillFromTraces,
  buildTracesSeedQuery,
  tracesAlertPeriod,
  type TracesAlertMetric,
  type TracesAlertPercentile,
  type TracesPrefillInput,
} from "@/utils/alerts/prefill/fromTraces";
import type { AlertBuildOptions, AlertPrefill } from "@/ts/interfaces/alertPrefill";
import { resolveTracesFilter } from "@/utils/traces/resolveTracesFilter";
import { tracesSearchRunSignature } from "@/plugins/traces/tracesSearchBar.utils";

const DURATION_PERCENTILES: TracesAlertPercentile[] = [0.5, 0.95, 0.99];
const DEFAULT_DURATION_INDEX = 1;
const ERROR_METRICS: TracesAlertMetric[] = ["errors", "error_ratio"];

/** Create alert from the Traces page: seeds the threshold from the current value, then opens the confirm dialog. */
export const useTracesAlertAction = () => {
  const store = useStore();
  const { t } = useI18nTyped();
  const { searchObj, tracesParser } = useTraces();

  const streamName = computed<string>(() => searchObj.data.stream.selectedStream?.value ?? "");

  const disabledReason = computed(() =>
    streamName.value ? null : t("alerts.prefill.sources.traces.noStream"),
  );

  const queryNotRun = computed(
    () => searchObj.meta.lastRunSignature !== tracesSearchRunSignature(searchObj),
  );

  const readSeed = async (input: TracesPrefillInput, startUs: number, endUs: number) => {
    const { sql, valueColumn } = buildTracesSeedQuery(input);
    try {
      const res = await searchService.search(
        {
          org_identifier: store.state.selectedOrganization.identifier,
          query: { query: { sql, start_time: startUs, end_time: endUs, from: 0, size: 1 } },
          page_type: "traces",
        },
        "ui",
      );
      const value = res?.data?.hits?.[0]?.[valueColumn];
      if (value === undefined || value === null) return null;
      const seed = Number(value);
      return Number.isFinite(seed) ? seed : null;
    } catch {
      return null;
    }
  };

  let creating = false;

  const createAlert = async (metric: TracesAlertMetric): Promise<void> => {
    const stream = streamName.value;
    if (!stream || creating) return;

    const { type, relativeTimePeriod, startTime, endTime } = searchObj.data.datetime;
    const input: TracesPrefillInput = {
      streamName: stream,
      filter: resolveTracesFilter(searchObj.data.editorValue, tracesParser.value, stream),
      view: searchObj.meta.searchMode === "spans" ? "spans" : "traces",
      metric,
      datetime: {
        type: type === "absolute" ? "absolute" : "relative",
        relativeTimePeriod,
        startTime,
        endTime,
      },
    };
    const notRun = queryNotRun.value;

    const { minutes } = tracesAlertPeriod(input.datetime);
    const endUs = Date.now() * 1000;
    const startUs = endUs - minutes * 60 * 1_000_000;

    const isDuration = metric === "duration";
    const isErrors = metric === "errors";
    const variants: TracesPrefillInput[] = isDuration
      ? DURATION_PERCENTILES.map((percentile) => ({ ...input, percentile }))
      : isErrors
        ? ERROR_METRICS.map((errorMetric) => ({ ...input, metric: errorMetric }))
        : [input];
    creating = true;
    let seeds: (number | null)[];
    try {
      seeds = await Promise.all(variants.map((variant) => readSeed(variant, startUs, endUs)));
    } finally {
      creating = false;
    }

    const choiceLabel = (variant: TracesPrefillInput) =>
      isDuration
        ? raw(`p${Math.round((variant.percentile ?? 0.95) * 100)}`)
        : variant.metric === "error_ratio"
          ? t("alerts.prefill.sources.traces.errorRate")
          : t("alerts.prefill.sources.traces.errorCount");

    const build = (options: AlertBuildOptions = {}): AlertPrefill => {
      const defaultIndex = isDuration ? DEFAULT_DURATION_INDEX : 0;
      const index = variants.length > 1 ? (options.queryIndex ?? defaultIndex) : 0;
      const prefill = buildPrefillFromTraces(variants[index], seeds[index]);
      if (notRun) prefill.warnings.push(warn("tracesNotRun", "info"));
      if (variants.length === 1) return prefill;
      return {
        ...prefill,
        queryIndex: index,
        queryChoices: variants.map((variant, choiceIndex) => ({
          index: choiceIndex,
          tabName: choiceLabel(variant),
          query: buildPrefillFromTraces(variant, seeds[choiceIndex]).sql ?? "",
        })),
      };
    };

    // Always confirmed: the seeded threshold is stated there before the form opens.
    requestAlertCreation(build(), {}, build);
  };

  return { createAlert, disabledReason, queryNotRun, streamName };
};
