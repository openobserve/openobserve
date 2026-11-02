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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import config from "@/aws-exports";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import OverviewAlertsCard from "./OverviewAlertsCard.vue";
import OverviewDataHealthCard from "./OverviewDataHealthCard.vue";
import OverviewDataSizeCard from "./OverviewDataSizeCard.vue";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import OverviewSignalCards from "./OverviewSignalCards.vue";
import { buildOverview } from "./overviewFixtures";
import type {
  OverviewAlertsData,
  OverviewLimitsData,
  OverviewSection,
  OverviewStreamsData,
} from "@/ts/interfaces/overview";

const global = { plugins: [i18n] };
const base = { pending: false, failed: false };
const o = buildOverview();
const NOW_MS = Math.floor(o.generated_at / 1000);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
});

afterEach(() => {
  vi.useRealTimers();
});

const okSection = <T>(data: T): OverviewSection<T> => ({ status: "ok", data });
const alertsWith = (over: Partial<OverviewAlertsData>) => okSection({ ...o.alerts.data!, ...over });
const streamsWith = (over: Partial<OverviewStreamsData>) =>
  okSection({ ...o.streams.data!, ...over });
const limitsWith = (over: Partial<OverviewLimitsData>) => okSection({ ...o.limits.data!, ...over });

const stateSections: Array<[string, OverviewSection<never>, string]> = [
  ["error", { status: "error", error: "secret internal failure" }, "error"],
  ["forbidden", { status: "forbidden", reason: "secret internal reason" }, "forbidden"],
  ["locked", { status: "locked", reason: "secret internal reason" }, "locked"],
];

describe("OverviewSectionCard", () => {
  it("draws every card on the outlined surface with one header height", () => {
    const w = mount(OverviewSectionCard, {
      props: { section: "x", title: raw("X"), view: "ok", linkLabel: raw("Open") },
      global,
    });
    expect(w.get('[data-test="overview-x-card"]').classes()).toEqual(
      expect.arrayContaining(["rounded-surface", "border"]),
    );
    expect(w.get("h2").classes()).toEqual(
      expect.arrayContaining(["text-sm", "font-medium", "text-text-heading"]),
    );
    expect(w.get("h2").element.parentElement?.classList.contains("min-h-8")).toBe(true);
  });

  it("centres the empty message and keeps the header action", () => {
    const w = mount(OverviewSectionCard, {
      props: { section: "x", title: raw("X"), view: "empty", linkLabel: raw("Add") },
      slots: { empty: '<p data-test="empty-slot">none</p>' },
      global,
    });
    const slot = w.get('[data-test="empty-slot"]').element.parentElement!;
    expect(slot.classList.contains("justify-center")).toBe(true);
    expect(slot.classList.contains("flex-1")).toBe(true);
    expect(w.get('[data-test="overview-x-view-all"]').text()).toBe("Add");
  });

  it("hides the header action while loading or failed", () => {
    for (const view of ["loading", "error"] as const) {
      const w = mount(OverviewSectionCard, {
        props: { section: "x", title: raw("X"), view, linkLabel: raw("Add") },
        global,
      });
      expect(w.find('[data-test="overview-x-view-all"]').exists()).toBe(false);
    }
  });

  it("falls back to a generic locked message when none is passed", async () => {
    const w = mount(OverviewSectionCard, {
      props: { section: "x", title: raw("X"), view: "locked" },
      global,
    });
    const locked = w.get('[data-test="overview-x-locked"]');
    expect(locked.text()).toBe("Available with an enterprise license");
    await locked.trigger("click");
    expect(w.emitted("unlock")).toHaveLength(1);
  });

  it("renders a plain notice, not a button, when unlock is not available", async () => {
    const w = mount(OverviewSectionCard, {
      props: { section: "x", title: raw("X"), view: "locked", canUnlock: false },
      global,
    });
    const locked = w.get('[data-test="overview-x-locked"]');
    expect(locked.element.tagName).not.toBe("BUTTON");
    expect(w.find("button").exists()).toBe(false);
    expect(locked.text()).toBe("Available with an enterprise license");
    await locked.trigger("click");
    expect(w.emitted("unlock")).toBeUndefined();
  });
});

