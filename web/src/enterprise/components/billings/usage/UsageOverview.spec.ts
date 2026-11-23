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

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { mockMeteringResponse } from "./meteringMock";
import { DRILLDOWNS } from "./usageQueries";
import { formatCost, subtotalCost, volumeDetails } from "./meteringModel";

const route = reactive<{ query: Record<string, string | undefined> }>({ query: {} });
vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({
    replace: ({ query }: { query: Record<string, string | undefined> }) => {
      route.query = query;
    },
  }),
}));

const search = vi.fn();
const cancel = vi.fn();
vi.mock("./useUsageSearch", () => ({ useUsageSearch: () => ({ search, cancel }) }));

// The org costs every test sees; the member view must read its numbers from here.
const orgCosts: { value: Record<string, unknown> } = { value: {} };
vi.mock("./useOrgCosts", async () => {
  const { ref: vueRef } = await import("vue");
  const costs = vueRef({});
  Object.defineProperty(orgCosts, "value", {
    get: () => costs.value,
    set: (v) => {
      costs.value = v;
    },
  });
  return {
    useOrgCosts: () => ({ costs, loading: vueRef(false), failed: vueRef(false) }),
  };
});

const { default: UsageOverview } = await import("./UsageOverview.vue");

const billingOrgs = [
  { id: "payer", name: "Payer", isSelf: true },
  { id: "child", name: "Child", isSelf: false },
];

enableAutoUnmount(afterEach);

describe("UsageOverview org drilldown", () => {
  // The child's part of the bill: 100 MB of a $90-billed Ingestion meter came to $22.50.
  const childShare = { volume: 100, gross: 25, billed: 22.5 };

  beforeEach(() => {
    route.query = {};
    search.mockReset().mockResolvedValue([]);
    cancel.mockReset();
    orgCosts.value = {
      child: { gross: 25, billed: 22.5, ingested: 100, byMeter: { ingestion: childShare } },
    };
  });

  const mountAt = (query: Record<string, string>) => {
    route.query = query;
    return mount(UsageOverview, {
      props: {
        details: mockMeteringResponse().upcoming,
        billingOrgs,
        lastLoadedAt: 1,
        projected: null,
        refreshing: false,
        // The page reads org costs once and hands them down.
        orgCosts: { costs: orgCosts.value as any, loading: false, failed: false },
      },
      global: {
        plugins: [i18n, store],
        stubs: { UsageCachedChart: true, UsageMeterBreakdown: true, UsageBillStrip: true },
      },
    });
  };

  it("builds a member's meters from its share of the bill, with no query of its own", async () => {
    const wrapper = mountAt({ org: "child" });
    await flushPromises();

    const table = wrapper.findComponent('[data-test="billings-usageoverview-org-meters"]');
    const rows = table.props("rows") as { key: string; cost: number }[];
    expect(rows.find((row) => row.key === "ingestion")?.cost).toBe(22.5);
    // The member's meters add up to its row in Cost by Org.
    expect(table.props("total")).toBe(22.5);
    expect(search).not.toHaveBeenCalled();
  });

  it("prices a member's drilldown at its share, so the breakdown adds up to its row", async () => {
    const wrapper = mountAt({ org: "child", meter: "ingestion" });
    await flushPromises();

    const breakdown = wrapper.findComponent({ name: "UsageMeterBreakdown" });
    expect(breakdown.props("rate")).toBeCloseTo(22.5 / 100, 12);
  });
});

describe("UsageOverview Cost by Org", () => {
  beforeEach(() => {
    route.query = {};
    search.mockReset().mockResolvedValue([]);
  });

  it("keeps an org that left the group mid-cycle, so the rows still add up to the bill", async () => {
    // "gone" was a member earlier this cycle; its usage stays on the payer's bill.
    const costs = {
      payer: { gross: 8, billed: 8, ingested: 10, byMeter: {} },
      child: { gross: 28, billed: 28, ingested: 30, byMeter: {} },
      gone: { gross: 14, billed: 14, ingested: 20, byMeter: {} },
    };
    const wrapper = mount(UsageOverview, {
      props: {
        details: mockMeteringResponse().upcoming,
        billingOrgs,
        lastLoadedAt: 1,
        projected: null,
        refreshing: false,
        orgCosts: { costs: costs as any, loading: false, failed: false },
      },
      global: {
        plugins: [i18n, store],
        stubs: { UsageCachedChart: true, UsageMeterBreakdown: true, UsageBillStrip: true },
      },
    });
    await flushPromises();

    const table = wrapper.findComponent('[data-test="billings-usageoverview-org-table"]');
    const rows = table.props("rows") as {
      key: string;
      label: unknown;
      cost: number;
      drillable: boolean;
    }[];
    const gone = rows.find((row) => row.key === "gone")! as {
      label: unknown;
      subline: unknown;
      drillable: boolean;
    };
    // The name stays whole; the line under it says why the org is listed, so a cut name never hides it.
    expect(String(gone.label)).toBe("gone");
    expect(String(gone.subline)).toBe("Former member · 20.00 MB ingested");
    // Not a member any more, so there is no org view to open.
    expect(gone.drillable).toBe(false);
    expect(table.props("total")).toBe(50);
    // Its own colour, not the payer's: the bar and the dots must tell them apart.
    const colorFor = table.props("colorFor") as (key: string) => string;
    expect(new Set(["payer", "child", "gone"].map(colorFor)).size).toBe(3);
  });
});

