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

import { getIntlLocale } from "@/locales";
import {
  autoresolveErrorApprovers,
  autoresolveErrorConnection,
  autoresolveErrorMessage,
  autoresolveErrorStatus,
  type AutoResolveApprover,
  type AutoResolveChangedMcp,
  type AutoResolveConnectionRef,
  type AutoResolveCorrectionKind,
  type AutoResolveMissingConnection,
  type AutoResolvePlanCorrectionKind,
  type AutoResolveRun,
  type AutoResolveRunState,
  type AutoResolveSavedTrigger,
  type AutoResolveStepState,
  type AutoResolveTrigger,
} from "@/services/autoresolve";
import type { RcaStep, RcaToolCall } from "@/services/incidents";
import store from "@/stores";
import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import { formatTimestampInTimezone } from "@/utils/date";
import { unfoldDuration } from "@/utils/incidents/incidentUnfold";
import type { StepperStage } from "@/utils/incidents/rcaThread";
import { shortList } from "@/utils/shortList";
import { resolveBrowserTimezone } from "@/utils/timezone";

export const AUTORESOLVE_STAGES: readonly StepperStage[] = [
  { key: "investigate", labelKey: "autoresolve.stage.investigate" },
  { key: "ask", labelKey: "autoresolve.stage.ask" },
  { key: "proceed", labelKey: "autoresolve.stage.proceed" },
  { key: "check", labelKey: "autoresolve.stage.check" },
  { key: "outcome", labelKey: "autoresolve.stage.outcome" },
];

export type OutcomeTone = "positive" | "negative" | "warning" | "neutral";

export const OUTCOME_TONE_CLASS: Record<OutcomeTone, string> = {
  positive: "bg-status-success-bg border-status-positive/40",
  negative: "bg-status-error-bg border-status-negative/40",
  warning: "bg-status-warning-bg border-status-warning-text/40",
  neutral: "bg-surface-subtle border-border-default",
};
export const OUTCOME_TITLE_CLASS: Record<OutcomeTone, string> = {
  positive: "text-status-success-text",
  negative: "text-status-error-text",
  warning: "text-status-warning-text",
  neutral: "text-text-heading",
};

/** The longest correction note the server keeps. */
export const CORRECTION_NOTE_MAX = 500;

/** How many names a fact line lists before "and N more". */
export const NAMES_SHOWN = 3;

export const WRITING_ROWS_REST = 8;
export const WRITING_ROWS_MAX = 20;

/** How long a live turn may send nothing before the page says the AI model has gone quiet. */
export const SILENT_AFTER_US = 60_000_000;

const NEEDS_CAPABILITY = /^\s*needs\s+([^:\n]+?)\s*:\s*(\S[\s\S]*?)\s*$/i;

const VERDICT_STATES: ReadonlySet<AutoResolveRunState> = new Set([
  "worked",
  "outcome_unknown",
  "worse",
]);

/** A step of the current plan in one of these ran, so the run can no longer take a connection. */
const RAN_STEP_STATES: ReadonlySet<AutoResolveStepState> = new Set([
  "approved",
  "running",
  "done",
  "failed",
  "outcome_unknown",
]);

/** One name per correction kind, for the kind tag and for the evidence line. */
export const CORRECTION_KIND_KEY: Record<AutoResolveCorrectionKind, I18nKey> = {
  wrong_cause: "autoresolve.correction.kind.wrongCause",
  wrong_fix: "autoresolve.correction.kind.wrongFix",
  out_of_scope: "autoresolve.correction.kind.outOfScope",
  not_fixed: "autoresolve.correction.kind.notFixed",
};

const CORRECTION_HELP_KEY: Record<AutoResolvePlanCorrectionKind, I18nKey> = {
  wrong_cause: "autoresolve.correction.help.wrongCause",
  wrong_fix: "autoresolve.correction.help.wrongFix",
  out_of_scope: "autoresolve.correction.help.outOfScope",
};

