import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import enLocale from "@/locales/languages/en-US.json";
import ORefreshButton from "./ORefreshButton.vue";
import { AUTO_REFRESH_INTERVALS } from "@/utils/dashboard/autoRefresh";
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
  ODropdownSeparator: { template: "<hr />" },
  ODropdownItem: {
    emits: ["select"],
    props: ["checked", "disabled"],
    template:
      "<div role='menuitem' :aria-checked='checked' :aria-disabled='disabled' @click=\"$emit('select')\"><slot /><slot name='end' /></div>",
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

  it("says why it is disabled instead of its usual tooltip", () => {
    const wrapper = mountButton({ disabled: true, disabledReason: raw("Pick a stream first") });
    expect(button(wrapper).attributes("aria-disabled")).toBe("true");
    expect(wrapper.text()).toContain("Pick a stream first");
    expect(wrapper.text()).not.toContain("Not yet refreshed");
  });

  it("shows a pending label in place of the age and turns primary", () => {
    const wrapper = mountButton({ lastRunAt: now, pendingLabel: raw("Apply") });
    expect(button(wrapper).text()).toContain("Apply");
    expect(button(wrapper).attributes("aria-label")).toBe("Apply");
  });

  it("renders the menu slot under the intervals", () => {
    const wrapper = mount(ORefreshButton, {
      props: { autoRefresh: 0 },
      slots: { menu: "<div data-test='extra'>More</div>" },
      global,
    });
    expect(wrapper.find("[data-test='extra']").exists()).toBe(true);
  });

  it("is one bordered md button labelled Refresh before the first load", () => {
    const wrapper = mountButton();
    expect(button(wrapper).attributes("data-o2-variant")).toBe("secondary");
    expect(button(wrapper).classes()).toContain("h-control-md");
    expect(button(wrapper).attributes("aria-label")).toBe("Refresh");
    expect(wrapper.get('[data-test="refresh-button-age"]').text()).toBe("Refresh");
  });

  it("stays the same bordered button once it shows the data age", () => {
    const wrapper = mountButton({ lastRunAt: now - 2 * 60_000 });
    expect(button(wrapper).attributes("data-o2-variant")).toBe("secondary");
    expect(wrapper.get('[data-test="refresh-button-age"]').text()).toBe("2m ago");
  });

  it("reserves the widest steady label, so loading and the first age keep one width", () => {
    const sizers = mountButton()
      .get('[data-test="refresh-button-label"]')
      .findAll(".invisible")
      .map((s) => s.text());
    expect(sizers).toEqual(["Refreshing", "just now"]);
  });

  it("keeps the auto-refresh segment bordered like the button it joins", () => {
    const bare = mountButton({ autoRefresh: 0 });
    expect(bare.get('[data-test="refresh-button-auto-menu"]').attributes("data-o2-variant")).toBe(
      "secondary",
    );
  });

  it("sits at sm in a panel header", () => {
    expect(button(mountButton({ size: "sm" })).classes()).toContain("h-control-sm");
  });

  it("shows the data age, hidden below 1024px, and names the button with it", () => {
    const wrapper = mountButton({ lastRunAt: now - 120_000 });
    const age = wrapper.get('[data-test="refresh-button-age"]');
    expect(age.text()).toBe("2m ago");
    expect(wrapper.get('[data-test="refresh-button-label"]').classes()).toContain("max-lg:hidden");
    expect(age.classes()).toContain("tabular-nums");
    expect(button(wrapper).attributes("aria-label")).toBe("Refresh, last refreshed 2m ago");
  });

  it("says it has not refreshed yet before the first run", () => {
    const wrapper = mountButton();
    expect(wrapper.get("[data-stub-tooltip]").text()).toBe("Not yet refreshed");
  });

  it("reads Refreshing while the first load runs", () => {
    const wrapper = mountButton({ loading: true });
    expect(wrapper.get('[data-test="refresh-button-age"]').text()).toBe("Refreshing");
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

    it("offers Off and the app's intervals by default, ticking the current one", () => {
      const wrapper = mountButton({ autoRefresh: 30, minInterval: 0 });
      const items = wrapper.findAll("[role='menuitem']");
      expect(items.map((item) => item.text())).toEqual([
        "Off",
        "5 sec",
        "10 sec",
        "15 sec",
        "30 sec",
        "1 min",
        "5 min",
        "15 min",
        "30 min",
        "1 hr",
        "2 hr",
        "1 day",
      ]);
      expect(items).toHaveLength(AUTO_REFRESH_INTERVALS.length + 1);
      expect(wrapper.get('[data-test="refresh-button-auto-30"]').attributes("aria-checked")).toBe(
        "true",
      );
      expect(wrapper.get('[data-test="refresh-button-auto-0"]').attributes("aria-checked")).toBe(
        "false",
      );
    });

    it("takes a page's own interval list", () => {
      const wrapper = mountButton({ autoRefresh: 0, intervals: [60, 300], minInterval: 0 });
      expect(wrapper.findAll("[role='menuitem']").map((item) => item.text())).toEqual([
        "Off",
        "1 min",
        "5 min",
      ]);
    });

    it("disables intervals under the minimum and says why", () => {
      const wrapper = mountButton({ autoRefresh: 0, minInterval: 30 });
      expect(wrapper.get('[data-test="refresh-button-auto-15"]').attributes("aria-disabled")).toBe(
        "true",
      );
      expect(
        wrapper.get('[data-test="refresh-button-auto-30"]').attributes("aria-disabled"),
      ).not.toBe("true");
      expect(wrapper.get('[data-test="refresh-button-auto-note"]').text()).toContain("30 seconds");
    });

    it("defaults the minimum to the server's when the store publishes one", () => {
      const wrapper = mount(ORefreshButton, {
        props: { autoRefresh: 0 },
        global: {
          ...global,
          provide: { store: { state: { zoConfig: { min_auto_refresh_interval: 60 } } } },
        },
      });
      expect(wrapper.get('[data-test="refresh-button-auto-30"]').attributes("aria-disabled")).toBe(
        "true",
      );
      expect(
        wrapper.get('[data-test="refresh-button-auto-60"]').attributes("aria-disabled"),
      ).not.toBe("true");
    });

    it("shows the page's note under the intervals", () => {
      const wrapper = mountButton({ autoRefresh: 0, autoRefreshNote: raw("Relative ranges only") });
      expect(wrapper.get('[data-test="refresh-button-auto-note"]').text()).toBe(
        "Relative ranges only",
      );
    });

    it("emits the chosen interval in seconds", async () => {
      const wrapper = mountButton({ autoRefresh: 0, minInterval: 0 });
      await wrapper.get('[data-test="refresh-button-auto-60"]').trigger("click");
      expect(wrapper.emitted("update:autoRefresh")?.[0]).toEqual([60]);
    });

    it("labels the button Auto with the interval while auto-refresh is on", () => {
      const wrapper = mountButton({ autoRefresh: 30, lastRunAt: now });
      expect(wrapper.get('[data-test="refresh-button-auto"]').text()).toBe("Auto · 30s");
      expect(wrapper.find('[data-test="refresh-button-age"]').exists()).toBe(false);
    });
  });
});
