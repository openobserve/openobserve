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

import type { OpenAssistantCall } from "@/composables/assistant";
import type { ContextChip, OpenAssistantResult, Sid } from "@/composables/assistant/pure";
import type { OverviewNowRow, OverviewNowSnapshot } from "@/composables/contextProviders/types";
import type { HomeReturnState } from "@/composables/goto/homeReturn";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";

const NAME_CAP = 120;

type ServiceRow = Extract<OverviewNowRow, { kind: "service" }>;

type NameFormat = (name: string) => string;

/** What one Investigate did: sent, left a note on the row, ran the page's own action, or nothing (the door toasted). */
export type InvestigateOutcome =
  | { kind: "sent"; sid: Sid }
  | { kind: "not_sent"; note: I18nText; showRuns: boolean }
  | { kind: "fallback" }
  | { kind: "none" };

/** Everything the hand-off reads besides the row, injected so the refusal rules are unit-tested. */
export interface InvestigateDeps {
  open: (call: OpenAssistantCall) => Promise<OpenAssistantResult>;
  /** Running chats and the cap; at the cap nothing is sent. */
  runs: { active: number; cap: number };
  creditsExhausted: boolean;
  snapshot: OverviewNowSnapshot;
  t: TranslateFn;
  /** The incident chip for an incident row; existing chip kinds only. */
  incidentChip: (row: Extract<OverviewNowRow, { kind: "incident" }>) => ContextChip | null;
  arm: (sid: Sid, state: HomeReturnState) => void;
  returnState: HomeReturnState;
  userOrgKey?: string;
}

/** Hands a Now row to a new sidebar chat and sends its sentence; a refusal says why on the row. */
export async function investigateRow(
  row: OverviewNowRow,
  deps: InvestigateDeps,
): Promise<InvestigateOutcome> {
  if (deps.creditsExhausted) return { kind: "fallback" };
  if (deps.runs.active >= deps.runs.cap) {
    return {
      kind: "not_sent",
      note: deps.t("overview.now.notSent.runCap", { n: deps.runs.active }),
      showRuns: true,
    };
  }
  const chip = row.kind === "incident" ? deps.incidentChip(row) : null;
  const result = await deps.open({
    entryKind: "object_verb",
    entryVerb: "troubleshoot",
    intent: "send",
    objectKind: objectKindOf(row),
    thread: "new",
    container: "sidebar",
    payload: {
      text: investigateMessage(row, deps.snapshot, deps.t),
      chips: chip ? [chip] : [],
      timeOverride: investigateWindow(row, deps.snapshot),
    },
    ...(deps.userOrgKey && { userOrgKey: deps.userOrgKey }),
  });
  if (result.ok) {
    deps.arm(result.sid, deps.returnState);
    return { kind: "sent", sid: result.sid };
  }
  return refusalOutcome(result.reason, deps.t);
}

function refusalOutcome(
  reason: Extract<OpenAssistantResult, { ok: false }>["reason"],
  t: TranslateFn,
): InvestigateOutcome {
  switch (reason) {
    case "org_changed":
      return { kind: "none" };
    case "loading":
    case "approval_pending":
    case "turn_running_no_autosend":
      return { kind: "not_sent", note: t("overview.now.notSent.generic"), showRuns: false };
    case "not_entitled":
    case "not_configured":
    case "off_for_org":
    case "unhealthy":
    case "no_permission":
    case "available":
      return { kind: "fallback" };
    default:
      return assertNever(reason);
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled refusal ${String(value)}`);
}

/** The door's object kind; `anomaly` exists for telemetry only. */
export function objectKindOf(row: OverviewNowRow): OpenAssistantCall["objectKind"] {
  if (row.kind === "incident") return "incident";
  if (row.kind === "alert") return "alert_firing";
  if (row.kind === "service") return "service_edge";
  return "anomaly";
}

/** Service rows ask about the trend's effective window, which can end before the page range; others the page range. */
export function investigateWindow(
  row: OverviewNowRow,
  snapshot: OverviewNowSnapshot,
): { from: number; to: number } {
  const window =
    row.kind === "service" && snapshot.services.window ? snapshot.services.window : snapshot.window;
  return { from: Math.floor(window.start / 1000), to: Math.ceil(window.end / 1000) };
}

/** The figure a service row shows: error rate or p99 multiple, against the baseline when there is one. */
export function serviceFigure(row: ServiceRow, t: TranslateFn): I18nText {
  if (row.signal === "latency") return raw(`${formatRatio(row.p99Ratio)}×`);
  const value = formatPercent(row.errorRate);
  if (row.baselineErrorRate === null || row.baselineHours === null) return value;
  return t("overview.now.vsBaseline", {
    value,
    baseline: formatPercent(row.baselineErrorRate),
    hours: row.baselineHours,
  });
}

/** The row's sentence as people read it; `brief` is the row's own line, whose figure and state sit beside it. */
export function rowSentence(
  row: OverviewNowRow,
  snapshot: OverviewNowSnapshot,
  t: TranslateFn,
  brief = false,
): I18nText {
  return sentenceOf(row, snapshot, t, brief, (name) => name);
}

/** The message an Investigate sends: the fixed sentence, with every telemetry name as a quoted literal. */
export function investigateMessage(
  row: OverviewNowRow,
  snapshot: OverviewNowSnapshot,
  t: TranslateFn,
): I18nText {
  return sentenceOf(row, snapshot, t, false, quotedName);
}

/** A telemetry name on one line inside JSON quotes, so it reads as data and cannot open an instruction of its own. */
export function quotedName(name: string): string {
  const flat = name.replace(/\s+/g, " ").trim();
  return JSON.stringify(flat.length > NAME_CAP ? `${flat.slice(0, NAME_CAP)}…` : flat);
}

export function formatPercent(value: number): I18nText {
  return raw(`${value.toFixed(1)}%`);
}

export function formatRatio(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

function sentenceOf(
  row: OverviewNowRow,
  snapshot: OverviewNowSnapshot,
  t: TranslateFn,
  brief: boolean,
  name: NameFormat,
): I18nText {
  if (row.kind === "incident")
    return t("overview.now.sentence.incident", { title: name(row.title) });
  if (row.kind === "anomaly") {
    return t("overview.now.sentence.anomaly", { name: name(row.name), count: row.anomalyCount });
  }
  if (row.kind === "alert") {
    if (brief && row.state === "recovered") return raw(row.name);
    return row.state === "recovered"
      ? raw(`${name(row.name)} · ${t("overview.now.recovered")}`)
      : t("overview.now.sentence.alert", { name: name(row.name) });
  }
  const sentence =
    row.signal === "latency"
      ? t("overview.now.sentence.service.latency", {
          service: name(row.service),
          ratio: formatRatio(row.p99Ratio),
        })
      : t("overview.now.sentence.service.errors", {
          service: name(row.service),
          value: brief ? formatPercent(row.errorRate) : serviceFigure(row, t),
        });
  if (brief) return sentence;
  return snapshot.services.allRegions
    ? raw(`${sentence} · ${t("overview.now.allRegions")}`)
    : sentence;
}
