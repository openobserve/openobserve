import { describe, expect, it } from "vitest";
import { movingIntoSubmenu } from "./submenuSafeArea";

const left = { left: 518, right: 678, top: 373, bottom: 479 };
const right = { left: 960, right: 1120, top: 373, bottom: 479 };

describe("movingIntoSubmenu", () => {
  it("accepts a slow diagonal toward a submenu that flipped to the left", () => {
    expect(movingIntoSubmenu({ x: 707, y: 405 }, { x: 697, y: 419 }, left)).toBe(true);
    expect(movingIntoSubmenu({ x: 697, y: 419 }, { x: 688, y: 440 }, left)).toBe(true);
  });

  it("accepts a move toward a submenu on the right", () => {
    expect(movingIntoSubmenu({ x: 940, y: 380 }, { x: 950, y: 400 }, right)).toBe(true);
  });

  it("rejects moving away, or leaving the corridor", () => {
    expect(movingIntoSubmenu({ x: 707, y: 405 }, { x: 712, y: 410 }, left)).toBe(false);
    expect(movingIntoSubmenu({ x: 707, y: 405 }, { x: 700, y: 520 }, left)).toBe(false);
    expect(movingIntoSubmenu({ x: 940, y: 380 }, { x: 930, y: 380 }, right)).toBe(false);
  });

  it("rejects an unmeasured or overlapping panel", () => {
    expect(
      movingIntoSubmenu({ x: 1, y: 1 }, { x: 0, y: 0 }, { left: 0, right: 0, top: 0, bottom: 0 }),
    ).toBe(false);
    expect(movingIntoSubmenu({ x: 600, y: 400 }, { x: 590, y: 410 }, left)).toBe(false);
  });
});
