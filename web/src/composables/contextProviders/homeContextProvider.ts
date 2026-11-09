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

import { onBeforeUnmount, watch } from "vue";

import { contextRegistry } from "./registry";
import type {
  ContextProvider,
  OverviewNowRow,
  OverviewNowSnapshot,
  OverviewRowKind,
  PageContext,
} from "./types";

export const HOME_CONTEXT_KEY = "home";

/** The serialized `overview*` set stays under this many bytes; tail rows go first. */
export const OVERVIEW_CONTEXT_MAX_BYTES = 8 * 1024;

export const OVERVIEW_ROW_CAPS: Readonly<Record<OverviewRowKind, number>> = {
  incident: 5,
  service: 8,
  anomaly: 5,
  alert: 8,
};

// A title is data from users; a long one must not crowd every other row out of the cap.
const MAX_TEXT_CHARS = 200;

const KINDS: readonly OverviewRowKind[] = ["incident", "service", "anomaly", "alert"];

// When the byte cap bites, the longest list loses a row first; ties drop from the later kind.
const TRIM_ORDER: readonly OverviewRowKind[] = [...KINDS].reverse();

const UTF8 = /* @__PURE__ */ new TextEncoder();

type Lists = Record<OverviewRowKind, OverviewNowRow[]>;

type RowOf<K extends OverviewRowKind> = Extract<OverviewNowRow, { kind: K }>;

/** Home's relative range: the period it reads as and its length. */
export type HomePeriod = { period: string; ms: number };

/** The Home page context while the Overview (or its no-data layout) is mounted; reads the snapshot at each call. */
export function createHomeContextProvider(
  snapshot: () => OverviewNowSnapshot,
  store: any,
  period: () => HomePeriod | null = () => null,
): ContextProvider {
  return {
    getContext: () =>
      homeContextOf(
        snapshot(),
        store?.state?.selectedOrganization?.identifier ?? "",
        Date.now(),
        period(),
      ),
  };
}

/** Registers the Home provider as active, re-registers on every snapshot change and unregisters on unmount. */
export function useHomeContextProvider(
  snapshot: () => OverviewNowSnapshot,
  store: any,
  period: () => HomePeriod | null = () => null,
): void {
  const provider = createHomeContextProvider(snapshot, store, period);
  watch(
    snapshot,
    () => {
      contextRegistry.register(HOME_CONTEXT_KEY, provider);
      contextRegistry.setActive(HOME_CONTEXT_KEY);
    },
    { immediate: true, deep: true },
  );
  onBeforeUnmount(() => contextRegistry.unregister(HOME_CONTEXT_KEY));
}

/** Home's provider while a thread fills the Home route: only the route and Home's window, no Overview rows. */
export function useHomeWindowProvider(store: any, period: () => HomePeriod | null): void {
  contextRegistry.register(HOME_CONTEXT_KEY, {
    getContext: () =>
      homeWindowContextOf(
        store?.state?.selectedOrganization?.identifier ?? "",
        Date.now(),
        null,
        period(),
      ),
  });
  contextRegistry.setActive(HOME_CONTEXT_KEY);
  onBeforeUnmount(() => contextRegistry.unregister(HOME_CONTEXT_KEY));
}

/** The `PageContext` of one snapshot: capped lists in snake case, the selected row and the window in µs. */
export function homeContextOf(
  snapshot: OverviewNowSnapshot,
  org: string,
  now: number = Date.now(),
  period: HomePeriod | null = null,
): PageContext {
  const context = homeWindowContextOf(org, now, snapshot.window, period);
  if (snapshot.noData) return { ...context, homeNoData: true };
  context.page = "home_overview";
  const selected = selectedOf(snapshot);
  const lists = cappedLists(snapshot.rows, snapshot.selectedKey);
  const meta = snapshot.services.available ? servicesMeta(snapshot) : null;
  trimToBytes(lists, meta, selected, snapshot.selectedKey);
  const incidents = rowsOf(lists, "incident").map(incidentWire);
  const services = rowsOf(lists, "service").map(serviceWire);
  const anomalies = rowsOf(lists, "anomaly").map(anomalyWire);
  const alerts = rowsOf(lists, "alert").map(alertWire);
  if (incidents.length > 0) context.overviewIncidents = incidents;
  if (services.length > 0) context.overviewServices = services;
  if (anomalies.length > 0) context.overviewAnomalies = anomalies;
  if (alerts.length > 0) context.overviewAlerts = alerts;
  if (meta) context.overviewServicesMeta = meta;
  if (selected) context.overviewSelected = selected;
  return context;
}

/** Home's route and window; a relative range ends at send time, so it reads "Last 24 h" as the Home Ask chip does. */
export function homeWindowContextOf(
  org: string,
  now: number,
  window: { start: number; end: number } | null,
  period: HomePeriod | null,
): PageContext {
  const context: PageContext = {
    currentPage: "home",
    routeName: "home",
    ...(org && { organization_identifier: org }),
    request_timestamp: now * 1000,
  };
  if (period)
    context.timeRange = {
      type: "relative",
      relativeTimePeriod: period.period,
      startTime: (now - period.ms) * 1000,
      endTime: now * 1000,
    };
  else if (window && window.end > window.start)
    context.timeRange = { type: "absolute", startTime: window.start, endTime: window.end };
  return context;
}

