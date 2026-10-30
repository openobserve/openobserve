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

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  answerProgress,
  approvalOf,
  extractStreamText,
  interruptSteps,
  reduce,
  type ReducerCtx,
  type StreamEffect,
  type StreamPhase,
  type StreamState,
} from "./reducer";
import { foldTurns } from "./record";
import { approvalOutcomeOf } from "./useAssistantApprovals";
import type { ChatMessage, NavigationAction } from "@/ts/interfaces/chat";
import { raw, type TranslateFn } from "@/types/i18n";

const t = ((key: string, named?: Record<string, unknown>) =>
  named ? `${key}(${JSON.stringify(named)})` : key) as unknown as TranslateFn;

function makeState(over: Partial<StreamState> = {}): StreamState {
  return {
    messages: [],
    activeToolCall: null,
    textSegment: "",
    streamingMsg: "",
    title: undefined,
    lastTraceId: null,
    ownerUnavailable: false,
    pendingConfirmation: null,
    messageComplete: false,
    halted: false,
    ...over,
  };
}

function makeCtx(over: Partial<ReducerCtx> = {}): ReducerCtx {
  return {
    isActive: true,
    autoNavigationEnabled: false,
    phase: "stream",
    t,
    generateNavigation: () => null,
    ...over,
  };
}

function assistant(over: Partial<ChatMessage> = {}): ChatMessage {
  return { role: "assistant", content: raw(""), contentBlocks: [], ...over };
}

const kinds = (effects: StreamEffect[]) => effects.map((e) => e.kind);
const bothPhases: StreamPhase[] = ["stream", "tailFlush"];

describe("extractStreamText", () => {
  it("returns null for non-objects", () => {
    expect(extractStreamText(null)).toBeNull();
    expect(extractStreamText(undefined)).toBeNull();
    expect(extractStreamText("hello")).toBeNull();
    expect(extractStreamText(42)).toBeNull();
  });

  it("prefers the canonical string content field", () => {
    expect(extractStreamText({ content: "hi", response: "no" })).toBe("hi");
  });

  it("accepts an empty string content", () => {
    expect(extractStreamText({ content: "" })).toBe("");
  });

  it("ignores a non-string content and falls through", () => {
    expect(extractStreamText({ content: { parts: [] }, response: "fallback" })).toBe("fallback");
  });

  it("falls back to response", () => {
    expect(extractStreamText({ response: "r" })).toBe("r");
  });

  it("falls back to delta.content", () => {
    expect(extractStreamText({ delta: { content: "d" } })).toBe("d");
  });

  it("ignores a delta whose content is not a string", () => {
    expect(extractStreamText({ delta: { content: 1 }, text: "t" })).toBe("t");
  });

  it("falls back to choices[0].delta.content", () => {
    expect(extractStreamText({ choices: [{ delta: { content: "c" } }] })).toBe("c");
  });

  it("ignores choices that are not an array", () => {
    expect(extractStreamText({ choices: { delta: { content: "c" } }, text: "t" })).toBe("t");
  });

  it("ignores an empty choices array", () => {
    expect(extractStreamText({ choices: [] })).toBeNull();
  });

  it("ignores a choice with no delta", () => {
    expect(extractStreamText({ choices: [{}] })).toBeNull();
  });

  it("falls back to text last", () => {
    expect(extractStreamText({ text: "t" })).toBe("t");
  });

  it("returns null when the event carries no text", () => {
    expect(extractStreamText({ type: "complete", trace_id: "x" })).toBeNull();
  });
});

describe("reduce: unknown events", () => {
  it("does nothing for a null payload", () => {
    const state = makeState();
    expect(reduce(state, null, makeCtx())).toEqual([]);
    expect(state).toEqual(makeState());
  });

  it("does nothing for an event with no text and no known type", () => {
    const state = makeState();
    expect(reduce(state, { type: "heartbeat" }, makeCtx())).toEqual([]);
    expect(state.messages).toEqual([]);
  });
});

describe("reduce: title", () => {
  it.each(bothPhases)("records the title and animates it when active (%s)", (phase) => {
    const state = makeState();
    const effects = reduce(state, { type: "title", title: "My chat" }, makeCtx({ phase }));
    expect(state.title).toBe("My chat");
    expect(effects).toEqual([{ kind: "animateTitle", title: "My chat" }]);
  });

  it("records the title but does not animate when detached", () => {
    const state = makeState();
    const effects = reduce(
      state,
      { type: "title", title: "Background" },
      makeCtx({ isActive: false }),
    );
    expect(state.title).toBe("Background");
    expect(effects).toEqual([]);
  });
});

describe("reduce: tool_call", () => {
  it("sets the active tool call and scrolls during the stream phase", () => {
    const state = makeState();
    const effects = reduce(
      state,
      { type: "tool_call", tool: "search", message: "Searching", call_id: "c1" },
      makeCtx(),
    );
    expect(state.activeToolCall).toEqual({
      tool: "search",
      message: "Searching",
      context: {},
      call_id: "c1",
    });
    expect(kinds(effects)).toEqual(["finalizeText", "scroll"]);
  });

  it("does not scroll during the tail flush", () => {
    const effects = reduce(
      makeState(),
      { type: "tool_call", tool: "search" },
      makeCtx({ phase: "tailFlush" }),
    );
    expect(kinds(effects)).toEqual(["finalizeText"]);
  });

  it("does not adopt the new tool call when detached", () => {
    const state = makeState();
    const effects = reduce(
      state,
      { type: "tool_call", tool: "search" },
      makeCtx({ isActive: false }),
    );
    expect(state.activeToolCall).toBeNull();
    expect(kinds(effects)).toEqual(["scroll"]);
  });

  it("completes a previous tool call into the last assistant message", () => {
    const msg = assistant();
    const state = makeState({
      messages: [msg],
      activeToolCall: { tool: "old", message: raw("Old"), context: {}, call_id: "c0" },
    });
    reduce(state, { type: "tool_call", tool: "new" }, makeCtx());
    expect(msg.contentBlocks).toEqual([
      { type: "tool_call", tool: "old", message: "Old", context: {}, call_id: "c0" },
    ]);
  });

  it("creates an assistant placeholder when the last message is a user message", () => {
    const state = makeState({
      messages: [{ role: "user", content: raw("hi") }],
      activeToolCall: { tool: "old", message: raw("Old"), context: {} },
    });
    reduce(state, { type: "tool_call", tool: "new" }, makeCtx());
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].role).toBe("assistant");
  });

  it("flushes the pending text segment into the last text block", () => {
    const msg = assistant({ contentBlocks: [{ type: "text", text: "par" }] });
    const state = makeState({ messages: [msg], textSegment: "partial text" });
    const effects = reduce(state, { type: "tool_call", tool: "x" }, makeCtx());
    expect(msg.contentBlocks?.[0]).toEqual({ type: "text", text: "partial text" });
    expect(state.textSegment).toBe("");
    expect(kinds(effects)).toEqual(["finalizeText", "scroll"]);
  });

  it("emits finalizeText even when there is no pending text segment", () => {
    const effects = reduce(makeState(), { type: "tool_call", tool: "x" }, makeCtx());
    expect(kinds(effects)).toContain("finalizeText");
  });

  it("does not emit finalizeText when detached", () => {
    const state = makeState({ textSegment: "abc" });
    const effects = reduce(state, { type: "tool_call", tool: "x" }, makeCtx({ isActive: false }));
    expect(kinds(effects)).toEqual(["scroll"]);
    expect(state.textSegment).toBe("");
  });
});

