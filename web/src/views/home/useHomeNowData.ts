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

import { useQuery } from "@tanstack/vue-query";
import { computed, reactive, ref, shallowRef, watch, type Ref } from "vue";
import { useStore } from "vuex";

import config from "@/aws-exports";
import { queryClient } from "@/composables/query/queryClient";
import { useLicenseLock } from "@/composables/useFeatureLock";
import { useLockedAffordance } from "@/composables/useLockedAffordance";
import { alertHistoryQuery, alertsListQuery } from "@/services/alerts.queries";
import anomalyService from "@/services/anomaly_detection";
import { anomalyConfigsQuery, anomalyHistoryQuery } from "@/services/anomaly_detection.queries";
import type { Incident } from "@/services/incidents";
import type { OrgRcaRun } from "@/services/rca_runs_org";
import { latestRunByIncident } from "@/services/rca_runs_org.queries";
import { incidentsQuery } from "@/services/incidents.queries";
import type { ServicesTrendResponse } from "@/services/service_graph";
import { serviceTopologyQuery, servicesTrendQuery } from "@/services/service_graph.queries";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { safeTimezone } from "@/utils/dashboard/calendarPeriods";
import { resolveBrowserTimezone } from "@/utils/timezone";

import type { BuiltFromSource } from "./HomeBuiltFrom.vue";
import { DEFAULT_HOME_RANGE, periodToMs, type HomeRange } from "./homeUrl";
import {
  useHomeNow,
  type OverviewAlertHit,
  type OverviewAlertItem,
  type OverviewAnomalyInput,
  type OverviewTopology,
  type UseHomeNow,
} from "./useHomeNow";

export { DEFAULT_HOME_RANGE, periodToMs };

/** The trend endpoint refuses a window over this; the list then shows the topology figures. */
export const MAX_TREND_WINDOW_US = 7 * 24 * 3_600_000_000;

const NOW_LIST_LIMIT = 12;
const INCIDENT_LIST_SIZE = 20;
const ALERT_HISTORY_SIZE = 500;
const ANOMALY_HISTORY_LIMIT = 20;
// The per-config fallback reads at most this many history rows in all.
const PER_CONFIG_BUDGET = 500;

type SourceKey = "incidents" | "services" | "anomalies" | "recentEvents";

export type IncidentLists = { open: Incident[]; acknowledged: Incident[]; resolved: Incident[] };

/** What Home reads from the org's RCA runs: each incident's newest run, and the auto-runs whose newest attempt failed. */
export interface HomeRuns {
  byIncident: Map<string, OrgRcaRun>;
  failedAuto: OrgRcaRun[];
}

export interface HomeNowData {
  nowList: UseHomeNow;
  range: Ref<HomeRange>;
  /** Microseconds, fixed at the last load. */
  window: Ref<{ start: number; end: number }>;
  incidents: Ref<IncidentLists | null>;
  trend: Ref<ServicesTrendResponse | null>;
  alertList: Ref<OverviewAlertItem[] | null>;
  topology: Ref<OverviewTopology | null>;
  pending: Ref<boolean>;
  failedSources: Ref<{ key: string; label: I18nText }[]>;
  deniedSources: Ref<{ key: string; label: I18nText }[]>;
  sources: Ref<BuiltFromSource[]>;
  trendCapped: Ref<boolean>;
  tracesLocked: Ref<boolean>;
  alertsLocked: Ref<boolean>;
  incidentsOn: Ref<boolean>;
  timezone: Ref<string>;
  org: Ref<string>;
  load: (force?: boolean) => Promise<void>;
  setRange: (range: HomeRange) => void;
}

/** Splits the org's runs (newest first) for Home; a failure a later run of the same incident replaced no longer needs anyone. */
export function homeRunsOf(runs: readonly OrgRcaRun[]): HomeRuns {
  const byIncident = latestRunByIncident(runs);
  const failedAuto = [...byIncident.values()].filter(
    (run) => run.trigger === "auto" && (run.state === "failed" || run.state === "refused"),
  );
  return { byIncident, failedAuto };
}

/** The range's window in microseconds; a relative one is anchored to `nowMs`. */
export function windowOf(range: HomeRange, nowMs: number): { start: number; end: number } {
  if (range.type === "absolute") return { start: range.from, end: range.to };
  return { start: (nowMs - periodToMs(range.period)) * 1000, end: nowMs * 1000 };
}

