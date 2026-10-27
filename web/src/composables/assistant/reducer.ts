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

import type { ChatMessage, ContentBlock, NavigationAction, ToolCall } from "@/ts/interfaces/chat";
import { UNAUTHORIZED_MESSAGE_KEY, isAuthError } from "@/utils/authErrors";
import { getDashboardEventType, type AiDashboardEvent } from "@/composables/useAiDashboardEvents";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";

import { toAssistantError } from "./assistantErrors";
import {
  boundedArgs,
  boundedFindings,
  boundedQuery,
  boundedResult,
  footerUsage,
  type FindingsData,
  type FooterData,
  type LinkBlockData,
  type QueryBlockData,
  type StepResult,
} from "./evidence";
import { contextUsedKeys } from "./frames";
import type { ApprovalKind, ApprovalTarget } from "./assistantStore.types";
import type { ConfirmationRequiredFrame, ConfirmationResolvedFrame, UsageFrame } from "./frames";

const STEP_STATES: ReadonlySet<string> = new Set(["running", "done", "failed", "interrupted"]);

// An answer is untrusted: its steps and evidence blocks are capped so one stream cannot fill the tab.
const MAX_STEPS = 200;

const MAX_EVIDENCE = 50;

const MAX_ID_CHARS = 64;

const MAX_TOOL_CHARS = 100;

const EVIDENCE_TYPES: ReadonlySet<string> = new Set(["query", "link", "findings"]);

const APPROVAL_KINDS: ReadonlySet<string> = new Set<ApprovalKind>([
  "delete",
  "update",
  "create",
  "run_command",
  "permission",
]);

// Model and tool output on a card is untrusted: every list and string is capped.
const MAX_TARGETS = 200;

const MAX_TOTAL = 100_000;

const MAX_IMPACT = 20;

const MAX_LINE_CHARS = 300;

const MAX_QUESTION_CHARS = 2_000;

const MAX_JSON_KEYS = 40;

const MAX_JSON_DEPTH = 3;

const DELETE_TOOL = /delete/i;

const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

// Until the server enforces a review step, a change made by one of these tools with no card before it is surfaced.
const MUTATING_TOOL_PATTERNS = /^o2_(Create|Update|Delete|Set|Enable|Disable)/;

// The typed phases record a step's state and its evidence on the blocks; the legacy chat keeps reading `success`.
declare module "@/ts/interfaces/chat" {
  interface ContentBlock {
    stepState?: StepState;
    callArgs?: Record<string, unknown>;
    result?: StepResult;
    query?: QueryBlockData;
    link?: LinkBlockData;
    findings?: FindingsData | null;
    footer?: FooterData;
    approval?: ApprovalBlockData;
    resolved?: ResolvedBlockData;
    policy?: PolicyBlockData;
    consentNote?: ConsentNoteData;
  }
}

/** The card a `confirmation_required` asked for, as the transcript keeps it; the runtime adds the session ids and the expiry. */
export interface ApprovalBlockData {
  id: string;
  kind: ApprovalKind;
  destructive: boolean;
  operation: string;
  tool: string;
  targets: ApprovalTarget[];
  /** How many items the server acts on, when more than `targets` lists. */
  total?: number;
  before?: unknown;
  after?: unknown;
  impact?: string[];
  grantable: boolean;
  editable: boolean;
  question: string;
  /** The tool's arguments as sent, for Details only. */
  args?: Record<string, unknown>;
  /** The command a CLI card runs, shown on its face; a longer one ends in "…". */
  command?: string;
  /** The server sent a typed payload, so `/confirm` takes `items` and `scope`. */
  typed: boolean;
  /** The server's own expiry, epoch ms. */
  expiresAt?: number;
  /** Replayed with no decision in the record, so it renders as a record and never as a live card. */
  noDecision?: boolean;
  /** Replayed without a resolution frame; the server's approval row says how it was answered. */
  recorded?: { status: "approved" | "denied" | "expired" | "withdrawn"; at?: number };
}

/** `confirmation_resolved`: another tab or device answered the card. */
export interface ResolvedBlockData {
  id: string;
  approved: boolean;
  by?: string;
  at?: number;
  /** Nobody answered in time; `approved` is false. */
  expired?: boolean;
  /** The server dropped the card because the chat moved on; `approved` is false. */
  withdrawn?: boolean;
}

/** A quiet notice in the turn: a policy denial or a change made without a review step. */
export interface PolicyBlockData {
  kind: "denied" | "unreviewed";
  tool?: string;
  detail?: string;
  policy?: string;
  /** The changed object's type and how many changed, for the unreviewed notice. */
  resourceType?: string;
  count?: number;
  resourceId?: string;
  /** How many tool results and `resource_changed` frames reported a change of this type. */
  tools?: number;
  frames?: number;
}

/** The line a granted consent leaves in the answer. */
export interface ConsentNoteData {
  org: string;
  /** The email of whoever enabled it in this tab; a share shows "a member". */
  by: string;
  at: number;
}

/** `live` and `replay` are the turn engine's and the record's phases; the legacy chat passes `stream`/`tailFlush`. */
export type StreamPhase = "stream" | "tailFlush" | "live" | "replay";

/** HT-05: a step that never got its result is `interrupted`, never a green check. */
export type StepState = "running" | "done" | "failed" | "interrupted";

export type ActiveToolCall = ToolCall;

export interface PendingConfirmation {
  tool: string;
  args: Record<string, any>;
  message: I18nText;
  navAction?: NavigationAction;
}

export interface ReducerCtx {
  isActive: boolean;
  autoNavigationEnabled: boolean;
  phase: StreamPhase;
  t: TranslateFn;
  generateNavigation: (
    toolName: string,
    callArgs: any,
    responseBody: any,
  ) => NavigationAction | null;
  /** The card the session still waits on; a live frame equal to it is a redelivery. */
  pendingApprovalId?: string | null;
}

