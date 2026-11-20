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
import config from "@/aws-exports";
import store from "@/test/unit/helpers/store";
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
    global: { plugins: [i18n, store] },
  });

const tile = (w: ReturnType<typeof mountStrip>, key: string) =>
  w.get(`[data-test="overview-headline-${key}"]`);

const valueOf = (w: ReturnType<typeof mountStrip>, key: string) =>
  tile(w, key).get('[data-test="overview-tile-value"]');

const card = (w: ReturnType<typeof mountStrip>, key: string) =>
  w.get(`[data-test="overview-tile-card-${key}"]`);

const noteOf = (w: ReturnType<typeof mountStrip>, key: string) =>
  card(w, key).find('[data-test="overview-tile-note"]');

const withAlerts = (over: Record<string, unknown>) => {
  const base = buildOverview();
  return {
    ...base,
    alerts: { status: "ok", data: { ...base.alerts.data!, ...over } },
  } as typeof base;
};

const ALL = ["failing", "incidents", "pipelines", "delivery", "quiet"];
const OVERVIEW_TILES = ["failing", "pipelines", "delivery", "quiet"];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Math.floor(buildOverview().generated_at / 1000));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OverviewHeadlineStrip", () => {
  it("shows exactly the five problem tiles, in order, with no firing or streams total", () => {
    const w = mountStrip();
    const keys = w
      .findAll('[data-test^="overview-headline-"]:not([data-test="overview-headline-strip"])')
      .map((el) => el.attributes("data-test")?.replace("overview-headline-", ""));
    expect(keys).toEqual(ALL);
    expect(w.find('[data-test="overview-headline-streams"]').exists()).toBe(false);
    expect(w.find('[data-test="overview-headline-firing"]').exists()).toBe(false);
  });

  it("says a failed summary once, inline, with Retry", async () => {
    const w = mountStrip({ overview: null, failed: true, incidentsState: "locked" });
    expect(w.get('[data-test="overview-summary-error"]').text()).toContain(
      "Couldn't load the org summary",
    );
    await w.get('[data-test="overview-summary-retry"]').trigger("click");
    expect(w.emitted("retry")).toHaveLength(1);
    expect(w.get('[data-test="overview-headline-strip"]').attributes("aria-hidden")).toBe("true");
  });

  it("formats every count compactly, as the rest of Home does", () => {
    const base = buildOverview();
    const overview = {
      ...base,
      streams: { status: "ok", data: { ...base.streams.data!, quiet_count: 98_213 } },
    } as typeof base;
    expect(valueOf(mountStrip({ overview, incidentsTotal: 1_250_000 }), "quiet").text()).toBe(
      "98.2K",
    );
    expect(valueOf(mountStrip({ overview, incidentsTotal: 1_250_000 }), "incidents").text()).toBe(
      "1.3M",
    );
  });

  it("puts each value at the KPI size above its label", () => {
    const w = mountStrip();
    for (const key of ALL) {
      const value = valueOf(w, key);
      const label = card(w, key).get('[data-test="overview-tile-label"]');
      expect(value.classes()).toEqual(expect.arrayContaining(["text-xl", "font-semibold"]));
      expect(label.classes()).toEqual(expect.arrayContaining(["text-xs", "text-text-secondary"]));
      expect(
        value.element.compareDocumentPosition(label.element) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("shows the real value of every tile", () => {
    const w = mountStrip();
    expect(valueOf(w, "failing").text()).toBe("4");
    expect(valueOf(w, "incidents").text()).toBe("6");
    expect(valueOf(w, "pipelines").text()).toBe("2");
    expect(valueOf(w, "delivery").text()).toBe("0");
    expect(valueOf(w, "quiet").text()).toBe("3");
  });

  it("keeps red for incidents and pipeline errors, and tones the other problems as warning", () => {
    const w = mountStrip();
    for (const key of ["incidents", "pipelines"]) {
      expect(valueOf(w, key).classes()).toContain("text-status-negative");
    }
    for (const key of ["failing", "quiet"]) {
      expect(valueOf(w, key).classes()).toContain("text-status-warning-text");
    }
  });

  it("draws a zero in strong ink with no box, and only a dash muted", () => {
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
        expect.arrayContaining(["text-text-heading", "font-semibold", "tabular-nums"]),
      );
      expect(card(w, key).classes()).not.toContain("border");
    }
    const dash = mountStrip({ incidentsState: "locked" });
    expect(valueOf(dash, "incidents").classes()).toContain("text-text-muted");
  });

  it("colours a problem in its value and note, never with a tinted box", () => {
    const w = mountStrip();
    for (const key of ["failing", "quiet"]) {
      expect(card(w, key).classes()).not.toContain("bg-status-error-bg");
      expect(card(w, key).classes()).not.toContain("bg-status-warning-bg");
    }
    expect(noteOf(w, "failing").classes()).toContain("text-status-warning-text");
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
    for (const key of ["failing", "incidents", "pipelines"]) {
      expect(noteOf(w, key).classes()).toContain("text-status-success-text");
      const icon = noteOf(w, key).element.previousElementSibling!;
      expect(icon.getAttribute("aria-hidden")).toBe("true");
    }
    expect(noteOf(w, "delivery").classes()).toContain("text-text-secondary");
  });

  it("keeps a two-line note slot on every tile so their rhythm matches", () => {
    const w = mountStrip({ incidentsState: "ok", incidentsTotal: 2 });
    for (const key of ALL) {
      expect(card(w, key).find(".min-h-8").exists()).toBe(true);
    }
  });

  it("says none failing and none open at zero", () => {
    const overview = withAlerts({
      by_state: {},
      failed_evaluation: 0,
      firing: [],
      firing_by_level: { ok: 0, warning: 0, critical: 0, no_data: 0, unclassified: 0 },
    });
    const w = mountStrip({ overview, incidentsTotal: 0 });
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
    for (const key of ["failing", "delivery"]) {
      expect(valueOf(w, key).text()).toBe("—");
      expect(noteOf(w, key).text()).toBe("No alert rules");
    }
    expect(card(w, "pipelines").text()).not.toContain("No alert rules");
  });

  it("says no enabled rules when every alert rule is disabled", () => {
    const overview = withAlerts({ total: 3, enabled: 0, disabled: 3 });
    const w = mountStrip({ overview });
    expect(valueOf(w, "failing").text()).toBe("—");
    expect(noteOf(w, "failing").text()).toBe("No enabled rules");
    expect(noteOf(w, "delivery").text()).toBe("No enabled rules");
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
    expect(w.findAll('[data-test="overview-tile-skeleton"]').length).toBe(4);
    expect(tile(w, "failing").text()).not.toContain("0");
    expect(card(w, "quiet").text()).not.toContain("Could not load");
    expect(card(w, "quiet").text()).not.toContain("—");
  });

  it("shows a dash and our own copy for an errored section, never the API string", () => {
    const overview = buildOverview({
      alerts: { status: "error", error: "db exploded" },
      pipelines: { status: "forbidden", reason: "nope" },
    });
    const w = mountStrip({ overview });
    expect(valueOf(w, "failing").text()).toBe("—");
    expect(noteOf(w, "failing").text()).toBe("Could not load");
    expect(noteOf(w, "pipelines").text()).toBe("No access");
    expect(valueOf(w, "quiet").text()).toBe("3");
    expect(w.text()).not.toContain("db exploded");
    expect(w.text()).not.toContain("nope");
  });

  it("hides the tiles and keeps their box when the whole request failed", () => {
    const w = mountStrip({ overview: null, failed: true, incidentsState: "locked" });
    const grid = w.get('[data-test="overview-headline-strip"]');
    expect(grid.classes()).toContain("invisible");
    expect(grid.attributes("aria-hidden")).toBe("true");
  });

  it("keeps the delivery count the alert list gave when the summary failed", () => {
    const w = mountStrip({
      overview: null,
      failed: true,
      incidentsState: "locked",
      deliveryFailures: 5,
    });
    expect(w.get('[data-test="overview-failed-delivery"]').text()).toBe(
      "5 alert delivery failures",
    );
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

  it("leaves the incidents tile out when incidents are unavailable", () => {
    const w = mountStrip({ incidentsState: "unavailable" });
    expect(w.find('[data-test="overview-tile-card-incidents"]').exists()).toBe(false);
  });

  it("keeps a value a link to its page unless the section is refused", async () => {
    const overview = buildOverview({
      pipelines: { status: "forbidden" },
      alerts: { status: "error", error: "boom" },
    });
    const w = mountStrip({ overview });
    expect(tile(w, "pipelines").element.tagName).not.toBe("BUTTON");
    await tile(w, "pipelines").trigger("click");
    expect(w.emitted("select")).toBeUndefined();
    await tile(w, "failing").trigger("click");
    await tile(w, "quiet").trigger("click");
    expect(w.emitted("select")).toEqual([["failing"], ["quiet"]]);
  });

  it("shows delivery failures from notify_failed with their meaning, toned as a warning", () => {
    const overview = withAlerts({ by_state: { firing: 1, notify_failed: 2 } });
    const w = mountStrip({ overview });
    expect(card(w, "delivery").text()).toContain("Alert delivery failures");
    expect(valueOf(w, "delivery").text()).toBe("2");
    expect(valueOf(w, "delivery").classes()).toContain("text-status-warning-text");
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
    expect(tile(w, "failing").element.tagName).toBe("BUTTON");
    await tile(w, "failing").trigger("click");
    await tile(w, "incidents").trigger("click");
    await tile(w, "delivery").trigger("click");
    expect(w.emitted("select")).toEqual([["failing"], ["incidents"], ["delivery"]]);
  });
});

describe("OverviewHeadlineStrip Ask AI", () => {
  let zo: Record<string, unknown>;
  let flag: string;
  const askBtn = (w: ReturnType<typeof mountStrip>, key: string) =>
    w.find(`[data-test="overview-ask-ai-tile-${key}"]`);
  const mountAi = (props: Partial<Props> = {}) =>
    mount(OverviewHeadlineStrip, {
      props: {
        overview: buildOverview(),
        pending: false,
        failed: false,
        incidentsState: "ok",
        incidentsTotal: 6,
        ...props,
      } as Props,
      global: { plugins: [i18n, store] },
    });

  beforeEach(() => {
    zo = { ...store.state.zoConfig };
    flag = config.isEnterprise;
    config.isEnterprise = "true";
    store.commit("setConfig", { ...zo, ai_enabled: true, features: { ai_assistant: "enabled" } });
  });
  afterEach(() => {
    config.isEnterprise = flag;
    store.commit("setConfig", zo);
  });

  it("offers Ask AI on every tile in a problem state and not on a zero tile", () => {
    const w = mountAi();
    for (const key of ["failing", "incidents", "pipelines", "quiet"])
      expect(askBtn(w, key).exists(), key).toBe(true);
    expect(askBtn(w, "delivery").exists()).toBe(false);
  });

  it("keeps the button a sibling of the clickable tile, never inside it", () => {
    const w = mountAi();
    const btn = askBtn(w, "failing");
    expect(btn.element.closest('[data-test="overview-headline-failing"]')).toBeNull();
    expect(btn.element.closest('[data-test="overview-tile-card-failing"]')).not.toBeNull();
  });

  it("emits the count target without a level", async () => {
    const w = mountAi();
    await askBtn(w, "failing").trigger("click");
    await askBtn(w, "quiet").trigger("click");
    expect(w.emitted("askAi")).toEqual([
      [{ kind: "count", topic: "failing", count: 4 }],
      [{ kind: "count", topic: "quiet", count: 3 }],
    ]);
    expect(w.emitted("askAi")![0][0]).not.toHaveProperty("level");
    expect(askBtn(w, "failing").attributes("aria-label")).toBe("Ask AI about Failing rules");
    expect(w.emitted("select")).toBeUndefined();
  });

  it("is hidden when AI is disabled", () => {
    store.commit("setConfig", { ...zo, ai_enabled: false, features: {} });
    expect(askBtn(mountAi(), "failing").exists()).toBe(false);
  });

  it.each([
    ["loading", { pending: true }],
    ["failed", { failed: true }],
    ["forbidden", { forbidden: true }],
  ])("is hidden while the section is %s", (_name, props) => {
    const w = mountAi(props as Partial<Props>);
    for (const key of ["failing", "pipelines", "quiet"])
      expect(askBtn(w, key).exists(), key).toBe(false);
  });

  it.each(["locked", "loading", "error", "forbidden", "unavailable"] as const)(
    "hides the incidents button when incidents are %s",
    (state) => {
      expect(askBtn(mountAi({ incidentsState: state }), "incidents").exists()).toBe(false);
    },
  );
});
