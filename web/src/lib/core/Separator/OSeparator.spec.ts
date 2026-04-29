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

  // --- Color variants ---

  it("uses the default separator color when strong is false", () => {
    const wrapper = mount(OSeparator)
    expect(wrapper.classes()).toContain("tw:bg-separator")
    expect(wrapper.classes()).not.toContain("tw:bg-separator-strong")
  })

  it("uses the strong separator color when strong prop is true", () => {
    const wrapper = mount(OSeparator, { props: { strong: true } })
    // Strong uses a heavier/darker background token
    expect(wrapper.classes()).toContain("tw:bg-separator-strong")
    expect(wrapper.classes()).not.toContain("tw:bg-separator")
  })

  // --- Inset (margins that shorten the line) ---

  it("adds horizontal inset margin for a horizontal separator", () => {
    const wrapper = mount(OSeparator, { props: { inset: true } })
    // Horizontal inset: left/right margin so line doesn't span full width
    expect(wrapper.classes()).toContain("tw:mx-4")
  })

  it("adds vertical inset margin for a vertical separator", () => {
    const wrapper = mount(OSeparator, { props: { vertical: true, inset: true } })
    // Vertical inset: top/bottom margin so line doesn't span full height
    expect(wrapper.classes()).toContain("tw:my-2")
  })

  it("does not add inset margin when inset is false", () => {
    const wrapper = mount(OSeparator, { props: { inset: false } })
    expect(wrapper.classes().join(" ")).not.toContain("tw:mx-4")
    expect(wrapper.classes().join(" ")).not.toContain("tw:my-2")
  })

  // --- Spaced (margins that add breathing room around the line) ---

  it("adds top/bottom spacing for a horizontal separator", () => {
    const wrapper = mount(OSeparator, { props: { spaced: true } })
    // Horizontal spaced: top/bottom margin
    expect(wrapper.classes()).toContain("tw:my-2")
  })

  it("adds left/right spacing for a vertical separator", () => {
    const wrapper = mount(OSeparator, { props: { vertical: true, spaced: true } })
    // Vertical spaced: left/right margin
    expect(wrapper.classes()).toContain("tw:mx-2")
  })

  it("does not add spaced margin when spaced is false", () => {
    const wrapper = mount(OSeparator, { props: { spaced: false } })
    const classList = wrapper.classes().join(" ")
    expect(classList).not.toContain("tw:mx-2")
    expect(classList).not.toContain("tw:my-2")
  })
})