describe("UsageOverview Cost by Org while costs load", () => {
  beforeEach(() => {
    route.query = {};
    search.mockReset().mockResolvedValue([]);
  });

  it("shows placeholders, not the retention row as the whole bill", async () => {
    const wrapper = mount(UsageOverview, {
      props: {
        details: mockMeteringResponse().upcoming,
        billingOrgs,
        lastLoadedAt: 1,
        projected: null,
        refreshing: false,
        orgCosts: { costs: {}, loading: true, failed: false },
      },
      global: {
        plugins: [i18n, store],
        stubs: { UsageCachedChart: true, UsageMeterBreakdown: true, UsageBillStrip: true },
      },
    });
    await flushPromises();

    // No org has a cost yet, so the bar would read "Data Retention 100%" and the total its $0.58.
    expect(wrapper.findComponent({ name: "UsageBillStrip" }).exists()).toBe(false);
    expect(wrapper.find('[data-test="billings-usageoverview-strip-loading"]').exists()).toBe(true);
    const table = wrapper.findComponent('[data-test="billings-usageoverview-org-table"]');
    expect(table.props("rows")).toEqual([]);
    const footer = wrapper.find('[data-test="billings-usagemetertable-total"]');
    expect(footer.text()).not.toContain("$");
    expect(footer.text()).toContain("—");
  });
});

describe("UsageOverview meter drilldown chart", () => {
  beforeEach(() => {
    route.query = { meter: "ingestion" };
    store.state.organizationData.organizationSettings.usage_stream_enabled = true;
  });

  const mountMeter = () =>
    mount(UsageOverview, {
      props: {
        details: mockMeteringResponse().upcoming,
        lastLoadedAt: 1,
        projected: null,
        refreshing: false,
      },
      global: {
        plugins: [i18n, store],
        stubs: { UsageCachedChart: true, UsageMeterBreakdown: true, UsageBillStrip: true },
      },
    });

  it("starts the chart once the groupings are known, without waiting for the table's ranking", async () => {
    const wrapper = mountMeter();
    await flushPromises();
    expect(wrapper.find('[data-test="billings-usageoverview-daily-pending"]').exists()).toBe(true);

    const [byStream] = DRILLDOWNS.ingestion!;
    wrapper
      .findComponent({ name: "UsageMeterBreakdown" })
      .vm.$emit("sections", { sections: [byStream], unavailable: [], activeId: byStream.id });
    await flushPromises();

    // No top names have arrived, yet the chart is already running its own query.
    const chart = wrapper.findComponent({ name: "UsageCachedChart" });
    expect(chart.exists()).toBe(true);
    const schema = chart.props("panelSchema") as any;
    expect(schema.queries[0].query).toContain('stream_name as "breakdown_1"');
    expect(schema.config.top_results).toBe(5);

    // The table's ranking then recolours the bands in place, with the same query.
    wrapper
      .findComponent({ name: "UsageMeterBreakdown" })
      .vm.$emit("top-names", { section: byStream, names: ["app"] });
    await flushPromises();
    const recoloured = wrapper
      .findComponent({ name: "UsageCachedChart" })
      .props("panelSchema") as any;
    expect(recoloured.queries[0].query).toBe(schema.queries[0].query);
    expect(recoloured.config.color.colorBySeries.map((entry: any) => entry.value)).toContain("app");
  });
});

