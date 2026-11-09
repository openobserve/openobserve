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

import { computed, onScopeDispose, ref } from "vue";

import { useAlertLibrary } from "@/composables/alerts/useAlertLibrary";
import { readQuery } from "@/composables/query/readQuery";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { workloadStateFromNames } from "@/composables/useWorkloadDetection";
import { STARTER_PACKS_ENABLED } from "@/constants/starterPacks";
import { streamNameListQuery } from "@/services/stream.queries";
import { generateTraceContext } from "@/utils/zincutils";
import {
  DETECTION_STREAMS,
  EVENTS_STREAM,
} from "@/views/Infrastructure/kubernetes2/kubernetesQueries";

import { KUBERNETES_PACK } from "./kubernetesPack";
import { matchPack, readOrgStreams, readSchemaColumns } from "./packMatchData";
import type { StarterPack } from "./types";

export type PackMatchState = "checking" | "matched" | "waiting" | "none" | "error";

export const MATCH_POLL_MS = 5_000;
export const MATCH_PARTIAL_AFTER_MS = 3 * 60_000;

const CLUSTER_WINDOW_US = 24 * 60 * 60 * 1_000_000;
const CLUSTER_COLUMNS = ["k8s_cluster", "k8s_cluster_name"];

interface MatchOptions {
  /** Re-checks until the pack matches, for a guide waiting on new data. */
  poll?: boolean;
  /** Defaults to Kubernetes, the only pack with clusters to read. */
  pack?: StarterPack;
}

const readNames = async (org: string, type: string): Promise<string[]> =>
  (await readQuery(streamNameListQuery(org, type), true)).map((row) => row.name);

/** Whether this org's data fits the pack, and for Kubernetes which clusters it has seen. */
export function useStarterPackMatcher(
  org: string,
  { poll = false, pack = KUBERNETES_PACK }: MatchOptions = {},
) {
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();
  const library = STARTER_PACKS_ENABLED ? useAlertLibrary() : null;
  const state = ref<PackMatchState>("checking");
  const clusters = ref<string[]>([]);
  const streams = ref<string[]>([]);
  const waitingSinceMs = ref<number | null>(null);
  const nowMs = ref(Date.now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let stopped = false;
  let clusterTrace: string | null = null;

  const waitedLong = computed(
    () =>
      state.value === "waiting" &&
      waitingSinceMs.value !== null &&
      nowMs.value - waitingSinceMs.value >= MATCH_PARTIAL_AFTER_MS,
  );

  const readClusters = (stream: string, type: string, column: string) =>
    new Promise<string[]>((resolve) => {
      const traceId = generateTraceContext()?.traceId ?? "";
      const found = new Set<string>();
      const end = Date.now() * 1000;
      clusterTrace = traceId;
      fetchQueryDataWithHttpStream(
        {
          queryReq: {
            query: {
              sql: `SELECT DISTINCT ${column} AS c FROM "${stream}"`,
              sql_mode: "full",
              start_time: end - CLUSTER_WINDOW_US,
              end_time: end,
              size: 100,
            },
          },
          type: "search",
          traceId,
          org_id: org,
          pageType: type,
          searchType: "UI",
        },
        {
          data: (_request, response) => {
            if (response.type !== "search_response_hits") return;
            for (const hit of response.content?.results?.hits ?? []) {
              if (hit.c) found.add(String(hit.c));
            }
          },
          // The scope line reads All clusters without a list, so this failure stays silent.
          error: () => resolve([...found]),
          complete: () => resolve([...found]),
        },
      );
    });

  const decideBySignals = async (): Promise<{
    next: PackMatchState;
    seen: string[];
    found: string[];
  }> => {
    const streams = library ? await readOrgStreams(org) : null;
    const metrics = streams
      ? [...(streams.metrics?.keys() ?? [])]
      : await readNames(org, "metrics");
    const present = (pack.signals ?? []).filter((name) => metrics.includes(name));
    // Without a signal stream the pack cannot fit, so the Library match is not paid for.
    if (!present.length) return { next: "none", seen: [], found: [] };
    const matched =
      library && streams
        ? (await matchPack(org, pack, streams, library)).ready
        : (
            await Promise.all(present.map((name) => readSchemaColumns(org, "metrics", name, true)))
          ).some((columns) => columns.length > 0);
    if (matched) return { next: "matched", seen: [], found: present };
    return { next: present.length ? "waiting" : "none", seen: [], found: present };
  };

  const decide = async (): Promise<{ next: PackMatchState; seen: string[]; found: string[] }> => {
    if (pack.id !== KUBERNETES_PACK.id) return decideBySignals();
    const orgStreams = library ? await readOrgStreams(org) : null;
    const [metrics, logs] = orgStreams
      ? [[...(orgStreams.metrics?.keys() ?? [])], [...(orgStreams.logs?.keys() ?? [])]]
      : await Promise.all([readNames(org, "metrics"), readNames(org, "logs")]);
    const present = DETECTION_STREAMS.filter((name) => metrics.includes(name));
    const columns = await Promise.all(
      present.map((name) => readSchemaColumns(org, "metrics", name, !library)),
    );
    const anchor = columns.findIndex((fields) => fields.length > 0);
    const found = logs.includes(EVENTS_STREAM) ? [...present, EVENTS_STREAM] : present;
    const matched =
      library && orgStreams
        ? (await matchPack(org, KUBERNETES_PACK, orgStreams, library)).ready
        : anchor >= 0;
    if (matched) {
      if (anchor < 0) return { next: "matched", seen: [], found };
      const column = CLUSTER_COLUMNS.find((name) => columns[anchor].includes(name));
      const seen = column ? await readClusters(present[anchor], "metrics", column) : [];
      return { next: "matched", seen, found };
    }
    const arriving =
      present.length > 0 ||
      logs.includes(EVENTS_STREAM) ||
      workloadStateFromNames("kubernetes", { metrics, logs }) === "detected";
    return { next: arriving ? "waiting" : "none", seen: [], found };
  };

  const schedule = () => {
    if (!poll || stopped || state.value === "matched") return;
    timer = setTimeout(() => void check(), MATCH_POLL_MS);
  };

  async function check() {
    clearTimeout(timer);
    generation += 1;
    const run = generation;
    try {
      const { next, seen, found } = await decide();
      if (run !== generation || stopped) return;
      nowMs.value = Date.now();
      if (next === "waiting") waitingSinceMs.value ??= nowMs.value;
      else waitingSinceMs.value = null;
      clusters.value = seen;
      streams.value = found;
      state.value = next;
    } catch {
      if (run !== generation || stopped) return;
      state.value = "error";
    }
    schedule();
  }

  const retry = () => {
    state.value = "checking";
    return check();
  };

  const stop = () => {
    stopped = true;
    generation += 1;
    clearTimeout(timer);
    if (clusterTrace) {
      cancelStreamQueryBasedOnRequestId({ trace_id: clusterTrace, org_id: org });
    }
  };

  onScopeDispose(stop);

  return { state, clusters, streams, waitedLong, check, retry, stop };
}
