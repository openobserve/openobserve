import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import AppTabs from "@/components/common/AppTabs.vue";

installQuasar();

describe("AppTabs", () => {
  let wrapper: any = null;

  const mockTabs = [
    { label: "Tab 1", value: "tab1" },
    { label: "Tab 2", value: "tab2" },
    { label: "Tab 3", value: "tab3", disabled: true },
    { label: "Hidden Tab", value: "tab4", hide: true },
    { label: "Styled Tab", value: "tab5", style: { color: "red" }, title: "Custom Title" }
  ];

  beforeEach(() => {
    wrapper = mount(AppTabs, {
      props: {
        tabs: mockTabs,
        activeTab: "tab1"
      }
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it("should mount AppTabs component", () => {
    expect(wrapper).toBeTruthy();
  });

  it("should render all non-hidden tabs", () => {
    const tabs = wrapper.findAll('.o2-tab');
    expect(tabs).toHaveLength(5);
  });

  it("should display tab labels correctly", () => {
    expect(wrapper.text()).toContain("Tab 1");
    expect(wrapper.text()).toContain("Tab 2");
    expect(wrapper.text()).toContain("Tab 3");
  });

  it("should highlight active tab", () => {
    const activeTab = wrapper.find('[data-test="tab-tab1"]');
    expect(activeTab.classes()).toContain("active");
    expect(activeTab.classes()).toContain("text-primary");
  });

  it("should emit update:activeTab when non-disabled tab is clicked", async () => {
    const tab2 = wrapper.find('[data-test="tab-tab2"]');
    await tab2.trigger("click");
    
    expect(wrapper.emitted("update:activeTab")).toHaveLength(1);
    expect(wrapper.emitted("update:activeTab")[0]).toEqual(["tab2"]);
  });

  it("should not emit when disabled tab is clicked", async () => {
    const disabledTab = wrapper.find('[data-test="tab-tab3"]');
    await disabledTab.trigger("click");
    
    expect(wrapper.emitted("update:activeTab")).toBeFalsy();
  });

  it("should not emit when hidden tab is clicked", async () => {
    const hiddenTab = wrapper.find('[data-test="tab-tab4"]');
    await hiddenTab.trigger("click");
    
    expect(wrapper.emitted("update:activeTab")).toBeFalsy();
  });

  it("should apply disabled class to disabled tabs", () => {
    const disabledTab = wrapper.find('[data-test="tab-tab3"]');
    expect(disabledTab.classes()).toContain("disabled");
  });

  it("should apply hidden class to hidden tabs", () => {
    const hiddenTab = wrapper.find('[data-test="tab-tab4"]');
    expect(hiddenTab.classes()).toContain("hidden");
  });

  it("should apply custom styles when provided", () => {
    const styledTab = wrapper.find('[data-test="tab-tab5"]');
    expect(styledTab.attributes("style")).toContain("color: red");
  });

  it("should use custom title or fallback to label", () => {
    const styledTab = wrapper.find('[data-test="tab-tab5"]');
    expect(styledTab.attributes("title")).toBe("Custom Title");
    
    const normalTab = wrapper.find('[data-test="tab-tab1"]');
    expect(normalTab.attributes("title")).toBe("Tab 1");
  });

  it("should not render when show prop is false", () => {
    const hiddenWrapper = mount(AppTabs, {
      props: {
        tabs: mockTabs,
        activeTab: "tab1",
        show: false
      }
    });
    
    expect(hiddenWrapper.find('.o2-tabs').exists()).toBe(false);
    hiddenWrapper.unmount();
  });

  it("should render when show prop is true (default)", () => {
    expect(wrapper.find('.o2-tabs').exists()).toBe(true);
  });

  it("should handle changeTab function correctly", () => {
    const vm = wrapper.vm as any;
    
    // Test normal tab
    vm.changeTab({ label: "Test", value: "test" });
    expect(wrapper.emitted("update:activeTab")).toHaveLength(1);
    
    // Test disabled tab (should not emit)
    vm.changeTab({ label: "Test", value: "test", disabled: true });
    expect(wrapper.emitted("update:activeTab")).toHaveLength(1); // Still 1
    
    // Test hidden tab (should not emit)
    vm.changeTab({ label: "Test", value: "test", hide: true });
    expect(wrapper.emitted("update:activeTab")).toHaveLength(1); // Still 1
  });
});