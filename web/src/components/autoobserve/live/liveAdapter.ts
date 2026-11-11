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

import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import { formatLargeNumber } from "@/utils/formatters";
import type {
  AutoObserveCell,
  AutoObserveCellState,
  AutoObserveClass,
  AutoObserveCoverage,
  AutoObserveCoverageRow,
  AutoObserveLearning,
  AutoObserveStatedEvidence,
  AutoObserveSuggestion,
  AutoObserveSuggestionList,
} from "@/services/autoobserve";
import {
  SIGNALS,
  type CoverageCell,
  type CoverageRow,
  type EngineMonitor,
  type LiveCheck,
  type Signal,
} from "../fixtures";
import { say, type Msg, type Request, type RequestCopy } from "../v2/fixtures";
import type { LookKind } from "../v2/changes";
import { TIER_HINT, TIER_LABEL } from "@/components/alert_calibration/format";
import { isAlertFindingKind } from "@/components/alert_calibration/dismissals";
import {
  agoText,
  coverageWord,
  formatDay,
  placeLabels,
  placeOf,
  whereText,
  type LiveFailure,
  type LiveStale,
} from "./liveCopy";
import { alertFindingBody, alertFindingHeadline, analysedText } from "./alertFindingCopy";
import {
  gapGroupInsight,
  insightCopy,
  type InsightParts,
  type InsightToday,
} from "../insight/insightCopy";
import { GAP_GROUP_AT, HIDDEN_KINDS, type CtaContext } from "../insight/kindCopy";

export type SourceStatus = "loading" | "error" | "ready";

export interface CoverageTotals {
  total: number;
  learning: number;
  gaps: number;
  fullyWatched: number;
  added: number;
  detectors: number;
}

export interface SourceState {
  status: SourceStatus;
  retry: () => void;
  busy?: boolean;
  failure?: LiveFailure | null;
  detail?: I18nText;
  stale?: LiveStale | null;
}

export interface CoverageSource extends Required<SourceState> {
  rows: CoverageRow[];
  totals: CoverageTotals;
  planned: Set<string>;
  // Null when the engine finished no pass in the last day.
  passMinutes: number | null;
  // Null on a server that does not report learning.
  learning: AutoObserveLearning | null;
}

export interface Zone {
  locale: string;
  timeZone: string;
}

/** `covers` counts the suggestions one card stands for: one, or every gap a group card folds. */
export type LiveRequest = Request & { insight: InsightParts; covers?: number };

export interface SuggestionRow {
  id: string;
  insight: InsightParts;
  headline: I18nText;
  where: I18nText;
  kind: I18nText;
  kindVariant: BadgeVariant;
  // Why and next, shown under the headline only for kinds that say what to do.
  note: I18nText | null;
  severity: { label: I18nText; variant: BadgeVariant } | null;
  detail: Msg;
}

type GapState = Exclude<AutoObserveCellState, "covered">;

// Only these three design signals have an engine class; the rest render as not checked.
const SIGNAL_CLASS: Partial<Record<Signal, AutoObserveClass>> = {
  errors: "errors",
  latency: "latency",
  saturation: "saturation",
};

const EXTRA_CLASSES: AutoObserveClass[] = [
  "saturation",
  "external_probe",
  "workload_health",
  "node",
];

// The engine raises a coverage gap only when none of these three is covered.
const GAP_CLASSES: LiveCheck[] = ["errors", "latency", "absence"];

const CLASS_LABEL: Record<AutoObserveClass, I18nKey> = {
  errors: "autoobserveLive.classes.errors",
  latency: "autoobserveLive.classes.latency",
  saturation: "autoobserveLive.classes.saturation",
  absence: "autoobserveLive.classes.absence",
  external_probe: "autoobserveLive.classes.external_probe",
  workload_health: "autoobserveLive.classes.workload_health",
  node: "autoobserveLive.classes.node",
};

const CLASS_INLINE: Record<AutoObserveClass, I18nKey> = {
  errors: "autoobserveLive.classesInline.errors",
  latency: "autoobserveLive.classesInline.latency",
  saturation: "autoobserveLive.classesInline.saturation",
  absence: "autoobserveLive.classesInline.absence",
  external_probe: "autoobserveLive.classesInline.external_probe",
  workload_health: "autoobserveLive.classesInline.workload_health",
  node: "autoobserveLive.classesInline.node",
};

