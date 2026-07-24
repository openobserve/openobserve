import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import NoOrganizationSelected from "@/components/shared/grid/NoOrganizationSelected.vue";
import i18n from "@/locales";

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => `/mocked/${path}`),
}));

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

  it("should display the organization selection image", () => {
    const image = wrapper.find('[data-test="no-organization-selected-image"]');
    expect(image.exists()).toBe(true);
    expect(image.attributes("src")).toBe("/mocked/images/common/selectOrganization.svg");
  });

  it("should display no organization selected message", () => {
    const message = wrapper.find('[data-test="no-organization-selected-title"]');
    expect(message.exists()).toBe(true);
    expect(message.text()).toBe(i18n.global.t("ticket.noOrganizationSelected"));
  });

  it("should display select organization message", () => {
    const message = wrapper.find('[data-test="no-organization-selected-message"]');
    expect(message.exists()).toBe(true);
    expect(message.text()).toBe(i18n.global.t("ticket.selectOrganizationForQuota"));
  });

  it("should have correct component name", () => {
    expect(wrapper.vm.$options.name).toBe("QTableNoData");
  });

  it("should expose t function and getImageURL from setup", () => {
    expect(typeof wrapper.vm.t).toBe("function");
    expect(wrapper.vm.getImageURL).toBeDefined();
  });

  it("should have correct CSS classes", () => {
    expect(wrapper.classes()).toContain("w-full");
    expect(wrapper.classes()).toContain("flex");
    expect(wrapper.classes()).toContain("flex-col");
    expect(wrapper.classes()).toContain("items-center");
    expect(wrapper.classes()).toContain("justify-center");
    expect(wrapper.classes()).toContain("gap-2");
  });

  it("should have correct font size styling", () => {
    // Was inline `style="font-size: 1.5rem"`; now the `text-2xl` utility (1.5rem).
    expect(wrapper.classes()).toContain("text-2xl");
    expect(wrapper.attributes("style")).toBeUndefined();
  });

  it("should apply correct styling to no organization selected text", () => {
    const noOrgText = wrapper.find('[data-test="no-organization-selected-title"]');
    expect(noOrgText.exists()).toBe(true);
    expect(noOrgText.classes()).toContain("font-semibold");
  });

  it("should apply correct styling to select organization message", () => {
    const selectOrgMsg = wrapper.find('[data-test="no-organization-selected-message"]');
    expect(selectOrgMsg.exists()).toBe(true);
    expect(selectOrgMsg.classes()).toContain("font-normal");
  });
});
