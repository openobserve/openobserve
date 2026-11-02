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
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import OverviewAlertsCard from "./OverviewAlertsCard.vue";
import OverviewDataHealthCard from "./OverviewDataHealthCard.vue";
import OverviewLimitCard from "./OverviewLimitCard.vue";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import OverviewSignalCards from "./OverviewSignalCards.vue";
import OverviewStreamsCard from "./OverviewStreamsCard.vue";
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

  it("shows the level counts and failing rules from real data", () => {
    const w = mountAlerts();
    expect(w.get('[data-test="overview-alerts-tile-critical"]').text()).toContain("2");
    expect(w.get('[data-test="overview-alerts-tile-warning"]').text()).toContain("1");
    expect(w.get('[data-test="overview-alerts-tile-failing"]').text()).toContain("4");
    expect(w.get('[data-test="overview-alerts-tile-critical"]').text()).toContain(
      "Firing at critical",
    );
  });

  it("omits the incidents tile unless incidents data exists", () => {
    expect(mountAlerts().find('[data-test="overview-alerts-tile-incidents"]').exists()).toBe(false);
    const w = mountAlerts({ incidentsState: "ok", incidentsTotal: 6 });
    expect(w.get('[data-test="overview-alerts-tile-incidents"]').text()).toContain("6");
    const locked = mountAlerts({ incidentsState: "locked", incidentsTotal: 0 });
    expect(locked.find('[data-test="overview-alerts-tile-incidents"]').exists()).toBe(false);
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

  it("shows a neutral Firing tag for a firing rule whose level is ok", () => {
    const [first] = o.alerts.data!.firing;
    const w = mountAlerts({ section: alertsWith({ firing: [{ ...first, level: "ok" }] }) });
    const tag = w.get(`[data-test="overview-alerts-firing-level-${first.name}"]`);
    expect(tag.text()).toBe("Firing");
    expect(tag.text()).not.toContain("Normal");
  });

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
    const many = mountAlerts({
      section: alertsWith({
        firing_by_level: { ok: 0, warning: 4, critical: 3, no_data: 0, unclassified: 0 },
      }),
    });
    expect(many.get('[data-test="overview-alerts-show-more"]').text()).toBe(
      "Show 5 more firing alerts",
    );
    const all = mountAlerts({
      section: alertsWith({
        firing_by_level: { ok: 0, warning: 1, critical: 1, no_data: 0, unclassified: 0 },
      }),
    });
    expect(all.find('[data-test="overview-alerts-show-more"]').exists()).toBe(false);
  });

  it("says all clear when nothing is firing", () => {
    const w = mountAlerts({
      section: alertsWith({
        firing: [],
        firing_by_level: { ok: 0, warning: 0, critical: 0, no_data: 0, unclassified: 0 },
      }),
    });
    expect(w.get('[data-test="overview-alerts-all-clear"]').text()).toBe(
      "No alerts are firing right now.",
    );
    expect(w.find('[data-test="overview-alerts-show-more"]').exists()).toBe(false);
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
    expect(w.find('[data-test="overview-alerts-tiles"]').exists()).toBe(false);
    const action = w.get('[data-test="overview-alerts-view-all"]');
    expect(action.text()).toBe("Create an alert");
    expect(action.attributes("aria-label")).toBeUndefined();
    expect(empty.find("button").exists()).toBe(false);
    await action.trigger("click");
    expect(w.emitted("create")).toHaveLength(1);
    expect(w.emitted("open")).toBeUndefined();
  });

  it("shows a firing-at-other-levels tile only when rules fire at unlisted levels", () => {
    expect(mountAlerts().find('[data-test="overview-alerts-tile-other"]').exists()).toBe(false);
    const w = mountAlerts({
      section: alertsWith({
        firing_by_level: { ok: 1, warning: 1, critical: 2, no_data: 2, unclassified: 1 },
      }),
    });
    const tile = w.get('[data-test="overview-alerts-tile-other"]');
    expect(tile.text()).toContain("4");
    expect(tile.text()).toContain("Firing at other levels");
  });

  it("opens the alert list from a firing row", async () => {
    const w = mountAlerts();
    await w.get('[data-test="overview-alerts-firing-high_cpu"]').trigger("click");
    expect(w.emitted("open")).toHaveLength(1);
  });

  it("shows a skeleton while loading", () => {
    const w = mount(OverviewAlertsCard, { props: { pending: true, failed: false }, global });
    expect(w.find('[data-test="overview-alerts-loading"]').exists()).toBe(true);
    expect(w.find('[data-test="overview-alerts-tiles"]').exists()).toBe(false);
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
    const w = mount(OverviewStreamsCard, {
      props: { ...base, section: { status: "forbidden" } as never },
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

  it("treats rules that are all disabled as not set up", () => {
    const overview = buildOverview({
      alerts: okSection({ ...o.alerts.data!, total: 3, enabled: 0, disabled: 3 }),
    });
    const w = mount(OverviewDataHealthCard, { props: { ...base, overview }, global });
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
    ["streams", OverviewStreamsCard],
    ["limit", OverviewLimitCard],
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

  it("shows every row with its real value and a text status", () => {
    const w = mountHealth();
    expect(row(w, "quiet").text()).toContain("Quiet streams");
    expect(row(w, "quiet").text()).toContain("Warning");
    expect(w.get('[data-test="overview-data-health-value-quiet"]').text()).toBe("3");
    expect(row(w, "failing").text()).toContain("Needs action");
    expect(w.get('[data-test="overview-data-health-value-failing"]').text()).toBe("4");
    expect(row(w, "pipelines").text()).toContain("of 8 enabled");
    expect(w.get('[data-test="overview-data-health-value-pipelines"]').text()).toBe("2");
    expect(row(w, "schema").text()).toContain("Info");
    expect(w.get('[data-test="overview-data-health-value-schema"]').text()).toBe("5");
  });

  it("reads delivery failures from notify_failed", () => {
    const overview = buildOverview({
      alerts: alertsWith({ by_state: { firing: 1, notify_failed: 7 } }),
    });
    const w = mountHealth(overview);
    expect(w.get('[data-test="overview-data-health-value-delivery"]').text()).toBe("7");
    expect(row(w, "delivery").text()).toContain("Needs action");
  });

  it("calls zero problems healthy, in words", () => {
    const overview = buildOverview({
      alerts: alertsWith({ failed_evaluation: 0, by_state: {} }),
      pipelines: okSection({ total: 3, enabled: 3, disabled: 0, errored: 0 }),
      streams: streamsWith({ quiet_count: 0, schema_changes_24h: 0 }),
    });
    const w = mountHealth(overview);
    for (const key of ["quiet", "failing", "pipelines", "delivery"]) {
      expect(row(w, key).text()).toContain("Healthy");
      expect(w.get(`[data-test="overview-data-health-value-${key}"]`).text()).toBe("0");
    }
  });

  it("shows not set up, not healthy, for things that do not exist", () => {
    const overview = buildOverview({
      alerts: alertsWith({ total: 0, enabled: 0, disabled: 0, failed_evaluation: 0, by_state: {} }),
      pipelines: okSection({ total: 0, enabled: 0, disabled: 0, errored: 0 }),
    });
    const w = mountHealth(overview);
    for (const key of ["failing", "delivery", "pipelines"]) {
      const status = w.get(`[data-test="overview-data-health-status-${key}"]`);
      expect(status.text()).toBe("Not set up");
      expect(status.classes()).toContain("text-text-muted");
      expect(row(w, key).text()).not.toContain("Healthy");
      expect(row(w, key).text()).not.toContain("—");
      expect(w.find(`[data-test="overview-data-health-value-${key}"]`).exists()).toBe(false);
    }
  });

  it("shows quiet streams and schema changes as not set up when there are no streams", () => {
    const w = mountHealth(buildOverview({ streams: streamsWith({ total_streams: 0 }) }));
    for (const key of ["quiet", "schema", "compaction"]) {
      expect(row(w, key).text()).toContain("Not set up");
      expect(row(w, key).text()).not.toContain("Healthy");
    }
  });

  it("notes when there are no pipelines", () => {
    const overview = buildOverview({
      pipelines: okSection({ total: 0, enabled: 0, disabled: 0, errored: 0 }),
    });
    expect(row(mountHealth(overview), "pipelines").text()).toContain("No pipelines yet");
  });

  it("shows the state, never a zero, for a row whose section is unavailable", () => {
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
    expect(w.text()).not.toContain("secret internal");
  });

  it("links each row to its list page", async () => {
    const w = mountHealth();
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

  const order = (w: ReturnType<typeof mountHealth>) =>
    w
      .findAll('[data-test^="overview-data-health-row-"]')
      .map((r) => r.attributes("data-test")?.replace("overview-data-health-row-", ""));

  it("sorts rows by severity: needs action, warning, info, healthy, then not set up", () => {
    expect(order(mountHealth())).toEqual([
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
    expect(order(mountHealth(overview))).toEqual([
      "quiet",
      "schema",
      "compaction",
      "pipelines",
      "failing",
      "delivery",
    ]);
  });

  it("keeps the written order within one tier", () => {
    const overview = buildOverview({
      alerts: alertsWith({ by_state: { notify_failed: 1 } }),
      streams: streamsWith({ quiet_count: 0 }),
    });
    expect(order(mountHealth(overview)).slice(0, 3)).toEqual(["failing", "pipelines", "delivery"]);
  });

  it("places a row that could not load above the healthy ones", () => {
    const overview = buildOverview({
      alerts: alertsWith({ failed_evaluation: 0, by_state: {} }),
      pipelines: { status: "error", error: "boom" },
      streams: streamsWith({ quiet_count: 0, schema_changes_24h: 0, compaction_pending: 0 }),
    });
    expect(order(mountHealth(overview))).toEqual([
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

describe("OverviewStreamsCard", () => {
  it("is titled by data size, links to all streams and lists no per-type summary", () => {
    const w = mount(OverviewStreamsCard, { props: { ...base, section: o.streams }, global });
    expect(w.get("h2").text()).toBe("Top streams by data size");
    expect(w.get('[data-test="overview-streams-view-all"]').text()).toBe("All streams");
    expect(w.find('[data-test="overview-streams-types"]').exists()).toBe(false);
    expect(w.find('[data-test^="overview-streams-type-"]').exists()).toBe(false);
    expect(w.find('[data-test="overview-streams-compaction"]').exists()).toBe(false);
    expect(w.text()).not.toContain("compaction");
  });

  it("tags each top stream with its type so same-named streams differ", () => {
    const w = mount(OverviewStreamsCard, { props: { ...base, section: o.streams }, global });
    expect(w.get('[data-test="overview-streams-top-logs-app_logs"]').text()).toContain("Logs");
    expect(w.get('[data-test="overview-streams-top-metrics-cpu_usage"]').text()).toContain(
      "Metrics",
    );
  });

  it("lists top streams largest first", () => {
    const w = mount(OverviewStreamsCard, { props: { ...base, section: o.streams }, global });
    const rows = w.findAll(
      '[data-test^="overview-streams-top-"]:not([data-test*="swatch"]):not([data-test*="size"])',
    );
    expect(rows.map((r) => r.attributes("data-test"))).toEqual([
      "overview-streams-top-logs-app_logs",
      "overview-streams-top-metrics-cpu_usage",
      "overview-streams-top-logs-web_logs",
    ]);
    expect(rows[0].text()).toContain("1.00 GB");
  });

  it("shows each top stream's share of the total stored size", () => {
    const w = mount(OverviewStreamsCard, { props: { ...base, section: o.streams }, global });
    const size = (id: string) => w.get(`[data-test="overview-streams-top-size-${id}"]`).text();
    expect(size("logs-app_logs")).toContain("50% of total");
    expect(size("metrics-cpu_usage")).toContain("25% of total");
    expect(size("logs-web_logs")).toContain("20% of total");
  });

  it("shows a share of 0 percent, not NaN, when the total is zero", () => {
    const w = mount(OverviewStreamsCard, {
      props: { ...base, section: streamsWith({ total_storage_size_mb: 0 }) },
      global,
    });
    expect(w.text()).toContain("0% of total");
    expect(w.text()).not.toContain("NaN");
  });

  it("shows under 1 percent, not 0, for a tiny share of the total", () => {
    const w = mount(OverviewStreamsCard, {
      props: { ...base, section: streamsWith({ total_storage_size_mb: 100000 }) },
      global,
    });
    const size = w.get('[data-test="overview-streams-top-size-logs-web_logs"]').text();
    expect(size).toContain("<1% of total");
    expect(size).not.toContain("0% of total");
  });

  it("gives each signal its own colour swatch", () => {
    const w = mount(OverviewStreamsCard, { props: { ...base, section: o.streams }, global });
    const cls = (id: string) =>
      w.get(`[data-test="overview-streams-top-swatch-${id}"]`).classes().join(" ");
    expect(cls("logs-app_logs")).toBe(cls("logs-web_logs"));
    expect(cls("logs-app_logs")).not.toBe(cls("metrics-cpu_usage"));
    expect(cls("logs-app_logs")).toContain("bg-accent");
  });

  it("labels each top stream bar with the stream name", () => {
    const w = mount(OverviewStreamsCard, { props: { ...base, section: o.streams }, global });
    const bar = w.get('[data-test="overview-streams-top-logs-app_logs"] [role="progressbar"]');
    expect(bar.attributes("aria-label")).toBe("app_logs");
  });

  it("sizes each top stream bar by its share of total storage", () => {
    const w = mount(OverviewStreamsCard, { props: { ...base, section: o.streams }, global });
    const bar = (id: string) =>
      w.get(`[data-test="overview-streams-top-${id}"] [role="progressbar"]`);
    expect(bar("logs-app_logs").attributes("aria-valuenow")).toBe("50");
    expect(w.get('[data-test="overview-streams-top-size-logs-app_logs"]').text()).toContain(
      "50% of total",
    );
    const empty = mount(OverviewStreamsCard, {
      props: { ...base, section: streamsWith({ total_storage_size_mb: 0 }) },
      global,
    });
    expect(
      empty
        .get('[data-test="overview-streams-top-logs-app_logs"] [role="progressbar"]')
        .attributes("aria-valuenow"),
    ).toBe("0");
  });

  it("emits open from a top stream row", async () => {
    const w = mount(OverviewStreamsCard, { props: { ...base, section: o.streams }, global });
    await w.get('[data-test="overview-streams-top-logs-app_logs"]').trigger("click");
    expect(w.emitted("open")).toHaveLength(1);
  });

  it("shows a one-line empty state and puts Start ingesting in the header for zero streams", async () => {
    const section = streamsWith({ total_streams: 0, total_storage_size_mb: 0, by_type: [] });
    const w = mount(OverviewStreamsCard, { props: { ...base, section }, global });
    expect(w.get('[data-test="overview-streams-empty"]').text()).toContain("No streams yet");
    const action = w.get('[data-test="overview-streams-view-all"]');
    expect(action.text()).toBe("Start ingesting");
    await action.trigger("click");
    expect(w.emitted("startIngesting")).toHaveLength(1);
    expect(w.emitted("open")).toBeUndefined();
  });

  it.each(stateSections)("renders %s without the API text", (_n, section, suffix) => {
    const w = mount(OverviewStreamsCard, {
      props: { ...base, section: section as never },
      global,
    });
    expect(w.find(`[data-test="overview-streams-${suffix}"]`).exists()).toBe(true);
    expect(w.text()).not.toContain("secret internal");
  });

  it("shows a skeleton while loading", () => {
    const w = mount(OverviewStreamsCard, { props: { pending: true, failed: false }, global });
    expect(w.find('[data-test="overview-streams-loading"]').exists()).toBe(true);
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

describe("OverviewLimitCard data size", () => {
  const mountStorage = (props: Record<string, unknown> = {}) =>
    mount(OverviewLimitCard, {
      props: { ...base, limits: o.limits, streams: o.streams, ...props },
      global,
    });

  it("shows the limit, a divider, then the total and the per-signal split with text labels", () => {
    const w = mountStorage();
    expect(w.get("h2").text()).toBe("Ingest limit and data size");
    const html = w.html();
    expect(html.indexOf("overview-limit-body")).toBeLessThan(html.indexOf('role="separator"'));
    expect(html.indexOf('role="separator"')).toBeLessThan(html.indexOf("overview-storage-body"));
    expect(w.get('[data-test="overview-storage-total"]').text()).toBe("2.00 GB");
    expect(w.get('[data-test="overview-storage-legend-logs"]').text()).toBe("Logs75%");
    expect(w.get('[data-test="overview-storage-legend-metrics"]').text()).toBe("Metrics25%");
    expect(w.get('[data-test="overview-storage-legend-traces"]').text()).toBe("Traces0%");
  });

  it("leaves enrichment streams out of the split", () => {
    const byType = [
      ...o.streams.data!.by_type,
      {
        stream_type: "enrichment_tables",
        count: 1,
        doc_num: 1,
        storage_size_mb: 100000,
        compressed_size_mb: 1,
        top: [],
      },
    ];
    const w = mountStorage({ streams: streamsWith({ by_type: byType }) });
    expect(w.get('[data-test="overview-storage-legend-logs"]').text()).toBe("Logs75%");
  });

  it("shows the empty state, not zero percentages, with nothing stored", () => {
    const w = mountStorage({ streams: streamsWith({ total_storage_size_mb: 0, by_type: [] }) });
    expect(w.get('[data-test="overview-storage-empty"]').text()).toContain("No data yet");
    expect(w.find('[data-test="overview-storage-bar"]').exists()).toBe(false);
    expect(w.find('[data-test="overview-limit-body"]').exists()).toBe(true);
  });

  it("keeps each part's state to itself when only one section failed", async () => {
    const w = mountStorage({ streams: { status: "error", error: "secret internal failure" } });
    expect(w.find('[data-test="overview-limit-body"]').exists()).toBe(true);
    await w.get('[data-test="overview-storage-retry-btn"]').trigger("click");
    expect(w.emitted("retry")).toHaveLength(1);
    const forbidden = mountStorage({ streams: { status: "forbidden" } });
    expect(forbidden.find('[data-test="overview-storage-forbidden"]').exists()).toBe(true);
    expect(w.text()).not.toContain("secret internal");
  });

  it("shows one loading and one error state for the whole card", async () => {
    const loading = mount(OverviewLimitCard, { props: { pending: true, failed: false }, global });
    expect(loading.findAll('[data-test$="-loading"]')).toHaveLength(1);
    const failed = mount(OverviewLimitCard, { props: { pending: false, failed: true }, global });
    expect(failed.findAll('[data-test$="-retry-btn"]')).toHaveLength(1);
    await failed.get('[data-test="overview-limit-retry-btn"]').trigger("click");
    expect(failed.emitted("retry")).toHaveLength(1);
  });

  it("shows the data size alone, titled data size, on cloud", () => {
    const original = config.isCloud;
    config.isCloud = "true";
    try {
      const w = mountStorage();
      expect(w.find('[data-test="overview-storage-card"]').exists()).toBe(true);
      expect(w.find('[data-test="overview-limit-card"]').exists()).toBe(false);
      expect(w.get("h2").text()).toBe("Data size");
      expect(w.find('[data-test="overview-limit-body"]').exists()).toBe(false);
      expect(w.find('[role="separator"]').exists()).toBe(false);
      expect(w.get('[data-test="overview-storage-total"]').text()).toBe("2.00 GB");
    } finally {
      config.isCloud = original;
    }
  });
});

describe("OverviewLimitCard", () => {
  const mountLimit = (limits: OverviewSection<OverviewLimitsData>) =>
    mount(OverviewLimitCard, { props: { ...base, limits, streams: o.streams }, global });

  it("shows used of limit, the reset countdown, days over of allowed and license", () => {
    const w = mountLimit(o.limits);
    const usage = w.get('[data-test="overview-limit-usage"]');
    expect(usage.get(".font-semibold").text()).toBe("85.50 GB");
    expect(usage.get(".text-text-secondary").text()).toBe("of 100.00 GB");
    expect(w.get('[data-test="overview-limit-resets"]').text()).toBe(
      "Resets at 00:00 UTC, in 1h 46m",
    );
    expect(w.get('[data-test="overview-limit-days-over"]').text()).toBe("1 of 3 allowed");
    expect(w.get('[data-test="overview-limit-license"]').text()).toBe("Valid");
    expect(w.get('[data-test="overview-limit-bar"]').exists()).toBe(true);
    expect(w.get('[data-test="overview-limit-scope"]').text()).toBe(
      "Across the whole deployment, not just this organization.",
    );
  });

  it("draws field names as muted labels and values as semibold numbers", () => {
    const w = mountLimit(o.limits);
    const labels = w.findAll(".text-text-label").map((el) => el.text());
    expect(labels).toEqual(
      expect.arrayContaining([
        "Ingested today (UTC)",
        "Days over the limit this month",
        "License",
        "Data size",
      ]),
    );
    expect(w.get('[data-test="overview-storage-total"]').classes()).toEqual(
      expect.arrayContaining(["text-text-heading", "font-semibold", "tabular-nums"]),
    );
  });

  it("shows usage and no-limit copy without a bar when the daily limit is unlimited", () => {
    const w = mountLimit(limitsWith({ limit_today_gb: null, ingestion_used_percent: 0 }));
    expect(w.get('[data-test="overview-limit-usage"]').text()).toBe("85.50 GB");
    expect(w.get('[data-test="overview-limit-no-limit"]').text()).toBe("No daily limit");
    expect(w.find('[data-test="overview-limit-bar"]').exists()).toBe(false);
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
    expect(w.get('[data-test="overview-limit-resets"]').text()).toBe("Resets at 00:00 UTC, in 0m");
  });

  it.each([
    [70, null],
    [70.1, "Approaching limit"],
    [90, "Approaching limit"],
    [90.1, "Near limit"],
    [100, "Over limit"],
  ])("labels %s percent in text, not colour only", (percent, label) => {
    const w = mountLimit(limitsWith({ ingestion_used_percent: percent }));
    const tag = w.find('[data-test="overview-limit-status"]');
    if (label) expect(tag.text()).toBe(label);
    else expect(tag.exists()).toBe(false);
  });

  it("labels the window and says search is blocked past the allowed days", () => {
    const w = mountLimit(o.limits);
    expect(w.text()).toContain("Ingested today (UTC)");
    expect(w.text()).toContain("Days over the limit this month");
    expect(w.get('[data-test="overview-limit-block-note"]').text()).toContain("Search is blocked");
  });

  it.each([
    [0, 3, "neutral"],
    [3, 3, "warning"],
    [4, 3, "error"],
  ])("tones %s days over of %s allowed as %s", (days, allowed, tone) => {
    const w = mountLimit(limitsWith({ days_over_limit: days, allowed_days: allowed }));
    const chip = w.get('[data-test="overview-limit-days-over"]');
    expect(chip.classes()).toContain(`bg-badge-${tone === "neutral" ? "default" : tone}-soft-bg`);
  });

  it("flags an expired license", () => {
    const w = mountLimit(
      limitsWith({ ingestion_used_percent: 120, expired: true, days_over_limit: 5 }),
    );
    expect(w.get('[data-test="overview-limit-license"]').text()).toBe("Expired");
    expect(w.get('[data-test="overview-limit-days-over"]').text()).toBe("5 of 3 allowed");
    expect(w.get('[data-test="overview-limit-block-note"]').exists()).toBe(true);
  });

  it("shows the locked affordance with our own copy and emits unlock", async () => {
    const w = mountLimit({ status: "locked", reason: "secret internal reason" });
    const locked = w.get('[data-test="overview-limit-locked"]');
    expect(locked.element.tagName).toBe("BUTTON");
    expect(locked.text()).toBe(
      "Track ingestion against your license limit with an enterprise license.",
    );
    expect(w.text()).not.toContain("secret internal");
    await locked.trigger("click");
    expect(w.emitted("unlock")).toHaveLength(1);
  });

  it.each(stateSections.filter(([n]) => n !== "locked"))(
    "renders %s without the API text",
    (_n, section, suffix) => {
      const w = mountLimit(section as never);
      expect(w.find(`[data-test="overview-limit-${suffix}"]`).exists()).toBe(true);
      expect(w.text()).not.toContain("secret internal");
    },
  );

  it("shows a skeleton while loading", () => {
    const w = mount(OverviewLimitCard, { props: { pending: true, failed: false }, global });
    expect(w.find('[data-test="overview-limit-loading"]').exists()).toBe(true);
  });
});
