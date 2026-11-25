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

import { computed, onBeforeUnmount, ref, shallowRef, type ComputedRef } from "vue";
import { useQueries, useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";

import { alertTypeOf, severityRank } from "@/components/alertLibrary/libraryFacets";
import type { StarterScope } from "@/components/create-starter/createStarter.types";
import {
  identityConfigQuery,
  semanticGroupsQuery,
  servicesListQuery,
} from "@/services/service_streams.queries";
import { streamNameListQuery } from "@/services/stream.queries";
import {
  toStreamsByType,
  useAlertLibrary,
  useAnomalyLibraryAccess,
} from "@/composables/alerts/useAlertLibrary";
import useStreams from "@/composables/useStreams";
import alertsService from "@/services/alerts";
import type { AlertLibraryEntry, StreamsByType } from "@/types/alertLibrary";
import { useI18nTyped } from "@/types/i18n";
import type { AlertPrefill } from "@/ts/interfaces/alertPrefill";
import { formatNumber } from "@/utils/alerts/alertCopy";
import type { EvaluateAlertBody } from "@/utils/alerts/alertEvaluate.types";
import { operatorSymbol } from "@/utils/alerts/alertReadBack";
import { dayVerdict, type DayVerdict } from "@/utils/alerts/alertTestRun";
import { promqlByLabels, sqlGroupByLabels } from "@/utils/alerts/queryGroupLabels";
import {
  buildScopeOptions,
  scopeKey,
  type ScopeOption,
  type ScopeServiceRow,
  type ScopeStreamType,
} from "@/utils/alerts/starterScope";

export const SCOPE_STREAM_TYPES: readonly ScopeStreamType[] = ["logs", "metrics", "traces"];

/** The dry runs a pane may have in flight at once. */
const DRY_RUN_CONCURRENCY = 3;
const DRY_RUN_TTL_MS = 10 * 60_000;
/** A dry run still unanswered after this says nothing, so no row loads forever. */
const DRY_RUN_TIMEOUT_MS = 60_000;
const FAILED: DayVerdict = { state: "failed", reason: null };

/** Kept across pane opens, so reopening the starter repeats no dry run. */
const verdictCache = new Map<string, { verdict: DayVerdict; at: number }>();

/**
 * The Alert Library page's own readiness check, shared by the starter's row and its Library pane,
 * so "N match your data" is one number. `count` is null while loading or failed.
 */
export function useLibraryReadiness(alertType: () => "scheduled" | "anomaly_detection") {
  const { t } = useI18nTyped();
  const { manifest, error, loadManifest, isReady } = useAlertLibrary();
  const anomalyAccess = useAnomalyLibraryAccess();
  const { getStreams } = useStreams(t);

  const streamsByType = shallowRef<StreamsByType>({});
  const readinessKnown = ref(false);
  const streamsFailed = ref(false);

  const loadStreams = async (force: boolean) => {
    try {
      const payload = (await getStreams("all", false, false, force)) as {
        list?: Array<{ name?: string; stream_type?: string }>;
      };
      streamsByType.value = toStreamsByType(payload?.list);
      readinessKnown.value = true;
      streamsFailed.value = false;
    } catch {
      streamsFailed.value = true;
    }
  };

  const entries = computed<AlertLibraryEntry[]>(() => {
    if (alertType() === "scheduled") {
      return (manifest.value?.alerts ?? []).filter((entry) => alertTypeOf(entry) === "scheduled");
    }
    if (anomalyAccess.value !== "enabled") return [];
    return (manifest.value?.anomaly_alerts ?? []).map((entry) => ({
      ...entry,
      alert_type: "anomaly_detection" as const,
    }));
  });

  const failed = computed(
    () => (!!error.value && !manifest.value) || (streamsFailed.value && !readinessKnown.value),
  );
  const busy = computed(() => !failed.value && (!manifest.value || !readinessKnown.value));
  const ready = computed(() =>
    readinessKnown.value
      ? entries.value.filter((entry) => isReady(entry, streamsByType.value))
      : [],
  );
  const count = computed(() => (busy.value || failed.value ? null : ready.value.length));

  const load = (force = false) => {
    void loadManifest({ force }).catch(() => undefined);
    void loadStreams(force);
  };

  return { entries, ready, busy, failed, count, streamsByType, load };
}

/** The org's scope choices, from the same cached reads Discovered services and correlation use. */
export function useStarterScopeOptions() {
  const store = useStore();
  const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
  const enabled = computed(() => !!org.value);

  const services = useQuery(
    computed(() => ({ ...servicesListQuery(org.value), enabled: enabled.value })),
  );
  const identity = useQuery(
    computed(() => ({ ...identityConfigQuery(org.value), enabled: enabled.value })),
  );
  const groups = useQuery(
    computed(() => ({ ...semanticGroupsQuery(org.value), enabled: enabled.value })),
  );
  const streamLists = useQueries({
    queries: computed(() =>
      SCOPE_STREAM_TYPES.map((type) => ({
        ...streamNameListQuery(org.value, type),
        enabled: enabled.value,
      })),
    ),
  });

  const built = computed(() =>
    buildScopeOptions(
      (services.data.value ?? []) as ScopeServiceRow[],
      identity.data.value,
      groups.data.value ?? [],
    ),
  );

  const streams = computed(() =>
    SCOPE_STREAM_TYPES.flatMap((type, index) =>
      ((streamLists.value[index]?.data ?? []) as Array<{ name?: unknown }>)
        .map((row) => row?.name)
        .filter((name): name is string => typeof name === "string" && name !== "")
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({ type, name })),
    ),
  );

  // A failed read leaves that group out rather than holding the picker on a spinner.
  const pending = computed(
    () => services.isPending.value && services.fetchStatus.value === "fetching",
  );

  const byKey = computed(() => {
    const map = new Map<string, ScopeOption>();
    built.value.services.forEach((option) => map.set(option.key, option));
    built.value.dimensions.forEach((group) => group.options.forEach((o) => map.set(o.key, o)));
    return map;
  });

  const optionFor = (scope: StarterScope): ScopeOption | null =>
    byKey.value.get(scopeKey(scope)) ?? null;

  return { built, streams, pending, optionFor, groups: computed(() => groups.data.value ?? []) };
}

