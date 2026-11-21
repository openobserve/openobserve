import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import O2AIContextAddBtn from "./O2AIContextAddBtn.vue";
import store from "@/test/unit/helpers/store";

// Mock aws-exports config
vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "true",
  },
}));

// Create a div for mounting
const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

describe("O2AIContextAddBtn", () => {
  let wrapper;

  beforeEach(async () => {
    // Create a fresh store before each test
    store.state.theme = "light";
    store.state.zoConfig = {
      ai_enabled: true,
    };

    // Mount component
    wrapper = mount(O2AIContextAddBtn, {
      attachTo: document.body,
      global: {
        plugins: [],
        provide: { store },
        stubs: {},
      },
      props: {
        class: "",
        size: "xs",
        style: "",
        imageHeight: "20px",
        imageWidth: "20px",
      },
    });

    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("renders when enterprise and AI are enabled", () => {
    expect(wrapper.find('[data-test="o2-ai-context-add-btn"]').exists()).toBe(true);
  });

  it("does not render when AI is disabled", async () => {
    store.state.zoConfig.ai_enabled = false;
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="o2-ai-context-add-btn"]').exists()).toBe(false);
  });

  it("emits sendToAiChat event when clicked", async () => {
    const button = wrapper.find('[data-test="o2-ai-context-add-btn"]');
    await button.trigger("click");
    expect(wrapper.emitted("sendToAiChat")).toBeTruthy();
    expect(wrapper.emitted("sendToAiChat")).toHaveLength(1);
  });

  it("applies custom class when provided", async () => {
    await wrapper.setProps({ class: "custom-class" });
    expect(wrapper.find('[data-test="o2-ai-context-add-btn"]').classes()).toContain("custom-class");
  });

  it("applies custom style when provided", async () => {
    await wrapper.setProps({ style: "margin: 10px" });
    const button = wrapper.find('[data-test="o2-ai-context-add-btn"]');
    expect(button.attributes("style")).toContain("margin: 10px");
  });

  it("draws the assistant spark, snapped to the requested size", async () => {
    const spark = () => wrapper.get('[data-test="assistant-spark"]');
    expect(wrapper.find("img").exists()).toBe(false);
    expect(spark().attributes("data-size")).toBe("20");
    await wrapper.setProps({ imageHeight: "14", imageWidth: "14" });
    expect(spark().attributes("data-size")).toBe("16");
    await wrapper.setProps({ imageHeight: "30px", imageWidth: "30px" });
    expect(spark().attributes("data-size")).toBe("24");
  });

  it("has correct button attributes", () => {
    const button = wrapper.find('[data-test="o2-ai-context-add-btn"]');
    expect(button.attributes("flat")).toBe(undefined);
    expect(button.classes().join(" ")).not.toContain("gradient-ai");
  });
});