describe("reduce: complete", () => {
  it.each(bothPhases)("captures the trace id when active (%s)", (phase) => {
    const state = makeState();
    reduce(state, { type: "complete", trace_id: "tr-1" }, makeCtx({ phase }));
    expect(state.lastTraceId).toBe("tr-1");
  });

  it("ignores the trace id when detached", () => {
    const state = makeState();
    reduce(state, { type: "complete", trace_id: "tr-1" }, makeCtx({ isActive: false }));
    expect(state.lastTraceId).toBeNull();
  });

  it("completes an active tool call and clears it", () => {
    const msg = assistant();
    const state = makeState({
      messages: [msg],
      activeToolCall: { tool: "search", message: raw("Searching"), context: {} },
    });
    reduce(state, { type: "complete" }, makeCtx());
    expect(msg.contentBlocks).toHaveLength(1);
    expect(state.activeToolCall).toBeNull();
  });

  // An action-only turn produces no text, so `complete` is its only chance to persist.
  it("saves a turn that finished a tool call without producing any text", () => {
    const state = makeState({
      messages: [assistant()],
      activeToolCall: { tool: "createDashboard", message: raw("Creating"), context: {} },
    });
    expect(reduce(state, { type: "complete" }, makeCtx())).toEqual([
      { kind: "throttledSave", force: true },
    ]);
  });

  it("does not save a turn that already streamed text", () => {
    const state = makeState({ messages: [assistant()], messageComplete: true });
    state.activeToolCall = { tool: "search", message: raw("Searching"), context: {} };
    expect(reduce(state, { type: "complete" }, makeCtx())).toEqual([]);
  });

  it("saves an action-only turn when detached, against the captured messages", () => {
    const state = makeState({
      messages: [assistant()],
      activeToolCall: { tool: "search", message: raw("Searching"), context: {} },
    });
    expect(reduce(state, { type: "complete" }, makeCtx({ isActive: false }))).toEqual([
      { kind: "throttledSave", force: true },
    ]);
  });

  it("does not save a detached turn with no assistant content blocks", () => {
    const state = makeState({ messages: [{ role: "user", content: raw("hi") }] });
    expect(reduce(state, { type: "complete" }, makeCtx({ isActive: false }))).toEqual([]);
  });

  it("keeps the active tool call set when detached", () => {
    const active = { tool: "search", message: raw("Searching"), context: {} };
    const state = makeState({ messages: [assistant()], activeToolCall: active });
    reduce(state, { type: "complete" }, makeCtx({ isActive: false }));
    expect(state.activeToolCall).toBe(active);
  });
});

describe("reduce: error", () => {
  it("flags an unavailable owner and does not halt", () => {
    const state = makeState();
    const effects = reduce(state, { type: "error", code: "session_owner_unavailable" }, makeCtx());
    expect(state.ownerUnavailable).toBe(true);
    expect(state.halted).toBe(false);
    expect(effects).toEqual([]);
    expect(state.messages).toEqual([]);
  });

  it.each(bothPhases)("appends an error message, saves, scrolls and halts (%s)", (phase) => {
    const state = makeState({ textSegment: "leftover" });
    const effects = reduce(state, { type: "error", error: "boom" }, makeCtx({ phase }));
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].contentBlocks?.[0].text).toBe(
      'common.errorPrefix({"message":"boom"})',
    );
    expect(state.textSegment).toBe("");
    expect(state.halted).toBe(true);
    expect(kinds(effects)).toEqual(["syncSegments", "save", "scroll"]);
  });

  it("defers the scroll gate to the shell rather than deciding it when detached", () => {
    const effects = reduce(
      makeState(),
      { type: "error", error: "boom" },
      makeCtx({ isActive: false }),
    );
    expect(effects).toEqual([
      { kind: "syncSegments" },
      { kind: "save" },
      { kind: "scroll", whenActive: true },
    ]);
  });

  it("prefers error over message and falls back to a generic string", () => {
    const withMessage = makeState();
    reduce(withMessage, { type: "error", message: "m" }, makeCtx());
    expect(withMessage.messages[0].contentBlocks?.[0].text).toBe(
      'common.errorPrefix({"message":"m"})',
    );

    const bare = makeState();
    reduce(bare, { type: "error" }, makeCtx());
    expect(bare.messages[0].contentBlocks?.[0].text).toBe(
      'common.errorPrefix({"message":"aiAssistant.aiChat.unexpectedError"})',
    );
  });

  it("stringifies a non-string error payload", () => {
    const state = makeState();
    reduce(state, { type: "error", error: { detail: "x" } }, makeCtx());
    expect(state.messages[0].contentBlocks?.[0].text).toContain('\\"detail\\": \\"x\\"');
  });

  it("appends the suggestion when present", () => {
    const state = makeState();
    reduce(state, { type: "error", error: "boom", suggestion: "retry" }, makeCtx());
    expect(state.messages[0].contentBlocks?.[0].text).toBe(
      'common.errorPrefix({"message":"boom"})\n\nretry',
    );
  });

  it("replaces an auth error with the unauthorized copy and drops the suggestion", () => {
    const state = makeState();
    reduce(state, { type: "error", error: "Unauthorized access", suggestion: "retry" }, makeCtx());
    expect(state.messages[0].contentBlocks?.[0].text).toBe("common.unauthorizedAccess");
  });

  it("appends to an existing assistant message instead of pushing a new one", () => {
    const msg = assistant({ content: raw("earlier"), contentBlocks: [] });
    const state = makeState({ messages: [msg] });
    reduce(state, { type: "error", error: "boom" }, makeCtx());
    expect(state.messages).toHaveLength(1);
    expect(msg.content).toBe('earlier\n\ncommon.errorPrefix({"message":"boom"})');
    expect(msg.contentBlocks).toHaveLength(1);
  });

  it("replaces empty content on an existing assistant message", () => {
    const msg = assistant();
    const state = makeState({ messages: [msg] });
    reduce(state, { type: "error", error: "boom" }, makeCtx());
    expect(msg.content).toBe('common.errorPrefix({"message":"boom"})');
  });

  it("completes an active tool call before reporting the error", () => {
    const msg = assistant();
    const state = makeState({
      messages: [msg],
      activeToolCall: { tool: "search", message: raw("Searching"), context: {} },
    });
    reduce(state, { type: "error", error: "boom" }, makeCtx());
    expect(msg.contentBlocks?.[0].type).toBe("tool_call");
    expect(msg.contentBlocks?.[1].type).toBe("text");
    expect(state.activeToolCall).toBeNull();
  });
});