describe("OverviewAlertsCard", () => {
  const mountAlerts = (props: Record<string, unknown> = {}) =>
    mount(OverviewAlertsCard, { props: { ...base, section: o.alerts, ...props }, global });
  const levelsWith = (critical: number, warning: number, other = 0) =>
    alertsWith({
      firing_by_level: { ok: other, warning, critical, no_data: 0, unclassified: 0 },
    });

  it("leads with the firing count and a plural label", () => {
    const w = mountAlerts();
    const count = w.get('[data-test="overview-alerts-hero-count"]');
    expect(count.text()).toBe("3");
    expect(count.classes()).toEqual(
      expect.arrayContaining(["text-3xl", "font-semibold", "tabular-nums", "text-text-heading"]),
    );
    expect(w.get('[data-test="overview-alerts-hero"]').text()).toBe("3alerts firing");
    const one = mountAlerts({ section: levelsWith(1, 0) });
    expect(one.get('[data-test="overview-alerts-hero"]').text()).toBe("1alert firing");
  });

  it("shows a muted zero, an empty severity track and no table when nothing is firing", () => {
    const w = mountAlerts({
      section: { ...levelsWith(0, 0), data: { ...levelsWith(0, 0).data!, firing: [] } },
    });
    const count = w.get('[data-test="overview-alerts-hero-count"]');
    expect(count.text()).toBe("0");
    expect(count.classes()).toContain("text-text-secondary");
    expect(w.get('[data-test="overview-alerts-hero"]').text()).toContain("alerts firing");
    expect(w.findAll('[data-test^="o-segmented-bar-segment-"]')).toHaveLength(0);
    expect(w.find('[data-test="overview-alerts-firing"]').exists()).toBe(false);
    expect(w.find('[data-test="overview-alerts-show-more"]').exists()).toBe(false);
  });

  it("splits the severity bar by level and states the counts in its name", () => {
    const w = mountAlerts({ section: levelsWith(2, 1, 1) });
    const bar = w.get('[data-test="overview-alerts-severity-bar"]');
    expect(bar.attributes("role")).toBe("img");
    expect(bar.attributes("aria-label")).toBe("Firing by severity: 2 critical, 1 warning, 1 other");
    const width = (id: string) =>
      bar.get(`[data-test="o-segmented-bar-segment-${id}"]`).attributes("style");
    expect(width("critical")).toContain("width: 50%");
    expect(width("warning")).toContain("width: 25%");
    expect(width("other")).toContain("width: 25%");
    expect(bar.get('[data-test="o-segmented-bar-segment-critical"]').classes()).toContain(
      "bg-status-negative",
    );
  });

  it("writes every level count under the bar and colours only the non-zero ones", () => {
    const w = mountAlerts();
    const level = (key: string) => w.get(`[data-test="overview-alerts-level-${key}"]`);
    expect(level("critical").text()).toBe("2 critical");
    expect(level("warning").text()).toBe("1 warning");
    expect(level("other").text()).toBe("0 other");
    expect(level("critical").get(".font-semibold").classes()).toContain("text-status-negative");
    expect(level("warning").get(".font-semibold").classes()).toContain("text-status-warning-text");
    expect(level("other").get(".font-semibold").classes()).toContain("text-text-heading");
  });

  it("counts rules firing at other levels", () => {
    const w = mountAlerts({
      section: alertsWith({
        firing_by_level: { ok: 1, warning: 1, critical: 2, no_data: 2, unclassified: 1 },
      }),
    });
    expect(w.get('[data-test="overview-alerts-level-other"]').text()).toBe("4 other");
    expect(w.get('[data-test="overview-alerts-hero-count"]').text()).toBe("7");
  });

  it("shows failing rules, and open incidents only where incidents data exists", () => {
    const w = mountAlerts();
    const failing = w.get('[data-test="overview-alerts-count-failing"]');
    expect(failing.text()).toBe("4 failing rules");
    expect(failing.get(".font-semibold").classes()).toContain("text-status-negative");
    expect(w.find('[data-test="overview-alerts-count-incidents"]').exists()).toBe(false);
    const withIncidents = mountAlerts({ incidentsState: "ok", incidentsTotal: 1 });
    expect(withIncidents.get('[data-test="overview-alerts-count-incidents"]').text()).toBe(
      "1 open incident",
    );
    const locked = mountAlerts({ incidentsState: "locked", incidentsTotal: 0 });
    expect(locked.find('[data-test="overview-alerts-count-incidents"]').exists()).toBe(false);
    const none = mountAlerts({
      section: alertsWith({ failed_evaluation: 0 }),
      incidentsState: "ok",
      incidentsTotal: 0,
    });
    expect(none.get('[data-test="overview-alerts-count-incidents"]').text()).toBe(
      "0 open incidents",
    );
    expect(
      none.get('[data-test="overview-alerts-count-failing"] .font-semibold').classes(),
    ).toContain("text-text-heading");
  });

  it("links each count to its headline tile's target", async () => {
    const w = mountAlerts({ incidentsState: "ok", incidentsTotal: 2 });
    for (const id of ["level-critical", "count-incidents", "count-failing"]) {
      await w.get(`[data-test="overview-alerts-${id}"]`).trigger("click");
    }
    expect(w.emitted("select")).toEqual([["firing"], ["incidents"], ["failing"]]);
  });

  it("puts column headers over the firing list", () => {
    const w = mountAlerts();
    const header = w.get('[data-test="overview-alerts-table-header"]');
    expect(header.findAll("span").map((x) => x.text())).toEqual([
      "Severity",
      "Alert",
      "Stream",
      "Firing for",
    ]);
    expect(header.classes()).toEqual(expect.arrayContaining(["text-text-label", "text-xs"]));
  });

  it("lists firing alerts in the given order with level text, stream and age", () => {
    const w = mountAlerts();
    const rows = w.findAll('[data-test^="overview-alerts-firing-"]:not([data-test*="level"])');
    expect(rows.map((r) => r.attributes("data-test"))).toEqual([
      "overview-alerts-firing-high_cpu",
      "overview-alerts-firing-slow_requests",
    ]);
    expect(rows[0].text()).toContain("Critical");
    expect(rows[0].text()).toContain("high_cpu");
    expect(rows[0].text()).toContain("cpu_usage");
    expect(rows[0].text()).toContain("1h 0m");
    expect(rows[1].text()).toContain("Warning");
    expect(rows[1].text()).toContain("16m");
  });

  it.each(["ok", "no_data", "unclassified"] as const)(
    "shows a neutral Firing tag for a firing rule whose level is %s",
    (level) => {
      const [first] = o.alerts.data!.firing;
      const w = mountAlerts({ section: alertsWith({ firing: [{ ...first, level }] }) });
      const tag = w.get(`[data-test="overview-alerts-firing-level-${first.name}"]`);
      expect(tag.text()).toBe("Firing");
      expect(tag.classes()).toContain("bg-badge-default-soft-bg");
    },
  );

  it("renders two same-named rules on one stream as separate rows", () => {
    const [first] = o.alerts.data!.firing;
    const w = mountAlerts({
      section: alertsWith({ firing: [first, { ...first, since: first.since + 1 }] }),
    });
    expect(w.findAll(`[data-test="overview-alerts-firing-${first.name}"]`)).toHaveLength(2);
  });

  it("shows no age for a firing rule whose since is unknown", () => {
    const [first, second] = o.alerts.data!.firing;
    const w = mountAlerts({ section: alertsWith({ firing: [{ ...first, since: 0 }, second] }) });
    const rows = w.findAll('[data-test^="overview-alerts-firing-"]:not([data-test*="level"])');
    expect(rows[0].text()).not.toMatch(/\d+[dhm]/);
    expect(rows[1].text()).toContain("16m");
  });

  it("gives the view-all link a distinct accessible name", () => {
    const w = mountAlerts();
    const link = w.get('[data-test="overview-alerts-view-all"]');
    expect(link.attributes("aria-label")).toBe("View all alerts");
    expect(link.text()).toBe("View all");
  });

  it("offers the remaining count when more rules fire than are listed", async () => {
    const w = mountAlerts();
    const more = w.get('[data-test="overview-alerts-show-more"]');
    expect(more.text()).toBe("Show 1 more firing alert");
    await more.trigger("click");
    expect(w.emitted("open")).toHaveLength(1);
  });

  it("pluralises the remaining count and hides the link when everything is listed", () => {
    const many = mountAlerts({ section: levelsWith(3, 4) });
    expect(many.get('[data-test="overview-alerts-show-more"]').text()).toBe(
      "Show 5 more firing alerts",
    );
    const all = mountAlerts({ section: levelsWith(1, 1) });
    expect(all.find('[data-test="overview-alerts-show-more"]').exists()).toBe(false);
  });

  it("titles the card alerts and incidents only where incidents exist", () => {
    const title = (props: Record<string, unknown>) => mountAlerts(props).get("h2").text();
    expect(title({ incidentsState: "ok", incidentsTotal: 0 })).toBe("Alerts and incidents");
    expect(title({ incidentsState: "error" })).toBe("Alerts and incidents");
    expect(title({ incidentsState: "locked" })).toBe("Alerts");
    expect(title({ incidentsState: "unavailable" })).toBe("Alerts");
    expect(title({})).toBe("Alerts");
  });

  it("shows a one-line empty state and puts Create an alert in the header", async () => {
    const w = mountAlerts({ section: alertsWith({ total: 0, enabled: 0, failed_evaluation: 0 }) });
    const empty = w.get('[data-test="overview-alerts-empty"]');
    expect(empty.text()).toContain("No alert rules yet");
    expect(empty.find(".o2-empty-state__inline-icon").exists()).toBe(false);
    expect(empty.find("svg").exists()).toBe(false);
    expect(w.find('[data-test="overview-alerts-hero"]').exists()).toBe(false);
    const action = w.get('[data-test="overview-alerts-view-all"]');
    expect(action.text()).toBe("Create an alert");
    expect(action.attributes("aria-label")).toBeUndefined();
    expect(empty.find("button").exists()).toBe(false);
    await action.trigger("click");
    expect(w.emitted("create")).toHaveLength(1);
    expect(w.emitted("open")).toBeUndefined();
  });

  it("opens the alert list from a firing row", async () => {
    const w = mountAlerts();
    await w.get('[data-test="overview-alerts-firing-high_cpu"]').trigger("click");
    expect(w.emitted("open")).toHaveLength(1);
  });

  it("shows a skeleton while loading", () => {
    const w = mount(OverviewAlertsCard, { props: { pending: true, failed: false }, global });
    expect(w.find('[data-test="overview-alerts-loading"]').exists()).toBe(true);
    expect(w.find('[data-test="overview-alerts-hero"]').exists()).toBe(false);
  });

  it("shows the load error and emits retry", async () => {
    const w = mount(OverviewAlertsCard, { props: { pending: false, failed: true }, global });
    expect(w.find('[data-test="overview-alerts-error"]').exists()).toBe(true);
    await w.get('[data-test="overview-alerts-retry-btn"]').trigger("click");
    expect(w.emitted("retry")).toHaveLength(1);
  });

  it.each(stateSections)("renders %s without the API text", (_n, section, suffix) => {
    const w = mount(OverviewAlertsCard, {
      props: { ...base, section: section as never },
      global,
    });
    expect(w.find(`[data-test="overview-alerts-${suffix}"]`).exists()).toBe(true);
    expect(w.text()).not.toContain("secret internal");
  });
});