export interface StreamState {
  messages: ChatMessage[];
  activeToolCall: ActiveToolCall | null;
  textSegment: string;
  streamingMsg: string;
  title: string | undefined;
  lastTraceId: string | null;
  ownerUnavailable: boolean;
  pendingConfirmation: PendingConfirmation | null;
  messageComplete: boolean;
  halted: boolean;
  /** Kept by the typed phases only, so the legacy initialisers stay valid. */
  extras?: StreamExtras;
}

/** What the typed phases keep beside the messages; the turn engine mirrors parts of it into `turnMeta`. */
export interface StreamExtras {
  serverTurnId: string | null;
  /** B-02 sends the trace at `turn_started`, so a turn that fails before `complete` still has one for Details. */
  traceId: string | null;
  usage: UsageFrame["usage"] | null;
  compacted: boolean;
  toolCalls: number;
  toolErrors: number;
}

export type StreamEffect =
  // whenActive: the shell re-reads isActive() at execution time, because the original read it after its awaits.
  | { kind: "scroll"; whenActive?: boolean }
  | { kind: "save" }
  | { kind: "throttledSave"; force: boolean }
  | { kind: "navigate"; action: NavigationAction }
  | { kind: "confirmPost"; approved: boolean }
  | { kind: "dashboardEvent"; payload: AiDashboardEvent }
  | { kind: "animateTitle"; title: string }
  | { kind: "animateText" }
  | { kind: "syncSegments" }
  | { kind: "finalizeText" }
  | { kind: "approval"; frame: ConfirmationRequiredFrame }
  | { kind: "approval_resolved"; frame: ConfirmationResolvedFrame };

/** Assistant text of a stream event: o2-ai sends plain `content`; RCA proxies may send OpenAI-style shapes instead. */
export function extractStreamText(data: any): string | null {
  if (data == null || typeof data !== "object") return null;

  if (typeof data.content === "string") return data.content;

  if (typeof data.response === "string") return data.response;
  if (data.delta && typeof data.delta.content === "string") {
    return data.delta.content;
  }
  const firstChoice = Array.isArray(data.choices) ? data.choices[0] : null;
  if (firstChoice && typeof firstChoice.delta?.content === "string") {
    return firstChoice.delta.content;
  }
  if (typeof data.text === "string") return data.text;

  return null;
}

function lastMessageOf(state: StreamState): ChatMessage | undefined {
  return state.messages[state.messages.length - 1];
}

// Creates the assistant placeholder if needed, so a completed step renders expandable immediately instead of waiting for stream completion.
function pushCompletedToolCall(state: StreamState, block: ContentBlock): void {
  let lastMessage = lastMessageOf(state);
  if (!lastMessage || lastMessage.role !== "assistant") {
    lastMessage = { role: "assistant", content: raw(""), contentBlocks: [] };
    state.messages.push(lastMessage);
  }
  if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
  lastMessage.contentBlocks.push(block);
}

function appendBlock(state: StreamState, block: ContentBlock): void {
  const lastMessage = lastMessageOf(state);
  if (lastMessage && lastMessage.role === "assistant") {
    if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
    lastMessage.contentBlocks.push(block);
  } else {
    state.messages.push({
      role: "assistant",
      content: raw(""),
      contentBlocks: [block],
    });
  }
}

function completedBlockFrom(active: ActiveToolCall): ContentBlock {
  return {
    type: "tool_call",
    tool: active.tool,
    message: active.message,
    context: active.context,
    call_id: active.call_id,
  };
}

function finalizeTextBlock(state: StreamState, ctx: ReducerCtx, effects: StreamEffect[]): void {
  if (state.textSegment) {
    const lm = lastMessageOf(state);
    if (lm && lm.role === "assistant" && lm.contentBlocks) {
      const lb = lm.contentBlocks[lm.contentBlocks.length - 1];
      if (lb && lb.type === "text") {
        lb.text = state.textSegment;
      }
    }
  }
  state.textSegment = "";
  // finalizeText also carries the segment-ref sync that localFinalizeTextBlock did at its end.
  if (ctx.isActive) effects.push({ kind: "finalizeText" });
}

function reduceTitle(state: StreamState, data: any, ctx: ReducerCtx): StreamEffect[] {
  state.title = data.title;
  return ctx.isActive ? [{ kind: "animateTitle", title: data.title }] : [];
}

function reduceConfirmationRequired(
  state: StreamState,
  data: any,
  ctx: ReducerCtx,
): StreamEffect[] {
  const effects: StreamEffect[] = [];
  finalizeTextBlock(state, ctx, effects);

  // Detached streams auto-deny so the agent is not left paused with nobody to answer it.
  if (!ctx.isActive) {
    effects.push({ kind: "confirmPost", approved: false });
    return effects;
  }

  if (data.tool === "navigation_action" && ctx.autoNavigationEnabled) {
    effects.push({ kind: "confirmPost", approved: true });
    return effects;
  }

  // data.message is always set by the backend: a validated navigation label, or "Confirm execution of {tool}?".
  const confirmBlock: ContentBlock = {
    type: "tool_call",
    tool: data.tool,
    message: state.activeToolCall?.message || data.message,
    context: state.activeToolCall?.context || {},
    call_id: data.call_id || state.activeToolCall?.call_id || undefined,
    pendingConfirmation: true,
    confirmationMessage: data.message,
    confirmationArgs: data.args || {},
  };
  state.activeToolCall = null;

  appendBlock(state, confirmBlock);

  state.pendingConfirmation = {
    tool: data.tool,
    args: data.args || {},
    message: data.message || ctx.t("aiAssistant.aiChat.confirmToolExecution", { tool: data.tool }),
  };
  effects.push({ kind: "scroll" });
  return effects;
}

