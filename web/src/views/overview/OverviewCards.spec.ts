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
import OverviewTopStreamsCard from "./OverviewTopStreamsCard.vue";
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
  it("draws every card with the Kubernetes overview panel chrome", () => {
    const w = mount(OverviewSectionCard, {
      props: {
        section: "x",
        title: raw("X"),
        subtitle: raw("Sub"),
        view: "ok",
        linkLabel: raw("Open"),
      },
      global,
    });
    expect(w.get('[data-test="overview-x-card"]').classes()).toEqual(
      expect.arrayContaining([
        "bg-surface-panel",
        "border-border-default",
        "rounded-surface",
        "border",
      ]),
    );
    const title = w.get("h3");
    expect(title.text()).toBe("X");
    expect(title.element.parentElement!.classList.contains("p-3")).toBe(true);
    expect(title.element.parentElement!.classList.contains("items-baseline")).toBe(true);
    const sub = w.get('[data-test="overview-x-subtitle"]');
    expect(sub.text()).toBe("Sub");
    expect(sub.classes()).toContain("text-text-secondary");
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
    expect(w.find('[data-test="overview-x-subtitle"]').exists()).toBe(false);
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
    await locked.trigger("click");
    expect(w.emitted("unlock")).toBeUndefined();
  });
});

describe("OverviewAlertsCard", () => {
  const mountAlerts = (props: Record<string, unknown> = {}) =>
    mount(OverviewAlertsCard, { props: { ...base, section: o.alerts, ...props }, global });
  const box = (w: ReturnType<typeof mountAlerts>, key: string) =>
    w.get(`[data-test="overview-alerts-box-${key}"]`);
  const boxKeys = (w: ReturnType<typeof mountAlerts>) =>
    w
      .findAll('[data-test^="overview-alerts-box-"]:not([data-test="overview-alerts-box-count"])')
      .map((b) => b.attributes("data-test")!.replace("overview-alerts-box-", ""));

  it("states the active rules and the rules failing to evaluate under the title", () => {
    const w = mountAlerts();
    expect(w.get('[data-test="overview-alerts-subtitle"]').text()).toBe(
      "10 rules active · 4 failing to evaluate",
    );
    const one = mountAlerts({ section: alertsWith({ enabled: 1, failed_evaluation: 1 }) });
    expect(one.get('[data-test="overview-alerts-subtitle"]').text()).toBe(
      "1 rule active · 1 failing to evaluate",
    );
  });

  it("shows critical, warning, open incidents and failing rules as four boxes", () => {
    const w = mountAlerts({ incidentsState: "ok", incidentsTotal: 6 });
    expect(boxKeys(w)).toEqual(["critical", "warning", "incidents", "failing"]);
    expect(w.get('[data-test="overview-alerts-boxes"]').classes()).toContain("grid-cols-4");
    const count = (key: string) => box(w, key).get('[data-test="overview-alerts-box-count"]');
    expect(box(w, "critical").text()).toBe("2Critical level");
    expect(box(w, "warning").text()).toBe("1Warning level");
    expect(box(w, "incidents").text()).toBe("6Open incidents");
    expect(box(w, "failing").text()).toBe("4Rules failing");
    expect(count("critical").classes()).toEqual(
      expect.arrayContaining(["text-xl", "font-bold", "text-status-negative"]),
    );
    expect(count("warning").classes()).toContain("text-status-warning-text");
    expect(count("incidents").classes()).toContain("text-text-heading");
    expect(count("failing").classes()).toContain("text-status-negative");
    const frame = (key: string) => w.get(`[data-test="overview-alerts-frame-${key}"]`).classes();
    expect(frame("critical")).toEqual(
      expect.arrayContaining(["bg-status-error-bg", "border-status-negative"]),
    );
    expect(frame("warning")).toEqual(
      expect.arrayContaining(["bg-status-warning-bg", "border-status-warning-text"]),
    );
    expect(frame("failing")).toContain("bg-status-error-bg");
    expect(frame("incidents")).not.toContain("bg-status-error-bg");
  });

  it("drops the incidents box when incidents are unavailable, and keeps zeros neutral", () => {
    for (const incidentsState of [undefined, "locked", "unavailable", "error"]) {
      const w = mountAlerts({ incidentsState });
      expect(boxKeys(w)).toEqual(["critical", "warning", "failing"]);
      expect(w.get('[data-test="overview-alerts-boxes"]').classes()).toContain("grid-cols-3");
    }
    const zero = mountAlerts({
      section: alertsWith({
        failed_evaluation: 0,
        firing_by_level: { ok: 0, warning: 0, critical: 0, no_data: 0, unclassified: 0 },
      }),
    });
    expect(
      box(zero, "critical").get('[data-test="overview-alerts-box-count"]').classes(),
    ).toContain("text-text-heading");
    expect(zero.get('[data-test="overview-alerts-frame-critical"]').classes()).toEqual(
      expect.arrayContaining(["border-border-default", "hover:border-border-strong"]),
    );
  });

  it("links each box to its headline tile's target", async () => {
    const w = mountAlerts({ incidentsState: "ok", incidentsTotal: 2 });
    for (const key of ["critical", "warning", "incidents", "failing"]) {
      await box(w, key).trigger("click");
    }
    expect(w.emitted("select")).toEqual([["firing"], ["firing"], ["incidents"], ["failing"]]);
  });

  it("heads the firing list with what it lists and how long each has fired", () => {
    const header = mountAlerts().get('[data-test="overview-alerts-table-header"]');
    expect(header.findAll("span").map((x) => x.text())).toEqual([
      "Firing now, oldest first",
      "Firing for",
    ]);
  });

  it("lists firing alerts in the given order with a level pill, name, stream and age", () => {
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
    const pill = w.get('[data-test="overview-alerts-firing-level-high_cpu"]');
    expect(pill.classes()).toEqual(expect.arrayContaining(["min-w-16", "justify-center"]));
  });

  it.each(["ok", "no_data", "unclassified"] as const)(
    "shows a neutral Firing pill for a firing rule whose level is %s",
    (level) => {
      const [first] = o.alerts.data!.firing;
      const w = mountAlerts({ section: alertsWith({ firing: [{ ...first, level }] }) });
      const tag = w.get(`[data-test="overview-alerts-firing-level-${first.name}"]`);
      expect(tag.text()).toBe("Firing");
      expect(tag.classes()).toContain("bg-badge-default-soft-bg");
    },
  );

  it("lists at most five firing alerts and counts the rest in the show-more link", () => {
    const [first] = o.alerts.data!.firing;
    const firing = Array.from({ length: 6 }, (_, i) => ({ ...first, name: `rule_${i}` }));
    const w = mountAlerts({
      section: alertsWith({
        firing,
        firing_by_level: { ok: 0, warning: 0, critical: 8, no_data: 0, unclassified: 0 },
      }),
    });
    expect(
      w.findAll('[data-test^="overview-alerts-firing-rule_"]:not([data-test*="level"])'),
    ).toHaveLength(5);
    expect(w.get('[data-test="overview-alerts-show-more"]').text()).toBe(
      "Show 3 more firing alerts",
    );
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

  it("fills the list area with a centred all-clear naming the rules being evaluated", () => {
    const w = mountAlerts({
      section: alertsWith({
        firing: [],
        firing_by_level: { ok: 0, warning: 0, critical: 0, no_data: 0, unclassified: 0 },
      }),
    });
    const clear = w.get('[data-test="overview-alerts-none-firing"]');
    expect(clear.classes()).toEqual(
      expect.arrayContaining(["flex-1", "items-center", "justify-center"]),
    );
    expect(clear.find("svg").exists()).toBe(true);
    expect(clear.get("p").text()).toBe("No alerts firing right now");
    expect(clear.get("p").classes()).toContain("text-text-heading");
    expect(w.get('[data-test="overview-alerts-evaluated"]').text()).toBe(
      "10 rules are being evaluated",
    );
    expect(w.find('[data-test="overview-alerts-table-header"]').exists()).toBe(false);
    expect(w.find('[data-test="overview-alerts-boxes"]').exists()).toBe(true);
    expect(w.find('[data-test="overview-alerts-show-more"]').exists()).toBe(false);
  });

  it("links to all alerts from the header", async () => {
    const w = mountAlerts();
    const link = w.get('[data-test="overview-alerts-view-all"]');
    expect(link.text()).toBe("View all alerts");
    await link.trigger("click");
    expect(w.emitted("open")).toHaveLength(1);
  });

  it("offers the remaining count when more rules fire than are listed", async () => {
    const w = mountAlerts();
    const more = w.get('[data-test="overview-alerts-show-more"]');
    expect(more.text()).toBe("Show 1 more firing alert");
    await more.trigger("click");
    expect(w.emitted("open")).toHaveLength(1);
  });

  it("pluralises the remaining count and hides the link when everything is listed", () => {
    const levels = (critical: number, warning: number) =>
      alertsWith({ firing_by_level: { ok: 0, warning, critical, no_data: 0, unclassified: 0 } });
    expect(
      mountAlerts({ section: levels(3, 4) })
        .get('[data-test="overview-alerts-show-more"]')
        .text(),
    ).toBe("Show 5 more firing alerts");
    expect(
      mountAlerts({ section: levels(1, 1) })
        .find('[data-test="overview-alerts-show-more"]')
        .exists(),
    ).toBe(false);
  });

  it("titles the card alerts and incidents only where incidents exist", () => {
    const title = (props: Record<string, unknown>) => mountAlerts(props).get("h3").text();
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
    expect(w.find('[data-test="overview-alerts-boxes"]').exists()).toBe(false);
    expect(w.find('[data-test="overview-alerts-subtitle"]').exists()).toBe(false);
    const action = w.get('[data-test="overview-alerts-view-all"]');
    expect(action.text()).toBe("Create an alert");
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
    expect(w.find('[data-test="overview-alerts-boxes"]').exists()).toBe(false);
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
    const w = mount(OverviewTopStreamsCard, {
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
    await w.get('[data-test="overview-data-health-row-quiet"]').trigger("click");
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
    ["streams", OverviewTopStreamsCard],
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
  const status = (w: ReturnType<typeof mountHealth>, key: string) =>
    w.get(`[data-test="overview-data-health-status-${key}"]`);
  const value = (w: ReturnType<typeof mountHealth>, key: string) =>
    w.get(`[data-test="overview-data-health-value-${key}"]`);
  const order = (w: ReturnType<typeof mountHealth>) =>
    w
      .findAll('[data-test^="overview-data-health-row-"]')
      .map((r) => r.attributes("data-test")?.replace("overview-data-health-row-", ""));
  const FIXED = ["quiet", "failing", "pipelines", "delivery", "schema", "compaction"];

  it("asks what it checks under the title and links to pipelines", () => {
    const w = mountHealth();
    expect(w.get('[data-test="overview-data-health-subtitle"]').text()).toBe(
      "Is data arriving, intact and delivered?",
    );
    expect(w.get('[data-test="overview-data-health-view-all"]').text()).toBe("View pipelines");
  });

  it("keeps every row in one fixed order whatever its state, with no summary or collapse", () => {
    expect(order(mountHealth())).toEqual(FIXED);
    const overview = buildOverview({
      alerts: alertsWith({ total: 0, enabled: 0, disabled: 0, failed_evaluation: 0, by_state: {} }),
      pipelines: { status: "error", error: "boom" },
    });
    const w = mountHealth(overview);
    expect(order(w)).toEqual(FIXED);
    expect(w.find('[data-test="overview-data-health-healthy"]').exists()).toBe(false);
    expect(w.find("[aria-expanded]").exists()).toBe(false);
    expect(w.text()).not.toContain("need attention");
  });

  it("labels each row with what it checks and why", () => {
    const w = mountHealth();
    expect(row(w, "quiet").text()).toContain("Streams gone quiet");
    expect(row(w, "quiet").text()).toContain("Stopped writing between an hour and 7 days ago");
    expect(row(w, "failing").text()).toContain("Alert rules failing to evaluate");
    expect(row(w, "failing").text()).toContain("Blind spots, not firing");
    expect(row(w, "pipelines").text()).toContain("Pipelines with errors");
    expect(row(w, "pipelines").text()).toContain("Of 8 active pipelines");
    expect(row(w, "delivery").text()).toContain("Alert delivery failures");
    expect(row(w, "delivery").text()).toContain("Alerts that fired but could not notify");
    expect(row(w, "schema").text()).toContain("New schema versions across your streams");
    expect(row(w, "compaction").text()).toContain("Compaction jobs pending");
    expect(row(w, "compaction").text()).toContain("Across stream types you can see");
  });

  it("puts a muted status word and a toned value on the right of each row", () => {
    const w = mountHealth();
    expect(status(w, "failing").text()).toBe("Needs action");
    expect(status(w, "failing").classes()).toEqual(
      expect.arrayContaining(["text-xs", "font-semibold", "text-status-error-text"]),
    );
    expect(status(w, "quiet").classes()).toContain("text-status-warning-text");
    expect(status(w, "schema").classes()).toContain("text-status-info-text");
    const dot = (key: string) => w.get(`[data-test="overview-data-health-dot-${key}"]`);
    expect(dot("failing").classes()).toContain("bg-status-negative");
    expect(dot("quiet").classes()).toContain("bg-status-warning-text");
    expect(dot("schema").classes()).toContain("bg-status-info-text");
    expect(dot("delivery").classes()).toContain("bg-status-positive");
    expect(dot("delivery").attributes("aria-hidden")).toBe("true");
    expect(value(w, "failing").text()).toBe("4");
    expect(value(w, "failing").classes()).toEqual(
      expect.arrayContaining(["text-sm", "font-semibold", "tabular-nums", "text-status-negative"]),
    );
    expect(status(w, "quiet").text()).toBe("Warning");
    expect(value(w, "quiet").text()).toBe("3");
    expect(value(w, "quiet").classes()).toContain("text-status-warning-text");
    expect(status(w, "schema").text()).toBe("Info");
    expect(value(w, "schema").text()).toBe("5");
    expect(value(w, "schema").classes()).toContain("text-text-heading");
    expect(value(w, "compaction").text()).toBe("12");
  });

  it("reads delivery failures from notify_failed", () => {
    const overview = buildOverview({
      alerts: alertsWith({ by_state: { firing: 1, notify_failed: 7 } }),
    });
    const w = mountHealth(overview);
    expect(value(w, "delivery").text()).toBe("7");
    expect(status(w, "delivery").text()).toBe("Needs action");
  });

  it("calls zero problems healthy, in words, with a neutral zero", () => {
    const overview = buildOverview({
      alerts: alertsWith({ failed_evaluation: 0, by_state: {} }),
      pipelines: okSection({ total: 3, enabled: 3, disabled: 0, errored: 0 }),
      streams: streamsWith({ quiet_count: 0 }),
    });
    const w = mountHealth(overview);
    for (const key of ["quiet", "failing", "pipelines", "delivery"]) {
      expect(status(w, key).text()).toBe("Healthy");
      expect(status(w, key).classes()).toContain("text-status-success-text");
      expect(value(w, key).text()).toBe("0");
      expect(value(w, key).classes()).toContain("text-text-heading");
    }
  });

  it("shows not set up with a muted dash, never healthy, for things that do not exist", () => {
    const overview = buildOverview({
      alerts: alertsWith({ total: 0, enabled: 0, disabled: 0, failed_evaluation: 0, by_state: {} }),
      pipelines: okSection({ total: 0, enabled: 0, disabled: 0, errored: 0 }),
    });
    const w = mountHealth(overview);
    for (const key of ["failing", "delivery", "pipelines"]) {
      expect(status(w, key).text()).toBe("Not set up");
      expect(status(w, key).classes()).toContain("text-text-muted");
      expect(value(w, key).text()).toBe("—");
      expect(value(w, key).classes()).toContain("text-text-muted");
      expect(row(w, key).text()).not.toContain("Healthy");
    }
    expect(row(w, "pipelines").text()).toContain("No pipelines yet");
  });

  it("shows quiet streams, schema changes and compaction as not set up when there are no streams", () => {
    const w = mountHealth(buildOverview({ streams: streamsWith({ total_streams: 0 }) }));
    for (const key of ["quiet", "schema", "compaction"]) {
      expect(status(w, key).text()).toBe("Not set up");
    }
  });

  it("shows the state and a dash, never a zero, for a row whose section is unavailable", () => {
    const overview = buildOverview({
      streams: { status: "error", error: "secret internal failure" },
      pipelines: { status: "forbidden", reason: "secret internal reason" },
      alerts: { status: "locked", reason: "secret internal reason" },
    });
    const w = mountHealth(overview);
    expect(status(w, "quiet").text()).toBe("Could not load");
    expect(status(w, "schema").text()).toBe("Could not load");
    expect(status(w, "pipelines").text()).toBe("No access");
    expect(status(w, "failing").text()).toBe("Locked");
    expect(status(w, "delivery").text()).toBe("Locked");
    for (const key of FIXED) {
      expect(value(w, key).text()).toBe("—");
      expect(value(w, key).classes()).toContain("text-text-muted");
    }
    expect(w.text()).not.toContain("secret internal");
  });

  it("links each row to its list page", async () => {
    const w = mountHealth();
    for (const key of FIXED) await row(w, key).trigger("click");
    expect(w.emitted("open")).toEqual([
      ["streams"],
      ["alerts"],
      ["pipelines"],
      ["alerts"],
      ["streams"],
      ["streams"],
    ]);
  });

  it("shows a dash for compaction when the count is unknown", () => {
    const w = mountHealth(buildOverview({ streams: streamsWith({ compaction_pending: null }) }));
    expect(value(w, "compaction").text()).toBe("—");
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

describe("OverviewTopStreamsCard", () => {
  const mountTop = (props: Record<string, unknown> = {}) =>
    mount(OverviewTopStreamsCard, { props: { ...base, section: o.streams, ...props }, global });
  const rowKeys = (w: ReturnType<typeof mountTop>) =>
    w
      .findAll('[data-test^="overview-streams-top-"]')
      .map((r) => r.attributes("data-test")!)
      .filter((id) => !/-(share|bar|size)-/.test(id) && id !== "overview-streams-top");

  it("is titled by data size, says whose streams, and links to all streams", () => {
    const w = mountTop();
    expect(w.get("h3").text()).toBe("Top streams by data size");
    expect(w.get('[data-test="overview-streams-subtitle"]').text()).toBe(
      "Largest streams you can access",
    );
    expect(w.get('[data-test="overview-streams-view-all"]').text()).toBe("All streams");
  });

  it("lists the largest streams of every type first, with type, share, bar and size", () => {
    const w = mountTop();
    expect(rowKeys(w)).toEqual([
      "overview-streams-top-logs-app_logs",
      "overview-streams-top-metrics-cpu_usage",
      "overview-streams-top-logs-web_logs",
    ]);
    const share = (id: string) => w.get(`[data-test="overview-streams-top-share-${id}"]`).text();
    expect(share("logs-app_logs")).toBe("Logs · 50% of total");
    expect(share("metrics-cpu_usage")).toBe("Metrics · 25% of total");
    expect(share("logs-web_logs")).toBe("Logs · 20% of total");
    expect(w.get('[data-test="overview-streams-top-size-logs-app_logs"]').text()).toBe("1.00 GB");
  });

  it("scales each bar to the largest stream and paints it with the signal colour", () => {
    const w = mountTop();
    const segment = (id: string) =>
      w.get(
        `[data-test="overview-streams-top-bar-${id}"] [data-test="o-segmented-bar-segment-share"]`,
      );
    expect(segment("logs-app_logs").attributes("style")).toContain("width: 100%");
    expect(segment("metrics-cpu_usage").attributes("style")).toContain("width: 50%");
    expect(segment("logs-app_logs").classes()).toContain("bg-signal-logs");
    expect(w.get('[data-test="overview-streams-top-bar-logs-app_logs"]').classes()).toEqual(
      expect.arrayContaining(["h-2.5", "bg-border-default"]),
    );
    expect(w.get('[data-test="overview-streams-top-size-logs-app_logs"]').classes()).toEqual(
      expect.arrayContaining(["text-text-heading", "text-sm", "font-semibold", "tabular-nums"]),
    );
    expect(segment("metrics-cpu_usage").classes()).toContain("bg-signal-metrics");
  });

  it("caps the list at six streams", () => {
    const top = Array.from({ length: 8 }, (_, i) => ({
      name: `s${i}`,
      doc_num: 1,
      storage_size_mb: 100 - i,
    }));
    const byType = [{ ...o.streams.data!.by_type[0], top }];
    expect(rowKeys(mountTop({ section: streamsWith({ by_type: byType }) }))).toHaveLength(6);
  });

  it("says under 1% instead of 0% for a tiny share, and never NaN for an empty total", () => {
    const tiny = mountTop({ section: streamsWith({ total_storage_size_mb: 1_000_000 }) });
    expect(tiny.get('[data-test="overview-streams-top-share-logs-web_logs"]').text()).toBe(
      "Logs · Under 1% of total",
    );
    const zero = mountTop({ section: streamsWith({ total_storage_size_mb: 0 }) });
    expect(zero.text()).toContain("0% of total");
    expect(zero.text()).not.toContain("NaN");
  });

  it("emits open from a stream row", async () => {
    const w = mountTop();
    await w.get('[data-test="overview-streams-top-logs-app_logs"]').trigger("click");
    expect(w.emitted("open")).toHaveLength(1);
  });

  it("shows a one-line empty state and puts Start ingesting in the header for zero streams", async () => {
    const section = streamsWith({ total_streams: 0, total_storage_size_mb: 0, by_type: [] });
    const w = mountTop({ section });
    expect(w.get('[data-test="overview-streams-empty"]').text()).toContain("No streams yet");
    const action = w.get('[data-test="overview-streams-view-all"]');
    expect(action.text()).toBe("Start ingesting");
    await action.trigger("click");
    expect(w.emitted("startIngesting")).toHaveLength(1);
    expect(w.emitted("open")).toBeUndefined();
  });

  it.each(stateSections)("renders %s without the API text", (_n, section, suffix) => {
    const w = mountTop({ section: section as never });
    expect(w.find(`[data-test="overview-streams-${suffix}"]`).exists()).toBe(true);
    expect(w.text()).not.toContain("secret internal");
  });

  it("shows a skeleton while loading", () => {
    const w = mount(OverviewTopStreamsCard, { props: { pending: true, failed: false }, global });
    expect(w.find('[data-test="overview-streams-loading"]').exists()).toBe(true);
  });
});

describe("OverviewLimitCard", () => {
  const mountLimit = (
    limits: OverviewSection<OverviewLimitsData> | undefined = o.limits,
    streams: OverviewSection<OverviewStreamsData> | undefined = o.streams,
  ) => mount(OverviewLimitCard, { props: { ...base, limits, streams }, global });

  it("titles the card by limit and storage and explains the UTC day", () => {
    const w = mountLimit();
    expect(w.get("h3").text()).toBe("Ingest limit and storage");
    expect(w.get('[data-test="overview-limit-subtitle"]').text()).toBe(
      "Daily limit counts the UTC day, not a rolling 24h",
    );
  });

  it("shows used of limit with a bar and the reset countdown", () => {
    const w = mountLimit();
    const usage = w.get('[data-test="overview-limit-usage"]');
    expect(usage.get(".font-semibold").text()).toBe("85.50 GB");
    expect(usage.get(".text-text-secondary").text()).toBe("of 100.00 GB");
    const bar = w.get('[data-test="overview-limit-bar"]');
    expect(bar.attributes("role")).toBe("progressbar");
    expect(bar.find(".bg-progress-bar-warning").exists()).toBe(true);
    expect(w.get('[data-test="overview-limit-resets"]').text()).toBe(
      "Resets at 00:00 UTC, in 1h 46m",
    );
  });

  it.each([
    [50, "bg-progress-bar-default", null],
    [75, "bg-progress-bar-warning", "Approaching limit"],
    [100, "bg-progress-bar-danger", "Over limit"],
  ])("colours %s percent by the named thresholds and says it in words", (percent, fill, label) => {
    const w = mountLimit(limitsWith({ ingestion_used_percent: percent }));
    expect(w.get('[data-test="overview-limit-bar"]').find(`.${fill}`).exists()).toBe(true);
    const tag = w.find('[data-test="overview-limit-status"]');
    if (label) expect(tag.text()).toBe(label);
    else expect(tag.exists()).toBe(false);
  });

  it("boxes the days over the limit with the real allowed count", () => {
    const w = mountLimit();
    const days = w.get('[data-test="overview-limit-days-box"]');
    expect(days.classes()).toEqual(expect.arrayContaining(["border", "rounded-default"]));
    expect(days.text()).toContain("Days over limit this month");
    expect(w.get('[data-test="overview-limit-days-over"]').text()).toBe("1 of 3 allowed");
    expect(w.get('[data-test="overview-limit-block-note"]').text()).toBe(
      "Search is blocked after more than 3 days over the limit",
    );
    const one = mountLimit(limitsWith({ allowed_days: 1 }));
    expect(one.get('[data-test="overview-limit-block-note"]').text()).toBe(
      "Search is blocked after more than 1 day over the limit",
    );
  });

  it.each([
    [0, 3, "text-text-heading"],
    [3, 3, "text-status-warning-text"],
    [4, 3, "text-status-negative"],
  ])("tones %s days over of %s allowed with %s", (days, allowed, tone) => {
    const w = mountLimit(limitsWith({ days_over_limit: days, allowed_days: allowed }));
    expect(w.get('[data-test="overview-limit-days-over"]').classes()).toContain(tone);
  });

  it("shows only the day count and no block note when the allowed days are unknown", () => {
    const w = mountLimit(limitsWith({ allowed_days: null, days_over_limit: 2 }));
    expect(w.get('[data-test="overview-limit-days-over"]').text()).toBe("2");
    expect(w.find('[data-test="overview-limit-block-note"]').exists()).toBe(false);
  });

  it("says of unlimited without a bar when the daily limit is unlimited", () => {
    const w = mountLimit(limitsWith({ limit_today_gb: null }));
    expect(w.get('[data-test="overview-limit-usage"]').text()).toBe("85.50 GBof unlimited");
    expect(w.find('[data-test="overview-limit-bar"]').exists()).toBe(false);
  });

  it("falls back to the percent when today's usage is unknown", () => {
    expect(
      mountLimit(limitsWith({ used_today_gb: null }))
        .get('[data-test="overview-limit-usage"]')
        .text(),
    ).toBe("85.5%");
  });

  it("counts down to zero minutes when the reset time already passed", () => {
    const w = mountLimit(limitsWith({ resets_at: o.generated_at - 5_000_000 }));
    expect(w.get('[data-test="overview-limit-resets"]').text()).toBe("Resets at 00:00 UTC, in 0m");
  });

  it("shows a license line only when the license expired", () => {
    expect(mountLimit().find('[data-test="overview-limit-expired"]').exists()).toBe(false);
    const w = mountLimit(limitsWith({ expired: true }));
    const line = w.get('[data-test="overview-limit-expired"]');
    expect(line.text()).toBe("License expired");
    expect(line.classes()).toContain("text-status-negative");
  });

  it("shows the data size under a divider with the signal split spread under one bar", () => {
    const w = mountLimit();
    const html = w.html();
    expect(html.indexOf("overview-limit-body")).toBeLessThan(html.indexOf('role="separator"'));
    expect(html.indexOf('role="separator"')).toBeLessThan(html.indexOf("overview-storage-body"));
    expect(w.get('[data-test="overview-storage-total"]').text()).toBe("2.00 GB");
    expect(w.get('[data-test="overview-storage-body"]').text()).toContain(
      "Uncompressed size across logs, metrics and traces",
    );
    const bar = w.get('[data-test="overview-storage-bar"]');
    expect(bar.attributes("aria-label")).toBe("Data size by signal");
    expect(bar.get('[data-test="o-segmented-bar-segment-logs"]').classes()).toContain(
      "bg-signal-logs",
    );
    expect(bar.find('[data-test="o-segmented-bar-segment-traces"]').exists()).toBe(false);
    expect(w.get('[data-test="overview-storage-legend"]').classes()).toContain("justify-between");
    expect(w.get('[data-test="overview-storage-legend-logs"]').text()).toBe("Logs 75%");
    expect(w.get('[data-test="overview-storage-legend-metrics"]').text()).toBe("Metrics 25%");
    expect(w.get('[data-test="overview-storage-legend-traces"]').text()).toBe("Traces 0%");
  });

  it("leaves enrichment streams out of the data size", () => {
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
    const w = mountLimit(o.limits, streamsWith({ by_type: byType }));
    expect(w.get('[data-test="overview-storage-total"]').text()).toBe("2.00 GB");
    expect(w.get('[data-test="overview-storage-legend-logs"]').text()).toBe("Logs 75%");
  });

  it("says no data yet, without a bar, when nothing is stored", () => {
    const w = mountLimit(o.limits, streamsWith({ by_type: [] }));
    expect(w.get('[data-test="overview-storage-empty"]').text()).toBe("No data yet");
    expect(w.find('[data-test="overview-storage-bar"]').exists()).toBe(false);
  });

  it("shows only the data size, titled data size, when the limit is locked", () => {
    const w = mountLimit({ status: "locked", reason: "secret internal reason" });
    expect(w.find('[data-test="overview-storage-card"]').exists()).toBe(true);
    expect(w.get("h3").text()).toBe("Data size");
    expect(w.find('[data-test="overview-storage-subtitle"]').exists()).toBe(false);
    expect(w.find('[data-test="overview-limit-body"]').exists()).toBe(false);
    expect(w.find('[role="separator"]').exists()).toBe(false);
    expect(w.text()).not.toContain("secret internal");
  });

  it("shows only the data size on cloud", () => {
    const original = config.isCloud;
    config.isCloud = "true";
    try {
      const w = mountLimit();
      expect(w.get("h3").text()).toBe("Data size");
      expect(w.find('[data-test="overview-limit-body"]').exists()).toBe(false);
      expect(w.get('[data-test="overview-storage-total"]').text()).toBe("2.00 GB");
    } finally {
      config.isCloud = original;
    }
  });

  it.each(stateSections.filter(([n]) => n !== "locked"))(
    "says the limit is unavailable on %s and keeps the data size",
    (_n, section) => {
      const w = mountLimit(section as never);
      expect(w.get('[data-test="overview-limit-unavailable"]').text()).toBe(
        "Ingest limit unavailable",
      );
      expect(w.find('[data-test="overview-limit-body"]').exists()).toBe(false);
      expect(w.find('[data-test="overview-storage-body"]').exists()).toBe(true);
      expect(w.text()).not.toContain("secret internal");
    },
  );

  it("keeps the limit when only the streams section failed, with retry on the data size", async () => {
    const w = mountLimit(o.limits, { status: "error", error: "secret internal failure" } as never);
    expect(w.find('[data-test="overview-limit-body"]').exists()).toBe(true);
    await w.get('[data-test="overview-storage-retry-btn"]').trigger("click");
    expect(w.emitted("retry")).toHaveLength(1);
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
});

describe("OverviewSignalCards", () => {
  const mountSignals = (props: Record<string, unknown> = {}) =>
    mount(OverviewSignalCards, { props: { ...base, section: o.streams, ...props }, global });

  it("always shows logs, metrics and traces as three aligned cards", () => {
    const w = mountSignals();
    expect(w.get('[data-test="overview-signal-cards"]').classes()).toEqual(
      expect.arrayContaining(["grid-cols-3", "gap-3"]),
    );
    expect(w.findAll('[data-test$="-card"]').map((c) => c.attributes("data-test"))).toEqual([
      "overview-signal-logs-card",
      "overview-signal-metrics-card",
      "overview-signal-traces-card",
    ]);
  });

  it("heads each card with its signal colour and name", () => {
    const w = mountSignals();
    expect(w.get('[data-test="overview-signal-logs-swatch"]').classes()).toContain(
      "bg-signal-logs",
    );
    expect(w.get('[data-test="overview-signal-traces-swatch"]').classes()).toContain(
      "bg-signal-traces",
    );
    expect(w.get('[data-test="overview-signal-metrics-card"] h3').text()).toBe("Metrics");
  });

  it("lists streams, events and data size as label and value rows", () => {
    const w = mountSignals();
    const stats = w.get('[data-test="overview-signal-logs-stats"]');
    expect(stats.findAll("dt")[0].element.parentElement!.classList.contains("border-t")).toBe(true);
    expect(stats.findAll("dt").map((d) => d.text())).toEqual(["Streams", "Events", "Data size"]);
    expect(w.get('[data-test="overview-signal-logs-streams"]').text()).toBe("4");
    expect(w.get('[data-test="overview-signal-logs-events"]').text()).toBe("1000");
    expect(w.get('[data-test="overview-signal-logs-stored"]').text()).toBe("1.50 GB");
    expect(w.get('[data-test="overview-signal-metrics-streams"]').text()).toBe("3");
    expect(w.get('[data-test="overview-signal-metrics-card"]').text()).toContain("Samples");
    expect(w.get('[data-test="overview-signal-traces-card"]').text()).toContain("Spans");
  });

  it("shows a signal with no streams as zeros, not a missing card", () => {
    const w = mountSignals();
    expect(w.get('[data-test="overview-signal-traces-streams"]').text()).toBe("0");
    expect(w.get('[data-test="overview-signal-traces-stored"]').text()).toBe("0.00 MB");
  });

  it("compacts large event counts", () => {
    const byType = [{ ...o.streams.data!.by_type[0], doc_num: 2_900_000_000 }];
    const w = mountSignals({ section: streamsWith({ by_type: byType }) });
    expect(w.get('[data-test="overview-signal-logs-events"]').text()).toBe("2.9B");
  });

  it("gives each Open link a distinct accessible name that keeps the visible text", () => {
    const w = mountSignals();
    const names = ["logs", "metrics", "traces"].map((s) => {
      const link = w.get(`[data-test="overview-signal-${s}-view-all"]`);
      expect(link.text()).toBe("Open");
      return link.attributes("aria-label");
    });
    expect(names).toEqual(["Open logs", "Open metrics", "Open traces"]);
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

describe("type roles", () => {
  it("uses one style per role across the cards", () => {
    const o2 = buildOverview();
    const health = mount(OverviewDataHealthCard, { props: { ...base, overview: o2 }, global });
    const top = mount(OverviewTopStreamsCard, { props: { ...base, section: o2.streams }, global });
    const alerts = mount(OverviewAlertsCard, { props: { ...base, section: o2.alerts }, global });
    const limit = mount(OverviewLimitCard, {
      props: { ...base, limits: o2.limits, streams: o2.streams },
      global,
    });
    const signals = mount(OverviewSignalCards, { props: { ...base, section: o2.streams }, global });
    for (const w of [health, top, alerts, limit]) {
      expect(w.get("h3").classes()).toEqual(expect.arrayContaining(["text-sm", "font-semibold"]));
    }
    const valueClasses = ["text-sm", "font-semibold", "tabular-nums"];
    expect(top.get('[data-test="overview-streams-top-size-logs-app_logs"]').classes()).toEqual(
      expect.arrayContaining(valueClasses),
    );
    expect(limit.get('[data-test="overview-storage-total"]').classes()).toEqual(
      expect.arrayContaining(valueClasses),
    );
    expect(signals.get('[data-test="overview-signal-logs-streams"]').classes()).toEqual(
      expect.arrayContaining(valueClasses),
    );
    expect(health.get('[data-test="overview-data-health-value-quiet"]').classes()).toEqual(
      expect.arrayContaining(valueClasses),
    );
    const labels = [
      ...signals.findAll("dt"),
      ...limit.findAll(".text-text-label"),
      ...alerts.findAll('[data-test="overview-alerts-boxes"] .text-text-label'),
    ];
    expect(labels.length).toBeGreaterThan(5);
    for (const label of labels) expect(label.classes()).toContain("text-xs");
  });
});
