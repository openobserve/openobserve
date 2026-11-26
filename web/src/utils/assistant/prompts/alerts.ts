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

import type { RouteTarget } from "@/composables/assistant";
import { gt, raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { formatOrgRange } from "@/utils/formatters";

import {
  count,
  doorChip,
  finish,
  ident,
  inline,
  num,
  promptClock,
  promptRange,
  promptTime,
  zoneOf,
  type PromptBuild,
  type PromptRange,
} from "./format";

const OPERATORS: ReadonlySet<string> = new Set(["=", "!=", ">", ">=", "<", "<="]);

/** An alert as its list row or detail header knows it. */
export interface AlertInput {
  org: string;
  /** Absent for an alert that was never saved; the prompt then says "(unsaved)". */
  alertId?: string;
  name: string;
  stream?: string;
  /** The SQL, PromQL or the conditions as text. */
  condition?: string;
  threshold?: { op: string; value: number; unit?: string };
  /** The evaluated window in minutes. */
  periodMinutes?: number;
  lastFiredAt?: number;
  /** Never a destination URL: only how many. */
  destinations?: number;
  timeZone: string;
  route?: RouteTarget;
}

/** The alert as the server returns it, read loosely: list rows and the detail call carry different subsets. */
export interface AlertRecord {
  id?: string;
  alert_id?: string;
  name?: string;
  stream_name?: string;
  query_condition?: {
    sql?: string | null;
    promql?: string | null;
    conditions?: unknown;
    type?: string;
  };
  trigger_condition?: { period?: number; operator?: string; threshold?: number };
  destinations?: unknown[];
  destination?: unknown[];
  last_triggered_at?: number | string | null;
}

/** "> 500 events": a known operator, the number and an identifier unit; `null` for anything else. */
export function thresholdText(threshold: {
  op: string;
  value: number;
  unit?: string;
}): string | null {
  if (!OPERATORS.has(threshold.op) || !Number.isFinite(threshold.value)) return null;
  const unit = threshold.unit ? ident(threshold.unit) : null;
  return `${threshold.op} ${num(threshold.value)}${unit ? ` ${unit}` : ""}`;
}

/** Maps a server alert to the builder's input; `last_triggered_at` is microseconds or an ISO string. */
export function alertInputOf(
  alert: AlertRecord,
  opts: { org: string; timeZone: string; route?: RouteTarget },
): AlertInput {
  const query = alert.query_condition ?? {};
  const trigger = alert.trigger_condition ?? {};
  const fired = firedAtMs(alert.last_triggered_at);
  const destinations = alert.destinations ?? alert.destination;
  const id = alert.id ?? alert.alert_id;
  return {
    org: opts.org,
    ...(id && { alertId: id }),
    name: alert.name ?? "",
    ...(alert.stream_name && { stream: alert.stream_name }),
    ...(conditionText(query) && { condition: conditionText(query) }),
    ...(typeof trigger.threshold === "number" && {
      threshold: { op: trigger.operator ?? ">=", value: trigger.threshold, unit: "events" },
    }),
    ...(typeof trigger.period === "number" && { periodMinutes: trigger.period }),
    ...(fired !== null && { lastFiredAt: fired }),
    ...(Array.isArray(destinations) && { destinations: destinations.length }),
    timeZone: opts.timeZone,
    ...(opts.route && { route: opts.route }),
  };
}

/** An alert chip: name, stream and condition are author-controlled, so they travel only here. */
export function alertChip(
  input: Pick<AlertInput, "org" | "alertId" | "name" | "route" | "stream" | "condition">,
  chip: { label: I18nText; type: "alert" | "alert_firing"; id?: string },
): PromptBuild["chips"][number] {
  const id = chip.id ?? input.alertId;
  return doorChip({
    kind: "alert",
    key: `${input.org}|${chip.type}|${id ?? input.name}`,
    label: chip.label,
    short: raw(inline(input.name, 60)),
    ref: {
      type: chip.type,
      ...(id && { id }),
      org: input.org,
      ...(input.route && { route: input.route }),
    },
    data: {
      name: input.name,
      ...(input.stream && { stream: input.stream }),
      ...(input.condition && { condition: input.condition }),
    },
    sent: "serialized",
  });
}

/** Explain or Troubleshoot this alert: numbers and times in the text, everything the author wrote in the Alert block; never a destination URL. */
export function buildAlertPrompt(
  input: AlertInput,
  verb: "explain" | "troubleshoot",
  t: TranslateFn = gt,
): PromptBuild {
  const threshold = input.threshold ? thresholdText(input.threshold) : null;
  const facts = [
    threshold
      ? `threshold ${threshold}${input.periodMinutes !== undefined ? ` for ${count(input.periodMinutes)} ${input.periodMinutes === 1 ? "minute" : "minutes"}` : ""}`
      : null,
    input.lastFiredAt === undefined
      ? null
      : `last fired ${promptTime(input.lastFiredAt, input.timeZone)} ${zoneOf(input.timeZone)}`,
    input.destinations === undefined ? null : `destinations: ${count(input.destinations)}`,
  ].filter(Boolean);
  const text = finish([
    `${verb === "troubleshoot" ? "Troubleshoot" : "Explain"} the alert in the attached Alert block${input.alertId ? "" : " (unsaved)"}${facts.length ? `: ${facts.join(", ")}` : ""}.`,
    "The block holds its name, stream and condition.",
    verb === "troubleshoot"
      ? "Why did it fire and is the threshold right?"
      : "What does it watch, and is it set up to catch what matters?",
  ]);
  const label = input.alertId
    ? t("assistant.context.chip.alert", { name: raw(inline(input.name, 60)) })
    : t("assistant.entry.chip.alertNew");
  const chip = alertChip(input, { label, type: "alert" });
  return { text, chips: [chip], title: chip.label };
}

function conditionText(query: NonNullable<AlertRecord["query_condition"]>): string {
  if (query.sql) return query.sql;
  if (query.promql) return query.promql;
  return Array.isArray(query.conditions)
    ? query.conditions
        .map((c: { column?: string; operator?: string; value?: unknown }) =>
          [c.column, c.operator, c.value].filter((part) => part !== undefined).join(" "),
        )
        .filter(Boolean)
        .join(" AND ")
    : "";
}

function firedAtMs(value: AlertRecord["last_triggered_at"]): number | null {
  if (typeof value === "number" && value > 0)
    return value > 1e14 ? Math.round(value / 1000) : value;
  if (typeof value === "string" && value) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** One evaluation that fired: a row of the alert groups table or the history drawer. */
export interface AlertFiringInput extends Pick<AlertInput, "org" | "alertId" | "name" | "route"> {
  firedAt: number;
  observed?: { value: number; unit?: string };
  threshold?: { op: string; value: number; unit?: string };
  /** The window the evaluation read. */
  window?: PromptRange;
  stream?: string;
  query?: string;
  timeZone: string;
}

/** Troubleshoot this alert firing: the observed number, threshold and windows in the text; name, stream and query in the Alert block. */
export function buildAlertFiringPrompt(input: AlertFiringInput, t: TranslateFn = gt): PromptBuild {
  const unit = input.observed?.unit ? ident(input.observed.unit) : null;
  const observed = input.observed
    ? `observed ${num(input.observed.value)}${unit ? ` ${unit}` : ""}`
    : null;
  const threshold = input.threshold ? thresholdText(input.threshold) : null;
  const window = input.window
    ? `over the evaluated window ${promptRange(input.window, input.timeZone)}`
    : null;
  const measured = [observed, threshold && `against threshold ${threshold}`, window]
    .filter(Boolean)
    .join(" ");
  const text = finish([
    `The alert in the attached Alert block fired at ${promptTime(input.firedAt, input.timeZone)} ${zoneOf(input.timeZone)}${measured ? `: ${measured}` : ""}.`,
    "The block holds its name, stream and query.",
    "Why did it fire and what changed?",
  ]);
  const clock = promptClock(input.firedAt, input.timeZone).slice(0, 5);
  const name = inline(input.name, 60);
  const chip = alertChip(
    { ...input, ...(input.query && { condition: input.query }) },
    {
      label: t("assistant.entry.chip.alertFired", { name: raw(name), time: raw(clock) }),
      type: "alert_firing",
      id: `${input.alertId ?? input.name}:${input.firedAt}`,
    },
  );
  const title = t("assistant.context.chip.alert", { name: raw(`${name} · ${clock}`) });
  return { text, chips: [chip], title };
}

/** The report body sent with "Ask about this report"; longer reports are cut, never dropped. */
export const MAX_REPORT_CHARS = 32_000;

/** An incident and the report of one of its analysis runs. */
export interface IncidentReportInput {
  org: string;
  incidentId: string;
  /** The run whose report is attached; the Report chip is keyed by it, and absent before any analysis finished. */
  runId?: string;
  title: string;
  severity?: string;
  status?: string;
  report?: string;
  /** "Run 2 · Oct 16, 14:09 · 4 KB": the run and size the Report chip names. */
  reportLabel?: I18nText;
  /** The incident's alert window (ms); the Time chip. */
  window?: { from: number; to: number };
}

/** Explain this incident analysis report: the incident and the run's report as blocks, the question in the text. */
export function buildIncidentReportPrompt(
  input: IncidentReportInput,
  t: TranslateFn = gt,
): PromptBuild {
  const name = inline(input.title || input.incidentId, 60);
  // The composer shows exactly this; the chips carry the incident and the report.
  const reported = !!input.runId && !!input.report;
  const text = t(reported ? "assistant.rca.prompt" : "assistant.rca.incidentPrompt");
  const incident = doorChip({
    kind: "incident",
    key: `${input.org}|incident|${input.incidentId}`,
    label: t("assistant.context.chip.incident", { name: raw(name) }),
    short: raw(name),
    ref: { type: "incident", id: input.incidentId, org: input.org },
    data: {
      title: input.title,
      ...(input.severity && { severity: input.severity }),
      ...(input.status && { status: input.status }),
    },
    sent: "serialized",
  });
  const report = reported
    ? doorChip({
        kind: "report",
        key: `${input.org}|incident_report|${input.runId}`,
        label: input.reportLabel ?? t("assistant.rca.tag"),
        ref: { type: "incident_report", id: input.runId, org: input.org },
        data: { report: (input.report ?? "").slice(0, MAX_REPORT_CHARS) },
        sent: "serialized",
      })
    : null;
  const time = input.window
    ? doorChip({
        kind: "time",
        key: `${input.org}|time|${input.window.from}-${input.window.to}`,
        label: raw(formatOrgRange(input.window.from, input.window.to)),
        ref: { type: "time", org: input.org, from: input.window.from, to: input.window.to },
        sent: "whitelist",
      })
    : null;
  return {
    text,
    chips: [time, incident, report].filter((chip) => chip !== null),
    title: t("assistant.context.chip.incident", { name: raw(name) }),
  };
}
