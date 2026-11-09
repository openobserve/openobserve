import { describe, expect, it } from "vitest";

import { edgeFadeOf, edgeMask, wheelToScroll } from "./trayScroll";

const box = (scrollLeft: number) => ({ scrollLeft, scrollWidth: 743, clientWidth: 258 });

describe("trayScroll", () => {
  it("maps a vertical wheel to horizontal scroll, clamped to the row", () => {
    expect(wheelToScroll({ deltaX: 0, deltaY: 400, deltaMode: 0 }, box(0))).toBe(400);
    expect(wheelToScroll({ deltaX: 0, deltaY: 400, deltaMode: 0 }, box(400))).toBe(85);
    expect(wheelToScroll({ deltaX: 0, deltaY: -100, deltaMode: 0 }, box(40))).toBe(-40);
    expect(wheelToScroll({ deltaX: 0, deltaY: 3, deltaMode: 1 }, box(0))).toBe(48);
  });

  it("leaves the wheel to the page at the end, for a horizontal swipe, or with nothing to scroll", () => {
    expect(wheelToScroll({ deltaX: 0, deltaY: 100, deltaMode: 0 }, box(485))).toBe(0);
    expect(wheelToScroll({ deltaX: 0, deltaY: -100, deltaMode: 0 }, box(0))).toBe(0);
    expect(wheelToScroll({ deltaX: 120, deltaY: 10, deltaMode: 0 }, box(0))).toBe(0);
    expect(
      wheelToScroll(
        { deltaX: 0, deltaY: 100, deltaMode: 0 },
        { scrollLeft: 0, scrollWidth: 200, clientWidth: 258 },
      ),
    ).toBe(0);
  });

  it("fades only the edges that hide chips", () => {
    expect(edgeFadeOf(box(0))).toEqual({ start: false, end: true });
    expect(edgeFadeOf(box(200))).toEqual({ start: true, end: true });
    expect(edgeFadeOf(box(485))).toEqual({ start: true, end: false });
    expect(edgeMask({ start: false, end: false })).toBeUndefined();
    expect(edgeMask({ start: false, end: true })).toBe(
      "linear-gradient(to right, #000 0, #000 calc(100% - 1.5rem), transparent 100%)",
    );
  });
});
