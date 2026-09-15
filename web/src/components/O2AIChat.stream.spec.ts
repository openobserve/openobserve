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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

// ── Module mocks (hoisted) ───────────────────────────────────────────────────

// `marked` is deliberately NOT mocked: processTextBlock/processMessageContent
// run it for real, so rendered DOM is a usable assertion surface here.

const mockSaveToHistory = vi.fn().mockResolvedValue(42);
const mockLoadHistory = vi.fn().mockResolvedValue([]);
const mockLoadChat = vi.fn().mockResolvedValue(null);
const mockDeleteChatById = vi.fn().mockResolvedValue(true);
const mockClearAllHistory = vi.fn().mockResolvedValue(true);
const mockUpdateChatTitle = vi.fn().mockResolvedValue(true);

vi.mock("@/composables/useChatHistory", () => ({
  useChatHistory: vi.fn(() => ({
    saveToHistory: mockSaveToHistory,
    loadHistory: mockLoadHistory,
    loadChat: mockLoadChat,
    deleteChatById: mockDeleteChatById,
    clearAllHistory: mockClearAllHistory,
    updateChatTitle: mockUpdateChatTitle,
  })),
}));

// vi.hoisted, not a plain const: O2AIChat.vue destructures useAiChat() at module
// scope, so the factory runs during import.
const { mockFetchAiChat, mockSubmitFeedback, mockRouterPush, uuidSeq } = vi.hoisted(() => ({
  mockFetchAiChat: vi.fn(),
  mockSubmitFeedback: vi.fn().mockResolvedValue(true),
  mockRouterPush: vi.fn().mockResolvedValue(undefined),
  // A constant uuid makes every session-identity assertion vacuous: a new
  // session would get the same id as the one it replaced.
  uuidSeq: { n: 0 },
}));

vi.mock("@/composables/useAiChat", () => ({
  default: vi.fn(() => ({
    fetchAiChat: mockFetchAiChat,
    submitFeedback: mockSubmitFeedback,
    registerAiChatHandler: vi.fn(),
    removeAiChatHandler: vi.fn(),
    getStructuredContext: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getImageURL: vi.fn((path: string) => `/mocked/${path}`),
    getUUIDv7: vi.fn(() => `uuid-${++uuidSeq.n}`),
    generateTraceContext: vi.fn(() => ({ traceId: "mock-trace" })),
  };
});

vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "true", isCloud: "false" },
}));

vi.mock("vue-router", () => ({
  useRouter: vi.fn(() => ({
    push: mockRouterPush,
    replace: vi.fn(),
    currentRoute: { value: { path: "/" } },
  })),
  useRoute: vi.fn(() => ({
    fullPath: "/",
    path: "/",
    name: "home",
    query: {},
    params: {},
  })),
}));

vi.mock("dompurify", () => ({
  default: { sanitize: vi.fn((html: string) => html) },
}));

vi.mock("@/composables/contextProviders", () => ({
  contextRegistry: { getActiveContext: vi.fn().mockResolvedValue(null) },
  createDefaultContextProvider: vi.fn(),
}));

// Component import must come after all vi.mock() declarations.
import O2AIChat from "./O2AIChat.vue";
import { useAiDashboardEvents } from "@/composables/useAiDashboardEvents";

// ── Stub definitions ─────────────────────────────────────────────────────────

const stubs = {
  RichTextInput: {
    template: '<div data-test="rich-text-input" />',
    props: ["modelValue", "placeholder", "disabled", "theme", "references", "borderless"],
    emits: ["update:modelValue", "keydown", "submit", "update:references"],
  },
  ConfirmDialog: {
    template: '<div data-test="confirm-dialog" />',
    props: ["modelValue", "title", "message"],
    emits: ["update:ok", "update:cancel", "update:modelValue"],
  },
  O2AIConfirmDialog: {
    name: "O2AIConfirmDialog",
    template: '<div data-test="o2-ai-confirm-dialog" />',
    props: ["visible", "confirmation"],
    emits: ["confirm", "cancel", "always-confirm"],
  },
  ODialog: {
    name: "ODialog",
    template: '<div data-test="o-dialog" v-if="open"><slot /></div>',
    props: [
      "open",
      "title",
      "subTitle",
      "size",
      "width",
      "persistent",
      "showClose",
      "primaryButtonLabel",
      "secondaryButtonLabel",
      "neutralButtonLabel",
      "primaryButtonVariant",
      "secondaryButtonVariant",
      "neutralButtonVariant",
      "primaryButtonDisabled",
      "secondaryButtonDisabled",
      "neutralButtonDisabled",
      "primaryButtonLoading",
      "secondaryButtonLoading",
      "neutralButtonLoading",
    ],
    emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  },
  ODrawer: {
    name: "ODrawer",
    template: '<div data-test="o-drawer" v-if="open"><slot /></div>',
    props: ["open", "title", "subTitle", "size", "width", "persistent", "showClose"],
    emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  },
};

// ── SSE helpers ──────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

/** One SSE frame: `data: <json>\n\n`. */
function sse(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Split a string into fixed-size pieces, to force mid-frame chunk boundaries. */
function slice(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** A fetchAiChat response whose reader replays `chunks` then reports done. */
function readerResponse(chunks: string[]) {
  let i = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: () =>
          i < chunks.length
            ? Promise.resolve({ done: false, value: encoder.encode(chunks[i++]) })
            : Promise.resolve({ done: true, value: undefined }),
        releaseLock: () => {},
        cancel: () => Promise.resolve(),
      }),
    },
  };
}

/** A reader the test feeds by hand, so assertions can run mid-stream. */
function gatedResponse() {
  const queue: Array<{ done: boolean; value?: Uint8Array }> = [];
  let waiting: ((r: any) => void) | null = null;
  const deliver = (r: { done: boolean; value?: Uint8Array }) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(r);
    } else {
      queue.push(r);
    }
  };
  return {
    response: {
      ok: true,
      body: {
        getReader: () => ({
          read: () =>
            queue.length
              ? Promise.resolve(queue.shift())
              : new Promise((resolve) => {
                  waiting = resolve;
                }),
          releaseLock: () => {},
          cancel: () => Promise.resolve(),
        }),
      },
    },
    push: (text: string) => deliver({ done: false, value: encoder.encode(text) }),
    close: () => deliver({ done: true, value: undefined }),
  };
}

/** A reader whose first read rejects, to drive the catch in processStream. */
function throwingResponse(error: Error) {
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: () => Promise.reject(error),
        releaseLock: () => {},
        cancel: () => Promise.resolve(),
      }),
    },
  };
}

function mountO2AIChat(props: Record<string, unknown> = {}) {
  return mount(O2AIChat, {
    global: { plugins: [store, i18n], stubs },
    props: {
      isOpen: true,
      headerHeight: 0,
      aiChatInputContext: "",
      appendMode: true,
      ...props,
    },
  });
}

/** Send a message and run the whole stream to completion. */
async function stream(vm: any, chunks: string[], text = "how many errors today") {
  mockFetchAiChat.mockResolvedValueOnce(readerResponse(chunks));
  vm.inputMessage = text;
  await vm.sendMessage();
  await flushPromises();
}

/** The trailing assistant message, or undefined when the turn produced none. */
function assistant(vm: any): any {
  const msgs = vm.chatMessages;
  const last = msgs[msgs.length - 1];
  return last && last.role === "assistant" ? last : undefined;
}

function blocks(vm: any): any[] {
  return assistant(vm)?.contentBlocks ?? [];
}

