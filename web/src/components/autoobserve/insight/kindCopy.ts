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

import type { RouteLocationRaw } from "vue-router";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import type {
  AutoObserveCell,
  AutoObserveCoverageRow,
  AutoObserveIncidentItem,
  AutoObserveIncidentMember,
  AutoObserveSuggestion,
} from "@/services/autoobserve";
import { formatWhen, placeLabels, placeOf } from "../live/liveCopy";
import {
  heartbeatAlert,
  noDataAlert,
  sourceNoDataAlert,
} from "@/utils/alerts/prefill/fromAutoObserve";
import { draftTarget } from "./targets/alertDraft";
import { logsForSources } from "./targets/logsTargets";
import { notifyOf, teamOf } from "./targets/ownership";
import type { BulkKind, BulkRow } from "./bulk/useBulkReview";
import { addedNote, serviceKeyOf, useRecentlyCreated } from "./bulk/useRecentlyCreated";
import { noMatchLine } from "./bulk/bulkCopy";
import { knownMatch } from "./targets/scopeMatch";
import type { ServiceScope } from "./bulk/bulkTargets";
import { insightCtaLabel, type AiFinding, type CtaAction } from "./insightCta";
import {
  destinationsTarget,
  type InsightCta,
  type InsightTarget,
  type InsightTone,
  type InsightZone,
  type TypedAction,
} from "./insightCopy";

/** What the page already holds that a CTA can prefill from: the coverage rows with each service's streams. */
export interface CtaContext {
  rows?: AutoObserveCoverageRow[];
}

/** A kind's own copy and actions; a field left out keeps what the list row already says. */
export interface KindCopy {
  chip?: { label: I18nText; tone: InsightTone };
  headline?: I18nText;
  why: I18nText | null;
  whyDetail: I18nText | null;
  next: I18nText | null;
  cta: InsightCta | null;
  secondary: InsightCta[];
  ai: AiFinding | null;
  /** The card's one line under its actions when it has no CTA to carry one. */
  note?: I18nText | null;
}

/** Who a paged finding reached; `routing` asks for the on-call routing CTA. */
export interface PageLine {
  tone: "neutral" | "pending" | "warning" | "error";
  text: I18nText;
  routing: boolean;
}

/** A paged finding's own lines: a grouped headline, who was paged, why and next. */
export interface PagedFindingCopy {
  headline: I18nText | null;
  page: PageLine | null;
  why: I18nText | null;
  next: I18nText | null;
}

type GapClass = "errors" | "latency" | "absence";

// Standard view has nothing to say about these yet (Q6), so they never render there.
export const HIDDEN_KINDS: ReadonlySet<string> = new Set(["protect_evidence"]);

const GAP_CLASSES: GapClass[] = ["errors", "latency", "absence"];

/** Six or more coverage gaps fold into one card, so a long rail never repeats one sentence per service. */
export const GAP_GROUP_AT = 6;

const GROUP_NAMES = 3;

const NO_DATA_MINUTES = 15;

const recently = useRecentlyCreated();

const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const count = (value: number, locale: string): I18nText =>
  raw(new Intl.NumberFormat(locale).format(Math.round(value)));

const listOf = (locale: string, items: string[], type: "conjunction" | "disjunction") =>
  raw(new Intl.ListFormat(locale, { type }).format(items));

const timeText = (micros: number, zone: InsightZone): I18nText =>
  raw(
    new Intl.DateTimeFormat(zone.locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone.timeZone,
    }).format(micros / 1000),
  );

const ctaOf = (
  t: TranslateFn,
  action: CtaAction,
  target: InsightTarget,
  note: I18nText | null = null,
  key: string = action,
): InsightCta => ({ key, action, label: insightCtaLabel(t, action), target, note });

const serviceOf = (s: AutoObserveSuggestion): string =>
  str(s.evidence.service_name) ||
  s.subject.key_dims.service_name ||
  s.subject.key_dims.entity_id ||
  "";

const cellsOf = (s: AutoObserveSuggestion) =>
  (s.evidence.cells ?? {}) as Partial<Record<GapClass, AutoObserveCell>>;

const labelled = new WeakMap<AutoObserveCoverageRow[], TranslateFn>();
const rowLabel = new WeakMap<AutoObserveCoverageRow, string>();

// Drafts carry the coverage page's own label, so review and Add alert name a service as the map does.
const labelRows = (t: TranslateFn, rows: AutoObserveCoverageRow[]) => {
  if (labelled.get(rows) === t) return;
  placeLabels(t, rows.map(placeOf)).forEach((label, i) => rowLabel.set(rows[i], label));
  labelled.set(rows, t);
};

