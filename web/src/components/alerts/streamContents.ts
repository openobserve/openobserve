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

import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import useStreams from "@/composables/useStreams";
import { labelsOf } from "@/utils/metrics/metricFamily";
import { DAY_US } from "@/composables/alerts/useStreamDiscovery";
import {
  useAlertStreamQuery,
  type AlertStreamQueryState,
} from "@/composables/alerts/useAlertStreamQuery";

export type MetricLabelsState = "loading" | "ready" | "failed";

export interface MetricLabelsSource {
  labels: Ref<string[]>;
  state: Ref<MetricLabelsState>;
  /** Distinct values per label over the last day, once the one counting search lands. */
  cardinality: ComputedRef<Record<string, number>>;
  /** True once the counts settled, so chips appear once in their final order. */
  settled: ComputedRef<boolean>;
}

export interface StreamSamplesSource {
  hits: Ref<Record<string, unknown>[]>;
  state: Ref<AlertStreamQueryState>;
}

export const SAMPLE_SIZE = 5;
const SAMPLE_WINDOW_US = 60 * 60 * 1000 * 1000;

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** A metric's labels and how many values each holds; reloads when the stream changes. */
export function useMetricLabels(streamName: () => string): MetricLabelsSource {
  const { t } = useI18nTyped();
  const { getStream } = useStreams(t);
  const distinct = useAlertStreamQuery();
  const labels = ref<string[]>([]);
  const state = ref<MetricLabelsState>("loading");

  // One search counts every label's values, so the chips can rank and size themselves without a lookup each.
  const cardinality = computed<Record<string, number>>(() => {
    const row = distinct.hits.value[0] ?? {};
    return Object.fromEntries(
      labels.value
        .map((label) => [label, Number(row[label])])
        .filter(([, n]) => Number.isFinite(n)),
    );
  });
  const settled = computed(() => ["ready", "failed"].includes(distinct.state.value));

  watch(
    streamName,
    async (name) => {
      labels.value = [];
      state.value = "loading";
      distinct.cancel();
      if (!name) return;
      try {
        const stream = await getStream(name, "metrics", true);
        if (name !== streamName()) return;
        labels.value = labelsOf(stream ?? {}) ?? [];
        state.value = "ready";
      } catch {
        if (name === streamName()) state.value = "failed";
        return;
      }
      if (!labels.value.length) return;
      const now = Date.now() * 1000;
      distinct.run({
        sql: `SELECT ${labels.value.map((l) => `approx_distinct(${quote(l)}) AS ${quote(l)}`).join(", ")} FROM ${quote(name)}`,
        streamType: "metrics",
        startTime: now - DAY_US,
        endTime: now,
        size: 1,
      });
    },
    { immediate: true },
  );

  return { labels, state, cardinality, settled };
}

/** The stream's latest few events from the last hour, newest first. */
export function useStreamSamples(
  streamName: () => string,
  streamType: () => string,
): StreamSamplesSource {
  const store = useStore();
  const query = useAlertStreamQuery();
  watch(
    () => [streamName(), streamType()],
    ([name, type]) => {
      if (!name) return;
      const now = Date.now() * 1000;
      const timestamp = store.state.zoConfig?.timestamp_column || "_timestamp";
      query.run({
        sql: `SELECT * FROM ${quote(name)} ORDER BY "${timestamp}" DESC`,
        streamType: type,
        startTime: now - SAMPLE_WINDOW_US,
        endTime: now,
        size: SAMPLE_SIZE,
      });
    },
    { immediate: true },
  );
  return { hits: query.hits, state: query.state };
}
