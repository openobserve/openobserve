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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { mockMeteringResponse } from "./meteringMock";

const post = vi.fn();
const toast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...args: unknown[]) => toast(...args) }));
vi.mock("@/services/organizations", () => ({
  default: { post_organization_settings: (...args: unknown[]) => post(...args) },
}));
// A live route, so a query the page writes is what it reads back, as after a reload.
const nav = vi.hoisted(() => ({ route: null as unknown as { query: Record<string, unknown> } }));
const replace = vi.fn(({ query }: { query: Record<string, unknown> }) => {
  nav.route.query = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined));
});
vi.mock("vue-router", async () => {
  const { reactive } = await import("vue");
  nav.route = reactive({ query: {} });
  return { useRoute: () => nav.route, useRouter: () => ({ replace }) };
});
const search = vi.fn().mockResolvedValue([]);
vi.mock("./useUsageSearch", () => ({ useUsageSearch: () => ({ search }) }));

// The picker as Trends sees it: its ‹ switch, and the setter the page keeps its label in step with.
const setAbsoluteTime = vi.fn();
const DateTimeStub = defineComponent({
  name: "DateTime",
  props: { disablePrevShift: Boolean },
  emits: ["on:date-change"],
  setup: (_, { expose }) => {
    expose({ setAbsoluteTime });
    return () => h("div");
  },
});

const { default: UsageTrends } = await import("./UsageTrends.vue");

enableAutoUnmount(afterEach);