describe("reduce: tool_result", () => {
  const result = {
    type: "tool_result",
    tool: "search",
    call_id: "c1",
    message: "done",
    summary: { count: 2 },
  };

  it("completes the matching active tool call with the result data", () => {
    const msg = assistant();
    const state = makeState({
      messages: [msg],
      activeToolCall: { tool: "search", message: raw("Searching"), context: {}, call_id: "c1" },
    });
    const effects = reduce(state, result, makeCtx());
    expect(msg.contentBlocks?.[0]).toMatchObject({
      type: "tool_call",
      success: true,
      resultMessage: "done",
      summary: { count: 2 },
    });
    expect(state.activeToolCall).toBeNull();
    expect(kinds(effects)).toEqual(["scroll"]);
  });

  it("matches on tool name when the event carries no call_id", () => {
    const msg = assistant();
    const state = makeState({
      messages: [msg],
      activeToolCall: { tool: "search", message: raw("Searching"), context: {}, call_id: "c1" },
    });
    reduce(state, { type: "tool_result", tool: "search", success: false }, makeCtx());
    expect(msg.contentBlocks?.[0]).toMatchObject({ success: false });
  });

  it("retroactively enriches an already completed block by call_id", () => {
    const msg = assistant({
      contentBlocks: [{ type: "tool_call", tool: "search", call_id: "c1" }],
    });
    const state = makeState({ messages: [msg] });
    reduce(state, result, makeCtx());
    expect(msg.contentBlocks?.[0]).toMatchObject({ resultMessage: "done", success: true });
  });

  it("retroactively enriches the last unresolved block matched by tool name", () => {
    const msg = assistant({
      contentBlocks: [
        { type: "tool_call", tool: "search", success: true },
        { type: "tool_call", tool: "search" },
      ],
    });
    const state = makeState({ messages: [msg] });
    reduce(state, { type: "tool_result", tool: "search", message: "second" }, makeCtx());
    expect(msg.contentBlocks?.[1].resultMessage).toBe("second");
    expect(msg.contentBlocks?.[0].resultMessage).toBeUndefined();
  });

  it("does nothing when no block matches", () => {
    const msg = assistant({ contentBlocks: [{ type: "text", text: "hi" }] });
    const state = makeState({ messages: [msg] });
    reduce(state, result, makeCtx());
    expect(msg.contentBlocks).toEqual([{ type: "text", text: "hi" }]);
  });

  it("attaches a derived navigation action during the stream phase", () => {
    const action: NavigationAction = {
      resource_type: "logs",
      action: "load_query",
      label: raw("View"),
      target: {},
    };
    const generateNavigation = vi.fn(() => action);
    const msg = assistant();
    const state = makeState({
      messages: [msg],
      activeToolCall: { tool: "search", message: raw("S"), context: {}, call_id: "c1" },
    });
    reduce(state, { ...result, call_args: { a: 1 } }, makeCtx({ generateNavigation }));
    expect(generateNavigation).toHaveBeenCalledWith("search", { a: 1 }, expect.anything());
    expect(msg.contentBlocks?.[0].navigationAction).toBe(action);
  });

  it("attaches a derived navigation action to a retroactively enriched block", () => {
    const action = { resource_type: "logs" } as unknown as NavigationAction;
    const msg = assistant({
      contentBlocks: [{ type: "tool_call", tool: "search", call_id: "c1" }],
    });
    const state = makeState({ messages: [msg] });
    reduce(
      state,
      { ...result, call_args: { a: 1 } },
      makeCtx({ generateNavigation: () => action }),
    );
    expect(msg.contentBlocks?.[0].navigationAction).toBe(action);
  });

  it("skips navigation for a failed tool result", () => {
    const generateNavigation = vi.fn(() => null);
    reduce(
      makeState({ messages: [assistant()] }),
      { ...result, success: false, call_args: { a: 1 } },
      makeCtx({ generateNavigation }),
    );
    expect(generateNavigation).not.toHaveBeenCalled();
  });

  it("emits a dashboard event when the tool mutates a dashboard", () => {
    const state = makeState({ messages: [assistant()] });
    const effects = reduce(
      state,
      {
        type: "tool_result",
        tool: "createDashboard",
        call_args: { dashboard_id: "d1", folder: "f1" },
      },
      makeCtx(),
    );
    expect(effects[0]).toEqual({
      kind: "dashboardEvent",
      payload: { type: "dashboard_created", dashboardId: "d1", folderId: "f1" },
    });
  });

  it("reads the dashboard id from nested call_args shapes", () => {
    const effects = reduce(
      makeState({ messages: [assistant()] }),
      {
        type: "tool_result",
        tool: "updatePanel",
        call_args: { request_body: { dashboard_id: "d2", folder: "f2" } },
      },
      makeCtx(),
    );
    expect(effects[0]).toEqual({
      kind: "dashboardEvent",
      payload: { type: "panel_updated", dashboardId: "d2", folderId: "f2" },
    });
  });

  it("warns and skips the dashboard event when no dashboard id can be found", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const effects = reduce(
      makeState({ messages: [assistant()] }),
      { type: "tool_result", tool: "deleteDashboard", call_args: {} },
      makeCtx(),
    );
    expect(warn).toHaveBeenCalled();
    expect(kinds(effects)).toEqual(["scroll"]);
    warn.mockRestore();
  });

  it("emits no dashboard event when detached", () => {
    const effects = reduce(
      makeState({ messages: [assistant()] }),
      { type: "tool_result", tool: "createDashboard", call_args: { dashboard_id: "d1" } },
      makeCtx({ isActive: false }),
    );
    expect(kinds(effects)).toEqual(["scroll"]);
  });

  it("ignores the generic tools_call name for dashboard events", () => {
    const effects = reduce(
      makeState({ messages: [assistant()] }),
      { type: "tool_result", tool: "tools_call", call_args: { dashboard_id: "d1" } },
      makeCtx(),
    );
    expect(kinds(effects)).toEqual(["scroll"]);
  });

  it("CURRENT BEHAVIOR (BUG): the tail flush derives no navigation, no dashboard event and no scroll", () => {
    const generateNavigation = vi.fn(() => ({}) as NavigationAction);
    const msg = assistant();
    const state = makeState({
      messages: [msg],
      activeToolCall: { tool: "createDashboard", message: raw("C"), context: {}, call_id: "c1" },
    });
    const effects = reduce(
      state,
      {
        type: "tool_result",
        tool: "createDashboard",
        call_id: "c1",
        call_args: { dashboard_id: "d1" },
      },
      makeCtx({ phase: "tailFlush", generateNavigation }),
    );
    expect(generateNavigation).not.toHaveBeenCalled();
    expect(msg.contentBlocks?.[0].navigationAction).toBeUndefined();
    expect(effects).toEqual([]);
  });
});

describe("reduce: confirmation_required", () => {
  it("adds an inline confirmation block and scrolls", () => {
    const msg = assistant();
    const state = makeState({ messages: [msg] });
    const effects = reduce(
      state,
      {
        type: "confirmation_required",
        tool: "deleteAlert",
        message: "Confirm?",
        args: { id: 1 },
        call_id: "c9",
      },
      makeCtx(),
    );
    expect(msg.contentBlocks?.[0]).toMatchObject({
      type: "tool_call",
      tool: "deleteAlert",
      pendingConfirmation: true,
      confirmationMessage: "Confirm?",
      confirmationArgs: { id: 1 },
      call_id: "c9",
    });
    expect(state.pendingConfirmation).toEqual({
      tool: "deleteAlert",
      args: { id: 1 },
      message: "Confirm?",
    });
    expect(kinds(effects)).toEqual(["finalizeText", "scroll"]);
  });

  it("borrows the message, context and call_id from the active tool call", () => {
    const msg = assistant();
    const state = makeState({
      messages: [msg],
      activeToolCall: {
        tool: "deleteAlert",
        message: raw("Deleting"),
        context: { x: 1 },
        call_id: "c0",
      },
    });
    reduce(
      state,
      { type: "confirmation_required", tool: "deleteAlert", message: "Confirm?" },
      makeCtx(),
    );
    expect(msg.contentBlocks?.[0]).toMatchObject({
      message: "Deleting",
      context: { x: 1 },
      call_id: "c0",
    });
    expect(state.activeToolCall).toBeNull();
  });

  it("falls back to a translated confirmation prompt when the backend sends no message", () => {
    const state = makeState({ messages: [assistant()] });
    reduce(state, { type: "confirmation_required", tool: "deleteAlert" }, makeCtx());
    expect(state.pendingConfirmation?.message).toBe(
      'aiAssistant.aiChat.confirmToolExecution({"tool":"deleteAlert"})',
    );
  });

  it("starts a new assistant message when the last one is from the user", () => {
    const state = makeState({ messages: [{ role: "user", content: raw("hi") }] });
    reduce(state, { type: "confirmation_required", tool: "x", message: "m" }, makeCtx());
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].contentBlocks?.[0].pendingConfirmation).toBe(true);
  });

  it("auto-denies for a detached stream without touching the messages", () => {
    const state = makeState({ messages: [assistant()], textSegment: "x" });
    const effects = reduce(
      state,
      { type: "confirmation_required", tool: "x", message: "m" },
      makeCtx({ isActive: false }),
    );
    expect(effects).toEqual([{ kind: "confirmPost", approved: false }]);
    expect(state.pendingConfirmation).toBeNull();
  });

  it("auto-approves a navigation confirmation when auto navigation is on", () => {
    const state = makeState({ messages: [assistant()] });
    const effects = reduce(
      state,
      { type: "confirmation_required", tool: "navigation_action", message: "Go" },
      makeCtx({ autoNavigationEnabled: true }),
    );
    expect(effects).toEqual([{ kind: "finalizeText" }, { kind: "confirmPost", approved: true }]);
    expect(state.pendingConfirmation).toBeNull();
  });

  it("still asks for a navigation confirmation when auto navigation is off", () => {
    const state = makeState({ messages: [assistant()] });
    const effects = reduce(
      state,
      { type: "confirmation_required", tool: "navigation_action", message: "Go" },
      makeCtx({ autoNavigationEnabled: false }),
    );
    expect(kinds(effects)).toEqual(["finalizeText", "scroll"]);
    expect(state.pendingConfirmation?.tool).toBe("navigation_action");
  });

  it("CURRENT BEHAVIOR (BUG): the tail flush has no confirmation handler at all", () => {
    const state = makeState({ messages: [assistant()], textSegment: "keep" });
    const effects = reduce(
      state,
      { type: "confirmation_required", tool: "x", message: "m" },
      makeCtx({ phase: "tailFlush" }),
    );
    expect(effects).toEqual([]);
    expect(state.pendingConfirmation).toBeNull();
    expect(state.textSegment).toBe("keep");
  });
});

