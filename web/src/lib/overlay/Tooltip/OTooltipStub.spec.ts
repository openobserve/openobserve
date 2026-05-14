import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OTooltipStub from "./OTooltipStub.vue";

describe("OTooltipStub", () => {
  it("renders the trigger slot", () => {
    const wrapper = mount(OTooltipStub, {
      props: { content: "Hello" },
      slots: { default: '<button data-testid="trigger">Hover</button>' },
    });
    expect(wrapper.find('[data-testid="trigger"]').exists()).toBe(true);
  });

  it("renders content from the content prop inline", () => {
    const wrapper = mount(OTooltipStub, {
      props: { content: "Stub tooltip text" },
      slots: { default: "<button>Hover</button>" },
    });
    expect(wrapper.text()).toContain("Stub tooltip text");
  });

  it("renders rich content from the #content slot inline", () => {
    const wrapper = mount(OTooltipStub, {
      slots: {
        default: "<button>Hover</button>",
        content: '<em data-testid="rich">Rich</em>',
      },
    });
    expect(wrapper.find('[data-testid="rich"]').exists()).toBe(true);
  });

  it("has data-test=o-tooltip-stub attribute", () => {
    const wrapper = mount(OTooltipStub, {
      props: { content: "Test" },
      slots: { default: "<span>trigger</span>" },
    });
    expect(wrapper.find('[data-test="o-tooltip-stub"]').exists()).toBe(true);
  });
});
