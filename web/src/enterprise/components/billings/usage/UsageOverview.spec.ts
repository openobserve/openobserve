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
        refreshing: false,
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

describe("UsageOverview meter drilldown chart", () => {
  beforeEach(() => {
    route.query = { meter: "ingestion" };
    store.state.organizationData.organizationSettings.usage_stream_enabled = true;
  });

  const mountMeter = () =>
    mount(UsageOverview, {
      props: { details: mockMeteringResponse().upcoming, lastLoadedAt: 1, refreshing: false },
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