const rowOf = (
  t: TranslateFn,
  s: AutoObserveSuggestion,
  ctx: CtaContext,
): AutoObserveCoverageRow | null => {
  const rows = ctx.rows ?? [];
  labelRows(t, rows);
  const dims = s.subject.key_dims;
  // The entity id names one coverage row; a name alone also matches its namesakes in other namespaces.
  const byId = dims.entity_id ? rows.find((r) => r.service_id === dims.entity_id) : undefined;
  if (byId) return byId;
  const service = serviceOf(s);
  const cluster = dims.k8s_cluster_name ?? null;
  const namespace = dims.k8s_namespace_name ?? null;
  const matches = rows.filter(
    (r) =>
      r.service_name === service &&
      (!cluster || r.cluster === cluster) &&
      (!namespace || r.namespace === namespace),
  );
  const exact = matches.find(
    (r) => (r.cluster ?? null) === cluster && (r.namespace ?? null) === namespace,
  );
  return exact ?? matches[0] ?? null;
};

const streamOf = (row: AutoObserveCoverageRow, type: string) =>
  row.streams.find((s) => s.type === type) ?? null;

// Errors and no-data read rows, so a logs stream comes first and traces stand in when there are no logs.
const rowStream = (row: AutoObserveCoverageRow) => streamOf(row, "logs") ?? streamOf(row, "traces");

// Latency reads spans; errors and no-data read the row stream.
const draftStream = (row: AutoObserveCoverageRow, kind: BulkKind) =>
  kind === "latency" ? streamOf(row, "traces")! : rowStream(row)!;

const scopeOf = (row: AutoObserveCoverageRow, stream: { type: string; name: string }) => ({
  service: row.service_name,
  ...(rowLabel.has(row) ? { label: rowLabel.get(row) } : {}),
  cluster: row.cluster,
  namespace: row.namespace,
  stream,
});

/** The service's own alerts coverage matched on any check, including ones that lost to another monitor. */
const alertIdsOf = (row: AutoObserveCoverageRow): string[] => {
  const evidence = Object.values(row.cells).flatMap((c) => c?.all_evidence ?? c?.evidence ?? []);
  const ids = evidence.filter((e) => e.monitor_kind === "alert").map((e) => e.monitor_id);
  return [...new Set(ids)].sort();
};

// Drafts start in the org default folder; the review list fills team and destination from the service's own alerts.
const ownership = (service: string) => ({
  team: teamOf(service, []),
  notify: notifyOf(service, []),
});

const serviceRoute = (s: AutoObserveSuggestion): InsightTarget => ({
  type: "route",
  to: {
    name: "autoobserve",
    query: { org_identifier: s.org, page: "coverage", service: serviceOf(s) },
  },
});

const DRAFT_ORDER: BulkKind[] = ["errors", "latency", "no_data"];

/** The alerts a gap service needs drafted: errors and no-data on its rows, latency on its traces. */
const allDraftsOf = (row: AutoObserveCoverageRow, missing: GapClass[]): BulkKind[] => {
  if (!rowStream(row)) return [];
  const kinds: BulkKind[] = [];
  if (missing.includes("errors")) kinds.push("errors");
  if (missing.includes("latency") && streamOf(row, "traces")) kinds.push("latency");
  if (missing.includes("absence")) kinds.push("no_data");
  return DRAFT_ORDER.filter((k) => kinds.includes(k));
};

interface DraftSplit {
  open: BulkKind[];
  added: BulkKind[];
  /** Drafts whose filter keeps none of their stream's rows, so the alert could never fire. */
  unmatched: BulkKind[];
}

const NO_DRAFTS: DraftSplit = { open: [], added: [], unmatched: [] };

/** A service's drafts split into those still to add, those added here that no pass has counted yet, and those that match no rows. */
const draftsOf = (org: string, row: AutoObserveCoverageRow, missing: GapClass[]): DraftSplit => {
  const key = serviceKeyOf(org, row.service_name, row.cluster, row.namespace);
  const all = allDraftsOf(row, missing);
  const added = all.filter((kind) => recently.has(key, kind));
  const unmatched = all.filter(
    (kind) =>
      !added.includes(kind) && knownMatch(org, scopeOf(row, draftStream(row, kind))) === "none",
  );
  const open = all.filter((kind) => !added.includes(kind) && !unmatched.includes(kind));
  return { open, added, unmatched };
};

const addedChip = (t: TranslateFn): NonNullable<KindCopy["chip"]> => ({
  label: t("autoobserveLive.cell.added"),
  tone: "info",
});

// Errors and latency rows carry no usual level: the review list measures it over 7 days when it opens.
const bulkRow = (row: AutoObserveCoverageRow, kind: BulkKind): BulkRow => ({
  key: `${row.service_id}:${kind}`,
  kind,
  scope: scopeOf(row, draftStream(row, kind)),
  usually: null,
  ...ownership(row.service_name),
  ...(alertIdsOf(row).length ? { alertIds: alertIdsOf(row) } : {}),
  ...(kind === "latency" ? { inputs: { durationField: "duration", p95Ms: null } } : {}),
});