const expandHealth = async (w: VueWrapper, group: "healthy" | "not-set-up") => {
  await w.get(`[data-test="overview-data-health-${group}"] button`).trigger("click");
  await flushPromises();
};

describe("forbidden copy", () => {
  it("asks for plain access when the whole request was refused", () => {
    const w = mount(OverviewAlertsCard, {
      props: { pending: false, failed: false, forbidden: true },
      global,
    });
    expect(w.get('[data-test="overview-alerts-forbidden"]').text()).toContain(
      "Ask an org admin for access.",
    );
  });

  it("asks for plain access when only one section was refused", () => {
    const w = mount(OverviewDataSizeCard, {
      props: { ...base, streams: { status: "forbidden" } as never, limits: o.limits },
      global,
    });
    const text = w.get('[data-test="overview-streams-forbidden"]').text();
    expect(text).toContain("Ask an org admin for access.");
    expect(text).not.toContain("Summary");
  });

  it("does not link to pipelines or open rows whose section is unavailable", async () => {
    const overview = buildOverview({ pipelines: { status: "forbidden" } });
    const w = mount(OverviewDataHealthCard, { props: { ...base, overview }, global });
    expect(w.find('[data-test="overview-data-health-view-all"]').exists()).toBe(false);
    const blocked = w.get('[data-test="overview-data-health-row-pipelines"]');
    expect(blocked.attributes("aria-disabled")).toBe("true");
    await blocked.trigger("click");
    expect(w.emitted("open")).toBeUndefined();
    const live = w.get('[data-test="overview-data-health-row-quiet"]');
    await live.trigger("click");
    expect(w.emitted("open")).toEqual([["streams"]]);
  });

  it("treats rules that are all disabled as not set up", async () => {
    const overview = buildOverview({
      alerts: okSection({ ...o.alerts.data!, total: 3, enabled: 0, disabled: 3 }),
    });
    const w = mount(OverviewDataHealthCard, { props: { ...base, overview }, global });
    await expandHealth(w, "not-set-up");
    expect(w.get('[data-test="overview-data-health-row-failing"]').text()).toContain("Not set up");
    const alerts = mount(OverviewAlertsCard, {
      props: { ...base, section: overview.alerts },
      global,
    });
    expect(alerts.find('[data-test="overview-alerts-empty"]').exists()).toBe(false);
  });
});