async function waitFor(predicate: () => boolean, timeout = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("O2AIChat SSE protocol", () => {
  let wrapper: VueWrapper;
  let vm: any;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    uuidSeq.n = 0;
    wrapper = mountO2AIChat();
    vm = wrapper.vm as any;
    // backgroundStreams / backgroundStreamMap / sessionStreamingState are module
    // scope and outlive every unmount; this listener is the only public reset.
    window.dispatchEvent(new Event("o2:abort-ai-streams"));
  });

  afterEach(async () => {
    // handleNavigationAction schedules an untracked setTimeout(..., 500) that
    // calls saveToHistory and is never cleared on unmount. Left pending it fires
    // inside whatever test is running 500ms later and corrupts its save counts.
    if (mockRouterPush.mock.calls.length) {
      await new Promise((r) => setTimeout(r, 550));
    }
    wrapper?.unmount();
    vi.clearAllMocks();
    mockSaveToHistory.mockResolvedValue(42);
    mockSubmitFeedback.mockResolvedValue(true);
  });

  describe("title events", () => {
    it("stores the streamed title in aiGeneratedTitle", async () => {
      await stream(vm, [sse({ type: "title", title: "Error budget review" })]);

      expect(vm.aiGeneratedTitle).toBe("Error budget review");
    });

    it("starts the typewriter with an empty displayedTitle", async () => {
      await stream(vm, [sse({ type: "title", title: "Error budget review" })]);

      expect(vm.isTypingTitle).toBe(true);
      expect(vm.displayedTitle).toBe("");
    });

    it("types the title out one character at a time and then stops", async () => {
      await stream(vm, [sse({ type: "title", title: "Latency" })]);

      await waitFor(() => vm.displayedTitle.length > 0 && vm.displayedTitle.length < 7);
      expect("Latency".startsWith(vm.displayedTitle)).toBe(true);

      await waitFor(() => vm.isTypingTitle === false);
      expect(vm.displayedTitle).toBe("Latency");
    });

    it("lets a later title supersede an earlier one", async () => {
      await stream(vm, [
        sse({ type: "title", title: "First guess" }),
        sse({ type: "title", title: "Second" }),
      ]);

      expect(vm.aiGeneratedTitle).toBe("Second");
      await waitFor(() => vm.isTypingTitle === false);
      expect(vm.displayedTitle).toBe("Second");
    });

    it("does not touch the title of the session the user switched to", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "hello";
      const turn = vm.sendMessage();
      await flushPromises();

      vm.addNewChat();
      await flushPromises();

      gate.push(sse({ type: "title", title: "Detached title" }));
      await flushPromises();
      gate.close();
      await turn;

      expect(vm.aiGeneratedTitle).toBeNull();
      expect(vm.displayedTitle).toBe("");
    });
  });

  describe("confirmation_required events", () => {
    it("pushes a pendingConfirmation tool_call block carrying the server message", async () => {
      await stream(vm, [
        sse({
          type: "confirmation_required",
          tool: "DeleteStream",
          message: "Confirm execution of DeleteStream?",
          args: { stream: "default" },
          call_id: "c1",
        }),
      ]);

      expect(blocks(vm)).toHaveLength(1);
      expect(blocks(vm)[0]).toMatchObject({
        type: "tool_call",
        tool: "DeleteStream",
        message: "Confirm execution of DeleteStream?",
        call_id: "c1",
        pendingConfirmation: true,
        confirmationMessage: "Confirm execution of DeleteStream?",
        confirmationArgs: { stream: "default" },
      });
    });

    it("sets pendingConfirmation with the tool, args and message", async () => {
      await stream(vm, [
        sse({
          type: "confirmation_required",
          tool: "DeleteStream",
          message: "Really delete?",
          args: { stream: "default" },
        }),
      ]);

      expect(vm.pendingConfirmation).toEqual({
        tool: "DeleteStream",
        args: { stream: "default" },
        message: "Really delete?",
      });
    });

    it("falls back to the translated prompt when the event carries no message", async () => {
      await stream(vm, [sse({ type: "confirmation_required", tool: "DeleteStream" })]);

      expect(vm.pendingConfirmation.message).toBe("Confirm execution of DeleteStream?");
      expect(vm.pendingConfirmation.args).toEqual({});
    });

    it("opens O2AIConfirmDialog with the confirmation", async () => {
      await stream(vm, [
        sse({ type: "confirmation_required", tool: "DeleteStream", message: "Really delete?" }),
      ]);
      await flushPromises();

      const dialog = wrapper.findComponent({ name: "O2AIConfirmDialog" });
      expect(dialog.props("visible")).toBe(true);
      expect((dialog.props("confirmation") as any).tool).toBe("DeleteStream");
    });

    it("prefers the active tool call's message, context and call_id, then clears it", async () => {
      await stream(vm, [
        sse({
          type: "tool_call",
          tool: "DeleteStream",
          message: "Deleting stream",
          context: { stream: "default" },
          call_id: "active-1",
        }),
        sse({ type: "confirmation_required", tool: "DeleteStream", message: "Really delete?" }),
      ]);

      expect(blocks(vm)[0]).toMatchObject({
        message: "Deleting stream",
        context: { stream: "default" },
        call_id: "active-1",
        confirmationMessage: "Really delete?",
      });
      expect(vm.activeToolCall).toBeNull();
    });

    it("appends to the existing assistant message instead of starting a new one", async () => {
      await stream(vm, [
        sse({ type: "message_delta", content: "Working on it." }),
        sse({ type: "confirmation_required", tool: "DeleteStream", message: "Really delete?" }),
      ]);

      expect(vm.chatMessages).toHaveLength(2);
      expect(blocks(vm).map((b: any) => b.type)).toEqual(["text", "tool_call"]);
      expect(blocks(vm)[0].text).toBe("Working on it.");
    });

    it("auto-denies over POST and writes nothing when the stream is detached", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "hello";
      const turn = vm.sendMessage();
      await flushPromises();
      const detached = vm.chatMessages;

      const streamSession = vm.currentSessionId;
      expect(streamSession).toBe("uuid-1");

      vm.addNewChat();
      await flushPromises();
      expect(vm.currentSessionId).toBeNull();

      gate.push(sse({ type: "confirmation_required", tool: "DeleteStream", message: "ok?" }));
      await flushPromises();
      gate.close();
      await turn;

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (global.fetch as any).mock.calls[0];
      expect(url).toBe(`http://localhost:5080/api/default/ai/confirm/${streamSession}`);
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ approved: false });
      expect(vm.pendingConfirmation).toBeNull();
      expect(detached.some((m: any) => m.contentBlocks?.length)).toBe(false);
    });

    it("auto-approves a navigation confirmation when auto navigation is on", async () => {
      await stream(vm, [
        sse({ type: "confirmation_required", tool: "navigation_action", message: "View in Logs" }),
      ]);

      const [url, init] = (global.fetch as any).mock.calls[0];
      expect(url).toBe(`http://localhost:5080/api/default/ai/confirm/${vm.currentSessionId}`);
      expect(JSON.parse(init.body)).toEqual({ approved: true });
      expect(vm.pendingConfirmation).toBeNull();
      // `continue` before any block is pushed: the turn leaves no assistant
      // message at all, not merely an empty block list.
      expect(vm.chatMessages).toHaveLength(1);
    });

    it("still asks when auto navigation is on but the tool is not navigation_action", async () => {
      await stream(vm, [
        sse({ type: "confirmation_required", tool: "DeleteStream", message: "Really delete?" }),
      ]);

      expect(global.fetch).not.toHaveBeenCalled();
      expect(vm.pendingConfirmation.tool).toBe("DeleteStream");
    });

    it("asks for confirmation when auto navigation is turned off", async () => {
      vm.isAutoNavigationEnabled = false;
      await stream(vm, [
        sse({ type: "confirmation_required", tool: "navigation_action", message: "View in Logs" }),
      ]);

      expect(global.fetch).not.toHaveBeenCalled();
      expect(vm.pendingConfirmation.tool).toBe("navigation_action");
      expect(blocks(vm)[0].pendingConfirmation).toBe(true);
    });

    it("CURRENT BEHAVIOR (BUG): drops a confirmation that arrives in the final chunk", async () => {
      await stream(vm, [
        `data: ${JSON.stringify({
          type: "confirmation_required",
          tool: "DeleteStream",
          message: "Really delete?",
        })}`,
      ]);

      expect(vm.pendingConfirmation).toBeNull();
      expect(vm.chatMessages).toHaveLength(1);
    });
  });

  describe("tool_call events", () => {
    it("sets activeToolCall from the event", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "hello";
      const turn = vm.sendMessage();
      await flushPromises();

      gate.push(
        sse({
          type: "tool_call",
          tool: "SearchLogs",
          message: "Searching logs",
          context: { stream: "default" },
          call_id: "c1",
        }),
      );
      await flushPromises();

      expect(vm.activeToolCall).toEqual({
        tool: "SearchLogs",
        message: "Searching logs",
        context: { stream: "default" },
        call_id: "c1",
      });

      gate.close();
      await turn;
      // sendMessage clears the indicator once the turn ends.
      expect(vm.activeToolCall).toBeNull();
    });

    it("defaults context to an empty object and call_id to undefined", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "hello";
      const turn = vm.sendMessage();
      await flushPromises();

      gate.push(sse({ type: "tool_call", tool: "SearchLogs", message: "Searching" }));
      await flushPromises();

      expect(vm.activeToolCall).toEqual({
        tool: "SearchLogs",
        message: "Searching",
        context: {},
        call_id: undefined,
      });

      gate.close();
      await turn;
    });

    it("closes the previous active call into a completed block", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "hello";
      const turn = vm.sendMessage();
      await flushPromises();

      gate.push(
        sse({
          type: "tool_call",
          tool: "SearchLogs",
          message: "Searching logs",
          context: { stream: "default" },
          call_id: "c1",
        }),
      );
      gate.push(
        sse({ type: "tool_call", tool: "GetSchema", message: "Reading schema", call_id: "c2" }),
      );
      await flushPromises();

      expect(blocks(vm)).toHaveLength(1);
      expect(blocks(vm)[0]).toEqual({
        type: "tool_call",
        tool: "SearchLogs",
        message: "Searching logs",
        context: { stream: "default" },
        call_id: "c1",
      });
      expect(vm.activeToolCall.tool).toBe("GetSchema");

      gate.close();
      await turn;
    });

    it("creates the assistant message when the completed call is the first content", async () => {
      await stream(vm, [
        sse({ type: "tool_call", tool: "A", message: "a" }),
        sse({ type: "tool_call", tool: "B", message: "b" }),
      ]);

      expect(vm.chatMessages).toHaveLength(2);
      expect(vm.chatMessages[1].role).toBe("assistant");
      expect(vm.chatMessages[1].content).toBe("");
    });

    it("finalizes the open text block so later text starts a new block", async () => {
      await stream(vm, [
        sse({ type: "message_delta", content: "before" }),
        sse({ type: "tool_call", tool: "A", message: "a" }),
        sse({ type: "message_delta", content: "after" }),
      ]);

      expect(blocks(vm).map((b: any) => b.type)).toEqual(["text", "tool_call", "text"]);
      expect(blocks(vm)[0].text).toBe("before");
      expect(blocks(vm)[2].text).toBe("after");
    });

    it("CURRENT BEHAVIOR (BUG): wipes the finalized text block when the stream ends on a tool_call", async () => {
      // The end-of-stream flush writes the now-empty textSegment back over the
      // last text block, which localFinalizeTextBlock had already closed.
      await stream(vm, [
        sse({ type: "message_delta", content: "let me check" }),
        sse({ type: "tool_call", tool: "A", message: "a", call_id: "c1" }),
      ]);

      expect(assistant(vm).content).toBe("let me check");
      expect(blocks(vm)).toEqual([{ type: "text", text: "" }]);
    });

    it("does not set activeToolCall for a detached stream", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "hello";
      const turn = vm.sendMessage();
      await flushPromises();

      vm.addNewChat();
      await flushPromises();

      gate.push(sse({ type: "tool_call", tool: "SearchLogs", message: "Searching" }));
      await flushPromises();

      expect(vm.activeToolCall).toBeNull();

      gate.close();
      await turn;
    });
  });

  describe("tool-call steps render expandable mid-stream", () => {
    it("renders a completed step with details before the stream ends", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "hello";
      const turn = vm.sendMessage();
      await flushPromises();

      gate.push(sse({ type: "tool_call", tool: "SearchLogs", message: "Searching", call_id: "c1" }));
      gate.push(
        sse({
          type: "tool_result",
          tool: "SearchLogs",
          call_id: "c1",
          message: "12 records",
          summary: { count: 12 },
        }),
      );
      await flushPromises();
      await wrapper.vm.$nextTick();

      expect(vm.isLoading).toBe(true);
      const items = wrapper.findAll(".tool-call-item");
      expect(items).toHaveLength(1);
      expect(items[0].classes()).toContain("has-details");

      gate.close();
      await turn;
    });

    it("keeps the step expandable after the stream ends", async () => {
      await stream(vm, [
        sse({ type: "tool_call", tool: "SearchLogs", message: "Searching", call_id: "c1" }),
        sse({
          type: "tool_result",
          tool: "SearchLogs",
          call_id: "c1",
          message: "12 records",
          summary: { count: 12 },
        }),
      ]);
      await wrapper.vm.$nextTick();

      expect(vm.isLoading).toBe(false);
      expect(wrapper.find(".tool-call-item").classes()).toContain("has-details");
    });
  });

  describe("tool_result events", () => {
    it("completes the matching active call with the result payload", async () => {
      await stream(vm, [
        sse({ type: "tool_call", tool: "SearchLogs", message: "Searching", call_id: "c1" }),
        sse({
          type: "tool_result",
          tool: "SearchLogs",
          call_id: "c1",
          message: "12 records",
          summary: { count: 12 },
          details: { took: 3 },
          response: { rows: 12 },
        }),
      ]);

      expect(vm.activeToolCall).toBeNull();
      expect(blocks(vm)).toHaveLength(1);
      expect(blocks(vm)[0]).toMatchObject({
        type: "tool_call",
        tool: "SearchLogs",
        call_id: "c1",
        success: true,
        resultMessage: "12 records",
        summary: { count: 12 },
        details: { took: 3 },
        response: { rows: 12 },
      });
    });

    it("falls back to matching by tool name when the result has no call_id", async () => {
      await stream(vm, [
        sse({ type: "tool_call", tool: "SearchLogs", message: "Searching", call_id: "c1" }),
        sse({ type: "tool_result", tool: "SearchLogs", message: "done" }),
      ]);

      expect(blocks(vm)).toHaveLength(1);
      expect(blocks(vm)[0].resultMessage).toBe("done");
      expect(vm.activeToolCall).toBeNull();
    });

    it("records success false and keeps the active call closed", async () => {
      await stream(vm, [
        sse({ type: "tool_call", tool: "SearchLogs", message: "Searching", call_id: "c1" }),
        sse({
          type: "tool_result",
          tool: "SearchLogs",
          call_id: "c1",
          success: false,
          message: "stream not found",
          error_type: "not_found",
          suggestion: "check the stream name",
        }),
      ]);

      expect(blocks(vm)[0]).toMatchObject({
        success: false,
        resultMessage: "stream not found",
        errorType: "not_found",
        suggestion: "check the stream name",
      });
    });

    it("defaults resultMessage to an empty string when message is absent", async () => {
      await stream(vm, [
        sse({ type: "tool_call", tool: "SearchLogs", message: "Searching", call_id: "c1" }),
        sse({ type: "tool_result", tool: "SearchLogs", call_id: "c1" }),
      ]);

      expect(blocks(vm)[0].resultMessage).toBe("");
      expect(blocks(vm)[0].summary).toBeUndefined();
    });

    it("scans backwards to enrich a block that already closed", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "hello";
      const turn = vm.sendMessage();
      await flushPromises();

      gate.push(sse({ type: "tool_call", tool: "A", message: "a", call_id: "c1" }));
      gate.push(sse({ type: "tool_call", tool: "B", message: "b", call_id: "c2" }));
      gate.push(sse({ type: "tool_result", tool: "A", call_id: "c1", message: "A finished" }));
      await flushPromises();

      expect(blocks(vm)).toHaveLength(1);
      expect(blocks(vm)[0].call_id).toBe("c1");
      expect(blocks(vm)[0].resultMessage).toBe("A finished");
      // B is untouched: the result matched an already-closed block, not the
      // active one.
      expect(vm.activeToolCall.call_id).toBe("c2");

      gate.close();
      await turn;
    });

    it("enriches only the last unenriched block when matching by tool name", async () => {
      await stream(vm, [
        sse({ type: "tool_call", tool: "A", message: "first", call_id: "c1" }),
        sse({ type: "tool_call", tool: "A", message: "second", call_id: "c2" }),
        sse({ type: "tool_call", tool: "B", message: "b", call_id: "c3" }),
        sse({ type: "tool_result", tool: "A", message: "A finished" }),
      ]);

      const toolBlocks = blocks(vm);
      expect(toolBlocks).toHaveLength(2);
      expect(toolBlocks[0].resultMessage).toBeUndefined();
      expect(toolBlocks[1].message).toBe("second");
      expect(toolBlocks[1].resultMessage).toBe("A finished");
    });

    it("leaves every block untouched when no call_id matches", async () => {
      await stream(vm, [
        sse({ type: "tool_call", tool: "A", message: "a", call_id: "c1" }),
        sse({ type: "tool_call", tool: "B", message: "b", call_id: "c2" }),
        sse({ type: "tool_result", tool: "A", call_id: "nope", message: "orphan" }),
      ]);

      expect(blocks(vm)).toHaveLength(1);
      expect(blocks(vm)[0].success).toBeUndefined();
      expect(blocks(vm)[0].resultMessage).toBeUndefined();
    });

    it("derives a load_query NavigationAction from a search tool result", async () => {
      await stream(vm, [
        sse({ type: "tool_call", tool: "SearchLogs", message: "Searching", call_id: "c1" }),
        sse({
          type: "tool_result",
          tool: "SearchLogs",
          call_id: "c1",
          message: "done",
          call_args: {
            stream_type: "logs",
            stream_name: "default",
            request_body: {
              query: { sql: "SELECT * FROM default", start_time: 1, end_time: 2 },
            },
          },
        }),
      ]);

      expect(blocks(vm)[0].navigationAction).toEqual({
        resource_type: "logs",
        action: "load_query",
        label: "View in Logs",
        target: {
          query: "SELECT * FROM default",
          sql_mode: true,
          from: 1,
          to: 2,
          stream: ["default"],
        },
      });
    });

    it("omits the NavigationAction when the query has no time range", async () => {
      await stream(vm, [
        sse({ type: "tool_call", tool: "SearchLogs", message: "Searching", call_id: "c1" }),
        sse({
          type: "tool_result",
          tool: "SearchLogs",
          call_id: "c1",
          call_args: {
            stream_name: "default",
            request_body: { query: { sql: "SELECT * FROM default" } },
          },
        }),
      ]);

      expect(blocks(vm)[0].navigationAction).toBeUndefined();
    });

    it("derives a navigate_direct NavigationAction from a create tool result", async () => {
      await stream(vm, [
        sse({ type: "tool_call", tool: "CreateAlert", message: "Creating", call_id: "c1" }),
        sse({
          type: "tool_result",
          tool: "CreateAlert",
          call_id: "c1",
          call_args: { name: "my-alert" },
          response: { alert_id: "a1" },
        }),
      ]);

      expect(blocks(vm)[0].navigationAction).toEqual({
        resource_type: "alert",
        action: "navigate_direct",
        label: "View Alert",
        target: { alert_id: "a1", name: "my-alert", folder: "default" },
      });
    });

    it("omits the NavigationAction when the tool result failed", async () => {
      await stream(vm, [
        sse({ type: "tool_call", tool: "SearchLogs", message: "Searching", call_id: "c1" }),
        sse({
          type: "tool_result",
          tool: "SearchLogs",
          call_id: "c1",
          success: false,
          call_args: {
            stream_name: "default",
            request_body: { query: { sql: "SELECT 1", start_time: 1, end_time: 2 } },
          },
        }),
      ]);

      expect(blocks(vm)[0].navigationAction).toBeUndefined();
    });

    it("emits a dashboard event for a dashboard-mutating tool", async () => {
      const events: any[] = [];
      const { on, off } = useAiDashboardEvents();
      on((e) => events.push(e));

      await stream(vm, [
        sse({ type: "tool_call", tool: "CreateDashboard", message: "Creating", call_id: "c1" }),
        sse({
          type: "tool_result",
          tool: "CreateDashboard",
          call_id: "c1",
          call_args: { dashboard_id: "d1", folder: "f1" },
        }),
      ]);
      off(events.push as any);

      expect(events).toEqual([
        { type: "dashboard_created", dashboardId: "d1", folderId: "f1" },
      ]);
    });

    it("skips the dashboard event when call_args carry no dashboard id", async () => {
      const events: any[] = [];
      const handler = (e: any) => events.push(e);
      const { on, off } = useAiDashboardEvents();
      on(handler);

      await stream(vm, [
        sse({ type: "tool_call", tool: "CreateDashboard", message: "Creating", call_id: "c1" }),
        sse({ type: "tool_result", tool: "CreateDashboard", call_id: "c1", call_args: {} }),
      ]);
      off(handler);

      expect(events).toEqual([]);
    });

    it("skips the dashboard event for a non-dashboard tool", async () => {
      const events: any[] = [];
      const handler = (e: any) => events.push(e);
      const { on, off } = useAiDashboardEvents();
      on(handler);

      await stream(vm, [
        sse({ type: "tool_call", tool: "SearchLogs", message: "Searching", call_id: "c1" }),
        sse({
          type: "tool_result",
          tool: "SearchLogs",
          call_id: "c1",
          call_args: { dashboard_id: "d1" },
        }),
      ]);
      off(handler);

      expect(events).toEqual([]);
    });

    it("skips the dashboard event when the stream is detached", async () => {
      const events: any[] = [];
      const handler = (e: any) => events.push(e);
      const { on, off } = useAiDashboardEvents();
      on(handler);

      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "hello";
      const turn = vm.sendMessage();
      await flushPromises();

      vm.addNewChat();
      await flushPromises();

      gate.push(
        sse({
          type: "tool_result",
          tool: "CreateDashboard",
          call_id: "c1",
          call_args: { dashboard_id: "d1" },
        }),
      );
      await flushPromises();
      gate.close();
      await turn;
      off(handler);

      expect(events).toEqual([]);
    });
  });

  describe("navigation_action events", () => {
    const navFrame = sse({
      type: "navigation_action",
      resource_type: "logs",
      action: "load_query",
      label: "View in Logs",
      target: { query: "SELECT 1", sql_mode: true, from: 1, to: 2, stream: ["default"] },
    });

    it("navigates immediately when auto navigation is on", async () => {
      await stream(vm, [navFrame]);

      expect(mockRouterPush).toHaveBeenCalledTimes(1);
      const arg = mockRouterPush.mock.calls[0][0];
      expect(arg.path).toBe("/logs");
      expect(arg.query).toMatchObject({
        org_identifier: "default",
        stream_type: "logs",
        sql_mode: "true",
        stream: "default",
        from: "1",
        to: "2",
        type: "ai_chat_query",
        fn_editor: "false",
        query: btoa("SELECT 1"),
      });
      expect(vm.pendingConfirmation).toBeNull();
    });

    it("renders an inline confirm block instead when auto navigation is off", async () => {
      vm.isAutoNavigationEnabled = false;
      await stream(vm, [navFrame]);

      expect(mockRouterPush).not.toHaveBeenCalled();
      expect(blocks(vm)).toHaveLength(1);
      expect(blocks(vm)[0]).toMatchObject({
        type: "tool_call",
        tool: "navigation_action",
        message: "View in Logs",
        pendingConfirmation: true,
        confirmationMessage: "View in Logs",
      });
      expect(blocks(vm)[0].context.navAction.action).toBe("load_query");
    });

    it("stores navAction on pendingConfirmation so confirming can navigate", async () => {
      vm.isAutoNavigationEnabled = false;
      await stream(vm, [navFrame]);

      expect(vm.pendingConfirmation.tool).toBe("navigation_action");
      expect(vm.pendingConfirmation.args).toEqual({
        query: "SELECT 1",
        sql_mode: true,
        from: 1,
        to: 2,
        stream: ["default"],
      });
      expect(vm.pendingConfirmation.navAction.label).toBe("View in Logs");
    });

    it("falls back to the translated prompt when the event has no label", async () => {
      vm.isAutoNavigationEnabled = false;
      await stream(vm, [
        sse({ type: "navigation_action", resource_type: "logs", action: "load_query", target: {} }),
      ]);

      expect(vm.pendingConfirmation.message).toBe("Allow O2 Assistant to navigate?");
      expect(blocks(vm)[0].message).toBe("Allow O2 Assistant to navigate?");
    });

    it("skips navigation entirely when the stream is detached", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "hello";
      const turn = vm.sendMessage();
      await flushPromises();
      const detached = vm.chatMessages;

      vm.addNewChat();
      await flushPromises();

      gate.push(navFrame);
      await flushPromises();
      gate.close();
      await turn;

      expect(mockRouterPush).not.toHaveBeenCalled();
      expect(detached.some((m: any) => m.contentBlocks?.length)).toBe(false);
    });

    it("CURRENT BEHAVIOR (BUG): drops a navigation_action that arrives in the final chunk", async () => {
      await stream(vm, [navFrame.trimEnd()]);

      expect(mockRouterPush).not.toHaveBeenCalled();
      expect(vm.pendingConfirmation).toBeNull();
      expect(vm.chatMessages).toHaveLength(1);
    });
  });

  describe("error events", () => {
    it("swallows session_owner_unavailable and restores the conversation", async () => {
      mockFetchAiChat
        .mockResolvedValueOnce(readerResponse([sse({ type: "error", code: "session_owner_unavailable" })]))
        .mockResolvedValueOnce(readerResponse([sse({ type: "message_delta", content: "again" })]));
      vm.inputMessage = "hello";
      await vm.sendMessage();
      await flushPromises();

      expect(mockFetchAiChat).toHaveBeenCalledTimes(2);
      expect(vm.streamOwnerUnavailable).toBe(false);
      // The restored notice is an `error` block, which carries `.message`;
      // stream error text lands in a `text` block's `.text`, so both fields
      // have to be checked against the field the producing path actually sets.
      const notice = blocks(vm).find((b: any) => b.type === "error");
      expect(notice).toBeDefined();
      expect(String(notice.message)).toContain("has been restored");
      expect(blocks(vm).every((b: any) => !String(b.text ?? "").startsWith("Error:"))).toBe(true);
    });

    it("appends an Error-prefixed text block for a generic error", async () => {
      await stream(vm, [sse({ type: "error", error: "boom" })]);

      expect(blocks(vm)).toHaveLength(1);
      expect(blocks(vm)[0]).toEqual({ type: "text", text: "Error: boom" });
      expect(assistant(vm).content).toBe("Error: boom");
    });

    it("uses message when error is absent", async () => {
      await stream(vm, [sse({ type: "error", message: "backend exploded" })]);

      expect(blocks(vm)[0].text).toBe("Error: backend exploded");
    });

    it("uses the translated fallback when neither error nor message is present", async () => {
      await stream(vm, [sse({ type: "error" })]);

      expect(blocks(vm)[0].text).toBe("Error: An unexpected error occurred");
    });

    it("stringifies a non-string error payload", async () => {
      await stream(vm, [sse({ type: "error", error: { reason: "bad" } })]);

      expect(blocks(vm)[0].text).toBe(`Error: ${JSON.stringify({ reason: "bad" }, null, 2)}`);
    });

    it("appends the suggestion as a separate paragraph", async () => {
      await stream(vm, [sse({ type: "error", error: "boom", suggestion: "try again" })]);

      expect(blocks(vm)[0].text).toBe("Error: boom\n\ntry again");
    });

    it("maps an authorization error message to the unauthorized copy", async () => {
      await stream(vm, [sse({ type: "error", error: "permission denied for stream" })]);

      expect(blocks(vm)[0].text).toBe(
        "Unauthorized Access: You are not authorized to perform this operation, please contact your administrator.",
      );
    });

    it("maps an authorization error_type to the unauthorized copy and drops the suggestion", async () => {
      await stream(vm, [
        sse({ type: "error", error: "boom", error_type: "forbidden", suggestion: "try again" }),
      ]);

      expect(blocks(vm)[0].text).toBe(
        "Unauthorized Access: You are not authorized to perform this operation, please contact your administrator.",
      );
    });

    it("appends to an existing assistant message rather than creating a second one", async () => {
      await stream(vm, [
        sse({ type: "message_delta", content: "partial" }),
        sse({ type: "error", error: "boom" }),
      ]);

      expect(vm.chatMessages).toHaveLength(2);
      expect(assistant(vm).content).toBe("partial\n\nError: boom");
      expect(blocks(vm).map((b: any) => b.text)).toEqual(["partial", "Error: boom"]);
    });

    it("CURRENT BEHAVIOR (BUG): leaves the active tool neutral, with no detail affordance", async () => {
      await stream(vm, [
        sse({ type: "tool_call", tool: "SearchLogs", message: "Searching", call_id: "c1" }),
        sse({ type: "error", error: "boom", message: "boom" }),
      ]);
      await wrapper.vm.$nextTick();

      const toolBlock = blocks(vm)[0];
      expect(toolBlock.type).toBe("tool_call");
      // Neither success:false nor a result — so hasToolCallDetails is false and
      // the step renders as an un-expandable row with no sign it failed.
      expect(toolBlock.success).toBeUndefined();
      expect(toolBlock.resultMessage).toBeUndefined();
      expect(vm.hasToolCallDetails(toolBlock)).toBe(false);
      const item = wrapper.find(".tool-call-item");
      expect(item.exists()).toBe(true);
      expect(item.classes()).not.toContain("has-details");
      expect(item.classes()).not.toContain("error");
      expect(vm.activeToolCall).toBeNull();
    });

    it("CURRENT BEHAVIOR (BUG): renders the error as text, never as an error block", async () => {
      await stream(vm, [sse({ type: "error", error: "boom", recoverable: true })]);

      expect(blocks(vm).map((b: any) => b.type)).toEqual(["text"]);
    });

    it("stops the stream: events after an error are dropped", async () => {
      await stream(vm, [
        sse({ type: "error", error: "boom" }),
        sse({ type: "message_delta", content: "never rendered" }),
      ]);

      expect(blocks(vm).map((b: any) => b.text)).toEqual(["Error: boom"]);
    });

    it("handles an error that arrives in the final chunk", async () => {
      await stream(vm, [`data: ${JSON.stringify({ type: "error", error: "boom" })}`]);

      expect(blocks(vm)[0].text).toBe("Error: boom");
    });
  });

  describe("complete events", () => {
    it("captures trace_id for feedback correlation", async () => {
      await stream(vm, [
        sse({ type: "message_delta", content: "answer" }),
        sse({ type: "complete", trace_id: "trace-abc" }),
      ]);

      await vm.likeCodeBlock(1);
      await flushPromises();

      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        "thumbs_up",
        "default",
        "uuid-1",
        0,
        "trace-abc",
      );
    });

    it("sends no trace id when complete carried none", async () => {
      await stream(vm, [
        sse({ type: "message_delta", content: "answer" }),
        sse({ type: "complete" }),
      ]);

      await vm.likeCodeBlock(1);
      await flushPromises();

      expect(mockSubmitFeedback.mock.calls[0][4]).toBeUndefined();
    });

    it("clears the trace id on a new chat", async () => {
      await stream(vm, [
        sse({ type: "message_delta", content: "answer" }),
        sse({ type: "complete", trace_id: "trace-abc" }),
      ]);
      vm.addNewChat();
      vm.chatMessages = [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ];

      await vm.dislikeCodeBlock(1);
      await flushPromises();

      expect(mockSubmitFeedback.mock.calls[0][0]).toBe("thumbs_down");
      expect(mockSubmitFeedback.mock.calls[0][4]).toBeUndefined();
    });

    it("closes an active tool call into a completed block", async () => {
      await stream(vm, [
        sse({
          type: "tool_call",
          tool: "SearchLogs",
          message: "Searching",
          context: { a: 1 },
          call_id: "c1",
        }),
        sse({ type: "complete", trace_id: "trace-abc" }),
      ]);

      expect(vm.activeToolCall).toBeNull();
      expect(blocks(vm)).toEqual([
        {
          type: "tool_call",
          tool: "SearchLogs",
          message: "Searching",
          context: { a: 1 },
          call_id: "c1",
        },
      ]);
    });

    it("adds nothing when no tool call is active", async () => {
      await stream(vm, [
        sse({ type: "message_delta", content: "answer" }),
        sse({ type: "complete", trace_id: "trace-abc" }),
      ]);

      expect(blocks(vm)).toEqual([{ type: "text", text: "answer" }]);
    });
  });

  describe("message_delta and plain text", () => {
    it("renders a single delta verbatim", async () => {
      await stream(vm, [sse({ type: "message_delta", content: "Hello world" })]);

      expect(vm.chatMessages).toHaveLength(2);
      expect(blocks(vm)).toEqual([{ type: "text", text: "Hello world" }]);
      expect(assistant(vm).content).toBe("Hello world");
    });

    it("concatenates consecutive deltas with no separator", async () => {
      await stream(vm, [
        sse({ type: "message_delta", content: "Hello" }),
        sse({ type: "message_delta", content: " world" }),
        sse({ type: "message_delta", content: "!" }),
      ]);

      expect(blocks(vm)).toEqual([{ type: "text", text: "Hello world!" }]);
      expect(assistant(vm).content).toBe("Hello world!");
    });

    it("preserves whitespace and newlines inside a delta", async () => {
      await stream(vm, [
        sse({ type: "message_delta", content: "line1\n" }),
        sse({ type: "message_delta", content: "  line2" }),
      ]);

      expect(blocks(vm)[0].text).toBe("line1\n  line2");
    });

    it("reformats code fences for a non-delta message", async () => {
      await stream(vm, [sse({ type: "message", content: "```sql SELECT 1 ```" })]);

      expect(blocks(vm)[0].text).toBe("```sql\nSELECT 1\n```");
    });

    it("separates two non-delta messages with a blank line", async () => {
      await stream(vm, [
        sse({ type: "message", content: "first" }),
        sse({ type: "message", content: "second" }),
      ]);

      expect(blocks(vm)[0].text).toBe("first\n\nsecond");
    });

    it("accepts the text field", async () => {
      await stream(vm, [sse({ type: "message_delta", text: "from text" })]);

      expect(blocks(vm)[0].text).toBe("from text");
    });

    it("accepts delta.content", async () => {
      await stream(vm, [sse({ delta: { content: "from delta" } })]);

      expect(blocks(vm)[0].text).toBe("from delta");
    });

    it("accepts choices[0].delta.content", async () => {
      await stream(vm, [sse({ choices: [{ delta: { content: "from choices" } }] })]);

      expect(blocks(vm)[0].text).toBe("from choices");
    });

    it("accepts the response field", async () => {
      await stream(vm, [sse({ response: "from response" })]);

      expect(blocks(vm)[0].text).toBe("from response");
    });

    it("prefers content over the fallback fields", async () => {
      await stream(vm, [
        sse({ type: "message_delta", content: "canonical", text: "ignored", response: "ignored" }),
      ]);

      expect(blocks(vm)[0].text).toBe("canonical");
    });

    it("treats a fallback-field payload as a delta, with no fence reformatting", async () => {
      await stream(vm, [
        sse({ text: "```sql SELECT 1 ```" }),
        sse({ text: "tail" }),
      ]);

      expect(blocks(vm)[0].text).toBe("```sql SELECT 1 ```tail");
    });

    it("ignores an event that carries no assistant text", async () => {
      await stream(vm, [sse({ type: "heartbeat", seq: 3 })]);

      expect(vm.chatMessages).toHaveLength(1);
      expect(vm.chatMessages[0].role).toBe("user");
    });

    it("closes an active tool call before the text lands", async () => {
      await stream(vm, [
        sse({ type: "tool_call", tool: "SearchLogs", message: "Searching", call_id: "c1" }),
        sse({ type: "message_delta", content: "here you go" }),
      ]);

      expect(vm.activeToolCall).toBeNull();
      expect(blocks(vm).map((b: any) => b.type)).toEqual(["tool_call", "text"]);
      expect(blocks(vm)[1].text).toBe("here you go");
    });

    it("throttles saves during a burst of deltas", async () => {
      const before = mockSaveToHistory.mock.calls.length;
      await stream(vm, [
        sse({ type: "message_delta", content: "a" }),
        sse({ type: "message_delta", content: "b" }),
        sse({ type: "message_delta", content: "c" }),
      ]);

      // user message, forced save on assistant creation, final save. The two
      // later deltas fall inside STREAMING_SAVE_INTERVAL. Counted as a delta,
      // because an orphan navigation timer can land here from a prior test.
      const calls = mockSaveToHistory.mock.calls.slice(before);
      expect(calls).toHaveLength(3);
      expect(calls[2][0]).toHaveLength(2);
      expect(calls[2][1]).toBe("uuid-1");
    });
  });

  describe("chunk boundaries", () => {
    it("buffers a frame split inside the JSON", async () => {
      const frame = sse({ type: "message_delta", content: "Hello world" });
      const at = frame.indexOf("world");
      await stream(vm, [frame.slice(0, at), frame.slice(at)]);

      expect(blocks(vm)[0].text).toBe("Hello world");
    });

    it("buffers a frame split inside the data: prefix", async () => {
      const frame = sse({ type: "message_delta", content: "Hello" });
      await stream(vm, ["da", frame.slice(2)]);

      expect(blocks(vm)[0].text).toBe("Hello");
    });

    it("reassembles a frame delivered one character at a time", async () => {
      const frame = sse({ type: "message_delta", content: "drip" });
      await stream(vm, slice(frame, 1));

      expect(blocks(vm)[0].text).toBe("drip");
    });

    it("handles several frames inside one chunk", async () => {
      await stream(vm, [
        sse({ type: "message_delta", content: "a" }) +
          sse({ type: "message_delta", content: "b" }) +
          sse({ type: "message_delta", content: "c" }),
      ]);

      expect(blocks(vm)[0].text).toBe("abc");
    });

    it("handles frames split across chunks at 7-byte boundaries", async () => {
      const payload =
        sse({ type: "tool_call", tool: "SearchLogs", message: "Searching", call_id: "c1" }) +
        sse({ type: "tool_result", tool: "SearchLogs", call_id: "c1", message: "12 records" }) +
        sse({ type: "message_delta", content: "done" });
      await stream(vm, slice(payload, 7));

      expect(blocks(vm).map((b: any) => b.type)).toEqual(["tool_call", "text"]);
      expect(blocks(vm)[0].resultMessage).toBe("12 records");
      expect(blocks(vm)[1].text).toBe("done");
    });

    it("accepts CRLF line endings", async () => {
      await stream(vm, [
        `data: ${JSON.stringify({ type: "message_delta", content: "crlf" })}\r\n\r\n`,
      ]);

      expect(blocks(vm)[0].text).toBe("crlf");
    });

    it("ignores keepalive blank lines and comment lines", async () => {
      await stream(vm, [
        "\n\n:keepalive\n\n",
        sse({ type: "message_delta", content: "alive" }),
        "\n:ping\n\n",
      ]);

      expect(blocks(vm)[0].text).toBe("alive");
    });

    it("ignores non-data SSE fields", async () => {
      await stream(vm, [
        "event: message\nid: 7\n",
        sse({ type: "message_delta", content: "kept" }),
      ]);

      expect(blocks(vm)[0].text).toBe("kept");
    });

    it("survives a malformed JSON line and keeps processing", async () => {
      await stream(vm, [
        "data: {not json at all\n\n",
        sse({ type: "message_delta", content: "survived" }),
      ]);

      expect(blocks(vm)[0].text).toBe("survived");
    });

    it("skips a data line with no JSON object at all", async () => {
      await stream(vm, [
        "data: [DONE]\n\n",
        sse({ type: "message_delta", content: "after done" }),
      ]);

      expect(blocks(vm)[0].text).toBe("after done");
    });

    it("processes a trailing frame that has no final newline", async () => {
      await stream(vm, [
        sse({ type: "message_delta", content: "first" }),
        `data: ${JSON.stringify({ type: "message_delta", content: "-last" })}`,
      ]);

      expect(blocks(vm)[0].text).toBe("first-last");
    });

    it("processes a trailing tool_result that has no final newline", async () => {
      await stream(vm, [
        sse({ type: "tool_call", tool: "SearchLogs", message: "Searching", call_id: "c1" }),
        `data: ${JSON.stringify({
          type: "tool_result",
          tool: "SearchLogs",
          call_id: "c1",
          message: "12 records",
        })}`,
      ]);

      expect(blocks(vm)[0].resultMessage).toBe("12 records");
    });
  });

  describe("event ordering", () => {
    it("ignores a tool_result that arrives before its tool_call", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "hello";
      const turn = vm.sendMessage();
      await flushPromises();

      gate.push(sse({ type: "tool_result", tool: "SearchLogs", call_id: "c1", message: "early" }));
      gate.push(sse({ type: "tool_call", tool: "SearchLogs", message: "Searching", call_id: "c1" }));
      await flushPromises();

      expect(vm.chatMessages).toHaveLength(1);
      expect(vm.activeToolCall).toEqual({
        tool: "SearchLogs",
        message: "Searching",
        context: {},
        call_id: "c1",
      });

      gate.close();
      await turn;
    });

    it("keeps the second tool active while enriching the first", async () => {
      await stream(vm, [
        sse({ type: "tool_call", tool: "A", message: "a", call_id: "c1" }),
        sse({ type: "tool_call", tool: "B", message: "b", call_id: "c2" }),
        sse({ type: "tool_result", tool: "A", call_id: "c1", message: "A done" }),
        sse({ type: "tool_result", tool: "B", call_id: "c2", message: "B done" }),
      ]);

      expect(vm.activeToolCall).toBeNull();
      expect(blocks(vm)).toHaveLength(2);
      expect(blocks(vm)[0].resultMessage).toBe("A done");
      expect(blocks(vm)[1].resultMessage).toBe("B done");
    });

    it("keeps block order when text is interleaved with tool calls", async () => {
      await stream(vm, [
        sse({ type: "message_delta", content: "thinking" }),
        sse({ type: "tool_call", tool: "A", message: "a", call_id: "c1" }),
        sse({ type: "tool_result", tool: "A", call_id: "c1", message: "A done" }),
        sse({ type: "message_delta", content: "answer" }),
        sse({ type: "complete", trace_id: "t1" }),
      ]);

      expect(blocks(vm).map((b: any) => b.type)).toEqual(["text", "tool_call", "text"]);
      expect(blocks(vm)[0].text).toBe("thinking");
      expect(blocks(vm)[2].text).toBe("answer");
    });

    it("keeps the user message ahead of everything the stream writes", async () => {
      await stream(vm, [sse({ type: "message_delta", content: "answer" })], "why is p99 up");

      expect(vm.chatMessages[0]).toMatchObject({ role: "user", content: "why is p99 up" });
      expect(vm.chatMessages[1].role).toBe("assistant");
    });
  });

  describe("session isolation", () => {
    it("writes detached events into the original array, never the new session", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "first question";
      const turn = vm.sendMessage();
      await flushPromises();
      const original = vm.chatMessages;

      vm.addNewChat();
      await flushPromises();
      expect(vm.chatMessages).not.toBe(original);

      gate.push(sse({ type: "message_delta", content: "late " }));
      gate.push(sse({ type: "message_delta", content: "answer" }));
      await flushPromises();
      gate.close();
      await turn;

      expect(vm.chatMessages).toHaveLength(0);
      expect(original).toHaveLength(2);
      const detachedAssistant = original[1];
      expect(detachedAssistant.role).toBe("assistant");
      expect(detachedAssistant.content).toBe("late answer");
      expect(detachedAssistant.contentBlocks).toEqual([{ type: "text", text: "late answer" }]);
    });

    it("CURRENT BEHAVIOR: a detached stream records no tool_call steps at all", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "first question";
      const turn = vm.sendMessage();
      await flushPromises();
      const original = vm.chatMessages;

      vm.addNewChat();
      await flushPromises();

      // activeToolCall is only assigned while isActive(), so the next tool_call
      // has no predecessor to close and nothing is ever pushed.
      gate.push(sse({ type: "tool_call", tool: "A", message: "a", call_id: "c1" }));
      gate.push(sse({ type: "tool_call", tool: "B", message: "b", call_id: "c2" }));
      gate.push(sse({ type: "message_delta", content: "answer" }));
      await flushPromises();
      gate.close();
      await turn;

      expect(vm.activeToolCall).toBeNull();
      const detachedAssistant = original[original.length - 1];
      expect(detachedAssistant.contentBlocks.map((b: any) => b.type)).toEqual(["text"]);
    });

    it("keeps saving the detached stream under its captured session id", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "first question";
      const turn = vm.sendMessage();
      await flushPromises();
      const original = vm.chatMessages;

      const streamSession = vm.currentSessionId;

      vm.addNewChat();
      await flushPromises();
      mockSaveToHistory.mockClear();

      // A second turn in the NEW session, so a live-id read would differ.
      mockFetchAiChat.mockResolvedValueOnce(readerResponse([sse({ type: "message_delta", content: "b" })]));
      vm.inputMessage = "second question";
      await vm.sendMessage();
      await flushPromises();
      expect(vm.currentSessionId).not.toBe(streamSession);

      gate.push(sse({ type: "message_delta", content: "late answer" }));
      await flushPromises();
      gate.close();
      await turn;

      const detachedSaves = mockSaveToHistory.mock.calls.filter((c: any[]) => c[0] === original);
      expect(detachedSaves.length).toBeGreaterThan(0);
      for (const call of detachedSaves) {
        expect(call[1]).toBe(streamSession);
      }
    });

    it("does not raise the loading indicator of the new session", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "first question";
      const turn = vm.sendMessage();
      await flushPromises();

      vm.addNewChat();
      await flushPromises();
      expect(vm.isLoading).toBe(false);

      gate.push(sse({ type: "message_delta", content: "late answer" }));
      await flushPromises();
      expect(vm.isLoading).toBe(false);

      gate.close();
      await turn;
    });

    it("keeps writing to the live session for the whole turn when no switch happens", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "first question";
      const turn = vm.sendMessage();
      await flushPromises();

      gate.push(sse({ type: "message_delta", content: "streaming" }));
      await flushPromises();
      expect(blocks(vm)[0].text).toBe("streaming");
      expect(vm.isLoading).toBe(true);

      gate.close();
      await turn;
      expect(vm.isLoading).toBe(false);
    });
  });

  describe("abort and cancel", () => {
    it("clears the streaming UI when the user stops generation mid-stream", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "first question";
      const turn = vm.sendMessage();
      await flushPromises();

      gate.push(sse({ type: "tool_call", tool: "A", message: "a", call_id: "c1" }));
      await flushPromises();
      expect(vm.activeToolCall.tool).toBe("A");

      await vm.cancelCurrentRequest();
      await flushPromises();

      expect(vm.isLoading).toBe(false);
      expect(vm.activeToolCall).toBeNull();
      expect(vm.currentAbortController).toBeNull();

      gate.close();
      await turn;
    });

    it("keeps the buffered text after a cancel", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "first question";
      const turn = vm.sendMessage();
      await flushPromises();

      gate.push(sse({ type: "message_delta", content: "half an ans" }));
      await flushPromises();
      await vm.cancelCurrentRequest();
      await flushPromises();

      expect(blocks(vm)[0].text).toBe("half an ans");

      gate.close();
      await turn;
    });

    it("exits quietly on an AbortError without adding an error message", async () => {
      const abort = new Error("aborted");
      abort.name = "AbortError";
      mockFetchAiChat.mockResolvedValueOnce(throwingResponse(abort));
      vm.inputMessage = "first question";
      await vm.sendMessage();
      await flushPromises();

      expect(vm.chatMessages).toHaveLength(1);
      expect(vm.isLoading).toBe(false);
    });

    it("CURRENT BEHAVIOR (BUG): a mid-stream reader failure is swallowed with no message to the user", async () => {
      mockFetchAiChat.mockResolvedValueOnce(throwingResponse(new Error("socket reset")));
      vm.inputMessage = "first question";
      await vm.sendMessage();
      await flushPromises();

      expect(vm.chatMessages).toHaveLength(1);
      expect(vm.isLoading).toBe(false);
      expect(vm.activeToolCall).toBeNull();
    });
  });

  describe("turn teardown", () => {
    it("clears isLoading, activeToolCall and the abort controller when the turn ends", async () => {
      await stream(vm, [
        sse({ type: "tool_call", tool: "SearchLogs", message: "Searching", call_id: "c1" }),
        sse({ type: "message_delta", content: "answer" }),
      ]);

      expect(vm.isLoading).toBe(false);
      expect(vm.activeToolCall).toBeNull();
      expect(vm.currentAbortController).toBeNull();
    });

    it("keeps the input usable after a turn that produced only an error", async () => {
      await stream(vm, [sse({ type: "error", error: "boom" })]);

      expect(vm.isLoading).toBe(false);
    });

    it("CURRENT BEHAVIOR (BUG): leaves isLoading true forever when fetchAiChat rejects", async () => {
      mockFetchAiChat.mockRejectedValueOnce(new Error("network down"));
      vm.inputMessage = "hello";
      await vm.sendMessage();
      await flushPromises();

      // The catch at sendMessage returns from inside the try with no finally, so
      // the teardown below it never runs.
      expect(vm.isLoading).toBe(true);
      expect(vm.currentAbortController).not.toBeNull();
      expect(vm.chatMessages).toHaveLength(1);
    });

    it("CURRENT BEHAVIOR (BUG): a cancelled response renders nothing and leaves isLoading true", async () => {
      mockFetchAiChat.mockResolvedValueOnce({ cancelled: true });
      vm.inputMessage = "hello";
      await vm.sendMessage();
      await flushPromises();

      // Without the early return the cancelled envelope falls into the !ok
      // branch and a raw JS TypeError is rendered as the assistant reply.
      expect(vm.chatMessages).toHaveLength(1);
      expect(vm.isLoading).toBe(true);
    });
  });

  describe("addNewChat", () => {
    it("mints a fresh session id for the next turn", async () => {
      await stream(vm, [sse({ type: "message_delta", content: "one" })]);
      const first = mockFetchAiChat.mock.calls[0][5];
      expect(first).toBe("uuid-1");

      vm.addNewChat();
      await flushPromises();
      expect(vm.currentSessionId).toBeNull();

      await stream(vm, [sse({ type: "message_delta", content: "two" })], "second");
      const second = mockFetchAiChat.mock.calls[1][5];
      expect(second).not.toBe(first);
      expect(mockSaveToHistory.mock.calls.at(-1)?.[1]).toBe(second);
    });

    it("tells the sidebar the chat list changed", async () => {
      const dispatch = vi.spyOn(vm.store, "dispatch");
      try {
        vm.addNewChat();
        expect(dispatch).toHaveBeenCalledWith("setChatUpdated", true);
      } finally {
        dispatch.mockRestore();
      }
    });

    it("CURRENT BEHAVIOR (BUG): a confirmation answered after a chat switch is POSTed to the wrong session", async () => {
      await stream(vm, [
        sse({ type: "confirmation_required", tool: "DeleteStream", message: "Really delete?" }),
      ]);
      const originatingSession = vm.currentSessionId;
      expect(originatingSession).toBe("uuid-1");

      // The user opens another conversation before answering the dialog.
      mockLoadChat.mockResolvedValueOnce({
        sessionId: "some-other-session",
        title: "other",
        messages: [{ role: "user", content: "unrelated" }],
      });
      await vm.loadChat(31);
      await flushPromises();
      expect(vm.currentSessionId).toBe("some-other-session");

      await vm.handleToolConfirm();
      await flushPromises();

      // handleToolConfirm reads currentSessionId, not the session the
      // confirmation arrived on, so the approval lands on the other chat.
      const [url] = (global.fetch as any).mock.calls[0];
      expect(url).toBe("http://localhost:5080/api/default/ai/confirm/some-other-session");
      expect(url).not.toContain(originatingSession);
    });

    it("CURRENT BEHAVIOR (BUG): a pending confirmation survives a new chat and cancel cannot dismiss it", async () => {
      await stream(vm, [
        sse({ type: "confirmation_required", tool: "DeleteStream", message: "Really delete?" }),
      ]);
      expect(vm.pendingConfirmation).not.toBeNull();

      vm.addNewChat();
      await flushPromises();
      expect(vm.pendingConfirmation).not.toBeNull();

      // handleToolCancel bails on the missing session id BEFORE clearing
      // pendingConfirmation, so the dialog stays wedged open.
      await vm.handleToolCancel();
      await flushPromises();

      expect(vm.pendingConfirmation).not.toBeNull();
      expect(wrapper.findComponent({ name: "O2AIConfirmDialog" }).props("visible")).toBe(true);
    });
  });

  describe("session restore", () => {
    it("renders no error text for session_owner_unavailable", async () => {
      mockFetchAiChat
        .mockResolvedValueOnce(
          readerResponse([sse({ type: "error", code: "session_owner_unavailable" })]),
        )
        .mockResolvedValueOnce(readerResponse([sse({ type: "message_delta", content: "again" })]));
      vm.inputMessage = "hello";
      await vm.sendMessage();
      await flushPromises();

      // The handler flags and `continue`s. Without that the frame falls through
      // to the generic error branch and paints a raw error at the user.
      const texts = blocks(vm)
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text);
      expect(texts.some((t: string) => t.startsWith("Error:"))).toBe(false);
      expect(texts).toContain("again");
    });

    it("retries a pre-stream 409 under a brand new session id", async () => {
      mockFetchAiChat
        .mockResolvedValueOnce({
          ok: false,
          status: 409,
          json: () => Promise.resolve({ code: "session_owner_unavailable" }),
        })
        .mockResolvedValueOnce(readerResponse([sse({ type: "message_delta", content: "ok" })]));
      vm.inputMessage = "hello";
      await vm.sendMessage();
      await flushPromises();

      expect(mockFetchAiChat).toHaveBeenCalledTimes(2);
      const [dead, fresh] = mockFetchAiChat.mock.calls.map((c: any[]) => c[5]);
      expect(dead).toBe("uuid-1");
      expect(fresh).not.toBe(dead);
      expect(vm.currentSessionId).toBe(fresh);
    });
  });

  describe("mid-stream state transitions", () => {
    it("clears activeToolCall the moment complete arrives, not at the end of the turn", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "hello";
      const turn = vm.sendMessage();
      await flushPromises();

      gate.push(sse({ type: "tool_call", tool: "SearchLogs", message: "Searching", call_id: "c1" }));
      await flushPromises();
      expect(vm.activeToolCall).not.toBeNull();

      gate.push(sse({ type: "complete", trace_id: "t1" }));
      await flushPromises();

      expect(vm.activeToolCall).toBeNull();
      expect(vm.isLoading).toBe(true);

      gate.close();
      await turn;
    });

    it("clears activeToolCall the moment a confirmation is requested", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "hello";
      const turn = vm.sendMessage();
      await flushPromises();

      gate.push(sse({ type: "tool_call", tool: "DeleteStream", message: "Deleting", call_id: "c1" }));
      await flushPromises();
      expect(vm.activeToolCall).not.toBeNull();

      gate.push(sse({ type: "confirmation_required", tool: "DeleteStream", message: "Sure?" }));
      await flushPromises();

      expect(vm.activeToolCall).toBeNull();
      expect(vm.isLoading).toBe(true);

      gate.close();
      await turn;
    });

    it("matches a tool_result to the active call by call_id, never by tool name", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "hello";
      const turn = vm.sendMessage();
      await flushPromises();

      gate.push(sse({ type: "tool_call", tool: "SearchLogs", message: "first", call_id: "c1" }));
      gate.push(sse({ type: "tool_call", tool: "SearchLogs", message: "second", call_id: "c2" }));
      await flushPromises();
      expect(vm.activeToolCall.call_id).toBe("c2");

      // Same tool name, older call_id: this belongs to the block already closed,
      // not to the call currently in flight.
      gate.push(
        sse({ type: "tool_result", tool: "SearchLogs", call_id: "c1", message: "12 records" }),
      );
      await flushPromises();

      expect(vm.activeToolCall?.call_id).toBe("c2");
      expect(blocks(vm)).toHaveLength(1);
      expect(blocks(vm)[0]).toMatchObject({ call_id: "c1", resultMessage: "12 records" });

      gate.close();
      await turn;
    });

    it("does not capture a trace id from a detached stream", async () => {
      const gate = gatedResponse();
      mockFetchAiChat.mockResolvedValueOnce(gate.response);
      vm.inputMessage = "hello";
      const turn = vm.sendMessage();
      await flushPromises();

      vm.addNewChat();
      await flushPromises();

      gate.push(sse({ type: "complete", trace_id: "detached-trace" }));
      await flushPromises();
      gate.close();
      await turn;

      vm.chatMessages = [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ];
      await vm.likeCodeBlock(1);
      await flushPromises();

      expect(mockSubmitFeedback.mock.calls[0][4]).toBeUndefined();
    });
  });

  describe("retry", () => {
    it("resends the preceding user message", async () => {
      await stream(vm, [sse({ type: "message_delta", content: "answer" })], "why is p99 up");
      mockFetchAiChat.mockResolvedValueOnce(readerResponse([]));

      await vm.retryGeneration(vm.chatMessages[1]);
      await flushPromises();

      expect(mockFetchAiChat).toHaveBeenCalledTimes(2);
      expect(vm.chatMessages.filter((m: any) => m.role === "user")).toHaveLength(2);
      expect(vm.chatMessages[2].content).toBe("why is p99 up");
    });

    it("does nothing for a user message", async () => {
      await stream(vm, [sse({ type: "message_delta", content: "answer" })]);
      mockFetchAiChat.mockClear();

      await vm.retryGeneration(vm.chatMessages[0]);
      await flushPromises();

      expect(mockFetchAiChat).not.toHaveBeenCalled();
    });
  });
});