const addOne = (t: TranslateFn, row: AutoObserveCoverageRow): InsightCta | null => {
  const stream = rowStream(row);
  const own = ownership(row.service_name);
  const target = stream
    ? draftTarget(scopeOf(row, stream), (s) => noDataAlert(s, own), own.team.folderId)
    : null;
  return target ? ctaOf(t, "addAlert", target, t("insight.note.addAlert")) : null;
};

const draftCta = (t: TranslateFn, row: AutoObserveCoverageRow, drafts: BulkKind[]) => {
  if (drafts.length === 1 && drafts[0] === "no_data") return addOne(t, row);
  const rows = drafts.map((kind) => bulkRow(row, kind));
  return ctaOf(
    t,
    drafts.length === 1 ? "addAlert" : "reviewAndAddAlerts",
    {
      type: "bulk",
      request: {
        kind: drafts[0],
        rows,
        title: String(insightCtaLabel(t, "reviewAndAddAlerts")),
      },
    },
    drafts.length === 1
      ? t("insight.note.addAlert")
      : t("insight.note.reviewAndAdd", { count: drafts.length }, drafts.length),
  );
};

const trafficWhy = (
  t: TranslateFn,
  locale: string,
  s: AutoObserveSuggestion,
  key: "handles" | "usually",
): string => {
  const traffic = num(s.evidence.traffic_per_hour);
  return traffic === null
    ? ""
    : ` ${t(`insight.kind.traffic.${key}`, { count: count(traffic, locale) })}`;
};

const classWords = (t: TranslateFn, missing: GapClass[], form: "why" | "ai") =>
  missing.map((c) => String(t(`insight.kind.classes.${form}.${c}`)));

const gapCopy = (
  t: TranslateFn,
  zone: InsightZone,
  s: AutoObserveSuggestion,
  ctx: CtaContext,
): KindCopy => {
  const service = serviceOf(s);
  const cells = cellsOf(s);
  const missing = GAP_CLASSES.filter((c) => cells[c]?.state !== "covered");
  const row = rowOf(t, s, ctx);
  const split = row ? draftsOf(s.org, row, missing) : NO_DRAFTS;
  const drafts = split.open;
  // Every draft was just added, so the card says so instead of offering them again.
  const added = !drafts.length && split.added.length > 0;
  const traces = row ? !!streamOf(row, "traces") : true;
  const latencyBlocked = missing.includes("latency") && !traces;
  const stream = row ? rowStream(row) : null;
  const why = raw(
    `${t("insight.kind.coverage_gap.why", { classes: listOf(zone.locale, classWords(t, missing, "why"), "disjunction") })}${trafficWhy(t, zone.locale, s, "handles")}`,
  );
  const nextParts = [
    drafts.length
      ? String(t("insight.kind.coverage_gap.next", { count: drafts.length }, drafts.length))
      : "",
    latencyBlocked ? String(t("insight.kind.coverage_gap.needsTraces")) : "",
    row && split.unmatched.length
      ? String(
          noMatchLine(t, draftStream(row, split.unmatched[0]).name, rowLabel.get(row) ?? service),
        )
      : "",
  ].filter(Boolean);
  const cta = added
    ? null
    : row && drafts.length
      ? draftCta(t, row, drafts)
      : ctaOf(t, "openService", serviceRoute(s));
  const secondary = [
    ...(cta?.action === "openService" ? [] : [ctaOf(t, "openService", serviceRoute(s))]),
    ...(latencyBlocked ? [setUpTraces(t, s)] : []),
  ];
  const traffic = num(s.evidence.traffic_per_hour);
  return {
    chip: added ? addedChip(t) : { label: t("insight.kind.chip.notWatched"), tone: "gap" },
    headline: t("insight.kind.coverage_gap.headline", { service: raw(service) }),
    why,
    whyDetail: gapDetail(t, missing, latencyBlocked, service),
    next: !added && nextParts.length ? raw(nextParts.join(" ")) : null,
    cta,
    note: added ? addedNote(t, split.added.length) : null,
    secondary,
    ai: {
      kind: s.kind,
      subject: service,
      request: raw(
        [
          t("insight.ai.coverage_gap.ask", {
            service: raw(service),
            classes: listOf(zone.locale, classWords(t, missing, "ai"), "disjunction"),
          }),
          traffic !== null && stream
            ? t("insight.ai.coverage_gap.volume", {
                count: count(traffic, zone.locale),
                stream: raw(stream.name),
              })
            : "",
          t("insight.ai.coverage_gap.draft"),
        ]
          .filter(Boolean)
          .join(" "),
      ),
      facts: [
        ["Service", service],
        ["Coverage gap", missing.join(", ")],
        ...(traffic !== null
          ? ([["Events an hour", String(Math.round(traffic))]] as [string, string][])
          : []),
        ...(stream ? ([["Stream", `${stream.type}/${stream.name}`]] as [string, string][]) : []),
      ],
    },
  };
};

