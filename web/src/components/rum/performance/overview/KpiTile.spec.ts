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
import KpiTile from "./KpiTile.vue";

const RouterLinkStub = { props: ["to"], template: "<a :data-to='JSON.stringify(to)'><slot /></a>" };

const mountTile = (delta: unknown, extra: Record<string, unknown> = {}) =>
  mount(KpiTile, {
    props: {
      label: "Sessions",
      value: "4,812",
      delta,
      spark: [1, 2, 3],
      sparkTone: "default",
      to: { name: "Sessions", query: { q: "x" } },
      dataTest: "kpi-sessions",
      ariaLabel: "Sessions: 4,812. Open Sessions",
      ...extra,
    } as never,
    global: {
      components: { "router-link": RouterLinkStub },
      stubs: {
        OSparkline: { props: ["dataTest"], template: "<svg :data-test='dataTest' />" },
        OTruncatedText: { template: "<span><slot /></span>" },
      },
    },
  });

describe("KpiTile", () => {
  it("names the link's destination for assistive tech", () => {
    expect(mountTile(null).find('[data-test="kpi-sessions"]').attributes("aria-label")).toBe(
      "Sessions: 4,812. Open Sessions",
    );
  });

  it("shows the value, the signed delta and links to the target", () => {
    const w = mountTile({ kind: "change", text: "+12%", tone: "good" });
    expect(w.find('[data-test="kpi-sessions-value"]').text()).toBe("4,812");
    expect(w.find('[data-test="kpi-sessions-delta"]').text()).toBe("+12% vs previous period");
    expect(JSON.parse(w.find("a").attributes("data-to") as string)).toEqual({
      name: "Sessions",
      query: { q: "x" },
    });
  });

  it("uses translated words for a flat delta and a muted tone", () => {
    const el = mountTile({ kind: "flat", text: "", tone: "flat" }).find(
      '[data-test="kpi-sessions-delta"]',
    );
    expect(el.text()).toBe("No change vs previous period");
    expect(el.classes()).toContain("text-text-secondary");
  });

  it("says there is not enough previous data without a delta", () => {
    expect(mountTile(null).find('[data-test="kpi-sessions-delta"]').text()).toBe(
      "not enough previous data",
    );
  });

  it("says points for a percentage-point change", () => {
    const el = mountTile({ kind: "change", text: "-1.4", tone: "bad" }, { points: true }).find(
      '[data-test="kpi-sessions-delta"]',
    );
    expect(el.text()).toBe("-1.4 pts vs previous period");
  });

  it("states the new case as one sentence", () => {
    const el = mountTile({ kind: "new", text: "", tone: "flat" }).find(
      '[data-test="kpi-sessions-delta"]',
    );
    expect(el.text()).toBe("New vs previous period");
  });

  it("keeps the label and delta visible below the lg breakpoint", () => {
    const compact = mountTile({ kind: "change", text: "+12%", tone: "good" }).find(
      '[data-test="kpi-sessions-compact"]',
    );
    expect(compact.classes()).toContain("lg:hidden");
    expect(compact.text()).toContain("Sessions");
    expect(compact.text()).toContain("+12% vs previous period");
  });

  it("gives the sparkline its own data-test, not the tile's", () => {
    const w = mountTile(null);
    expect(w.find('[data-test="kpi-sessions-trend"]').exists()).toBe(true);
    expect(w.findAll('[data-test="kpi-sessions"]')).toHaveLength(1);
  });
});
