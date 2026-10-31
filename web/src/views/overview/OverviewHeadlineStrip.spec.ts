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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Math.floor(buildOverview().generated_at / 1000));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OverviewHeadlineStrip", () => {
  it("shows the real value of every tile", () => {
    const w = mountStrip();
    expect(tile(w, "firing").text()).toContain("3");
    expect(tile(w, "failing").text()).toContain("4");
    expect(tile(w, "incidents").text()).toContain("6");
    expect(tile(w, "pipelines").text()).toContain("2");
    expect(tile(w, "pipelines").text()).toContain("of 8 enabled");
    expect(tile(w, "streams").text()).toContain("7");
    expect(tile(w, "streams").text()).not.toContain("GB");
  });

  it("shows the streams gone quiet tile with its real count", () => {
    const w = mountStrip();
    expect(tile(w, "quiet").text()).toContain("Quiet streams");
    expect(tile(w, "quiet").text()).toContain("3");
  });

  it("shows zero quiet streams as a real zero once loaded", () => {
    const base = buildOverview();
    const overview = {
      ...base,
      streams: { status: "ok", data: { ...base.streams.data!, quiet_count: 0 } },
    } as typeof base;
    expect(tile(mountStrip({ overview }), "quiet").text()).toContain("0");
  });

  it("says not set up under the alert tiles when there are no alert rules", () => {
    const base = buildOverview();
    const overview = {
      ...base,
      alerts: {
        status: "ok",
        data: {
          ...base.alerts.data!,
          total: 0,
          enabled: 0,
          failed_evaluation: 0,
          firing: [],
          by_state: {},
        },
      },
    } as typeof base;
    const w = mountStrip({ overview });
    expect(tile(w, "firing").text()).toContain("Not set up");
    expect(tile(w, "failing").text()).toContain("Not set up");
    expect(tile(w, "firing").text()).toContain("—");
    expect(tile(w, "failing").text()).toContain("—");
    expect(tile(w, "pipelines").text()).not.toContain("Not set up");
  });

  it("does not say not set up when alert rules exist", () => {
    expect(tile(mountStrip(), "failing").text()).not.toContain("Not set up");
  });

  it("adds the critical count under the firing tile", () => {
    const text = tile(mountStrip(), "firing").text();
    expect(text).toContain("2 critical");
    expect(text).not.toContain("oldest");
  });

  it("shows the oldest firing age when nothing is critical", () => {
    const base = buildOverview();
    const overview = {
      ...base,
      alerts: {
        status: "ok",
        data: {
          ...base.alerts.data!,
          firing_by_level: { ok: 0, warning: 3, critical: 0, no_data: 0, unclassified: 0 },
        },
      },
    } as typeof base;
    expect(tile(mountStrip({ overview }), "firing").text()).toContain("oldest 1h 0m");
  });

  it("skips a firing row with an unknown since when picking the oldest age", () => {
    const base = buildOverview();
    const [first, second] = base.alerts.data!.firing;
    const withFiring = (firing: NonNullable<typeof base.alerts.data>["firing"]) =>
      ({
        ...base,
        alerts: {
          status: "ok",
          data: {
            ...base.alerts.data!,
            firing,
            firing_by_level: { ok: 0, warning: 3, critical: 0, no_data: 0, unclassified: 0 },
          },
        },
      }) as typeof base;
    const skipped = tile(
      mountStrip({ overview: withFiring([{ ...first, since: 0 }, second]) }),
      "firing",
    ).text();
    expect(skipped).toContain("oldest 16m");
    const unknown = tile(mountStrip({ overview: withFiring([{ ...first, since: 0 }]) }), "firing");
    expect(unknown.text()).not.toContain("oldest");
    expect(unknown.text()).not.toContain("d ");
  });

  it("leaves the firing sub-line out when nothing is critical or listed", () => {
    const base = buildOverview();
    const overview = {
      ...base,
      alerts: {
        status: "ok",
        data: {
          ...base.alerts.data!,
          firing: [],
          firing_by_level: { ok: 0, warning: 1, critical: 0, no_data: 0, unclassified: 0 },
        },
      },
    } as typeof base;
    const text = tile(mountStrip({ overview }), "firing").text();
    expect(text).not.toContain("critical");
    expect(text).not.toContain("oldest");
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
    for (const key of ["firing", "failing", "pipelines", "quiet", "streams"]) {
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
    expect(w.findAll('[data-test="o-stat-card-value-skeleton"]').length).toBe(6);
    expect(tile(w, "firing").text()).not.toContain("0");
  });

  it("shows a dash and our own copy for an errored section, never the API string", () => {
    const overview = buildOverview({
      alerts: { status: "error", error: "db exploded" },
      pipelines: { status: "forbidden", reason: "nope" },
    });
    const w = mountStrip({ overview });
    expect(tile(w, "firing").text()).toContain("—");
    expect(tile(w, "firing").text()).toContain("Could not load");
    expect(tile(w, "pipelines").text()).toContain("No access");
    expect(tile(w, "quiet").text()).toContain("3");
    expect(w.text()).not.toContain("db exploded");
    expect(w.text()).not.toContain("nope");
  });

  it("shows every overview tile as unavailable when the whole request failed", () => {
    const w = mountStrip({ overview: null, failed: true });
    for (const key of ["firing", "failing", "pipelines", "quiet", "streams"]) {
      expect(tile(w, key).text()).toContain("—");
      expect(tile(w, key).text()).toContain("Could not load");
    }
  });

  it("shows a dash on the quiet tile when streams are unavailable", () => {
    const overview = buildOverview({ streams: { status: "error", error: "boom" } });
    const text = tile(mountStrip({ overview }), "quiet").text();
    expect(text).toContain("—");
    expect(text).toContain("Could not load");
  });

  it("shows the incidents tile as locked", () => {
    const w = mountStrip({ incidentsState: "locked" });
    expect(tile(w, "incidents").text()).toContain("—");
    expect(tile(w, "incidents").text()).toContain("Locked");
  });

  it("shows no access and is not clickable when incidents are forbidden", async () => {
    const w = mountStrip({ incidentsState: "forbidden" });
    expect(tile(w, "incidents").text()).toContain("No access");
    await tile(w, "incidents").trigger("click");
    expect(w.emitted("select")).toBeUndefined();
  });

  it("makes a tile selectable only when its section loaded", async () => {
    const overview = buildOverview({ pipelines: { status: "forbidden" } });
    const w = mountStrip({ overview });
    await tile(w, "pipelines").trigger("click");
    expect(w.emitted("select")).toBeUndefined();
    await tile(w, "streams").trigger("click");
    expect(w.emitted("select")).toEqual([["streams"]]);
  });

  it("reads not set up when every alert rule is disabled", () => {
    const full = buildOverview();
    const overview = buildOverview({
      alerts: { status: "ok", data: { ...full.alerts.data!, total: 3, enabled: 0, disabled: 3 } },
    });
    const w = mountStrip({ overview });
    expect(tile(w, "firing").text()).toContain("Not set up");
    expect(tile(w, "failing").text()).toContain("Not set up");
  });

  it("shows a note and is not clickable when incidents are unavailable", async () => {
    const w = mountStrip({ incidentsState: "unavailable" });
    expect(tile(w, "incidents").text()).toContain("Not available");
    expect(tile(w, "incidents").element.tagName).not.toBe("BUTTON");
    await tile(w, "incidents").trigger("click");
    expect(w.emitted("select")).toBeUndefined();
  });

  it("emits the tile key as a button click", async () => {
    const w = mountStrip();
    expect(tile(w, "streams").element.tagName).toBe("BUTTON");
    await tile(w, "streams").trigger("click");
    await tile(w, "failing").trigger("click");
    await tile(w, "quiet").trigger("click");
    expect(w.emitted("select")).toEqual([["streams"], ["failing"], ["quiet"]]);
  });

  it("shows skeletons and no unavailable note while the overview is pending", () => {
    const w = mountStrip({ overview: null, pending: true, failed: false });
    expect(tile(w, "firing").text()).not.toContain("Could not load");
    expect(tile(w, "streams").text()).not.toContain("Could not load");
    expect(tile(w, "streams").text()).not.toContain("—");
    expect(tile(w, "streams").find('[data-test="o-stat-card-value-skeleton"]').exists()).toBe(true);
  });

  it("shows a dash with the unavailable note when the overview failed and is not pending", () => {
    const w = mountStrip({ overview: null, pending: false, failed: true });
    expect(tile(w, "streams").text()).toContain("—");
    expect(tile(w, "streams").text()).toContain("Could not load");
  });
});
