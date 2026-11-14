import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import enLocale from "@/locales/languages/en-US.json";
import { raw } from "@/types/i18n";
import OSplitButton from "./OSplitButton.vue";

const i18n = createI18n({ locale: "en", legacy: false, messages: { en: enLocale } });
const global = {
  plugins: [i18n],
  stubs: {
    OTooltip: true,
    ODropdown: { template: "<div data-menu><slot name='trigger' /><slot /></div>" },
  },
};

describe("OSplitButton", () => {
  const mountSplit = (props: Record<string, unknown> = {}) =>
    mount(OSplitButton, {
      props: { label: raw("Run query"), icon: "play-arrow", ...props },
      slots: { menu: "<div data-test='item'>Run and save</div>" },
      global,
    });

  it("is one action plus its menu segment at one height", () => {
    const wrapper = mountSplit({ variant: "primary" });
    const buttons = wrapper.findAll("[data-o2-btn]");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].text()).toBe("Run query");
    expect(
      buttons.every(
        (b) => b.classes().includes("h-control-md") || b.classes().includes("size-control-md"),
      ),
    ).toBe(true);
    expect(buttons[1].attributes("aria-label")).toBe("More options");
    expect(wrapper.find("[data-test='item']").exists()).toBe(true);
  });

  it("emits click from the action half only", async () => {
    const wrapper = mountSplit();
    await wrapper.findAll("[data-o2-btn]")[0].trigger("click");
    await wrapper.findAll("[data-o2-btn]")[1].trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
  });

  it("shows the stale dot on the action half", () => {
    const wrapper = mountSplit({ variant: "primary", stale: true });
    expect(wrapper.findAll("[data-o2-btn]")[0].find(".bg-warning-500").exists()).toBe(true);
    expect(wrapper.findAll("[data-o2-btn]")[1].find(".bg-warning-500").exists()).toBe(false);
  });

  it("names the menu half and sizes both halves together", () => {
    const wrapper = mountSplit({ size: "sm", menuLabel: raw("Export formats") });
    const [action, menu] = wrapper.findAll("[data-o2-btn]");
    expect(action.attributes("data-o2-size")).toBe("sm");
    expect(menu.attributes("data-o2-size")).toBe("sm");
    expect(menu.attributes("aria-label")).toBe("Export formats");
  });
});
