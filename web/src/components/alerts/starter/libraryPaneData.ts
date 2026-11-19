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

import { computed, onBeforeUnmount, shallowRef, type ComputedRef } from "vue";
import { useQueries, useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";

import { severityRank } from "@/components/alertLibrary/libraryFacets";
import type { StarterScope } from "@/components/create-starter/createStarter.types";
import {
  identityConfigQuery,
  semanticGroupsQuery,
  servicesListQuery,
} from "@/services/service_streams.queries";
import { streamNameListQuery } from "@/services/stream.queries";
import alertsService from "@/services/alerts";
import type { AlertLibraryEntry } from "@/types/alertLibrary";
import type { AlertPrefill } from "@/ts/interfaces/alertPrefill";
import type { EvaluateAlertBody } from "@/utils/alerts/alertEvaluate.types";
import { limitText } from "@/utils/alerts/alertReadBack";
import { testRunDay } from "@/utils/alerts/alertTestRun";
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

export type DryRunVerdict =
  { state: "fired"; count: number; groups: number } | { state: "quiet" } | { state: "none" };

/** Kept across pane opens, so reopening the starter repeats no dry run. */
const verdictCache = new Map<string, { verdict: DryRunVerdict; at: number }>();

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
  const condition = promql
    ? limitText(promql.operator, promql.value)
    : having
      ? limitText(having.operator, having.value)
      : limitText(prefill.triggerOperator, prefill.triggerThreshold ?? 1);
  return { per, condition };
}

const verdictOf = (response: Parameters<typeof testRunDay>[0]): DryRunVerdict => {
  const summary = response.summary;
  if (!summary.checks || summary.errors >= summary.checks) return { state: "none" };
  const day = testRunDay(response);
  // A day with no matching event says nothing about the alert, so it states nothing.
  if (day.events === 0) return { state: "none" };
  if (day.alerts > 0) {
    return { state: "fired", count: day.alerts, groups: summary.groups_fired_total ?? 0 };
  }
  return { state: "quiet" };
};

/** Server dry runs for the rows in view: three at a time, cached per entry and stream, cancelled on unmount. */
export function useLibraryDryRun(org: ComputedRef<string>) {
  const verdicts = shallowRef<Record<string, DryRunVerdict>>({});
  const queue: Array<{ key: string; body: () => Promise<EvaluateAlertBody | null> }> = [];
  const running = new Map<string, AbortController>();
  const asked = new Set<string>();

  const settle = (key: string, verdict: DryRunVerdict, cache: boolean) => {
    if (cache) verdictCache.set(`${org.value}|${key}`, { verdict, at: Date.now() });
    verdicts.value = { ...verdicts.value, [key]: verdict };
  };

  const pump = () => {
    while (running.size < DRY_RUN_CONCURRENCY && queue.length) {
      const job = queue.shift()!;
      const controller = new AbortController();
      running.set(job.key, controller);
      void (async () => {
        try {
          const body = await job.body();
          if (controller.signal.aborted) return;
          if (!body) return settle(job.key, { state: "none" }, true);
          const response = await alertsService.evaluate(
            org.value,
            { alert: body },
            undefined,
            controller.signal,
          );
          settle(job.key, verdictOf(response.data), true);
        } catch {
          // A cancel is not an answer; a refusal or failure shows nothing and is asked again next open.
          if (!controller.signal.aborted) settle(job.key, { state: "none" }, false);
        } finally {
          running.delete(job.key);
          pump();
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