describe("forbidden request", () => {
  it.each([
    ["alerts", OverviewAlertsCard],
    ["data-health", OverviewDataHealthCard],
    ["streams", OverviewDataSizeCard],
  ])("shows %s as no access without Retry", (name, comp) => {
    const w = mount(comp as never, {
      props: { pending: false, failed: false, forbidden: true },
      global,
    });
    expect(w.find(`[data-test="overview-${name}-forbidden"]`).exists()).toBe(true);
    expect(w.find(`[data-test="overview-${name}-retry-btn"]`).exists()).toBe(false);
  });
});

describe("OverviewDataHealthCard", () => {
  const mountHealth = (overview = o, props: Record<string, unknown> = {}) =>
    mount(OverviewDataHealthCard, { props: { ...base, overview, ...props }, global });
  const row = (w: ReturnType<typeof mountHealth>, key: string) =>
    w.get(`[data-test="overview-data-health-row-${key}"]`);
  const expandAll = async (w: ReturnType<typeof mountHealth>) => {
    for (const group of ["healthy", "not-set-up"] as const) {
      if (w.find(`[data-test="overview-data-health-${group}"]`).exists()) {
        await expandHealth(w, group);
      }
    }
  };
  const allHealthy = () =>
    buildOverview({
      alerts: alertsWith({ failed_evaluation: 0, by_state: {} }),
      pipelines: okSection({ total: 3, enabled: 3, disabled: 0, errored: 0 }),
      streams: streamsWith({ quiet_count: 0, schema_changes_24h: 0, compaction_pending: 0 }),
    });

  it("leads with the number of checks that need attention", () => {
    const w = mountHealth();
    const count = w.get('[data-test="overview-data-health-attention-count"]');
    expect(count.text()).toBe("3");
    expect(count.classes()).toEqual(expect.arrayContaining(["text-3xl", "text-text-heading"]));
    expect(w.get('[data-test="overview-data-health-hero"]').text()).toBe("3checks need attention");
  });

  it("calls zero problems good news only when every source answered", () => {
    const healthy = mountHealth(allHealthy());
    const count = healthy.get('[data-test="overview-data-health-attention-count"]');
    expect(count.text()).toBe("0");
    expect(count.classes()).toContain("text-status-positive");
    expect(healthy.find('[data-test="overview-data-health-unknown"]').exists()).toBe(false);
    const partial = mountHealth(
      buildOverview({ ...allHealthy(), pipelines: { status: "error", error: "boom" } }),
    );
    const partialCount = partial.get('[data-test="overview-data-health-attention-count"]');
    expect(partialCount.classes()).toContain("text-text-secondary");
    expect(partialCount.classes()).not.toContain("text-status-positive");
    expect(partial.get('[data-test="overview-data-health-unknown"]').text()).toBe(
      "(1 could not load)",
    );
  });

  it("shows the problem rows with a status dot, real value and a text status", () => {
    const w = mountHealth();
    expect(row(w, "quiet").text()).toContain("Quiet streams");
    expect(row(w, "quiet").text()).toContain("Warning");
    expect(row(w, "quiet").get('[aria-hidden="true"]').classes()).toContain(
      "bg-status-warning-text",
    );
    expect(w.get('[data-test="overview-data-health-value-quiet"]').text()).toBe("3");
    expect(row(w, "failing").text()).toContain("Needs action");
    expect(w.get('[data-test="overview-data-health-value-failing"]').text()).toBe("4");
    expect(row(w, "pipelines").text()).toContain("of 8 enabled");
    expect(w.get('[data-test="overview-data-health-value-pipelines"]').text()).toBe("2");
    expect(row(w, "schema").text()).toContain("Info");
    expect(w.get('[data-test="overview-data-health-value-schema"]').text()).toBe("5");
  });

  it("collapses healthy rows into one closed line that names them", async () => {
    const w = mountHealth(allHealthy());
    const group = w.get('[data-test="overview-data-health-healthy"]');
    expect(group.get('[data-test="overview-data-health-healthy-summary"]').text()).toBe(
      "4 healthy: Quiet streams, Failing rules, Pipeline errors, Alert delivery failures",
    );
    const toggle = group.get("button");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(w.find('[data-test="overview-data-health-row-quiet"]').exists()).toBe(false);
    await expandHealth(w, "healthy");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(
      w.findAll('[data-test="overview-data-health-rows"] [data-test^="overview-data-health-row-"]'),
    ).toHaveLength(2);
    for (const key of ["quiet", "failing", "pipelines", "delivery"]) {
      expect(row(w, key).text()).toContain("Healthy");
      expect(w.get(`[data-test="overview-data-health-value-${key}"]`).text()).toBe("0");
    }
  });

  it("reads delivery failures from notify_failed", () => {
    const overview = buildOverview({
      alerts: alertsWith({ by_state: { firing: 1, notify_failed: 7 } }),
    });
    const w = mountHealth(overview);
    expect(w.get('[data-test="overview-data-health-value-delivery"]').text()).toBe("7");
    expect(row(w, "delivery").text()).toContain("Needs action");
  });

  it("collapses sources with nothing set up into their own line, never called healthy", async () => {
    const overview = buildOverview({
      alerts: alertsWith({ total: 0, enabled: 0, disabled: 0, failed_evaluation: 0, by_state: {} }),
      pipelines: okSection({ total: 0, enabled: 0, disabled: 0, errored: 0 }),
    });
    const w = mountHealth(overview);
    expect(w.find('[data-test="overview-data-health-healthy"]').exists()).toBe(false);
    expect(w.get('[data-test="overview-data-health-not-set-up-summary"]').text()).toBe(
      "3 not set up: Failing rules, Pipeline errors, Alert delivery failures",
    );
    await expandHealth(w, "not-set-up");
    for (const key of ["failing", "delivery", "pipelines"]) {
      const status = w.get(`[data-test="overview-data-health-status-${key}"]`);
      expect(status.text()).toBe("Not set up");
      expect(status.classes()).toContain("text-text-muted");
      expect(row(w, key).text()).not.toContain("Healthy");
      expect(row(w, key).text()).not.toContain("—");
      expect(w.find(`[data-test="overview-data-health-value-${key}"]`).exists()).toBe(false);
    }
  });

  it("shows quiet streams and schema changes as not set up when there are no streams", async () => {
    const w = mountHealth(buildOverview({ streams: streamsWith({ total_streams: 0 }) }));
    await expandHealth(w, "not-set-up");
    for (const key of ["quiet", "schema", "compaction"]) {
      expect(row(w, key).text()).toContain("Not set up");
      expect(row(w, key).text()).not.toContain("Healthy");
    }
  });

  it("notes when there are no pipelines", async () => {
    const overview = buildOverview({
      pipelines: okSection({ total: 0, enabled: 0, disabled: 0, errored: 0 }),
    });
    const w = mountHealth(overview);
    await expandHealth(w, "not-set-up");
    expect(row(w, "pipelines").text()).toContain("No pipelines yet");
  });

  it("keeps a row that could not load visible with its state, never a zero", () => {
    const overview = buildOverview({
      streams: { status: "error", error: "secret internal failure" },
      pipelines: { status: "forbidden", reason: "secret internal reason" },
      alerts: { status: "locked", reason: "secret internal reason" },
    });
    const w = mountHealth(overview);
    expect(row(w, "quiet").text()).toContain("Could not load");
    expect(row(w, "schema").text()).toContain("Could not load");
    expect(row(w, "pipelines").text()).toContain("No access");
    expect(row(w, "failing").text()).toContain("Locked");
    expect(row(w, "delivery").text()).toContain("Locked");
    for (const key of ["quiet", "schema", "compaction", "pipelines", "failing", "delivery"]) {
      expect(w.get(`[data-test="overview-data-health-value-${key}"]`).text()).toBe("—");
    }
    expect(w.find('[data-test="overview-data-health-healthy"]').exists()).toBe(false);
    expect(w.text()).not.toContain("secret internal");
  });

  it("links each row to its list page", async () => {
    const w = mountHealth();
    await expandAll(w);
    for (const key of ["quiet", "failing", "pipelines", "delivery", "schema", "compaction"]) {
      await row(w, key).trigger("click");
    }
    expect(w.emitted("open")).toEqual([
      ["streams"],
      ["alerts"],
      ["pipelines"],
      ["alerts"],
      ["streams"],
      ["streams"],
    ]);
  });

  const order = async (w: ReturnType<typeof mountHealth>) => {
    await expandAll(w);
    return w
      .findAll('[data-test^="overview-data-health-row-"]')
      .map((r) => r.attributes("data-test")?.replace("overview-data-health-row-", ""));
  };

  it("sorts rows by severity: needs action, warning, info, healthy, then not set up", async () => {
    expect(await order(mountHealth())).toEqual([
      "failing",
      "pipelines",
      "quiet",
      "schema",
      "compaction",
      "delivery",
    ]);
    const overview = buildOverview({
      alerts: alertsWith({ total: 0, enabled: 0, disabled: 0, failed_evaluation: 0, by_state: {} }),
      pipelines: okSection({ total: 3, enabled: 3, disabled: 0, errored: 0 }),
    });
    expect(await order(mountHealth(overview))).toEqual([
      "quiet",
      "schema",
      "compaction",
      "pipelines",
      "failing",
      "delivery",
    ]);
  });

  it("keeps the written order within one tier", async () => {
    const overview = buildOverview({
      alerts: alertsWith({ by_state: { notify_failed: 1 } }),
      streams: streamsWith({ quiet_count: 0 }),
    });
    expect((await order(mountHealth(overview))).slice(0, 3)).toEqual([
      "failing",
      "pipelines",
      "delivery",
    ]);
  });

  it("places a row that could not load above the healthy ones", async () => {
    const overview = buildOverview({
      alerts: alertsWith({ failed_evaluation: 0, by_state: {} }),
      pipelines: { status: "error", error: "boom" },
      streams: streamsWith({ quiet_count: 0, schema_changes_24h: 0, compaction_pending: 0 }),
    });
    expect(await order(mountHealth(overview))).toEqual([
      "schema",
      "compaction",
      "pipelines",
      "quiet",
      "failing",
      "delivery",
    ]);
  });

  it("shows pending compaction jobs as an info row", () => {
    const w = mountHealth();
    expect(row(w, "compaction").text()).toContain("Compaction jobs pending");
    expect(row(w, "compaction").text()).toContain("Across stream types you can see");
    expect(row(w, "compaction").text()).toContain("Info");
    expect(w.get('[data-test="overview-data-health-value-compaction"]').text()).toBe("12");
  });

  it("shows a dash for compaction when the count is unknown", () => {
    const w = mountHealth(buildOverview({ streams: streamsWith({ compaction_pending: null }) }));
    expect(w.get('[data-test="overview-data-health-value-compaction"]').text()).toBe("—");
  });

  it("shows a skeleton while loading, an error with retry, and no access", async () => {
    const loading = mountHealth(null as never, { pending: true });
    expect(loading.find('[data-test="overview-data-health-loading"]').exists()).toBe(true);
    const failed = mountHealth(null as never, { failed: true });
    expect(failed.find('[data-test="overview-data-health-error"]').exists()).toBe(true);
    await failed.get('[data-test="overview-data-health-retry-btn"]').trigger("click");
    expect(failed.emitted("retry")).toHaveLength(1);
  });
});