function reduceToolCall(state: StreamState, data: any, ctx: ReducerCtx): StreamEffect[] {
  const effects: StreamEffect[] = [];
  if (state.activeToolCall) {
    pushCompletedToolCall(state, completedBlockFrom(state.activeToolCall));
  }

  if (ctx.isActive) {
    state.activeToolCall = {
      tool: data.tool,
      message: data.message,
      context: data.context || {},
      call_id: data.call_id || undefined,
    };
  }

  finalizeTextBlock(state, ctx, effects);
  // ponytail: phase gate reproduces the tail-flush handler gap on purpose. Delete with the follow-up fix.
  if (ctx.phase === "stream") effects.push({ kind: "scroll", whenActive: true });
  return effects;
}

function reduceError(state: StreamState, data: any, ctx: ReducerCtx): StreamEffect[] {
  // Owning replica is gone — flag and stop; sendMessage restores the conversation once the stream ends.
  if (data.code === "session_owner_unavailable") {
    state.ownerUnavailable = true;
    return [];
  }
  const effects: StreamEffect[] = [];
  if (state.activeToolCall) {
    pushCompletedToolCall(state, completedBlockFrom(state.activeToolCall));
    if (ctx.isActive) state.activeToolCall = null;
  }

  const rawError = data.error ?? data.message ?? ctx.t("aiAssistant.aiChat.unexpectedError");
  const errorText = typeof rawError === "string" ? rawError : JSON.stringify(rawError, null, 2);

  const authErr = isAuthError(errorText, data.error_type);
  // Widened to `string`: the branded `I18nText` from t() does not survive the `+=` below.
  let errorMessage: string = authErr
    ? ctx.t(UNAUTHORIZED_MESSAGE_KEY)
    : ctx.t("common.errorPrefix", { message: errorText });
  if (data.suggestion && !authErr) {
    errorMessage += `\n\n${data.suggestion}`;
  }

  const lastMessage = lastMessageOf(state);
  if (!lastMessage || lastMessage.role !== "assistant") {
    state.messages.push({
      role: "assistant",
      content: raw(errorMessage),
      contentBlocks: [{ type: "text", text: errorMessage }],
    });
  } else {
    if (lastMessage.content) {
      lastMessage.content = raw(lastMessage.content + "\n\n" + errorMessage);
    } else {
      lastMessage.content = raw(errorMessage);
    }
    if (!lastMessage.contentBlocks) {
      lastMessage.contentBlocks = [];
    }
    lastMessage.contentBlocks.push({ type: "text", text: errorMessage });
  }

  state.textSegment = "";
  state.halted = true;

  effects.push({ kind: "syncSegments" });
  effects.push({ kind: "save" });
  effects.push({ kind: "scroll", whenActive: true });
  return effects;
}

function reduceComplete(state: StreamState, data: any, ctx: ReducerCtx): StreamEffect[] {
  if (data.trace_id && ctx.isActive) {
    state.lastTraceId = data.trace_id;
  }
  if (state.activeToolCall) {
    pushCompletedToolCall(state, completedBlockFrom(state.activeToolCall));
    if (ctx.isActive) state.activeToolCall = null;
  }
  if (state.messageComplete) return [];
  const lastMessage = lastMessageOf(state);
  // An action-only turn streams no text, so the post-loop save never runs and this is its only chance to persist.
  if (lastMessage?.role !== "assistant" || !lastMessage.contentBlocks?.length) return [];
  return [{ kind: "throttledSave", force: true }];
}

// A stored turn the user stopped; the live panel marks its own Stop, as the aborted stream never sees this frame.
/** The marker a turn the user stopped ends with. */
export function stoppedMarker(t: TranslateFn): ContentBlock {
  return { type: "status", turnStatus: "stopped", message: t("aiAssistant.responseStoppedByUser") };
}

function reduceCancelled(state: StreamState, ctx: ReducerCtx): StreamEffect[] {
  if (state.activeToolCall) {
    pushCompletedToolCall(state, completedBlockFrom(state.activeToolCall));
    if (ctx.isActive) state.activeToolCall = null;
  }
  const marker = stoppedMarker(ctx.t);
  const lastMessage = lastMessageOf(state);
  if (lastMessage?.role === "assistant") {
    if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
    lastMessage.contentBlocks.push(marker);
  } else {
    state.messages.push({ role: "assistant", content: raw(""), contentBlocks: [marker] });
  }
  return [];
}

function dashboardEffect(data: any): StreamEffect | null {
  const resolvedToolName = data.tool && data.tool !== "tools_call" ? data.tool : "";
  const callArgs = data.call_args || {};
  const dashboardEventType = getDashboardEventType(resolvedToolName);
  if (!dashboardEventType) return null;
  const dashboardId =
    callArgs.dashboard_id || callArgs.args?.dashboard_id || callArgs.request_body?.dashboard_id;
  if (!dashboardId) {
    console.warn(
      `[O2AIChat] Could not extract dashboardId from call_args for tool "${resolvedToolName}". Skipping dashboard event.`,
      callArgs,
    );
    return null;
  }
  const folderId = callArgs.folder || callArgs.args?.folder || callArgs.request_body?.folder;
  return { kind: "dashboardEvent", payload: { type: dashboardEventType, dashboardId, folderId } };
}

