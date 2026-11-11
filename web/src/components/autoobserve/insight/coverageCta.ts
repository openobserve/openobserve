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
import config from "@/aws-exports";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { buildLogsRoute, buildTracesRoute } from "@/utils/metrics/metricDrilldown";
import {
  baselineSql,
  errorFieldOf,
  errorsAlert,
  latencyAlert,
  memoryAlert,
  noDataAlert,
  nodeAlert,
  restartAlert,
  type ServiceScope,
} from "@/utils/alerts/prefill/fromAutoObserve";
import { syntheticPrefillFor } from "@/utils/synthetics/syntheticPrefill";
import type { CoverageCell, CoverageRow, LiveCheck } from "../fixtures";
import type { SyntheticsLocation } from "@/types/synthetics";
import {
  cantBuild,
  readStreamFields,
  type BulkKind,
  type BulkRow,
  type StreamFields,
} from "./bulk/useBulkReview";
import {
  KIND_OF_CHECK,
  addedNote,
  serviceKeyOf,
  useRecentlyCreated,
} from "./bulk/useRecentlyCreated";
import { draftTarget, type AlertDraft } from "./targets/alertDraft";
import { checkScopeMatch } from "./targets/scopeMatch";
import type { ServiceAddress } from "./targets/serviceAddress";
import { notifyOf, teamOf, type OwnedAlert } from "./targets/ownership";
import { insightCtaLabel, type AiFinding, type CtaAction } from "./insightCta";
import {
  destinationsTarget,
  type InsightCta,
  type InsightParts,
  type InsightTarget,
} from "./insightCopy";

type Stream = { type: string; name: string };
type CellKey = LiveCheck | "saturation" | "external_probe" | "workload_health" | "node";

interface CellCopy {
  why: I18nText;
  next: I18nText | null;
  cta: InsightCta | null;
  ai: AiFinding | null;
}

/** What the drawer read for Add synthetic check; unknown fields stay empty in the form. */
export interface SyntheticInputs {
  address: ServiceAddress | null;
  locations: SyntheticsLocation[];
}

const NO_DATA_MINUTES = 15;
const HOUR_US = 3_600_000_000;
const NO_SYNTHETIC_INPUTS: SyntheticInputs = { address: null, locations: [] };
const recently = useRecentlyCreated();

const enterprise = () => config.isEnterprise === "true";

const streamOf = (row: CoverageRow, type: string): Stream | null =>
  row.identity?.streams.find((s) => s.type === type) ?? null;

// Errors and no-data read rows, so logs come first and traces stand in without them.
const rowStream = (row: CoverageRow) => streamOf(row, "logs") ?? streamOf(row, "traces");

const nameOf = (row: CoverageRow) => row.identity?.serviceName ?? row.service;

const scopeOf = (row: CoverageRow, stream: Stream): ServiceScope => ({
  service: nameOf(row),
  label: row.service,
  cluster: row.identity?.cluster ?? null,
  namespace: row.identity?.namespace ?? null,
  stream,
});

const ownership = (service: string, owned: OwnedAlert[]) => ({
  team: teamOf(service, owned),
  notify: notifyOf(service, owned),
});

const ctaOf = (
  t: TranslateFn,
  action: CtaAction,
  target: InsightTarget,
  note: I18nText | null,
): InsightCta => ({ key: action, action, label: insightCtaLabel(t, action), target, note });

const addAlert = (
  t: TranslateFn,
  scope: ServiceScope,
  build: AlertDraft["build"],
  folder: string,
  measure?: AlertDraft["measure"],
) => {
  const target = draftTarget(scope, build, folder, measure);
  return target ? ctaOf(t, "addAlert", target, t("insight.note.addAlert")) : null;
};

const measureOf =
  (kind: "errors" | "latency"): NonNullable<AlertDraft["measure"]> =>
  (s) => {
    const sql =
      kind === "errors"
        ? baselineSql(s, { kind, errorField: errorFieldOf(s.stream.type, s.schema, s.fieldTypes) })
        : baselineSql(s, { kind, durationField: "duration" });
    return sql ? { kind, stream: s.stream, sql } : null;
  };

const DRAFT_ORDER: BulkKind[] = ["errors", "latency", "no_data"];

const unwatched = (cell: CoverageCell | undefined) =>
  !!cell && cell.engine?.stateKey !== "covered" && cell.state !== "watched";