describe("OverviewSignalCards", () => {
  const mountSignals = (props: Record<string, unknown> = {}) =>
    mount(OverviewSignalCards, { props: { ...base, section: o.streams, ...props }, global });

  it("puts each muted caption above its semibold value", () => {
    const w = mountSignals();
    const stat = w.get('[data-test="overview-signal-logs-streams"]');
    expect(stat.classes()).toEqual(expect.arrayContaining(["font-semibold", "tabular-nums"]));
    const caption = stat.element.previousElementSibling!;
    expect(caption.textContent).toBe("Streams");
    expect(caption.classList.contains("text-text-label")).toBe(true);
  });

  it("shows count, events and stored size for each signal that has streams", () => {
    const w = mountSignals();
    const logs = w.get('[data-test="overview-signal-logs-card"]');
    expect(logs.text()).toContain("Logs");
    expect(w.get('[data-test="overview-signal-logs-streams"]').text()).toBe("4");
    expect(w.get('[data-test="overview-signal-logs-events"]').text()).toBe("1000");
    expect(w.get('[data-test="overview-signal-logs-stored"]').text()).toBe("1.50 GB");
    expect(logs.text()).toContain("Events");
    expect(w.get('[data-test="overview-signal-metrics-streams"]').text()).toBe("3");
    expect(w.get('[data-test="overview-signal-metrics-events"]').text()).toBe("50");
    expect(w.get('[data-test="overview-signal-metrics-card"]').text()).toContain("Samples");
  });

  it("hides a signal with no streams and shows no card for it", () => {
    const w = mountSignals();
    expect(w.find('[data-test="overview-signal-traces-card"]').exists()).toBe(false);
  });

  it("renders only the one signal that exists", () => {
    const only = streamsWith({ by_type: [o.streams.data!.by_type[0]] });
    const w = mountSignals({ section: only });
    expect(w.findAll('[data-test$="-card"]').map((c) => c.attributes("data-test"))).toEqual([
      "overview-signal-logs-card",
    ]);
  });

  it("compacts large event counts", () => {
    const byType = [{ ...o.streams.data!.by_type[0], doc_num: 2_900_000_000 }];
    const w = mountSignals({ section: streamsWith({ by_type: byType }) });
    expect(w.get('[data-test="overview-signal-logs-events"]').text()).toBe("2.9B");
  });

  it("gives each Open link a distinct accessible name that keeps the visible text", () => {
    const w = mountSignals();
    const names = ["logs", "metrics"].map((s) => {
      const link = w.get(`[data-test="overview-signal-${s}-view-all"]`);
      expect(link.text()).toBe("Open");
      return link.attributes("aria-label");
    });
    expect(names).toEqual(["Open logs", "Open metrics"]);
  });

  it("emits the signal from its Open link", async () => {
    const w = mountSignals();
    await w.get('[data-test="overview-signal-metrics-view-all"]').trigger("click");
    expect(w.emitted("open")).toEqual([["metrics"]]);
  });

  it("shows skeleton cards while loading and nothing misleading otherwise", () => {
    const loading = mount(OverviewSignalCards, { props: { pending: true, failed: false }, global });
    expect(loading.findAll('[data-test$="-loading"]')).toHaveLength(3);
    const failed = mount(OverviewSignalCards, { props: { pending: false, failed: true }, global });
    expect(failed.find('[data-test="overview-signal-cards"]').exists()).toBe(false);
    for (const section of [
      { status: "forbidden" },
      { status: "error" },
      { status: "locked" },
    ] as const) {
      const w = mountSignals({ section });
      expect(w.find('[data-test="overview-signal-cards"]').exists()).toBe(false);
    }
  });
});

