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
import { ref } from "vue";

import { usePromptHistory } from "@/composables/usePromptHistory";

const KEY = "ai-chat-query-history";

const ta = (value: string, cursor = value.length) => {
  const el = document.createElement("textarea");
  el.value = value;
  el.selectionStart = el.selectionEnd = cursor;
  return el;
};

const ce = (html: string, caretNode = 0, caretOffset?: number) => {
  const el = document.createElement("div");
  el.setAttribute("contenteditable", "true");
  Object.defineProperty(el, "isContentEditable", { value: true, configurable: true });
  el.innerHTML = html;
  document.body.appendChild(el);
  const node = el.childNodes[caretNode];
  const range = document.createRange();
  const offset = caretOffset ?? (node?.textContent?.length || 0);
  range.setStart(node, offset);
  range.collapse(true);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return el;
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("usePromptHistory", () => {
  it("writes the recalled prompt into the shared input ref", () => {
    const input = ref("draft");
    const h = usePromptHistory(input);
    localStorage.setItem(KEY, '["b","a"]');
    h.loadQueryHistory();

    h.navigateHistory("up");
    expect(input.value).toBe("b");
    expect(h.historyIndex.value).toBe(0);
    h.navigateHistory("up");
    h.navigateHistory("up");
    expect(input.value).toBe("a");
    expect(h.historyIndex.value).toBe(1);
    h.navigateHistory("down");
    expect(input.value).toBe("b");
    h.navigateHistory("down");
    expect(input.value).toBe("");
    expect(h.historyIndex.value).toBe(-1);
    input.value = "kept";
    h.navigateHistory("down");
    expect(input.value).toBe("kept");
  });

  it("does nothing on an empty history", () => {
    const input = ref("draft");
    const h = usePromptHistory(input);
    h.navigateHistory("up");
    expect(input.value).toBe("draft");
    expect(h.historyIndex.value).toBe(-1);
  });

  it("keeps a missing key as an empty history and a corrupt one as empty with a log", () => {
    const h = usePromptHistory(ref(""));
    h.loadQueryHistory();
    expect(h.queryHistory.value).toEqual([]);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(KEY, "nope");
    h.queryHistory.value = ["stale"];
    h.loadQueryHistory();
    expect(h.queryHistory.value).toEqual([]);
    expect(err).toHaveBeenCalledWith("Error loading query history:", expect.anything());
  });

  it("adds trimmed, deduplicated, newest-first, capped at 10, persisted, index reset", () => {
    const h = usePromptHistory(ref(""));
    h.addToHistory("   ");
    expect(localStorage.getItem(KEY)).toBeNull();
    for (let i = 0; i < 11; i++) h.addToHistory(` q${i} `);
    h.historyIndex.value = 3;
    h.addToHistory("q4");
    expect(h.historyIndex.value).toBe(-1);
    const expected = ["q4", "q10", "q9", "q8", "q7", "q6", "q5", "q3", "q2", "q1"];
    expect(h.queryHistory.value).toEqual(expected);
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify(expected));
  });

  it("logs and continues when storage refuses the write", () => {
    const h = usePromptHistory(ref(""));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    h.historyIndex.value = 2;
    h.addToHistory("x");
    expect(err).toHaveBeenCalledWith("Error saving query history:", expect.anything());
    expect(h.historyIndex.value).toBe(-1);
  });

  it("detects the first line by newlines before the caret only", () => {
    const { isOnFirstLine } = usePromptHistory(ref(""));
    expect(isOnFirstLine(ta("abc\ndef", 3))).toBe(true);
    expect(isOnFirstLine(ta("abc\ndef", 4))).toBe(false);
    expect(isOnFirstLine(null as any)).toBe(false);
  });

  // The composer is a contenteditable div, never a textarea; a tagName check disabled recall entirely.
  describe("contenteditable caret, the shape the chat composer actually uses", () => {
    it("treats a caret in a single-line contenteditable as the first line", () => {
      const { isOnFirstLine } = usePromptHistory(ref(""));
      expect(isOnFirstLine(ce("hello"))).toBe(true);
    });

    it("recognises a contenteditable that is not a textarea", () => {
      const { isOnFirstLine } = usePromptHistory(ref(""));
      const el = ce("hello");
      expect(el.tagName).not.toBe("TEXTAREA");
      expect(isOnFirstLine(el)).toBe(true);
    });

    it("returns false once a <br> sits before the caret", () => {
      const { isOnFirstLine } = usePromptHistory(ref(""));
      // "one<br>two" with the caret inside "two"
      expect(isOnFirstLine(ce("one<br>two", 2))).toBe(false);
    });

    it("stays true on the first line of a multi-line contenteditable", () => {
      const { isOnFirstLine } = usePromptHistory(ref(""));
      expect(isOnFirstLine(ce("one<br>two", 0, 3))).toBe(true);
    });

    it("returns false for an element that is not editable", () => {
      const { isOnFirstLine } = usePromptHistory(ref(""));
      const div = document.createElement("div");
      div.textContent = "plain";
      document.body.appendChild(div);
      expect(isOnFirstLine(div)).toBe(false);
    });

    it("returns false when the caret sits outside the element", () => {
      const { isOnFirstLine } = usePromptHistory(ref(""));
      const inside = ce("hello");
      const outside = document.createElement("div");
      Object.defineProperty(outside, "isContentEditable", { value: true, configurable: true });
      outside.textContent = "elsewhere";
      document.body.appendChild(outside);
      // selection is still inside `inside`, so `outside` must not claim the caret
      expect(isOnFirstLine(outside)).toBe(false);
      expect(isOnFirstLine(inside)).toBe(true);
    });

    it("returns false when there is no selection at all", () => {
      const { isOnFirstLine } = usePromptHistory(ref(""));
      const el = ce("hello");
      window.getSelection()!.removeAllRanges();
      expect(isOnFirstLine(el)).toBe(false);
    });
  });
});
