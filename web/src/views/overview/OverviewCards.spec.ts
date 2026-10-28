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
import OverviewAlertsCard from "./OverviewAlertsCard.vue";
import OverviewDataHealthCard from "./OverviewDataHealthCard.vue";
import OverviewLimitCard from "./OverviewLimitCard.vue";
import OverviewStreamsCard from "./OverviewStreamsCard.vue";
import { buildOverview } from "./overviewFixtures";
import type { OverviewSection } from "@/ts/interfaces/overview";

const global = { plugins: [i18n] };
const base = { pending: false, failed: false };
const o = buildOverview();

const stateSections: Array<[string, OverviewSection<never>, string]> = [
  ["error", { status: "error", error: "secret internal failure" }, "error"],
  ["forbidden", { status: "forbidden", reason: "secret internal reason" }, "forbidden"],
  ["locked", { status: "locked", reason: "secret internal reason" }, "locked"],
];

describe("OverviewAlertsCard", () => {
  it("renders the state counts", () => {
    const w = mount(OverviewAlertsCard, { props: { ...base, section: o.alerts }, global });
    expect(w.get('[data-test="overview-alerts-row-firing"]').text()).toContain("3");
    expect(w.get('[data-test="overview-alerts-row-pending"]').text()).toContain("2");
    expect(w.get('[data-test="overview-alerts-row-failing"]').text()).toContain("4");
  });

  it("opens the alert list from a row", async () => {
    const w = mount(OverviewAlertsCard, { props: { ...base, section: o.alerts }, global });
    await w.get('[data-test="overview-alerts-row-firing"]').trigger("click");
    expect(w.emitted("open")).toHaveLength(1);
  });

  it("shows a skeleton while loading", () => {
    const w = mount(OverviewAlertsCard, { props: { pending: true, failed: false }, global });
    expect(w.find('[data-test="overview-alerts-loading"]').exists()).toBe(true);
    expect(w.find('[data-test="overview-alerts-rows"]').exists()).toBe(false);
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

describe("OverviewDataHealthCard", () => {
  it("shows errored of total", () => {
    const w = mount(OverviewDataHealthCard, { props: { ...base, section: o.pipelines }, global });
    expect(w.get('[data-test="overview-data-health-row-pipelines"]').text()).toContain("2 of 9");
  });

  it("shows none when no pipeline errors", () => {
    const section = {
      status: "ok",
      data: { total: 3, enabled: 3, disabled: 0, errored: 0 },
    } as const;
    const w = mount(OverviewDataHealthCard, { props: { ...base, section }, global });
    expect(w.get('[data-test="overview-data-health-row-pipelines"]').text()).toContain("No errors");
  });

  it("shows the empty note when there are no pipelines", () => {
    const section = {
      status: "ok",
      data: { total: 0, enabled: 0, disabled: 0, errored: 0 },
    } as const;
    const w = mount(OverviewDataHealthCard, { props: { ...base, section }, global });
    expect(w.find('[data-test="overview-data-health-none"]').exists()).toBe(true);
  });

  it.each(stateSections)("renders %s without the API text", (_n, section, suffix) => {
    const w = mount(OverviewDataHealthCard, {
      props: { ...base, section: section as never },
      global,
    });
    expect(w.find(`[data-test="overview-data-health-${suffix}"]`).exists()).toBe(true);
    expect(w.text()).not.toContain("secret internal");
  });

  it("shows a skeleton while loading", () => {
    const w = mount(OverviewDataHealthCard, { props: { pending: true, failed: false }, global });
    expect(w.find('[data-test="overview-data-health-loading"]').exists()).toBe(true);
  });
});

describe("OverviewStreamsCard", () => {
  it("lists per-type counts and sizes", () => {
    const w = mount(OverviewStreamsCard, { props: { ...base, section: o.streams }, global });
    expect(w.get('[data-test="overview-streams-type-logs"]').text()).toContain("4 streams");
    expect(w.get('[data-test="overview-streams-type-logs"]').text()).toContain("1.50 GB");
    expect(w.get('[data-test="overview-streams-type-metrics"]').text()).toContain("512.00 MB");
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
    const rows = w.findAll('[data-test^="overview-streams-top-"]');
    expect(rows.map((r) => r.attributes("data-test"))).toEqual([
      "overview-streams-top-logs-app_logs",
      "overview-streams-top-metrics-cpu_usage",
      "overview-streams-top-logs-web_logs",
    ]);
    expect(rows[0].text()).toContain("1.00 GB");
  });

  it("emits open from a top stream row", async () => {
    const w = mount(OverviewStreamsCard, { props: { ...base, section: o.streams }, global });
    await w.get('[data-test="overview-streams-top-logs-app_logs"]').trigger("click");
    expect(w.emitted("open")).toHaveLength(1);
  });

  it("shows the start-ingesting empty state for zero streams", async () => {
    const section = {
      status: "ok",
      data: { total_streams: 0, total_storage_size_mb: 0, by_type: [] },
    } as const;
    const w = mount(OverviewStreamsCard, { props: { ...base, section }, global });
    expect(w.find('[data-test="overview-streams-empty"]').exists()).toBe(true);
    await w.get('[data-test="overview-streams-start-ingesting-btn"]').trigger("click");
    expect(w.emitted("startIngesting")).toHaveLength(1);
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

describe("OverviewLimitCard", () => {
  it("shows percent, days over and license", () => {
    const w = mount(OverviewLimitCard, { props: { ...base, section: o.limits }, global });
    expect(w.get('[data-test="overview-limit-percent"]').text()).toBe("85.5%");
    expect(w.get('[data-test="overview-limit-days-over"]').text()).toBe("1");
    expect(w.get('[data-test="overview-limit-license"]').text()).toBe("Valid");
    expect(w.get('[data-test="overview-limit-scope"]').text()).toBe(
      "Across the whole deployment, not just this organization.",
    );
  });

  it.each([
    [79.9, null],
    [80, "Near limit"],
    [99.9, "Near limit"],
    [100, "Over limit"],
  ])("labels %s percent in text, not colour only", (percent, label) => {
    const section = {
      status: "ok",
      data: {
        scope: "deployment",
        ingestion_used_percent: percent,
        expired: false,
        days_over_limit: 0,
      },
    } as const;
    const w = mount(OverviewLimitCard, { props: { ...base, section }, global });
    const tag = w.find('[data-test="overview-limit-status"]');
    if (label) expect(tag.text()).toBe(label);
    else expect(tag.exists()).toBe(false);
  });

  it("flags an expired license", () => {
    const section = {
      status: "ok",
      data: { scope: "deployment", ingestion_used_percent: 120, expired: true, days_over_limit: 5 },
    } as const;
    const w = mount(OverviewLimitCard, { props: { ...base, section }, global });
    expect(w.get('[data-test="overview-limit-license"]').text()).toBe("Expired");
    expect(w.get('[data-test="overview-limit-days-over"]').text()).toBe("5");
  });

  it("shows the locked affordance with our own copy and emits unlock", async () => {
    const w = mount(OverviewLimitCard, {
      props: { ...base, section: { status: "locked", reason: "secret internal reason" } },
      global,
    });
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
      const w = mount(OverviewLimitCard, { props: { ...base, section: section as never }, global });
      expect(w.find(`[data-test="overview-limit-${suffix}"]`).exists()).toBe(true);
      expect(w.text()).not.toContain("secret internal");
    },
  );

  it("shows a skeleton while loading", () => {
    const w = mount(OverviewLimitCard, { props: { pending: true, failed: false }, global });
    expect(w.find('[data-test="overview-limit-loading"]').exists()).toBe(true);
  });
});