describe("reduce: navigation_action", () => {
  const event = {
    type: "navigation_action",
    resource_type: "logs",
    action: "load_query",
    label: "View in Logs",
    target: { query: "select 1" },
  };

  it("navigates immediately when auto navigation is on", () => {
    const state = makeState({ messages: [assistant()] });
    const effects = reduce(state, event, makeCtx({ autoNavigationEnabled: true }));
    expect(effects).toEqual([
      { kind: "finalizeText" },
      {
        kind: "navigate",
        action: {
          resource_type: "logs",
          action: "load_query",
          label: "View in Logs",
          target: { query: "select 1" },
        },
      },
    ]);
    expect(state.pendingConfirmation).toBeNull();
  });

  it("asks for confirmation when auto navigation is off", () => {
    const msg = assistant();
    const state = makeState({ messages: [msg] });
    const effects = reduce(state, event, makeCtx());
    expect(msg.contentBlocks?.[0]).toMatchObject({
      tool: "navigation_action",
      message: "View in Logs",
      pendingConfirmation: true,
    });
    expect(state.pendingConfirmation?.navAction?.resource_type).toBe("logs");
    expect(kinds(effects)).toEqual(["finalizeText", "scroll"]);
  });

  it("falls back to a translated prompt when the event has no label", () => {
    const state = makeState({ messages: [assistant()] });
    reduce(state, { ...event, label: undefined }, makeCtx());
    expect(state.pendingConfirmation?.message).toBe("aiAssistant.aiChat.navigateConfirmQuestion");
  });

  it("flushes the text segment but skips navigation when detached", () => {
    const state = makeState({ messages: [assistant()], textSegment: "x" });
    const effects = reduce(state, event, makeCtx({ isActive: false, autoNavigationEnabled: true }));
    expect(effects).toEqual([]);
    expect(state.textSegment).toBe("");
  });

  it("CURRENT BEHAVIOR (BUG): the tail flush has no navigation handler at all", () => {
    const state = makeState({ messages: [assistant()], textSegment: "keep" });
    const effects = reduce(
      state,
      event,
      makeCtx({ phase: "tailFlush", autoNavigationEnabled: true }),
    );
    expect(effects).toEqual([]);
    expect(state.textSegment).toBe("keep");
  });
});

describe("reduce: text", () => {
  it("creates the assistant message and forces a save on the first delta", () => {
    const state = makeState();
    const effects = reduce(state, { type: "message_delta", content: "Hel" }, makeCtx());
    expect(state.messages[0]).toEqual({
      role: "assistant",
      content: "Hel",
      contentBlocks: [{ type: "text", text: "Hel" }],
    });
    expect(state.streamingMsg).toBe("Hel");
    expect(state.messageComplete).toBe(true);
    expect(effects).toEqual([
      { kind: "syncSegments" },
      { kind: "animateText" },
      { kind: "throttledSave", force: true },
      { kind: "scroll", whenActive: true },
    ]);
  });

  it("appends the next delta and throttles the save", () => {
    const state = makeState();
    const ctx = makeCtx();
    reduce(state, { type: "message_delta", content: "Hel" }, ctx);
    const effects = reduce(state, { type: "message_delta", content: "lo" }, ctx);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content).toBe("Hello");
    expect(state.messages[0].contentBlocks?.[0].text).toBe("Hello");
    expect(effects).toEqual([
      { kind: "syncSegments" },
      { kind: "animateText" },
      { kind: "throttledSave", force: false },
      { kind: "scroll", whenActive: true },
    ]);
  });

  it("writes the full accumulated segment into the last text block, not just the delta", () => {
    const state = makeState();
    const ctx = makeCtx();
    reduce(state, { type: "message_delta", content: "abc" }, ctx);
    reduce(state, { type: "message_delta", content: "def" }, ctx);
    expect(state.messages[0].contentBlocks?.[0].text).toBe("abcdef");
    expect(state.textSegment).toBe("abcdef");
  });

  it("starts a new text block after a tool call block", () => {
    const msg = assistant({ contentBlocks: [{ type: "tool_call", tool: "search" }] });
    const state = makeState({ messages: [msg] });
    reduce(state, { type: "message_delta", content: "hi" }, makeCtx());
    expect(msg.contentBlocks).toHaveLength(2);
    expect(msg.contentBlocks?.[1]).toEqual({ type: "text", text: "hi" });
  });

  it("completes an active tool call before appending text", () => {
    const msg = assistant();
    const state = makeState({
      messages: [msg],
      activeToolCall: { tool: "search", message: raw("S"), context: {} },
    });
    reduce(state, { type: "message_delta", content: "hi" }, makeCtx());
    expect(msg.contentBlocks?.[0].type).toBe("tool_call");
    expect(msg.contentBlocks?.[1]).toEqual({ type: "text", text: "hi" });
    expect(state.activeToolCall).toBeNull();
  });

  it("reformats code fences for full messages but not for deltas", () => {
    const full = makeState();
    reduce(full, { type: "message", content: "```js let a = 1```" }, makeCtx());
    expect(full.streamingMsg).toBe("```js\nlet a = 1\n```");

    const delta = makeState();
    reduce(delta, { type: "message_delta", content: "```js let a = 1```" }, makeCtx());
    expect(delta.streamingMsg).toBe("```js let a = 1```");
  });

  it("separates a full message that starts a new segment after a tool call", () => {
    const state = makeState({ streamingMsg: "before", textSegment: "" });
    reduce(state, { type: "message", content: "after" }, makeCtx());
    expect(state.streamingMsg).toBe("before\n\nafter");
    expect(state.textSegment).toBe("after");
  });

  it("separates consecutive full messages inside the same segment", () => {
    const state = makeState({ streamingMsg: "one", textSegment: "one" });
    reduce(state, { type: "message", content: "two" }, makeCtx());
    expect(state.streamingMsg).toBe("one\n\ntwo");
    expect(state.textSegment).toBe("one\n\ntwo");
  });

  it("does not insert a separator when the previous text already ends in a newline", () => {
    const state = makeState({ streamingMsg: "one\n", textSegment: "one\n" });
    reduce(state, { type: "message", content: "two" }, makeCtx());
    expect(state.streamingMsg).toBe("one\ntwo");
  });

  it("does not insert a separator when the new content starts with a newline", () => {
    const state = makeState({ streamingMsg: "one", textSegment: "one" });
    reduce(state, { type: "message", content: "\ntwo" }, makeCtx());
    expect(state.streamingMsg).toBe("one\ntwo");
  });

  it("treats a fallback field as a delta even without the message_delta type", () => {
    const state = makeState({ streamingMsg: "one", textSegment: "one" });
    reduce(state, { type: "message", text: "```js x```" }, makeCtx());
    expect(state.streamingMsg).toBe("one```js x```");
  });

  it("does not animate when detached and leaves the scroll gate to the shell", () => {
    const state = makeState();
    const effects = reduce(
      state,
      { type: "message_delta", content: "hi" },
      makeCtx({ isActive: false }),
    );
    expect(effects).toEqual([
      { kind: "syncSegments" },
      { kind: "throttledSave", force: true },
      { kind: "scroll", whenActive: true },
    ]);
    expect(state.messages).toHaveLength(1);
  });

  it("CURRENT BEHAVIOR (BUG): the tail flush never scrolls", () => {
    const effects = reduce(
      makeState(),
      { type: "message_delta", content: "hi" },
      makeCtx({ phase: "tailFlush" }),
    );
    expect(effects).toEqual([
      { kind: "syncSegments" },
      { kind: "animateText" },
      { kind: "throttledSave", force: true },
    ]);
  });
});

