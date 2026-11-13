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

import { describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { nextTitleRoom, TITLE_MIN_PX, useHeaderTitleRoom } from "./useHeaderTitleRoom";

const fresh = { crowded: false, roomAt: 0, movedWidth: null };

describe("nextTitleRoom", () => {
  it("leaves a title with room alone", () => {
    expect(nextTitleRoom(fresh, { headerWidth: 1400, titleWidth: 300, titleRoom: 200 })).toEqual(
      fresh,
    );
  });

  it("leaves a short title alone even when its box is small", () => {
    expect(nextTitleRoom(fresh, { headerWidth: 1280, titleWidth: 40, titleRoom: 40 })).toEqual(
      fresh,
    );
  });

  it("flags a title squeezed to 21px at 1280 and records the width it needs (V25)", () => {
    const next = nextTitleRoom(fresh, { headerWidth: 1190, titleWidth: 144, titleRoom: 21 });
    expect(next).toEqual({ crowded: true, roomAt: 1190 + 144 - 21, movedWidth: null });
  });

  it("asks for at most the minimum width for a long title", () => {
    const next = nextTitleRoom(fresh, { headerWidth: 1190, titleWidth: 600, titleRoom: 21 });
    expect(next.roomAt).toBe(1190 + TITLE_MIN_PX - 21);
  });

  it("stays crowded while the title box is wide but the header is still short of room", () => {
    const crowded = { crowded: true, roomAt: 1313, movedWidth: null };
    expect(nextTitleRoom(crowded, { headerWidth: 1300, titleWidth: 144, titleRoom: 900 })).toBe(
      crowded,
    );
  });

  it("clears once the header reaches the recorded width", () => {
    const crowded = { crowded: true, roomAt: 1313, movedWidth: null };
    expect(nextTitleRoom(crowded, { headerWidth: 1313, titleWidth: 144, titleRoom: 900 })).toEqual(
      fresh,
    );
  });
  it("records the moved control's width only once it has moved, since the header may squeeze it", () => {
    const next = nextTitleRoom(fresh, {
      headerWidth: 1190,
      titleWidth: 144,
      titleRoom: 21,
      movedWidth: 180,
    });
    expect(next).toEqual({ crowded: true, roomAt: 1190 + 144 - 21, movedWidth: null });
    const moved = nextTitleRoom(next, {
      headerWidth: 1190,
      titleWidth: 144,
      titleRoom: 900,
      movedWidth: 260,
    });
    expect(moved).toEqual({ ...next, movedWidth: 260 });
  });

  it("clears at the same header width once the moved control has narrowed enough (P9)", () => {
    const crowded = { crowded: true, roomAt: 1313, movedWidth: 260 };
    const sizes = { headerWidth: 1190, titleWidth: 144, titleRoom: 900 };
    expect(nextTitleRoom(crowded, { ...sizes, movedWidth: 200 })).toBe(crowded);
    expect(nextTitleRoom(crowded, { ...sizes, movedWidth: 137 })).toEqual(fresh);
  });

  it("asks for more header once the moved control has widened", () => {
    const crowded = { crowded: true, roomAt: 1313, movedWidth: 120 };
    const sizes = { headerWidth: 1313, titleWidth: 144, titleRoom: 900 };
    expect(nextTitleRoom(crowded, { ...sizes, movedWidth: 200 })).toBe(crowded);
  });
});

describe("useHeaderTitleRoom", () => {
  const sized = (el: HTMLElement, width: number) => {
    Object.defineProperty(el, "clientWidth", { configurable: true, value: width });
    el.getBoundingClientRect = () => ({ width }) as DOMRect;
  };

  it("hands the row back to the header when the moved picker narrows (P9)", async () => {
    let onResize: () => void = () => {};
    const observed: Element[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          onResize = cb;
        }
        observe(el: Element) {
          observed.push(el);
        }
        disconnect() {}
      },
    );
    const header = document.createElement("header");
    const box = document.createElement("div");
    const title = document.createElement("span");
    const picker = document.createElement("div");
    box.appendChild(title);
    header.appendChild(box);
    document.body.append(header, picker);
    sized(header, 1190);
    sized(box, 21);
    sized(title, 144);
    sized(picker, 260);

    const scope = effectScope();
    const titleEl = ref<HTMLElement | null>(null);
    const movedEl = ref<HTMLElement | null>(null);
    const { crowded } = scope.run(() => useHeaderTitleRoom(titleEl, { movedEl }))!;
    titleEl.value = title;
    movedEl.value = picker;
    await nextTick();
    onResize();
    expect(crowded.value).toBe(true);
    expect(observed).toContain(picker);

    sized(box, 900);
    onResize();
    expect(crowded.value).toBe(true);
    sized(picker, 120);
    onResize();
    expect(crowded.value).toBe(false);

    scope.stop();
    header.remove();
    picker.remove();
    vi.unstubAllGlobals();
  });
});
