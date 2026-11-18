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

import { computed, ref, shallowRef } from "vue";
import { useMutation } from "@tanstack/vue-query";

import { readQuery } from "@/composables/query/readQuery";
import {
  alertDetailQuery,
  alertsByTagsQuery,
  bulkToggleAlertsMutation,
  saveAlertMutation,
} from "@/services/alerts.queries";
import { streamNameListQuery } from "@/services/stream.queries";

import { limitPromqlClusters, limitSqlClusters } from "./streamRewriter";
import type { StarterPackFlow } from "./useStarterPackFlow";
import { useRewriteChecks } from "./useRewriteChecks";
import { useWouldFire } from "./useWouldFire";
import {
  isNoisy,
  severityOf,
  summarize,
  type AlertSeverity,
  type WouldFireResult,
} from "./wouldFire";

export type HistoryState = "loading" | "ready" | "error";

export interface TurnOnRow {
  id: string;
  folderId?: string;
  name: string;
  severity: AlertSeverity;
  enabled: boolean;
  alert: Record<string, any>;
  state: HistoryState;
  result: WouldFireResult | null;
  chosen: boolean;
  /** A click wins over the noise rule when a recount lands. */
  touched: boolean;
}

export interface TurnOnChoice {
  critical: string;
  warning: string;
  /** Empty keeps every cluster, including ones that appear later (D16). */
  clusters: string[];
}

const HISTORY_CONCURRENCY = 3;
const US_PER_SECOND = 1_000_000;
const DEFAULT_CLUSTER_LABEL = "k8s_cluster";
const ALTERNATE_CLUSTER_LABEL = "k8s_cluster_name";

// The alert remembers what the pack added, so a later change never touches an authored filter.
export const LIMIT_ATTRIBUTE = "o2_pack_cluster_limit";

const appliedLimit = (alert: Record<string, any>): string[] => {
  try {
    const stored = JSON.parse(alert.context_attributes?.[LIMIT_ATTRIBUTE] ?? "[]");
    return Array.isArray(stored) ? stored.map(String) : [];
  } catch {
    return [];
  }
};

const isForbidden = (error: any) => error?.response?.status === 403;

const clusterLabel = (alert: Record<string, any>) =>
  JSON.stringify(alert.query_condition ?? {}).includes(ALTERNATE_CLUSTER_LABEL)
    ? ALTERNATE_CLUSTER_LABEL
    : DEFAULT_CLUSTER_LABEL;

