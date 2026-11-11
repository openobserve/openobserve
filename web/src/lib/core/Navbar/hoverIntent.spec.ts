// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AIM_IDLE,
  AIM_SLACK,
  aim,
  aimTriangle,
  isAimingAt,
  isAimingAtOpenFlyout,
  isPointInTriangle,
  releasePointerTracking,
  retainPointerTracking,
} from "./hoverIntent";

const rect = (left: number, top: number, right: number, bottom: number) =>
  ({
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
  }) as DOMRect;

// Reliability's flyout in LTR: 4 px off an 88 px rail, five rows.
const ltrFlyout = rect(92, 100, 310, 300);
// ENT Reliability: ten rows.
const tallFlyout = rect(92, 100, 310, 520);
// In RTL the rail sits at the right edge and the flyout opens to its left.
const rtlFlyout = rect(1130, 100, 1348, 300);

function fakeFlyout(r: DOMRect): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => r;
  return el;
}

describe("hoverIntent", () => {
  afterEach(() => {
    aim.exit = null;
    aim.last = null;
    aim.flyout = null;
    aim.movedAt = 0;
    document.documentElement.dir = "";
    vi.restoreAllMocks();
  });

  describe("aimTriangle", () => {
    it("spans from AIM_SLACK behind the exit point to the flyout's near edge with slack above and below (LTR)", () => {
      const [apex, top, bottom] = aimTriangle({ x: 80, y: 150 }, ltrFlyout, false);
      expect(apex).toEqual({ x: 80 - AIM_SLACK, y: 150 });
      expect(top).toEqual({ x: 92, y: 100 - AIM_SLACK });
      expect(bottom).toEqual({ x: 92, y: 300 + AIM_SLACK });
    });

    it("mirrors to the flyout's right edge in RTL", () => {
      const [apex, top, bottom] = aimTriangle({ x: 1360, y: 150 }, rtlFlyout, true);
      expect(apex).toEqual({ x: 1360 + AIM_SLACK, y: 150 });
      expect(top).toEqual({ x: 1348, y: 100 - AIM_SLACK });
      expect(bottom).toEqual({ x: 1348, y: 300 + AIM_SLACK });
    });
  });

  describe("isPointInTriangle", () => {
    const tri = aimTriangle({ x: 80, y: 150 }, ltrFlyout, false);

    it("accepts a point on the diagonal towards the flyout's far row", () => {
      expect(isPointInTriangle({ x: 86, y: 220 }, tri)).toBe(true);
    });

    it("accepts a point exactly on an edge", () => {
      expect(isPointInTriangle({ x: 80 - AIM_SLACK, y: 150 }, tri)).toBe(true);
    });

    it("rejects a point that has drifted below the bottom slack", () => {
      expect(isPointInTriangle({ x: 86, y: 400 }, tri)).toBe(false);
    });

    it("rejects a point moving away from the flyout", () => {
      expect(isPointInTriangle({ x: 40, y: 150 }, tri)).toBe(false);
    });

    it("keeps a steep diagonal inside a 10-child flyout that a 5-child one would reject", () => {
      const p = { x: 90, y: 480 };
      expect(isPointInTriangle(p, aimTriangle({ x: 80, y: 150 }, tallFlyout, false))).toBe(true);
      expect(isPointInTriangle(p, tri)).toBe(false);
    });

    it("works mirrored in RTL", () => {
      const rtl = aimTriangle({ x: 1360, y: 150 }, rtlFlyout, true);
      expect(isPointInTriangle({ x: 1354, y: 220 }, rtl)).toBe(true);
      expect(isPointInTriangle({ x: 1400, y: 150 }, rtl)).toBe(false);
    });
  });

  describe("isAimingAtOpenFlyout", () => {
    it("is false with no exit point, no sample or no flyout", () => {
      expect(isAimingAtOpenFlyout(0)).toBe(false);
      aim.exit = { x: 80, y: 150 };
      aim.last = { x: 86, y: 220 };
      expect(isAimingAtOpenFlyout(0)).toBe(false);
    });

    it("is true while the pointer moved within AIM_IDLE and sits inside the triangle", () => {
      aim.exit = { x: 80, y: 150 };
      aim.last = { x: 86, y: 220 };
      aim.movedAt = 1000;
      aim.flyout = fakeFlyout(ltrFlyout);
      expect(isAimingAtOpenFlyout(1000 + AIM_IDLE)).toBe(true);
    });

    it("expires once the pointer has rested longer than AIM_IDLE", () => {
      aim.exit = { x: 80, y: 150 };
      aim.last = { x: 86, y: 220 };
      aim.movedAt = 1000;
      aim.flyout = fakeFlyout(ltrFlyout);
      expect(isAimingAtOpenFlyout(1000 + AIM_IDLE + 1)).toBe(false);
    });

    it("is false for a pointer outside the triangle even while moving", () => {
      aim.exit = { x: 80, y: 150 };
      aim.last = { x: 86, y: 400 };
      aim.movedAt = 1000;
      aim.flyout = fakeFlyout(ltrFlyout);
      expect(isAimingAtOpenFlyout(1010)).toBe(false);
    });

    it("reads the document direction to mirror the triangle", () => {
      document.documentElement.dir = "rtl";
      aim.exit = { x: 1360, y: 150 };
      aim.last = { x: 1354, y: 220 };
      aim.movedAt = 1000;
      aim.flyout = fakeFlyout(rtlFlyout);
      expect(isAimingAtOpenFlyout(1010)).toBe(true);
    });

    it("defaults the clock to performance.now()", () => {
      vi.spyOn(performance, "now").mockReturnValue(5000);
      aim.exit = { x: 80, y: 150 };
      aim.last = { x: 86, y: 220 };
      aim.movedAt = 5000 - AIM_IDLE - 1;
      aim.flyout = fakeFlyout(ltrFlyout);
      expect(isAimingAtOpenFlyout()).toBe(false);
    });
  });

  describe("isAimingAt", () => {
    // A side panel beside the flyout, aimed at from a row that ends at x 310.
    const panel = fakeFlyout(rect(314, 120, 520, 260));
    const flippedPanel = fakeFlyout(rect(0, 120, 88, 260));

    it("aims at the target the caller names, independent of the open flyout", () => {
      aim.last = { x: 306, y: 200 };
      aim.movedAt = 1000;
      expect(isAimingAt({ x: 300, y: 130 }, panel, false, 1010)).toBe(true);
      expect(aim.flyout).toBeNull();
    });

    it("takes the side from the caller, so a panel flipped to the start edge still aims", () => {
      document.documentElement.dir = "ltr";
      aim.last = { x: 94, y: 200 };
      aim.movedAt = 1000;
      expect(isAimingAt({ x: 100, y: 130 }, flippedPanel, true, 1010)).toBe(true);
      expect(isAimingAt({ x: 100, y: 130 }, flippedPanel, false, 1010)).toBe(false);
    });

    it("is false without an exit point or a target", () => {
      aim.last = { x: 306, y: 200 };
      aim.movedAt = 1000;
      expect(isAimingAt(null, panel, false, 1010)).toBe(false);
      expect(isAimingAt({ x: 300, y: 130 }, null, false, 1010)).toBe(false);
    });
  });
});

describe("shared pointer tracking", () => {
  const move = (x: number) =>
    document.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: 10 }));

  it("keeps tracking while any open group still holds it, whatever order they swap in", () => {
    retainPointerTracking();
    retainPointerTracking();
    releasePointerTracking();
    move(40);
    expect(aim.last).toEqual({ x: 40, y: 10 });

    releasePointerTracking();
    move(80);
    expect(aim.last).toEqual({ x: 40, y: 10 });
  });

  it("ignores a release with nothing retained", () => {
    releasePointerTracking();
    retainPointerTracking();
    move(120);
    expect(aim.last).toEqual({ x: 120, y: 10 });
    releasePointerTracking();
  });
});