const STATE_LABEL: Record<AutoObserveCellState, I18nKey> = {
  covered: "autoobserveLive.states.covered",
  weak: "autoobserveLive.states.weak",
  silent: "autoobserveLive.states.silent",
  blind: "autoobserveLive.states.blind",
  unmapped: "autoobserveLive.states.unmapped",
  none: "autoobserveLive.states.none",
};

const GAP_REASON: Record<GapState, I18nKey> = {
  weak: "autoobserveLive.cell.gap.weak",
  silent: "autoobserveLive.cell.gap.silent",
  blind: "autoobserveLive.cell.gap.blind",
  unmapped: "autoobserveLive.cell.gap.unmapped",
  none: "autoobserveLive.cell.gap.none",
};

const MONITOR_KIND_LABEL: Record<string, I18nKey> = {
  alert: "autoobserveLive.monitorKinds.alert",
  anomaly_detector: "autoobserveLive.monitorKinds.anomaly_detector",
  slo: "autoobserveLive.monitorKinds.slo",
  synthetic: "autoobserveLive.monitorKinds.synthetic",
};

const SUGGESTION_KIND: Record<string, { label: I18nKey; look: LookKind; tag?: BadgeVariant }> = {
  discovery_unusable: {
    label: "autoobserveLive.suggestions.kinds.discovery_unusable",
    look: "watching",
  },
  blind_guardrail: { label: "autoobserveLive.suggestions.kinds.blind_guardrail", look: "fix" },
  coverage_gap: { label: "autoobserveLive.suggestions.kinds.coverage_gap", look: "watching" },
  no_absence_check: {
    label: "autoobserveLive.suggestions.kinds.no_absence_check",
    look: "watching",
  },
  // Nobody hears this monitor fire, so it reads as a failure, not as tuning.
  silent_coverage: {
    label: "autoobserveLive.suggestions.kinds.silent_coverage",
    look: "notify",
    tag: "error-soft",
  },
  coverage_lost: { label: "autoobserveLive.suggestions.kinds.coverage_lost", look: "watching" },
  alert_not_working: { label: "insight.chip.notWorking", look: "notify" },
  alert_no_destination: {
    label: "autoobserveLive.suggestions.kinds.alert_no_destination",
    look: "notify",
    tag: "error-soft",
  },
  alert_notify_failed: {
    label: "autoobserveLive.suggestions.kinds.alert_notify_failed",
    look: "notify",
    tag: "error-soft",
  },
  source_silence: {
    label: "insight.kind.chip.stoppedSending",
    look: "watching",
    tag: "error-soft",
  },
  heartbeat_on_success: { label: "insight.kind.chip.missingAlert", look: "watching" },
};

const NO_ABSENCE_KEY: Record<AutoObserveCellState, I18nKey> = {
  covered: "autoobserveLive.suggestions.body.noAbsenceNone",
  weak: "autoobserveLive.suggestions.body.noAbsenceWeak",
  silent: "autoobserveLive.suggestions.body.noAbsenceSilent",
  blind: "autoobserveLive.suggestions.body.noAbsenceBlind",
  unmapped: "autoobserveLive.suggestions.body.noAbsenceNone",
  none: "autoobserveLive.suggestions.body.noAbsenceNone",
};

const BLIND_KEY: Record<string, I18nKey> = {
  stream_missing: "autoobserveLive.suggestions.body.blindStreamMissing",
  no_data: "autoobserveLive.suggestions.body.blindNoData",
  empty_scope: "autoobserveLive.suggestions.body.blindEmptyScope",
  unknown_field: "autoobserveLive.suggestions.body.blindUnknownField",
  ignored_matcher: "autoobserveLive.suggestions.body.blindIgnoredMatcher",
};

const CONFIDENCE_KEY: Record<string, I18nKey> = {
  sufficient: "autoobserveLive.suggestions.confidence.sufficient",
  suggestive: "autoobserveLive.suggestions.confidence.suggestive",
  insufficient: "autoobserveLive.suggestions.confidence.insufficient",
};