describe("UsageTrends usage reporting", () => {
  beforeEach(() => {
    post.mockReset().mockResolvedValue({ data: {} });
    // The page's copy of the settings, loaded earlier; another admin may have changed them since.
    store.state.organizationData.organizationSettings = {
      ...store.state.organizationData.organizationSettings,
      usage_stream_enabled: false,
      scrape_interval: 15,
      budget_config: [{ org_id: "o", total_budget_amount: 100 }],
    };
  });

  it("turns reporting on without writing back the page's older copy of the other settings", async () => {
    const upcoming = mockMeteringResponse().upcoming!;
    const wrapper = mount(UsageTrends, {
      props: { details: upcoming, cycles: [upcoming], billingOrgs: [], projected: null },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();

    wrapper.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:ok");
    await flushPromises();

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toEqual({ usage_stream_enabled: true });
    // The page still learns the new value straight away.
    expect(store.state.organizationData.organizationSettings.usage_stream_enabled).toBe(true);
    expect(store.state.organizationData.organizationSettings.scrape_interval).toBe(15);
  });
});

describe("UsageTrends usage reporting failure", () => {
  beforeEach(() => {
    toast.mockReset();
    store.state.organizationData.organizationSettings = {
      ...store.state.organizationData.organizationSettings,
      usage_stream_enabled: false,
    };
  });

  const turnOn = async () => {
    const upcoming = mockMeteringResponse().upcoming!;
    const wrapper = mount(UsageTrends, {
      props: { details: upcoming, cycles: [upcoming], billingOrgs: [], projected: null },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();
    wrapper.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:ok");
    await flushPromises();
  };

  it("shows the server's reason, not the request library's status text", async () => {
    post.mockReset().mockRejectedValue({
      message: "Request failed with status code 400",
      response: { data: { message: "usage reporting is not available on this plan" } },
    });
    await turnOn();
    expect(toast).toHaveBeenLastCalledWith(
      expect.objectContaining({
        variant: "error",
        message: "usage reporting is not available on this plan",
      }),
    );
  });

  it("falls back to its own words when the server gives no reason", async () => {
    post.mockReset().mockRejectedValue({ message: "Network Error" });
    await turnOn();
    expect(toast).toHaveBeenLastCalledWith(
      expect.objectContaining({ variant: "error", message: "Failed to enable usage reporting" }),
    );
  });
});

describe("UsageTrends cost and volume", () => {
  it("switches the chart to volume without asking the server again", async () => {
    store.state.organizationData.organizationSettings = {
      ...store.state.organizationData.organizationSettings,
      usage_stream_enabled: true,
    };
    const upcoming = mockMeteringResponse().upcoming!;
    const day = new Date(upcoming.cycle_start * 1000).toISOString().slice(0, 19);
    search.mockReset().mockResolvedValue([
      { x_axis_1: day, breakdown_1: "Ingestion", y_axis_1: 10, volume: 2048 },
      { x_axis_1: day, breakdown_1: "AiCredits", y_axis_1: 5, volume: 7 },
    ]);
    const wrapper = mount(UsageTrends, {
      props: { details: upcoming, cycles: [upcoming], billingOrgs: [], projected: null },
      global: {
        plugins: [i18n, store],
        stubs: { DateTime: DateTimeStub, AsyncComponentWrapper: true },
      },
    });
    await flushPromises();
    expect(search.mock.calls[0][0]).toContain('sum(size) as "volume"');
    // Retention is billed from a separate record Trends cannot read, so its totals say they leave it out.
    expect(wrapper.find('[data-test="billings-usagetrends-chart-pane"]').text()).toContain(
      "Excludes Data Retention",
    );

    const measure = wrapper
      .findAllComponents({ name: "OToggleGroup" })
      .find((group) => group.vm.$attrs["data-test"] === "billings-usagetrends-measure")!;
    measure.vm.$emit("update:modelValue", "volume");
    await flushPromises();

    const header = wrapper.find('[data-test="billings-usagetrends-chart-pane"]');
    expect(header.text()).toContain("Volume Over Time");
    // The forecast is money, so it has no place on a volume chart.
    expect(wrapper.find('[data-test="billings-usagetrends-forecast-toggle"]').exists()).toBe(false);
    // Volume came back with the cost rows, so switching sends nothing.
    expect(search).toHaveBeenCalledTimes(1);
  });
});

describe("UsageTrends range in the URL", () => {
  const upcoming = mockMeteringResponse().upcoming!;
  const DAY = 86_400;
  const from = (upcoming.cycle_start + DAY) * 1_000_000;
  const to = (upcoming.cycle_start + 3 * DAY) * 1_000_000;

  const mountTrends = () =>
    mount(UsageTrends, {
      props: { details: upcoming, cycles: [upcoming], billingOrgs: [], projected: null },
      global: {
        plugins: [i18n, store],
        stubs: { DateTime: DateTimeStub, AsyncComponentWrapper: true },
      },
    });

  const rangeToggle = (wrapper: ReturnType<typeof mountTrends>) =>
    wrapper
      .findAllComponents({ name: "OToggleGroup" })
      .find((group) => group.vm.$attrs["data-test"] === "billings-usagetrends-range")!;

  beforeEach(() => {
    store.state.organizationData.organizationSettings = {
      ...store.state.organizationData.organizationSettings,
      usage_stream_enabled: true,
    };
    search.mockReset().mockResolvedValue([]);
    nav.route.query = { tab: "trends" };
  });

  it("opens on the window a reloaded link carries", async () => {
    nav.route.query = { tab: "trends", from: String(from), to: String(to) };
    const wrapper = mountTrends();
    await flushPromises();

    expect(search.mock.calls[0][1]).toMatchObject({ start: from, end: to });
    expect(rangeToggle(wrapper).props("modelValue")).toBe("custom");
  });

  it("writes a picked window and a preset to the URL, keeping the rest of the query", async () => {
    const wrapper = mountTrends();
    await flushPromises();

    wrapper
      .findComponent({ name: "DateTime" })
      .vm.$emit("on:date-change", { startTime: from, endTime: to, userChangedValue: true });
    await flushPromises();
    expect(nav.route.query).toEqual({ tab: "trends", from: String(from), to: String(to) });
    expect(search.mock.lastCall![1]).toMatchObject({ start: from, end: to });

    rangeToggle(wrapper).vm.$emit("update:modelValue", "last90");
    await flushPromises();
    expect(nav.route.query).toEqual({ tab: "trends", range: "last90" });

    rangeToggle(wrapper).vm.$emit("update:modelValue", "current");
    await flushPromises();
    expect(nav.route.query).toEqual({ tab: "trends" });
  });

  it("turns ‹ off at the data start, and moves the picker back to it after a step past", async () => {
    // A picked window starting a day after the data, then ‹ steps it two days back.
    nav.route.query = { tab: "trends", from: String(from), to: String(to) };
    setAbsoluteTime.mockClear();
    const wrapper = mountTrends();
    await flushPromises();
    const picker = wrapper.findComponent({ name: "DateTime" });
    expect(picker.props("disablePrevShift")).toBe(false);

    const first = upcoming.cycle_start * 1_000_000;
    picker.vm.$emit("on:date-change", {
      startTime: first - 86_400_000_000,
      endTime: first + 86_400_000_000,
      userChangedValue: true,
    });
    await flushPromises();

    // The chart starts on the first day of data, the label says so, and ‹ goes no further.
    expect(search.mock.lastCall![1].start).toBe(first);
    expect(setAbsoluteTime).toHaveBeenLastCalledWith(first, expect.any(Number));
    expect(picker.props("disablePrevShift")).toBe(true);
  });

  it("leaves the chart alone when another part of the URL changes", async () => {
    nav.route.query = { tab: "trends", from: String(from), to: String(to) };
    mountTrends();
    await flushPromises();
    expect(search).toHaveBeenCalledTimes(1);

    nav.route.query = { ...nav.route.query, tab: "overview" };
    await flushPromises();
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("asks the server once on Refresh, and the reloaded bill does not replace that read with a cached one", async () => {
    const wrapper = mountTrends();
    await flushPromises();
    search.mockClear();

    wrapper.findComponent('[data-test="billings-usagetrends-refresh"]').vm.$emit("click");
    // The page reloads the bill: new objects, same cycle and prices.
    await wrapper.setProps({
      details: structuredClone(upcoming),
      cycles: [structuredClone(upcoming)],
    });
    await flushPromises();

    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][1]).not.toHaveProperty("refresh");
  });
});

describe("UsageTrends projected total", () => {
  it("shows the page's projection, with the recent pace named as such", async () => {
    store.state.organizationData.organizationSettings = {
      ...store.state.organizationData.organizationSettings,
      usage_stream_enabled: true,
    };
    const upcoming = mockMeteringResponse().upcoming!;
    const yesterday = new Date((Math.floor(Date.now() / 86_400_000) - 1) * 86_400_000);
    search
      .mockReset()
      .mockResolvedValue([
        { x_axis_1: yesterday.toISOString().slice(0, 19), breakdown_1: "Ingestion", y_axis_1: 70 },
      ]);
    nav.route.query = {};
    const wrapper = mount(UsageTrends, {
      props: { details: upcoming, cycles: [upcoming], billingOrgs: [], projected: 5000 },
      global: {
        plugins: [i18n, store],
        stubs: { DateTime: DateTimeStub, AsyncComponentWrapper: true },
      },
    });
    await flushPromises();

    const card = wrapper.find('[data-test="billings-usagetrends-kpi-projected"]').text();
    // The same figure Overview and Budget show, not a second projection.
    expect(card).toContain("$5,000.00");
    expect(card).toContain("at the last 7 days' pace");

    // Read from usage records, not the bill, so it does not take the bill's name.
    const total = wrapper.find('[data-test="billings-usagetrends-kpi-total"]').text();
    expect(total).toContain("Estimated Cost So Far");
  });

  it("names the cost an estimate on a cycle's first day, before there is a pace", async () => {
    const today = Math.floor(Date.now() / 86_400_000) * 86_400;
    const upcoming = { ...mockMeteringResponse().upcoming!, cycle_start: today };
    search.mockReset().mockResolvedValue([]);
    nav.route.query = {};
    const wrapper = mount(UsageTrends, {
      props: { details: upcoming, cycles: [upcoming], billingOrgs: [], projected: 5000 },
      global: {
        plugins: [i18n, store],
        stubs: { DateTime: DateTimeStub, AsyncComponentWrapper: true },
      },
    });
    await flushPromises();

    expect(wrapper.find('[data-test="billings-usagetrends-kpi-projected"]').exists()).toBe(false);
    const total = wrapper.find('[data-test="billings-usagetrends-kpi-total"]').text();
    expect(total).toContain("Estimated Cost So Far");
  });
});