/** Whether this page added the alert for one of the service's checks and no pass has counted it yet. */
export const justAdded = (org: string, row: CoverageRow, check: LiveCheck): boolean =>
  recently.has(
    serviceKeyOf(org, nameOf(row), row.identity?.cluster ?? null, row.identity?.namespace ?? null),
    KIND_OF_CHECK[check],
  );

/** The alerts one service still needs drafted: errors and no-data on its rows, latency on its traces. */
const draftsOf = (
  row: CoverageRow,
  checks: Record<LiveCheck, CoverageCell>,
  org: string,
): BulkKind[] => {
  if (!rowStream(row)) return [];
  // An alert added here stays out of the list until a pass counts it, so it is never added twice.
  const open = (check: LiveCheck) => unwatched(checks[check]) && !justAdded(org, row, check);
  const kinds: BulkKind[] = [
    ...(open("errors") ? (["errors"] as BulkKind[]) : []),
    ...(open("latency") && streamOf(row, "traces") ? (["latency"] as BulkKind[]) : []),
    ...(open("absence") ? (["no_data"] as BulkKind[]) : []),
  ];
  return DRAFT_ORDER.filter((k) => kinds.includes(k));
};

// Errors and latency rows carry no usual level: the review list measures it over 7 days when it opens.
const bulkRowOf = (row: CoverageRow, kind: BulkKind, owned: OwnedAlert[]): BulkRow => ({
  key: `${row.identity?.serviceId ?? row.service}:${kind}`,
  kind,
  scope: scopeOf(row, kind === "latency" ? streamOf(row, "traces")! : rowStream(row)!),
  usually: null,
  ...ownership(nameOf(row), owned),
  ...(kind === "latency" ? { inputs: { durationField: "duration", p95Ms: null } } : {}),
});

const bulkTarget = (
  t: TranslateFn,
  row: CoverageRow,
  kinds: BulkKind[],
  owned: OwnedAlert[],
): InsightTarget => ({
  type: "bulk",
  request: {
    kind: kinds[0],
    title: String(insightCtaLabel(t, "reviewAndAddAlerts")),
    rows: kinds.map((kind) => bulkRowOf(row, kind, owned)),
  },
});

// Only a service with a known cluster has a cluster to set Kubernetes up for.
const kubeNote = (t: TranslateFn, row: CoverageRow): I18nText | null =>
  row.identity?.cluster ? t("insight.note.setUpKubernetes") : null;

const setUpData = (t: TranslateFn, org: string, note: I18nText | null = null) =>
  ctaOf(
    t,
    "setUpData",
    { type: "route", to: { name: "ingestion", query: { org_identifier: org } } },
    note,
  );

const ai = (
  kind: string,
  row: CoverageRow,
  request: I18nText,
  facts: [string, string][] = [],
): AiFinding => ({
  kind,
  subject: nameOf(row),
  request,
  facts: [["Service", nameOf(row)], ...facts],
});

const partsOf = (
  id: string,
  copy: Partial<Omit<CellCopy, "why">> & { why: I18nText | null },
): InsightParts => ({
  id,
  chip: { label: raw(""), variant: "default-soft", tone: "info" },
  headline: raw(""),
  why: copy.why,
  whyDetail: null,
  next: copy.next ?? null,
  cta: enterprise() ? (copy.cta ?? null) : null,
  secondary: [],
  note: enterprise() ? (copy.cta?.note ?? null) : null,
  facts: [],
  meta: null,
  dismissable: null,
  ai: enterprise() ? (copy.ai ?? null) : null,
});

/** The drafts the service's stream fields rule out, read before the gap card counts them. */
export const cantBuildKinds = async (
  org: string,
  row: CoverageRow,
  read: (org: string, stream: Stream) => Promise<StreamFields | null> = readStreamFields,
): Promise<Set<BulkKind>> => {
  if (!row.checks) return new Set();
  const kinds = draftsOf(row, row.checks, org);
  const ruled = await Promise.all(
    kinds.map(async (kind) => {
      const draft = bulkRowOf(row, kind, []);
      const fields = await read(org, draft.scope.stream);
      if (cantBuild(draft, fields)) return kind;
      const scope = { ...(draft.scope as ServiceScope), schema: fields?.names };
      return fields && (await checkScopeMatch(org, scope)) === "none" ? kind : null;
    }),
  );
  return new Set(ruled.filter((kind): kind is BulkKind => kind !== null));
};