/** The rule-built sources of Home's attention list; no source asks the assistant. */
export function useHomeNowData(initialRange: HomeRange | null): HomeNowData {
  const { t } = useI18nTyped();
  const store = useStore();
  const gates = useSourceGates();
  const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
  const range = ref<HomeRange>(initialRange ?? DEFAULT_HOME_RANGE);
  const window = ref(windowOf(range.value, Date.now()));
  const rangeEpoch = ref(0);
  const nowList = useHomeNow(() => window.value);
  const incidents = shallowRef<IncidentLists | null>(null);
  const trend = shallowRef<ServicesTrendResponse | null>(null);
  const topology = shallowRef<OverviewTopology | null>(null);
  const anomalies = shallowRef<OverviewAnomalyInput[] | null>(null);
  const alertHits = shallowRef<OverviewAlertHit[] | null>(null);
  const alertList = shallowRef<OverviewAlertItem[] | null>(null);
  const loading = ref(false);
  const failure = reactive<Record<SourceKey, unknown>>({
    incidents: null,
    services: null,
    anomalies: null,
    recentEvents: null,
  });
  const trendFailed = ref(false);
  const resetKey = computed(() => `${org.value}|${rangeEpoch.value}`);
  const trendCapped = computed(() => window.value.end - window.value.start > MAX_TREND_WINDOW_US);
  const trendApplies = computed(() => config.isEnterprise === "true" && !trendCapped.value);
  let seq = 0;

  const read = async <T>(options: any, force: boolean): Promise<T> => {
    if (force) {
      await queryClient.invalidateQueries({
        queryKey: options.queryKey,
        exact: true,
        refetchType: "none",
      });
    }
    return (await queryClient.fetchQuery(options)) as T;
  };

  async function guarded(key: SourceKey, run: () => Promise<void>): Promise<void> {
    failure[key] = null;
    try {
      await run();
    } catch (err) {
      failure[key] = err;
    }
  }

  async function loadIncidents(force: boolean): Promise<void> {
    if (!gates.incidentsOn.value) return void (incidents.value = null);
    const lists = await Promise.all(
      (["open", "acknowledged", "resolved"] as const).map((status) =>
        read<{ incidents?: Incident[] }>(
          incidentsQuery(org.value, status, INCIDENT_LIST_SIZE, 0),
          force,
        ),
      ),
    );
    const [open, acknowledged, resolved] = lists.map((res) => res?.incidents ?? []);
    incidents.value = { open, acknowledged, resolved };
  }

  async function loadTrend(force: boolean): Promise<ServicesTrendResponse | null> {
    trendFailed.value = false;
    if (!trendApplies.value) return null;
    const options = servicesTrendQuery(org.value, {
      start: window.value.start,
      end: window.value.end,
      limit: NOW_LIST_LIMIT,
      include: nowList.includeFor(resetKey.value),
    });
    try {
      return await read<ServicesTrendResponse>(options, force);
    } catch {
      trendFailed.value = true;
      return null;
    }
  }

  async function loadServices(force: boolean): Promise<void> {
    if (!gates.servicesOn.value) {
      topology.value = null;
      trend.value = null;
      return;
    }
    try {
      const options = serviceTopologyQuery(org.value, {
        startTime: window.value.start,
        endTime: window.value.end,
      });
      const [graph, trendRes] = await Promise.all([
        read<{ nodes?: any[]; edges?: any[] }>(options, force),
        loadTrend(force),
      ]);
      topology.value = { nodes: graph?.nodes ?? [], edges: graph?.edges ?? [] };
      trend.value = trendRes;
    } catch (err) {
      topology.value = null;
      trend.value = null;
      throw err;
    }
  }

  async function loadAnomalies(force: boolean): Promise<void> {
    if (!gates.anomaliesOn.value) return void (anomalies.value = null);
    try {
      const configs = await read<any[]>(anomalyConfigsQuery(org.value), force);
      if (!configs?.length) return void (anomalies.value = []);
      const byId = new Map(configs.map((c: any) => [c.id ?? c.anomaly_id, c]));
      const entries = await read<{ configs?: any[] }>(
        anomalyHistoryQuery(org.value, ANOMALY_HISTORY_LIMIT),
        force,
      ).then(
        (bulk) => bulk?.configs ?? [],
        () => perConfigHistory(org.value, configs),
      );
      anomalies.value = anomalyRowsOf(entries, byId, window.value);
    } catch (err) {
      anomalies.value = null;
      throw err;
    }
  }

  async function loadAlertHits(force: boolean): Promise<void> {
    if (gates.alertsLocked.value) return void (alertHits.value = null);
    const options = alertHistoryQuery(org.value, {
      start_time: window.value.start,
      end_time: window.value.end,
      from: 0,
      size: ALERT_HISTORY_SIZE,
      sort_by: "timestamp",
      sort_order: "desc",
    });
    try {
      const res = await read<{ hits?: OverviewAlertHit[] }>(options, force);
      alertHits.value = res?.hits ?? [];
    } catch (err) {
      alertHits.value = null;
      throw err;
    }
  }

  async function loadAlertList(force: boolean): Promise<void> {
    if (gates.alertsLocked.value) return void (alertList.value = null);
    try {
      alertList.value = await read<OverviewAlertItem[]>(alertsListQuery(org.value, ""), force);
    } catch {
      alertList.value = null;
    }
  }

  function commit(): void {
    nowList.commit({
      resetKey: resetKey.value,
      window: window.value,
      nowUs: Date.now() * 1000,
      incidents: gates.incidentsOn.value ? incidents.value : null,
      trend: trendApplies.value ? trend.value : null,
      topology: gates.servicesOn.value ? topology.value : null,
      anomalies: gates.anomaliesOn.value ? anomalies.value : null,
      alertHits: gates.alertsLocked.value ? null : alertHits.value,
      alertList: alertList.value,
      allRegions: store.state.zoConfig?.super_cluster_enabled === true,
    });
  }

  async function load(force = false): Promise<void> {
    if (!org.value) return;
    const mine = ++seq;
    loading.value = true;
    if (range.value.type === "relative") window.value = windowOf(range.value, Date.now());
    await Promise.allSettled([
      guarded("incidents", () => loadIncidents(force)),
      guarded("services", () => loadServices(force)),
      guarded("anomalies", () => loadAnomalies(force)),
      guarded("recentEvents", () => loadAlertHits(force)),
      loadAlertList(force),
    ]);
    if (mine !== seq) return;
    loading.value = false;
    commit();
  }

  function setRange(next: HomeRange): void {
    range.value = next;
    window.value = windowOf(next, Date.now());
    rangeEpoch.value++;
    void load();
  }

  // An approval that creates an alert invalidates the list, so the no-alert section follows it.
  const alertListObserver = useQuery(
    () => ({
      ...alertsListQuery(org.value, ""),
      enabled: !!org.value && !gates.alertsLocked.value,
    }),
    queryClient,
  );
  watch(
    () => alertListObserver.data.value,
    (list) => {
      if (!list || gates.alertsLocked.value) return;
      alertList.value = list as OverviewAlertItem[];
      nowList.refreshAlertList(resetKey.value, alertList.value);
    },
  );

  watch(org, (next, prev) => {
    if (!next || next === prev) return;
    nowList.selectedKey.value = null;
    nowList.reset();
    rangeEpoch.value++;
    void load();
  });
  // The incidents flag arrives with the async config, after the first load may have skipped them.
  watch(gates.incidentsOn, (on) => on && void load());

  const failedSources = computed(() => {
    const failed: { key: string; label: I18nText }[] = [];
    const real = (key: SourceKey) => failure[key] !== null && !isForbidden(failure[key]);
    if (real("incidents")) failed.push({ key: "incidents", label: t("menu.incidents") });
    if (real("services") || trendFailed.value)
      failed.push({ key: "services", label: t("overview.services") });
    if (real("anomalies")) failed.push({ key: "anomalies", label: t("overview.activeAnomalies") });
    if (real("recentEvents"))
      failed.push({ key: "recentEvents", label: t("overview.recentEvents") });
    return failed;
  });
  const deniedSources = computed(() => {
    const denied: { key: string; label: I18nText }[] = [];
    if (isForbidden(failure.incidents))
      denied.push({ key: "incidents", label: t("menu.incidents") });
    if (isForbidden(failure.services))
      denied.push({ key: "services", label: t("overview.services") });
    if (isForbidden(failure.anomalies))
      denied.push({ key: "anomalies", label: t("overview.activeAnomalies") });
    if (isForbidden(failure.recentEvents))
      denied.push({ key: "recentEvents", label: t("overview.recentEvents") });
    return denied;
  });
  const sources = computed<BuiltFromSource[]>(() => {
    const out: BuiltFromSource[] = [];
    if (gates.incidentsOn.value) out.push("incidents");
    if (gates.servicesOn.value) out.push("services");
    if (gates.anomaliesOn.value) out.push("anomalies");
    if (!gates.alertsLocked.value) out.push("events");
    return out;
  });

  return {
    nowList,
    range,
    window,
    incidents,
    trend: computed(() => (trendApplies.value ? trend.value : null)),
    alertList,
    topology,
    pending: computed(() => !nowList.state.value && loading.value),
    failedSources,
    deniedSources,
    sources,
    trendCapped: computed(() => trendCapped.value && gates.servicesOn.value),
    tracesLocked: gates.tracesLocked,
    alertsLocked: gates.alertsLocked,
    incidentsOn: gates.incidentsOn,
    timezone: computed(() => safeTimezone(resolveBrowserTimezone(store.state.timezone || "UTC"))),
    org,
    load,
    setRange,
  };
}

