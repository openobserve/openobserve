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
  extractStreamText,
  reduce,
  type ReducerCtx,
  type StreamEffect,
  type StreamPhase,
  type StreamState,
} from "@/components/O2AIChat.reducer";
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
    expect(reduce(state, { type: "complete" }, makeCtx())).toEqual([]);
    expect(msg.contentBlocks).toHaveLength(1);
    expect(state.activeToolCall).toBeNull();
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