/** The Signals watched card's one action row: every draftable gap of the service in one list, plus Ask AI. */
export const gapInsight = (
  t: TranslateFn,
  locale: string,
  row: CoverageRow,
  owned: OwnedAlert[] = [],
  org: string = "",
  cant: ReadonlySet<BulkKind> = new Set(),
): InsightParts | null => {
  const checks = row.checks;
  if (!checks) return null;
  const own = ownership(nameOf(row), owned);
  const kinds = draftsOf(row, checks, org).filter((kind) => !cant.has(kind));
  const one =
    kinds.length === 1 && kinds[0] === "no_data"
      ? addAlert(t, scopeOf(row, rowStream(row)!), (s) => noDataAlert(s, own), own.team.folderId)
      : null;
  const cta =
    one ??
    (kinds.length
      ? ctaOf(
          t,
          kinds.length === 1 ? "addAlert" : "reviewAndAddAlerts",
          bulkTarget(t, row, kinds, owned),
          kinds.length === 1
            ? t("insight.note.addAlert")
            : t("insight.note.reviewAndAdd", { count: kinds.length }, kinds.length),
        )
      : null);
  const missing = (["errors", "latency", "absence"] as LiveCheck[]).filter(
    (c) => checks[c].engine?.stateKey !== "covered",
  );
  const classes = raw(
    new Intl.ListFormat(locale, { type: "disjunction" }).format(
      missing.map((c) => String(t(`insight.kind.classes.ai.${c}`))),
    ),
  );
  return partsOf(`gap-${row.service}`, {
    why: null,
    cta,
    ai: ai(
      "coverage_gap",
      row,
      raw(
        `${t("insight.ai.coverage_gap.ask", { service: raw(nameOf(row)), classes })} ${t("insight.ai.coverage_gap.draft")}`,
      ),
      [["Coverage gap", missing.join(", ")]],
    ),
  });
};

const FALLS_STATES = new Set(["weak", "silent", "blind", "unmapped"]);

/** The same alerts and the same fault the summary names, for a live check an alert matches but falls short on. */
const fallsWhy = (
  t: TranslateFn,
  locale: string,
  row: CoverageRow,
  key: CellKey,
  cell: CoverageCell,
): I18nText | null => {
  const state = cell.engine?.stateKey ?? "none";
  if (!(key in KIND_OF_CHECK) || !FALLS_STATES.has(state)) return null;
  const names = [
    ...new Set(
      (cell.engine?.monitors ?? []).filter((m) => m.stateKey === state).map((m) => m.name),
    ),
  ];
  if (!names.length) return null;
  const monitor = raw(new Intl.ListFormat(locale, { type: "conjunction" }).format(names));
  const what = t(`insight.kind.cell.watchWhat.${key as LiveCheck}`, { service: raw(nameOf(row)) });
  return t(`insight.kind.cell.falls.${state as "weak"}`, { monitor, what }, names.length);
};

const silentCopy = (t: TranslateFn, row: CoverageRow, cell: CoverageCell): CellCopy | null => {
  const monitor = cell.engine?.monitors.find((m) => m.stateKey === "silent");
  if (!monitor) return null;
  return {
    why: t("insight.kind.no_absence_check.whySilent", {
      monitor: raw(monitor.name),
      service: raw(nameOf(row)),
    }),
    next: t("insight.kind.no_absence_check.nextSilent"),
    cta:
      monitor.kindKey === "alert"
        ? ctaOf(
            t,
            "chooseWhoGetsNotified",
            destinationsTarget(monitor.id, monitor.name),
            t("insight.note.chooseWho"),
          )
        : null,
    ai: ai("silent", row, t("insight.ai.silent.ask", { monitor: raw(monitor.name) }), [
      ["Alert", monitor.name],
    ]),
  };
};

const absenceCopy = (t: TranslateFn, row: CoverageRow, owned: OwnedAlert[]): CellCopy => {
  const stream = rowStream(row);
  const own = ownership(nameOf(row), owned);
  const service = raw(nameOf(row));
  return {
    why: t("insight.kind.no_absence_check.why", { service }),
    next: t("insight.kind.no_absence_check.next", { service, minutes: NO_DATA_MINUTES }),
    cta: stream
      ? addAlert(t, scopeOf(row, stream), (s) => noDataAlert(s, own), own.team.folderId)
      : null,
    ai: ai("no_data", row, t("insight.ai.no_data.ask", { service, minutes: NO_DATA_MINUTES })),
  };
};