const CORRECTION_DRAFT_KEY: Record<AutoResolvePlanCorrectionKind, I18nKey> = {
  wrong_cause: "autoresolve.correction.draft.wrongCause",
  wrong_fix: "autoresolve.correction.draft.wrongFix",
  out_of_scope: "autoresolve.correction.draft.outOfScope",
};

/** Lines a step result shows before its full view: prose, then pretty-printed JSON. */
export const RESULT_TEXT_LINES = 6;
export const RESULT_JSON_LINES = 20;
const CHARS_PER_LINE = 100;
const EVIDENCE_LINE_CHARS = 120;

/** A step result as the page reads it: prose, or JSON pretty-printed, plus one short line. */
export interface StepResultView {
  kind: "text" | "json";
  text: string;
  /** One line for the evidence list, cut with "…". */
  line: string;
  /** The capped JSON view hides part of `text`; a text result measures its own cut on screen. */
  long: boolean;
}

/** A change the guard held while planning, with the connection the plan gives that tool. */
export interface HeldCall {
  tool: string;
  connection: string | null;
}

/** The first planning turn of a run, and the changes held in the current one. */
export interface InvestigationSummary {
  /** The turn's steps with only its own calls; later calls belong to proceeding or a new plan. */
  steps: RcaStep[];
  calls: number;
  durationUs: number;
  held: HeldCall[];
}

/** The live turn's line: what runs and for how long, or that the AI model has gone quiet. */
export interface TurnLine {
  silent: boolean;
  text: I18nText;
  /** False while a live thread step shows its own spinner above the line. */
  spinner: boolean;
}

/** A moment as a deadline reads it; `today` picks the sentence that says "at". */
export interface AutoResolveWhen {
  text: string;
  today: boolean;
}

type InvestigatedRun = Pick<AutoResolveRun, "thread" | "created_at_us" | "planned_at_us" | "plan">;
type TurnRun = Pick<
  AutoResolveRun,
  "state" | "turn" | "steps" | "thread" | "approved_at_us" | "created_at_us"
>;

// Declined and lapsed runs also land on Outcome; the state badge says how the run ended.
const STAGE_INDEX: Record<AutoResolveRunState, number> = {
  investigating: 0,
  waiting_approval: 1,
  proceeding: 2,
  checking: 3,
  worked: 4,
  no_change: 4,
  worse: 4,
  declined: 4,
  lapsed: 4,
  step_failed: 4,
  outcome_unknown: 4,
  failed: 4,
};

/** 0-based index into `AUTORESOLVE_STAGES` for a run state. */
export const stageIndexFor = (state: AutoResolveRunState): number => STAGE_INDEX[state];

/** The one list sentence for approvers and connections: "Ana, Ben, Cy, and 7 more". */
export function namesSentence(
  names: readonly string[],
  t: TranslateFn,
  max = 3,
  locale = getIntlLocale(),
): I18nText {
  return raw(
    shortList(names, max, locale, (count) => t("autoresolve.namesMore", { count }, count)),
  );
}

/** "1 MCP", "20 MCPs". */
export const mcpCount = (count: number, t: TranslateFn): I18nText =>
  t("autoresolve.mcp.count", { count }, count);

/** MCPs inside a sentence: "the postgres MCP", "the a, b, c, and 2 more MCPs"; "" for none. */
export function theMcps(
  names: readonly string[],
  t: TranslateFn,
  max = NAMES_SHOWN,
  locale = getIntlLocale(),
): I18nText {
  const given = names.filter((name) => name.trim());
  if (!given.length) return raw("");
  const list = shortList(given, max, locale, (count) =>
    t("autoresolve.namesMore", { count }, count),
  );
  return t("autoresolve.mcp.the", { names: raw(list) }, given.length);
}