function reduceToolResult(state: StreamState, data: any, ctx: ReducerCtx): StreamEffect[] {
  const effects: StreamEffect[] = [];
  const resultData = {
    success: data.success !== false,
    resultMessage: data.message || "",
    summary: data.summary || undefined,
    errorType: data.error_type || undefined,
    suggestion: data.suggestion || undefined,
    details: data.details || undefined,
    response: data.response || undefined,
  };

  // ponytail: phase gate reproduces the tail-flush handler gap on purpose. Delete with the follow-up fix.
  const inStream = ctx.phase === "stream";

  let navigationAction: NavigationAction | null = null;
  if (inStream && data.success !== false && data.call_args) {
    navigationAction = ctx.generateNavigation(data.tool, data.call_args, data);
  }

  if (inStream && data.success !== false && ctx.isActive) {
    const effect = dashboardEffect(data);
    if (effect) effects.push(effect);
  }

  // Match by call_id if available, fall back to tool name
  const matchesActiveToolCall =
    state.activeToolCall &&
    ((data.call_id && state.activeToolCall.call_id === data.call_id) ||
      (!data.call_id && state.activeToolCall.tool === data.tool));

  if (matchesActiveToolCall) {
    pushCompletedToolCall(state, {
      ...completedBlockFrom(state.activeToolCall!),
      ...resultData,
      ...(navigationAction && { navigationAction }),
    });
    if (ctx.isActive) state.activeToolCall = null;
  } else {
    const lastMessage = lastMessageOf(state);
    if (lastMessage && lastMessage.contentBlocks) {
      for (let i = lastMessage.contentBlocks.length - 1; i >= 0; i--) {
        const block = lastMessage.contentBlocks[i];
        const blockMatches = data.call_id
          ? block.call_id === data.call_id
          : block.type === "tool_call" && block.tool === data.tool && block.success === undefined;
        if (blockMatches) {
          Object.assign(block, resultData);
          if (navigationAction) {
            block.navigationAction = navigationAction;
          }
          break;
        }
      }
    }
  }
  if (inStream) effects.push({ kind: "scroll", whenActive: true });
  return effects;
}

function reduceNavigationAction(state: StreamState, data: any, ctx: ReducerCtx): StreamEffect[] {
  const effects: StreamEffect[] = [];
  finalizeTextBlock(state, ctx, effects);

  if (!ctx.isActive) return effects;

  const navAction: NavigationAction = {
    resource_type: data.resource_type,
    action: data.action,
    label: data.label,
    target: data.target,
  };

  if (ctx.autoNavigationEnabled) {
    effects.push({ kind: "navigate", action: navAction });
    return effects;
  }

  const confirmBlock: ContentBlock = {
    type: "tool_call",
    tool: "navigation_action",
    message: data.label || ctx.t("aiAssistant.aiChat.navigateConfirmQuestion"),
    context: { navAction },
    pendingConfirmation: true,
    confirmationMessage: data.label,
    confirmationArgs: data.target || {},
  };
  state.activeToolCall = null;

  appendBlock(state, confirmBlock);

  state.pendingConfirmation = {
    tool: "navigation_action",
    args: data.target || {},
    message: data.label || ctx.t("aiAssistant.aiChat.navigateConfirmQuestion"),
    navAction,
  };

  effects.push({ kind: "scroll" });
  return effects;
}

function reduceText(
  state: StreamState,
  data: any,
  ctx: ReducerCtx,
  streamText: string,
): StreamEffect[] {
  const effects: StreamEffect[] = [];
  if (state.activeToolCall) {
    pushCompletedToolCall(state, completedBlockFrom(state.activeToolCall));
    if (ctx.isActive) state.activeToolCall = null;
  }

  // Anything arriving via a non-`content` fallback field is also an incremental delta.
  const isMessageDelta = data.type === "message_delta" || typeof data.content !== "string";

  let content = streamText;
  if (!isMessageDelta) {
    content = content.replace(/```(\w*)\s*([^`])/g, "```$1\n$2");
    content = content.replace(/([^`])\s*```/g, "$1\n```");
  }

  if (!isMessageDelta) {
    if (state.streamingMsg && state.textSegment === "") {
      state.streamingMsg += "\n\n";
    } else if (
      state.streamingMsg &&
      !state.streamingMsg.endsWith("\n") &&
      !content.startsWith("\n")
    ) {
      state.streamingMsg += "\n\n";
      state.textSegment += "\n\n";
    }
  }

  state.streamingMsg += content;
  state.textSegment += content;

  effects.push({ kind: "syncSegments" });
  if (ctx.isActive) effects.push({ kind: "animateText" });

  const lastMessage = lastMessageOf(state);
  if (!lastMessage || lastMessage.role !== "assistant") {
    state.messages.push({
      role: "assistant",
      content: raw(state.streamingMsg),
      contentBlocks: [{ type: "text", text: state.textSegment }],
    });
    // Save immediately when the assistant message is first created so a reload cannot lose it.
    effects.push({ kind: "throttledSave", force: true });
  } else {
    lastMessage.content = raw(state.streamingMsg);

    if (!lastMessage.contentBlocks) {
      lastMessage.contentBlocks = [];
    }
    const lastBlock = lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1];
    if (lastBlock && lastBlock.type === "text") {
      lastBlock.text = state.textSegment;
    } else {
      lastMessage.contentBlocks.push({ type: "text", text: state.textSegment });
    }
    effects.push({ kind: "throttledSave", force: false });
  }
  state.messageComplete = true;
  // ponytail: phase gate reproduces the tail-flush handler gap on purpose. Delete with the follow-up fix.
  if (ctx.phase === "stream") effects.push({ kind: "scroll", whenActive: true });
  return effects;
}