const errorsCopy = (t: TranslateFn, row: CoverageRow, owned: OwnedAlert[]): CellCopy => {
  const service = raw(nameOf(row));
  const stream = rowStream(row);
  const own = ownership(nameOf(row), owned);
  // The 11-09 decision: a logs stream's errors open the one-row review list, which resolves the error field first.
  const cta =
    stream?.type === "traces"
      ? addAlert(
          t,
          scopeOf(row, stream),
          (s, level) =>
            errorsAlert(s, {
              ...own,
              errorField: errorFieldOf("traces"),
              usualPerHour: level?.usual ?? null,
              threshold: level?.threshold ?? null,
            }),
          own.team.folderId,
          measureOf("errors"),
        )
      : stream
        ? ctaOf(
            t,
            "addAlert",
            bulkTarget(t, row, ["errors"], owned),
            t("insight.note.reviewAndAdd", { count: 1 }, 1),
          )
        : null;
  return {
    why: t("insight.kind.cell.errorsWhy", { service }),
    next: t("insight.kind.cell.errorsNext"),
    cta,
    ai: ai("errors", row, t("insight.ai.cell.errors", { service })),
  };
};

const latencyCopy = (
  t: TranslateFn,
  row: CoverageRow,
  org: string,
  owned: OwnedAlert[],
): CellCopy => {
  const service = raw(nameOf(row));
  const traces = streamOf(row, "traces");
  const own = ownership(nameOf(row), owned);
  if (!traces)
    return {
      why: t("insight.kind.cell.latencyNoTraces", { service }),
      next: null,
      cta: setUpData(t, org),
      ai: ai("latency", row, t("insight.ai.cell.tracing", { service })),
    };
  return {
    why: t("insight.kind.cell.latencyWhy", { service }),
    next: t("insight.kind.cell.latencyNext"),
    cta: addAlert(
      t,
      scopeOf(row, traces),
      (s, level) =>
        latencyAlert(s, {
          ...own,
          durationField: "duration",
          p95Ms: level?.usual ?? null,
          threshold: level?.threshold ?? null,
        }),
      own.team.folderId,
      measureOf("latency"),
    ),
    ai: ai("latency", row, t("insight.ai.cell.latency", { service })),
  };
};

const metricsCopy = (
  t: TranslateFn,
  row: CoverageRow,
  key: "saturation" | "node",
  org: string,
  owned: OwnedAlert[],
): CellCopy => {
  const service = raw(nameOf(row));
  const metrics = streamOf(row, "metrics");
  const own = ownership(nameOf(row), owned);
  if (!metrics)
    return {
      why: t("insight.kind.cell.noMetrics", { service }),
      next: null,
      cta: setUpData(t, org, kubeNote(t, row)),
      ai: ai(key, row, t("insight.ai.cell.kubernetes", { service })),
    };
  const build = key === "saturation" ? memoryAlert : nodeAlert;
  return {
    why: t(`insight.kind.cell.${key}Why`, { service, stream: raw(metrics.name) }),
    next: t(`insight.kind.cell.${key}Next`),
    cta: addAlert(t, scopeOf(row, metrics), (s) => build(s, own), own.team.folderId),
    ai: ai(key, row, t(`insight.ai.cell.${key}`, { service })),
  };
};

const restartCopy = (
  t: TranslateFn,
  row: CoverageRow,
  org: string,
  owned: OwnedAlert[],
): CellCopy => {
  const service = raw(nameOf(row));
  const own = ownership(nameOf(row), owned);
  const events = row.identity?.streams.find((s) => s.type === "logs" && /event/i.test(s.name));
  // Without restart events there is nothing to alert on, so the step is getting that data in.
  if (!events)
    return {
      why: t("insight.kind.cell.noRestartEvents", { service }),
      next: null,
      cta: setUpData(t, org, kubeNote(t, row)),
      ai: ai("workload_health", row, t("insight.ai.cell.kubernetes", { service })),
    };
  const scope = scopeOf(row, events);
  return {
    why: t("insight.kind.cell.restartsWhy", { service }),
    next: t("insight.kind.cell.restartsNext"),
    cta: addAlert(t, scope, (s) => restartAlert(s, own), own.team.folderId),
    ai: ai("workload_health", row, t("insight.ai.cell.restarts", { service })),
  };
};