const SEVERITY_KEY: Record<"high" | "medium", I18nKey> = {
  high: "autoobserveLive.suggestions.severity.high",
  medium: "autoobserveLive.suggestions.severity.medium",
};

const STATE_ORDER: Record<string, number> = {
  covered: 0,
  weak: 1,
  silent: 2,
  unmapped: 3,
  blind: 4,
  none: 5,
};

const STREAM_ORDER: Record<string, number> = { traces: 0, logs: 1, metrics: 2 };

const EMPTY_CELL: AutoObserveCell = { state: "none", evidence: [], counts: {} };

const EMPTY_TOTALS: CoverageTotals = {
  total: 0,
  learning: 0,
  gaps: 0,
  fullyWatched: 0,
  added: 0,
  detectors: 0,
};

const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" ? value : null);

const kindLabel = (t: TranslateFn, kind: string): I18nText =>
  MONITOR_KIND_LABEL[kind] ? t(MONITOR_KIND_LABEL[kind]) : raw(kind);

const evidenceOf = (cell: AutoObserveCell): AutoObserveStatedEvidence[] =>
  cell.all_evidence ?? cell.evidence.map((ev) => ({ ...ev, state: cell.state }));

const toMonitor = (t: TranslateFn, ev: AutoObserveStatedEvidence): EngineMonitor => ({
  id: ev.monitor_id,
  name: ev.monitor_name,
  kind: kindLabel(t, ev.monitor_kind),
  kindKey: ev.monitor_kind,
  state: t(STATE_LABEL[ev.state]),
  stateKey: ev.state,
  predicate: ev.predicate,
});

const monitorList = (locale: string, names: string[]): string =>
  new Intl.ListFormat(locale, { type: "conjunction" }).format([...new Set(names)]);

// Covered is the only engine state the design can call watched; every other state is a gap with its cause.
const toCell = (
  t: TranslateFn,
  found: AutoObserveCell | undefined,
  label: I18nText,
  locale: string,
): CoverageCell => {
  const cell = found ?? EMPTY_CELL;
  const lead = cell.evidence[0];
  const engine = {
    state: t(STATE_LABEL[cell.state]),
    stateKey: cell.state,
    detectorKind: lead ? kindLabel(t, lead.monitor_kind) : undefined,
    monitors: evidenceOf(cell)
      .map((ev) => toMonitor(t, ev))
      .sort((a, b) => STATE_ORDER[a.stateKey] - STATE_ORDER[b.stateKey]),
  };
  if (cell.state === "covered" && lead)
    return {
      state: "watched",
      detector: lead.monitor_name,
      method: lead.monitor_kind === "anomaly_detector" ? "anomaly" : "threshold",
      engine,
    };
  const state: GapState = cell.state === "covered" ? "none" : cell.state;
  return {
    state: "gap",
    reason: t(
      GAP_REASON[state],
      {
        signal: label,
        monitor: raw(
          monitorList(
            locale,
            cell.evidence.map((ev) => ev.monitor_name),
          ),
        ),
      },
      Math.max(1, cell.evidence.length),
    ),
    engine,
  };
};

const streamText = (row: AutoObserveCoverageRow) => {
  const streams = [...(row.streams ?? [])].sort(
    (a, b) => (STREAM_ORDER[a.type] ?? 3) - (STREAM_ORDER[b.type] ?? 3),
  );
  if (!streams.length) return "—";
  return streams.length > 1 ? `${streams[0].name} +${streams.length - 1}` : streams[0].name;
};

const coveringMonitors = (row: AutoObserveCoverageRow) =>
  GAP_CLASSES.map((cls) => row.cells[cls])
    .filter((c) => c?.state === "covered")
    .flatMap((c) => (c?.evidence ?? []).map((ev) => ev.monitor_id));

const minutesSince = (passAt: number | null, now: number) =>
  passAt ? Math.max(0, Math.floor((now - passAt / 1000) / 60_000)) : null;