/** "Approving changes the postgres MCP (shop primary)."; "" for an option that changes none. */
export function approvingChangesText(
  mcps: readonly AutoResolveChangedMcp[],
  t: TranslateFn,
  locale = getIntlLocale(),
): I18nText {
  if (!mcps.length) return raw("");
  const described = (m: AutoResolveChangedMcp) =>
    m.short_description
      ? t("autoresolve.mcp.described", {
          name: raw(m.name),
          description: raw(m.short_description),
        })
      : m.name;
  const [only] = mcps;
  const named =
    mcps.length === 1 && only.short_description
      ? t("autoresolve.mcp.theDescribed", {
          name: raw(only.name),
          description: raw(only.short_description),
        })
      : theMcps(mcps.map(described), t, NAMES_SHOWN, locale);
  return t("autoresolve.approval.changes", { mcps: named });
}

/** `theMcps` opening a sentence: "The postgres MCP". */
export function theMcpsStart(
  names: readonly string[],
  t: TranslateFn,
  locale = getIntlLocale(),
): I18nText {
  return raw(sentenceStart(theMcps(names, t, NAMES_SHOWN, locale), locale));
}

/** Connection names for a list cell, removed ones first and marked as the removed chip reads. */
export function connectionsSentence(
  connections: readonly AutoResolveConnectionRef[],
  t: TranslateFn,
  max = 3,
): I18nText {
  // First, so a cut cell or a folded "and N more" never hides the problem.
  const removed = connections.filter((c) => c.removed);
  const names = [
    ...removed.map((c) => t("autoresolve.connection.removedChip", { name: raw(c.name) })),
    ...connections.filter((c) => !c.removed).map((c) => c.name),
  ];
  return namesSentence(names, t, max);
}

/** "and 6 more" under a list cut at a few rows. */
export const andMoreText = (count: number, t: TranslateFn): I18nText =>
  t("autoresolve.andMore", { count }, count);

/** The help line under the kind chips; a neutral prompt until a kind is picked. */
export const correctionHelp = (
  kind: AutoResolvePlanCorrectionKind | null,
  t: TranslateFn,
): I18nText => (kind ? t(CORRECTION_HELP_KEY[kind]) : t("autoresolve.correction.help.none"));

/** The editable draft a picked kind puts in the note, naming the option the person looked at. */
export const correctionDraft = (
  kind: AutoResolvePlanCorrectionKind,
  optionTitle: string | null | undefined,
  t: TranslateFn,
): I18nText =>
  optionTitle?.trim()
    ? t(CORRECTION_DRAFT_KEY[kind], { option: raw(optionTitle.trim()) })
    : raw("");

/** "What still isn't right?" starts from the alert that started the run; a person's run starts empty. */
export function stillFiringNote(
  run: Pick<AutoResolveRun, "trigger" | "requester">,
  t: TranslateFn,
): {
  note: string;
  source: I18nText | null;
} {
  if (run.trigger.kind !== "alert" || !run.trigger.by.trim()) return { note: "", source: null };
  const note = t("autoresolve.verdict.stillFiring", {
    trigger: startedByText(run.trigger, run.requester),
  });
  return {
    note,
    source: t("autoresolve.verdict.filledFrom", { trigger: raw(run.trigger.by.trim()) }),
  };
}

/** Why the viewer cannot add a missing connection: the server's sentence, or who may. */
export const cannotAddConnectionText = (
  missing: Pick<AutoResolveMissingConnection, "name" | "cannot_add_reason">,
  t: TranslateFn,
): I18nText =>
  raw(missing.cannot_add_reason?.trim()) ||
  t("autoresolve.missing.cannotAdd", { mcp: theMcps([missing.name], t) });

/** A plan's `needs <name>: <action>` in plain words; null for any other text. */
export function needsText(text: string | null | undefined, t: TranslateFn): I18nText | null {
  const match = text ? NEEDS_CAPABILITY.exec(text) : null;
  return match
    ? t("autoresolve.missing.needs", { mcp: theMcps([match[1]], t), action: raw(match[2]) })
    : null;
}

/** Emails compare as the server does: trimmed, ignoring case. */
export function isRunRequester(
  run: Pick<AutoResolveRun, "requester">,
  email?: string | null,
): boolean {
  const requester = run.requester?.trim().toLowerCase();
  return !!requester && requester === email?.trim().toLowerCase();
}