export function reduce(state: StreamState, data: any, ctx: ReducerCtx): StreamEffect[] {
  if (ctx.phase === "live" || ctx.phase === "replay") return reduceTyped(state, data, ctx);
  // Server-side chat persistence frames (opencode durable events) are for OpenObserve, never the UI; unknown types would otherwise fall through to extractStreamText.
  if (data && (data.type === "sync" || data.type === "sync_state")) return [];
  if (data && data.type === "title") return reduceTitle(state, data, ctx);
  // ponytail: phase gate reproduces the tail-flush handler gap on purpose. Delete with the follow-up fix.
  if (data && data.type === "confirmation_required" && ctx.phase === "stream") {
    return reduceConfirmationRequired(state, data, ctx);
  }
  if (data && data.type === "tool_call") return reduceToolCall(state, data, ctx);
  if (data && data.type === "error") return reduceError(state, data, ctx);
  if (data && data.type === "complete") return reduceComplete(state, data, ctx);
  if (data && data.type === "cancelled") return reduceCancelled(state, ctx);
  if (data && data.type === "tool_result") return reduceToolResult(state, data, ctx);
  // ponytail: phase gate reproduces the tail-flush handler gap on purpose. Delete with the follow-up fix.
  if (data && data.type === "navigation_action" && ctx.phase === "stream") {
    return reduceNavigationAction(state, data, ctx);
  }

  const streamText = extractStreamText(data);
  if (typeof streamText === "string") return reduceText(state, data, ctx, streamText);
  return [];
}

export function emptyExtras(): StreamExtras {
  return {
    serverTurnId: null,
    traceId: null,
    usage: null,
    compacted: false,
    toolCalls: 0,
    toolErrors: 0,
  };
}

/** Marks every running step of the current answer interrupted: Stop, a drop, an error or `complete` ended it. */
export function interruptSteps(state: StreamState): void {
  for (const block of lastMessageOf(state)?.contentBlocks ?? []) {
    if (block.stepState === "running") block.stepState = "interrupted";
  }
}

/** Steps and streamed text of the current answer, for `stopped{steps,partial}` and the empty-turn rule. */
export function answerProgress(state: StreamState): { steps: number; partial: boolean } {
  const last = lastMessageOf(state);
  const blocks = last?.role === "assistant" ? (last.contentBlocks ?? []) : [];
  return {
    steps: blocks.filter((block) => block.stepState).length,
    partial: blocks.some((block) => block.type === "text" && !!block.text?.trim()),
  };
}

// Today's frames go through the legacy cases as `stream`; tool steps are appended at once so a running step renders.
function reduceTyped(state: StreamState, data: any, ctx: ReducerCtx): StreamEffect[] {
  const extras = (state.extras ??= emptyExtras());
  const live: ReducerCtx = { ...ctx, isActive: true, phase: "stream" };
  switch (data?.type) {
    case "tool_call":
      return typedToolCall(state, data, live, extras);
    case "tool_result":
      return typedToolResult(state, data, live, extras);
    case "error":
      return typedError(state, data, ctx);
    case "complete":
      return typedComplete(state, data, extras);
    case "cancelled":
      interruptSteps(state);
      state.halted = true;
      return [];
    case "permission_denied":
      return typedPermissionDenied(state, data, extras);
    case "confirmation_required":
      return typedApproval(state, data, live, ctx.phase);
    case "confirmation_resolved":
      return typedResolved(state, data, ctx.phase);
    case "resource_changed":
      reduceExtras(extras, data);
      noteUnreviewed(state, String(data.resource_type ?? ""), "frames", boundedId(data.id));
      return [];
    case "status":
      return [];
    case "step":
      reduceExtras(extras, data);
      typedStep(state, data);
      return [];
    case "navigation_action":
      return typedLink(state, data, live);
    case "findings":
      reduceExtras(extras, data);
      return typedEvidence(state, { type: "findings", findings: boundedFindings(data) }, live);
    case "query":
      return typedQuery(state, data, live);
    default:
      return reduceExtras(extras, data) ? [] : reduce(state, data, live);
  }
}

function reduceExtras(extras: StreamExtras, data: any): boolean {
  switch (data?.type) {
    case "turn_started":
      extras.serverTurnId = data.turn_id;
      if (typeof data.trace_id === "string" && data.trace_id) extras.traceId = data.trace_id;
      return true;
    case "usage":
      extras.usage = data.usage;
      return true;
    case "step":
    case "retrying":
    case "compacting":
    case "query":
    case "resource_changed":
    case "findings":
      return true;
    default:
      return false;
  }
}

function typedToolCall(
  state: StreamState,
  data: any,
  ctx: ReducerCtx,
  extras: StreamExtras,
): StreamEffect[] {
  const effects: StreamEffect[] = [];
  finalizeTextBlock(state, ctx, effects);
  const callId = boundedId(data.call_id);
  const call: ContentBlock = {
    type: "tool_call",
    tool: String(data.tool ?? "").slice(0, MAX_TOOL_CHARS),
    message: data.message,
    context: data.context || {},
    call_id: callId,
    stepState: "running",
  };
  // A lifecycle `step` frame may have announced this call already; its `tool_call` fills the same row.
  const announced = callId ? stepFor(state, callId, call.tool!) : null;
  if (announced) Object.assign(announced, { ...call, stepState: announced.stepState ?? "running" });
  else if (stepCount(state) < MAX_STEPS) appendBlock(state, call);
  extras.toolCalls += 1;
  effects.push({ kind: "scroll", whenActive: true });
  return effects;
}