const toRow = (
  t: TranslateFn,
  row: AutoObserveCoverageRow,
  service: string,
  minutes: number | null,
  locale: string,
): CoverageRow => {
  const cells = Object.fromEntries(
    SIGNALS.map((signal) => {
      const cls = SIGNAL_CLASS[signal];
      const cell: CoverageCell = cls
        ? toCell(t, row.cells[cls], t(CLASS_LABEL[cls]), locale)
        : { state: "na", reason: t("autoobserveLive.cell.noClass") };
      return [signal, cell];
    }),
  ) as Record<Signal, CoverageCell>;
  const watched = GAP_CLASSES.some((cls) => row.cells[cls]?.state === "covered");
  const checks = Object.fromEntries(
    GAP_CLASSES.map((cls) => [cls, toCell(t, row.cells[cls], t(CLASS_LABEL[cls]), locale)]),
  ) as Record<LiveCheck, CoverageCell>;
  return {
    service,
    stream: streamText(row),
    where: whereText(t, row.cluster, row.namespace) ?? raw("—"),
    scannedMinutes: minutes,
    lastScanned:
      minutes === null ? t("autoobserve.coverage.notScanned") : agoText(t, locale, minutes),
    cells,
    checks,
    detectors: new Set(coveringMonitors(row)).size,
    identity: {
      serviceId: row.service_id,
      serviceName: row.service_name,
      cluster: row.cluster,
      namespace: row.namespace,
      streams: row.streams ?? [],
    },
    status: watched
      ? { state: "watched", label: coverageWord(t, "watched") }
      : { state: "gap", label: coverageWord(t, "gap") },
    extra: EXTRA_CLASSES.map((cls) => {
      const label = t(CLASS_LABEL[cls]);
      return { key: cls, label, cell: toCell(t, row.cells[cls], label, locale) };
    }),
  };
};

// Closest engine match for the design's "can't watch": a monitor exists but can't see or reach the service.
const cannotWatch = (row: AutoObserveCoverageRow) =>
  Object.values(row.cells).some((cell) => cell?.state === "blind" || cell?.state === "unmapped");

const totalsOf = (data: AutoObserveCoverage, rows: CoverageRow[]): CoverageTotals => {
  const gaps = rows.filter((r) => r.status?.state === "gap").length;
  const detectors = new Set(data.rows.flatMap(coveringMonitors)).size;
  return { ...EMPTY_TOTALS, total: rows.length, gaps, fullyWatched: rows.length - gaps, detectors };
};

export const toCoverageSource = (
  t: TranslateFn,
  data: AutoObserveCoverage | undefined,
  state: SourceState,
  locale: string,
  now = Date.now(),
): CoverageSource => {
  const base = { busy: false, failure: null, detail: raw(""), stale: null, ...state };
  if (!data)
    return {
      ...base,
      rows: [],
      totals: EMPTY_TOTALS,
      planned: new Set(),
      passMinutes: null,
      learning: null,
    };
  const names = placeLabels(t, data.rows.map(placeOf));
  const minutes = minutesSince(data.pass_at, now);
  const rows = data.rows.map((row, i) => toRow(t, row, names[i], minutes, locale));
  const planned = new Set(data.rows.flatMap((row, i) => (cannotWatch(row) ? [names[i]] : [])));
  return {
    ...base,
    rows,
    totals: totalsOf(data, rows),
    planned,
    passMinutes: minutes,
    learning: data.learning ?? null,
  };
};

const listOf = (locale: string, parts: I18nText[]): I18nText =>
  raw(new Intl.ListFormat(locale, { type: "conjunction" }).format(parts));

const classList = (t: TranslateFn, locale: string, classes: string[]) =>
  listOf(
    locale,
    classes.map((c) =>
      CLASS_INLINE[c as AutoObserveClass] ? t(CLASS_INLINE[c as AutoObserveClass]) : raw(c),
    ),
  );

const serviceName = (s: AutoObserveSuggestion) =>
  raw(
    str(s.evidence.service_name) || s.subject.key_dims.service_name || s.subject.key_dims.entity_id,
  );

