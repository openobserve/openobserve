// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import AoSparkline from "./AoSparkline.vue";
import AoConfidenceMeter from "./AoConfidenceMeter.vue";

const series = [
  { t: 0, v: 10 },
  { t: 1, v: 30 },
  { t: 2, v: null },
  { t: 3, v: 0 },
  { t: 4, v: 0 },
];

const draw = (props: Record<string, unknown> = {}) =>
  mount(AoSparkline, { props: { series, ...props }, global: { plugins: [i18n] } });

const sel = (name: string) => `[data-test="ao-sparkline-${name}"]`;

describe("AoSparkline", () => {
  it("draws the series as a titled image, broken at a null bucket", () => {
    const w = draw({
      label: "Rows per 15 minutes in pay_api",
      markers: [{ t: 3, kind: "detected", label: "Detected at 4:45 PM" }],
    });
    const chart = w.get(sel("chart"));
    expect(chart.attributes("role")).toBe("img");
    expect(chart.attributes("aria-label")).toBe(
      "Rows per 15 minutes in pay_api. Detected at 4:45 PM",
    );
    expect(chart.findAll("path[stroke='currentColor']")).toHaveLength(2);
    expect(w.get(sel("marker-detected")).attributes("title")).toBe("Detected at 4:45 PM");
  });

  it("keeps its height in every state, so nothing below it moves", () => {
    for (const props of [{}, { loading: true }, { error: true }, { series: [] }]) {
      expect(
        draw({ ...props, height: 72 })
          .get('[data-test="ao-sparkline"]')
          .attributes("style"),
      ).toContain("height: 72px");
    }
  });

  it("loading shows a skeleton and no chart", () => {
    const w = draw({ loading: true });
    expect(w.find(sel("loading")).exists()).toBe(true);
    expect(w.find(sel("chart")).exists()).toBe(false);
  });

  it("an error is an alert, says so and offers Retry when the caller can retry", async () => {
    const w = draw({ error: true, retryable: true });
    const err = w.get(sel("error"));
    expect(err.attributes("role")).toBe("alert");
    expect(err.text()).toContain("Couldn't load the chart");
    await w.get(sel("retry")).trigger("click");
    expect(w.emitted("retry")).toHaveLength(1);
    expect(draw({ error: "You can't read this stream" }).get(sel("error")).text()).toContain(
      "You can't read this stream",
    );
  });

  it("no measured point is the empty state, not a flat line", () => {
    const w = draw({ series: [{ t: 0, v: null }] });
    expect(w.get(sel("empty")).text()).toBe("No rows in this window");
    expect(w.find(sel("chart")).exists()).toBe(false);
  });

  it("draws the expected level, band and shaded spans only when they have data, and breaks the band at any unjudged bucket", () => {
    expect(draw().find(sel("expected")).exists()).toBe(false);
    expect(draw().find(sel("band")).exists()).toBe(false);
    expect(draw().find(sel("highlight")).exists()).toBe(false);
    const w = draw({
      expected: [
        { t: 0, v: 12 },
        { t: 4, v: 12 },
      ],
      band: [0, 1, 3, 4].map((t) => ({ t, lower: 8, upper: 16 })),
      highlights: [{ from: 3, to: 4 }],
    });
    expect(w.find(sel("expected")).exists()).toBe(true);
    expect(w.get(sel("band")).attributes("d")?.match(/Z/g)).toHaveLength(2);
    expect(w.findAll(sel("highlight"))).toHaveLength(1);
    const sparse = draw({ band: [0, 2].map((t) => ({ t, lower: 8, upper: 16 })) });
    expect(sparse.get(sel("band")).attributes("d")?.match(/Z/g)).toHaveLength(2);
  });
});

describe("AoConfidenceMeter", () => {
  it.each([
    ["low", 1, "Low"],
    ["medium", 2, "Medium"],
    ["high", 3, "High"],
    [null, 0, "Not scored"],
  ])("%s reads as level %i of three and names the band", (band, level, label) => {
    const w = mount(AoConfidenceMeter, {
      props: { band, reason: "1 decisive source (logs)" },
      global: { plugins: [i18n] },
    });
    const meter = w.get('[role="meter"]');
    expect(meter.attributes("aria-valuenow")).toBe(String(level));
    expect(meter.attributes("aria-valuetext")).toBe(label);
    expect(w.get('[data-test="ao-confidence-band"]').text()).toBe(label);
    expect(w.text().includes("no calibrated score yet")).toBe(band !== null);
    expect(w.get('[data-test="ao-confidence-reason"]').text()).toBe("1 decisive source (logs)");
  });
});
