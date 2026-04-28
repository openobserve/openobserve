import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import OSeparator from './OSeparator.vue'

describe('OSeparator', () => {
  // --- Default rendering ---

  it('renders a div with role="separator"', () => {
    const wrapper = mount(OSeparator)
    expect(wrapper.element.tagName).toBe('DIV')
    expect(wrapper.attributes('role')).toBe('separator')
  })

  it('defaults to horizontal orientation', () => {
    const wrapper = mount(OSeparator)
    // Reka omits aria-orientation for horizontal (ARIA implicit default); uses data-orientation instead
    expect(wrapper.attributes('data-orientation')).toBe('horizontal')
  })

  it('applies horizontal base classes by default', () => {
    const wrapper = mount(OSeparator)
    const cls = wrapper.classes().join(' ')
    expect(cls).toContain('tw:w-full')
    expect(cls).toContain('tw:h-separator')
    expect(cls).toContain('tw:bg-separator')
  })

  // --- vertical prop ---

  it('sets aria-orientation to "vertical" when vertical=true', () => {
    const wrapper = mount(OSeparator, { props: { vertical: true } })
    expect(wrapper.attributes('aria-orientation')).toBe('vertical')
  })

  it('applies vertical base classes when vertical=true', () => {
    const wrapper = mount(OSeparator, { props: { vertical: true } })
    const cls = wrapper.classes().join(' ')
    expect(cls).toContain('tw:self-stretch')
    expect(cls).toContain('tw:w-separator')
    expect(cls).not.toContain('tw:w-full')
  })

  // --- inset prop ---

  it('adds horizontal inset margin when inset=true (horizontal)', () => {
    const wrapper = mount(OSeparator, { props: { inset: true } })
    expect(wrapper.classes()).toContain('tw:mx-4')
  })

  it('adds vertical inset margin when inset=true and vertical=true', () => {
    const wrapper = mount(OSeparator, { props: { inset: true, vertical: true } })
    expect(wrapper.classes()).toContain('tw:my-2')
  })

  // --- spaced prop ---

  it('adds vertical spacing when spaced=true (horizontal)', () => {
    const wrapper = mount(OSeparator, { props: { spaced: true } })
    expect(wrapper.classes()).toContain('tw:my-2')
  })

  it('adds horizontal spacing when spaced=true and vertical=true', () => {
    const wrapper = mount(OSeparator, { props: { spaced: true, vertical: true } })
    expect(wrapper.classes()).toContain('tw:mx-2')
  })

  // --- color prop ---

  it('applies no inline style for default color', () => {
    const wrapper = mount(OSeparator)
    expect(wrapper.attributes('style')).toBeFalsy()
  })

  it('applies no inline style for color="strong" (uses CSS class)', () => {
    const wrapper = mount(OSeparator, { props: { color: 'strong' } })
    expect(wrapper.classes()).toContain('tw:bg-separator-strong')
    expect(wrapper.attributes('style')).toBeFalsy()
  })

  it('applies inline backgroundColor for legacy color "blue"', () => {
    const wrapper = mount(OSeparator, { props: { color: 'blue' } })
    expect(wrapper.attributes('style')).toContain('var(--color-primary-600)')
  })

  it('maps "primary" to primary token', () => {
    const wrapper = mount(OSeparator, { props: { color: 'primary' } })
    expect(wrapper.attributes('style')).toContain('var(--color-primary-600)')
  })

  it('maps token shorthand like "grey-400" to var(--color-grey-400)', () => {
    const wrapper = mount(OSeparator, { props: { color: 'grey-400' } })
    expect(wrapper.attributes('style')).toContain('var(--color-grey-400)')
  })

  // --- Class passthrough (from outside) ---

  it('merges extra classes passed from parent', () => {
    const wrapper = mount(OSeparator, { attrs: { class: 'my-8' } })
    expect(wrapper.classes()).toContain('my-8')
  })
})