/** "Did this fix it?" asks a decider once per revision of an ended run that made a change;
 *  the current revision's Fixed keeps the row to show who said so. */
export function asksVerdict(run: AutoResolveRun, email?: string | null): boolean {
  if (!VERDICT_STATES.has(run.state)) return false;
  const pv = run.person_verdict;
  if (pv && pv.revision === run.revision) return pv.verdict === "fixed";
  return run.can_approve || isRunRequester(run, email);
}

/** A missing connection the run can take: while it waits in time, or once a no-option plan ended it. */
export function addableConnection(
  run: AutoResolveRun,
  nowUs = Date.now() * 1000,
): AutoResolveMissingConnection | null {
  const missing = run.plan?.missing_connection;
  if (!missing) return null;
  if (run.state === "waiting_approval") {
    return !run.approval_deadline_us || nowUs <= run.approval_deadline_us ? missing : null;
  }
  const steps = [...run.steps, ...(run.plan?.options ?? []).flatMap((o) => o.steps)];
  const ran = steps.some((s) => RAN_STEP_STATES.has(s.state));
  return run.state === "no_change" && !ran ? missing : null;
}

/** The state a run's chips show: a run that ended because no MCP can make the fix reads as its own end. */
export function shownRunState(
  run: Pick<AutoResolveRun, "state" | "steps" | "plan">,
): AutoResolveRunState | "cant_fix" {
  const missing = run.plan?.missing_capability || run.plan?.missing_connection;
  return run.state === "no_change" && !run.steps.length && missing ? "cant_fix" : run.state;
}

/** What a run can use: its MCPs, folded past `max`, then always OpenObserve data last. */
export function canUseSentence(
  connectionNames: readonly string[],
  t: TranslateFn,
  locale = getIntlLocale(),
  max = NAMES_SHOWN,
): I18nText {
  const data = t("autoresolve.goalBox.productData", { product: raw("OpenObserve") });
  const count = connectionNames.filter((name) => name.trim()).length;
  if (!count) return data;
  return t(
    "autoresolve.goalBox.canUse",
    { mcps: theMcps(connectionNames, t, max, locale), data },
    count,
  );
}

/** Who may approve, by kind: "Roles sre and dba; group oncall; Org admins". */
export function approversSentence(
  approvers: readonly AutoResolveApprover[],
  t: TranslateFn,
  max = 3,
  locale = getIntlLocale(),
): I18nText {
  const named = (kind: AutoResolveApprover["kind"]) => [
    ...new Set(approvers.filter((a) => a.kind === kind).map((a) => a.name)),
  ];
  const roles = named("role");
  const groups = named("group");
  const parts: string[] = [];
  if (roles.length) {
    const names = namesSentence(roles, t, max, locale);
    parts.push(t("autoresolve.approvers.roles", { names }, roles.length));
  }
  if (groups.length) {
    const names = namesSentence(groups, t, max, locale);
    parts.push(t("autoresolve.approvers.groups", { names }, groups.length));
  }
  if (approvers.some((a) => a.kind === "org_admins")) parts.push(t("autoresolve.orgAdmins"));
  return raw(sentenceStart(parts.join(t("autoresolve.approvers.separator")), locale));
}

/** The refusal a saved AutoResolve's trigger switch shows for each MCP this person cannot approve through. */
export function cannotApproveTexts(
  connections: readonly AutoResolveConnectionRef[],
  canApprove: ReadonlyMap<string, boolean>,
  approvers: readonly AutoResolveApprover[],
  t: TranslateFn,
): I18nText[] {
  const names = approvers.length ? approversSentence(approvers, t) : t("autoresolve.orgAdmins");
  // An MCP missing from the summary is one this person cannot read, so cannot approve through.
  return connections
    .filter((c) => canApprove.get(c.id) !== true)
    .map((c) => cannotApproveText(c.name, names, t));
}