describe("reduce: live-gated effects", () => {
  it("marks every isActive-gated scroll whenActive, so the shell re-reads isActive after its awaits", () => {
    const events: any[] = [
      { type: "tool_call", tool: "x" },
      { type: "error", error: "boom" },
      { type: "tool_result", tool: "search" },
      { type: "message_delta", content: "hi" },
    ];
    for (const event of events) {
      const effects = reduce(makeState({ messages: [assistant()] }), event, makeCtx());
      const scroll = effects.find((e) => e.kind === "scroll");
      expect(scroll).toEqual({ kind: "scroll", whenActive: true });
    }
  });

  it("leaves the two unconditional scrolls unconditional", () => {
    for (const event of [
      { type: "confirmation_required", tool: "x", message: "m" },
      { type: "navigation_action", label: "Go", target: {} },
    ]) {
      const effects = reduce(makeState({ messages: [assistant()] }), event, makeCtx());
      expect(effects.find((e) => e.kind === "scroll")).toEqual({ kind: "scroll" });
    }
  });
});

describe("reduce: segment-ref syncing", () => {
  const nonTextEvents: any[] = [
    { type: "title", title: "T" },
    { type: "complete", trace_id: "tr" },
    { type: "tool_result", tool: "search", message: "done" },
    { type: "confirmation_required", tool: "x", message: "m" },
    { type: "navigation_action", label: "Go", target: {} },
  ];

  it.each(nonTextEvents)("leaves the segment refs alone for %o", (event) => {
    const effects = reduce(makeState({ messages: [assistant()] }), event, makeCtx());
    expect(kinds(effects)).not.toContain("syncSegments");
  });

  it("syncs only via finalizeText on tool_call, as localFinalizeTextBlock did", () => {
    const effects = reduce(makeState(), { type: "tool_call", tool: "x" }, makeCtx());
    expect(kinds(effects)).toEqual(["finalizeText", "scroll"]);
  });

  it("emits no sync at all on tool_call when detached", () => {
    const effects = reduce(
      makeState(),
      { type: "tool_call", tool: "x" },
      makeCtx({ isActive: false }),
    );
    expect(kinds(effects)).not.toContain("finalizeText");
    expect(kinds(effects)).not.toContain("syncSegments");
  });

  it("syncs before the save and before the scroll on the error path", () => {
    const order = kinds(reduce(makeState(), { type: "error", error: "boom" }, makeCtx()));
    expect(order.indexOf("syncSegments")).toBeLessThan(order.indexOf("save"));
    expect(order.indexOf("syncSegments")).toBeLessThan(order.indexOf("scroll"));
  });

  it("syncs first on the text path, before the animation and the save", () => {
    const order = kinds(reduce(makeState(), { type: "message_delta", content: "hi" }, makeCtx()));
    expect(order[0]).toBe("syncSegments");
    expect(order.indexOf("syncSegments")).toBeLessThan(order.indexOf("animateText"));
    expect(order.indexOf("syncSegments")).toBeLessThan(order.indexOf("throttledSave"));
  });

  it("re-attach window: a tool_result after a finalized segment must not re-sync", () => {
    const msg = assistant({ contentBlocks: [{ type: "text", text: "Found 3 errors" }] });
    const state = makeState({ messages: [msg], textSegment: "Found 3 errors" });
    const ctx = makeCtx();
    reduce(state, { type: "tool_call", tool: "search", call_id: "c1" }, ctx);
    expect(state.textSegment).toBe("");
    const effects = reduce(
      state,
      { type: "tool_result", tool: "search", call_id: "c1", message: "done" },
      ctx,
    );
    expect(kinds(effects)).not.toContain("syncSegments");
    expect(msg.contentBlocks?.[0]).toEqual({ type: "text", text: "Found 3 errors" });
  });
});

describe("reduce: state identity", () => {
  let state: StreamState;

  beforeEach(() => {
    state = makeState();
  });

  it("mutates the captured messages array in place so detached streams keep writing to it", () => {
    const messages: ChatMessage[] = [];
    state = makeState({ messages });
    reduce(state, { type: "message_delta", content: "hi" }, makeCtx({ isActive: false }));
    expect(state.messages).toBe(messages);
    expect(messages).toHaveLength(1);
  });
});