const gapDetail = (
  t: TranslateFn,
  missing: GapClass[],
  latencyBlocked: boolean,
  service: string,
): I18nText =>
  raw(
    missing
      .map((c) =>
        c === "latency" && latencyBlocked
          ? t("insight.kind.detail.cantMeasure", {
              check: t(`insight.kind.classes.name.${c}`),
              service: raw(service),
            })
          : t("insight.kind.detail.noAlert", { check: t(`insight.kind.classes.name.${c}`) }),
      )
      .join(" "),
  );

const setUpTraces = (t: TranslateFn, s: AutoObserveSuggestion): InsightCta =>
  ctaOf(
    t,
    "setUpData",
    { type: "route", to: { name: "ingestion", query: { org_identifier: s.org } } },
    null,
    "setUpTraces",
  );

const monitorOf = (cell: AutoObserveCell | undefined) => cell?.evidence?.[0] ?? null;

const noDataAi = (t: TranslateFn, zone: InsightZone, s: AutoObserveSuggestion): AiFinding => {
  const service = serviceOf(s);
  const traffic = num(s.evidence.traffic_per_hour);
  return {
    kind: s.kind,
    subject: service,
    request: raw(
      [
        t("insight.ai.no_data.ask", { service: raw(service), minutes: NO_DATA_MINUTES }),
        traffic !== null
          ? t("insight.ai.no_data.volume", { count: count(traffic, zone.locale) })
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    ),
    facts: [
      ["Service", service],
      ...(traffic !== null
        ? ([["Events an hour", String(Math.round(traffic))]] as [string, string][])
        : []),
    ],
  };
};

const silentCheckCopy = (
  t: TranslateFn,
  s: AutoObserveSuggestion,
  monitor: NonNullable<ReturnType<typeof monitorOf>>,
): KindCopy => {
  const service = serviceOf(s);
  const name = raw(monitor.monitor_name);
  const cta =
    monitor.monitor_kind === "alert"
      ? ctaOf(
          t,
          "chooseWhoGetsNotified",
          destinationsTarget(monitor.monitor_id, monitor.monitor_name),
          t("insight.note.chooseWho"),
        )
      : null;
  return {
    chip: { label: t("insight.kind.chip.notifiesNoOne"), tone: "gap" },
    why: t("insight.kind.no_absence_check.whySilent", { monitor: name, service: raw(service) }),
    whyDetail: null,
    next: t("insight.kind.no_absence_check.nextSilent"),
    cta,
    secondary: [],
    ai: {
      kind: s.kind,
      subject: monitor.monitor_name,
      request: t("insight.ai.silent.ask", { monitor: name }),
      facts: [
        ["Alert", monitor.monitor_name],
        ["Service", service],
      ],
    },
  };
};

const noAbsenceCopy = (
  t: TranslateFn,
  zone: InsightZone,
  s: AutoObserveSuggestion,
  ctx: CtaContext,
): KindCopy => {
  const service = serviceOf(s);
  const cell = cellsOf(s).absence;
  const monitor = monitorOf(cell);
  if (cell?.state === "silent" && monitor) return silentCheckCopy(t, s, monitor);
  const row = rowOf(t, s, ctx);
  const add = row ? addOne(t, row) : null;
  const params = { service: raw(service), monitor: raw(monitor?.monitor_name ?? "") };
  const lead =
    (cell?.state === "weak" || cell?.state === "blind") && monitor
      ? String(t(`insight.kind.no_absence_check.why_${cell.state}`, params))
      : `${t("insight.kind.no_absence_check.why", params)}${trafficWhy(t, zone.locale, s, "usually")}`;
  return {
    chip: { label: t("insight.kind.chip.missingAlert"), tone: "gap" },
    why: raw(lead),
    whyDetail: null,
    next: t("insight.kind.no_absence_check.next", {
      service: raw(service),
      minutes: NO_DATA_MINUTES,
    }),
    cta: add ?? ctaOf(t, "openService", serviceRoute(s)),
    secondary: add ? [ctaOf(t, "openService", serviceRoute(s))] : [],
    ai: noDataAi(t, zone, s),
  };
};

const reviewOf = (
  t: TranslateFn,
  s: AutoObserveSuggestion,
  actions: TypedAction[],
  action: CtaAction,
  note: I18nText,
): InsightCta | null => {
  const review = actions.find((a) => a.type === "review_alert");
  if (!review || review.type !== "review_alert") return null;
  return ctaOf(
    t,
    action,
    {
      type: "review_alert",
      action: review,
      alertName: str(s.evidence.alert_name) || str(s.evidence.monitor_name),
      findingId: "",
    },
    note,
  );
};

const silentCoverageCopy = (
  t: TranslateFn,
  s: AutoObserveSuggestion,
  actions: TypedAction[],
): Partial<KindCopy> => {
  const monitor = str(s.evidence.monitor_name);
  const review = actions.find((a) => a.type === "review_alert");
  return {
    chip: { label: t("insight.kind.chip.notifiesNoOne"), tone: "gap" },
    cta:
      review?.type === "review_alert"
        ? ctaOf(
            t,
            "chooseWhoGetsNotified",
            destinationsTarget(review.alert_id, str(s.evidence.alert_name) || monitor),
            t("insight.note.chooseWho"),
          )
        : null,
    ai: {
      kind: s.kind,
      subject: monitor,
      request: t("insight.ai.silent.ask", { monitor: raw(monitor) }),
      facts: [["Alert", monitor]],
    },
  };
};

const lostCopy = (t: TranslateFn, s: AutoObserveSuggestion, ctx: CtaContext): Partial<KindCopy> => {
  const service = serviceOf(s);
  const lost = Object.keys((s.evidence.lost ?? {}) as object);
  const row = rowOf(t, s, ctx);
  const add = lost.includes("absence") && row ? addOne(t, row) : null;
  return {
    why: t("insight.kind.coverage_lost.why"),
    whyDetail: null,
    next: t("insight.kind.coverage_lost.next"),
    cta: add ?? ctaOf(t, "openService", serviceRoute(s)),
    secondary: add ? [ctaOf(t, "openService", serviceRoute(s))] : [],
    ai: {
      kind: s.kind,
      subject: service,
      request: t("insight.ai.coverage_lost.ask", { service: raw(service) }),
      facts: [
        ["Service", service],
        ["Lost", lost.join(", ")],
      ],
    },
  };
};

const BLIND_NEXT: Record<string, string> = {
  stream_missing: "insight.kind.blind_guardrail.nextStream",
  no_data: "insight.kind.blind_guardrail.nextStream",
  empty_scope: "insight.kind.blind_guardrail.nextScope",
  unknown_field: "insight.kind.blind_guardrail.nextField",
  ignored_matcher: "insight.kind.blind_guardrail.nextScope",
};

const blindCopy = (
  t: TranslateFn,
  s: AutoObserveSuggestion,
  actions: TypedAction[],
): Partial<KindCopy> => {
  const reason = s.evidence.reason;
  const key = typeof reason === "string" ? reason : (Object.keys(reason ?? {})[0] ?? "");
  const monitor = str(s.evidence.monitor_name);
  const detail = str(s.evidence.detail);
  return {
    chip: { label: t("insight.chip.notWorking"), tone: "failure" },
    whyDetail: null,
    next: BLIND_NEXT[key] ? t(BLIND_NEXT[key], { detail: raw(detail) }) : null,
    cta: reviewOf(t, s, actions, "reviewAlert", t("insight.note.reviewQuery")),
    ai: {
      kind: s.kind,
      subject: monitor,
      request: t("insight.ai.blind_guardrail.ask", { monitor: raw(monitor), detail: raw(detail) }),
      facts: [
        ["Alert", monitor],
        ["Reads", detail],
        ["Reason", key],
      ],
    },
  };
};

const discoveryCopy = (t: TranslateFn, s: AutoObserveSuggestion): Partial<KindCopy> => ({
  chip: { label: t("insight.kind.chip.dataQuality"), tone: "info" },
  headline: t("insight.kind.discovery_unusable.headline", {
    good: num(s.evidence.good) ?? 0,
    active: num(s.evidence.active) ?? 0,
  }),
  why: t("insight.kind.discovery_unusable.why"),
  whyDetail: null,
  next: t("insight.kind.discovery_unusable.next"),
  cta: ctaOf(t, "setUpData", {
    type: "route",
    to: { name: "ingestion", query: { org_identifier: s.org } },
  }),
  ai: {
    kind: s.kind,
    subject: "service.name",
    request: t("insight.ai.discovery_unusable.ask"),
    facts: [
      ["Usable services", String(num(s.evidence.good) ?? 0)],
      ["Services found", String(num(s.evidence.active) ?? 0)],
    ],
  },
});

interface SourceMember {
  field: string;
  value: string;
  stream: { type: string; name: string };
}

const membersOf = (s: AutoObserveSuggestion): SourceMember[] =>
  (Array.isArray(s.evidence.sources) ? (s.evidence.sources as Record<string, unknown>[]) : [])
    .map((m) => ({
      field: str(m.source_field),
      value: str(m.source_value),
      stream: { type: str(m.stream_type) || "logs", name: str(m.stream_name) },
    }))
    .filter((m) => m.field && m.value && m.stream.name);

const sourceLogs = (t: TranslateFn, actions: TypedAction[], nowMs: number): InsightCta | null => {
  const inspect = actions.find((a) => a.type === "inspect_source");
  if (!inspect || inspect.type !== "inspect_source") return null;
  const to = logsForSources({
    stream_type: inspect.stream_type,
    stream_name: inspect.stream_name,
    field: inspect.field,
    values: [inspect.value],
    // The server's from already leads the stop; the builder adds its own lead, so it is taken back out.
    from: inspect.from + 6 * 3_600_000_000,
    to: inspect.to ?? null,
    now: nowMs * 1000,
  });
  return to
    ? ctaOf(
        t,
        "openInLogs",
        { type: "route", to: to as RouteLocationRaw },
        t("insight.note.openSourceLogs", { source: raw(inspect.value) }),
      )
    : null;
};

const sourceAdd = (t: TranslateFn, s: AutoObserveSuggestion, members: SourceMember[]) => {
  const total = num(s.evidence.source_count) ?? members.length;
  const own = ownership(members[0]?.value ?? "");
  if (total <= 1 && members[0]) {
    const prefill = sourceNoDataAlert({ ...members[0], cohortSize: 1 }, own);
    return prefill
      ? ctaOf(
          t,
          "addAlert",
          { type: "create_alert", prefill, folder: own.team.folderId },
          t("insight.note.addAlert"),
        )
      : null;
  }
  if (!members.length) return null;
  return ctaOf(
    t,
    "reviewAndAddAlerts",
    {
      type: "bulk",
      request: {
        kind: "source",
        title: String(insightCtaLabel(t, "reviewAndAddAlerts")),
        rows: members.map((m) => ({
          key: `${m.stream.name}:${m.field}:${m.value}`,
          scope: { ...m, cohortSize: total },
          usually: null,
          ...ownership(m.value),
        })),
      },
    },
    t("insight.note.reviewAndAdd", { count: members.length }, members.length),
  );
};

const sourceCopy = (
  t: TranslateFn,
  zone: InsightZone,
  s: AutoObserveSuggestion,
  actions: TypedAction[],
  nowMs: number,
): KindCopy => {
  const source = str(s.evidence.source_value);
  const stream = str(s.evidence.stream_name) || s.subject.key_dims.stream_name || "";
  const signal = num(s.evidence.signal_at);
  const perDay = num(s.evidence.rows_per_day);
  const total = num(s.evidence.source_count) ?? 1;
  const streams = num(s.evidence.stream_count) ?? 1;
  const params = { source: raw(source), stream: raw(stream) };
  const why = [
    signal !== null ? t("insight.kind.source_silence.since", { time: timeText(signal, zone) }) : "",
    perDay !== null
      ? t("insight.kind.source_silence.usual", {
          count: count(perDay, zone.locale),
          stream: raw(stream),
        })
      : "",
    total > 1 ? t("insight.kind.source_silence.more", { count: total - 1, streams }, streams) : "",
  ].filter(Boolean);
  const advice = s.advice === "see_source_gap" ? "nextGap" : "nextSender";
  const logs = sourceLogs(t, actions, nowMs);
  const add = sourceAdd(t, s, membersOf(s));
  return {
    chip: { label: t("insight.kind.chip.stoppedSending"), tone: "failure" },
    headline: t("insight.kind.source_silence.headline", params),
    why: why.length ? raw(why.join(" ")) : null,
    whyDetail: null,
    next: t(`insight.kind.source_silence.${advice}`, params),
    cta: logs ?? add,
    secondary: logs && add ? [add] : [],
    ai: {
      kind: s.kind,
      subject: source,
      request: t("insight.ai.source_silence.ask", {
        ...params,
        time: signal !== null ? timeText(signal, zone) : raw(""),
      }),
      facts: [
        ["Source", source],
        ["Stream", stream],
        ...(perDay !== null
          ? ([["Rows a day", String(Math.round(perDay))]] as [string, string][])
          : []),
        ["Sources stopped", String(total)],
      ],
    },
  };
};

const heartbeatCopy = (
  t: TranslateFn,
  s: AutoObserveSuggestion,
  actions: TypedAction[],
): KindCopy => {
  const job = s.subject.key_dims.service_name || str(s.evidence.anchor);
  const days = num(s.evidence.present_days);
  const create = actions.find((a) => a.type === "create_alert");
  const own = ownership(job);
  const prefill =
    create && create.type === "create_alert" ? heartbeatAlert(create, job, own) : null;
  return {
    chip: { label: t("insight.kind.chip.missingAlert"), tone: "gap" },
    headline: t("insight.kind.heartbeat_on_success.headline", { job: raw(job) }),
    why: days !== null ? t("insight.kind.heartbeat_on_success.why", { days }, days) : null,
    whyDetail: null,
    next: t("insight.kind.heartbeat_on_success.next"),
    cta: prefill
      ? ctaOf(
          t,
          "addAlert",
          { type: "create_alert", prefill, folder: own.team.folderId },
          t("insight.note.addHeartbeat"),
        )
      : null,
    secondary: [],
    ai: {
      kind: s.kind,
      subject: job,
      request: t("insight.ai.heartbeat_on_success.ask", { job: raw(job) }),
      facts: [
        ["Job", job],
        ["Success line", str(s.evidence.anchor)],
        ...(days !== null ? ([["Days seen", String(days)]] as [string, string][]) : []),
      ],
    },
  };
};

/** The first few gap services by name, then "and N more" up to `count`. */
const groupNames = (
  t: TranslateFn,
  zone: InsightZone,
  gaps: { s: AutoObserveSuggestion }[],
  count: number,
): { shown: string[]; named: I18nText } => {
  const names = gaps.map(({ s }) => {
    const namespace = s.subject.key_dims.k8s_namespace_name;
    return namespace ? `${serviceOf(s)} (${namespace})` : serviceOf(s);
  });
  const shown = names.slice(0, GROUP_NAMES);
  const rest = count - shown.length;
  const more =
    rest > 0 ? [String(t("autoobserveLive.suggestions.moreNames", { count: rest }, rest))] : [];
  return { shown, named: listOf(zone.locale, [...shown, ...more], "conjunction") };
};

/** Every scope the gap cards would draft an alert on, so their rows can be checked before the cards count them. */
export const gapDraftScopes = (
  t: TranslateFn,
  gaps: AutoObserveSuggestion[],
  ctx: CtaContext,
): ServiceScope[] =>
  gaps.flatMap((s) => {
    const row = s.kind === "coverage_gap" ? rowOf(t, s, ctx) : null;
    if (!row) return [];
    const missing = GAP_CLASSES.filter((c) => cellsOf(s)[c]?.state !== "covered");
    return allDraftsOf(row, missing).map((kind) => scopeOf(row, draftStream(row, kind)));
  });

/** The one card for many coverage gaps: three names and a count, one review list, Review services and Ask AI. */
export const gapGroupCopy = (
  t: TranslateFn,
  zone: InsightZone,
  gaps: AutoObserveSuggestion[],
  ctx: CtaContext,
  total: number = gaps.length,
): KindCopy => {
  const drafted = gaps.map((s) => {
    const row = rowOf(t, s, ctx);
    const missing = GAP_CLASSES.filter((c) => cellsOf(s)[c]?.state !== "covered");
    return { s, row, ...(row ? draftsOf(s.org, row, missing) : NO_DRAFTS) };
  });
  // A service with a just-added alert reads as watched on the coverage page, so the card stops counting it.
  const pending = drafted.filter((d) => !d.added.length);
  const addedAlerts = drafted.reduce((sum, d) => sum + d.added.length, 0);
  const left = Math.max(total, gaps.length) - (drafted.length - pending.length);
  if (left <= 0 && addedAlerts > 0) {
    const all = groupNames(t, zone, drafted, drafted.length);
    return groupAddedCopy(t, drafted.length, addedAlerts, all.named);
  }
  const { shown, named } = groupNames(t, zone, pending, left);
  const traffic = pending.reduce((sum, { s }) => sum + (num(s.evidence.traffic_per_hour) ?? 0), 0);
  const rows = drafted.flatMap(({ row, open }) =>
    row ? open.map((kind) => bulkRow(row, kind)) : [],
  );
  // Two suggestions can resolve to one coverage row, and a review row's key must stay unique.
  const unique = [...new Map(rows.map((r) => [r.key, r])).values()];
  const review = ctaOf(t, "reviewServices", {
    type: "route",
    to: { name: "autoobserve", query: { org_identifier: gaps[0]?.org, page: "coverage" } },
  });
  const cta = unique.length
    ? ctaOf(
        t,
        "reviewAndAddAlerts",
        {
          type: "bulk",
          request: {
            kind: unique[0].kind!,
            rows: unique,
            title: String(insightCtaLabel(t, "reviewAndAddAlerts")),
          },
        },
        t("insight.note.reviewAndAdd", { count: unique.length }, unique.length),
      )
    : null;
  return {
    chip: { label: t("insight.kind.chip.notWatched"), tone: "gap" },
    headline: t("insight.kind.coverage_gap.groupHeadline", { count: left }),
    why: raw(
      [
        `${named}.`,
        traffic > 0
          ? String(
              t("insight.kind.coverage_gap.groupTraffic", { count: count(traffic, zone.locale) }),
            )
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    ),
    whyDetail: null,
    next: unique.length
      ? t("insight.kind.coverage_gap.groupNext", { count: unique.length }, unique.length)
      : null,
    cta: cta ?? review,
    secondary: cta ? [review] : [],
    ai: {
      kind: "coverage_gap",
      subject: String(named),
      request: t("insight.ai.coverage_gap.groupAsk", {
        count: left,
        names: listOf(zone.locale, shown, "conjunction"),
      }),
      facts: [
        ["Services not watched", String(left)],
        ["First services", shown.join(", ")],
      ],
    },
  };
};

/** The group card once every gap service has a just-added alert: no Review button until a pass counts them. */
const groupAddedCopy = (
  t: TranslateFn,
  services: number,
  alerts: number,
  named: I18nText,
): KindCopy => ({
  chip: addedChip(t),
  headline: t("insight.kind.coverage_gap.groupAdded", { count: services }, services),
  why: raw(`${named}.`),
  whyDetail: null,
  next: null,
  cta: null,
  note: addedNote(t, alerts),
  secondary: [],
  ai: null,
});

const PAGED_KINDS = ["stream_silence", "stream_drop", "stream_rise"] as const;

type PagedKind = (typeof PAGED_KINDS)[number];

const pagedKindOf = (kind: string | null): PagedKind | null =>
  PAGED_KINDS.find((k) => k === kind) ?? null;

const pageLine = (t: TranslateFn, item: AutoObserveIncidentItem): PageLine | null => {
  switch (item.page?.outcome) {
    case "paged":
      return {
        tone: "neutral",
        text: item.page.team_name
          ? t("insight.kind.paged.page.paged", { team: raw(item.page.team_name) })
          : t("insight.kind.paged.page.pagedTeam"),
        routing: false,
      };
    case "unrouted":
      return { tone: "warning", text: t("insight.kind.paged.page.unrouted"), routing: true };
    case "failed":
      return { tone: "error", text: t("insight.kind.paged.page.failed"), routing: false };
    case "pending":
      return { tone: "pending", text: t("insight.kind.paged.page.pending"), routing: false };
    default:
      return null;
  }
};

/** The one copy for a paged finding's card row, for one stream or a group of many. */
export const pagedFindingCopy = (
  t: TranslateFn,
  zone: InsightZone,
  item: AutoObserveIncidentItem,
  nowMs: number,
  routingSet = false,
): PagedFindingCopy => {
  const kind = pagedKindOf(item.finding.kind);
  const line = pageLine(t, item);
  // Once the org has a default team the next stop is routed, so the card stops asking for setup.
  const page = line && routingSet ? { ...line, routing: false } : line;
  const { stream_name, stream_type, first_seen_at } = item.finding;
  if (!kind || !stream_name || !stream_type) return { headline: null, page, why: null, next: null };
  const time = formatWhen(first_seen_at / 1000, zone.locale, zone.timeZone, nowMs);
  const members = item.members ?? [];
  const many = members.length > 1;
  const names = (list: AutoObserveIncidentMember[]) => {
    const shown = list.flatMap((m) => m.stream_name ?? []).slice(0, GROUP_NAMES);
    const rest = list.length - shown.length;
    return listOf(
      zone.locale,
      [
        ...shown,
        ...(rest > 0
          ? [String(t("autoobserveLive.suggestions.moreNames", { count: rest }, rest))]
          : []),
      ],
      "conjunction",
    );
  };
  const headline = many
    ? t(`insight.kind.paged.${kind}.headline`, { count: count(members.length, zone.locale) })
    : null;
  // A resolved incident has no next step, and its streams read as back, not stopped.
  if (item.incident.status === "resolved") {
    const backAt = Math.max(0, ...members.map((m) => m.recovered_at ?? 0));
    const why = many
      ? t(`insight.kind.paged.${kind}.recoveredMany`, { streams: names(members), time })
      : t(`insight.kind.paged.${kind}.recovered`, {
          stream: raw(stream_name),
          type: raw(stream_type),
          time,
        });
    const at = backAt
      ? ` ${t("insight.kind.paged.recoveredAt", {
          time: formatWhen(backAt / 1000, zone.locale, zone.timeZone, nowMs),
        })}`
      : "";
    return { headline, page, why: raw(`${why}${at}`), next: null };
  }
  const stopped = members.filter((m) => m.recovered_at == null);
  const back = members.filter((m) => m.recovered_at != null);
  const still = back.length && stopped.length ? stopped : members;
  const whyBase = many
    ? t(`insight.kind.paged.${kind}.${still.length > 1 ? "whyMany" : "whyOne"}`, {
        streams: names(still),
        stream: raw(still[0]?.stream_name ?? stream_name),
        time,
      })
    : t(`insight.kind.paged.${kind}.why`, {
        stream: raw(stream_name),
        type: raw(stream_type),
        time,
      });
  const why =
    many && back.length && stopped.length
      ? raw(`${whyBase} ${t(`insight.kind.paged.${kind}.recoveredSome`, { streams: names(back) })}`)
      : whyBase;
  const next = String(t(`insight.kind.paged.${kind}.${many ? "nextMany" : "next"}`));
  return {
    headline,
    page,
    why,
    next: raw(page?.routing ? `${next} ${t("insight.kind.paged.nextRouting")}` : next),
  };
};

/** The kind's why, next, fix and AI request; null for a kind the list row already words in full. */
export const kindCopy = (
  t: TranslateFn,
  zone: InsightZone,
  s: AutoObserveSuggestion,
  actions: TypedAction[],
  nowMs: number,
  ctx: CtaContext,
): Partial<KindCopy> | null => {
  switch (s.kind) {
    case "coverage_gap":
      return gapCopy(t, zone, s, ctx);
    case "no_absence_check":
      return noAbsenceCopy(t, zone, s, ctx);
    case "silent_coverage":
      return silentCoverageCopy(t, s, actions);
    case "coverage_lost":
      return lostCopy(t, s, ctx);
    case "blind_guardrail":
      return blindCopy(t, s, actions);
    case "discovery_unusable":
      return discoveryCopy(t, s);
    case "source_silence":
      return sourceCopy(t, zone, s, actions, nowMs);
    case "heartbeat_on_success":
      return heartbeatCopy(t, s, actions);
    default:
      return null;
  }
};
