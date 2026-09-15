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

// Characterization tests for everything OUTSIDE the SSE reader loop:
// persistence, organization switch, feedback, title edit, clear-all, the
// unmount handoff, the module-scope stream registry, and the props watchers.
// The SSE protocol itself lives in O2AIChat.stream.spec.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

// ── Module mocks (hoisted) ───────────────────────────────────────────────────

vi.mock("highlight.js", () => ({
  default: {
    highlight: vi.fn(() => ({ value: "" })),
    highlightAuto: vi.fn(() => ({ value: "" })),
    getLanguage: vi.fn(() => null),
    registerLanguage: vi.fn(),
  },
}));

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
const { mockFetchAiChat, mockSubmitFeedback, mockRouterPush, uuidSeq, routeState } = vi.hoisted(
  () => ({
    mockFetchAiChat: vi.fn(),
    mockSubmitFeedback: vi.fn().mockResolvedValue(true),
    mockRouterPush: vi.fn().mockResolvedValue(undefined),
    // A constant uuid makes every session-identity assertion vacuous: the second
    // session would be indistinguishable from the one it replaced.
    uuidSeq: { n: 0 },
    routeState: { fullPath: "/", path: "/", name: "home", query: {}, params: {} },
  }),
);

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
  useRoute: vi.fn(() => routeState),
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

// ── Stubs ────────────────────────────────────────────────────────────────────