/** Why saving an AutoResolve or switching its trigger was refused, as one sentence. */
export function savedRefusal(error: unknown, t: TranslateFn): I18nText {
  const connection = autoresolveErrorConnection(error);
  const approvers = autoresolveErrorApprovers(error);
  if (autoresolveErrorStatus(error) === 403 && connection && approvers.length) {
    return cannotApproveText(connection.name, approversSentence(approvers, t), t);
  }
  const message = autoresolveErrorMessage(error);
  return message ? raw(message) : t("autoresolve.saved.saveFailed");
}

/** The state a saved AutoResolve's trigger shows; null for one only a person starts. */
export const triggerState = (trigger: AutoResolveSavedTrigger): "on" | "off" | "paused" | null => {
  if (trigger.kind === "person") return null;
  if (trigger.enabled) return "on";
  return trigger.paused_for_reapproval ? "paused" : "off";
};

/** The connections a run was started with, once each; a run without that list falls back to its steps'. */
export function runConnections(
  run: AutoResolveRun,
  removedIds: ReadonlySet<string> = new Set(),
): { id: string; name: string; removed: boolean }[] {
  const chosen = run.connections ?? [];
  const steps = [...(run.plan?.options.flatMap((o) => o.steps) ?? []), ...run.steps];
  const refs = chosen.length ? chosen : steps.map((s) => s.connection);
  const byId = new Map<string, { id: string; name: string; removed: boolean }>();
  for (const c of refs) {
    const removed = c.removed === true || removedIds.has(c.id) || !!byId.get(c.id)?.removed;
    byId.set(c.id, { id: c.id, name: c.name, removed });
  }
  return [...byId.values()];
}

/** Removed connections as chips: the first `max`, the rest as one "and N more removed"; a lone leftover is shown. */
export function removedChips(
  names: readonly string[],
  t: TranslateFn,
  max = 2,
): { shown: string[]; more: I18nText | null } {
  if (names.length <= max + 1) return { shown: [...names], more: null };
  const count = names.length - max;
  return {
    shown: names.slice(0, max),
    more: t("autoresolve.connection.moreRemoved", { count }, count),
  };
}

/** Why Start cannot take more or fewer connections; null while the choice is within 1..cap. */
export function connectionLimitText(chosen: number, cap: number, t: TranslateFn): I18nText | null {
  if (chosen === 0) return t("autoresolve.connectionPicker.chooseOne");
  return chosen >= cap ? t("autoresolve.connectionPicker.upTo", { mcps: mcpCount(cap, t) }) : null;
}

/** A picker with no MCPs: the org has none yet, or none this person may use. */
export const noMcpsText = (t: TranslateFn, mayAdd: boolean): I18nText =>
  mayAdd
    ? t("autoresolve.connectionPicker.noneYet")
    : t("autoresolve.connectionPicker.noneYouCanUse");

/** Who started a run, for a slot labelled "Started by": the person, or "The alert X". */
export function startedByText(trigger: AutoResolveTrigger, requester: string): I18nText {
  if (trigger.kind === "person") return raw(requester);
  return raw(sentenceStart(trigger.by.trim()));
}

/** Text that opens a sentence, with its first letter in upper case. */
export const sentenceStart = (text: string, locale = getIntlLocale()): string =>
  text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);

/** A run time in the app's time zone, to the minute by default. */
export const autoresolveTime = (us: number, format = "HH:mm"): string =>
  formatTimestampInTimezone(us, format, store.state.timezone || "UTC");

/** A deadline in the app's time zone: "10:48" today, "Dec 1, 10:48" on any other day. */
export function autoresolveWhen(
  us: number,
  nowUs = Date.now() * 1000,
  locale = getIntlLocale(),
  timezone: string = store.state.timezone || "UTC",
): AutoResolveWhen {
  const timeZone = resolveBrowserTimezone(timezone);
  const day = (at: number) => formatTimestampInTimezone(at, "YYYY-MM-DD", timeZone);
  const today = day(us) === day(nowUs);
  const text = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(today ? {} : { month: "short", day: "numeric" }),
  }).format(us / 1000);
  return { text, today };
}

