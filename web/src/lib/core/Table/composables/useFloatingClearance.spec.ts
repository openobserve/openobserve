// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { clearanceFor } from "./useFloatingClearance";

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, right: left + width, bottom: top + height, width, height }) as DOMRect;

const LAUNCHER_LTR = rect(1368, 800, 48, 48);
const LAUNCHER_RTL = rect(24, 800, 48, 48);

describe("clearanceFor", () => {
  it("clears from the box's end edge to the launcher's start edge when they overlap", () => {
    expect(clearanceFor(rect(240, 810, 1192, 34), LAUNCHER_LTR, false)).toBe(64);
  });

  it("asks for nothing when the box sits above the launcher", () => {
    expect(clearanceFor(rect(240, 400, 1192, 34), LAUNCHER_LTR, false)).toBe(0);
  });

  it("asks for nothing when the box ends before the launcher starts", () => {
    expect(clearanceFor(rect(240, 810, 900, 34), LAUNCHER_LTR, false)).toBe(0);
  });

  it("measures from the box's left edge in right-to-left layouts", () => {
    expect(clearanceFor(rect(0, 810, 1192, 34), LAUNCHER_RTL, true)).toBe(72);
  });

  it("asks for nothing in right-to-left layouts when the launcher is elsewhere", () => {
    expect(clearanceFor(rect(0, 810, 1192, 34), LAUNCHER_LTR, true)).toBe(0);
  });
});
