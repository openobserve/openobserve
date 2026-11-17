import { describe, expect, it } from "vitest";
import { fitColumnSize, TABLE_MAX_HEIGHT } from "./tableSizing";

describe("fitColumnSize", () => {
  it("sizes to the longest value", () => {
    expect(fitColumnSize("Age", ["1m", "10m"])).toBeLessThan(
      fitColumnSize("Name", ["cd-github-runners-np-2g2fc"]),
    );
  });

  it("never goes below the header width", () => {
    expect(fitColumnSize("A very long header", [])).toBeGreaterThan(fitColumnSize("Age", []));
  });

  it("clamps to the min and max", () => {
    expect(fitColumnSize("a", ["b"], { min: 90 })).toBe(90);
    expect(fitColumnSize("a", ["x".repeat(500)], { max: 300 })).toBe(300);
  });

  it("counts full-width glyphs as two characters", () => {
    expect(fitColumnSize("a", ["日本語のメッセージ"])).toBeGreaterThan(
      fitColumnSize("a", ["abcdefghi"]),
    );
  });

  it("ignores nullish values", () => {
    expect(fitColumnSize("Node", [null, undefined, "ip-10-0-1-5"])).toBe(
      fitColumnSize("Node", ["ip-10-0-1-5"]),
    );
  });

  it("caps tall tables at 70% of the viewport", () => {
    expect(TABLE_MAX_HEIGHT).toBe("70vh");
  });
});