function typedToolResult(
  state: StreamState,
  data: any,
  ctx: ReducerCtx,
  extras: StreamExtras,
): StreamEffect[] {
  const success = data.success !== false;
  const result: ContentBlock = {
    type: "tool_call",
    success,
    resultMessage: data.message || "",
    summary: data.summary || undefined,
    errorType: data.error_type || undefined,
    suggestion: data.suggestion || undefined,
    details: data.details || undefined,
    stepState: success ? "done" : "failed",
  };
  const callArgs = boundedArgs(data.call_args);
  if (callArgs) result.callArgs = callArgs;
  const bounded = boundedResult(data.response);
  if (bounded) result.result = bounded;
  const callId = boundedId(data.call_id);
  const typed = boundedQuery(data.query, callId);
  if (typed) result.query = typed;
  const navigationAction =
    success && data.call_args ? ctx.generateNavigation(data.tool, data.call_args, data) : null;
  if (navigationAction) result.navigationAction = navigationAction;
  const step = stepFor(state, callId, data.tool);
  // A result for a call the stream never announced is still a step, never dropped.
  if (step) Object.assign(step, result);
  else if (stepCount(state) < MAX_STEPS)
    appendBlock(state, {
      ...result,
      tool: String(data.tool ?? "").slice(0, MAX_TOOL_CHARS),
      context: {},
      call_id: callId,
    });
  if (!success) extras.toolErrors += 1;
  const tool = String(data.tool ?? "");
  if (success && MUTATING_TOOL_PATTERNS.test(tool))
    noteUnreviewed(state, resourceOfTool(tool), "tools");
  return [{ kind: "scroll", whenActive: true }];
}

function typedError(state: StreamState, data: any, ctx: ReducerCtx): StreamEffect[] {
  if (data.code === "session_owner_unavailable" || data.category === "session_owner_unavailable") {
    state.ownerUnavailable = true;
    return [];
  }
  // Answered but not saved is the turn's outcome, not a break in the answer (constraint 14).
  if (data.code === "persistence_failed") return [];
  state.textSegment = "";
  interruptSteps(state);
  state.halted = true;
  // A replayed failure has no live turn to carry its outcome, so the block names the code (never the server text).
  if (ctx.phase === "replay") {
    appendBlock(state, { type: "error", errorType: toAssistantError(data).code });
  }
  // The turn's terminal saves, so a stream save here would write the same chat twice.
  return [];
}

function typedComplete(state: StreamState, data: any, extras: StreamExtras): StreamEffect[] {
  if (data.trace_id) state.lastTraceId = data.trace_id;
  if (data.usage) extras.usage = data.usage;
  extras.compacted = data.compacted === true;
  state.textSegment = "";
  interruptSteps(state);
  appendFooter(state, data, extras);
  return [];
}

// The vote and the footer need this turn's own trace and usage after the next turn and a reload.
function appendFooter(state: StreamState, data: any, extras: StreamExtras): void {
  const last = lastMessageOf(state);
  if (last?.role !== "assistant" || last.contentBlocks?.some((b) => b.type === "footer")) return;
  const traceId =
    typeof data.trace_id === "string" && data.trace_id ? data.trace_id : extras.traceId;
  const usage = footerUsage(data.usage ?? extras.usage);
  const used = contextUsedKeys(data.context_used);
  const footer: FooterData = {
    ...(traceId && { traceId }),
    ...(extras.serverTurnId && { serverTurnId: String(extras.serverTurnId).slice(0, 64) }),
    ...(usage && { usage }),
    ...(used && { contextUsed: used }),
    ...(typeof data.persisted === "boolean" && { persisted: data.persisted }),
  };
  appendBlock(state, { type: "footer", footer });
}

// A lifecycle `step` frame keys its row on the top-level `call_id` (params as the fallback) and says when it ended.
function typedStep(state: StreamState, data: any): void {
  const fromParams = data.params?.call_id;
  const callId = boundedId(
    data.call_id ?? (typeof fromParams === "string" ? fromParams : undefined) ?? data.id,
  );
  if (!callId) return;
  const next: StepState = STEP_STATES.has(data.state) ? data.state : "running";
  const block = stepFor(state, callId, "");
  if (!block) {
    if (stepCount(state) >= MAX_STEPS) return;
    appendBlock(state, {
      type: "tool_call",
      tool: String(typeof data.label === "string" ? data.label : (data.kind ?? "")).slice(
        0,
        MAX_TOOL_CHARS,
      ),
      context: boundedArgs(data.params) ?? {},
      call_id: callId,
      stepState: next,
    });
    return;
  }
  // An ended step never goes back to running, and a result already written wins over the lifecycle frame.
  if (next === "running" || block.stepState === "done" || block.stepState === "failed") return;
  block.stepState = next;
  if (next === "failed") block.success = false;
}

// A navigation is offered as a link card, never pushed; the model's label is never kept.
function typedLink(state: StreamState, data: any, ctx: ReducerCtx): StreamEffect[] {
  const target = data.target && typeof data.target === "object" ? boundedTarget(data.target) : {};
  const link: LinkBlockData = {
    resourceType: String(data.resource_type ?? "").slice(0, 40),
    action: String(data.action ?? "").slice(0, 40),
    target,
  };
  return typedEvidence(state, { type: "link", link }, ctx);
}

function typedQuery(state: StreamState, data: any, ctx: ReducerCtx): StreamEffect[] {
  const query = boundedQuery(data);
  return query ? typedEvidence(state, { type: "query", query }, ctx) : [];
}

function typedEvidence(state: StreamState, block: ContentBlock, ctx: ReducerCtx): StreamEffect[] {
  const effects: StreamEffect[] = [];
  finalizeTextBlock(state, ctx, effects);
  const blocks = lastMessageOf(state)?.contentBlocks ?? [];
  if (blocks.filter((b) => EVIDENCE_TYPES.has(b.type)).length < MAX_EVIDENCE)
    appendBlock(state, block);
  effects.push({ kind: "scroll", whenActive: true });
  return effects;
}

