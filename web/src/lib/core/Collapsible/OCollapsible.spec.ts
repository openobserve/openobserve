import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { h, defineComponent } from "vue";
import OCollapsible from "./OCollapsible.vue";

describe("OCollapsible", () => {
  it("renders the title", () => {
    const wrapper = mount(OCollapsible, { props: { title: "Settings" } });
    expect(wrapper.find("[data-test='o-collapsible-title']").text()).toBe("Settings");
  });

  it("renders the summary on the trigger when provided", () => {
    const wrapper = mount(OCollapsible, {
      props: { title: "Advanced", summary: "3 settings" },
    });
    expect(wrapper.find("[data-test='o-collapsible-summary']").text()).toBe("3 settings");
  });

  it("does not render a summary when not provided", () => {
    const wrapper = mount(OCollapsible, { props: { title: "Options" } });
    expect(wrapper.find("[data-test='o-collapsible-summary']").exists()).toBe(false);
  });

  it("draws one 32 px trigger with a leading chevron that turns when open", async () => {
    const wrapper = mount(OCollapsible, { props: { title: "Test" } });
    const trigger = wrapper.find("[data-test='o-collapsible-trigger']");
    expect(trigger.classes()).toContain("min-h-control-md");
    expect(trigger.find(".rotate-0").exists()).toBe(true);
    await trigger.trigger("click");
    expect(trigger.find(".rotate-90").exists()).toBe(true);
  });

  it("indents the body under the title", () => {
    const wrapper = mount(OCollapsible, {
      props: { title: "Test", defaultOpen: true },
      slots: { default: "<p>Body</p>" },
    });
    expect(wrapper.find("p").element.parentElement?.className).toContain("ps-6");
  });

  it("restores and remembers the open state under persistKey", async () => {
    localStorage.setItem("o2.collapsible.spec-key", "1");
    const wrapper = mount(OCollapsible, { props: { title: "Test", persistKey: "spec-key" } });
    expect(wrapper.html()).toContain('data-state="open"');
    await wrapper.find("button").trigger("click");
    expect(localStorage.getItem("o2.collapsible.spec-key")).toBe("0");
    localStorage.removeItem("o2.collapsible.spec-key");
  });

  it("is closed by default", () => {
    const wrapper = mount(OCollapsible, { props: { title: "Test" } });
    // CollapsibleContent is hidden when closed (data-state=closed)
    expect(wrapper.html()).toContain('data-state="closed"');
  });

  it("opens when defaultOpen is true", () => {
    const wrapper = mount(OCollapsible, {
      props: { title: "Test", defaultOpen: true },
    });
    expect(wrapper.html()).toContain('data-state="open"');
  });

  it("opens when open is true", () => {
    const wrapper = mount(OCollapsible, {
      props: { title: "Test", open: true },
    });
    expect(wrapper.html()).toContain('data-state="open"');
  });

  it("emits update:open on toggle", async () => {
    const wrapper = mount(OCollapsible, { props: { title: "Test" } });
    const trigger = wrapper.find("button");
    await trigger.trigger("click");
    expect(wrapper.emitted("update:open")).toBeTruthy();
    expect(wrapper.emitted("update:open")![0]).toEqual([true]);
  });

  it("emits open event when opening", async () => {
    const wrapper = mount(OCollapsible, { props: { title: "Test" } });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("open")).toBeTruthy();
  });

  it("emits close event when closing", async () => {
    const wrapper = mount(OCollapsible, {
      props: { title: "Test", open: true },
    });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("renders default slot content when open", async () => {
    const wrapper = mount(OCollapsible, {
      props: { title: "Test", defaultOpen: true },
      slots: { default: "<p>Content inside</p>" },
    });
    expect(wrapper.text()).toContain("Content inside");
  });

  it("renders a custom #trigger in place of the title and keeps the chevron", () => {
    const wrapper = mount(OCollapsible, {
      slots: {
        trigger: '<span data-test="custom-trigger">Custom</span>',
      },
    });
    expect(wrapper.html()).toContain("custom-trigger");
    expect(wrapper.find("[data-test='o-collapsible-title']").exists()).toBe(false);
    expect(wrapper.find("[data-test='o-collapsible-trigger'] svg").exists()).toBe(true);
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
      props: { title: "Test" },
      attrs: { "data-test": "my-collapsible" },
    });
    expect(wrapper.html()).toContain('data-test="my-collapsible"');
  });

  describe("group accordion", () => {
    it("closes other items in the same group when one opens", async () => {
      // Use a unique group name per test run to avoid module-level state leakage
      // from useCollapsibleGroup's shared Map.
      const groupName = `test-group-${Date.now()}`;
      const GroupTest = defineComponent({
        components: { OCollapsible },
        template: `
          <div>
            <OCollapsible title="Item 1" :group="group" data-test="item1" />
            <OCollapsible title="Item 2" :group="group" data-test="item2" />
          </div>
        `,
        props: { group: String },
      });

      const wrapper = mount(GroupTest, { props: { group: groupName } });
      const [btn1, btn2] = wrapper.findAll("button");

      // Open first — query the specific collapsible root divs via data-test
      await btn1.trigger("click");
      const item1 = wrapper.find('[data-test="item1"]');
      const item2 = wrapper.find('[data-test="item2"]');
      expect(item1.attributes("data-state")).toBe("open");
      expect(item2.attributes("data-state")).toBe("closed");

      // Open second — first should close (accordion behavior)
      await btn2.trigger("click");
      expect(item1.attributes("data-state")).toBe("closed");
      expect(item2.attributes("data-state")).toBe("open");
    });
  });
});
