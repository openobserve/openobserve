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

// Display helpers for the investigation thread of an RCA run.

import { gt, raw, type I18nText } from "@/types/i18n";
import { formatTimestampInTimezone } from "@/utils/date";
import { userLocalPart } from "@/utils/incidents/rcaCell";
import { rcaSteerStatusLabel } from "@/utils/incidents/rcaSteering";
import type {
  RcaStep,
  RcaSteerRecord,
  RcaThread,
  RcaThreadQuestion,
  RcaToolCall,
  RcaTrigger,
} from "@/services/incidents";

/** The seven stages of the RCA protocol, in order. `stage_index` is 1-based. */
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

/** "Auto on incident open", "Re-analyze by j.okafor", … */
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

/** Duration with seconds kept: "0.3s", "12s", "4m12s", "2m03s", "1h05m". */
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
export const formatRcaClock = (us: number | null): string =>
  us === null ? "" : formatTimestampInTimezone(us, "HH:mm:ss", "UTC");

export type RcaNoteSegment =
  | { kind: "text"; text: string; bold?: true; italic?: true; code?: true }
  | { kind: "cite"; id: string };

type RcaNoteMarks = { bold?: true; italic?: true };

// One alternation, first match wins: inline code, bold, citation, link, italics.
const NOTE_TOKEN =
  /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|\[(e\d+)\]|\[([^\]\n]+)\]\(([^)\s]+)\)|(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*])|(?<![\w_])_([^_\s][^_\n]*?)_(?![\w_])/g;

function pushText(segments: RcaNoteSegment[], text: string, marks: RcaNoteMarks) {
  if (text) segments.push({ kind: "text", text, ...marks });
}

function splitNoteInto(segments: RcaNoteSegment[], note: string, marks: RcaNoteMarks) {
  let last = 0;
  for (const match of note.matchAll(NOTE_TOKEN)) {
    const at = match.index ?? 0;
    pushText(segments, note.slice(last, at), marks);
    const [, code, bold, cite, linkText, linkUrl, star, underscore] = match;
    if (code !== undefined) {
      segments.push({ kind: "text", text: code, ...marks, code: true });
    } else if (bold !== undefined) {
      splitNoteInto(segments, bold, { ...marks, bold: true });
    } else if (cite !== undefined) {
      segments.push({ kind: "cite", id: cite });
    } else if (linkText !== undefined) {
      // A link the agent writes shows as text and its URL in plain text.
      pushText(segments, `${linkText} (${linkUrl})`, marks);
    } else {
      splitNoteInto(segments, star ?? underscore ?? "", { ...marks, italic: true });
    }
    last = at + match[0].length;
  }
  pushText(segments, note.slice(last), marks);
}

export function splitRcaNote(note: string): RcaNoteSegment[] {
  const segments: RcaNoteSegment[] = [];
  splitNoteInto(segments, note, {});
  return segments;
}

/** Sum of the tool durations of a step, in milliseconds. */
export const toolCallsDurationMs = (calls: RcaToolCall[]): number =>
  calls.reduce((total, call) => total + (call.duration_ms ?? 0), 0);

/** A step the end of the run cut off: one of its tool calls never finished. */
export const isInterruptedStep = (step: RcaStep): boolean =>
  step.tool_calls.some((call) => call.interrupted === true);

/** A finished, uninterrupted step; an ended run finishes only the steps a Resume keeps. */
export function isFinishedStep(thread: RcaThread, step: RcaStep, idx: number): boolean {
  if (step.ended_at === null || isInterruptedStep(step)) return false;
  if (thread.active) return true;
  if (thread.reusable_steps !== undefined) return idx < thread.reusable_steps;
  return thread.report_submitted || idx < thread.steps.length - 1;
}

/** Finished, uninterrupted steps; an ended run counts the steps a Resume keeps. */
export function finishedStepCount(thread: RcaThread): number {
  return thread.steps.filter((step, idx) => isFinishedStep(thread, step, idx)).length;
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

/** One entry of the thread column, in time order. Times are µs. */
export type RcaThreadEntry =
  | { kind: "step"; key: string; at: number; step: RcaStep }
  | { kind: "question"; key: string; at: number; question: RcaThreadQuestion }
  | { kind: "steer"; key: string; at: number; item: RcaSteerRecord };

/** Steps, "Needs input" questions and responder messages in time order. */
export function rcaThreadEntries(thread: RcaThread, items: RcaSteerRecord[]): RcaThreadEntry[] {
  const list = thread.steps.map((step): RcaThreadEntry => ({
    kind: "step",
    key: `step-${step.index}`,
    at: step.started_at ?? Number.MAX_SAFE_INTEGER,
    step,
  }));
  for (const question of thread.questions ?? []) {
    list.push({
      kind: "question",
      key: `question-${question.question_id}`,
      // A question with no recorded time goes last: it is the newest sentinel.
      at: question.at ?? Number.MAX_SAFE_INTEGER,
      question,
    });
  }
  for (const item of items) {
    list.push({ kind: "steer", key: `steer-${item.steer_id}`, at: item.created_at, item });
  }
  // Array sort is stable: equal times keep steps, questions, messages in that order.
  return list.sort((a, b) => a.at - b.at);
}

/** Copy the visible transcript in its displayed order, omitting absent values. */
export function rcaThreadPlainText(
  thread: RcaThread,
  title: string,
  steering: RcaSteerRecord[] = [],
): string {
  const lines: string[] = [title];
  if (thread.started) {
    lines.push(
      "",
      `${gt("alerts.incidents.rcaThread.analysisStarted")}${thread.started.at === null ? "" : ` · ${formatRcaClock(thread.started.at)} UTC`}`,
    );
    if (thread.started.prompt) lines.push(thread.started.prompt);
  }
  for (const entry of rcaThreadEntries(thread, steering)) {
    if (entry.kind === "question") {
      const { question } = entry;
      const time = question.at !== null ? ` · ${formatRcaClock(question.at)} UTC` : "";
      lines.push("", `${gt("alerts.incidents.rcaSteer.needsInput")}: ${question.question}${time}`);
      continue;
    }
    if (entry.kind === "steer") {
      const { item } = entry;
      lines.push(
        "",
        `${userLocalPart(item.author_email)} · ${formatRcaClock(item.created_at)} UTC · ${rcaSteerStatusLabel(item)}`,
        item.text,
      );
      if (item.agent_note) {
        lines.push(gt("alerts.incidents.rcaSteer.agentNote", { note: item.agent_note }));
      }
      continue;
    }
    const { step } = entry;
    lines.push(
      "",
      `${step.index}. ${step.title}${step.started_at === null ? "" : ` · ${formatRcaClock(step.started_at)} UTC`}`,
    );
    if (step.note) lines.push(step.note);
    for (const call of step.tool_calls) {
      const parts = [rcaToolStatusLabel(call) as string];
      if (call.result_summary) parts.push(call.result_summary);
      if (call.duration_ms !== null) parts.push(formatRcaDuration(call.duration_ms));
      lines.push(
        `  - ${call.tool}${call.key_arg === null ? "" : `: ${call.key_arg}`} [${parts.join(" · ")}]`,
      );
      if (call.error) lines.push(`    ${call.error}`);
    }
  }
  return lines.join("\n");
}
