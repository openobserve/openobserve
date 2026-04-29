import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import OTabPanels from './OTabPanels.vue'
import OTabPanel from './OTabPanel.vue'

// ─── Helpers ────────────────────────────────────────────────────────────────

function mountTabPanels(options: {
  modelValue?: string | number
  animated?: boolean
  keepAlive?: boolean
  grow?: boolean
  scroll?: 'none' | 'auto' | 'y'
  panels?: Array<{ name: string; content: string }>
} = {}) {
  const panels = options.panels ?? [
    { name: 'tab1', content: 'Panel 1 content' },
    { name: 'tab2', content: 'Panel 2 content' },
    { name: 'tab3', content: 'Panel 3 content' },
  ]
  return mount(OTabPanels, {
    props: {
      modelValue: options.modelValue ?? 'tab1',
      animated: options.animated,
      keepAlive: options.keepAlive,
      ...(options.grow !== undefined && { grow: options.grow }),
      ...(options.scroll !== undefined && { scroll: options.scroll }),
    },
    slots: {
      default: panels.map(
        (p) => `<OTabPanel name="${p.name}">${p.content}</OTabPanel>`
      ).join(''),
    },
    global: {
      components: { OTabPanel },
    },
  })
}

// ─── OTabPanels ──────────────────────────────────────────────────────────────

describe('OTabPanels', () => {
  it('has o-tab-panels class', () => {
    const wrapper = mountTabPanels()
    expect(wrapper.classes()).toContain('o-tab-panels')
  })

  it('adds o-tab-panels--animated class when animated is true', () => {
    const wrapper = mountTabPanels({ animated: true })
    expect(wrapper.classes()).toContain('o-tab-panels--animated')
  })

  it('does not add o-tab-panels--animated class by default', () => {
    const wrapper = mountTabPanels()
    expect(wrapper.classes()).not.toContain('o-tab-panels--animated')
  })

  it('renders only the active panel by default (no keepAlive)', () => {
    const wrapper = mountTabPanels({ modelValue: 'tab1' })
    const panels = wrapper.findAll('[role="tabpanel"]')
    // Only the active panel should be in the DOM
    expect(panels).toHaveLength(1)
    expect(panels[0].text()).toBe('Panel 1 content')
  })

  it('shows the second panel when modelValue changes to tab2', () => {
    const wrapper = mountTabPanels({ modelValue: 'tab2' })
    const panels = wrapper.findAll('[role="tabpanel"]')
    expect(panels).toHaveLength(1)
    expect(panels[0].text()).toBe('Panel 2 content')
  })

  it('shows the correct panel after modelValue prop update', async () => {
    const wrapper = mountTabPanels({ modelValue: 'tab1' })
    await wrapper.setProps({ modelValue: 'tab3' })
    const panels = wrapper.findAll('[role="tabpanel"]')
    expect(panels).toHaveLength(1)
    expect(panels[0].text()).toBe('Panel 3 content')
  })

  it('renders all panels but hides inactive ones when keepAlive is true', () => {
    const wrapper = mountTabPanels({ modelValue: 'tab1', keepAlive: true })
    const panels = wrapper.findAll('[role="tabpanel"]')
    // All 3 panels are in the DOM
    expect(panels).toHaveLength(3)
    // Only the active one is visible (v-show)
    expect((panels[0].element as HTMLElement).style.display).not.toBe('none')
    expect((panels[1].element as HTMLElement).style.display).toBe('none')
    expect((panels[2].element as HTMLElement).style.display).toBe('none')
  })

  // --- scroll prop ---

  it('applies tw:overflow-hidden by default (scroll="none")', () => {
    const wrapper = mountTabPanels()
    expect(wrapper.classes()).toContain('tw:overflow-hidden')
  })

  it('applies tw:overflow-auto when scroll="auto"', () => {
    const wrapper = mountTabPanels({ scroll: 'auto' })
    expect(wrapper.classes()).toContain('tw:overflow-auto')
    expect(wrapper.classes()).not.toContain('tw:overflow-hidden')
  })

  it('applies tw:overflow-y-auto when scroll="y"', () => {
    const wrapper = mountTabPanels({ scroll: 'y' })
    expect(wrapper.classes()).toContain('tw:overflow-y-auto')
    expect(wrapper.classes()).not.toContain('tw:overflow-hidden')
  })

  // --- grow prop ---

  it('does not add tw:flex-1 by default', () => {
    const wrapper = mountTabPanels()
    expect(wrapper.classes()).not.toContain('tw:flex-1')
  })

  it('adds tw:flex-1 when grow is true', () => {
    const wrapper = mountTabPanels({ grow: true })
    expect(wrapper.classes()).toContain('tw:flex-1')
  })
})