const baseStubs = {
  RichTextInput: {
    name: "RichTextInput",
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

/** Collects every chip the component pushes into the rich-text input. */
const insertedChips: any[] = [];

const chipStubs = {
  ...baseStubs,
  RichTextInput: {
    ...baseStubs.RichTextInput,
    methods: {
      // processPendingChips calls focusInput() first; without it the stub takes
      // the `.focus()` fallback, throws, and no chip is ever inserted.
      focusInput() {},
      insertChip(chip: any) {
        insertedChips.push(chip);
      },
    },
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function sse(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
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

/** A reader the test feeds by hand, so a turn can be held open mid-stream. */
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

function mountO2AIChat(props: Record<string, unknown> = {}, stubs: any = baseStubs) {
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

/** Run one complete turn: `chunks` are replayed, then the stream ends. */
async function turn(vm: any, chunks: string[] = [], text = "how many errors today") {
  mockFetchAiChat.mockResolvedValueOnce(readerResponse(chunks));
  vm.inputMessage = text;
  await vm.sendMessage();
  await flushPromises();
}

/** Start a turn and leave it streaming; returns the gate and its abort signal. */
async function openTurn(vm: any, text = "long running query") {
  const gate = gatedResponse();
  mockFetchAiChat.mockResolvedValueOnce(gate.response);
  vm.inputMessage = text;
  void vm.sendMessage();
  await flushPromises();
  const signal = mockFetchAiChat.mock.calls[mockFetchAiChat.mock.calls.length - 1][3];
  return { gate, signal };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ORG_DEFAULT = {
  label: "default Organization",
  id: 159,
  identifier: "default",
  user_email: "example@gmail.com",
  subscription_type: "",
};

async function switchOrg(identifier: string) {
  store.dispatch("setSelectedOrganization", { ...ORG_DEFAULT, identifier, label: identifier });
  await flushPromises();
}

const lastCall = (m: any) => m.mock.calls[m.mock.calls.length - 1];

// ── Tests ────────────────────────────────────────────────────────────────────

describe("O2AIChat session, persistence and lifecycle", () => {
  let wrapper: VueWrapper | null;
  let vm: any;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    uuidSeq.n = 0;
    routeState.name = "home";
    insertedChips.length = 0;
    localStorage.clear();
    store.dispatch("setSelectedOrganization", { ...ORG_DEFAULT });
    store.dispatch("setCurrentChatTimestamp", null);
    store.dispatch("setChatUpdated", false);
    store.dispatch("setIsAiChatEnabled", false);
    wrapper = mountO2AIChat();
    vm = wrapper.vm as any;
    // backgroundStreams / backgroundStreamMap / sessionStreamingState are module
    // scope and outlive every unmount; this listener is the only public reset.
    window.dispatchEvent(new Event("o2:abort-ai-streams"));
  });

  afterEach(() => {
    window.dispatchEvent(new Event("o2:abort-ai-streams"));
    wrapper?.unmount();
    wrapper = null;
    vi.clearAllMocks();
    mockSaveToHistory.mockResolvedValue(42);
    mockLoadHistory.mockResolvedValue([]);
    mockLoadChat.mockResolvedValue(null);
    mockClearAllHistory.mockResolvedValue(true);
    mockUpdateChatTitle.mockResolvedValue(true);
    mockSubmitFeedback.mockResolvedValue(true);
  });

  // ── 1. Persistence ─────────────────────────────────────────────────────────

  describe("saveToHistory", () => {
    it("mints a session id and hands the transcript to the history composable", async () => {
      await turn(vm);

      expect(mockSaveToHistory).toHaveBeenCalled();
      const [msgs, sessionId] = mockSaveToHistory.mock.calls[0];
      expect(msgs[0].role).toBe("user");
      expect(String(msgs[0].content)).toBe("how many errors today");
      expect(sessionId).toBe("uuid-1");
      expect(vm.currentSessionId).toBe("uuid-1");
    });

    it("reuses the existing session id on the next turn instead of minting a new one", async () => {
      await turn(vm, [], "first");
      await turn(vm, [], "second");

      const ids = mockSaveToHistory.mock.calls.map((c: any[]) => c[1]);
      expect(ids.length).toBeGreaterThan(1);
      expect(new Set(ids)).toEqual(new Set(["uuid-1"]));
    });

    it("adopts the chat id returned by the composable for a brand new chat", async () => {
      expect(vm.currentChatId).toBeNull();

      await turn(vm);

      expect(vm.currentChatId).toBe(42);
    });

    it("passes null for a new chat and the adopted id on every later save", async () => {
      await turn(vm, [], "first");
      await turn(vm, [], "second");

      expect(mockSaveToHistory.mock.calls[0][3]).toBeNull();
      expect(lastCall(mockSaveToHistory)[3]).toBe(42);
    });

    it("sends the AI generated title through to the composable", async () => {
      vm.aiGeneratedTitle = "Error budget review";

      await turn(vm);

      expect(mockSaveToHistory.mock.calls[0][2]).toBe("Error budget review");
    });

    it("falls back to an undefined title when no title has been generated", async () => {
      vm.aiGeneratedTitle = "";

      await turn(vm);

      expect(mockSaveToHistory.mock.calls[0][2]).toBeUndefined();
    });

    it("persists the auto navigation preference under the newly adopted chat id", async () => {
      await turn(vm);

      expect(JSON.parse(localStorage.getItem("ai-chat-auto-navigation") || "{}")).toEqual({
        "42": true,
      });
    });

    it("carries an explicit opt-out of auto navigation onto the new chat id", async () => {
      vm.isAutoNavigationEnabled = false;

      await turn(vm);

      expect(JSON.parse(localStorage.getItem("ai-chat-auto-navigation") || "{}")).toEqual({
        "42": false,
      });
      expect(vm.isAutoNavigationEnabled).toBe(false);
    });

    it("does not rewrite the preference once the chat already has an id", async () => {
      await turn(vm, [], "first");
      localStorage.removeItem("ai-chat-auto-navigation");

      await turn(vm, [], "second");

      expect(localStorage.getItem("ai-chat-auto-navigation")).toBeNull();
    });

    it("swallows a persistence failure and leaves the chat usable", async () => {
      mockSaveToHistory.mockRejectedValueOnce(new Error("quota exceeded"));

      await turn(vm);

      expect(vm.currentChatId).toBeNull();
      expect(vm.saveHistoryLoading).toBe(false);
      // No chat id was adopted, so no preference row was written either.
      expect(localStorage.getItem("ai-chat-auto-navigation")).toBeNull();
    });
  });

  // ── 2. Organization switch ─────────────────────────────────────────────────

  describe("organization switch", () => {
    it("drops the current chat identity so no row is written under the new org", async () => {
      await turn(vm);
      expect(vm.currentChatId).toBe(42);
      expect(vm.currentSessionId).toBe("uuid-1");

      await switchOrg("other-org");

      expect(vm.currentChatId).toBeNull();
      expect(vm.currentSessionId).toBeNull();
      expect(vm.chatMessages).toHaveLength(0);
    });

    it("closes the history drawer so the previous org's list is not left on screen", async () => {
      vm.showHistory = true;

      await switchOrg("other-org");

      expect(vm.showHistory).toBe(false);
    });

    it("reloads history for the new org while the panel is open", async () => {
      mockLoadHistory.mockClear();

      await switchOrg("other-org");

      expect(mockLoadHistory).toHaveBeenCalled();
    });

    it("does not reload history when the panel is closed", async () => {
      wrapper?.unmount();
      wrapper = mountO2AIChat({ isOpen: false });
      vm = wrapper.vm;
      mockLoadHistory.mockClear();

      await switchOrg("other-org");

      expect(mockLoadHistory).not.toHaveBeenCalled();
      expect(vm.currentSessionId).toBeNull();
    });

    it("aborts a stream that was already detached under the old org", async () => {
      const { signal } = await openTurn(vm);
      vm.addNewChat();
      expect(signal.aborted).toBe(false);

      await switchOrg("other-org");

      expect(signal.aborted).toBe(true);
    });

    it("CURRENT BEHAVIOR (BUG): the foreground turn survives the org switch instead of being aborted", async () => {
      const { signal } = await openTurn(vm);

      await switchOrg("other-org");

      // abortBackgroundStreams() runs BEFORE addNewChat(), and addNewChat ->
      // detachCurrentStream() then moves the still-live foreground controller
      // into the freshly emptied background set, so nothing aborts it.
      expect(signal.aborted).toBe(false);
    });

    it("ignores a store write that does not change the organization identifier", async () => {
      await turn(vm);
      mockLoadHistory.mockClear();

      store.dispatch("setSelectedOrganization", { ...ORG_DEFAULT, label: "renamed" });
      await flushPromises();

      expect(mockLoadHistory).not.toHaveBeenCalled();
      expect(vm.currentChatId).toBe(42);
    });
  });

  // ── 3. Feedback and lastTraceId ────────────────────────────────────────────

  describe("feedback", () => {
    const answered = async (v: any, traceId = "trace-abc", text = "q1") =>
      turn(
        v,
        [
          sse({ type: "message_delta", content: "42 errors" }),
          sse({ type: "complete", trace_id: traceId }),
        ],
        text,
      );

    it("submits a thumbs up with the session id, query index and last trace id", async () => {
      await answered(vm);

      await vm.likeCodeBlock(1);

      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        "thumbs_up",
        "default",
        "uuid-1",
        0,
        "trace-abc",
      );
    });

    it("submits a thumbs down with the same identity", async () => {
      await answered(vm);

      await vm.dislikeCodeBlock(1);

      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        "thumbs_down",
        "default",
        "uuid-1",
        0,
        "trace-abc",
      );
    });

    it("derives the query index from the message position, one turn per pair", async () => {
      await answered(vm, "trace-1", "q1");
      await answered(vm, "trace-2", "q2");

      await vm.likeCodeBlock(3);

      expect(lastCall(mockSubmitFeedback)[3]).toBe(1);
      expect(lastCall(mockSubmitFeedback)[4]).toBe("trace-2");
    });

    it("records the verdict on the message and persists it", async () => {
      await answered(vm);
      mockSaveToHistory.mockClear();

      await vm.likeCodeBlock(1);

      expect(vm.chatMessages[1].feedback).toBe("thumbs_up");
      expect(mockSaveToHistory).toHaveBeenCalled();
    });

    it("does not resubmit a verdict that is already recorded", async () => {
      await answered(vm);
      await vm.likeCodeBlock(1);
      mockSubmitFeedback.mockClear();

      await vm.likeCodeBlock(1);

      expect(mockSubmitFeedback).not.toHaveBeenCalled();
    });

    it("leaves the message untouched when the feedback call reports failure", async () => {
      await answered(vm);
      mockSubmitFeedback.mockResolvedValueOnce(false);
      mockSaveToHistory.mockClear();

      await vm.likeCodeBlock(1);

      expect(vm.chatMessages[1].feedback).toBeUndefined();
      expect(mockSaveToHistory).not.toHaveBeenCalled();
    });

    it("skips feedback entirely when no organization is selected", async () => {
      await answered(vm);
      store.dispatch("setSelectedOrganization", { ...ORG_DEFAULT, identifier: "" });
      await flushPromises();

      await vm.likeCodeBlock(1);

      expect(mockSubmitFeedback).not.toHaveBeenCalled();
    });

    it("ignores an index that points at no message", async () => {
      await answered(vm);

      await vm.likeCodeBlock(99);

      expect(mockSubmitFeedback).not.toHaveBeenCalled();
    });

    it("sends an undefined trace id when the turn produced no complete event", async () => {
      await turn(vm, [sse({ type: "message_delta", content: "no trace here" })]);

      await vm.likeCodeBlock(1);

      expect(lastCall(mockSubmitFeedback)[4]).toBeUndefined();
    });

    it("forgets the trace id when a new chat is started", async () => {
      await answered(vm);
      vm.addNewChat();
      await flushPromises();
      await turn(vm, [sse({ type: "message_delta", content: "fresh" })], "q2");

      await vm.likeCodeBlock(1);

      expect(lastCall(mockSubmitFeedback)[4]).toBeUndefined();
    });

    it("CURRENT BEHAVIOR (BUG): a transcript that is not strictly alternating reports the wrong query index", async () => {
      await answered(vm);
      // Two assistant messages for one user query is what the error paths leave
      // behind; floor(index / 2) then attributes the second one to turn 1.
      vm.chatMessages.push({ role: "assistant", content: "follow up" });
      await flushPromises();

      await vm.likeCodeBlock(2);

      expect(lastCall(mockSubmitFeedback)[3]).toBe(1);
    });
  });

  // ── 4. Title edit round trip ───────────────────────────────────────────────

  describe("title editing", () => {
    it("writes the trimmed title and refreshes the sidebar list from storage", async () => {
      await turn(vm);
      vm.openEditTitleDialog();
      vm.editingTitle = "  Renamed chat  ";
      mockLoadHistory.mockClear();
      mockLoadHistory.mockResolvedValueOnce([
        { id: 42, title: "Renamed chat", timestamp: 1, messages: [] },
      ]);

      await vm.saveEditedTitle();
      await flushPromises();

      expect(mockUpdateChatTitle).toHaveBeenCalledWith(42, "Renamed chat");
      expect(mockLoadHistory).toHaveBeenCalledTimes(1);
      expect(vm.chatHistory[0].title).toBe("Renamed chat");
    });

    it("updates the header title in place", async () => {
      await turn(vm);
      vm.editingTitle = "Renamed chat";

      await vm.saveEditedTitle();

      expect(vm.displayedTitle).toBe("Renamed chat");
      expect(vm.aiGeneratedTitle).toBe("Renamed chat");
      expect(vm.showEditTitleDialog).toBe(false);
    });

    it("seeds the edit field from the title currently on screen", async () => {
      await turn(vm);
      vm.displayedTitle = "Original";

      vm.openEditTitleDialog();

      expect(vm.editingTitle).toBe("Original");
      expect(vm.showEditTitleDialog).toBe(true);
    });

    it("leaves the title alone and skips the reload when the write fails", async () => {
      await turn(vm);
      vm.displayedTitle = "Original";
      vm.editingTitle = "Renamed chat";
      mockUpdateChatTitle.mockResolvedValueOnce(false);
      mockLoadHistory.mockClear();

      await vm.saveEditedTitle();

      expect(vm.displayedTitle).toBe("Original");
      expect(mockLoadHistory).not.toHaveBeenCalled();
      expect(vm.showEditTitleDialog).toBe(false);
    });

    it("does not call the composable for a blank title or an unsaved chat", async () => {
      vm.editingTitle = "Only whitespace is not a title";
      // currentChatId is still null: the chat was never persisted.
      await vm.saveEditedTitle();
      expect(mockUpdateChatTitle).not.toHaveBeenCalled();

      await turn(vm);
      vm.editingTitle = "   ";
      await vm.saveEditedTitle();

      expect(mockUpdateChatTitle).not.toHaveBeenCalled();
      expect(vm.showEditTitleDialog).toBe(false);
    });
  });

  // ── 5. Clear all ───────────────────────────────────────────────────────────

  describe("clear all conversations", () => {
    it("clears storage, empties the sidebar list and resets to a new chat", async () => {
      mockLoadHistory.mockResolvedValueOnce([{ id: 1, title: "Old", timestamp: 1, messages: [] }]);
      await vm.loadHistory();
      await turn(vm);
      vm.showClearAllConfirmDialog = true;

      await vm.confirmClearAllConversations();

      expect(mockClearAllHistory).toHaveBeenCalled();
      expect(vm.chatHistory).toEqual([]);
      expect(vm.chatMessages).toEqual([]);
      expect(vm.currentChatId).toBeNull();
      expect(vm.currentSessionId).toBeNull();
      expect(vm.showClearAllConfirmDialog).toBe(false);
    });

    it("keeps the loaded chat when the composable reports failure", async () => {
      mockLoadHistory.mockResolvedValueOnce([{ id: 1, title: "Old", timestamp: 1, messages: [] }]);
      await vm.loadHistory();
      await turn(vm);
      mockClearAllHistory.mockResolvedValueOnce(false);

      await vm.confirmClearAllConversations();

      expect(vm.chatHistory).toHaveLength(1);
      expect(vm.currentChatId).toBe(42);
      expect(vm.showClearAllConfirmDialog).toBe(false);
    });

    it("closes the dialog even when the composable throws", async () => {
      vm.showClearAllConfirmDialog = true;
      mockClearAllHistory.mockRejectedValueOnce(new Error("db closed"));

      await vm.confirmClearAllConversations();

      expect(vm.showClearAllConfirmDialog).toBe(false);
    });
  });

  // ── 6. Unmount ordering ────────────────────────────────────────────────────

  describe("unmount handoff", () => {
    it("hands a live turn to the surviving instance through the store pulse", async () => {
      const survivor = mountO2AIChat({ isOpen: false });
      const survivorVm: any = survivor.vm;
      await openTurn(vm);
      expect(vm.currentChatId).toBe(42);
      mockLoadChat.mockResolvedValue({ id: 42, sessionId: "uuid-1", title: "T", messages: [] });
      mockLoadChat.mockClear();

      wrapper?.unmount();
      wrapper = null;
      await flushPromises();

      expect(mockLoadChat).toHaveBeenCalledWith(42);
      expect(survivorVm.currentSessionId).toBe("uuid-1");
      expect(survivorVm.isLoading).toBe(true);
      survivor.unmount();
    });

    it("publishes the current chat id and then the update pulse, in that order", async () => {
      await turn(vm);
      const dispatchSpy = vi.spyOn(store, "dispatch");

      wrapper?.unmount();
      wrapper = null;

      const calls = dispatchSpy.mock.calls;
      expect(calls[calls.length - 2]).toEqual(["setCurrentChatTimestamp", 42]);
      expect(calls[calls.length - 1]).toEqual(["setChatUpdated", true]);
      dispatchSpy.mockRestore();
    });

    it("a live instance does act on the handoff pulse", async () => {
      const other = mountO2AIChat({ isOpen: false });
      store.dispatch("setCurrentChatTimestamp", 77);
      mockLoadChat.mockClear();

      store.dispatch("setChatUpdated", true);
      await flushPromises();

      expect(mockLoadChat).toHaveBeenCalledWith(77);
      other.unmount();
    });

    it("detaches rather than aborts an in-flight turn so another instance can pick it up", async () => {
      const { signal } = await openTurn(vm);

      wrapper?.unmount();
      wrapper = null;
      await flushPromises();

      expect(signal.aborted).toBe(false);
    });

    it("registers the detached turn so a fresh instance re-attaches to it", async () => {
      await openTurn(vm);
      expect(vm.currentSessionId).toBe("uuid-1");
      wrapper?.unmount();

      wrapper = mountO2AIChat({ isOpen: false });
      vm = wrapper.vm;
      mockLoadChat.mockResolvedValueOnce({
        id: 42,
        sessionId: "uuid-1",
        title: "T",
        messages: [],
      });
      await vm.loadChat(42);
      await flushPromises();

      expect(vm.currentSessionId).toBe("uuid-1");
      expect(vm.isLoading).toBe(true);
    });

    it("stops listening for the global abort event once unmounted", async () => {
      const { signal } = await openTurn(vm);
      wrapper?.unmount();
      wrapper = null;
      await flushPromises();

      window.dispatchEvent(new Event("o2:abort-ai-streams"));

      expect(signal.aborted).toBe(false);
    });

    it("opens the sidebar when a centered instance leaves the home route mid-stream", async () => {
      wrapper?.unmount();
      wrapper = mountO2AIChat({ centeredStart: true });
      vm = wrapper.vm;
      await openTurn(vm);
      routeState.name = "logs";

      wrapper.unmount();
      wrapper = null;

      expect(store.state.isAiChatEnabled).toBe(true);
    });

    it("leaves the sidebar closed when the user only switched home tabs", async () => {
      wrapper?.unmount();
      wrapper = mountO2AIChat({ centeredStart: true });
      vm = wrapper.vm;
      await openTurn(vm);
      routeState.name = "home";

      wrapper.unmount();
      wrapper = null;

      expect(store.state.isAiChatEnabled).toBe(false);
    });

    it("leaves the sidebar closed when nothing was streaming", async () => {
      wrapper?.unmount();
      wrapper = mountO2AIChat({ centeredStart: true });
      vm = wrapper.vm;
      await turn(vm);
      routeState.name = "logs";

      wrapper.unmount();
      wrapper = null;

      expect(store.state.isAiChatEnabled).toBe(false);
    });
  });

  // ── 7. Cross-instance stream registry ──────────────────────────────────────

  describe("background stream registry", () => {
    it("evicts the oldest background stream past the cap of three", async () => {
      const signals: any[] = [];
      for (let i = 0; i < 4; i++) {
        const { signal } = await openTurn(vm, `q${i}`);
        signals.push(signal);
        vm.addNewChat();
        await flushPromises();
      }

      expect(signals[0].aborted).toBe(true);
      expect(signals.slice(1).map((s) => s.aborted)).toEqual([false, false, false]);
    });

    it("keeps three detached streams alive", async () => {
      const signals: any[] = [];
      for (let i = 0; i < 3; i++) {
        const { signal } = await openTurn(vm, `q${i}`);
        signals.push(signal);
        vm.addNewChat();
        await flushPromises();
      }

      expect(signals.map((s) => s.aborted)).toEqual([false, false, false]);
    });

    it("the global abort event kills the foreground turn as well as the detached ones", async () => {
      const detached = await openTurn(vm, "detached");
      vm.addNewChat();
      await flushPromises();
      const foreground = await openTurn(vm, "foreground");

      window.dispatchEvent(new Event("o2:abort-ai-streams"));

      expect(detached.signal.aborted).toBe(true);
      expect(foreground.signal.aborted).toBe(true);
      expect(vm.currentAbortController).toBeNull();
    });

    it("a re-attached instance clears its own spinner when the owning instance finishes", async () => {
      const { gate } = await openTurn(vm);
      vm.addNewChat();
      await flushPromises();

      const second = mountO2AIChat({ isOpen: false });
      const vm2: any = second.vm;
      mockLoadChat.mockResolvedValueOnce({
        id: 42,
        sessionId: "uuid-1",
        title: "T",
        messages: [],
      });
      await vm2.loadChat(42);
      await flushPromises();
      await flushPromises();
      expect(vm2.isLoading).toBe(true);
      // Clear the handshake value loadChat just published so the only writer
      // left is the registry watcher itself.
      store.dispatch("setCurrentChatTimestamp", null);
      store.dispatch("setChatUpdated", false);
      await flushPromises();

      gate.close();
      await flushPromises();
      await flushPromises();

      expect(vm2.isLoading).toBe(false);
      expect(store.state.currentChatTimestamp).toBe(42);
      second.unmount();
    });

    it("the detached turn keeps writing into its own array, not the new session", async () => {
      const { gate } = await openTurn(vm);
      vm.addNewChat();
      await flushPromises();

      gate.push(sse({ type: "message_delta", content: "late answer" }));
      gate.close();
      await flushPromises();

      expect(vm.chatMessages).toHaveLength(0);
    });
  });

  // ── 8. Props ───────────────────────────────────────────────────────────────

  describe("props", () => {
    it("sends a payload that asks to be auto sent", async () => {
      mockFetchAiChat.mockResolvedValueOnce(readerResponse([]));

      await wrapper?.setProps({ aiChatPayload: { text: "show me slow traces", autoSend: true } });
      await wait(120);
      await flushPromises();

      expect(mockFetchAiChat).toHaveBeenCalled();
      expect(String(vm.chatMessages[0].content)).toBe("show me slow traces");
    });

    it("CURRENT BEHAVIOR: a payload with autoSend false is dropped, not staged in the input", async () => {
      await wrapper?.setProps({ aiChatPayload: { text: "never sent", autoSend: false } });
      await wait(120);
      await flushPromises();

      expect(mockFetchAiChat).not.toHaveBeenCalled();
      expect(vm.inputMessage).toBe("");
      expect(vm.chatMessages).toHaveLength(0);
    });

    it("ignores a payload with no text", async () => {
      await wrapper?.setProps({ aiChatPayload: { text: "", autoSend: true } });
      await wait(120);
      await flushPromises();

      expect(mockFetchAiChat).not.toHaveBeenCalled();
    });

    it("turns an input context into a reference chip and inserts it", async () => {
      wrapper?.unmount();
      wrapper = mountO2AIChat({}, chipStubs);
      await flushPromises();
      await wait(150);

      await wrapper.setProps({ aiChatInputContext: "level=error msg=boom" });
      await wait(120);
      await flushPromises();

      expect(insertedChips).toHaveLength(1);
      expect(insertedChips[0]).toMatchObject({
        filename: "Log Entry",
        type: "context",
        fullContent: "level=error msg=boom",
        charCount: 20,
      });
    });

    it("queues a chip that arrives before the panel is ready and flushes it on open", async () => {
      wrapper?.unmount();
      wrapper = mountO2AIChat({ isOpen: false, aiChatInputContext: "" }, chipStubs);
      await flushPromises();

      await wrapper.setProps({ aiChatInputContext: "queued while closed" });
      await wait(120);
      expect(insertedChips).toHaveLength(0);

      await wrapper.setProps({ isOpen: true });
      await wait(200);
      await flushPromises();

      expect(insertedChips).toHaveLength(1);
      expect(insertedChips[0].fullContent).toBe("queued while closed");
    });

    it("truncates the chip preview well below the full context", async () => {
      wrapper?.unmount();
      wrapper = mountO2AIChat({}, chipStubs);
      await flushPromises();
      await wait(150);

      const long = "a".repeat(200);
      await wrapper.setProps({ aiChatInputContext: long });
      await wait(120);
      await flushPromises();

      expect(insertedChips[0].preview.length).toBeLessThanOrEqual(13);
      expect(insertedChips[0].charCount).toBe(200);
    });
  });
});
