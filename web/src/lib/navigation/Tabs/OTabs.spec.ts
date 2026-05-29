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
  bordered?: boolean
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
      bordered: options.bordered,
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
    expect(wrapper.find('[role="tablist"]').exists()).toBe(true)
  })

  it('sets aria-orientation="horizontal" by default', () => {
    const wrapper = mountTabs()
    expect(wrapper.find('[role="tablist"]').attributes('aria-orientation')).toBe('horizontal')
  })

  it('sets aria-orientation="vertical" when orientation is vertical', () => {
    const wrapper = mountTabs({ orientation: 'vertical' })
    expect(wrapper.find('[role="tablist"]').attributes('aria-orientation')).toBe('vertical')
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
  // TabsTrigger activates on mousedown (not click), matching WAI-ARIA guidance.

  it('emits update:modelValue when a tab is activated', async () => {
    const wrapper = mountTabs({ modelValue: 'tab1' })
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[1].trigger('mousedown', { button: 0 })
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['tab2'])
  })

  it('emits change when a tab is activated', async () => {
    const wrapper = mountTabs({ modelValue: 'tab1' })
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[2].trigger('mousedown', { button: 0 })
    expect(wrapper.emitted('change')?.[0]).toEqual(['tab3'])
  })

  // --- Keyboard navigation (horizontal) ---
  // RovingFocusGroup (from TabsList) handles keyboard events that bubble up from focused tabs.

  it('moves focus to next tab on ArrowRight', async () => {
    const wrapper = mountTabs({ modelValue: 'tab1' })
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[0].element.focus()
    await tabs[0].trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabs[1].element)
  })

  it('moves focus to previous tab on ArrowLeft', async () => {
    const wrapper = mountTabs({ modelValue: 'tab1' })
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[1].element.focus()
    await tabs[1].trigger('keydown', { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tabs[0].element)
  })

  it('wraps focus from last to first on ArrowRight', async () => {
    const wrapper = mountTabs({ modelValue: 'tab1' })
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[2].element.focus()
    await tabs[2].trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabs[0].element)
  })

  it('focuses the first tab on Home key', async () => {
    const wrapper = mountTabs({ modelValue: 'tab1' })
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[2].element.focus()
    await tabs[2].trigger('keydown', { key: 'Home' })
    expect(document.activeElement).toBe(tabs[0].element)
  })

  it('focuses the last tab on End key', async () => {
    const wrapper = mountTabs({ modelValue: 'tab1' })
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[0].element.focus()
    await tabs[0].trigger('keydown', { key: 'End' })
    expect(document.activeElement).toBe(tabs[2].element)
  })

  // --- Keyboard navigation (vertical) ---

  it('moves focus to next tab on ArrowDown in vertical mode', async () => {
    const wrapper = mountTabs({ modelValue: 'tab1', orientation: 'vertical' })
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[0].element.focus()
    await tabs[0].trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(tabs[1].element)
  })

  it('moves focus to previous tab on ArrowUp in vertical mode', async () => {
    const wrapper = mountTabs({ modelValue: 'tab1', orientation: 'vertical' })
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[1].element.focus()
    await tabs[1].trigger('keydown', { key: 'ArrowUp' })
    expect(document.activeElement).toBe(tabs[0].element)
  })

  // --- o-tabs CSS class ---

  it('has o-tabs class on the tablist', () => {
    const wrapper = mountTabs()
    expect(wrapper.find('.o-tabs').exists()).toBe(true)
  })

  // --- bordered prop ---

  it('does not apply the bottom-border class on the outer wrapper by default (horizontal)', () => {
    const wrapper = mountTabs()
    const outer = wrapper.find('.tw\\:flex.tw\\:flex-row.tw\\:items-stretch')
    expect(outer.exists()).toBe(true)
    expect(outer.classes()).not.toContain('tw:border-b')
  })

  it('applies the bottom-border class on the outer wrapper when bordered is true (horizontal)', () => {
    const wrapper = mountTabs({ bordered: true })
    // The horizontal layout adds the border to the outer flex-row wrapper
    const outer = wrapper.find('.tw\\:flex.tw\\:flex-row.tw\\:items-stretch')
    expect(outer.exists()).toBe(true)
    expect(outer.classes()).toContain('tw:border-b')
    expect(outer.classes()).toContain('tw:border-solid')
  })

  it('applies the bottom-border class on the tablist when bordered is true (vertical)', () => {
    const wrapper = mountTabs({ orientation: 'vertical', bordered: true })
    const tablist = wrapper.find('.o-tabs')
    expect(tablist.classes()).toContain('tw:border-b')
    expect(tablist.classes()).toContain('tw:border-solid')
  })

  it('does not apply the bottom-border class on the tablist when bordered is false (vertical)', () => {
    const wrapper = mountTabs({ orientation: 'vertical', bordered: false })
    const tablist = wrapper.find('.o-tabs')
    expect(tablist.classes()).not.toContain('tw:border-b')
  })

  // --- Horizontal scroll arrows ---

  it('renders both scroll arrow buttons in horizontal mode', () => {
    const wrapper = mountTabs()
    // Two arrow buttons (left + right) in horizontal layout
    const arrows = wrapper.findAll('button[aria-hidden="true"]')
    expect(arrows).toHaveLength(2)
  })

  it('hides scroll arrows when there is no overflow (jsdom: scrollWidth === clientWidth)', () => {
    const wrapper = mountTabs()
    const arrows = wrapper.findAll('button[aria-hidden="true"]')
    // In jsdom, layout is not computed so hasOverflow is false → v-show hides via display:none
    for (const btn of arrows) {
      expect((btn.element as HTMLElement).style.display).toBe('none')
    }
  })

  it('renders no scroll arrows in vertical mode', () => {
    const wrapper = mountTabs({ orientation: 'vertical' })
    const arrows = wrapper.findAll('button[aria-hidden="true"]')
    expect(arrows).toHaveLength(0)
  })

  it('arrow buttons are tabindex=-1 (not in tab order)', () => {
    const wrapper = mountTabs()
    const arrows = wrapper.findAll('button[aria-hidden="true"]')
    for (const btn of arrows) {
      expect(btn.attributes('tabindex')).toBe('-1')
    }
  })

  // --- Align classes ---

  it('applies left alignment class by default', () => {
    const wrapper = mountTabs()
    expect(wrapper.find('.o-tabs').classes()).toContain('tw:justify-start')
  })

  it('applies center alignment class when align=center', () => {
    const wrapper = mountTabs({ align: 'center' })
    expect(wrapper.find('.o-tabs').classes()).toContain('tw:justify-center')
  })

  it('applies right alignment class when align=right', () => {
    const wrapper = mountTabs({ align: 'right' })
    expect(wrapper.find('.o-tabs').classes()).toContain('tw:justify-end')
  })

  it('applies justify alignment class when align=justify', () => {
    const wrapper = mountTabs({ align: 'justify' })
    expect(wrapper.find('.o-tabs').classes()).toContain('tw:justify-stretch')
  })

  // --- Inner padding for focus-ring spacing (horizontal) ---

  it('applies horizontal scroll-container vertical padding for focus spacing', () => {
    const wrapper = mountTabs()
    // The scroll container (parent of TabsList) carries py-[3px]
    expect(wrapper.html()).toContain('tw:py-[3px]')
  })

  it('applies horizontal tablist horizontal padding for focus spacing', () => {
    const wrapper = mountTabs()
    expect(wrapper.find('.o-tabs').classes()).toContain('tw:px-[3px]')
  })

  // --- Numeric modelValue ---

  it('accepts a numeric modelValue and emits a number back', async () => {
    const wrapper = mount(OTabs, {
      props: { modelValue: 1 },
      slots: {
        default: `
          <OTab :name="1" label="One" />
          <OTab :name="2" label="Two" />
        `,
      },
      global: { components: { OTab } },
      attachTo: document.body,
    })
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs[0].attributes('aria-selected')).toBe('true')
    await tabs[1].trigger('mousedown', { button: 0 })
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([2])
    expect(wrapper.emitted('change')?.[0]).toEqual([2])
  })
})
