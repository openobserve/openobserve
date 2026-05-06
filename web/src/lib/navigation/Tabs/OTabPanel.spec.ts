import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, provide } from 'vue'
import OTabPanel from './OTabPanel.vue'
import { TAB_PANELS_CONTEXT_KEY } from './OTabPanels.types'
import type { TabPanelsContext } from './OTabPanels.types'

// ─── Helpers ────────────────────────────────────────────────────────────────

function mountTabPanel(options: {
  name?: string | number
  activeTab?: string | number
  keepAlive?: boolean
  animated?: boolean
  content?: string
  padding?: 'none' | 'sm' | 'md'
  layout?: 'block' | 'flex-col' | 'flex-row'
  stretch?: boolean
} = {}) {
  const activeTab = options.activeTab ?? 'tab1'
  const keepAlive = options.keepAlive ?? false
  const animated = options.animated ?? false

  return mount(OTabPanel, {
    props: {
      name: options.name ?? 'tab1',
      ...(options.padding !== undefined && { padding: options.padding }),
      ...(options.layout !== undefined && { layout: options.layout }),
      ...(options.stretch !== undefined && { stretch: options.stretch }),
    },
    slots: {
      default: options.content ?? 'Panel content',
    },
    global: {
      plugins: [
        {
          install(app) {
            app.provide(
              TAB_PANELS_CONTEXT_KEY,
              computed<TabPanelsContext>(() => ({
                modelValue: activeTab,
                keepAlive,
                animated,
              }))
            )
          },
        },
      ],
    },
  })
}

// ─── OTabPanel ───────────────────────────────────────────────────────────────

describe('OTabPanel', () => {
  // --- Visibility ---

  it('renders panel content when it is the active tab', () => {
    const wrapper = mountTabPanel({ name: 'tab1', activeTab: 'tab1' })
    expect(wrapper.find('[role="tabpanel"]').exists()).toBe(true)
    expect(wrapper.text()).toBe('Panel content')
  })

  it('does not render panel when it is not the active tab (default, no keepAlive)', () => {
    const wrapper = mountTabPanel({ name: 'tab2', activeTab: 'tab1' })
    expect(wrapper.find('[role="tabpanel"]').exists()).toBe(false)
  })

  it('renders panel but hides it with v-show when keepAlive is true and inactive', () => {
    const wrapper = mountTabPanel({ name: 'tab2', activeTab: 'tab1', keepAlive: true })
    const panel = wrapper.find('[role="tabpanel"]')
    expect(panel.exists()).toBe(true)
    expect((panel.element as HTMLElement).style.display).toBe('none')
  })

  it('renders and shows the panel when keepAlive is true and active', () => {
    const wrapper = mountTabPanel({ name: 'tab1', activeTab: 'tab1', keepAlive: true })
    const panel = wrapper.find('[role="tabpanel"]')
    expect(panel.exists()).toBe(true)
    expect((panel.element as HTMLElement).style.display).not.toBe('none')
  })

  // --- ARIA ---

  it('has role="tabpanel"', () => {
    const wrapper = mountTabPanel({ name: 'tab1', activeTab: 'tab1' })
    expect(wrapper.find('[role="tabpanel"]').exists()).toBe(true)
  })

  it('has tabindex="0" so the panel is reachable by keyboard', () => {
    const wrapper = mountTabPanel({ name: 'tab1', activeTab: 'tab1' })
    expect(wrapper.find('[role="tabpanel"]').attributes('tabindex')).toBe('0')
  })

  // --- Class ---

  it('has o-tab-panel class', () => {
    const wrapper = mountTabPanel({ name: 'tab1', activeTab: 'tab1' })
    expect(wrapper.find('.o-tab-panel').exists()).toBe(true)
  })

  // --- Slot content ---

  it('renders custom slot content', () => {
    const wrapper = mountTabPanel({
      name: 'tab1',
      activeTab: 'tab1',
      content: '<div data-testid="inner">Custom content</div>',
    })
    expect(wrapper.find('[data-testid="inner"]').exists()).toBe(true)
  })

  // --- padding prop ---

  it('applies tw:p-0 by default (padding="none")', () => {
    const wrapper = mountTabPanel({ name: 'tab1', activeTab: 'tab1' })
    expect(wrapper.find('[role="tabpanel"]').classes()).toContain('tw:p-0')
  })

  it('applies tw:p-0 when padding="none"', () => {
    const wrapper = mountTabPanel({ name: 'tab1', activeTab: 'tab1', padding: 'none' })
    expect(wrapper.find('[role="tabpanel"]').classes()).toContain('tw:p-0')
  })

  it('applies tw:p-2 when padding="sm"', () => {
    const wrapper = mountTabPanel({ name: 'tab1', activeTab: 'tab1', padding: 'sm' })
    expect(wrapper.find('[role="tabpanel"]').classes()).toContain('tw:p-2')
  })

  it('applies tw:p-4 when padding="md"', () => {
    const wrapper = mountTabPanel({ name: 'tab1', activeTab: 'tab1', padding: 'md' })
    expect(wrapper.find('[role="tabpanel"]').classes()).toContain('tw:p-4')
  })

  // --- layout prop ---

  it('applies no flex classes by default (layout="block")', () => {
    const wrapper = mountTabPanel({ name: 'tab1', activeTab: 'tab1' })
    const classes = wrapper.find('[role="tabpanel"]').classes()
    expect(classes).not.toContain('tw:flex')
  })

  it('applies tw:flex tw:flex-col when layout="flex-col"', () => {
    const wrapper = mountTabPanel({ name: 'tab1', activeTab: 'tab1', layout: 'flex-col' })
    const classes = wrapper.find('[role="tabpanel"]').classes()
    expect(classes).toContain('tw:flex')
    expect(classes).toContain('tw:flex-col')
  })

  it('applies tw:flex tw:flex-row when layout="flex-row"', () => {
    const wrapper = mountTabPanel({ name: 'tab1', activeTab: 'tab1', layout: 'flex-row' })
    const classes = wrapper.find('[role="tabpanel"]').classes()
    expect(classes).toContain('tw:flex')
    expect(classes).toContain('tw:flex-row')
  })

  // --- stretch prop ---

  it('does not add tw:h-full by default', () => {
    const wrapper = mountTabPanel({ name: 'tab1', activeTab: 'tab1' })
    expect(wrapper.find('[role="tabpanel"]').classes()).not.toContain('tw:h-full')
  })

  it('adds tw:h-full when stretch is true', () => {
    const wrapper = mountTabPanel({ name: 'tab1', activeTab: 'tab1', stretch: true })
    expect(wrapper.find('[role="tabpanel"]').classes()).toContain('tw:h-full')
  })

  // --- No default padding (legacy check) ---

  it('does not add q-tab-panel class', () => {
    const wrapper = mountTabPanel({ name: 'tab1', activeTab: 'tab1' })
    const panel = wrapper.find('[role="tabpanel"]')
    expect(panel.classes()).not.toContain('q-tab-panel')
  })
})
