// Copyright 2026 OpenObserve Inc.
//
// Tests for the small SVG sparkline rendered under each KPI card.
// We mount the component (jsdom) and inspect the rendered SVG path
// data + attributes — the math is in the computed properties so we
// pin the path strings against representative inputs.

// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import KpiSparkline from "./KpiSparkline.vue";

describe("KpiSparkline — rendering", () => {
  // Empty / single-point data → no SVG, just a placeholder div with
  // the requested height. This avoids zero-division in the path math
  // and gives a sensible empty-state visual.
  it("renders a placeholder div (no SVG) when data has fewer than 2 points", () => {
    const wrapper = mount(KpiSparkline, { props: { data: [] } });
    expect(wrapper.find("svg").exists()).toBe(false);
    expect(wrapper.find("div").exists()).toBe(true);
  });

  it("renders a placeholder div for a single data point", () => {
    const wrapper = mount(KpiSparkline, { props: { data: [42] } });
    expect(wrapper.find("svg").exists()).toBe(false);
  });

  // Two or more points → SVG is rendered.
  it("renders the SVG when data has ≥ 2 points", () => {
    const wrapper = mount(KpiSparkline, { props: { data: [1, 2, 3] } });
    expect(wrapper.find("svg").exists()).toBe(true);
  });

  // The placeholder div carries the requested height so the layout
  // doesn't collapse when there's no data — KPI cards reserve the
  // sparkline space regardless.
  it("placeholder div carries the height prop", () => {
    const wrapper = mount(KpiSparkline, {
      props: { data: [], height: 50 },
    });
    expect(wrapper.find("div").attributes("style")).toContain("height: 50px");
  });
});

describe("KpiSparkline — defaults", () => {
  // Default color: brand blue. A future palette tweak should fail
  // these tests so callers passing custom colors aren't surprised.
  it("uses #3b82f6 as the default stroke color", () => {
    const wrapper = mount(KpiSparkline, { props: { data: [1, 2, 3] } });
    const linePath = wrapper.findAll("path")[1]; // 0=area, 1=line
    expect(linePath.attributes("stroke")).toBe("#3b82f6");
  });

  // Default height: 38px (the size used under each KPI card).
  it("uses 38px as the default height", () => {
    const wrapper = mount(KpiSparkline, { props: { data: [1, 2, 3] } });
    const svg = wrapper.find("svg");
    expect(svg.attributes("style")).toContain("height: 38px");
    // viewBox is `0 0 <width> <height>` — Vue Test Utils preserves SVG
    // attribute case, so the key is `viewBox` not `viewbox`.
    expect(svg.attributes("viewBox")).toContain(" 38");
  });
});

describe("KpiSparkline — color prop", () => {
  // Custom color flows to the line stroke and to BOTH gradient stops
  // (the area fill is derived from the color).
  it("applies the color prop to the line stroke", () => {
    const wrapper = mount(KpiSparkline, {
      props: { data: [1, 2, 3], color: "#ff0000" },
    });
    const linePath = wrapper.findAll("path")[1];
    expect(linePath.attributes("stroke")).toBe("#ff0000");
  });

  it("applies the color prop to the gradient stops", () => {
    const wrapper = mount(KpiSparkline, {
      props: { data: [1, 2, 3], color: "#a855f7" },
    });
    const stops = wrapper.findAll("stop");
    // 3 stops in the linearGradient
    expect(stops.length).toBe(3);
    for (const s of stops) {
      expect(s.attributes("stop-color")).toBe("#a855f7");
    }
  });
});