// backgroundStreams, backgroundStreamMap and sessionStreamingState are module
// scope, so these need two live instances rather than one.
describe("O2AIChat cross-instance streaming registry", () => {
  const live: VueWrapper[] = [];

  function mountTracked() {
    const w = mountO2AIChat();
    live.push(w);
    return w;
  }

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const seed = mountO2AIChat();
    window.dispatchEvent(new Event("o2:abort-ai-streams"));
    seed.unmount();
  });

  afterEach(() => {
    while (live.length) live.pop()?.unmount();
    vi.clearAllMocks();
    mockSaveToHistory.mockResolvedValue(42);
    mockLoadChat.mockResolvedValue(null);
  });

  /** Park a stream in the background under `sessionId`, and keep its gate. */
  async function parkStream() {
    const owner = mountTracked();
    const o = owner.vm as any;
    const gate = gatedResponse();
    mockFetchAiChat.mockResolvedValueOnce(gate.response);
    o.inputMessage = "hello";
    const turn = o.sendMessage();
    await flushPromises();
    gate.push(sse({ type: "message_delta", content: "partial" }));
    await flushPromises();
    const sessionId = o.currentSessionId as string;
    o.addNewChat();
    await flushPromises();
    return { o, gate, turn, sessionId };
  }

  it("clears a re-attached instance's streaming UI when the owning turn finishes", async () => {
    const { gate, turn, sessionId } = await parkStream();

    const sidebar = mountTracked();
    const s = sidebar.vm as any;
    mockLoadChat.mockResolvedValueOnce({
      sessionId,
      title: "shared",
      messages: [],
    });
    await s.loadChat(7);
    await flushPromises();
    expect(s.isLoading).toBe(true);

    // The owning instance drives the spinner; this one only mirrors it.
    s.activeToolCall = { tool: "SearchLogs", message: "Searching", context: {}, call_id: "c1" };
    const dispatch = vi.spyOn(s.store, "dispatch");

    gate.close();
    await turn;
    await flushPromises();

    expect(s.isLoading).toBe(false);
    expect(s.activeToolCall).toBeNull();
    expect(dispatch).toHaveBeenCalledWith("setCurrentChatTimestamp", expect.anything());
    dispatch.mockRestore();
  });

  it("leaves an instance that is not streaming untouched", async () => {
    const owner = mountTracked();
    const o = owner.vm as any;
    const gate = gatedResponse();
    mockFetchAiChat.mockResolvedValueOnce(gate.response);
    o.inputMessage = "hello";
    const turn = o.sendMessage();
    await flushPromises();

    // Never detached, so this instance loads the IndexedDB snapshot and simply
    // shares the session id — it is not showing that stream.
    const other = mountTracked();
    const s = other.vm as any;
    mockLoadChat.mockResolvedValueOnce({
      sessionId: o.currentSessionId,
      title: "snapshot",
      messages: [{ role: "user", content: "hello" }],
    });
    await s.loadChat(9);
    await flushPromises();
    expect(s.isLoading).toBe(false);
    s.activeToolCall = { tool: "Leftover", message: "m", context: {}, call_id: "x" };

    gate.close();
    await turn;
    await flushPromises();

    expect(s.activeToolCall).not.toBeNull();
  });

  it("aborts the oldest parked stream once the cap is reached", async () => {
    const gates: Array<{ close: () => void }> = [];
    for (let i = 0; i < 4; i++) {
      const parked = await parkStream();
      gates.push(parked.gate);
    }

    const signals = mockFetchAiChat.mock.calls.map((c: any[]) => c[3]);
    expect(signals).toHaveLength(4);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    expect(signals[2].aborted).toBe(false);
    expect(signals[3].aborted).toBe(false);

    for (const g of gates) g.close();
    await flushPromises();
  });
});

