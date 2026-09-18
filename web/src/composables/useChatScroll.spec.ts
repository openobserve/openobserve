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

import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

import { useChatScroll } from "@/composables/useChatScroll";

const box = (top: number, height: number, client: number) => {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: height });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: client });
  Object.defineProperty(el, "scrollTop", { configurable: true, writable: true, value: top });
  (el as any).scrollTo = vi.fn();
  return el;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useChatScroll", () => {
  it("leaves both flags alone without a container", async () => {
    const container = ref<HTMLElement | null>(null);
    const s = useChatScroll(container);
    s.shouldAutoScroll.value = false;
    s.showScrollToBottom.value = true;
    s.checkIfShouldAutoScroll();
    await s.scrollToBottomSmooth();
    await s.scrollToBottom();
    expect(s.shouldAutoScroll.value).toBe(false);
    expect(s.showScrollToBottom.value).toBe(true);
  });

  it("applies the 50 and 100 boundaries exactly", () => {
    const container = ref<HTMLElement | null>(null);
    const s = useChatScroll(container);
    container.value = box(450, 1000, 500);
    s.checkIfShouldAutoScroll();
    expect([s.shouldAutoScroll.value, s.showScrollToBottom.value]).toEqual([true, false]);
    container.value = box(400, 1000, 500);
    s.checkIfShouldAutoScroll();
    expect([s.shouldAutoScroll.value, s.showScrollToBottom.value]).toEqual([false, false]);
    container.value = box(399, 1000, 500);
    s.checkIfShouldAutoScroll();
    expect(s.showScrollToBottom.value).toBe(true);
    container.value = box(0, 600, 500);
    s.checkIfShouldAutoScroll();
    expect(s.showScrollToBottom.value).toBe(false);
    container.value = box(0, 601, 500);
    s.checkIfShouldAutoScroll();
    expect(s.showScrollToBottom.value).toBe(true);
  });

  it("scrollToBottom reads the container and flag after the tick", async () => {
    const container = ref<HTMLElement | null>(null);
    const s = useChatScroll(container);
    s.shouldAutoScroll.value = false;
    const pending = s.scrollToBottom();
    const el = box(0, 800, 200);
    container.value = el;
    s.shouldAutoScroll.value = true;
    await pending;
    expect(el.scrollTop).toBe(800);
  });

  it("scrollToBottom does not move a container when auto-scroll is off", async () => {
    const el = box(10, 800, 200);
    const s = useChatScroll(ref<HTMLElement | null>(el));
    s.shouldAutoScroll.value = false;
    await s.scrollToBottom();
    expect(el.scrollTop).toBe(10);
  });

  it("scrollToBottomSmooth scrolls even with auto-scroll off, then re-arms it", async () => {
    const el = box(0, 800, 200);
    const s = useChatScroll(ref<HTMLElement | null>(el));
    s.shouldAutoScroll.value = false;
    s.showScrollToBottom.value = true;
    await s.scrollToBottomSmooth();
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 800, behavior: "smooth" });
    expect([s.shouldAutoScroll.value, s.showScrollToBottom.value]).toEqual([true, false]);
  });

  it("scrollToLoadingIndicator resolves after one tick with no element present", async () => {
    const s = useChatScroll(ref<HTMLElement | null>(null));
    let done = false;
    s.scrollToLoadingIndicator().then(() => (done = true));
    expect(done).toBe(false);
    await nextTick();
    await Promise.resolve();
    expect(done).toBe(true);
  });
});
