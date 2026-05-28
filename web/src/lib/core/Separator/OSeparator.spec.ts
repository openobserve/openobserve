import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import OSeparator from "./OSeparator.vue"

/**
 * OSeparator wraps Reka UI's <Separator> which renders a native <div>
 * with role="separator". All visual variants are controlled via Tailwind
 * token utility classes applied to that div.
 */

describe("OSeparator", () => {
  // --- Default rendering ---

  it('renders a div with role="separator"', () => {
    const wrapper = mount(OSeparator)
    expect(wrapper.element.tagName).toBe("DIV")
    expect(wrapper.attributes("role")).toBe("separator")
  })

  // --- Orientation classes ---

  it("applies horizontal layout classes by default", () => {
    const wrapper = mount(OSeparator)
    const classList = wrapper.classes().join(" ")
    // Horizontal: full-width block with a fixed height token
    expect(classList).toContain("tw:w-full")
    expect(classList).toContain("tw:h-separator")
    expect(classList).toContain("tw:border-0")
  })

  it("applies vertical layout classes when vertical prop is true", () => {
    const wrapper = mount(OSeparator, { props: { vertical: true } })
    const classList = wrapper.classes().join(" ")
    // Vertical: self-stretching block with a fixed width token
    expect(classList).toContain("tw:self-stretch")
    expect(classList).toContain("tw:w-separator")
    expect(classList).toContain("tw:min-h-0")
  })

  it("does not apply vertical classes when vertical is false", () => {
    const wrapper = mount(OSeparator, { props: { vertical: false } })
    expect(wrapper.classes().join(" ")).not.toContain("tw:self-stretch")
  })

  // --- Color class ---

  it("uses the default separator color class", () => {
    const wrapper = mount(OSeparator)
    expect(wrapper.classes()).toContain("tw:bg-separator")
  })
})
