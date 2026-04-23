import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import OTabs from './OTabs.vue'
import OTab from './OTab.vue'

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Mount OTabs with a set of OTab children */
function mountTabs(options: {
  modelValue?: string | number
  orientation?: 'horizontal' | 'vertical'
  align?: 'left' | 'center' | 'right' | 'justify'
  dense?: boolean
  tabs?: Array<{ name: string; label?: string; disable?: boolean }>
} = {}) {
  const tabs = options.tabs ?? [
    { name: 'tab1', label: 'Tab 1' },
    { name: 'tab2', label: 'Tab 2' },
    { name: 'tab3', label: 'Tab 3' },
  ]
  return mount(OTabs, {
    props: {
      modelValue: options.modelValue ?? 'tab1',
      orientation: options.orientation,
      align: options.align,
      dense: options.dense,
    },
    slots: {
      default: tabs.map((t) =>
        `<OTab name="${t.name}" label="${t.label ?? t.name}" ${t.disable ? 'disable' : ''} />`
      ).join(''),
    },
    global: {
      components: { OTab },
    },
    attachTo: document.body,
  })
}

// ─── OTabs ──────────────────────────────────────────────────────────────────

describe('OTabs', () => {
  // --- ARIA ---

  it('renders a tablist', () => {
    const wrapper = mountTabs()
    expect(wrapper.attributes('role')).toBe('tablist')
  })

  it('sets aria-orientation="horizontal" by default', () => {
    const wrapper = mountTabs()
    expect(wrapper.attributes('aria-orientation')).toBe('horizontal')
  })

  it('sets aria-orientation="vertical" when orientation is vertical', () => {
    const wrapper = mountTabs({ orientation: 'vertical' })
    expect(wrapper.attributes('aria-orientation')).toBe('vertical')
  })

  // --- Slots ---

  it('renders OTab children', () => {
    const wrapper = mountTabs()
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs).toHaveLength(3)
  })

  // --- Active state provided to children ---

  it('marks the first tab aria-selected when modelValue matches', () => {
    const wrapper = mountTabs({ modelValue: 'tab1' })
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs[0].attributes('aria-selected')).toBe('true')
    expect(tabs[1].attributes('aria-selected')).toBe('false')
  })

  it('marks the second tab aria-selected when modelValue is tab2', () => {
    const wrapper = mountTabs({ modelValue: 'tab2' })
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs[0].attributes('aria-selected')).toBe('false')
    expect(tabs[1].attributes('aria-selected')).toBe('true')
  })

  // --- Emits ---

  it('emits update:modelValue when a tab is clicked', async () => {
    const wrapper = mountTabs({ modelValue: 'tab1' })
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[1].trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['tab2'])
  })

  it('emits change when a tab is clicked', async () => {
    const wrapper = mountTabs({ modelValue: 'tab1' })
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[2].trigger('click')
    expect(wrapper.emitted('change')?.[0]).toEqual(['tab3'])
  })

  // --- Keyboard navigation (horizontal) ---

  it('moves focus to next tab on ArrowRight', async () => {
    const wrapper = mountTabs({ modelValue: 'tab1' })
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[0].element.focus()
    await wrapper.trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabs[1].element)
  })

  it('moves focus to previous tab on ArrowLeft', async () => {
    const wrapper = mountTabs({ modelValue: 'tab1' })
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[1].element.focus()
    await wrapper.trigger('keydown', { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tabs[0].element)
  })

  it('wraps focus from last to first on ArrowRight', async () => {
    const wrapper = mountTabs({ modelValue: 'tab1' })
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[2].element.focus()
    await wrapper.trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabs[0].element)
  })

  it('focuses the first tab on Home key', async () => {
    const wrapper = mountTabs({ modelValue: 'tab1' })
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[2].element.focus()
    await wrapper.trigger('keydown', { key: 'Home' })
    expect(document.activeElement).toBe(tabs[0].element)
  })

  it('focuses the last tab on End key', async () => {
    const wrapper = mountTabs({ modelValue: 'tab1' })
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[0].element.focus()
    await wrapper.trigger('keydown', { key: 'End' })
    expect(document.activeElement).toBe(tabs[2].element)
  })

  // --- Keyboard navigation (vertical) ---

  it('moves focus to next tab on ArrowDown in vertical mode', async () => {
    const wrapper = mountTabs({ modelValue: 'tab1', orientation: 'vertical' })
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[0].element.focus()
    await wrapper.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(tabs[1].element)
  })

  it('moves focus to previous tab on ArrowUp in vertical mode', async () => {
    const wrapper = mountTabs({ modelValue: 'tab1', orientation: 'vertical' })
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[1].element.focus()
    await wrapper.trigger('keydown', { key: 'ArrowUp' })
    expect(document.activeElement).toBe(tabs[0].element)
  })

  // --- o-tabs CSS class ---

  it('has o-tabs class', () => {
    const wrapper = mountTabs()
    expect(wrapper.classes()).toContain('o-tabs')
  })
})
