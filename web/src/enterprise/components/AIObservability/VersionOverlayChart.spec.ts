// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildOverlayOption } from "./VersionOverlayChart.vue";

const seriesA = [
  { x: 0, y: 10 },
  { x: 1, y: 12 },
];
const seriesB = [
  { x: 0, y: 20 },
  { x: 1, y: 18 },
];

describe("VersionOverlayChart buildOverlayOption", () => {
  it("builds exactly two series (A and B)", () => {
    const option = buildOverlayOption({
      seriesA,
      seriesB,
      mode: "sinceRollout",
      labelA: "Version A",
      labelB: "Version B",
      xAxisLabel: "Hours since rollout",
    });
    expect(option.series).toHaveLength(2);
    expect((option.series as any[])[0].name).toBe("Version A");
    expect((option.series as any[])[1].name).toBe("Version B");
  });

  it("uses value-type x-axis with 'hours since rollout' label in sinceRollout mode", () => {
    const option = buildOverlayOption({
      seriesA,
      seriesB,
      mode: "sinceRollout",
      labelA: "Version A",
      labelB: "Version B",
      xAxisLabel: "Hours since rollout",
    });
    const xAxis = option.xAxis as any;
    expect(xAxis.type).toBe("value");
    expect(xAxis.name).toBe("Hours since rollout");
  });

  it("uses time-type x-axis with real-time label in sameWallClock mode", () => {
    const option = buildOverlayOption({
      seriesA,
      seriesB,
      mode: "sameWallClock",
      labelA: "Version A",
      labelB: "Version B",
      xAxisLabel: "Time",
    });
    const xAxis = option.xAxis as any;
    expect(xAxis.type).toBe("time");
    expect(xAxis.name).toBe("Time");
  });

  it("maps series data points to [x, y] tuples", () => {
    const option = buildOverlayOption({
      seriesA,
      seriesB,
      mode: "sinceRollout",
      labelA: "Version A",
      labelB: "Version B",
      xAxisLabel: "Hours since rollout",
    });
    expect((option.series as any[])[0].data).toEqual([[0, 10], [1, 12]]);
    expect((option.series as any[])[1].data).toEqual([[0, 20], [1, 18]]);
  });
});
