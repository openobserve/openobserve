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

// Written against the pre-extraction component: prompt history, auto navigation, scroll, image-chip Backspace.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

vi.mock("highlight.js", () => ({
  default: {
    highlight: vi.fn(() => ({ value: "" })),
    highlightAuto: vi.fn(() => ({ value: "" })),
    getLanguage: vi.fn(() => null),
    registerLanguage: vi.fn(),
  },
}));

const { mockFetchAiChat, mockSaveToHistory } = vi.hoisted(() => ({
  mockFetchAiChat: vi.fn(),
  mockSaveToHistory: vi.fn(),
}));

vi.mock("@/composables/useChatHistory", () => ({
  useChatHistory: vi.fn(() => ({
    saveToHistory: mockSaveToHistory,
    loadHistory: vi.fn().mockResolvedValue([]),
    loadChat: vi.fn().mockResolvedValue(null),
    deleteChatById: vi.fn().mockResolvedValue(true),
    clearAllHistory: vi.fn().mockResolvedValue(true),
    updateChatTitle: vi.fn().mockResolvedValue(true),
  })),
}));

vi.mock("@/composables/useAiChat", () => ({
  default: vi.fn(() => ({
    fetchAiChat: mockFetchAiChat,
    submitFeedback: vi.fn().mockResolvedValue(true),
    registerAiChatHandler: vi.fn(),
    removeAiChatHandler: vi.fn(),
    getStructuredContext: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));

vi.mock("vue-router", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), currentRoute: { value: { path: "/" } } })),
  useRoute: vi.fn(() => ({ fullPath: "/", path: "/", name: "home", query: {}, params: {} })),
}));

vi.mock("dompurify", () => ({ default: { sanitize: vi.fn((html: string) => html) } }));

vi.mock("@/composables/contextProviders", () => ({
  contextRegistry: { getActiveContext: vi.fn().mockResolvedValue(null) },
  createDefaultContextProvider: vi.fn(),
}));

import O2AIChat from "./O2AIChat.vue";

const HISTORY_KEY = "ai-chat-query-history";
const AUTO_NAV_KEY = "ai-chat-auto-navigation";

const stubs = {
  RichTextInput: {
    name: "RichTextInput",
    template: '<div data-test="rich-text-input" />',
    props: ["modelValue", "placeholder", "disabled", "theme", "references", "borderless"],
    emits: ["update:modelValue", "keydown", "submit", "update:references"],
  },
};

let wrapper: VueWrapper<any> | null = null;