/** A sentence about a deadline: its "at" wording today, its dated wording on any other day. */
export function deadlineText(
  us: number,
  [today, otherDay]: readonly [I18nKey, I18nKey],
  t: TranslateFn,
  params: Record<string, unknown> = {},
  nowUs = Date.now() * 1000,
): I18nText {
  const when = autoresolveWhen(us, nowUs);
  return t(when.today ? today : otherDay, { ...params, time: raw(when.text) });
}

/** How long a run or one of its parts took: "40 s", "1 min 20 s", "2 min", "1 h 5 min". */
export function autoresolveDuration(us: number, t: TranslateFn): I18nText {
  const seconds = Math.max(0, Math.floor(us / 1_000_000));
  const minutes = Math.floor(seconds / 60);
  if (seconds < 60 || seconds % 60 === 0 || minutes >= 60) {
    return unfoldDuration(t, minutes >= 60 ? minutes * 60_000_000 : seconds * 1_000_000);
  }
  return t("autoresolve.duration.minutesSeconds", { minutes, seconds: seconds % 60 });
}

/** The live turn's line; a running step or tool call is not a silent model. */
export function turnLine(run: TurnRun, nowUs: number, t: TranslateFn): TurnLine {
  const turn = run.turn;
  const spinner = !(
    run.state === "investigating" &&
    run.thread.active &&
    run.thread.steps.some((s) => s.ended_at === null)
  );
  const quietUs = turn ? nowUs - turn.last_output_us : 0;
  if (turn && !toolWorking(run, turn.started_at_us) && quietUs > SILENT_AFTER_US) {
    const quiet = autoresolveDuration(Math.floor(quietUs / 60_000_000) * 60_000_000, t);
    const keys = ["autoresolve.run.silent", "autoresolve.run.silentOn"] as const;
    const text = deadlineText(turn.deadline_us, keys, t, { quiet }, nowUs);
    return { silent: true, text, spinner };
  }
  return { silent: false, text: turnStatusText(run, nowUs, t), spinner };
}

/** How a stored step result reads; null when there is none. */
export function stepResultView(summary: string | null | undefined): StepResultView | null {
  const stored = summary?.trim() ?? "";
  if (!stored) return null;
  const parsed = parseJsonContainer(stored);
  const kind = parsed === undefined ? "text" : "json";
  const text = parsed === undefined ? stored : JSON.stringify(parsed, null, 2);
  const lines = text.split("\n");
  const cap = kind === "text" ? RESULT_TEXT_LINES : RESULT_JSON_LINES;
  const first = parsed === undefined ? lines[0] : JSON.stringify(parsed);
  const more = parsed === undefined && lines.length > 1;
  return {
    kind,
    text,
    line: cutLine(first, more),
    long: kind === "json" && (lines.length > cap || text.length > cap * CHARS_PER_LINE),
  };
}

/** Planning ends at the plan's acceptance or the next turn's prompt (proceeding or a new plan). */
export function investigationSummary(run: InvestigatedRun): InvestigationSummary {
  const startUs = run.created_at_us;
  const plannedAt = run.planned_at_us ?? null;
  const prompts = run.thread.user_messages
    .filter((m) => !m.steer_id && m.at !== null)
    .map((m) => m.at as number);
  const firstPrompt = prompts[0] ?? Number.POSITIVE_INFINITY;
  const endsAtPlan = plannedAt !== null && plannedAt <= firstPrompt;
  const endUs = endsAtPlan ? plannedAt : firstPrompt;
  const before = (c: { started_at: number | null }) =>
    c.started_at === null || c.started_at < endUs;
  const steps = run.thread.steps
    .filter(before)
    .map((s) => ({ ...s, tool_calls: s.tool_calls.filter(before) }));
  const calls = steps.flatMap((s) => s.tool_calls);
  const ends = calls.map((c) => (c.started_at ?? startUs) + (c.duration_ms ?? 0) * 1000);
  return {
    steps,
    calls: calls.length,
    durationUs: (endsAtPlan ? plannedAt : Math.max(startUs, ...ends)) - startUs,
    held: heldInCurrentPlan(run, prompts, firstPrompt),
  };
}