describe("reduce: typed phases (live)", () => {
  const live = () => makeCtx({ phase: "live", isActive: false });
  const blocksOf = (state: StreamState) =>
    state.messages[state.messages.length - 1].contentBlocks ?? [];

  it("appends a running step at once and settles it in place by call id (HT-05)", () => {
    const state = makeState();
    reduce(state, { type: "tool_call", tool: "SearchSQL", call_id: "c1", context: {} }, live());
    expect(blocksOf(state)).toEqual([
      expect.objectContaining({ type: "tool_call", call_id: "c1", stepState: "running" }),
    ]);
    reduce(
      state,
      { type: "tool_result", tool: "SearchSQL", call_id: "c1", summary: "4 rows" },
      live(),
    );
    expect(blocksOf(state)).toEqual([
      expect.objectContaining({
        call_id: "c1",
        stepState: "done",
        success: true,
        summary: "4 rows",
      }),
    ]);
    expect(state.activeToolCall).toBeNull();
  });

  it("marks a failed result failed and counts it", () => {
    const state = makeState();
    reduce(state, { type: "tool_call", tool: "SearchSQL", call_id: "c1" }, live());
    reduce(
      state,
      {
        type: "tool_result",
        tool: "SearchSQL",
        call_id: "c1",
        success: false,
        error_type: "query_error",
      },
      live(),
    );
    expect(blocksOf(state)[0]).toMatchObject({
      stepState: "failed",
      success: false,
      errorType: "query_error",
    });
    expect(state.extras).toMatchObject({ toolCalls: 1, toolErrors: 1 });
  });

  it("keeps a result for a call it never saw as a done step (HT-05 edge)", () => {
    const state = makeState({ messages: [assistant()] });
    reduce(state, { type: "tool_result", tool: "StreamList", call_id: "c7" }, live());
    expect(blocksOf(state)).toEqual([
      expect.objectContaining({ tool: "StreamList", call_id: "c7", stepState: "done" }),
    ]);
  });

  it("interrupts a running step on an error, never a green check (HT-05 AC 3)", () => {
    const state = makeState();
    reduce(state, { type: "tool_call", tool: "SearchSQL", call_id: "c1" }, live());
    const effects = reduce(
      state,
      { type: "error", error_type: "llm_overload", message: "busy" },
      live(),
    );
    expect(blocksOf(state)[0].stepState).toBe("interrupted");
    expect(blocksOf(state).some((b) => b.type === "text")).toBe(false);
    expect(state.halted).toBe(true);
    expect(kinds(effects)).toEqual([]);
  });

  it.each([
    ["complete", { type: "complete" }],
    ["cancelled", { type: "cancelled" }],
  ])("interrupts a step still running at %s", (_name, frame) => {
    const state = makeState();
    reduce(state, { type: "tool_call", tool: "SearchSQL", call_id: "c1" }, live());
    reduce(state, frame, live());
    expect(blocksOf(state)[0].stepState).toBe("interrupted");
  });

  it("interruptSteps marks only the running ones", () => {
    const state = makeState();
    reduce(state, { type: "tool_call", tool: "A", call_id: "a" }, live());
    reduce(state, { type: "tool_result", tool: "A", call_id: "a" }, live());
    reduce(state, { type: "tool_call", tool: "B", call_id: "b" }, live());
    interruptSteps(state);
    expect(blocksOf(state).map((b) => b.stepState)).toEqual(["done", "interrupted"]);
    expect(answerProgress(state)).toEqual({ steps: 2, partial: false });
  });

  it("flips O2AIChat.stream.spec.ts:653: text before a trailing tool_call is kept", () => {
    const state = makeState();
    reduce(state, { type: "message_delta", content: "let me check" }, live());
    reduce(state, { type: "tool_call", tool: "A", call_id: "c1" }, live());
    reduce(state, { type: "complete" }, live());
    expect(blocksOf(state)[0]).toEqual({ type: "text", text: "let me check" });
    expect(state.messages[0].content).toBe("let me check");
    expect(answerProgress(state).partial).toBe(true);
  });

  it("flips O2AIChat.stream.spec.ts:1723: a turn no container shows still records its steps", () => {
    const state = makeState();
    reduce(
      state,
      { type: "tool_call", tool: "SearchLogs", call_id: "c1" },
      makeCtx({ phase: "live", isActive: false }),
    );
    expect(blocksOf(state)).toHaveLength(1);
  });

  it("keeps text, step, text order across a tool call", () => {
    const state = makeState();
    reduce(state, { type: "message_delta", content: "before" }, live());
    reduce(state, { type: "tool_call", tool: "A", call_id: "c1" }, live());
    reduce(state, { type: "message_delta", content: "after" }, live());
    expect(blocksOf(state).map((b) => b.type)).toEqual(["text", "tool_call", "text"]);
    expect(blocksOf(state)[2].text).toBe("after");
  });

  it("never writes an error into the answer and flags the owner race by code or category (BE D7)", () => {
    for (const frame of [
      { type: "error", code: "session_owner_unavailable" },
      { type: "error", category: "session_owner_unavailable", message: "moved" },
    ]) {
      const state = makeState();
      expect(reduce(state, frame, live())).toEqual([]);
      expect(state.ownerUnavailable).toBe(true);
      expect(state.messages).toEqual([]);
    }
  });

  it("leaves the answer alone on persistence_failed (constraint 14)", () => {
    const state = makeState();
    reduce(state, { type: "message_delta", content: "answer" }, live());
    expect(reduce(state, { type: "error", code: "persistence_failed" }, live())).toEqual([]);
    expect(state.halted).toBe(false);
  });

  it("keeps usage, compacted and the trace id of complete (HT-07 AC 8)", () => {
    const state = makeState();
    reduce(state, { type: "message_delta", content: "a" }, live());
    reduce(
      state,
      {
        type: "complete",
        compacted: true,
        persisted: false,
        trace_id: "tr1",
        usage: { input_tokens: 5, output_tokens: 2 },
      },
      live(),
    );
    expect(state.lastTraceId).toBe("tr1");
    expect(state.extras).toMatchObject({
      compacted: true,
      usage: { input_tokens: 5, output_tokens: 2 },
    });
  });

  it("records the step and lifecycle frames without touching the transcript", () => {
    const state = makeState();
    const frames = [
      { type: "turn_started", turn_id: "srv-1", trace_id: "tr-0" },
      { type: "step", kind: "query", label: "query_logs", params: { stream: "default" } },
      { type: "retrying", attempt: 2 },
      { type: "compacting" },
      { type: "usage", usage: { input_tokens: 9 } },
      { type: "resource_changed", resource_type: "alert", op: "update" },
      { type: "status", message: "thinking" },
    ];
    for (const frame of frames) expect(reduce(state, frame, live())).toEqual([]);
    // Only the change made without a card shows, as its one quiet notice.
    expect(blocksOf(state)).toEqual([
      {
        type: "policy",
        policy: { kind: "unreviewed", resourceType: "alert", count: 1, tools: 0, frames: 1 },
      },
    ]);
    expect(state.extras).toMatchObject({
      serverTurnId: "srv-1",
      traceId: "tr-0",
      usage: { input_tokens: 9 },
    });
  });

  it("fails a denied tool step by policy, data level apart (B-02, A-01)", () => {
    const state = makeState();
    reduce(state, { type: "tool_call", tool: "o2_UpdateAlert", call_id: "c1" }, live());
    reduce(
      state,
      { type: "permission_denied", tool: "o2_UpdateAlert", policy: "permission_tier" },
      live(),
    );
    reduce(
      state,
      { type: "permission_denied", tool: "SearchSQL", policy: "data_sharing_level" },
      live(),
    );
    expect(blocksOf(state).map((b) => [b.stepState, b.errorType])).toEqual([
      ["failed", "permission_denied_tool"],
      ["failed", "data_level_blocked"],
    ]);
  });

  it("resolves a pending confirmation from confirmation_resolved (B-04)", () => {
    const state = makeState();
    reduce(
      state,
      { type: "confirmation_required", tool: "o2_delete", call_id: "c9", message: "Delete?" },
      live(),
    );
    reduce(state, { type: "confirmation_resolved", id: "c9", approved: false }, live());
    expect(blocksOf(state)).toEqual([
      expect.objectContaining({
        type: "approval",
        approval: expect.objectContaining({ id: "c9" }),
      }),
      { type: "approval_result", resolved: { id: "c9", approved: false } },
    ]);
  });

  it("keeps the expired and withdrawn flags of a confirmation_resolved", () => {
    const state = makeState();
    reduce(
      state,
      { type: "confirmation_resolved", id: "c1", approved: false, expired: true },
      live(),
    );
    reduce(
      state,
      { type: "confirmation_resolved", id: "c2", approved: false, withdrawn: true },
      live(),
    );
    expect(blocksOf(state).map((block) => block.resolved)).toEqual([
      { id: "c1", approved: false, expired: true },
      { id: "c2", approved: false, withdrawn: true },
    ]);
  });

  it("keeps a navigation frame the legacy tail flush drops, as a link card and never a prompt", () => {
    for (const phase of ["live", "replay"] as const) {
      const state = makeState({ messages: [assistant()] });
      reduce(
        state,
        {
          type: "navigation_action",
          resource_type: "logs",
          action: "load_query",
          label: "Click me",
          target: { stream: "default", path: "/web/logout" },
        },
        makeCtx({ phase }),
      );
      expect(blocksOf(state)).toEqual([
        {
          type: "link",
          link: { resourceType: "logs", action: "load_query", target: { stream: "default" } },
        },
      ]);
      expect(state.pendingConfirmation).toBeNull();
    }
  });

  it("names a replayed failure by its code, never its server text", () => {
    const state = makeState();
    reduce(state, { type: "message_delta", content: "partial" }, makeCtx({ phase: "replay" }));
    reduce(
      state,
      { type: "error", error_type: "llm_overload", message: "raw server text" },
      makeCtx({ phase: "replay" }),
    );
    expect(blocksOf(state)[1]).toEqual({ type: "error", errorType: "provider_error" });
  });

  it("drops the animate, dashboard and segment effects the shell used to run", () => {
    const state = makeState();
    const effects = [
      ...reduce(state, { type: "title", title: "T" }, live()),
      ...reduce(state, { type: "message_delta", content: "a" }, live()),
      ...reduce(state, { type: "tool_call", tool: "updateDashboard", call_id: "c1" }, live()),
      ...reduce(
        state,
        {
          type: "tool_result",
          tool: "updateDashboard",
          call_id: "c1",
          call_args: { dashboard_id: "d" },
        },
        live(),
      ),
    ];
    expect(kinds(effects)).not.toContain("dashboardEvent");
    expect(state.title).toBe("T");
  });

  it("keeps the legacy phases byte-identical: stream still pushes on result, not on call", () => {
    const state = makeState({ messages: [assistant()] });
    reduce(state, { type: "tool_call", tool: "A", call_id: "c1" }, makeCtx());
    expect(state.messages[0].contentBlocks).toEqual([]);
    expect(state.extras).toBeUndefined();
  });
});