const serviceMeta = (t: TranslateFn, s: AutoObserveSuggestion): I18nText | null => {
  const dims = s.subject.key_dims;
  const where = whereText(t, dims.k8s_cluster_name, dims.k8s_namespace_name);
  const value = num(s.evidence.traffic_per_hour);
  if (value === null) return where;
  const traffic = raw(formatLargeNumber(Math.round(value)));
  return where
    ? t("autoobserveLive.suggestions.serviceMeta", { where, traffic })
    : t("autoobserveLive.suggestions.trafficOnly", { traffic });
};

const cellsOf = (s: AutoObserveSuggestion) =>
  (s.evidence.cells ?? {}) as Partial<Record<AutoObserveClass, AutoObserveCell>>;

const cellsMsg = (t: TranslateFn, locale: string, s: AutoObserveSuggestion): Msg => {
  const cells = cellsOf(s);
  const parts = GAP_CLASSES.map((c) =>
    t("autoobserveLive.suggestions.detail.cell", {
      check: t(CLASS_LABEL[c]),
      state: t(STATE_LABEL[cells[c]?.state ?? "none"]),
    }),
  );
  return {
    key: "autoobserveLive.suggestions.detail.cells",
    params: { cells: listOf(locale, parts) },
  };
};

const blindReason = (s: AutoObserveSuggestion) => {
  const reason = s.evidence.reason;
  const key = typeof reason === "string" ? reason : (Object.keys(reason ?? {})[0] ?? "");
  const value =
    reason && typeof reason === "object" ? str((reason as Record<string, unknown>)[key]) : "";
  return { key, value };
};

const formatMicros = (us: number, locale: string, timeZone: string): I18nText =>
  raw(
    new Date(us / 1000).toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }),
  );

// lost_at is the snapshot that first missed the coverage; older rows carry only since_day, a UTC day start.
const lostDay = (s: AutoObserveSuggestion, locale: string, timeZone: string): I18nText => {
  const lostAt = num(s.evidence.lost_at);
  if (lostAt !== null) return formatDay(lostAt, locale, timeZone);
  const sinceDay = num(s.evidence.since_day);
  return sinceDay === null ? raw(str(s.evidence.since_day)) : formatDay(sinceDay, locale, "UTC");
};

const NO_DETAIL: Msg = { key: "autoobserveLive.suggestions.detail.none" };

interface Parts {
  headline: I18nText;
  why: I18nText | null;
  next?: I18nText;
  body: Msg;
}

// A service key is cluster/namespace/name; the reader sees the name and its namespace, never the key.
const keyLabel = (key: string): string => {
  const [cluster, namespace, ...name] = key.split("/");
  if (!name.length) return key;
  return namespace ? `${name.join("/")} (${namespace})` : `${name.join("/")} (${cluster})`;
};

const nameList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v !== "") : [];

// Names past the cap fold into "N more", so one sentence reads the same for 1 name or 12.
const cappedList = (
  t: TranslateFn,
  locale: string,
  list: string[],
  total: number,
  cap: number,
): I18nText => {
  const shown: I18nText[] = list.slice(0, cap).map((name) => raw(name));
  const rest = Math.max(total, list.length) - shown.length;
  return listOf(
    locale,
    rest > 0
      ? [...shown, t("autoobserveLive.suggestions.moreNames", { count: rest }, rest)]
      : shown,
  );
};

// The approved copy names the first destination and counts the rest, and up to three services.
const DESTINATION_CAP = 1;
const SERVICE_CAP = 3;

const blindParts = (
  t: TranslateFn,
  { locale, timeZone }: Zone,
  s: AutoObserveSuggestion,
): Parts => {
  const { key, value } = blindReason(s);
  const monitor = raw(str(s.evidence.monitor_name));
  const detail = raw(str(s.evidence.detail));
  const lastFired = num(s.evidence.last_fired_at);
  return {
    headline: BLIND_KEY[key]
      ? t(BLIND_KEY[key], { monitor, detail, field: raw(value), label: raw(value) })
      : monitor,
    why: lastFired
      ? t("autoobserveLive.suggestions.lastFired", {
          time: formatMicros(lastFired, locale, timeZone),
        })
      : t("autoobserveLive.suggestions.neverFired"),
    body: detail
      ? { key: "autoobserveLive.suggestions.detail.text", params: { detail } }
      : NO_DETAIL,
  };
};

