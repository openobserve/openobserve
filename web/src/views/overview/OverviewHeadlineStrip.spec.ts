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
import OverviewHeadlineStrip from "./OverviewHeadlineStrip.vue";
import { buildOverview } from "./overviewFixtures";

type Props = InstanceType<typeof OverviewHeadlineStrip>["$props"];

const mountStrip = (props: Partial<Props> = {}) =>
  mount(OverviewHeadlineStrip, {
    props: {
      overview: buildOverview(),
      pending: false,
      failed: false,
      incidentsState: "ok",
      incidentsTotal: 6,
      ...props,
    } as Props,
    global: { plugins: [i18n] },
  });

const tile = (w: ReturnType<typeof mountStrip>, key: string) =>
  w.get(`[data-test="overview-headline-${key}"]`);

describe("OverviewHeadlineStrip", () => {
  it("shows the real value of every tile", () => {
    const w = mountStrip();
    expect(tile(w, "firing").text()).toContain("3");
    expect(tile(w, "failing").text()).toContain("4");
    expect(tile(w, "incidents").text()).toContain("6");
    expect(tile(w, "pipelines").text()).toContain("2");
    expect(tile(w, "pipelines").text()).toContain("of 8 enabled");
    expect(tile(w, "streams").text()).toContain("7");
    expect(tile(w, "streams").text()).toContain("2.00 GB");
  });

  it("hides the pipelines sub-line when there are no pipelines", () => {
    const base = buildOverview();
    const overview = {
      ...base,
      pipelines: { status: "ok", data: { total: 0, enabled: 0, disabled: 0, errored: 0 } },
    } as typeof base;
    const w = mountStrip({ overview });
    expect(tile(w, "pipelines").text()).not.toContain("of 0");
    expect(tile(w, "pipelines").text()).not.toContain("of ");
  });

  it("counts a notify-failed rule as firing", () => {
    const base = buildOverview();
    const overview = {
      ...base,
      alerts: {
        status: "ok",
        data: { ...base.alerts.data!, by_state: { firing: 2, notify_failed: 3 } },
      },
    } as typeof base;
    expect(tile(mountStrip({ overview }), "firing").text()).toContain("5");
  });

  it("shows no access on every overview tile for a forbidden request", () => {
    const w = mountStrip({ overview: null, forbidden: true });
    for (const key of ["firing", "failing", "pipelines", "streams"]) {
      expect(tile(w, key).text()).toContain("No access");
    }
  });

  it("skeletons only the incidents tile while incidents load", () => {
    const w = mountStrip({ incidentsState: "loading" });
    expect(w.findAll('[data-test="o-stat-card-value-skeleton"]').length).toBe(1);
    expect(tile(w, "incidents").find('[data-test="o-stat-card-value-skeleton"]').exists()).toBe(
      true,
    );
  });

  it("shows a skeleton, never a zero, while the first load is pending", () => {
    const w = mountStrip({ overview: null, pending: true });
    expect(w.findAll('[data-test="o-stat-card-value-skeleton"]').length).toBe(5);
    expect(tile(w, "firing").text()).not.toContain("0");
  });

  it("shows a dash and our own copy for an errored section, never the API string", () => {
    const overview = buildOverview({
      alerts: { status: "error", error: "db exploded" },
      pipelines: { status: "forbidden", reason: "nope" },
    });
    const w = mountStrip({ overview });
    expect(tile(w, "firing").text()).toContain("—");
    expect(tile(w, "firing").text()).toContain("Unavailable");
    expect(tile(w, "pipelines").text()).toContain("No access");
    expect(w.text()).not.toContain("db exploded");
    expect(w.text()).not.toContain("nope");
  });

  it("shows every overview tile as unavailable when the whole request failed", () => {
    const w = mountStrip({ overview: null, failed: true });
    for (const key of ["firing", "failing", "pipelines", "streams"]) {
      expect(tile(w, key).text()).toContain("—");
      expect(tile(w, key).text()).toContain("Unavailable");
    }
  });

  it("shows the incidents tile as locked", () => {
    const w = mountStrip({ incidentsState: "locked" });
    expect(tile(w, "incidents").text()).toContain("—");
    expect(tile(w, "incidents").text()).toContain("Locked");
  });

  it("emits the tile key as a button click", async () => {
    const w = mountStrip();
    expect(tile(w, "streams").element.tagName).toBe("BUTTON");
    await tile(w, "streams").trigger("click");
    await tile(w, "failing").trigger("click");
    expect(w.emitted("select")).toEqual([["streams"], ["failing"]]);
  });
});
