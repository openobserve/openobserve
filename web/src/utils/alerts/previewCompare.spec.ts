// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { comparisonOffsetText, comparisonWindows } from "./previewCompare";

describe("comparisonWindows", () => {
  it.each([
    ["one week", [{ offSet: "1w" }], [10080]],
    ["several units", [{ offSet: "3d" }, { offSet: "2h" }, { offSet: "30m" }], [4320, 120, 30]],
    ["nothing set", null, []],
    ["an unreadable or zero offset", [{ offSet: "soon" }, { offSet: "0h" }, {}], []],
  ])("reads %s", (_case, ranges, minutes) => {
    expect(comparisonWindows(ranges).map((window) => window.minutes)).toEqual(minutes);
  });
});

describe("comparisonOffsetText", () => {
  it("names each window in words, joined for the locale", () => {
    expect(
      comparisonOffsetText(comparisonWindows([{ offSet: "1w" }, { offSet: "2d" }]), "en-US"),
    ).toBe("1 week and 2 days");
  });
});
