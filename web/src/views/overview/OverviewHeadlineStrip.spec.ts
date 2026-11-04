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

const valueOf = (w: ReturnType<typeof mountStrip>, key: string) =>
  tile(w, key).get('[data-test="overview-tile-value"]');

const card = (w: ReturnType<typeof mountStrip>, key: string) =>
  w.get(`[data-test="overview-tile-card-${key}"]`);

const noteOf = (w: ReturnType<typeof mountStrip>, key: string) =>
  tile(w, key).find('[data-test="overview-tile-note"]');

const withAlerts = (over: Record<string, unknown>) => {
  const base = buildOverview();
  return {
    ...base,
    alerts: { status: "ok", data: { ...base.alerts.data!, ...over } },
  } as typeof base;
};

const ALL = ["firing", "failing", "incidents", "pipelines", "delivery", "quiet"];
const OVERVIEW_TILES = ["firing", "failing", "pipelines", "delivery", "quiet"];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Math.floor(buildOverview().generated_at / 1000));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OverviewHeadlineStrip", () => {
  it("shows exactly the six problem tiles, in order, with no streams total", () => {
    const w = mountStrip();
    const keys = w
      .findAll('[data-test^="overview-headline-"]:not([data-test="overview-headline-strip"])')
      .map((el) => el.attributes("data-test")?.replace("overview-headline-", ""));
    expect(keys).toEqual(ALL);
    expect(w.find('[data-test="overview-headline-streams"]').exists()).toBe(false);
  });

  it("puts each label above a large value", () => {
    const w = mountStrip();
    for (const key of ALL) {
      const text = tile(w, key).text();
      const value = valueOf(w, key);
      expect(value.classes()).toContain("text-3xl");
      expect(text.indexOf(value.text())).toBeGreaterThan(0);
    }
  });

  it("shows the real value of every tile", () => {
    const w = mountStrip();
    expect(valueOf(w, "firing").text()).toBe("3");
    expect(valueOf(w, "failing").text()).toBe("4");
    expect(valueOf(w, "incidents").text()).toBe("6");
    expect(valueOf(w, "pipelines").text()).toBe("2");
    expect(valueOf(w, "delivery").text()).toBe("0");
    expect(valueOf(w, "quiet").text()).toBe("3");
  });

  it("tones a non-zero problem count as danger and quiet streams as warning", () => {
    const w = mountStrip();
    for (const key of ["firing", "failing", "incidents", "pipelines"]) {
      expect(valueOf(w, key).classes()).toContain("text-status-negative");
    }
    expect(valueOf(w, "quiet").classes()).toContain("text-status-warning-text");
  });

  it("draws a zero in strong ink on the plain card, and only a dash muted", () => {
    const base = buildOverview();
    const overview = {
      ...base,
      streams: { status: "ok", data: { ...base.streams.data!, quiet_count: 0 } },
      pipelines: { status: "ok", data: { total: 3, enabled: 3, disabled: 0, errored: 0 } },
    } as typeof base;
    const w = mountStrip({ overview, incidentsTotal: 0 });
    for (const key of ["quiet", "pipelines", "incidents"]) {
      expect(valueOf(w, key).text()).toBe("0");
      expect(valueOf(w, key).classes()).toEqual(
        expect.arrayContaining(["text-text-heading", "font-bold", "tabular-nums"]),
      );
      expect(card(w, key).classes()).toContain("bg-surface-panel");
    }
    const dash = mountStrip({ incidentsState: "locked" });
    expect(valueOf(dash, "incidents").classes()).toContain("text-text-muted");
  });

  it("tints a tile with a problem and colours its note like its value", () => {
    const w = mountStrip();
    expect(card(w, "firing").classes()).toEqual(
      expect.arrayContaining(["bg-status-error-bg", "border-status-negative"]),
    );
    expect(card(w, "quiet").classes()).toEqual(
      expect.arrayContaining(["bg-status-warning-bg", "border-status-warning-text"]),
    );
    expect(noteOf(w, "failing").classes()).toContain("text-status-negative");
    expect(noteOf(w, "quiet").classes()).toContain("text-status-warning-text");
  });

  it("marks a good-state note with the success colour and a check, keeping the words", () => {
    const overview = withAlerts({
      by_state: {},
      failed_evaluation: 0,
      firing: [],
      firing_by_level: { ok: 0, warning: 0, critical: 0, no_data: 0, unclassified: 0 },
    });
    const base = buildOverview();
    const w = mountStrip({
      overview: {
        ...overview,
        pipelines: { status: "ok", data: { ...base.pipelines.data!, errored: 0 } },
      },
      incidentsTotal: 0,
    });
    for (const key of ["firing", "failing", "incidents", "pipelines"]) {
      expect(noteOf(w, key).classes()).toContain("text-status-success-text");
      const icon = noteOf(w, key).element.previousElementSibling!;
      expect(icon.getAttribute("aria-hidden")).toBe("true");
    }
    expect(noteOf(w, "firing").text()).toBe("None firing");
    expect(noteOf(w, "delivery").classes()).toContain("text-text-secondary");
  });

  it("keeps a two-line note slot on every tile so their rhythm matches", () => {
    const w = mountStrip({ incidentsState: "ok", incidentsTotal: 2 });
    for (const key of ALL) {
      expect(tile(w, key).find(".min-h-8").exists()).toBe(true);
    }
  });

  it("puts the critical count beside the value and the oldest firing age below it", () => {
    const w = mountStrip();
    expect(tile(w, "firing").get('[data-test="overview-tile-unit"]').text()).toBe(
      "2 at critical level",
    );
    expect(noteOf(w, "firing").text()).toBe("Oldest firing for 1h 0m");
    const value = valueOf(w, "firing").element;
    expect(value.parentElement?.classList.contains("items-baseline")).toBe(true);
  });

  it("says zero at critical level when nothing is critical", () => {
    const overview = withAlerts({
      firing_by_level: { ok: 0, warning: 3, critical: 0, no_data: 0, unclassified: 0 },
    });
    const w = mountStrip({ overview });
    expect(tile(w, "firing").get('[data-test="overview-tile-unit"]').text()).toBe(
      "0 at critical level",
    );
  });

  it("leaves out the age note when no firing age is known", () => {
    const [first] = buildOverview().alerts.data!.firing;
    const overview = withAlerts({ firing: [{ ...first, since: 0 }] });
    expect(noteOf(mountStrip({ overview }), "firing").exists()).toBe(false);
  });

  it("skips a firing row with an unknown since when picking the oldest age", () => {
    const [first, second] = buildOverview().alerts.data!.firing;
    const overview = withAlerts({
      firing: [{ ...first, since: 0 }, second],
      firing_by_level: { ok: 0, warning: 3, critical: 0, no_data: 0, unclassified: 0 },
    });
    expect(noteOf(mountStrip({ overview }), "firing").text()).toBe("Oldest firing for 16m");
  });

  it("says none firing and none failing at zero", () => {
    const overview = withAlerts({
      by_state: {},
      failed_evaluation: 0,
      firing: [],
      firing_by_level: { ok: 0, warning: 0, critical: 0, no_data: 0, unclassified: 0 },
    });
    const w = mountStrip({ overview, incidentsTotal: 0 });
    expect(noteOf(w, "firing").text()).toBe("None firing");
    expect(tile(w, "firing").find('[data-test="overview-tile-unit"]').exists()).toBe(false);
    expect(noteOf(w, "failing").text()).toBe("None failing");
    expect(noteOf(w, "incidents").text()).toBe("None open");
  });

  it("notes why rules are failing when some are", () => {
    expect(noteOf(mountStrip(), "failing").text()).toBe("Last evaluation errored");
  });

  it("shows a dash and no alert rules on the alert tiles when there are none", () => {
    const overview = withAlerts({
      total: 0,
      enabled: 0,
      failed_evaluation: 0,
      firing: [],
      by_state: {},
    });
    const w = mountStrip({ overview });
    for (const key of ["firing", "failing", "delivery"]) {
      expect(valueOf(w, key).text()).toBe("—");
      expect(noteOf(w, key).text()).toBe("No alert rules");
    }
    expect(tile(w, "pipelines").text()).not.toContain("No alert rules");
  });

  it("says no enabled rules when every alert rule is disabled", () => {
    const overview = withAlerts({ total: 3, enabled: 0, disabled: 3 });
    const w = mountStrip({ overview });
    expect(valueOf(w, "firing").text()).toBe("—");
    expect(noteOf(w, "firing").text()).toBe("No enabled rules");
    expect(noteOf(w, "failing").text()).toBe("No enabled rules");
  });

  it("notes the enabled pipelines, or a dash and no pipelines when there are none", () => {
    expect(noteOf(mountStrip(), "pipelines").text()).toBe("of 8 enabled");
    const base = buildOverview();
    const overview = {
      ...base,
      pipelines: { status: "ok", data: { total: 0, enabled: 0, disabled: 0, errored: 0 } },
    } as typeof base;
    const w = mountStrip({ overview });
    expect(valueOf(w, "pipelines").text()).toBe("—");
    expect(noteOf(w, "pipelines").text()).toBe("No pipelines");
  });

  it("notes the quiet definition, or no streams when there are none", () => {
    expect(noteOf(mountStrip(), "quiet").text()).toBe("Stopped writing in the last 7 days");
    const base = buildOverview();
    const overview = {
      ...base,
      streams: { status: "ok", data: { ...base.streams.data!, total_streams: 0, quiet_count: 0 } },
    } as typeof base;
    const w = mountStrip({ overview });
    expect(valueOf(w, "quiet").text()).toBe("—");
    expect(noteOf(w, "quiet").text()).toBe("No streams");
  });

  it("counts a notify-failed rule as firing", () => {
    const overview = withAlerts({ by_state: { firing: 2, notify_failed: 3 } });
    expect(valueOf(mountStrip({ overview }), "firing").text()).toBe("5");
  });

  it("shows no access on every overview tile for a forbidden request", () => {
    const w = mountStrip({ overview: null, forbidden: true });
    for (const key of OVERVIEW_TILES) {
      expect(noteOf(w, key).text()).toBe("No access");
    }
  });

  it("skeletons only the incidents tile while incidents load", () => {
    const w = mountStrip({ incidentsState: "loading" });
    expect(w.findAll('[data-test="overview-tile-skeleton"]').length).toBe(1);
    expect(tile(w, "incidents").find('[data-test="overview-tile-skeleton"]').exists()).toBe(true);
  });

  it("shows a skeleton, never a zero, and no unavailable note while the first load is pending", () => {
    const w = mountStrip({ overview: null, pending: true });
    expect(w.findAll('[data-test="overview-tile-skeleton"]').length).toBe(5);
    expect(tile(w, "firing").text()).not.toContain("0");
    expect(tile(w, "quiet").text()).not.toContain("Could not load");
    expect(tile(w, "quiet").text()).not.toContain("—");
  });

  it("shows a dash and our own copy for an errored section, never the API string", () => {
    const overview = buildOverview({
      alerts: { status: "error", error: "db exploded" },
      pipelines: { status: "forbidden", reason: "nope" },
    });
    const w = mountStrip({ overview });
    expect(valueOf(w, "firing").text()).toBe("—");
    expect(noteOf(w, "firing").text()).toBe("Could not load");
    expect(noteOf(w, "pipelines").text()).toBe("No access");
    expect(valueOf(w, "quiet").text()).toBe("3");
    expect(w.text()).not.toContain("db exploded");
    expect(w.text()).not.toContain("nope");
  });

  it("shows every overview tile as unavailable when the whole request failed", () => {
    const w = mountStrip({ overview: null, failed: true });
    for (const key of OVERVIEW_TILES) {
      expect(valueOf(w, key).text()).toBe("—");
      expect(noteOf(w, key).text()).toBe("Could not load");
    }
  });

  it("shows the incidents tile as locked", () => {
    const w = mountStrip({ incidentsState: "locked" });
    expect(valueOf(w, "incidents").text()).toBe("—");
    expect(noteOf(w, "incidents").text()).toBe("Locked");
  });

  it("shows no access and is not clickable when incidents are forbidden", async () => {
    const w = mountStrip({ incidentsState: "forbidden" });
    expect(noteOf(w, "incidents").text()).toBe("No access");
    await tile(w, "incidents").trigger("click");
    expect(w.emitted("select")).toBeUndefined();
  });

  it("shows a note and is not clickable when incidents are unavailable", async () => {
    const w = mountStrip({ incidentsState: "unavailable" });
    expect(noteOf(w, "incidents").text()).toBe("Not available");
    expect(tile(w, "incidents").element.tagName).not.toBe("BUTTON");
    await tile(w, "incidents").trigger("click");
    expect(w.emitted("select")).toBeUndefined();
  });

  it("makes a tile selectable only when its section loaded", async () => {
    const overview = buildOverview({ pipelines: { status: "forbidden" } });
    const w = mountStrip({ overview });
    await tile(w, "pipelines").trigger("click");
    expect(w.emitted("select")).toBeUndefined();
    await tile(w, "quiet").trigger("click");
    expect(w.emitted("select")).toEqual([["quiet"]]);
  });

  it("shows delivery failures from notify_failed with their meaning, toned as danger", () => {
    const overview = withAlerts({ by_state: { firing: 1, notify_failed: 2 } });
    const w = mountStrip({ overview });
    expect(tile(w, "delivery").text()).toContain("Alert delivery failures");
    expect(valueOf(w, "delivery").text()).toBe("2");
    expect(valueOf(w, "delivery").classes()).toContain("text-status-negative");
    expect(noteOf(w, "delivery").text()).toBe("Alerts that fired but could not notify");
  });

  it("lays the tiles out six across on wide screens, three on medium and two on phones", () => {
    const classes = mountStrip().get('[data-test="overview-headline-strip"]').classes();
    expect(classes).toEqual(
      expect.arrayContaining(["grid-cols-6", "max-xl:grid-cols-3", "max-md:grid-cols-2"]),
    );
  });

  it("emits the tile key as a button click", async () => {
    const w = mountStrip();
    expect(tile(w, "firing").element.tagName).toBe("BUTTON");
    await tile(w, "firing").trigger("click");
    await tile(w, "failing").trigger("click");
    await tile(w, "incidents").trigger("click");
    await tile(w, "delivery").trigger("click");
    expect(w.emitted("select")).toEqual([["firing"], ["failing"], ["incidents"], ["delivery"]]);
  });
});