const syntheticCopy = (
  t: TranslateFn,
  row: CoverageRow,
  inputs: SyntheticInputs,
  owned: OwnedAlert[],
): CellCopy => {
  const service = raw(nameOf(row));
  const own = ownership(nameOf(row), owned);
  const prefill = syntheticPrefillFor(
    {
      name: nameOf(row),
      cluster: row.identity?.cluster ?? null,
      namespace: row.identity?.namespace ?? null,
    },
    { ...inputs, ...own },
  );
  return {
    why: t("insight.kind.cell.syntheticWhy", { service }),
    next: t("insight.kind.cell.syntheticNext"),
    cta: prefill
      ? ctaOf(
          t,
          "addSyntheticCheck",
          { type: "synthetic", prefill },
          t("insight.note.addSynthetic"),
        )
      : null,
    ai: ai("external_probe", row, t("insight.ai.cell.synthetic", { service })),
  };
};

const gapCopy = (
  t: TranslateFn,
  row: CoverageRow,
  key: CellKey,
  org: string,
  synthetic: SyntheticInputs,
  owned: OwnedAlert[],
): CellCopy | null => {
  switch (key) {
    case "absence":
      return absenceCopy(t, row, owned);
    case "errors":
      return errorsCopy(t, row, owned);
    case "latency":
      return latencyCopy(t, row, org, owned);
    case "saturation":
    case "node":
      return metricsCopy(t, row, key, org, owned);
    case "workload_health":
      return restartCopy(t, row, org, owned);
    case "external_probe":
      return syntheticCopy(t, row, synthetic, owned);
    default:
      return null;
  }
};

/** One chart's or Other checks row's why, next step and fix; null for a check that is watched. */
export const cellInsight = (
  t: TranslateFn,
  locale: string,
  row: CoverageRow,
  key: CellKey,
  cell: CoverageCell,
  org: string = "",
  synthetic: SyntheticInputs = NO_SYNTHETIC_INPUTS,
  owned: OwnedAlert[] = [],
): InsightParts | null => {
  const state = cell.engine?.stateKey;
  if (cell.state !== "gap" || state === "covered") return null;
  if (key in KIND_OF_CHECK && justAdded(org, row, key as LiveCheck)) {
    return partsOf(`${row.service}-${key}`, { why: addedNote(t), cta: null });
  }
  const copy =
    state === "silent" ? silentCopy(t, row, cell) : gapCopy(t, row, key, org, synthetic, owned);
  if (!copy) return null;
  return partsOf(`${row.service}-${key}`, {
    ...copy,
    why: fallsWhy(t, locale, row, key, cell) ?? copy.why,
  });
};

/** The ids of the alerts coverage matched to the service, which say where its alerts live and whom they notify. */
export const ownedAlertIds = (row: CoverageRow): string[] => {
  const cells = [...Object.values(row.checks ?? {}), ...Object.values(row.cells ?? {})];
  const ids = cells.flatMap((c) =>
    (c?.engine?.monitors ?? []).filter((m) => m.kindKey === "alert").map((m) => m.id),
  );
  return [...new Set(ids)].sort();
};

/** The service on its traces stream, where its health address is read from; null without traces. */
export const probeScope = (row: CoverageRow): ServiceScope | null => {
  const traces = streamOf(row, "traces");
  return traces ? scopeOf(row, traces) : null;
};

/** Traces for this service over the last hour, on its own traces stream. */
export const tracesRoute = (row: CoverageRow, org: string, nowUs: number): RouteLocationRaw =>
  buildTracesRoute({
    stream: streamOf(row, "traces")?.name ?? "default",
    filters: { service_name: nameOf(row) },
    timeRange: { start_time: nowUs - HOUR_US, end_time: nowUs },
    org,
  });

/** The filters each stream's charts read, so the page it opens shows the same scope. */
export type ChartScopes = Partial<Record<"traces" | "logs", Record<string, string>>>;

/** The last hour of this service where its data is: Traces on its traces stream, else Logs on its logs stream. */
export const serviceRoute = (
  row: CoverageRow,
  org: string,
  nowUs: number,
  scopes: ChartScopes = {},
): RouteLocationRaw | null => {
  const timeRange = { start_time: nowUs - HOUR_US, end_time: nowUs };
  const traces = streamOf(row, "traces");
  if (traces) {
    const filters = scopes.traces ?? { service_name: nameOf(row) };
    return buildTracesRoute({ stream: traces.name, filters, timeRange, org });
  }
  const logs = streamOf(row, "logs");
  if (!logs) return null;
  const filters = scopes.logs ?? { service_name: nameOf(row) };
  return buildLogsRoute({ stream: logs.name, filters, timeRange, org });
};