describe("reduce: evidence on the typed phases", () => {
  const live = () => makeCtx({ phase: "live", isActive: false });
  const blocksOf = (state: StreamState) =>
    state.messages[state.messages.length - 1]?.contentBlocks ?? [];

  it("honours a step frame's top-level call_id and state, and merges its tool_call into the same row", () => {
    const state = makeState();
    reduce(state, { type: "step", kind: "tool", label: "SearchSQL", call_id: "c1" }, live());
    reduce(
      state,
      { type: "tool_call", tool: "SearchSQL", call_id: "c1", context: { sql: "x" } },
      live(),
    );
    expect(blocksOf(state)).toHaveLength(1);
    expect(blocksOf(state)[0]).toMatchObject({ tool: "SearchSQL", stepState: "running" });
    reduce(
      state,
      {
        type: "step",
        kind: "tool",
        label: "SearchSQL",
        params: { call_id: "c1" },
        state: "interrupted",
      },
      live(),
    );
    expect(blocksOf(state)[0].stepState).toBe("interrupted");
  });

  it("never turns a step that already ended back to running", () => {
    const state = makeState();
    reduce(state, { type: "tool_call", tool: "A", call_id: "c1" }, live());
    reduce(state, { type: "tool_result", tool: "A", call_id: "c1", success: true }, live());
    reduce(
      state,
      { type: "step", kind: "tool", label: "A", call_id: "c1", state: "running" },
      live(),
    );
    expect(blocksOf(state)[0].stepState).toBe("done");
  });

  it("keeps a tool result's call args, typed query and first rows, bounded", () => {
    const state = makeState();
    reduce(state, { type: "tool_call", tool: "SearchSQL", call_id: "c1" }, live());
    reduce(
      state,
      {
        type: "tool_result",
        tool: "SearchSQL",
        call_id: "c1",
        success: true,
        call_args: {
          sql: "SELECT 1",
          stream_name: "default",
          start_time: 1,
          end_time: 2,
          secret: "x",
        },
        query: { language: "sql", text: "SELECT 1", stream: "default" },
        response: { hits: Array.from({ length: 50 }, (_, i) => ({ i })), total: 50 },
      },
      live(),
    );
    const block = blocksOf(state)[0];
    expect(block.callArgs).toEqual({
      stream_name: "default",
      sql: "SELECT 1",
      start_time: 1,
      end_time: 2,
    });
    expect(block.query).toMatchObject({ text: "SELECT 1", callId: "c1" });
    expect(block.result?.hits).toHaveLength(10);
    expect(block).not.toHaveProperty("response");
  });

  it("adds a query block for a query frame, a findings block for a findings frame and a footer with the trace at complete", () => {
    const state = makeState();
    reduce(
      state,
      { type: "query", language: "promql", text: "up", time_range: { from: 1, to: 2 } },
      live(),
    );
    reduce(
      state,
      {
        type: "findings",
        likely_cause: "x",
        confidence: "low",
        evidence: [],
        ruled_out: [],
        unknowns: [],
        next_steps: [],
      },
      live(),
    );
    reduce(state, { type: "usage", usage: { total_tokens: 10, llm_calls: 2 } }, live());
    reduce(
      state,
      { type: "complete", trace_id: "tr-1", persisted: false, context_used: ["stream"] },
      live(),
    );
    expect(blocksOf(state).map((block) => block.type)).toEqual(["query", "findings", "footer"]);
    expect(blocksOf(state)[0].query).toMatchObject({ language: "promql", from: 1, to: 2 });
    expect(blocksOf(state)[2].footer).toEqual({
      traceId: "tr-1",
      usage: { totalTokens: 10, llmCalls: 2 },
      contextUsed: ["stream"],
      persisted: false,
    });
  });

  it("reads o2-ai's context_used entries into the footer's used keys", () => {
    const state = makeState();
    reduce(state, { type: "message_delta", content: "Done." }, live());
    reduce(
      state,
      {
        type: "complete",
        context_used: [
          { key: "stream", used: true },
          { key: "query", used: false, reason: "empty" },
        ],
      },
      live(),
    );
    expect(blocksOf(state).at(-1)?.footer?.contextUsed).toEqual(["stream"]);
  });

  it("keeps the trace of turn_started when complete carries none", () => {
    const state = makeState();
    reduce(state, { type: "turn_started", turn_id: "s", trace_id: "tr-0" }, live());
    reduce(state, { type: "message_delta", content: "x" }, live());
    reduce(state, { type: "complete" }, live());
    expect(blocksOf(state).at(-1)?.footer?.traceId).toBe("tr-0");
    expect(blocksOf(state).at(-1)?.footer?.serverTurnId).toBe("s");
  });

  it("shows a policy-denied tool as one row after its step frame already failed it", () => {
    const state = makeState();
    reduce(state, { type: "tool_call", tool: "o2_UpdateAlert", call_id: "call_9" }, live());
    reduce(
      state,
      { type: "step", kind: "tool", label: "o2_UpdateAlert", call_id: "call_9", state: "failed" },
      live(),
    );
    reduce(
      state,
      { type: "permission_denied", tool: "o2_UpdateAlert", policy: "permission_tier" },
      live(),
    );
    const rows = blocksOf(state).filter((block) => block.type === "tool_call");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ call_id: "call_9", errorType: "permission_denied_tool" });
  });

  it("caps an answer at 200 steps and 50 evidence blocks, and bounds ids", () => {
    const state = makeState();
    for (let i = 0; i < 230; i++)
      reduce(state, { type: "tool_call", tool: "T", call_id: `c${i}` }, live());
    for (let i = 0; i < 70; i++)
      reduce(state, { type: "query", language: "sql", text: `SELECT ${i}` }, live());
    reduce(state, { type: "tool_call", tool: "T".repeat(500), call_id: "x".repeat(500) }, live());
    const blocks = blocksOf(state);
    expect(blocks.filter((block) => block.type === "tool_call")).toHaveLength(200);
    expect(blocks.filter((block) => block.type === "query")).toHaveLength(50);
    for (const block of blocks) {
      expect((block.call_id ?? "").length).toBeLessThanOrEqual(64);
      expect((block.tool ?? "").length).toBeLessThanOrEqual(100);
    }
  });

  it("caps policy denials like steps and keeps one level of a link's nested query", () => {
    const state = makeState();
    for (let i = 0; i < 230; i++)
      reduce(
        state,
        { type: "permission_denied", tool: `T${i}`.padEnd(500, "x"), policy: "permission_tier" },
        live(),
      );
    const rows = blocksOf(state).filter((block) => block.type === "tool_call");
    expect(rows).toHaveLength(200);
    expect(rows.every((row) => (row.tool ?? "").length <= 100)).toBe(true);
    reduce(
      state,
      {
        type: "navigation_action",
        resource_type: "alert",
        action: "navigate_direct",
        target: { alert_id: "a1", query: { folder: "f", query: { query: { deep: "x" } } } },
      },
      live(),
    );
    const link = blocksOf(state).find((block) => block.type === "link");
    expect(link?.link?.target.query).toEqual({ folder: "f" });
  });
});