const silentParts = (t: TranslateFn, locale: string, s: AutoObserveSuggestion): Parts => {
  const count = num(s.evidence.service_count) ?? 0;
  const monitor = raw(str(s.evidence.monitor_name));
  const services = nameList(s.evidence.services).map(keyLabel);
  const body: Msg = services.length
    ? {
        key: "autoobserveLive.suggestions.detail.services",
        params: {
          services: listOf(
            locale,
            services.map((name) => raw(name)),
          ),
        },
      }
    : NO_DETAIL;
  const undeliverable = nameList(s.evidence.undeliverable);
  if (undeliverable.length) {
    const total = Math.max(num(s.evidence.undeliverable_count) ?? 0, undeliverable.length);
    const destination = cappedList(t, locale, undeliverable, total, DESTINATION_CAP);
    return {
      headline: t("autoobserveLive.suggestions.body.undeliverable", { monitor, destination }),
      why: t("autoobserveLive.suggestions.body.undeliverableWhy", { destination }, total),
      next: t("autoobserveLive.suggestions.body.undeliverableNext", { destination }, total),
      body,
    };
  }
  return {
    headline: t(
      "autoobserveLive.suggestions.body.silentCoverage",
      { monitor, classes: classList(t, locale, (s.evidence.classes ?? []) as string[]), count },
      count,
    ),
    why: services.length
      ? t("autoobserveLive.suggestions.body.silentWhy", {
          monitor,
          services: cappedList(t, locale, services, count, SERVICE_CAP),
        })
      : t("autoobserveLive.suggestions.body.silentWhyNoNames", { monitor }),
    next: t("autoobserveLive.suggestions.body.silentNext"),
    body,
  };
};

// The digest stamps when calibration analysed the alert, so the card dates its run (P5b-D3).
const alertParts = (
  t: TranslateFn,
  locale: string,
  s: AutoObserveSuggestion,
  nowMs: number | undefined,
): Parts => {
  const runAt = num(s.last_seen_at);
  return {
    headline: alertFindingHeadline(t, locale, s),
    why:
      runAt === null || nowMs === undefined
        ? null
        : analysedText(t, locale, Math.max(0, Math.floor((nowMs - runAt / 1000) / 60_000))),
    body: alertFindingBody(s) ?? NO_DETAIL,
  };
};

const partsFor = (t: TranslateFn, zone: Zone, s: AutoObserveSuggestion, nowMs?: number): Parts => {
  const { locale, timeZone } = zone;
  if (isAlertFindingKind(s.kind)) return alertParts(t, locale, s, nowMs);
  if (s.kind === "blind_guardrail") return blindParts(t, zone, s);
  if (s.kind === "silent_coverage") return silentParts(t, locale, s);
  if (s.kind === "discovery_unusable")
    return {
      headline: t("autoobserveLive.suggestions.body.discovery", {
        good: num(s.evidence.good) ?? 0,
        active: num(s.evidence.active) ?? 0,
      }),
      why: null,
      body: {
        key: "autoobserveLive.suggestions.detail.quality",
        params: { mode: raw(str(s.evidence.mode)) },
      },
    };
  const service = serviceName(s);
  const why = serviceMeta(t, s);
  const body = cellsMsg(t, locale, s);
  if (s.kind === "coverage_gap") {
    const missing = GAP_CLASSES.filter((c) => cellsOf(s)[c]?.state !== "covered");
    return {
      headline: t("autoobserveLive.suggestions.body.coverageGap", {
        service,
        classes: classList(t, locale, missing),
      }),
      why,
      body,
    };
  }
  if (s.kind === "no_absence_check")
    return {
      headline: t(NO_ABSENCE_KEY[cellsOf(s).absence?.state ?? "none"], { service }),
      why,
      body,
    };
  if (s.kind === "coverage_lost")
    return {
      headline: t("autoobserveLive.suggestions.body.coverageLost", {
        service,
        classes: classList(t, locale, Object.keys((s.evidence.lost ?? {}) as object)),
        day: lostDay(s, locale, timeZone),
      }),
      why,
      body: NO_DETAIL,
    };
  return { headline: t("autoobserveLive.suggestions.body.other"), why: null, body: NO_DETAIL };
};

