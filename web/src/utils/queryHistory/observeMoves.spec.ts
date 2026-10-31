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
import { observeMoves } from "./observeMoves";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const tree = () => {
  const outer = document.createElement("div");
  const inner = document.createElement("div");
  const el = document.createElement("div");
  const child = document.createElement("span");
  el.appendChild(child);
  inner.appendChild(el);
  outer.appendChild(inner);
  document.body.appendChild(outer);
  return { outer, inner, el, child };
};

describe("observeMoves", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reports an ancestor restyle, a containing scroll and a window resize, and ignores other scrolls", async () => {
    const { outer, el } = tree();
    const elsewhere = document.createElement("div");
    document.body.appendChild(elsewhere);
    await settle();
    const onMove = vi.fn();
    const stop = observeMoves(el, onMove);
    await settle();
    onMove.mockClear();

    outer.style.top = "40px";
    await settle();
    expect(onMove).toHaveBeenCalledTimes(1);

    elsewhere.dispatchEvent(new Event("scroll"));
    expect(onMove).toHaveBeenCalledTimes(1);
    outer.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    expect(onMove).toHaveBeenCalledTimes(3);
    stop();
  });

  it("reports style changes inside the element only when asked, as for Monaco's caret", async () => {
    const { el, child } = tree();
    const plain = vi.fn();
    const withSubtree = vi.fn();
    const stops = [observeMoves(el, plain), observeMoves(el, withSubtree, { subtreeStyles: true })];
    await settle();
    plain.mockClear();
    withSubtree.mockClear();
    child.style.left = "12px";
    await settle();
    expect(plain).not.toHaveBeenCalled();
    expect(withSubtree).toHaveBeenCalledTimes(1);
    stops.forEach((stop) => stop());
  });

  it("reports a sibling inserted before an ancestor, then watches that sibling's size", async () => {
    const { outer, inner, el } = tree();
    const observed: Element[] = [];
    const RealResizeObserver = globalThis.ResizeObserver;
    let resized: ResizeObserverCallback = () => {};
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resized = callback;
      }
      observe(target: Element) {
        observed.push(target);
      }
      unobserve() {}
      disconnect() {
        observed.length = 0;
      }
    } as unknown as typeof ResizeObserver;
    try {
      const onMove = vi.fn();
      const stop = observeMoves(el, onMove);
      const banner = document.createElement("div");
      outer.insertBefore(banner, inner);
      await settle();
      expect(onMove).toHaveBeenCalled();
      expect(observed).toContain(banner);
      onMove.mockClear();
      resized([], {} as ResizeObserver);
      expect(onMove).toHaveBeenCalledTimes(1);
      stop();
    } finally {
      globalThis.ResizeObserver = RealResizeObserver;
    }
  });

  it("re-observes nothing when stopped after a sibling change queued a rewatch", async () => {
    const { outer, inner, el } = tree();
    const observed: Element[] = [];
    const RealResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe(target: Element) {
        observed.push(target);
      }
      unobserve() {}
      disconnect() {
        observed.length = 0;
      }
    } as unknown as typeof ResizeObserver;
    try {
      let stop: () => void = () => {};
      // onMove runs in the same mutation callback that queues the rewatch, before that rewatch runs.
      const onMove = vi.fn(() => stop());
      stop = observeMoves(el, onMove);
      expect(observed.length).toBeGreaterThan(0);
      outer.insertBefore(document.createElement("div"), inner);
      await settle();
      expect(onMove).toHaveBeenCalledTimes(1);
      expect(observed).toEqual([]);
    } finally {
      globalThis.ResizeObserver = RealResizeObserver;
    }
  });

  it("stops reporting once stopped", async () => {
    const { outer, el } = tree();
    const onMove = vi.fn();
    const stop = observeMoves(el, onMove, { subtreeStyles: true });
    await settle();
    stop();
    onMove.mockClear();
    outer.style.top = "1px";
    outer.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    await settle();
    expect(onMove).not.toHaveBeenCalled();
  });
});