describe("reduce: approval cards", () => {
  const live = () => makeCtx({ phase: "live", isActive: false });
  const replay = () => makeCtx({ phase: "replay", isActive: false });
  const blocksOf = (state: StreamState) => state.messages.at(-1)?.contentBlocks ?? [];

  it("turns today's delete batch into a typed delete card, its targets from the items", () => {
    expect(
      approvalOf({
        type: "confirmation_required",
        tool: "o2_delete",
        message: "Delete?",
        args: {
          items: [{ resource_type: "Alert", name: "checkout-latency-old", id: "2Yx9alert" }],
        },
      }),
    ).toMatchObject({
      id: "",
      kind: "delete",
      destructive: true,
      editable: false,
      grantable: false,
      typed: false,
      question: "Delete?",
      targets: [{ type: "alert", id: "2Yx9alert", name: "checkout-latency-old" }],
    });
  });

  it("takes the kind from the wire, a CLI command or the fallback, never from a tool-name prefix", () => {
    expect(approvalOf({ tool: "DeleteStream" }).kind).toBe("permission");
    expect(approvalOf({ tool: "acme", args: { command: "deploy" } }).kind).toBe("run_command");
    expect(approvalOf({ tool: "o2_UpdateAlert", kind: "update", targets: [] }).kind).toBe("update");
    expect(approvalOf({ tool: "bash", kind: "opencode_permission" }).kind).toBe("permission");
  });

  it("never grants scope on a destructive card, and caps what the model sent", () => {
    const card = approvalOf({
      tool: "o2_delete",
      kind: "delete",
      grantable: true,
      impact: Array.from({ length: 40 }, () => "x".repeat(500)),
      message: "q".repeat(5_000),
    });
    expect(card.grantable).toBe(false);
    expect(card.impact).toHaveLength(20);
    expect(card.impact?.[0]).toHaveLength(300);
    expect(card.question).toHaveLength(2_000);
  });

  it("appends the card's block once and hands the frame to the approvals runtime in a live turn", () => {
    const state = makeState();
    const frame = { type: "confirmation_required", tool: "o2_delete", call_id: "c9" };
    const effects = reduce(state, frame, live());
    reduce(state, frame, live());
    expect(blocksOf(state).filter((block) => block.type === "approval")).toHaveLength(1);
    expect(effects).toContainEqual({ kind: "approval", frame });
  });

  it("numbers an untyped card within its own turn, so the history fold gives the same id, record and Undo", () => {
    const batch = (name: string) => ({
      type: "confirmation_required",
      tool: "o2_delete",
      args: { items: [{ resource_type: "alert", name }] },
    });
    const state = makeState();
    const turn = (turnId: string, text: string) =>
      state.messages.push(
        { role: "user", content: raw(text), turnId },
        { role: "assistant", content: raw(""), contentBlocks: [], turnId },
      );
    turn("t1", "q1");
    const first = reduce(state, batch("a"), live());
    turn("t2", "q2");
    reduce(state, { type: "message_delta", content: "Two of them." }, live());
    reduce(state, batch("b"), live());
    reduce(state, { type: "message_delta", content: "And one more." }, live());
    reduce(state, batch("c"), live());
    const idsOf = (messages: ChatMessage[]) =>
      messages.flatMap((m) =>
        (m.contentBlocks ?? []).flatMap((block) => (block.approval ? [block.approval.id] : [])),
      );
    expect(idsOf(state.messages)).toEqual(["t1:1", "t2:1", "t2:2"]);
    expect(first).toContainEqual({ kind: "approval", frame: { ...batch("a"), id: "t1:1" } });
    const folded = foldTurns(
      [
        { turn_id: "t1", user: { text: "q1" }, frames: [batch("a")], status: "completed" },
        {
          turn_id: "t2",
          user: { text: "q2" },
          frames: [
            { type: "message_delta", content: "Two of them." },
            batch("b"),
            { type: "message_delta", content: "And one more." },
            batch("c"),
          ],
          status: "completed",
        },
      ] as never,
      t,
      "owner",
      "replay",
    ).messages;
    expect(idsOf(folded)).toEqual(idsOf(state.messages));
    const session = {
      annotations: {
        "approval:t2:2": { approvalOutcome: { state: "done" as const, at: 1 } },
      },
      ledger: [{ id: "led-1", approvalId: "t2:2" }],
    };
    const replayed = idsOf(folded)[2];
    expect(approvalOutcomeOf(session, replayed).outcome?.state).toBe("done");
    expect(session.ledger.filter((entry) => entry.approvalId === replayed)).toHaveLength(1);
    expect(approvalOf({ tool: "bash", approval_id: "ap-1" }).id).toBe("ap-1");
  });

  it("takes a frame redelivered right after its own card as that card, not a second one", () => {
    const state = makeState({
      messages: [{ role: "assistant", content: raw(""), contentBlocks: [], turnId: "t1" }],
    });
    const frame = {
      type: "confirmation_required",
      tool: "o2_delete",
      args: { items: [{ resource_type: "alert", name: "a" }] },
    };
    reduce(state, frame, live());
    const held = makeCtx({ phase: "live", isActive: false, pendingApprovalId: "t1:1" });
    const again = reduce(state, frame, held);
    expect(blocksOf(state).filter((block) => block.type === "approval")).toHaveLength(1);
    expect(again.some((effect) => effect.kind === "approval")).toBe(false);
  });

  it("takes the same frame after the card was decided as a new card asked again", () => {
    const state = makeState({
      messages: [{ role: "assistant", content: raw(""), contentBlocks: [], turnId: "t1" }],
    });
    const frame = {
      type: "confirmation_required",
      tool: "bash",
      message: "Run ls?",
      args: { command: "ls" },
    };
    reduce(state, frame, live());
    const asked = reduce(
      state,
      frame,
      makeCtx({ phase: "live", isActive: false, pendingApprovalId: null }),
    );
    const ids = blocksOf(state).flatMap((block) => (block.approval ? [block.approval.id] : []));
    expect(ids).toEqual(["t1:1", "t1:2"]);
    expect(asked).toContainEqual({ kind: "approval", frame: { ...frame, id: "t1:2" } });
  });

  it("counts every item the server acts on, named or not, and edits only a batch it fully lists", () => {
    const items = [
      ...Array.from({ length: 250 }, (_, i) => ({
        resource_type: "alert",
        name: `a${i}`,
        id: `${i}`,
      })),
      { resource_type: "alert", id: "nameless" },
    ];
    const card = approvalOf({ tool: "o2_delete", args: { items } });
    expect(card.targets).toHaveLength(200);
    expect(card.total).toBe(251);
    expect(card.editable).toBe(false);
    expect(approvalOf({ tool: "o2_delete", args: { items: items.slice(0, 3) } })).toMatchObject({
      editable: true,
    });
    expect(
      approvalOf({
        tool: "o2_UpdateAlert",
        kind: "update",
        editable: true,
        targets: [{ name: "x" }],
      }).editable,
    ).toBe(false);
  });

  it("only lets the wire make a card more careful, and parses no prototype from it", () => {
    expect(
      approvalOf({ tool: "o2_delete", kind: "delete", destructive: false, grantable: true }),
    ).toMatchObject({ destructive: true, grantable: false });
    expect(approvalOf({ tool: "x", kind: "update", destructive: true }).destructive).toBe(true);
    const frame = JSON.parse(
      '{"tool":"o2_UpdateAlert","kind":"update","before":{"__proto__":{"enabled":true}},"after":{"enabled":true}}',
    );
    const before = approvalOf(frame).before as Record<string, unknown>;
    expect(Object.getPrototypeOf(before)).toBe(Object.prototype);
    expect(before.enabled).toBeUndefined();
  });

  it("puts a CLI command on the card, ending in an ellipsis when it was cut", () => {
    expect(approvalOf({ tool: "acme", args: { command: "kubectl get pods" } }).command).toBe(
      "kubectl get pods",
    );
    const long = approvalOf({ tool: "acme", args: { command: "x".repeat(3_000) } }).command;
    expect(long).toHaveLength(2_001);
    expect(long?.endsWith("…")).toBe(true);
  });

  it("replays a card as its record only: no runtime effect", () => {
    const state = makeState();
    const effects = reduce(state, { type: "confirmation_required", tool: "o2_delete" }, replay());
    expect(effects.some((effect) => effect.kind === "approval")).toBe(false);
    expect(blocksOf(state)[0]?.type).toBe("approval");
  });

  it("surfaces a mutating tool that ran with no card before it, and merges more of its kind", () => {
    const state = makeState();
    for (const id of ["c1", "c2"]) {
      reduce(state, { type: "tool_call", tool: "o2_UpdateDashboards", call_id: id }, live());
      reduce(state, { type: "tool_result", tool: "o2_UpdateDashboards", call_id: id }, live());
    }
    expect(blocksOf(state).filter((block) => block.type === "policy")).toEqual([
      {
        type: "policy",
        policy: { kind: "unreviewed", resourceType: "dashboard", count: 2, tools: 2, frames: 0 },
      },
    ]);
  });

  it("counts a tool result and its typed resource_changed as one change", () => {
    const state = makeState();
    reduce(state, { type: "tool_call", tool: "o2_UpdateAlert", call_id: "c1" }, live());
    reduce(state, { type: "tool_result", tool: "o2_UpdateAlert", call_id: "c1" }, live());
    reduce(
      state,
      { type: "resource_changed", resource_type: "alert", id: "a1", op: "update" },
      live(),
    );
    expect(blocksOf(state).find((block) => block.type === "policy")?.policy).toMatchObject({
      count: 1,
      resourceId: "a1",
    });
  });

  it("says nothing of a change the answer already asked about", () => {
    const state = makeState();
    reduce(state, { type: "confirmation_required", tool: "o2_delete" }, live());
    reduce(state, { type: "resource_changed", resource_type: "alert", op: "delete" }, live());
    expect(blocksOf(state).some((block) => block.type === "policy")).toBe(false);
  });

  it("keeps the server's detail on a denied step for its notice", () => {
    const state = makeState();
    reduce(
      state,
      {
        type: "permission_denied",
        tool: "o2_UpdateAlert",
        policy: "admin",
        detail: "Writes are off.",
      },
      live(),
    );
    expect(blocksOf(state)[0]).toMatchObject({
      errorType: "permission_denied_tool",
      details: { detail: "Writes are off.", policy: "admin" },
    });
  });
});
