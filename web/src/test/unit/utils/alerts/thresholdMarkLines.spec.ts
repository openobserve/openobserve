import { describe, it, expect } from "vitest";
import { buildThresholdMarkLines } from "@/utils/alerts/thresholdMarkLines";

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
