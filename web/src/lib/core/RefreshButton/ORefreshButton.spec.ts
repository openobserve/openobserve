import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import enLocale from "@/locales/languages/en-US.json";
import ORefreshButton from "./ORefreshButton.vue";

// The component calls useI18n() in setup, so an i18n instance must be installed
// or vue-i18n throws "Need to install with app.use function". Source the real
// en.json so refreshButton.* labels resolve as they do in the app.
const i18n = createI18n({
  locale: "en",
  legacy: false,
  messages: { en: enLocale },
});

// Stub OButton to avoid rendering its internals
const stubs = {
  OButton: { template: '<button v-bind="$attrs"><slot /></button>' },
};

const globalConfig = { stubs, plugins: [i18n] };

describe("ORefreshButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // --- Default rendering ---

  it("renders the refresh button", () => {
    const wrapper = mount(ORefreshButton, { global: globalConfig });
    expect(wrapper.find('[data-test="refresh-button"]').exists()).toBe(true);
  });

  it("does not render a timestamp span when lastRunAt is not provided", () => {
    const wrapper = mount(ORefreshButton, { global: globalConfig });
    expect(wrapper.find("span.tabular-nums").exists()).toBe(false);
  });

  it("renders a timestamp span when lastRunAt is provided", () => {
    const ts = Date.now() - 10_000;
    const wrapper = mount(ORefreshButton, {
      props: { lastRunAt: ts },
      global: globalConfig,
    });
    expect(wrapper.find("span.tabular-nums").exists()).toBe(true);
  });

  // --- dot color classes ---

  it("uses idle dot color when no lastRunAt", () => {
    const wrapper = mount(ORefreshButton, { global: globalConfig });
    const dot = wrapper.find(".rounded-full");
    expect(dot.classes()).toContain("bg-refresh-dot-idle");
  });

  it("uses fresh dot color when lastRunAt < 30s ago", () => {
    const wrapper = mount(ORefreshButton, {
      props: { lastRunAt: Date.now() - 5_000 },
      global: globalConfig,
    });
    const dot = wrapper.find(".rounded-full");
    expect(dot.classes()).toContain("bg-refresh-dot-fresh");
  });

  it("uses stale dot color when lastRunAt is 30s–5min ago", () => {
    const wrapper = mount(ORefreshButton, {
      props: { lastRunAt: Date.now() - 60_000 },
      global: globalConfig,
    });
    const dot = wrapper.find(".rounded-full");
    expect(dot.classes()).toContain("bg-refresh-dot-stale");
  });

  it("uses critical dot color when lastRunAt > 5min ago", () => {
    const wrapper = mount(ORefreshButton, {
      props: { lastRunAt: Date.now() - 400_000 },
      global: globalConfig,
    });
    const dot = wrapper.find(".rounded-full");
    expect(dot.classes()).toContain("bg-refresh-dot-critical");
  });

  it("uses idle dot color when loading=true regardless of lastRunAt", () => {
    const wrapper = mount(ORefreshButton, {
      props: { lastRunAt: Date.now() - 5_000, loading: true },
      global: globalConfig,
    });
    const dot = wrapper.find(".rounded-full");
    expect(dot.classes()).toContain("bg-refresh-dot-idle");
  });

  // --- emits ---

  it("emits click when button is clicked", async () => {
    const wrapper = mount(ORefreshButton, { global: globalConfig });
    await wrapper.find('[data-test="refresh-button"]').trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
  });

  it("does not emit click when loading=true", async () => {
    const wrapper = mount(ORefreshButton, {
      props: { loading: true },
      global: globalConfig,
    });
    await wrapper.find('[data-test="refresh-button"]').trigger("click");
    expect(wrapper.emitted("click")).toBeUndefined();
  });

  it("does not emit click when disabled=true", async () => {
    const wrapper = mount(ORefreshButton, {
      props: { disabled: true },
      global: globalConfig,
    });
    await wrapper.find('[data-test="refresh-button"]').trigger("click");
    expect(wrapper.emitted("click")).toBeUndefined();
  });
});