const mountChat = async () => {
  wrapper = mount(O2AIChat, {
    global: { plugins: [store, i18n], stubs },
    props: { isOpen: true, headerHeight: 0, aiChatInputContext: "", appendMode: true },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper.vm as any;
};

const key = (k: string, target: EventTarget) => {
  const e = new KeyboardEvent("keydown", { key: k, cancelable: true });
  Object.defineProperty(e, "target", { value: target });
  return e;
};

const textareaAt = (value: string, cursor = value.length) => {
  const ta = document.createElement("textarea");
  ta.value = value;
  document.body.appendChild(ta);
  ta.selectionStart = ta.selectionEnd = cursor;
  return ta;
};

const chip = (text: string) => {
  const span = document.createElement("span");
  span.className = "image-reference";
  span.contentEditable = "false";
  span.textContent = text;
  return span;
};

const img = (filename: string) => ({ data: "x", mimeType: "image/png", filename, size: 1 });

const placeCaret = (node: Node, offset: number) => {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
};

beforeEach(() => {
  localStorage.clear();
  mockFetchAiChat.mockReset().mockRejectedValue(new Error("offline"));
  mockSaveToHistory.mockReset().mockResolvedValue(42);
  store.state.currentChatTimestamp = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("prompt history (ArrowUp / ArrowDown)", () => {
  it("recalls stored prompts newest-first and walks back down to an empty input", async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(["newest", "older", "oldest"]));
    const vm = await mountChat();
    const ta = textareaAt("");

    const up1 = key("ArrowUp", ta);
    vm.handleKeyDown(up1);
    expect(up1.defaultPrevented).toBe(true);
    expect(vm.inputMessage).toBe("newest");

    vm.handleKeyDown(key("ArrowUp", ta));
    vm.handleKeyDown(key("ArrowUp", ta));
    expect(vm.inputMessage).toBe("oldest");

    const beyond = key("ArrowUp", ta);
    vm.handleKeyDown(beyond);
    expect(beyond.defaultPrevented).toBe(true);
    expect(vm.inputMessage).toBe("oldest");

    vm.handleKeyDown(key("ArrowDown", ta));
    expect(vm.inputMessage).toBe("older");
    vm.handleKeyDown(key("ArrowDown", ta));
    expect(vm.inputMessage).toBe("newest");

    const toEmpty = key("ArrowDown", ta);
    vm.handleKeyDown(toEmpty);
    expect(toEmpty.defaultPrevented).toBe(true);
    expect(vm.inputMessage).toBe("");

    vm.inputMessage = "draft";
    const idle = key("ArrowDown", ta);
    vm.handleKeyDown(idle);
    expect(idle.defaultPrevented).toBe(false);
    expect(vm.inputMessage).toBe("draft");
  });

  it("ignores ArrowUp when the caret is below the first line or the target is not a textarea", async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(["prev"]));
    const vm = await mountChat();
    vm.inputMessage = "draft";

    const below = key("ArrowUp", textareaAt("line1\nline2"));
    vm.handleKeyDown(below);
    expect(below.defaultPrevented).toBe(false);

    const div = document.createElement("div");
    const onDiv = key("ArrowUp", div);
    vm.handleKeyDown(onDiv);
    expect(onDiv.defaultPrevented).toBe(false);
    expect(vm.inputMessage).toBe("draft");

    const firstLine = key("ArrowUp", textareaAt("line1\nline2", 3));
    vm.handleKeyDown(firstLine);
    expect(firstLine.defaultPrevented).toBe(true);
    expect(vm.inputMessage).toBe("prev");
  });

  it("prevents ArrowUp on the first line even with an empty history, leaving ArrowDown inert", async () => {
    const vm = await mountChat();
    vm.inputMessage = "draft";
    const ta = textareaAt("draft");
    const up = key("ArrowUp", ta);
    vm.handleKeyDown(up);
    expect(up.defaultPrevented).toBe(true);
    expect(vm.inputMessage).toBe("draft");
    const down = key("ArrowDown", ta);
    vm.handleKeyDown(down);
    expect(down.defaultPrevented).toBe(false);
  });

  it("treats corrupt stored history as empty", async () => {
    localStorage.setItem(HISTORY_KEY, "{not json");
    const vm = await mountChat();
    vm.inputMessage = "draft";
    vm.handleKeyDown(key("ArrowUp", textareaAt("")));
    expect(vm.inputMessage).toBe("draft");
    expect(console.error).toHaveBeenCalledWith("Error loading query history:", expect.anything());
  });

  it("records a sent prompt trimmed, deduplicated to the front, capped at 10, and resets the cursor", async () => {
    const stored = Array.from({ length: 10 }, (_, i) => `q${i}`);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(stored));
    const vm = await mountChat();
    const ta = textareaAt("");

    vm.handleKeyDown(key("ArrowUp", ta));
    vm.inputMessage = "  q5  ";
    await vm.sendMessage();
    await flushPromises();

    const after = JSON.parse(localStorage.getItem(HISTORY_KEY)!);
    expect(after).toEqual(["q5", "q0", "q1", "q2", "q3", "q4", "q6", "q7", "q8", "q9"]);
    const down = key("ArrowDown", ta);
    vm.handleKeyDown(down);
    expect(down.defaultPrevented).toBe(false);

    // A rejected fetchAiChat returns before teardown, so isLoading is left true.
    expect(vm.isLoading).toBe(true);
    vm.isLoading = false;
    vm.inputMessage = "fresh";
    await vm.sendMessage();
    await flushPromises();
    const capped = JSON.parse(localStorage.getItem(HISTORY_KEY)!);
    expect(capped).toHaveLength(10);
    expect(capped[0]).toBe("fresh");
    expect(capped).not.toContain("q9");
  });

  it("does not record an images-only send", async () => {
    const vm = await mountChat();
    vm.pendingImages = [img("a.png")];
    vm.inputMessage = "   ";
    await vm.sendMessage();
    await flushPromises();
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  });
});

