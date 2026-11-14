import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import enLocale from "@/locales/languages/en-US.json";
import ORefreshButton from "./ORefreshButton.vue";
import { AUTO_REFRESH_INTERVALS } from "./ORefreshButton.types";
import { raw } from "@/types/i18n";

const i18n = createI18n({ locale: "en", legacy: false, messages: { en: enLocale } });

// OTooltip and ODropdown are stubbed so the content and the menu render inline without reka-ui.
const stubs = {
  OTooltip: {
    props: ["content", "shortcut"],
    template: '<span data-stub-tooltip :data-shortcut="shortcut">{{ content }}</span>',
  },
  ODropdown: { template: "<div data-stub-dropdown><slot name='trigger' /><slot /></div>" },
  ODropdownGroup: { props: ["label"], template: "<div :data-label='label'><slot /></div>" },
  ODropdownItem: {
    emits: ["select"],
    props: ["checked"],
    template:
      "<div role='menuitem' :aria-checked='checked' @click=\"$emit('select')\"><slot /><slot name='end' /></div>",
  },
};
const global = { stubs, plugins: [i18n] };
const now = Date.UTC(2026, 10, 1, 5, 12, 7);

const mountButton = (props: Record<string, unknown> = {}) =>
  mount(ORefreshButton, { props, global });
const button = (wrapper: ReturnType<typeof mountButton>) =>
  wrapper.get('[data-test="refresh-button"]');

describe("ORefreshButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });
  afterEach(() => vi.useRealTimers());

  it("is one secondary md button with the refresh glyph", () => {
    const wrapper = mountButton();
    expect(button(wrapper).attributes("data-o2-variant")).toBe("secondary");
    expect(button(wrapper).classes()).toContain("h-control-md");
    expect(button(wrapper).attributes("aria-label")).toBe("Refresh");
  });

  it("sits at sm in a panel header", () => {
    expect(button(mountButton({ size: "sm" })).classes()).toContain("h-control-sm");
  });

  it("shows the data age, hidden below 1024px, and names the button with it", () => {
    const wrapper = mountButton({ lastRunAt: now - 120_000 });
    const age = wrapper.get('[data-test="refresh-button-age"]');
    expect(age.text()).toBe("2m ago");
    expect(age.classes()).toContain("max-lg:hidden");
    expect(age.classes()).toContain("tabular-nums");
    expect(button(wrapper).attributes("aria-label")).toBe("Refresh, last refreshed 2m ago");
  });

  it("renders no age before the first run", () => {
    const wrapper = mountButton();
    expect(wrapper.find('[data-test="refresh-button-age"]').exists()).toBe(false);
    expect(wrapper.get("[data-stub-tooltip]").text()).toBe("Not yet refreshed");
  });

  it("re-evaluates the age as time passes", async () => {
    const wrapper = mountButton({ lastRunAt: now - 1_000 });
    expect(wrapper.get('[data-test="refresh-button-age"]').text()).toBe("just now");
    vi.advanceTimersByTime(60_000);
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="refresh-button-age"]').text()).toBe("1m ago");
  });

  it("puts the absolute time and the page's shortcut in the tooltip", () => {
    const wrapper = mountButton({ lastRunAt: now - 5_000, shortcut: "alertsRefresh" });
    const tooltip = wrapper.get("[data-stub-tooltip]");
    expect(tooltip.text()).toContain("Last refreshed:");
    expect(tooltip.attributes("data-shortcut")).toBe("alertsRefresh");
  });

  it("shows a passed tooltip instead of the last-refreshed time", () => {
    const wrapper = mountButton({ lastRunAt: now, tooltip: raw("Data as of 10:00") });
    expect(wrapper.get("[data-stub-tooltip]").text()).toBe("Data as of 10:00");
  });

  it("swaps the glyph for a spinner while refreshing, keeps focusable and ignores clicks", async () => {
    const wrapper = mountButton({ lastRunAt: now - 5_000, loading: true });
    expect(wrapper.find('[data-test="refresh-button-spinner"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="refresh-button-age"]').text()).toBe("Refreshing");
    expect(button(wrapper).attributes("aria-busy")).toBe("true");
    expect(button(wrapper).attributes("disabled")).toBeUndefined();
    await button(wrapper).trigger("click");
    expect(wrapper.emitted("click")).toBeUndefined();
  });

  it("emits click, and not while disabled", async () => {
    const wrapper = mountButton();
    await button(wrapper).trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
    const disabled = mountButton({ disabled: true });
    await button(disabled).trigger("click");
    expect(disabled.emitted("click")).toBeUndefined();
  });

  it("turns the same button into Retry with a warn dot and Failed after a failed refresh", () => {
    const wrapper = mountButton({ lastRunAt: now - 60_000, failedAt: now, timeZone: "UTC" });
    expect(button(wrapper).attributes("data-state")).toBe("failed");
    expect(button(wrapper).attributes("aria-label")).toBe("Retry");
    expect(wrapper.find(".bg-warning-500").exists()).toBe(true);
    expect(wrapper.get('[data-test="refresh-button-failed"]').text()).toBe("Failed");
    expect(wrapper.get("[data-stub-tooltip]").text()).toContain("Refresh failed at");
    const described = button(wrapper).attributes("aria-describedby");
    expect(wrapper.get(`[id="${described}"]`).text()).toContain("Refresh failed at");
  });

  describe("auto-refresh menu", () => {
    it("hides the menu segment when autoRefresh is omitted", () => {
      expect(mountButton().find('[data-test="refresh-button-auto-menu"]').exists()).toBe(false);
    });

    it("offers Off and the five intervals, ticking the current one", () => {
      const wrapper = mountButton({ autoRefresh: "30s" });
      const items = wrapper.findAll("[role='menuitem']");
      expect(items.map((item) => item.text())).toEqual([
        "Off",
        "Every 10 s",
        "Every 30 s",
        "Every 1 min",
        "Every 5 min",
        "Every 15 min",
      ]);
      expect(items.map((item) => item.attributes("aria-checked"))).toEqual([
        "false",
        "false",
        "true",
        "false",
        "false",
        "false",
      ]);
      expect(items).toHaveLength(AUTO_REFRESH_INTERVALS.length);
    });

    it("emits the chosen interval", async () => {
      const wrapper = mountButton({ autoRefresh: "off" });
      await wrapper.findAll("[role='menuitem']")[3].trigger("click");
      expect(wrapper.emitted("update:autoRefresh")?.[0]).toEqual(["1m"]);
    });

    it("labels the button Auto with the interval while auto-refresh is on", () => {
      const wrapper = mountButton({ autoRefresh: "30s", lastRunAt: now });
      expect(wrapper.get('[data-test="refresh-button-auto"]').text()).toBe("Auto · 30 s");
      expect(wrapper.find('[data-test="refresh-button-age"]').exists()).toBe(false);
    });
  });
});