function selectedOf(snapshot: OverviewNowSnapshot): PageContext["overviewSelected"] | null {
  const row = snapshot.rows.find((candidate) => candidate.key === snapshot.selectedKey);
  return row ? { kind: row.kind, id: row.id } : null;
}

// Each kind keeps its first rows; a selected row past the cap replaces the last one kept.
function cappedLists(rows: readonly OverviewNowRow[], selectedKey: string | null): Lists {
  const lists: Lists = { incident: [], service: [], anomaly: [], alert: [] };
  for (const kind of KINDS) {
    const ofKind = rows.filter((row) => row.kind === kind);
    const cap = OVERVIEW_ROW_CAPS[kind];
    let kept = ofKind.slice(0, cap);
    const selected = ofKind.findIndex((row) => row.key === selectedKey);
    if (selected >= cap) kept = [...kept.slice(0, cap - 1), ofKind[selected]];
    lists[kind] = kept;
  }
  return lists;
}

function rowsOf<K extends OverviewRowKind>(lists: Lists, kind: K): RowOf<K>[] {
  return lists[kind].filter((row): row is RowOf<K> => row.kind === kind);
}

function incidentWire(
  row: RowOf<"incident">,
): NonNullable<PageContext["overviewIncidents"]>[number] {
  return {
    id: row.id,
    title: text(row.title),
    severity: row.severity,
    status: row.status,
    alert_count: row.alertCount,
  };
}

function serviceWire(row: RowOf<"service">): NonNullable<PageContext["overviewServices"]>[number] {
  return {
    service: text(row.service),
    error_rate: row.errorRate,
    requests: row.requests,
    p99_ms: row.p99Ms,
    p99_ratio: row.p99Ratio,
    baseline_error_rate: row.baselineErrorRate,
    baseline_hours: row.baselineHours,
    signal: row.signal,
    alert_coverage: row.coverage,
  };
}

function anomalyWire(row: RowOf<"anomaly">): NonNullable<PageContext["overviewAnomalies"]>[number] {
  return {
    config_id: row.configId,
    name: text(row.name),
    stream: row.stream,
    anomaly_count: row.anomalyCount,
    at: row.at,
  };
}

function alertWire(row: RowOf<"alert">): NonNullable<PageContext["overviewAlerts"]>[number] {
  return {
    alert_id: row.alertId,
    name: text(row.name),
    state: row.state,
    count: row.count,
    last_at: row.lastAt,
  };
}

function wireRowOf(row: OverviewNowRow): unknown {
  switch (row.kind) {
    case "incident":
      return incidentWire(row);
    case "service":
      return serviceWire(row);
    case "anomaly":
      return anomalyWire(row);
    case "alert":
      return alertWire(row);
  }
}

function servicesMeta(
  snapshot: OverviewNowSnapshot,
): NonNullable<PageContext["overviewServicesMeta"]> {
  const services = snapshot.services;
  return {
    all_regions: services.allRegions,
    partial: services.partial,
    data_until: services.dataUntil,
    window_start: services.window?.start ?? null,
    window_end: services.window?.end ?? null,
  };
}

// Drops one tail row at a time from the longest list until the set fits; the selected row is never dropped.
function trimToBytes(
  lists: Lists,
  meta: unknown,
  selected: unknown,
  selectedKey: string | null,
): void {
  while (bytesOf(lists, meta, selected) > OVERVIEW_CONTEXT_MAX_BYTES) {
    const kind = longestDroppable(lists, selectedKey);
    if (!kind) return;
    const list = lists[kind];
    const at = list.map((row) => row.key !== selectedKey).lastIndexOf(true);
    list.splice(at, 1);
  }
}

function longestDroppable(lists: Lists, selectedKey: string | null): OverviewRowKind | null {
  let best: OverviewRowKind | null = null;
  let most = 0;
  for (const kind of TRIM_ORDER) {
    const droppable = lists[kind].filter((row) => row.key !== selectedKey).length;
    if (droppable > most) {
      best = kind;
      most = droppable;
    }
  }
  return best;
}

function bytesOf(lists: Lists, meta: unknown, selected: unknown): number {
  const body = {
    overviewIncidents: lists.incident.map(wireRowOf),
    overviewServices: lists.service.map(wireRowOf),
    overviewAnomalies: lists.anomaly.map(wireRowOf),
    overviewAlerts: lists.alert.map(wireRowOf),
    overviewServicesMeta: meta,
    overviewSelected: selected,
  };
  return UTF8.encode(JSON.stringify(body)).length;
}

function text(value: string): string {
  return value.length > MAX_TEXT_CHARS ? `${value.slice(0, MAX_TEXT_CHARS - 1)}…` : value;
}