// Card and drawer row have one line for the reason, so the next step follows it there.
const whyAndNext = (t: TranslateFn, parts: Parts): I18nText | null => {
  if (!parts.next) return parts.why;
  return parts.why
    ? t("autoobserveLive.suggestions.whyNext", { why: parts.why, next: parts.next })
    : parts.next;
};

// The drawer's Next step column: the kind's own next step when it has one, else the list's why-and-next.
const nextLine = (t: TranslateFn, insight: InsightParts, parts: Parts): I18nText | null => {
  // A card with nothing left to do keeps its one line, such as the just-added note, in the list too.
  if (!insight.cta && insight.note) return insight.note;
  if (insight.next)
    return insight.why
      ? t("autoobserveLive.suggestions.whyNext", { why: insight.why, next: insight.next })
      : insight.next;
  return parts.next ? whyAndNext(t, parts) : null;
};

const kindOf = (t: TranslateFn, s: AutoObserveSuggestion): I18nText => {
  const kind = SUGGESTION_KIND[s.kind];
  return kind ? t(kind.label) : t("autoobserveLive.suggestions.kinds.other");
};

// A coverage gap is a warning, never a failure, so High is amber and Medium neutral.
const severityTag = (t: TranslateFn, s: AutoObserveSuggestion) => {
  const severity = str(s.evidence.severity);
  if (severity !== "high" && severity !== "medium") return null;
  const variant: BadgeVariant = severity === "high" ? "warning-soft" : "default-soft";
  return { label: t(SEVERITY_KEY[severity]), variant };
};

const tagsFor = (t: TranslateFn, s: AutoObserveSuggestion): RequestCopy["tags"] => {
  const tags: RequestCopy["tags"] = [];
  if (isAlertFindingKind(s.kind)) {
    if (s.tier && Object.hasOwn(TIER_LABEL, s.tier))
      tags.push({
        label: t(TIER_LABEL[s.tier]),
        variant: "default-soft",
        hint: t(TIER_HINT[s.tier]),
      });
    return tags;
  }
  const severity = severityTag(t, s);
  if (severity) tags.push(severity);
  if (CONFIDENCE_KEY[s.confidence])
    tags.push({ label: t(CONFIDENCE_KEY[s.confidence]), variant: "default-soft" });
  return tags;
};

// Offset pages over a moving score order can repeat an id, and each card's key is its id.
const firstOfEachId = (suggestions: AutoObserveSuggestion[]) => {
  const seen = new Set<string>();
  return suggestions.filter(
    (s) => !HIDDEN_KINDS.has(s.kind) && !seen.has(s.id) && !!seen.add(s.id),
  );
};

const todayOf = (t: TranslateFn, s: AutoObserveSuggestion, parts: Parts): InsightToday => ({
  label: kindOf(t, s),
  headline: parts.headline,
  why: whyAndNext(t, parts),
  body: say(t, parts.body),
  tags: tagsFor(t, s),
});

// Null for a kind this page doesn't know, so a stale link never filters to an empty list.
export const suggestionKindLabel = (t: TranslateFn, kind: string): I18nText | null => {
  const known = Object.hasOwn(SUGGESTION_KIND, kind) ? SUGGESTION_KIND[kind] : undefined;
  return known ? t(known.label) : null;
};

export const insightOf = (
  t: TranslateFn,
  zone: Zone,
  s: AutoObserveSuggestion,
  nowMs = Date.now(),
  ctx: CtaContext = {},
): InsightParts => insightCopy(t, zone, s, todayOf(t, s, partsFor(t, zone, s, nowMs)), nowMs, ctx);

