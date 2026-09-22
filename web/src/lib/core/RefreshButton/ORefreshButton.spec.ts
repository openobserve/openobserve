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

// OTooltip is stubbed so the forwarded shortcut id can be asserted without mounting reka-ui.
const stubs = {
  OButton: { template: '<button v-bind="$attrs"><slot /></button>' },
  OTooltip: {
    props: ["content", "shortcutId"],
    template: '<span data-stub-tooltip :data-shortcut="shortcutId">{{ content }}</span>',
  },
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

  // --- layout="inline" ---

  describe("layout=inline", () => {
    const inline = (props: Record<string, unknown> = {}) =>
      mount(ORefreshButton, {
        props: { layout: "inline", ...props },
        global: globalConfig,
      });

    it("renders no staleness dot", () => {
      const wrapper = inline({ lastRunAt: Date.now() - 5_000 });
      expect(wrapper.find(".rounded-full").exists()).toBe(false);
    });

    it("puts the age inside the button with a divider and a reserved width", () => {
      const wrapper = inline({ lastRunAt: Date.now() - 10_000 });
      const button = wrapper.find("button");
      expect(button.find("span.w-px").exists()).toBe(true);
      const age = button.find("span.tabular-nums");
      expect(age.exists()).toBe(true);
      expect(age.classes()).toContain("min-w-12");
      expect(age.text()).toBe("10s ago");
    });

    it("renders neither divider nor age when lastRunAt is null", () => {
      const wrapper = inline({ lastRunAt: null });
      expect(wrapper.find("button").exists()).toBe(true);
      expect(wrapper.find("span.w-px").exists()).toBe(false);
      expect(wrapper.find("span.tabular-nums").exists()).toBe(false);
    });

    it("treats a zero timestamp as never fetched", () => {
      const wrapper = inline({ lastRunAt: 0 });
      expect(wrapper.find("span.tabular-nums").exists()).toBe(false);
      expect(wrapper.find("[data-stub-tooltip]").text()).toBe("Not yet refreshed");
    });

    it("forwards dataTest onto the button", () => {
      const wrapper = inline({ dataTest: "pipeline-list-refresh-btn" });
      expect(wrapper.find('[data-test="pipeline-list-refresh-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="refresh-button"]').exists()).toBe(false);
    });

    it("forwards shortcutId and the exact time to the tooltip", () => {
      const ts = Date.now() - 3_000;
      const wrapper = inline({ lastRunAt: ts, shortcutId: "pipelinesRefresh" });
      const tip = wrapper.find("[data-stub-tooltip]");
      expect(tip.attributes("data-shortcut")).toBe("pipelinesRefresh");
      expect(tip.text()).toBe(`Last refreshed: ${new Date(ts).toLocaleTimeString()}`);
    });

    it("emits click, and not while loading", async () => {
      const live = inline({ dataTest: "x-refresh" });
      await live.find('[data-test="x-refresh"]').trigger("click");
      expect(live.emitted("click")).toHaveLength(1);

      const busy = inline({ dataTest: "x-refresh", loading: true });
      await busy.find('[data-test="x-refresh"]').trigger("click");
      expect(busy.emitted("click")).toBeUndefined();
    });
  });
});
