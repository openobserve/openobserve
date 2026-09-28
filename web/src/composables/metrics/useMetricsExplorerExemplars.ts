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

import { reactive, type Ref } from "vue";
import searchService from "@/services/search";
import { parseSearchError } from "@/utils/query/searchError";
import { buildExemplarMarkers } from "@/utils/dashboard/exemplars/buildExemplarMarkers";
import {
  EXEMPLAR_EXPLORER_SCOPE,
  exemplarOverrideKey,
  readExemplarOverride,
  writeExemplarOverride,
} from "@/composables/dashboard/useExemplarOverride";
import {
  PRIORITY,
  isCancelled,
  type PreviewQueue,
} from "@/composables/metrics/useMetricsPreviewQueue";
import type { ExemplarQueryResult, InjectedExemplars } from "@/ts/interfaces/exemplars";

interface CardLike {
  name: string;
}

interface ExplorerQuery {
  expr: string;
  legend?: string;
}

interface ExplorerExemplarsArgs {
  queue: PreviewQueue;
  org: Ref<string>;
  timeRange: Ref<{ start_time: number; end_time: number }>;
  queriesOf: (card: CardLike) => ExplorerQuery[];
  stepOf: (card: CardLike) => number;
  /** The metric's own unit; exemplar values are observations, never the card's rate. */
  valueUnitOf?: (card: CardLike) => { unit: string; unitCustom: string | null };
}

/** Per-card exemplar fetches, run through the preview queue so scroll-away and filter changes abort them. */
export function useMetricsExplorerExemplars(args: ExplorerExemplarsArgs) {
  const { queue, org, timeRange, queriesOf, stepOf, valueUnitOf } = args;
  const states = reactive(new Map<string, InjectedExemplars>());
  const generations = new Map<string, number>();

  const keyOf = (name: string) => exemplarOverrideKey(org.value, EXEMPLAR_EXPLORER_SCOPE, name);

  const enabled = (name: string): boolean => readExemplarOverride(keyOf(name)) === true;

  const jobKey = (expr: string, step: number) =>
    `exemplars|${org.value}|${expr}|${timeRange.value.start_time}|${timeRange.value.end_time}|${step}`;

  const exemplarKeysOf = (card: CardLike): string[] => {
    if (!enabled(card.name)) return [];
    const step = stepOf(card);
    return queriesOf(card).map((q) => jobKey(q.expr, step));
  };

  const cancel = (card: CardLike) => {
    generations.set(card.name, (generations.get(card.name) ?? 0) + 1);
    for (const key of exemplarKeysOf(card)) queue.cancel(key, card.name);
  };

  const fetchCard = async (card: CardLike, priority: number = PRIORITY.VISIBLE) => {
    const queries = queriesOf(card);
    if (!queries.length || !timeRange.value.end_time) return;
    const generation = (generations.get(card.name) ?? 0) + 1;
    generations.set(card.name, generation);
    const labels = queries.map((q) => q.legend ?? "");
    const valueUnit = valueUnitOf?.(card);
    states.set(card.name, {
      status: "loading",
      markers: [],
      errorMessage: "",
      queryLabels: labels,
      valueUnit: valueUnit?.unit,
      valueUnitCustom: valueUnit?.unitCustom,
    });
    const step = stepOf(card);
    const { start_time, end_time } = timeRange.value;
    const settled = await Promise.allSettled(
      queries.map((q, queryIndex) =>
        queue.run<ExemplarQueryResult>(
          jobKey(q.expr, step),
          priority,
          async (signal) => {
            const res = await searchService.metrics_query_exemplars({
              org_identifier: org.value,
              query: q.expr,
              start_time,
              end_time,
              signal,
            });
            return { queryIndex, query: q.expr, response: res.data };
          },
          { owner: card.name, cache: false },
        ),
      ),
    );
    if (generations.get(card.name) !== generation) return;
    if (settled.some((o) => o.status === "rejected" && isCancelled(o.reason))) {
      states.delete(card.name);
      return;
    }
    const ok = settled.flatMap((o) => (o.status === "fulfilled" ? [o.value] : []));
    const failure = settled.find((o) => o.status === "rejected") as
      PromiseRejectedResult | undefined;
    const markers = buildExemplarMarkers(ok, {
      startMs: start_time / 1000,
      endMs: end_time / 1000,
    });
    states.set(card.name, {
      status: failure ? "error" : markers.length ? "ready" : "empty",
      markers,
      errorMessage: failure ? parseSearchError(failure.reason).message : "",
      queryLabels: labels,
      valueUnit: valueUnit?.unit,
      valueUnitCustom: valueUnit?.unitCustom,
    });
  };

  /** Starts a fetch for an enabled card with no live state; a loading card's queued jobs move up to `priority`. */
  const ensure = (card: CardLike, priority: number = PRIORITY.VISIBLE) => {
    if (!enabled(card.name)) return;
    const state = states.get(card.name);
    if (!state) {
      void fetchCard(card, priority);
      return;
    }
    if (state.status === "loading") {
      for (const key of exemplarKeysOf(card)) queue.reprioritize(key, priority);
    }
  };

  const toggle = (card: CardLike) => {
    const next = !enabled(card.name);
    if (!next) {
      cancel(card);
      states.delete(card.name);
    }
    writeExemplarOverride(keyOf(card.name), next);
    if (next) void fetchCard(card);
  };

  const retry = (card: CardLike) => {
    cancel(card);
    states.delete(card.name);
    void fetchCard(card);
  };

  const stateOf = (name: string): InjectedExemplars | undefined =>
    enabled(name) ? states.get(name) : undefined;

  const clearAll = () => {
    for (const name of states.keys()) generations.set(name, (generations.get(name) ?? 0) + 1);
    states.clear();
  };

  return { enabled, toggle, exemplarKeysOf, stateOf, retry, ensure, cancel, clearAll };
}
