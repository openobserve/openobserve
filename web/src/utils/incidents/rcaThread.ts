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

// Display helpers for the investigation thread of an RCA run (02 TH37, TH38).

import { gt, raw, type I18nText } from "@/types/i18n";
import { formatTimestampInTimezone } from "@/utils/date";
import { userLocalPart } from "@/utils/incidents/rcaCell";
import type { RcaStep, RcaThread, RcaToolCall, RcaTrigger } from "@/services/incidents";

/** The seven stages of the RCA protocol, in order (02 TH18). `stage_index` is 1-based. */
export const RCA_STAGES = [
  "context",
  "topology",
  "changes",
  "traces",
  "log_patterns",
  "metrics",
  "converge",
] as const;

/** What the verdict card shows: the latest run, or a completed run picked from the history. */
export type RcaCardState = "investigating" | "analyzed" | "failed" | "cancelled";

export type RcaStageId = (typeof RCA_STAGES)[number];

/** "Auto on incident open", "Re-analyze by j.okafor", … (01 §12.3). */
export function rcaTriggerLabel(trigger: RcaTrigger, startedBy: string): I18nText {
  const user = userLocalPart(startedBy);
  switch (trigger) {
    case "auto_new_incident":
      return gt("alerts.incidents.rcaRun.trigger.autoNewIncident");
    case "auto_new_alert_type":
      return gt("alerts.incidents.rcaRun.trigger.autoNewAlertType");
    case "auto_reopen":
      return gt("alerts.incidents.rcaRun.trigger.autoReopen");
    case "manual":
      return gt("alerts.incidents.rcaRun.trigger.manual", { user });
    case "reanalyze":
      return gt("alerts.incidents.rcaRun.trigger.reanalyze", { user });
    case "oncall_page":
      return gt("alerts.incidents.rcaRun.trigger.oncallPage");
    case "resume":
      return gt("alerts.incidents.rcaRun.trigger.resume", { user });
    case "legacy":
      return gt("alerts.incidents.rcaRun.trigger.legacy");
  }
}

/** Label of a stage by its id; an unknown id shows as written. */
export function rcaStageLabel(stage: string): I18nText {
  switch (stage) {
    case "context":
      return gt("alerts.incidents.rcaThread.stage.context");
    case "topology":
      return gt("alerts.incidents.rcaThread.stage.topology");
    case "changes":
      return gt("alerts.incidents.rcaThread.stage.changes");
    case "traces":
      return gt("alerts.incidents.rcaThread.stage.traces");
    case "log_patterns":
      return gt("alerts.incidents.rcaThread.stage.logPatterns");
    case "metrics":
      return gt("alerts.incidents.rcaThread.stage.metrics");
    case "converge":
      return gt("alerts.incidents.rcaThread.stage.converge");
    default:
      return raw(stage);
  }
}

/**
 * Duration with seconds kept: "0.3s", "12s", "4m12s", "2m03s", "1h05m".
 * The run stats and tool rows use it (02 TH37: "4m12s").
 */
export function formatRcaDuration(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 10_000) return `${(safe / 1000).toFixed(1)}s`;
  const totalSeconds = Math.floor(safe / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m${String(totalSeconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
}

/** Running time in whole seconds: "7s", "1m47s" (the analysis bar's "started … ago"). */
export const formatRcaElapsed = (ms: number): string =>
  ms < 10_000 ? `${Math.max(0, Math.floor(ms / 1000))}s` : formatRcaDuration(ms);

/** "14:07:04" in UTC from microseconds; the thread and its banners use UTC. */
export const formatRcaClock = (us: number): string =>
  formatTimestampInTimezone(us, "HH:mm:ss", "UTC");

export type RcaNoteSegment = { kind: "text"; text: string } | { kind: "cite"; id: string };

const CITATION = /\[(e\d+)\]/g;

/** Splits a step note into text and `[eN]` citation chips (02 TH29). */
export function splitRcaNote(note: string): RcaNoteSegment[] {
  const segments: RcaNoteSegment[] = [];
  let last = 0;
  for (const match of note.matchAll(CITATION)) {
    const at = match.index ?? 0;
    if (at > last) segments.push({ kind: "text", text: note.slice(last, at) });
    segments.push({ kind: "cite", id: match[1] });
    last = at + match[0].length;
  }
  if (last < note.length) segments.push({ kind: "text", text: note.slice(last) });
  return segments;
}

/** Sum of the tool durations of a step, in milliseconds. */
export const toolCallsDurationMs = (calls: RcaToolCall[]): number =>
  calls.reduce((total, call) => total + (call.duration_ms ?? 0), 0);

/** The error the thread projection gives a tool call the run's end cut off (`rca_thread.rs`). */
export const RCA_UNFINISHED_TOOL_ERROR = "The run ended before this tool call finished";

/** A step the end of the run cut off: one of its tool calls never finished. */
export const isInterruptedStep = (step: RcaStep): boolean =>
  step.tool_calls.some((call) => call.error === RCA_UNFINISHED_TOOL_ERROR);

/**
 * Steps that really finished (02 TH40 E). The projection closes the last step of
 * an ended run, so that step only counts when the run submitted its report.
 */
export function finishedStepCount(thread: RcaThread): number {
  const last = thread.steps.length - 1;
  return thread.steps.filter(
    (step, idx) =>
      step.ended_at !== null &&
      !isInterruptedStep(step) &&
      !(idx === last && !thread.active && !thread.report_submitted),
  ).length;
}

/** Status text of a tool row: "OK", "Error" or "Running". */
export function rcaToolStatusLabel(call: RcaToolCall): I18nText {
  switch (call.status) {
    case "ok":
      return gt("alerts.incidents.rcaThread.toolOk");
    case "error":
      return gt("alerts.incidents.rcaThread.toolError");
    case "running":
      return gt("alerts.incidents.rcaThread.toolRunning");
  }
}

/**
 * Plain-text transcript for "Copy thread" (02 TH38): the start, then each step
 * title, its note, and its tool names with their key arguments.
 */
export function rcaThreadPlainText(thread: RcaThread, title: string): string {
  const lines: string[] = [title];
  if (thread.started) {
    lines.push(
      "",
      `${gt("alerts.incidents.rcaThread.analysisStarted")} · ${formatRcaClock(thread.started.at)} UTC`,
    );
    if (thread.started.prompt) lines.push(thread.started.prompt);
  }
  for (const step of thread.steps) {
    lines.push("", `${step.index}. ${step.title} · ${formatRcaClock(step.started_at)} UTC`);
    if (step.note) lines.push(step.note);
    for (const call of step.tool_calls) {
      const parts = [rcaToolStatusLabel(call) as string];
      if (call.result_summary) parts.push(call.result_summary);
      if (call.duration_ms !== null) parts.push(formatRcaDuration(call.duration_ms));
      lines.push(`  - ${call.tool}: ${call.key_arg} [${parts.join(" · ")}]`);
      if (call.error) lines.push(`    ${call.error}`);
    }
  }
  return lines.join("\n");
}