describe("auto navigation preferences", () => {
  it("holds a pending value for a new chat without persisting it", async () => {
    const vm = await mountChat();
    expect(vm.isAutoNavigationEnabled).toBe(true);
    vm.isAutoNavigationEnabled = false;
    expect(vm.isAutoNavigationEnabled).toBe(false);
    expect(localStorage.getItem(AUTO_NAV_KEY)).toBeNull();
  });

  it("defaults an unknown chat to on and persists a per-chat choice", async () => {
    const vm = await mountChat();
    vm.currentChatId = 5;
    expect(vm.isAutoNavigationEnabled).toBe(true);
    vm.isAutoNavigationEnabled = false;
    expect(vm.isAutoNavigationEnabled).toBe(false);
    expect(localStorage.getItem(AUTO_NAV_KEY)).toBe('{"5":false}');
  });

  it("loads stored preferences with numeric chat ids", async () => {
    localStorage.setItem(AUTO_NAV_KEY, '{"7":false,"8":true}');
    const vm = await mountChat();
    vm.currentChatId = 7;
    expect(vm.isAutoNavigationEnabled).toBe(false);
    vm.currentChatId = 8;
    expect(vm.isAutoNavigationEnabled).toBe(true);
  });

  it("recovers from corrupt stored preferences", async () => {
    localStorage.setItem(AUTO_NAV_KEY, "{bad");
    const vm = await mountChat();
    vm.currentChatId = 7;
    expect(vm.isAutoNavigationEnabled).toBe(true);
    expect(console.error).toHaveBeenCalledWith(
      "Error loading auto navigation preferences:",
      expect.anything(),
    );
  });

  it("carries the pending choice onto the id minted by the first save", async () => {
    const vm = await mountChat();
    vm.isAutoNavigationEnabled = false;
    vm.inputMessage = "hello";
    await vm.sendMessage();
    await flushPromises();
    expect(vm.currentChatId).toBe(42);
    expect(vm.isAutoNavigationEnabled).toBe(false);
    expect(JSON.parse(localStorage.getItem(AUTO_NAV_KEY)!)).toEqual({ "42": false });
  });

  it("resets the pending choice to on for a new chat", async () => {
    const vm = await mountChat();
    vm.isAutoNavigationEnabled = false;
    vm.addNewChat();
    expect(vm.isAutoNavigationEnabled).toBe(true);
  });
});

describe("scroll state", () => {
  const metrics = (el: HTMLElement, m: { top: number; height: number; client: number }) => {
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: m.height });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: m.client });
    el.scrollTop = m.top;
    Object.defineProperty(el, "scrollTop", { configurable: true, writable: true, value: m.top });
  };

  it("uses a fixed 50 threshold for auto-scroll and 100 for the jump button", async () => {
    const vm = await mountChat();
    const el = vm.messagesContainer as HTMLElement;
    expect(vm.getScrollThreshold()).toBe(50);

    metrics(el, { top: 450, height: 1000, client: 500 });
    vm.checkIfShouldAutoScroll();
    expect(vm.shouldAutoScroll).toBe(true);
    expect(vm.showScrollToBottom).toBe(false);

    metrics(el, { top: 449, height: 1000, client: 500 });
    vm.checkIfShouldAutoScroll();
    expect(vm.shouldAutoScroll).toBe(false);
    expect(vm.showScrollToBottom).toBe(false);

    metrics(el, { top: 399, height: 1000, client: 500 });
    vm.checkIfShouldAutoScroll();
    expect(vm.showScrollToBottom).toBe(true);

    metrics(el, { top: 0, height: 600, client: 500 });
    vm.checkIfShouldAutoScroll();
    expect(vm.showScrollToBottom).toBe(false);
  });

  it("smooth-scrolls on demand and re-arms auto-scroll", async () => {
    const vm = await mountChat();
    const el = vm.messagesContainer as HTMLElement;
    metrics(el, { top: 0, height: 900, client: 300 });
    vm.checkIfShouldAutoScroll();
    expect(vm.showScrollToBottom).toBe(true);
    const scrollTo = vi.fn();
    (el as any).scrollTo = scrollTo;

    const pending = vm.scrollToBottomSmooth();
    expect(scrollTo).not.toHaveBeenCalled();
    await pending;
    expect(scrollTo).toHaveBeenCalledWith({ top: 900, behavior: "smooth" });
    expect(vm.showScrollToBottom).toBe(false);
    expect(vm.shouldAutoScroll).toBe(true);
  });

  it("scrolls to the bottom when a message is sent", async () => {
    const vm = await mountChat();
    const el = vm.messagesContainer as HTMLElement;
    metrics(el, { top: 0, height: 900, client: 300 });
    vm.checkIfShouldAutoScroll();
    expect(vm.shouldAutoScroll).toBe(false);
    vm.inputMessage = "hello";
    await vm.sendMessage();
    await flushPromises();
    expect(el.scrollTop).toBe(900);
    expect(vm.shouldAutoScroll).toBe(true);
  });

  it("scrolls a loading-indicator element into view only after a tick", async () => {
    const vm = await mountChat();
    const indicator = document.createElement("div");
    indicator.id = "loading-indicator";
    indicator.scrollIntoView = vi.fn();
    document.body.appendChild(indicator);
    const pending = vm.scrollToLoadingIndicator();
    expect(indicator.scrollIntoView).not.toHaveBeenCalled();
    await pending;
    expect(indicator.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "end" });
  });
});

