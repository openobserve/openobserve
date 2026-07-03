import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import UsageAnalytics from "./UsageAnalytics.vue";

vi.mock("@/services/search", () => ({
  default: { search: vi.fn().mockResolvedValue({ data: { hits: [] } }) },
}));
vi.mock("@/aws-exports", () => ({ default: { isCloud: "true" } }));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
});

function makeStore(enabled: boolean) {
  return createStore({
    state: {
      selectedOrganization: { identifier: "org1" },
      organizationData: { organizationSettings: { usage_stream_enabled: enabled } },
    },
  });
}

describe("UsageAnalytics.vue", () => {
  it("shows the enable CTA when the setting is off", async () => {
    const wrapper = mount(UsageAnalytics, {
      props: { canAdmin: true },
      global: { plugins: [makeStore(false), i18n] },
    });
    await flushPromises();
    expect(wrapper.find('[data-test="usage-analytics-enable"]').exists()).toBe(true);
  });

  it("shows the no-access message when not an admin", async () => {
    const wrapper = mount(UsageAnalytics, {
      props: { canAdmin: false },
      global: { plugins: [makeStore(true), i18n] },
    });
    await flushPromises();
    expect(wrapper.find('[data-test="usage-analytics-no-access"]').exists()).toBe(true);
  });

  it("shows the warming state when enabled but no data", async () => {
    const wrapper = mount(UsageAnalytics, {
      props: { canAdmin: true },
      global: { plugins: [makeStore(true), i18n] },
    });
    await flushPromises();
    expect(wrapper.find('[data-test="usage-analytics-warming"]').exists()).toBe(true);
  });

  it("renders the date picker in the live state", async () => {
    const SearchService = (await import("@/services/search")).default as any;
    SearchService.search.mockResolvedValue({
      data: { hits: [{ total_mb: 100, stream_name: "s", records: 1, days: 1, day: "2026-7-1" }] },
    });
    const wrapper = mount(UsageAnalytics, {
      props: { canAdmin: true },
      global: {
        plugins: [makeStore(true), i18n],
        stubs: { DateTimePicker: { template: '<div data-test="usage-analytics-date-picker" />' } },
      },
    });
    await flushPromises();
    expect(wrapper.find('[data-test="usage-analytics-date-picker"]').exists()).toBe(true);
  });

  it("returns an unwrapped ECharts option object (series at top level) for trendChart", async () => {
    const SearchService = (await import("@/services/search")).default as any;
    SearchService.search.mockResolvedValue({
      data: { hits: [{ total_mb: 100, stream_name: "s", records: 1, days: 1, day: "2026-7-1" }] },
    });
    const wrapper = mount(UsageAnalytics, {
      props: { canAdmin: true },
      global: {
        plugins: [makeStore(true), i18n],
        stubs: { DateTimePicker: { template: '<div data-test="usage-analytics-date-picker" />' } },
      },
    });
    await flushPromises();
    // Regression guard: CustomChartRenderer calls chart.setOption(props.data) directly,
    // so trendChart must expose `series` at the top level, not nested under `.options`.
    expect((wrapper.vm as any).trendChart.series).toBeDefined();
    expect((wrapper.vm as any).trendChart.options).toBeUndefined();
  });
});