describe("UsageOverview for an org with no bill", () => {
  const DAY = 86_400;
  const end = Math.floor(Date.now() / 1000);
  const start = end - 29 * DAY;
  // 2 GB ingested, 4 GB scanned and 7 AI credits over the window; nothing priced.
  const usage = volumeDetails({ Ingestion: 2048, Search: 4096, AiCredits: 7 }, start, end);

  const mountOverview = (props: Record<string, unknown>) =>
    mount(UsageOverview, {
      props: { lastLoadedAt: 1, projected: null, refreshing: false, ...props },
      global: {
        plugins: [i18n, store],
        stubs: { UsageCachedChart: true, UsageMeterBreakdown: true, UsageBillStrip: true },
      },
    });

  beforeEach(() => {
    route.query = {};
    store.state.organizationData.organizationSettings.usage_stream_enabled = true;
  });

  it("shows each meter's volume on the same screen, with no money anywhere", async () => {
    const wrapper = mountOverview({ details: usage, volumeOnly: true });
    await flushPromises();

    expect(wrapper.text()).not.toContain("$");
    expect(wrapper.find('[data-test="billings-usageoverview-cycle"]').text()).toContain(
      "Last 30 days",
    );
    const cards = wrapper.findAll('[data-test^="billings-usageoverview-kpi-"]');
    expect(cards.map((card) => card.attributes("data-test"))).toEqual([
      "billings-usageoverview-kpi-ingestion",
      "billings-usageoverview-kpi-query",
      "billings-usageoverview-kpi-pipeline",
      "billings-usageoverview-kpi-ai",
    ]);
    expect(cards[0].text()).toContain("2.00 GB");
    expect(cards[3].text()).toContain("7");
    // A share across GB and credit counts means nothing, so there is no bill strip.
    expect(wrapper.findComponent({ name: "UsageBillStrip" }).exists()).toBe(false);

    const table = wrapper.findComponent({ name: "UsageMeterTable" });
    expect(table.props("volumeOnly")).toBe(true);
    expect((table.props("rows") as { key: string }[]).map((row) => row.key)).not.toContain(
      "retention",
    );
    const pane = wrapper.find('[data-test="billings-usageoverview-daily-pane"]');
    expect(pane.text()).toContain("Daily Volume");
    const schema = wrapper.findComponent({ name: "UsageCachedChart" }).props("panelSchema") as any;
    expect(schema.config.unit).toBe("megabytes");
    expect(schema.queries[0].query).toContain('sum(size) as "y_axis_1"');
  });

  it("offers to turn usage reporting on while it is off", async () => {
    store.state.organizationData.organizationSettings.usage_stream_enabled = false;
    const wrapper = mountOverview({ details: null, volumeOnly: true });
    await flushPromises();

    const prompt = wrapper.findComponent('[data-test="billings-usageoverview-enable"]');
    expect(prompt.exists()).toBe(true);
    prompt.vm.$emit("action");
    await flushPromises();
    expect(wrapper.findComponent({ name: "ConfirmDialog" }).props("modelValue")).toBe(true);
  });

  it("leaves a Stripe-billed org's Overview as the bill", async () => {
    const wrapper = mountOverview({ details: mockMeteringResponse().upcoming });
    await flushPromises();

    expect(wrapper.find('[data-test="billings-usageoverview-kpi-so-far"]').exists()).toBe(true);
    expect(wrapper.findComponent({ name: "UsageBillStrip" }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: "UsageMeterTable" }).props("volumeOnly")).toBe(false);
    const pane = wrapper.find('[data-test="billings-usageoverview-daily-pane"]');
    expect(pane.text()).toContain("Daily Cost");
    const schema = wrapper.findComponent({ name: "UsageCachedChart" }).props("panelSchema") as any;
    expect(schema.config.unit).toBe("currency");
  });
});

describe("UsageOverview discount card", () => {
  beforeEach(() => {
    route.query = {};
  });

  const mountWith = (details: unknown) =>
    mount(UsageOverview, {
      props: { details, lastLoadedAt: 1, projected: null, refreshing: false },
      global: {
        plugins: [i18n, store],
        stubs: { UsageCachedChart: true, UsageMeterBreakdown: true, UsageBillStrip: true },
      },
    });

  it("shows the discount, its share of the subtotal and the discounted meters", async () => {
    const details = mockMeteringResponse().upcoming!;
    const wrapper = mountWith(details);
    await flushPromises();
    const card = wrapper.find('[data-test="billings-usageoverview-kpi-discount"]');
    const subtotal = subtotalCost(details);
    expect(card.text()).toContain(String(formatCost(-details.total_discounted_amount)));
    expect(card.text()).toContain(
      `${((details.total_discounted_amount / subtotal) * 100).toFixed(1)}%`,
    );
    expect(card.text()).toContain("Ingestion");
  });

  it("has no discount card when nothing was discounted", async () => {
    const wrapper = mountWith({ ...mockMeteringResponse().upcoming!, total_discounted_amount: 0 });
    await flushPromises();
    expect(wrapper.find('[data-test="billings-usageoverview-kpi-discount"]').exists()).toBe(false);
  });
});

describe("UsageOverview daily chart window", () => {
  beforeEach(() => {
    route.query = {};
    store.state.organizationData.organizationSettings.usage_stream_enabled = true;
  });

  it("opens at 00:00 UTC of the cycle's first day, so that day's bar shows, and counts from the cycle start", async () => {
    // The mock cycle starts partway through a day, as Stripe cycles do.
    const details = mockMeteringResponse().upcoming!;
    expect(details.cycle_start % 86_400).not.toBe(0);
    const wrapper = mount(UsageOverview, {
      props: { details, lastLoadedAt: 1, projected: null, refreshing: false },
      global: {
        plugins: [i18n, store],
        stubs: { UsageCachedChart: true, UsageMeterBreakdown: true, UsageBillStrip: true },
      },
    });
    await flushPromises();

    const chart = wrapper.findComponent({ name: "UsageCachedChart" });
    const window = chart.props("selectedTimeObj") as { start_time: Date };
    // Microseconds in a Date, as the dashboard renderer reads it.
    expect(window.start_time.getTime()).toBe(
      Math.floor(details.cycle_start / 86_400) * 86_400 * 1_000_000,
    );
    const sql = (chart.props("panelSchema") as any).queries[0].query as string;
    expect(sql).toContain(`_timestamp >= ${details.cycle_start * 1_000_000}`);
  });
});
