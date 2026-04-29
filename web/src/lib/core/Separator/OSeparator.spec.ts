import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import OSeparator from "./OSeparator.vue"

describe("OSeparator", () => {
  // --- Default rendering ---

  it('renders a div with role="separator"', () => {
    const wrapper = mount(OSeparator)
    expect(wrapper.element.tagName).toBe("DIV")
    expect(wrapper.attributes("role")).toBe("separator")
  })
