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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref, type EffectScope } from "vue";

import type { ChatHistoryEntry, ChatMessage } from "@/ts/interfaces/chat";

const { mockFetchAiChat } = vi.hoisted(() => ({ mockFetchAiChat: vi.fn() }));

vi.mock("@/composables/useAiChat", () => ({
  default: () => ({ fetchAiChat: mockFetchAiChat }),
}));
vi.mock("@/utils/zincutils", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getUUIDv7: vi.fn(() => "minted-session"),
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

import { abortBackgroundStreams, useChatStream } from "@/composables/useChatStream";

const scopes: EffectScope[] = [];

const makeStream = () => {
  const chatMessages = ref<ChatMessage[]>([]);
  const options = {
    chatMessages,
    currentChatId: ref<number | null>(null),
    currentTextSegment: ref(""),
    dbSaveToHistory: vi.fn(async () => 1),
    store: {
      state: { selectedOrganization: { identifier: "org" }, API_ENDPOINT: "" },
      dispatch: vi.fn(),
    } as any,
    router: { push: vi.fn() } as any,
    t: ((key: string) => key) as any,
    scrollToBottom: vi.fn(async () => {}),
    scrollToLoadingIndicator: vi.fn(async () => {}),
    autoNavigationPreferences: ref(new Map<number, boolean>()),
    pendingAutoNavigation: ref(true),
    isAutoNavigationEnabled: ref(true) as any,
    saveAutoNavigationPreferences: vi.fn(),
    startAnalyzingRotation: vi.fn(),
    stopAnalyzingRotation: vi.fn(),
    aiGeneratedTitle: ref<string | null>(null),
    animateTitle: vi.fn(),
    displayedStreamingContent: ref(""),
    typewriterAnimationId: ref<number | null>(null),
    resetTypewriterState: vi.fn(),
    animateStreamingText: vi.fn(),
  };
  const scope = effectScope();
  scopes.push(scope);
  const stream = scope.run(() => useChatStream(options))!;
  return { stream, options, chatMessages };
};

const entry = (sessionId: string): ChatHistoryEntry => ({
  id: 7,
  timestamp: "",
  title: "t" as any,
  messages: [],
  sessionId,
});

describe("useChatStream", () => {
  beforeEach(() => {
    mockFetchAiChat.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    scopes.splice(0).forEach((s) => s.stop());
    abortBackgroundStreams();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("re-attaches a stream detached by another instance to the very same array", () => {
    const home = makeStream();
    const sidebar = makeStream();
    const controller = new AbortController();
    const liveMsgs = home.chatMessages.value;
    home.stream.currentAbortController.value = controller;
    home.stream.currentSessionId.value = "s1";

    home.stream.detachCurrentStream();

    expect(home.stream.currentAbortController.value).toBeNull();
    expect(sidebar.stream.tryReattach(entry("s1"), 7)).toBe(true);
    expect(sidebar.chatMessages.value).toBe(liveMsgs);
    expect(sidebar.stream.currentAbortController.value).toBe(controller);
    expect(sidebar.stream.isLoading.value).toBe(true);
    expect(sidebar.stream.tryReattach(entry("s1"), 7)).toBe(false);
  });

  it("does not re-attach when no stream is registered for the session", () => {
    const { stream, chatMessages } = makeStream();
    const before = chatMessages.value;

    expect(stream.tryReattach(entry("unknown"), 7)).toBe(false);
    expect(chatMessages.value).toBe(before);
    expect(stream.isLoading.value).toBe(false);
  });

  it("abortBackgroundStreams aborts detached streams and forgets them", () => {
    const { stream } = makeStream();
    const controller = new AbortController();
    stream.currentAbortController.value = controller;
    stream.currentSessionId.value = "s2";
    stream.detachCurrentStream();

    abortBackgroundStreams();

    expect(controller.signal.aborted).toBe(true);
    expect(makeStream().stream.tryReattach(entry("s2"), 7)).toBe(false);
  });

  it("sets isLoading and mints the session id before its first await", async () => {
    mockFetchAiChat.mockResolvedValue({ cancelled: true });
    const { stream } = makeStream();

    const turn = stream.runTurn(false, []);

    expect(stream.isLoading.value).toBe(true);
    expect(stream.currentSessionId.value).toBe("minted-session");
    await turn;
  });

  it("CURRENT BEHAVIOR (BUG): a fetch throw skips teardown, leaving loading and the controller set", async () => {
    mockFetchAiChat.mockRejectedValue(new Error("network"));
    const { stream } = makeStream();

    await stream.runTurn(false, []);

    expect(stream.isLoading.value).toBe(true);
    expect(stream.currentAbortController.value).not.toBeNull();
  });

  it("disposeRenderFlush drops a pending trailing render", async () => {
    vi.useFakeTimers();
    const { stream, options, chatMessages } = makeStream();
    chatMessages.value = [
      { role: "assistant", content: "" as any, contentBlocks: [{ type: "text", text: "" }] },
    ];
    const block = () => chatMessages.value[0].contentBlocks![0];
    stream.isLoading.value = true;

    options.displayedStreamingContent.value = "a";
    await nextTick();
    expect(block().text).toBe("a");

    options.displayedStreamingContent.value = "ab";
    await nextTick();
    stream.disposeRenderFlush();
    vi.advanceTimersByTime(500);

    expect(block().text).toBe("a");
  });
});
