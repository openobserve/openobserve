import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import NoOrganizationSelected from "@/components/shared/grid/NoOrganizationSelected.vue";
import i18n from "@/locales";


vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => `/mocked/${path}`)
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
    expect(image.attributes('src')).toBe('/mocked/images/common/selectOrganization.svg');
  });

  it("should display no organization selected message", () => {
    const message = wrapper.find('.no-org-selected');
    expect(message.exists()).toBe(true);
    expect(message.text()).toBeTruthy();
  });

  it("should display select organization message", () => {
    const message = wrapper.find('.select-org-msg');
    expect(message.exists()).toBe(true);
    expect(message.text()).toBeTruthy();
  });

  it("should have correct component name", () => {
    expect(wrapper.vm.$options.name).toBe("QTableNoData");
  });

  it("should expose t function and getImageURL from setup", () => {
    expect(typeof wrapper.vm.t).toBe("function");
    expect(wrapper.vm.getImageURL).toBeDefined();
  });

  it("should have correct CSS classes", () => {
    expect(wrapper.classes()).toContain('tw:w-full');
    expect(wrapper.classes()).toContain('tw:flex');
    expect(wrapper.classes()).toContain('tw:flex-col');
    expect(wrapper.classes()).toContain('flex-center');
    expect(wrapper.classes()).toContain('tw:gap-2');
  });

  it("should have correct font size styling", () => {
    const style = wrapper.attributes('style');
    expect(style).toContain('font-size: 1.5rem');
  });

  it("should apply correct styling to no organization selected text", () => {
    const noOrgText = wrapper.find('.no-org-selected');
    expect(noOrgText.exists()).toBe(true);
  });

  it("should apply correct styling to select organization message", () => {
    const selectOrgMsg = wrapper.find('.select-org-msg');
    expect(selectOrgMsg.exists()).toBe(true);
  });
});