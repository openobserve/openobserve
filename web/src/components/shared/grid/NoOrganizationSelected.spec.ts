import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import NoOrganizationSelected from "@/components/shared/grid/NoOrganizationSelected.vue";
import i18n from "@/locales";

describe("NoOrganizationSelected", () => {
  let wrapper: any = null;

  beforeEach(() => {
    wrapper = mount(NoOrganizationSelected, {
      global: {
        plugins: [i18n],
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it("should mount NoOrganizationSelected component", () => {
    expect(wrapper).toBeTruthy();
  });

  it("renders one region empty state", () => {
    const state = wrapper.find('[data-test="no-organization-selected"]');
    expect(state.exists()).toBe(true);
    expect(state.attributes("data-o2-empty")).toBe("region");
  });

  it("should display no organization selected message", () => {
    const title = wrapper.find('[data-test="o2-empty-state-title"]');
    expect(title.text()).toBe(i18n.global.t("ticket.noOrganizationSelected"));
  });

  it("should display select organization message", () => {
    const text = wrapper.find('[data-test="o2-empty-state-text"]');
    expect(text.text()).toBe(i18n.global.t("ticket.selectOrganizationForQuota"));
  });

  it("should have correct component name", () => {
    expect(wrapper.vm.$options.name).toBe("NoOrganizationSelected");
  });
});