const requestOf = (
  t: TranslateFn,
  zone: Zone,
  s: AutoObserveSuggestion,
  nowMs: number,
  ctx: CtaContext,
): LiveRequest => {
  const parts = partsFor(t, zone, s, nowMs);
  const insight = insightCopy(t, zone, s, todayOf(t, s, parts), nowMs, ctx);
  return {
    insight,
    id: s.id,
    kind: "fromNowOn",
    body: parts.body,
    yes: "autoobserveLive.suggestions.accept",
    no: "autoobserveLive.suggestions.dismiss",
    doneYes: { key: "autoobserveLive.suggestions.accepted" },
    doneNo: { key: "autoobserveLive.suggestions.dismissed" },
    copy: {
      label: kindOf(t, s),
      headline: insight.headline,
      why: insight.why ?? whyAndNext(t, parts),
      tags: tagsFor(t, s),
      look: SUGGESTION_KIND[s.kind]?.look ?? "watching",
    },
  };
};

const gapGroupRequest = (
  t: TranslateFn,
  zone: Zone,
  gaps: AutoObserveSuggestion[],
  ctx: CtaContext,
  total: number,
): LiveRequest => {
  const insight = gapGroupInsight(t, zone, gaps, ctx, total);
  return {
    insight,
    covers: total,
    id: insight.id,
    kind: "fromNowOn",
    body: NO_DETAIL,
    yes: "autoobserveLive.suggestions.accept",
    no: "autoobserveLive.suggestions.dismiss",
    doneYes: { key: "autoobserveLive.suggestions.accepted" },
    doneNo: { key: "autoobserveLive.suggestions.dismissed" },
    copy: {
      label: kindOf(t, gaps[0]),
      headline: insight.headline,
      why: insight.why ?? raw(""),
      tags: [],
      look: SUGGESTION_KIND.coverage_gap?.look ?? "watching",
    },
  };
};

/** The rail's context: coverage rows, and every proposed gap with the server's count of them. */
export type RailContext = CtaContext & {
  allGaps?: Pick<AutoObserveSuggestionList, "suggestions" | "total">;
};

// The server ranks with sort=priority; the rail keeps that order so it matches the drawer row for row.
export const toRequests = (
  t: TranslateFn,
  zone: Zone,
  suggestions: AutoObserveSuggestion[],
  nowMs = Date.now(),
  ctx: RailContext = {},
): LiveRequest[] => {
  const items = firstOfEachId(suggestions);
  const paged = items.filter((s) => s.kind === "coverage_gap");
  const listed = (ctx.allGaps?.suggestions ?? []).filter(
    (s) => s.kind === "coverage_gap" && s.status === "proposed",
  );
  const gaps = firstOfEachId([...paged, ...listed]);
  const total = Math.max(ctx.allGaps?.total ?? 0, gaps.length);
  if (total < GAP_GROUP_AT) return items.map((s) => requestOf(t, zone, s, nowMs, ctx));
  // The group card takes the first gap's place in the server's priority order.
  return items.flatMap((s) => {
    if (s.kind !== "coverage_gap") return [requestOf(t, zone, s, nowMs, ctx)];
    return s === paged[0] ? [gapGroupRequest(t, zone, gaps, ctx, total)] : [];
  });
};

// An alert finding lives in a folder, not a cluster; the server names it when it knows it.
const whereOf = (t: TranslateFn, s: AutoObserveSuggestion): I18nText => {
  if (isAlertFindingKind(s.kind)) {
    const folder = str(s.evidence.folder);
    return folder ? t("autoobserveLive.suggestions.folder", { folder: raw(folder) }) : raw("—");
  }
  return (
    whereText(t, s.subject.key_dims.k8s_cluster_name, s.subject.key_dims.k8s_namespace_name) ??
    raw("—")
  );
};

export const toSuggestionRows = (
  t: TranslateFn,
  zone: Zone,
  suggestions: AutoObserveSuggestion[],
  nowMs = Date.now(),
  ctx: CtaContext = {},
): SuggestionRow[] =>
  firstOfEachId(suggestions).map((s) => {
    const parts = partsFor(t, zone, s);
    const insight = insightCopy(t, zone, s, todayOf(t, s, parts), nowMs, ctx);
    return {
      id: s.id,
      insight,
      headline: insight.headline,
      where: whereOf(t, s),
      kind: insight.chip.label,
      kindVariant: insight.chip.variant,
      note: nextLine(t, insight, parts),
      severity: isAlertFindingKind(s.kind) ? null : severityTag(t, s),
      detail: parts.body,
    };
  });
