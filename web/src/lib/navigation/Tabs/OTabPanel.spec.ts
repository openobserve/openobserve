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
} = {}) {
  const activeTab = options.activeTab ?? 'tab1'
  const keepAlive = options.keepAlive ?? false
  const animated = options.animated ?? false

  return mount(OTabPanel, {
    props: {
      name: options.name ?? 'tab1',
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

  // --- No default padding ---

  it('does not add default padding (consumers own their layout)', () => {
    const wrapper = mountTabPanel({ name: 'tab1', activeTab: 'tab1' })
    const panel = wrapper.find('[role="tabpanel"]')
    // Should not have Quasar's default q-tab-panel padding class
    expect(panel.classes()).not.toContain('tw:p-4')
    expect(panel.classes()).not.toContain('q-tab-panel')
  })
})
