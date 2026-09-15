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

export type StreamPhase = "stream" | "tailFlush";

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
  | { kind: "finalizeText" };

/**
 * The o2-ai (opencode) backend emits streamed text as
 *   {"type":"message_delta","content":"<plain string>"}
 * and non-streamed notices as {"type":"message","content":"..."} — the text
 * is ALWAYS the plain-string `content` field. We also defensively accept the
 * handful of OpenAI-compatible shapes the enterprise RCA proxy can surface
 * (`response`, `delta.content`, `choices[].delta.content`, `text`) so an
 * agent/proxy variant doesn't silently render nothing. Returns the text, or
 * null when the event carries no assistant text.
 */
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
  if (data && data.type === "title") return reduceTitle(state, data, ctx);
  // ponytail: phase gate reproduces the tail-flush handler gap on purpose. Delete with the follow-up fix.
  if (data && data.type === "confirmation_required" && ctx.phase === "stream") {
    return reduceConfirmationRequired(state, data, ctx);
  }
  if (data && data.type === "tool_call") return reduceToolCall(state, data, ctx);
  if (data && data.type === "error") return reduceError(state, data, ctx);
  if (data && data.type === "complete") return reduceComplete(state, data, ctx);
  if (data && data.type === "tool_result") return reduceToolResult(state, data, ctx);
  // ponytail: phase gate reproduces the tail-flush handler gap on purpose. Delete with the follow-up fix.
  if (data && data.type === "navigation_action" && ctx.phase === "stream") {
    return reduceNavigationAction(state, data, ctx);
  }

  const streamText = extractStreamText(data);
  if (typeof streamText === "string") return reduceText(state, data, ctx, streamText);
  return [];
}