function boundedTarget(target: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(target).slice(0, 30)) {
    if (key === "path" || key === "label") continue;
    if (typeof value === "string") out[key] = value.slice(0, key === "query" ? 20_000 : 400);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (Array.isArray(value))
      out[key] = value.filter((v) => typeof v === "string").slice(0, 10);
    else if (key === "query" && value && typeof value === "object" && depth < 1)
      out[key] = boundedTarget(value as Record<string, unknown>, depth + 1);
  }
  return out;
}

function typedPermissionDenied(
  state: StreamState,
  data: any,
  extras: StreamExtras,
): StreamEffect[] {
  const denied: ContentBlock = {
    type: "tool_call",
    success: false,
    stepState: "failed",
    errorType:
      data.policy === "data_sharing_level" ? "data_level_blocked" : "permission_denied_tool",
    details: {
      ...(typeof data.detail === "string" && { detail: data.detail.slice(0, MAX_LINE_CHARS) }),
      ...(typeof data.policy === "string" && { policy: data.policy.slice(0, 40) }),
    },
  };
  const tool = String(data.tool ?? "").slice(0, MAX_TOOL_CHARS);
  // A lifecycle `step` frame may already have failed the row; the denial reuses it rather than adding one.
  const step = stepFor(state, boundedId(data.call_id), tool) ?? deniedRowOf(state, tool);
  if (step) Object.assign(step, denied);
  else if (stepCount(state) < MAX_STEPS) appendBlock(state, { ...denied, tool, context: {} });
  extras.toolErrors += 1;
  return [];
}

// The card itself renders where the session holds it; the block is the record that replaces it.
function typedApproval(
  state: StreamState,
  data: any,
  ctx: ReducerCtx,
  phase: StreamPhase,
): StreamEffect[] {
  const effects: StreamEffect[] = [];
  finalizeTextBlock(state, ctx, effects);
  const approval = approvalOf(data);
  const blocks = lastMessageOf(state)?.contentBlocks ?? [];
  // A redelivered frame lands right after its own card while that card still waits; a card asked again after a decision is new.
  const previous = blocks.at(-1)?.approval;
  const redelivered = previous && previous.id === ctx.pendingApprovalId;
  if (!approval.id && redelivered && sameCard(previous, approval)) return effects;
  const id = approval.id || turnCardId(state);
  if (!approval.id || !blocks.some((block) => block.approval?.id === id))
    appendBlock(state, { type: "approval", approval: { ...approval, id } });
  const frame = approval.id ? data : { ...data, id };
  if (phase === "live") effects.push({ kind: "approval", frame }, { kind: "scroll" });
  return effects;
}

function typedResolved(state: StreamState, data: any, phase: StreamPhase): StreamEffect[] {
  resolveConfirmation(state, data);
  const id = boundedId(data.id);
  if (!id) return [];
  const resolved: ResolvedBlockData = {
    id,
    approved: data.approved === true,
    ...(typeof data.by === "string" && { by: data.by.slice(0, 200) }),
    ...(typeof data.at === "number" && { at: data.at }),
    ...(data.expired === true && { expired: true }),
    ...(data.withdrawn === true && { withdrawn: true }),
  };
  appendBlock(state, { type: "approval_result", resolved });
  return phase === "live" ? [{ kind: "approval_resolved", frame: data }] : [];
}

/** A delete by kind, operation or tool name: never granted for longer than once, whatever the wire says. */
export function isDeleteCard(card: { kind: string; tool: string; operation?: string }): boolean {
  return (
    card.kind === "delete" || DELETE_TOOL.test(card.operation ?? "") || DELETE_TOOL.test(card.tool)
  );
}

/** A `confirmation_required` frame as a typed card; the kind comes from `kind`, the tool or its arguments, never a name prefix. */
export function approvalOf(data: any): ApprovalBlockData {
  const args = isRecord(data?.args) ? data.args : {};
  const tool = String(data?.tool ?? "").slice(0, MAX_TOOL_CHARS);
  const kind = approvalKindOf(data, tool, args);
  const typed = APPROVAL_KINDS.has(data?.kind) || Array.isArray(data?.targets);
  // The wire can only make a card more careful: a delete, by kind, operation or tool, is destructive whatever it says.
  const destructive =
    isDeleteCard({ kind, tool, operation: String(data?.operation ?? "") }) ||
    data?.destructive === true;
  const items = Array.isArray(data?.targets) ? data.targets : args.items;
  const targets = targetsOf(data, args);
  const total = Array.isArray(items) ? Math.min(items.length, MAX_TOTAL) : targets.length;
  const after = data?.after !== undefined ? data.after : kind === "update" ? args : undefined;
  const impact = Array.isArray(data?.impact)
    ? data.impact
        .filter((line: unknown): line is string => typeof line === "string")
        .slice(0, MAX_IMPACT)
        .map((line: string) => line.slice(0, MAX_LINE_CHARS))
    : undefined;
  const expiresAt = epochMsOf(data?.expires_at);
  const wireId = data?.call_id ?? data?.approval_id ?? data?.id;
  return {
    id: typeof wireId === "string" ? wireId.slice(0, 200) : "",
    kind,
    destructive,
    operation: typeof data?.operation === "string" ? data.operation.slice(0, 60) : "",
    tool,
    targets,
    ...(total > targets.length && { total }),
    ...(data?.before !== undefined && { before: boundedJson(data.before) }),
    ...(after !== undefined && { after: boundedJson(after) }),
    ...(impact?.length && { impact }),
    grantable: data?.grantable === true && !destructive,
    // Only a batch edits, in its plan, and only when every item it acts on is listed there.
    editable:
      targets.length > 1 &&
      total === targets.length &&
      (data?.editable === true || kind === "delete"),
    question: typeof data?.message === "string" ? data.message.slice(0, MAX_QUESTION_CHARS) : "",
    ...(typeof args.command === "string" && {
      command:
        args.command.length > MAX_QUESTION_CHARS
          ? `${args.command.slice(0, MAX_QUESTION_CHARS)}…`
          : args.command,
    }),
    ...(Object.keys(args).length > 0 && { args: boundedJson(args) as Record<string, unknown> }),
    typed,
    ...(expiresAt !== null && { expiresAt }),
  };
}