// A replan's turn starts at its own prompt; without `planned_at_us` only the first turn is known.
function heldInCurrentPlan(
  run: InvestigatedRun,
  prompts: number[],
  firstPrompt: number,
): HeldCall[] {
  const plannedAt = run.planned_at_us ?? null;
  const from =
    plannedAt === null ? -Infinity : Math.max(-Infinity, ...prompts.filter((at) => at < plannedAt));
  const to = plannedAt ?? firstPrompt;
  const planSteps = run.plan?.options.flatMap((o) => o.steps) ?? [];
  const held = new Map<string, HeldCall>();
  for (const call of run.thread.steps.flatMap((s) => s.tool_calls)) {
    const at = call.started_at ?? from;
    if (at < from || at >= to || !isHeldCall(call)) continue;
    // The server's connection name wins; the plan's tool match only fills it when the call has none.
    const connection = call.connection ?? null;
    const step = planSteps.find(
      (s) =>
        (connection === null || s.connection.name === connection) &&
        (call.tool === s.tool || call.tool.endsWith(`_${s.tool}`)),
    );
    const entry = {
      tool: step?.tool ?? call.tool,
      connection: connection ?? step?.connection.name ?? null,
    };
    held.set(JSON.stringify([entry.connection, entry.tool]), entry);
  }
  return [...held.values()];
}

const isHeldCall = (call: RcaToolCall): boolean => call.held === true;

// A live thread shows an earlier turn's unanswered call as running too, so only this turn's count.
function toolWorking(run: TurnRun, turnStartUs: number): boolean {
  if (run.steps.some((s) => s.state === "running")) return true;
  if (!run.thread.active) return false;
  return run.thread.steps.some((s) =>
    s.tool_calls.some(
      (c) => c.status === "running" && c.started_at !== null && c.started_at >= turnStartUs,
    ),
  );
}

function turnStatusText(run: TurnRun, nowUs: number, t: TranslateFn): I18nText {
  const turn = run.turn;
  const since = turn?.started_at_us ?? checkStartedAt(run);
  if (since === null) return t("autoresolve.run.working");
  const elapsed = autoresolveDuration(nowUs - since, t);
  if (run.state === "investigating") return t("autoresolve.run.investigatingFor", { elapsed });
  if (run.state === "proceeding") return t("autoresolve.run.proceedingFor", { elapsed });
  return turn?.check_retry
    ? t("autoresolve.run.checkingAgain", { elapsed })
    : t("autoresolve.run.checking", { elapsed });
}

// Without the turn's own start, the check counts from the last step that finished.
function checkStartedAt(run: TurnRun): number | null {
  if (run.state !== "checking") return null;
  const finished = run.steps.map((s) => s.finished_at_us ?? 0);
  return Math.max(run.approved_at_us ?? run.created_at_us, ...finished);
}

function parseJsonContainer(text: string): object | undefined {
  if (!text.startsWith("{") && !text.startsWith("[")) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" ? value : undefined;
  } catch {
    return undefined;
  }
}

function cutLine(line: string, more: boolean): string {
  const chars = [...line.trim()];
  const cut = chars.length > EVIDENCE_LINE_CHARS;
  if (!cut && !more) return chars.join("");
  const kept = chars.slice(0, cut ? EVIDENCE_LINE_CHARS - 1 : chars.length).join("");
  return `${kept.trimEnd().replace(/[.,;:]+$/, "")}…`;
}

function cannotApproveText(mcp: string, approvers: I18nText, t: TranslateFn): I18nText {
  return t("autoresolve.approval.cannotApprove", { mcps: theMcps([mcp], t), approvers });
}
