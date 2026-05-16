import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { h, defineComponent } from "vue";
import OCollapsible from "./OCollapsible.vue";

describe("OCollapsible", () => {
  it("renders label text", () => {
    const wrapper = mount(OCollapsible, { props: { label: "Settings" } });
    expect(wrapper.text()).toContain("Settings");
  });

  it("renders caption when provided", () => {
    const wrapper = mount(OCollapsible, {
      props: { label: "Options", caption: "Advanced settings" },
    });
    expect(wrapper.text()).toContain("Advanced settings");
  });

  it("does not render caption when not provided", () => {
    const wrapper = mount(OCollapsible, { props: { label: "Options" } });
    expect(wrapper.text()).not.toContain("Advanced");
  });

  it("renders icon span when icon prop is set", () => {
    const wrapper = mount(OCollapsible, {
      props: { label: "Test", icon: "settings" },
    });
    expect(wrapper.html()).toContain("settings");
  });

  it("is closed by default", () => {
    const wrapper = mount(OCollapsible, { props: { label: "Test" } });
    // CollapsibleContent is hidden when closed (data-state=closed)
    expect(wrapper.html()).toContain('data-state="closed"');
  });

  it("opens when defaultOpen is true", () => {
    const wrapper = mount(OCollapsible, {
      props: { label: "Test", defaultOpen: true },
    });
    expect(wrapper.html()).toContain('data-state="open"');
  });

  it("opens when modelValue is true", () => {
    const wrapper = mount(OCollapsible, {
      props: { label: "Test", modelValue: true },
    });
    expect(wrapper.html()).toContain('data-state="open"');
  });

  it("emits update:modelValue on toggle", async () => {
    const wrapper = mount(OCollapsible, { props: { label: "Test" } });
    const trigger = wrapper.find("button");
    await trigger.trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")![0]).toEqual([true]);
  });

  it("emits open event when opening", async () => {
    const wrapper = mount(OCollapsible, { props: { label: "Test" } });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("open")).toBeTruthy();
  });

  it("emits close event when closing", async () => {
    const wrapper = mount(OCollapsible, {
      props: { label: "Test", modelValue: true },
    });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("renders default slot content when open", async () => {
    const wrapper = mount(OCollapsible, {
      props: { label: "Test", defaultOpen: true },
      slots: { default: "<p>Content inside</p>" },
    });
    expect(wrapper.text()).toContain("Content inside");
  });

  it("renders custom #trigger slot and hides default chevron", () => {
    const wrapper = mount(OCollapsible, {
      slots: {
        trigger: '<span data-test="custom-trigger">Custom</span>',
      },
    });
    expect(wrapper.html()).toContain("custom-trigger");
    // Default label span should not be present
    expect(wrapper.find(".tw\\:text-collapsible-label").exists()).toBe(false);
  });

  it("exposes open state to #trigger slot", async () => {
    const wrapper = mount(OCollapsible, {
      props: { defaultOpen: true },
      slots: {
        trigger: ({ open }: { open: boolean }) =>
          h("span", { "data-open": String(open) }, "Trigger"),
      },
    });
    expect(wrapper.find('[data-open="true"]').exists()).toBe(true);
  });

  it("forwards data-test attribute", () => {
    const wrapper = mount(OCollapsible, {
      props: { label: "Test" },
      attrs: { "data-test": "my-collapsible" },
    });
    expect(wrapper.html()).toContain('data-test="my-collapsible"');
  });

  describe("group accordion", () => {
    it("closes other items in the same group when one opens", async () => {
      const GroupTest = defineComponent({
        components: { OCollapsible },
        template: `
          <div>
            <OCollapsible label="Item 1" group="test-group" data-test="item1" />
            <OCollapsible label="Item 2" group="test-group" data-test="item2" />
          </div>
        `,
      });

      const wrapper = mount(GroupTest);
      const [btn1, btn2] = wrapper.findAll("button");

      // Open first
      await btn1.trigger("click");
      let roots = wrapper.findAll("[data-state]");
      expect(roots[0].attributes("data-state")).toBe("open");
      expect(roots[1].attributes("data-state")).toBe("closed");

      // Open second ΓÇö first should close
      await btn2.trigger("click");
      roots = wrapper.findAll("[data-state]");
      expect(roots[0].attributes("data-state")).toBe("closed");
      expect(roots[1].attributes("data-state")).toBe("open");
    });
  });
});