describe("OverviewDataSizeCard", () => {
  const mountSize = (props: Record<string, unknown> = {}) =>
    mount(OverviewDataSizeCard, {
      props: { ...base, streams: o.streams, limits: o.limits, ...props },
      global,
    });
  const legendKeys = (w: ReturnType<typeof mountSize>) =>
    w
      .findAll('[data-test^="overview-streams-top-"]')
      .map((r) => r.attributes("data-test")!)
      .filter((id) => !/-(swatch|size)-/.test(id));

  it("is titled by stream, links to all streams and leads with the total across signals", () => {
    const w = mountSize();
    expect(w.get("h2").text()).toBe("Data size by stream");
    expect(w.get('[data-test="overview-streams-view-all"]').text()).toBe("All streams");
    const total = w.get('[data-test="overview-streams-total"]');
    expect(total.text()).toBe("2.00 GB");
    expect(total.classes()).toEqual(
      expect.arrayContaining(["text-3xl", "font-semibold", "tabular-nums"]),
    );
    expect(w.text()).toContain("across all streams");
  });

  it("lists the top streams largest first, then all other streams", () => {
    const w = mountSize();
    expect(legendKeys(w)).toEqual([
      "overview-streams-top-logs-app_logs",
      "overview-streams-top-metrics-cpu_usage",
      "overview-streams-top-logs-web_logs",
    ]);
    const size = (id: string) => w.get(`[data-test="overview-streams-top-size-${id}"]`).text();
    expect(size("logs-app_logs")).toBe("1.00 GB50%");
    expect(size("metrics-cpu_usage")).toContain("25%");
    expect(size("logs-web_logs")).toContain("20%");
    expect(w.get('[data-test="overview-streams-other"]').text()).toBe(
      "All other streams112.00 MB5%",
    );
  });

  it("shows under 1 percent, not 0, for a tiny share", () => {
    const byType = o.streams.data!.by_type.map((type) =>
      type.stream_type === "logs" ? { ...type, storage_size_mb: 100000 } : type,
    );
    const w = mountSize({ streams: streamsWith({ by_type: byType }) });
    expect(w.get('[data-test="overview-streams-top-size-metrics-cpu_usage"]').text()).toBe(
      "512.00 MB<1%",
    );
  });

  it("colours each stream by its signal, stepped by rank, and names the type", () => {
    const w = mountSize();
    const swatch = (id: string) =>
      w.get(`[data-test="overview-streams-top-swatch-${id}"]`).classes();
    expect(swatch("logs-app_logs")).toContain("bg-segment-blue-1");
    expect(swatch("logs-web_logs")).toEqual(expect.arrayContaining(["bg-segment-blue-2"]));
    expect(swatch("metrics-cpu_usage")).toContain("bg-segment-purple-1");
    const icon = w.get('[data-test="overview-streams-top-metrics-cpu_usage"] [role="img"]');
    expect(icon.attributes("aria-label")).toBe("Metrics");
  });

  it("draws one gapped bar with a titled segment per stream and a remainder", () => {
    const w = mountSize();
    const bar = w.get('[data-test="overview-streams-bar"]');
    expect(bar.attributes("role")).toBe("img");
    expect(bar.attributes("aria-label")).toBe(
      "Data size by stream: app_logs is the largest at 50%",
    );
    expect(bar.classes()).toContain("h-3");
    const segment = bar.get('[data-test="o-segmented-bar-segment-logs-app_logs"]');
    expect(segment.attributes("title")).toBe("app_logs: 1.00 GB, 50%");
    expect(segment.attributes("style")).toContain("width: 50%");
    const other = bar.get('[data-test="o-segmented-bar-segment-other"]');
    expect(other.attributes("title")).toBe("All other streams: 112.00 MB, 5%");
    expect(other.classes()).toContain("bg-text-secondary");
  });

  it("splits the total by signal on one line and leaves other stream types out", () => {
    const byType = [
      ...o.streams.data!.by_type,
      {
        stream_type: "enrichment_tables",
        count: 1,
        doc_num: 1,
        storage_size_mb: 100000,
        compressed_size_mb: 1,
        top: [{ name: "lookup", doc_num: 1, storage_size_mb: 100000 }],
      },
    ];
    const w = mountSize({ streams: streamsWith({ by_type: byType }) });
    const split = (signal: string) =>
      w.get(`[data-test="overview-streams-split-${signal}"]`).text();
    expect(split("logs")).toBe("Logs 75%");
    expect(split("metrics")).toBe("Metrics 25%");
    expect(split("traces")).toBe("Traces 0%");
    expect(w.get('[data-test="overview-streams-total"]').text()).toBe("2.00 GB");
    expect(w.find('[data-test^="overview-streams-top-enrichment_tables"]').exists()).toBe(false);
  });

  it("says no data yet, not NaN or a bar, when streams exist but hold nothing", () => {
    const w = mountSize({
      streams: streamsWith({
        by_type: o.streams.data!.by_type.map((type) => ({ ...type, storage_size_mb: 0 })),
      }),
    });
    expect(w.get('[data-test="overview-streams-no-data"]').text()).toBe("No data yet");
    expect(w.find('[data-test="overview-streams-bar"]').exists()).toBe(false);
    expect(w.text()).not.toContain("NaN");
  });

  it("emits open from a legend row", async () => {
    const w = mountSize();
    await w.get('[data-test="overview-streams-top-logs-app_logs"]').trigger("click");
    expect(w.emitted("open")).toHaveLength(1);
  });

  it("shows a one-line empty state and puts Start ingesting in the header for zero streams", async () => {
    const streams = streamsWith({ total_streams: 0, total_storage_size_mb: 0, by_type: [] });
    const w = mountSize({ streams });
    expect(w.get('[data-test="overview-streams-empty"]').text()).toContain("No streams yet");
    const action = w.get('[data-test="overview-streams-view-all"]');
    expect(action.text()).toBe("Start ingesting");
    await action.trigger("click");
    expect(w.emitted("startIngesting")).toHaveLength(1);
    expect(w.emitted("open")).toBeUndefined();
  });

  it.each(stateSections)("renders %s without the API text", (_n, section, suffix) => {
    const w = mountSize({ streams: section as never });
    expect(w.find(`[data-test="overview-streams-${suffix}"]`).exists()).toBe(true);
    expect(w.text()).not.toContain("secret internal");
  });

  it("shows one loading and one error state for the whole card, with no limit row", async () => {
    const loading = mount(OverviewDataSizeCard, {
      props: { pending: true, failed: false },
      global,
    });
    expect(loading.findAll('[data-test$="-loading"]')).toHaveLength(1);
    expect(loading.find('[data-test="overview-limit-row"]').exists()).toBe(false);
    const failed = mount(OverviewDataSizeCard, { props: { pending: false, failed: true }, global });
    expect(failed.findAll('[data-test$="-retry-btn"]')).toHaveLength(1);
    expect(failed.find('[role="separator"]').exists()).toBe(false);
    await failed.get('[data-test="overview-streams-retry-btn"]').trigger("click");
    expect(failed.emitted("retry")).toHaveLength(1);
  });
});