/** Screen 6's rows and the one path that may enable a pack alert. */
export function useTurnOnAlerts(org: string, flow: StarterPackFlow) {
  const history = useWouldFire(org);
  const checks = useRewriteChecks(org);
  const saveAlert = useMutation(() => saveAlertMutation(org, () => true));
  const bulkToggle = useMutation(() => bulkToggleAlertsMutation(org));

  const rows = shallowRef<TurnOnRow[]>([]);
  const loadState = ref<"idle" | "loading" | "ready" | "error">("idle");
  const submitting = ref(false);
  const forbidden = ref(false);
  const failedIds = ref<string[]>([]);
  let generation = 0;

  const touch = (id: string, change: Partial<TurnOnRow>) => {
    rows.value = rows.value.map((row) => (row.id === id ? { ...row, ...change } : row));
  };

  const streamAges = async (type: string): Promise<Map<string, number>> => {
    const list = await readQuery(streamNameListQuery(org, type));
    const nowUs = Date.now() * 1000;
    return new Map(
      list
        .filter((row) => row.stats?.doc_time_min)
        .map((row) => [row.name, (nowUs - row.stats.doc_time_min) / US_PER_SECOND]),
    );
  };

  const countRow = async (row: TurnOnRow, age: number | null, run: number) => {
    try {
      const result = await history.check(row.alert, age);
      if (run !== generation) return;
      const current = rows.value.find(({ id }) => id === row.id);
      const chosen = current?.touched ? current.chosen : !isNoisy(result);
      touch(row.id, { state: "ready", result, chosen });
    } catch {
      if (run === generation) touch(row.id, { state: "error", result: null });
    }
  };

  const countAll = async (targets: TurnOnRow[], run: number) => {
    const ages = new Map<string, number>();
    for (const type of new Set(targets.map((row) => row.alert.stream_type))) {
      const known = await streamAges(type).catch(() => new Map<string, number>());
      known.forEach((value, key) => ages.set(key, value));
    }
    const queue = [...targets];
    const worker = async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        await countRow(row, ages.get(row.alert.stream_name) ?? null, run);
      }
    };
    await Promise.all(Array.from({ length: HISTORY_CONCURRENCY }, worker));
  };

  /** The pack page lists rows without spending history queries. */
  const load = async ({ count = true }: { count?: boolean } = {}) => {
    generation += 1;
    const run = generation;
    loadState.value = "loading";
    failedIds.value = [];
    forbidden.value = false;
    try {
      const listed = await readQuery(alertsByTagsQuery(org, [`pack:${flow.pack.id}`]), true);
      const details = await Promise.all(
        listed.map((row) => readQuery(alertDetailQuery(org, row.alert_id), true)),
      );
      if (run !== generation) return;
      rows.value = listed.map((row, index) => ({
        id: row.alert_id,
        folderId: row.folder_id,
        name: details[index].name ?? row.name,
        severity: severityOf(details[index]),
        enabled: !!row.enabled,
        alert: details[index],
        state: "loading",
        result: null,
        chosen: !row.enabled,
        touched: false,
      }));
      loadState.value = "ready";
      if (!count) return;
      await countAll(
        rows.value.filter(({ enabled }) => !enabled),
        run,
      );
    } catch {
      if (run === generation) loadState.value = "error";
    }
  };

  const retryRow = async (id: string) => {
    const row = rows.value.find((candidate) => candidate.id === id);
    if (!row) return;
    touch(id, { state: "loading" });
    await countAll([row], generation);
  };

  const choose = (id: string, chosen: boolean) => touch(id, { chosen, touched: true });

  const chosenRows = computed(() => rows.value.filter((row) => row.chosen && !row.enabled));
  const needsCritical = computed(() =>
    chosenRows.value.some(({ severity }) => severity === "critical"),
  );
  const needsWarning = computed(() =>
    chosenRows.value.some(({ severity }) => severity === "warning"),
  );
  const summary = computed(() => summarize(rows.value.filter(({ enabled }) => !enabled)));

  const limited = async (body: Record<string, any>, clusters: string[]) => {
    const previous = appliedLimit(body);
    if (!clusters.length && !previous.length) return body;
    const condition = body.query_condition;
    const label = clusterLabel(body);
    if (condition.type === "promql") {
      condition.promql = await limitPromqlClusters(
        condition.promql,
        label,
        clusters,
        previous,
        checks,
      );
    } else if (condition.type === "sql") {
      condition.sql = await limitSqlClusters(
        condition.sql,
        label,
        clusters,
        previous,
        checks,
        body.stream_type,
      );
    } else {
      throw new Error("alert_query_not_limitable");
    }
    const { [LIMIT_ATTRIBUTE]: _old, ...attributes } = body.context_attributes ?? {};
    body.context_attributes = clusters.length
      ? { ...attributes, [LIMIT_ATTRIBUTE]: JSON.stringify(clusters) }
      : attributes;
    return body;
  };

  const saveTarget = async (row: TurnOnRow, choice: TurnOnChoice): Promise<boolean> => {
    const destination = row.severity === "critical" ? choice.critical : choice.warning;
    if (!destination) return false;
    try {
      const fresh = structuredClone(await readQuery(alertDetailQuery(org, row.id), true));
      const body = await limited({ ...fresh, destinations: [destination] }, choice.clusters);
      await saveAlert.mutateAsync({ payload: body, folderId: row.folderId });
      return true;
    } catch (error) {
      if (isForbidden(error)) forbidden.value = true;
      return false;
    }
  };

  const enableInFolders = async (targets: TurnOnRow[]): Promise<Set<string>> => {
    const done = new Set<string>();
    const folders = new Map<string | undefined, string[]>();
    for (const { id, folderId } of targets) {
      folders.set(folderId, [...(folders.get(folderId) ?? []), id]);
    }
    for (const [folderId, ids] of folders) {
      try {
        const reply = await bulkToggle.mutateAsync({ ids, enabled: true, folderId });
        for (const id of reply.data?.successful ?? []) done.add(id);
      } catch (error) {
        if (isForbidden(error)) forbidden.value = true;
      }
    }
    return done;
  };

  /** Destinations first, so an alert whose save failed is never enabled and cannot page nobody. */
  const turnOn = async (choice: TurnOnChoice, onlyIds?: string[]): Promise<number> => {
    if (submitting.value) return 0;
    submitting.value = true;
    forbidden.value = false;
    const targets = chosenRows.value.filter(({ id }) => !onlyIds || onlyIds.includes(id));
    try {
      const enabled = await flow.trackAlertEdit(
        flow.pack,
        targets.map(({ id }) => id),
        async () => {
          const saved: TurnOnRow[] = [];
          for (const row of targets) {
            if (await saveTarget(row, choice)) saved.push(row);
          }
          return saved.length ? enableInFolders(saved) : new Set<string>();
        },
      );
      failedIds.value = targets.filter(({ id }) => !enabled.has(id)).map(({ id }) => id);
      for (const id of enabled) touch(id, { enabled: true });
      await flow.load();
      return enabled.size;
    } catch {
      failedIds.value = targets.map(({ id }) => id);
      return 0;
    } finally {
      submitting.value = false;
    }
  };

  const setThreshold = async (
    id: string,
    value: number,
    { count = true }: { count?: boolean } = {},
  ): Promise<boolean> => {
    const row = rows.value.find((candidate) => candidate.id === id);
    if (!row) return false;
    try {
      const body = structuredClone(await readQuery(alertDetailQuery(org, id), true));
      if (body.query_condition?.type === "promql") {
        body.query_condition.promql_condition.value = value;
      } else {
        body.trigger_condition.threshold = value;
      }
      await flow.trackAlertEdit(flow.pack, [id], () =>
        saveAlert.mutateAsync({ payload: body, folderId: row.folderId }),
      );
      touch(id, { alert: body, state: count ? "loading" : row.state });
      if (!count) return true;
      await countAll(
        rows.value.filter((candidate) => candidate.id === id),
        generation,
      );
      return true;
    } catch (error) {
      if (isForbidden(error)) forbidden.value = true;
      return false;
    }
  };

  const turnOff = async (targets: TurnOnRow[]): Promise<boolean> => {
    try {
      const ids = targets.map(({ id }) => id);
      await flow.trackAlertEdit(flow.pack, ids, async () => {
        for (const folderId of new Set(targets.map((row) => row.folderId))) {
          const inFolder = targets.filter((row) => row.folderId === folderId);
          await bulkToggle.mutateAsync({
            ids: inFolder.map(({ id }) => id),
            enabled: false,
            folderId,
          });
        }
      });
      for (const { id } of targets) touch(id, { enabled: false });
      await flow.load();
      return true;
    } catch (error) {
      if (isForbidden(error)) forbidden.value = true;
      return false;
    }
  };

  return {
    choose,
    chosenRows,
    failedIds,
    forbidden,
    load,
    loadState,
    needsCritical,
    needsWarning,
    retryRow,
    rows,
    setThreshold,
    submitting,
    summary,
    turnOff,
    turnOn,
  };
}

export type TurnOnAlerts = ReturnType<typeof useTurnOnAlerts>;