describe("Backspace on an image reference", () => {
  const editable = () => {
    const host = document.createElement("div");
    host.setAttribute("contenteditable", "true");
    document.body.appendChild(host);
    return host;
  };

  it("removes a chip before a text caret at offset 0, its pending image, and fires a bubbling input", async () => {
    const vm = await mountChat();
    vm.pendingImages = [img("a.png"), img("b.png")];
    const host = editable();
    host.append(chip("@[a.png]"));
    const text = document.createTextNode(" after");
    host.append(text);
    placeCaret(text, 0);
    const onInput = vi.fn();
    document.body.addEventListener("input", onInput);

    const e = key("Backspace", text.parentElement!);
    expect(vm.handleKeyDown(e)).toBeUndefined();
    expect(e.defaultPrevented).toBe(true);
    expect(host.querySelector(".image-reference")).toBeNull();
    expect(vm.pendingImages.map((i: any) => i.filename)).toEqual(["b.png"]);
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onInput.mock.calls[0][0].target).toBe(host);
  });

  it("removes a chip immediately before an element caret, found through a wrapper target", async () => {
    const vm = await mountChat();
    vm.pendingImages = [img("a.png")];
    const wrap = document.createElement("div");
    document.body.appendChild(wrap);
    const host = document.createElement("div");
    host.setAttribute("contenteditable", "true");
    wrap.appendChild(host);
    host.append(document.createTextNode("x"), chip("@[a.png]"));
    placeCaret(host, 2);

    const e = key("Backspace", wrap);
    vm.handleKeyDown(e);
    expect(e.defaultPrevented).toBe(true);
    expect(host.childNodes).toHaveLength(1);
    expect(vm.pendingImages).toHaveLength(0);
  });

  it("removes a chip whose text lacks the @[name] form but keeps every pending image", async () => {
    const vm = await mountChat();
    vm.pendingImages = [img("a.png")];
    const host = editable();
    host.append(chip("🖼️a.png×"));
    placeCaret(host, 1);
    const e = key("Backspace", host);
    vm.handleKeyDown(e);
    expect(e.defaultPrevented).toBe(true);
    expect(host.querySelector(".image-reference")).toBeNull();
    expect(vm.pendingImages).toHaveLength(1);
  });

  it("does nothing when the caret is not directly after a chip", async () => {
    const vm = await mountChat();
    vm.pendingImages = [img("a.png")];
    const host = editable();
    const text = document.createTextNode("abc");
    host.append(chip("@[a.png]"), text);

    placeCaret(text, 1);
    const mid = key("Backspace", host);
    vm.handleKeyDown(mid);
    expect(mid.defaultPrevented).toBe(false);

    placeCaret(host, 0);
    const start = key("Backspace", host);
    vm.handleKeyDown(start);
    expect(start.defaultPrevented).toBe(false);
    expect(host.querySelector(".image-reference")).not.toBeNull();
    expect(vm.pendingImages).toHaveLength(1);
  });

  it("returns without touching state when there is no selection range", async () => {
    const vm = await mountChat();
    vm.pendingImages = [img("a.png")];
    const host = editable();
    host.append(chip("@[a.png]"));
    window.getSelection()!.removeAllRanges();
    const e = key("Backspace", host);
    expect(vm.handleKeyDown(e)).toBeUndefined();
    expect(e.defaultPrevented).toBe(false);
    expect(host.querySelector(".image-reference")).not.toBeNull();
  });

  it("deletes a trailing @[name] from the textarea model and restores the caret on the next tick", async () => {
    const vm = await mountChat();
    vm.pendingImages = [img("a.png")];
    vm.inputMessage = "see @[a.png]";
    const ta = textareaAt("see @[a.png]");

    const e = key("Backspace", ta);
    vm.handleKeyDown(e);
    expect(e.defaultPrevented).toBe(true);
    expect(vm.inputMessage).toBe("see ");
    expect(vm.pendingImages).toHaveLength(0);
    expect(ta.selectionStart).toBe(12);
    await nextTick();
    expect(ta.selectionStart).toBe(4);
    expect(ta.selectionEnd).toBe(4);
  });

  it("keeps the textarea text when the caret is not at the end of a reference", async () => {
    const vm = await mountChat();
    vm.pendingImages = [img("a.png")];
    vm.inputMessage = "see @[a.png] now";
    const e = key("Backspace", textareaAt("see @[a.png] now"));
    vm.handleKeyDown(e);
    expect(e.defaultPrevented).toBe(false);
    expect(vm.inputMessage).toBe("see @[a.png] now");
    expect(vm.pendingImages).toHaveLength(1);
  });

  it("deletes an unknown reference from the text without touching pending images", async () => {
    const vm = await mountChat();
    vm.pendingImages = [img("a.png")];
    vm.inputMessage = "@[zzz.png]";
    vm.handleKeyDown(key("Backspace", textareaAt("@[zzz.png]")));
    expect(vm.inputMessage).toBe("");
    expect(vm.pendingImages).toHaveLength(1);
  });
});