/** Row ids, hottest first, with the alerts the org already runs last. */
export function orderRows(
  list: readonly Pick<AlertLibraryEntry, "id" | "severity" | "title">[],
  ownById: Readonly<Record<string, readonly unknown[]>>,
): string[] {
  const own = (id: string) => (ownById[id]?.length ? 1 : 0);
  return [...list]
    .sort(
      (a, b) =>
        own(a.id) - own(b.id) ||
        severityRank(a.severity) - severityRank(b.severity) ||
        String(a.title ?? "").localeCompare(String(b.title ?? "")),
    )
    .map((entry) => entry.id);
}

/** Ticks every row in view, or unticks them when all are ticked; a selection made elsewhere stays. */
export function selectAllNext(selected: readonly string[], inView: readonly string[]): string[] {
  const next = new Set(selected);
  const all = inView.length > 0 && inView.every((id) => next.has(id));
  inView.forEach((id) => (all ? next.delete(id) : next.add(id)));
  return [...next];
}

/** "per pod", "> 85%": what a library alert groups by and fires on, read off its prefill. */
export function prefillSummary(prefill: AlertPrefill): { per: string[]; condition: string } {
  const grouped = prefill.aggregation?.group_by?.filter(Boolean) ?? [];
  const per = grouped.length
    ? grouped
    : prefill.queryType === "promql"
      ? promqlByLabels(prefill.promql ?? "")
      : sqlGroupByLabels(prefill.sql ?? "").filter((label) => !label.includes("("));
  const promql = prefill.promqlCondition;
  const having = prefill.aggregation?.having;
  // A row has no sentence around the number, so even "at least" keeps its sign.
  const limit = (op: string | undefined, value: unknown) =>
    `${operatorSymbol(op || ">=")} ${formatNumber(value)}`;
  const condition = promql
    ? limit(promql.operator, promql.value)
    : having
      ? limit(having.operator, having.value)
      : limit(prefill.triggerOperator, prefill.triggerThreshold ?? 1);
  return { per, condition };
}

/** Server dry runs for the rows in view: three at a time, cached per entry and stream, cancelled on unmount. */
export function useLibraryDryRun(org: ComputedRef<string>) {
  const verdicts = shallowRef<Record<string, DayVerdict>>({});
  const queue: Array<{ key: string; body: () => Promise<EvaluateAlertBody | null> }> = [];
  const running = new Map<string, AbortController>();
  const asked = new Set<string>();

  const settle = (key: string, verdict: DayVerdict, cache: boolean) => {
    if (cache) verdictCache.set(`${org.value}|${key}`, { verdict, at: Date.now() });
    verdicts.value = { ...verdicts.value, [key]: verdict };
  };

  const pump = () => {
    while (running.size < DRY_RUN_CONCURRENCY && queue.length) {
      const job = queue.shift()!;
      const controller = new AbortController();
      running.set(job.key, controller);
      let done = false;
      const finish = (verdict: DayVerdict | null, cache = false) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        running.delete(job.key);
        if (verdict) settle(job.key, verdict, cache);
        pump();
      };
      // A cancel is not an answer; a refusal, failure or timeout is asked again next open.
      const timer = setTimeout(() => {
        const cancelled = controller.signal.aborted;
        controller.abort();
        finish(cancelled ? null : FAILED);
      }, DRY_RUN_TIMEOUT_MS);
      void (async () => {
        try {
          const body = await job.body();
          if (controller.signal.aborted) return finish(null);
          if (!body) return finish(FAILED, true);
          const response = await alertsService.evaluate(
            org.value,
            { alert: body },
            undefined,
            controller.signal,
            { track: false },
          );
          finish(dayVerdict(response.data), true);
        } catch {
          finish(controller.signal.aborted ? null : FAILED);
        }
      })();
    }
  };

  const request = (key: string, body: () => Promise<EvaluateAlertBody | null>) => {
    if (asked.has(key)) return;
    asked.add(key);
    const cached = verdictCache.get(`${org.value}|${key}`);
    if (cached && Date.now() - cached.at < DRY_RUN_TTL_MS) {
      verdicts.value = { ...verdicts.value, [key]: cached.verdict };
      return;
    }
    queue.push({ key, body });
    pump();
  };

  const cancelAll = () => {
    queue.length = 0;
    running.forEach((controller) => controller.abort());
    running.clear();
  };
  onBeforeUnmount(cancelAll);

  return { verdicts, request, cancelAll };
}