/** Anomaly configs with anomalous points in the window, newest first, one per config name. */
export function anomalyRowsOf(
  entries: { cfg?: any; hits?: any[] }[],
  configById: Map<unknown, any>,
  window: { start: number; end: number },
): OverviewAnomalyInput[] {
  const newest = new Map<string, OverviewAnomalyInput>();
  for (const entry of entries) {
    const cfg = configById.get(entry.cfg?.id) ?? entry.cfg;
    for (const hit of entry.hits ?? []) {
      const at = Number(hit.timestamp ?? 0);
      if ((hit.anomaly_count ?? 0) <= 0 || (at && (at < window.start || at > window.end))) continue;
      const name = cfg?.name ?? cfg?.alert_name ?? hit.alert_name ?? "";
      const row: OverviewAnomalyInput = {
        configId: String(cfg?.id ?? cfg?.anomaly_id ?? hit.anomaly_id ?? name),
        name,
        stream: cfg?.stream_name ?? hit.stream_name ?? "",
        anomalyCount: hit.anomaly_count,
        at,
      };
      const seen = newest.get(name);
      if (!seen || row.at > seen.at) newest.set(name, row);
    }
  }
  return [...newest.values()].sort((a, b) => b.at - a.at);
}

/** Without the bulk history endpoint, each config's own history, as the Overview reads it; throws when none answers. */
export async function perConfigHistory(
  org: string,
  configs: any[],
): Promise<{ cfg: any; hits: any[] }[]> {
  if (!configs.length) return [];
  const limit = Math.min(ANOMALY_HISTORY_LIMIT, Math.ceil(PER_CONFIG_BUDGET / configs.length));
  const results = await Promise.allSettled(
    configs.map((cfg) => anomalyService.getHistory(org, cfg.id ?? cfg.anomaly_id, limit)),
  );
  // Not one config answered, so the source failed and Home shows it as failed or denied, not as clear.
  const answered = results.some((result) => result.status === "fulfilled");
  if (!answered) throw (results[0] as PromiseRejectedResult).reason;
  return configs.map((cfg, i) => {
    const result = results[i];
    return { cfg, hits: result.status === "fulfilled" ? (result.value.data ?? []) : [] };
  });
}

function isForbidden(err: unknown): boolean {
  const e = err as { status?: number; response?: { status?: number } } | null;
  return e?.status === 403 || e?.response?.status === 403;
}

// The same license and config gates the Overview applies to each source.
function useSourceGates() {
  const store = useStore();
  const incidentsAccess = useLockedAffordance("incidents");
  const incidentsLock = useLicenseLock("incidents");
  const anomalyLock = useLicenseLock("anomaly_detection");
  const tracesLock = useLicenseLock("traces");
  const alertsLock = useLicenseLock("alerts");
  return {
    incidentsOn: computed(
      () =>
        incidentsAccess.value.allowed &&
        !incidentsLock.locked.value &&
        store.state.zoConfig?.incidents_enabled === true,
    ),
    servicesOn: computed(() => incidentsAccess.value.allowed && !tracesLock.locked.value),
    anomaliesOn: computed(
      () => store.state.zoConfig?.anomaly_detection_enabled === true && !anomalyLock.locked.value,
    ),
    tracesLocked: tracesLock.locked,
    alertsLocked: alertsLock.locked,
  };
}