describe("O2AIChat streaming render throttle", () => {
  let wrapper: VueWrapper;
  let vm: any;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    wrapper = mountO2AIChat();
    vm = wrapper.vm as any;
    window.dispatchEvent(new Event("o2:abort-ai-streams"));
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
    mockSaveToHistory.mockResolvedValue(42);
  });

  /** Visible rendered markdown of the assistant turn, as the user sees it. */
  function painted(w: VueWrapper): string {
    return w
      .findAll(".message.assistant .text-block")
      .map((n) => n.text())
      .join("\n");
  }

  it("paints streamed text into the DOM while the stream is still open", async () => {
    const gate = gatedResponse();
    mockFetchAiChat.mockResolvedValueOnce(gate.response);
    vm.inputMessage = "hello";
    const turn = vm.sendMessage();
    await flushPromises();

    gate.push(sse({ type: "message_delta", content: "the p99 is " }));
    await flushPromises();
    await wrapper.vm.$nextTick();
    expect(painted(wrapper)).toContain("the p99 is");

    gate.push(sse({ type: "message_delta", content: "4.2 seconds" }));
    await flushPromises();
    await wrapper.vm.$nextTick();
    expect(painted(wrapper)).toContain("the p99 is 4.2 seconds");

    gate.close();
    await turn;
  });

  it("paints a streamed code fence as a highlighted code block", async () => {
    await stream(vm, [
      sse({ type: "message_delta", content: "here:\n\n```sql\nSELECT 1\n```\n" }),
    ]);
    await wrapper.vm.$nextTick();

    const code = wrapper.find(".generated-code-block code");
    expect(code.exists()).toBe(true);
    expect(code.text()).toContain("SELECT 1");
    expect(code.classes()).toContain("sql");
  });

  it("paints each segment of a tool-interrupted answer as its own block", async () => {
    await stream(vm, [
      sse({ type: "message_delta", content: "first segment" }),
      sse({ type: "tool_call", tool: "SearchLogs", message: "Searching", call_id: "c1" }),
      sse({ type: "tool_result", tool: "SearchLogs", call_id: "c1", message: "12 records" }),
      sse({ type: "message_delta", content: "second segment" }),
    ]);
    await wrapper.vm.$nextTick();

    const texts = wrapper.findAll(".message.assistant .text-block").map((n) => n.text());
    expect(texts).toEqual(["first segment", "second segment"]);
  });

  it("never shortens painted text while the typewriter lags behind the stream", async () => {
    const long = "word ".repeat(150).trim();
    const gate = gatedResponse();
    mockFetchAiChat.mockResolvedValueOnce(gate.response);
    vm.inputMessage = "hello";
    const turn = vm.sendMessage();
    await flushPromises();

    gate.push(sse({ type: "message_delta", content: long }));
    await flushPromises();
    await wrapper.vm.$nextTick();
    expect(painted(wrapper)).toContain(long);

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 12));
      await wrapper.vm.$nextTick();
      expect(painted(wrapper)).toContain(long);
    }

    gate.close();
    await turn;
  });

  it("never shortens rendered text while the typewriter lags behind the stream", async () => {
    const long = "x".repeat(600);
    const gate = gatedResponse();
    mockFetchAiChat.mockResolvedValueOnce(gate.response);
    vm.inputMessage = "hello";
    const turn = vm.sendMessage();
    await flushPromises();

    gate.push(sse({ type: "message_delta", content: long }));
    await flushPromises();
    expect(blocks(vm)[0].text).toBe(long);

    // The typewriter reveals a growing prefix of the same segment; the
    // additive-only guard in flushStreamingRenderNow is what stops those
    // prefixes from replacing the full text that already landed.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 12));
      expect(blocks(vm)[0].text).toBe(long);
    }

    gate.close();
    await turn;
    expect(blocks(vm)[0].text).toBe(long);
  });
});