function approvalKindOf(data: any, tool: string, args: Record<string, unknown>): ApprovalKind {
  if (APPROVAL_KINDS.has(data?.kind)) return data.kind as ApprovalKind;
  if (tool === "o2_delete") return "delete";
  if (typeof args.command === "string") return "run_command";
  return "permission";
}

function targetsOf(data: any, args: Record<string, unknown>): ApprovalTarget[] {
  const raw = Array.isArray(data?.targets)
    ? data.targets
    : Array.isArray(args.items)
      ? args.items.map((item: any) => ({
          type: item?.resource_type,
          id: item?.id,
          name: item?.name,
        }))
      : [];
  return raw.slice(0, MAX_TARGETS).flatMap((target: any): ApprovalTarget[] => {
    const name = typeof target?.name === "string" ? target.name.slice(0, 200) : "";
    if (!name) return [];
    const id = boundedId(typeof target?.id === "string" ? target.id : undefined);
    const type = typeof target?.type === "string" ? target.type.slice(0, 40).toLowerCase() : "";
    return [{ type: type || "object", name, ...(id && { id }) }];
  });
}

// One notice per type and answer, none after a card; a tool result and its `resource_changed` are one change, so the larger count wins.
function noteUnreviewed(
  state: StreamState,
  resourceType: string,
  source: "tools" | "frames",
  resourceId?: string,
): void {
  const blocks = lastMessageOf(state)?.contentBlocks ?? [];
  if (blocks.some((block) => block.type === "approval")) return;
  const type = resourceType.slice(0, 40).toLowerCase() || "object";
  const known = blocks.find(
    (block) => block.policy?.kind === "unreviewed" && block.policy.resourceType === type,
  );
  const policy: PolicyBlockData = known?.policy ?? { kind: "unreviewed", resourceType: type };
  const seen = { tools: policy.tools ?? 0, frames: policy.frames ?? 0 };
  seen[source] += 1;
  const count = Math.max(seen.tools, seen.frames);
  const id = count === 1 ? (resourceId ?? policy.resourceId) : undefined;
  const next: PolicyBlockData = {
    kind: "unreviewed",
    resourceType: type,
    count,
    ...seen,
    ...(id && { resourceId: id }),
  };
  if (known) known.policy = next;
  else if (blocks.length < MAX_STEPS) appendBlock(state, { type: "policy", policy: next });
}

function resourceOfTool(tool: string): string {
  const noun = tool.replace(MUTATING_TOOL_PATTERNS, "");
  return noun.replace(/s$/i, "") || "object";
}

function boundedJson(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.slice(0, MAX_LINE_CHARS);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (depth >= MAX_JSON_DEPTH || typeof value !== "object") return undefined;
  if (Array.isArray(value))
    return value.slice(0, MAX_JSON_KEYS).map((v) => boundedJson(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_JSON_KEYS)) {
    const kept = boundedJson(v, depth + 1);
    // A parsed `__proto__` key would re-parent the object instead of adding a field.
    if (kept !== undefined && !UNSAFE_KEYS.has(key)) out[key.slice(0, 60)] = kept;
  }
  return out;
}

// Seconds or milliseconds on the wire; anything else is no expiry.
function epochMsOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value < 1e12 ? value * 1000 : value;
}

// Today's frames carry no id; the turn and the card's place in its own turn make one, so the history fold of that turn gives it again.
function turnCardId(state: StreamState): string {
  let n = 1;
  let turnId = "";
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i];
    turnId ||= message.turnId ?? "";
    if (message.role === "user") break;
    n += (message.contentBlocks ?? []).filter((block) => block.type === "approval").length;
  }
  return `${turnId || "turn"}:${n}`;
}

function sameCard(a: ApprovalBlockData | undefined, b: ApprovalBlockData): boolean {
  return (
    !!a &&
    a.tool === b.tool &&
    a.question === b.question &&
    JSON.stringify(a.args) === JSON.stringify(b.args)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function resolveConfirmation(state: StreamState, data: any): void {
  const block = lastMessageOf(state)?.contentBlocks?.find(
    (b) => b.pendingConfirmation && b.call_id === data.id,
  );
  if (!block) return;
  block.pendingConfirmation = false;
  // A denied action never ran: neutral, not a failure (Calm Signal).
  if (!data.approved) block.stepState = "interrupted";
}

function stepFor(
  state: StreamState,
  callId: string | undefined,
  tool: string,
): ContentBlock | null {
  const blocks = lastMessageOf(state)?.contentBlocks ?? [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.type !== "tool_call" || !block.stepState) continue;
    if (callId ? block.call_id === callId : block.tool === tool && block.stepState === "running")
      return block;
  }
  return null;
}

function deniedRowOf(state: StreamState, tool: string): ContentBlock | null {
  const blocks = lastMessageOf(state)?.contentBlocks ?? [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (
      block.type === "tool_call" &&
      block.tool === tool &&
      block.stepState === "failed" &&
      !block.errorType
    )
      return block;
  }
  return null;
}

function stepCount(state: StreamState): number {
  return (lastMessageOf(state)?.contentBlocks ?? []).filter((b) => b.type === "tool_call").length;
}

function boundedId(value: unknown): string | undefined {
  return typeof value === "string" && value ? value.slice(0, MAX_ID_CHARS) : undefined;
}