describe("KpiSparkline — line path math", () => {
  // For 2 points we expect: M start L end. The y-coordinates encode
  // the data-min (mapped to bottom of usable area) vs data-max (mapped
  // to top, with a 2px top padding).
  it("emits a 2-point line path: M ... L ...", () => {
    const wrapper = mount(KpiSparkline, { props: { data: [0, 10] } });
    const linePath = wrapper.findAll("path")[1].attributes("d") || "";
    // Format: "Mx,y Lx,y"
    expect(linePath).toMatch(/^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+$/);
  });

  // For N points we expect: M + (N-1) L commands.
  it("emits N-1 L commands for N points", () => {
    const wrapper = mount(KpiSparkline, {
      props: { data: [0, 5, 10, 15] },
    });
    const linePath = wrapper.findAll("path")[1].attributes("d") || "";
    const lCount = (linePath.match(/L/g) || []).length;
    expect(lCount).toBe(3); // 4 points → 1 M + 3 L
  });

  // X-coordinates are spread across the fixed 200px viewBox width.
  // First point at x=0, last point at x=200, evenly spaced in between.
  it("spreads X coordinates linearly from 0 to 200", () => {
    const wrapper = mount(KpiSparkline, {
      props: { data: [0, 1, 2, 3] }, // 4 points
    });
    const linePath = wrapper.findAll("path")[1].attributes("d") || "";
    // Extract x-coordinates from the path commands
    const xs = [...linePath.matchAll(/[ML](-?\d+\.?\d*),/g)].map((m) =>
      parseFloat(m[1]),
    );
    expect(xs[0]).toBeCloseTo(0);
    expect(xs[xs.length - 1]).toBeCloseTo(200);
    // Even spacing — the values are rounded to 2 decimals via toFixed(2),
    // so neighbouring spans can differ by up to 0.01. Allow that tolerance.
    expect(Math.abs((xs[1] - xs[0]) - (xs[2] - xs[1]))).toBeLessThan(0.02);
  });

  // All-equal data → flat line. Range fallback to 1 prevents NaN.
  // Y-coordinate ends up at the top of the usable area (padTop=2).
  it("flat line for all-equal data (no NaN)", () => {
    const wrapper = mount(KpiSparkline, {
      props: { data: [5, 5, 5, 5] },
    });
    const linePath = wrapper.findAll("path")[1].attributes("d") || "";
    expect(linePath).not.toContain("NaN");
    // All y-coordinates should be the same
    const ys = [...linePath.matchAll(/,(-?\d+\.?\d*)/g)].map((m) =>
      parseFloat(m[1]),
    );
    const allSame = ys.every((y) => y === ys[0]);
    expect(allSame).toBe(true);
  });

  // All-zero data — same as all-equal (flat line at the top of the
  // usable area, no NaN).
  it("flat line for all-zero data", () => {
    const wrapper = mount(KpiSparkline, {
      props: { data: [0, 0, 0] },
    });
    const linePath = wrapper.findAll("path")[1].attributes("d") || "";
    expect(linePath).not.toContain("NaN");
  });

  // Decreasing data — the lowest point should land at the bottom,
  // the highest at the top.
  it("maps min value to lower-y and max value to upper-y (within padding)", () => {
    const wrapper = mount(KpiSparkline, {
      props: { data: [10, 5, 0], height: 100 },
    });
    const linePath = wrapper.findAll("path")[1].attributes("d") || "";
    const ys = [...linePath.matchAll(/,(-?\d+\.?\d*)/g)].map((m) =>
      parseFloat(m[1]),
    );
    // First (data=10, max) at top → y close to padTop=2
    expect(ys[0]).toBeCloseTo(2, 0);
    // Last (data=0, min) at bottom → y close to height - padBottom = 98
    expect(ys[2]).toBeCloseTo(98, 0);
  });
});

describe("KpiSparkline — area path", () => {
  // The area is the line path PLUS two extra L commands that close
  // the shape down to the baseline (y=height) at both ends, then a Z.
  it("closes the area to the baseline at both ends and ends with Z", () => {
    const wrapper = mount(KpiSparkline, {
      props: { data: [1, 2, 3], height: 40 },
    });
    const areaPath = wrapper.findAll("path")[0].attributes("d") || "";
    // Ends with: L<lastX>,40 L<firstX>,40 Z
    expect(areaPath.endsWith("Z")).toBe(true);
    // The two closing-Y values should be the height (40)
    expect(areaPath).toMatch(/L\d+\.\d+,40\b/);
  });

  // Area path uses the gradient fill that references the unique
  // gradient id generated per-mount.
  it("uses the gradient fill (url(#kpi-spark-...))", () => {
    const wrapper = mount(KpiSparkline, { props: { data: [1, 2] } });
    const areaPath = wrapper.findAll("path")[0];
    expect(areaPath.attributes("fill")).toMatch(/^url\(#kpi-spark-/);
  });
});

describe("KpiSparkline — gradient id uniqueness", () => {
  // Two simultaneously-mounted sparklines must have distinct gradient
  // IDs so their fills don't bleed into each other (a duplicate id
  // would make the second sparkline pick up the first's gradient).
  it("generates unique gradient ids per mount", () => {
    const a = mount(KpiSparkline, { props: { data: [1, 2] } });
    const b = mount(KpiSparkline, { props: { data: [1, 2] } });
    const idA = a.find("linearGradient").attributes("id");
    const idB = b.find("linearGradient").attributes("id");
    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();
    expect(idA).not.toBe(idB);
  });

  // The id matches the documented pattern.
  it("gradient id starts with `kpi-spark-`", () => {
    const wrapper = mount(KpiSparkline, { props: { data: [1, 2] } });
    expect(wrapper.find("linearGradient").attributes("id")).toMatch(
      /^kpi-spark-/,
    );
  });
});

describe("KpiSparkline — preserveAspectRatio", () => {
  // Sparkline stretches to fill the parent's width. Without
  // `preserveAspectRatio="none"` the SVG would maintain a square
  // aspect ratio and shrink instead.
  it("uses preserveAspectRatio=none so the line scales to fit width", () => {
    const wrapper = mount(KpiSparkline, { props: { data: [1, 2] } });
    expect(wrapper.find("svg").attributes("preserveAspectRatio")).toBe(
      "none",
    );
  });
});
