import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ErrorPanel from "./ErrorPanel.vue";

describe("ErrorPanel", () => {
  it("announces the failure with its message and actions", () => {
    const wrapper = mount(ErrorPanel, {
      slots: { default: "Couldn't load the details.", actions: "<button>Retry</button>" },
      global: { stubs: { OIcon: true } },
    });
    expect(wrapper.attributes("role")).toBe("alert");
    expect(wrapper.text()).toContain("Couldn't load the details.");
    expect(wrapper.find("button").text()).toBe("Retry");
  });
});
