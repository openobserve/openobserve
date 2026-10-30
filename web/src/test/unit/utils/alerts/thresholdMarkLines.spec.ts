import { describe, it, expect } from "vitest";
import { buildThresholdMarkLines, thresholdAxisBounds } from "@/utils/alerts/thresholdMarkLines";

// Marklines for the alert preview chart. One helper feeds every query mode
// (builder/aggregation, SQL, custom SQL, PromQL) so Critical and Warning are
// always drawn together and styled the same way.

describe("buildThresholdMarkLines", () => {
  it("critical only", () => {
    const lines = buildThresholdMarkLines(1190, undefined);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      name: "Critical",
      type: "yAxis",
      value: "1190",
    });
  });

  it("critical + warning when both configured", () => {
    const lines = buildThresholdMarkLines(1190, 800);
    expect(lines.map((l) => l.name)).toEqual(["Critical", "Warning"]);
    expect(lines[1].value).toBe("800");
  });

  it("warning alone still renders (draft forms may fill warning first)", () => {
    const lines = buildThresholdMarkLines("", 800);
    expect(lines.map((l) => l.name)).toEqual(["Warning"]);
  });

  it("empty/null/undefined values produce no lines", () => {
    expect(buildThresholdMarkLines(undefined, null)).toEqual([]);
    expect(buildThresholdMarkLines("", "")).toEqual([]);
  });

  it("zero is a legitimate threshold, not an empty value", () => {
    const lines = buildThresholdMarkLines(0, undefined);
    expect(lines).toHaveLength(1);
    expect(lines[0].value).toBe("0");
  });

  it("text labels are suppressed — colour alone identifies the level", () => {
    for (const line of buildThresholdMarkLines(100, 50)) {
      expect(line.show_label).toBe(false);
    }
  });

  it("levels are colour-coded (critical red, warning amber)", () => {
    const [critical, warning] = buildThresholdMarkLines(100, 50);
    expect(critical.color).toBeTruthy();
    expect(warning.color).toBeTruthy();
    expect(critical.color).not.toBe(warning.color);
  });
});

describe("thresholdAxisBounds", () => {
  const line = (value: string | number) => ({
    name: "Critical" as const,
    type: "yAxis" as const,
    value: String(value),
    color: "#f00",
    show_label: false as const,
  });

  it("reaches past the highest threshold so the line is not drawn on the edge", () => {
    // The reported bug: every value below the threshold, so the chart scaled to
    // the data and the threshold line fell outside the plot area entirely.
    const bounds = thresholdAxisBounds([line(100)]);

    expect(bounds.y_axis_max).toBeGreaterThan(100);
  });

  it("reaches below the lowest threshold too", () => {
    // The mirror case: a below-threshold alert whose data all sits above it.
    const bounds = thresholdAxisBounds([line(-20)]);

    expect(bounds.y_axis_min).toBeLessThan(-20);
  });

  it("spans both levels when critical and warning are set", () => {
    const bounds = thresholdAxisBounds([line(100), { ...line(40), name: "Warning" }]);

    expect(bounds.y_axis_max).toBeGreaterThan(100);
    expect(bounds.y_axis_min).toBeLessThan(40);
  });

  it("pads a zero threshold by an absolute amount, not by zero percent", () => {
    const bounds = thresholdAxisBounds([line(0)]);

    expect(bounds.y_axis_max).toBeGreaterThan(0);
    expect(bounds.y_axis_min).toBeLessThan(0);
  });

  it("returns nothing to apply when there are no thresholds", () => {
    expect(thresholdAxisBounds([])).toEqual({});
  });

  it("ignores a non-numeric threshold rather than poisoning the axis with NaN", () => {
    expect(thresholdAxisBounds([line("not-a-number")])).toEqual({});
  });

  it("keeps usable bounds when only one of two thresholds parses", () => {
    const bounds = thresholdAxisBounds([line(100), { ...line("oops"), name: "Warning" }]);

    expect(Number.isFinite(bounds.y_axis_max)).toBe(true);
    expect(bounds.y_axis_max).toBeGreaterThan(100);
  });

  it("pairs with buildThresholdMarkLines end to end", () => {
    const bounds = thresholdAxisBounds(buildThresholdMarkLines(500, 250));

    expect(bounds.y_axis_max).toBeGreaterThan(500);
    expect(bounds.y_axis_min).toBeLessThan(250);
  });
});