describe("OverviewDataSizeCard limit row", () => {
  const mountLimit = (limits: OverviewSection<OverviewLimitsData>, streams = o.streams) =>
    mount(OverviewDataSizeCard, { props: { ...base, limits, streams }, global });

  it("shows used of limit, the reset countdown, days over of allowed and license after a divider", () => {
    const w = mountLimit(o.limits);
    const html = w.html();
    expect(html.indexOf("overview-streams-body")).toBeLessThan(html.indexOf('role="separator"'));
    expect(html.indexOf('role="separator"')).toBeLessThan(html.indexOf("overview-limit-row"));
    const usage = w.get('[data-test="overview-limit-usage"]');
    expect(usage.get(".font-semibold").text()).toBe("85.50 GB");
    expect(usage.get(".text-text-secondary").text()).toBe("of 100.00 GB");
    expect(w.get('[data-test="overview-limit-resets"]').text()).toBe("1h 46m");
    const days = w.get('[data-test="overview-limit-days-over"]');
    expect(days.get(".font-semibold").text()).toBe("1");
    expect(days.get(".text-text-secondary").text()).toBe("of 3 allowed");
    expect(w.get('[data-test="overview-limit-license"]').text()).toBe("Valid");
  });

  it("draws field names as muted labels", () => {
    const w = mountLimit(o.limits);
    const labels = w
      .get('[data-test="overview-limit-row"]')
      .findAll(".text-text-label")
      .map((el) => el.text());
    expect(labels).toEqual([
      "Ingested today (UTC), whole deployment",
      "Resets in",
      "Days over the limit this month",
      "License",
    ]);
  });

  it("draws the usage as a progress bar coloured by the same thresholds", () => {
    const bar = (percent: number) =>
      mountLimit(limitsWith({ ingestion_used_percent: percent })).get(
        '[data-test="overview-limit-bar"]',
      );
    expect(bar(50).attributes("role")).toBe("progressbar");
    expect(bar(50).attributes("aria-valuenow")).toBe("50");
    expect(bar(50).find(".bg-progress-bar-default").exists()).toBe(true);
    expect(bar(80).find(".bg-progress-bar-warning").exists()).toBe(true);
    expect(bar(100).find(".bg-progress-bar-danger").exists()).toBe(true);
  });

  it("says of unlimited without a bar or a badge when the daily limit is unlimited", () => {
    const w = mountLimit(limitsWith({ limit_today_gb: null, ingestion_used_percent: 90 }));
    expect(w.get('[data-test="overview-limit-usage"]').text()).toBe("85.50 GBof unlimited");
    expect(w.find('[data-test="overview-limit-bar"]').exists()).toBe(false);
    expect(w.find('[data-test="overview-limit-status"]').exists()).toBe(false);
  });

  it("falls back to the percent when today's usage is unknown", () => {
    const w = mountLimit(limitsWith({ used_today_gb: null }));
    expect(w.get('[data-test="overview-limit-usage"]').text()).toBe("85.5%");
  });

  it("shows only the day count when the allowed days are unknown", () => {
    const w = mountLimit(limitsWith({ allowed_days: null, days_over_limit: 2 }));
    expect(w.get('[data-test="overview-limit-days-over"]').text()).toBe("2");
  });

  it("counts down to zero minutes when the reset time already passed", () => {
    const w = mountLimit(limitsWith({ resets_at: o.generated_at - 5_000_000 }));
    expect(w.get('[data-test="overview-limit-resets"]').text()).toBe("0m");
  });

  it.each([
    [74.9, null, null],
    [75, "Approaching limit", "warning"],
    [99.9, "Approaching limit", "warning"],
    [100, "Over limit", "error"],
  ])("labels %s percent in text, not colour only", (percent, label, tone) => {
    const w = mountLimit(limitsWith({ ingestion_used_percent: percent }));
    const tag = w.find('[data-test="overview-limit-status"]');
    if (!label) {
      expect(tag.exists()).toBe(false);
      return;
    }
    expect(tag.text()).toBe(label);
    expect(tag.classes()).toContain(`bg-badge-${tone}-soft-bg`);
  });

  it.each([
    [0, 3, "text-text-heading"],
    [3, 3, "text-status-warning-text"],
    [4, 3, "text-status-negative"],
  ])("tones %s days over of %s allowed with %s", (days, allowed, tone) => {
    const w = mountLimit(limitsWith({ days_over_limit: days, allowed_days: allowed }));
    expect(w.get('[data-test="overview-limit-days-over"] .font-semibold').classes()).toContain(
      tone,
    );
  });

  it("flags an expired license", () => {
    const w = mountLimit(limitsWith({ expired: true }));
    const license = w.get('[data-test="overview-limit-license"]');
    expect(license.text()).toBe("Expired");
    expect(license.classes()).toContain("bg-badge-error-soft-bg");
  });

  it("leaves the row out, with nothing in its place, when the limit is locked", () => {
    const w = mountLimit({ status: "locked", reason: "secret internal reason" });
    expect(w.find('[data-test="overview-limit-row"]').exists()).toBe(false);
    expect(w.find('[data-test="overview-limit-unavailable"]').exists()).toBe(false);
    expect(w.find('[data-test="overview-limit-locked"]').exists()).toBe(false);
    expect(w.find('[role="separator"]').exists()).toBe(false);
    expect(w.text()).not.toContain("secret internal");
  });

  it.each(stateSections.filter(([n]) => n !== "locked"))(
    "says the limit is unavailable on %s and keeps the data size",
    (_n, section) => {
      const w = mountLimit(section as never);
      expect(w.get('[data-test="overview-limit-unavailable"]').text()).toBe(
        "Ingest limit unavailable",
      );
      expect(w.find('[data-test="overview-limit-row"]').exists()).toBe(false);
      expect(w.find('[data-test="overview-streams-bar"]').exists()).toBe(true);
      expect(w.text()).not.toContain("secret internal");
    },
  );

  it("keeps the limit row when only the streams section failed", () => {
    const w = mountLimit(o.limits, { status: "error", error: "boom" } as never);
    expect(w.find('[data-test="overview-streams-error"]').exists()).toBe(true);
    expect(w.find('[data-test="overview-limit-row"]').exists()).toBe(true);
  });

  it("shows no limit row on cloud", () => {
    const original = config.isCloud;
    config.isCloud = "true";
    try {
      const w = mountLimit(o.limits);
      expect(w.find('[data-test="overview-limit-row"]').exists()).toBe(false);
      expect(w.find('[role="separator"]').exists()).toBe(false);
      expect(w.get('[data-test="overview-streams-total"]').text()).toBe("2.00 GB");
    } finally {
      config.isCloud = original;
    }
  });
});
