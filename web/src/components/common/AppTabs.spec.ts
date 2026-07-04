import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import AppTabs from "@/components/common/AppTabs.vue";


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
    const tabs = wrapper.findAll('[data-test^="tab-"]');
    expect(tabs).toHaveLength(4); // tab4 has hide: true, filtered by visibleTabs
  });

  it("should display tab labels correctly", () => {
    expect(wrapper.text()).toContain("Tab 1");
    expect(wrapper.text()).toContain("Tab 2");
    expect(wrapper.text()).toContain("Tab 3");
  });

  it("should highlight active tab", () => {
    // OToggleGroupItem forwards $attrs (including data-test) to the reka-ui
    // ToggleGroupItem which renders as a <button> — data-test is ON the button.
    const activeTabBtn = wrapper.find('[data-test="tab-tab1"]');
    expect(activeTabBtn.attributes("data-state")).toBe("on");
  });

  it("should emit update:activeTab when non-disabled tab is clicked", async () => {
    const tab2Btn = wrapper.find('[data-test="tab-tab2"]');
    await tab2Btn.trigger("click");

    expect(wrapper.emitted("update:activeTab")).toHaveLength(1);
    expect(wrapper.emitted("update:activeTab")[0]).toEqual(["tab2"]);
  });

  it("should not emit when disabled tab is clicked", async () => {
    const disabledTabBtn = wrapper.find('[data-test="tab-tab3"]');
    await disabledTabBtn.trigger("click");

    expect(wrapper.emitted("update:activeTab")).toBeFalsy();
  });

  it("should not emit when hidden tab is clicked", async () => {
    // Hidden tab is not rendered (filtered by visibleTabs computed)
    const hiddenTab = wrapper.find('[data-test="tab-tab4"]');
    expect(hiddenTab.exists()).toBe(false);
    expect(wrapper.emitted("update:activeTab")).toBeFalsy();
  });

  it("should apply disabled state to disabled tabs", () => {
    // reka-ui sets data-disabled on the button; data-test is also on the button.
    const disabledTabBtn = wrapper.find('[data-test="tab-tab3"]');
    expect(disabledTabBtn.attributes("data-disabled")).toBeDefined();
  });

  it("should apply hidden class to hidden tabs", () => {
    // Hidden tab is not rendered in DOM (filtered by visibleTabs computed)
    const hiddenTab = wrapper.find('[data-test="tab-tab4"]');
    expect(hiddenTab.exists()).toBe(false);
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

    expect(hiddenWrapper.find('[data-test^="tab-"]').exists()).toBe(false);
    hiddenWrapper.unmount();
  });

  it("should render when show prop is true (default)", () => {
    expect(wrapper.find('[data-test^="tab-"]').exists()).toBe(true);
  });

  it("should handle changeTab function correctly", async () => {
    const tab2Btn = wrapper.find('[data-test="tab-tab2"]');
    await tab2Btn.trigger("click");
    expect(wrapper.emitted("update:activeTab")).toHaveLength(1);

    // Disabled tab click should not add more emits
    const disabledTabBtn = wrapper.find('[data-test="tab-tab3"]');
    await disabledTabBtn.trigger("click");
    expect(wrapper.emitted("update:activeTab")).toHaveLength(1); // Still 1

    // Hidden tab is not in DOM
    expect(wrapper.find('[data-test="tab-tab4"]').exists()).toBe(false);
  });

  describe("dirty dot", () => {
    it("renders a dirty dot when tab.dirty is true", () => {
      const dirtyWrapper = mount(AppTabs, {
        props: {
          tabs: [
            { label: "Clean", value: "clean" },
            { label: "Dirty", value: "dirty", dirty: true },
          ],
          activeTab: "clean",
        },
      });

      expect(
        dirtyWrapper.find('[data-test="tab-dirty-dirty-dot"]').exists(),
      ).toBe(true);
      expect(
        dirtyWrapper.find('[data-test="tab-clean-dirty-dot"]').exists(),
      ).toBe(false);
      dirtyWrapper.unmount();
    });

    it("renders no dot when dirty is false or undefined (existing callers unaffected)", () => {
      // mockTabs has no `dirty` prop on any tab — none should render a dot.
      const dots = wrapper.findAll('[data-test$="-dirty-dot"]');
      expect(dots).toHaveLength(0);

      const falseWrapper = mount(AppTabs, {
        props: {
          tabs: [{ label: "Tab", value: "tab", dirty: false }],
          activeTab: "tab",
        },
      });
      expect(falseWrapper.find('[data-test="tab-tab-dirty-dot"]').exists()).toBe(
        false,
      );
      falseWrapper.unmount();
    });

    it("applies dirtyTitle to the dot when provided", () => {
      const titledWrapper = mount(AppTabs, {
        props: {
          tabs: [{ label: "Dirty", value: "dirty", dirty: true }],
          activeTab: "dirty",
          dirtyTitle: "Unsaved changes",
        },
      });
      const dot = titledWrapper.find('[data-test="tab-dirty-dirty-dot"]');
      expect(dot.attributes("title")).toBe("Unsaved changes");
      titledWrapper.unmount();
    });
  });
});
