import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import UsageAnalytics from "./UsageAnalytics.vue";

vi.mock("@/services/search", () => ({
  default: { search: vi.fn().mockResolvedValue({ data: { hits: [] } }) },
}));
vi.mock("@/aws-exports", () => ({ default: { isCloud: "true" } }));

const i18n = {
  install(app: any) {
    app.config.globalProperties.$t = (k: string) => k;
  },
};

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
      global: { plugins: [makeStore(false), i18n], mocks: { $t: (k: string) => k } },
    });
    await flushPromises();
    expect(wrapper.find('[data-test="usage-analytics-enable"]').exists()).toBe(true);
  });

  it("shows the no-access message when not an admin", async () => {
    const wrapper = mount(UsageAnalytics, {
      props: { canAdmin: false },
      global: { plugins: [makeStore(true), i18n], mocks: { $t: (k: string) => k } },
    });
    await flushPromises();
    expect(wrapper.find('[data-test="usage-analytics-no-access"]').exists()).toBe(true);
  });

  it("shows the warming state when enabled but no data", async () => {
    const wrapper = mount(UsageAnalytics, {
      props: { canAdmin: true },
      global: { plugins: [makeStore(true), i18n], mocks: { $t: (k: string) => k } },
    });
    await flushPromises();
    expect(wrapper.find('[data-test="usage-analytics-warming"]').exists()).toBe(true);
  });
});
