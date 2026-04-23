import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, provide } from 'vue'
import OTab from './OTab.vue'
import { TABS_CONTEXT_KEY } from './OTabs.types'
import type { TabsContext } from './OTabs.types'

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Mount OTab with a simulated parent OTabs context */
function mountTab(options: {
  name?: string | number
  label?: string
  icon?: string
  disable?: boolean
  activeTab?: string | number
  isVertical?: boolean
  dense?: boolean
  slots?: Record<string, string>
} = {}) {
  const activeTab = options.activeTab ?? 'tab1'
  const isVertical = options.isVertical ?? false
  const dense = options.dense ?? false
  const onTabClickMock = { calls: [] as Array<string | number> }

  return mount(OTab, {
    props: {
      name: options.name ?? 'tab1',
      label: options.label,
      icon: options.icon,
      disable: options.disable,
    },
    slots: options.slots,
    global: {
      plugins: [
        {
          install(app) {
            // Simulate OTabs providing context as a computed ref
            app.provide(
              TABS_CONTEXT_KEY,
              computed<TabsContext>(() => ({
                modelValue: activeTab,
                isVertical,
                dense,
                onTabClick: (name: string | number) => {
                  onTabClickMock.calls.push(name)
                },
              }))
            )
          },
        },
      ],
    },
    attachTo: document.body,
  })
}

// ─── OTab ────────────────────────────────────────────────────────────────────

describe('OTab', () => {
  // --- ARIA ---

  it('renders with role="tab"', () => {
    const wrapper = mountTab()
    expect(wrapper.attributes('role')).toBe('tab')
  })

  it('sets aria-selected="true" when it is the active tab', () => {
    const wrapper = mountTab({ name: 'tab1', activeTab: 'tab1' })
    expect(wrapper.attributes('aria-selected')).toBe('true')
  })

  it('sets aria-selected="false" when it is not the active tab', () => {
    const wrapper = mountTab({ name: 'tab2', activeTab: 'tab1' })
    expect(wrapper.attributes('aria-selected')).toBe('false')
  })

  it('sets tabindex=0 on the active tab', () => {
    const wrapper = mountTab({ name: 'tab1', activeTab: 'tab1' })
    expect(wrapper.attributes('tabindex')).toBe('0')
  })

  it('sets tabindex=-1 on inactive tabs', () => {
    const wrapper = mountTab({ name: 'tab2', activeTab: 'tab1' })
    expect(wrapper.attributes('tabindex')).toBe('-1')
  })

  it('sets aria-disabled when disable is true', () => {
    const wrapper = mountTab({ disable: true })
    expect(wrapper.attributes('aria-disabled')).toBe('true')
  })

  // --- Label prop ---

  it('renders the label prop as text', () => {
    const wrapper = mountTab({ label: 'Overview' })
    expect(wrapper.text()).toContain('Overview')
  })

  it('does not render label span when label is not provided', () => {
    const wrapper = mountTab({ name: 'tab1' })
    expect(wrapper.find('.o-tab__label').exists()).toBe(false)
  })

  // --- Icon prop ---

  it('renders the icon when icon prop is provided', () => {
    const wrapper = mountTab({ icon: 'home' })
    expect(wrapper.find('.o-tab__icon').exists()).toBe(true)
    expect(wrapper.find('.o-tab__icon').text()).toBe('home')
  })

  // --- Default slot (custom content) ---

  it('renders default slot content instead of icon+label', () => {
    const wrapper = mountTab({
      slots: { default: '<span data-testid="custom">Custom Tab</span>' },
    })
    expect(wrapper.find('[data-testid="custom"]').exists()).toBe(true)
    // Label should NOT appear since slot content takes over
    expect(wrapper.find('.o-tab__label').exists()).toBe(false)
  })

  it('renders a badge inside the default slot', () => {
    const wrapper = mountTab({
      slots: { default: 'Logs <span class="badge">3</span>' },
    })
    expect(wrapper.find('.badge').exists()).toBe(true)
    expect(wrapper.find('.badge').text()).toBe('3')
  })

  // --- Click / disable ---

  it('has o-tab class', () => {
    const wrapper = mountTab()
    expect(wrapper.classes()).toContain('o-tab')
  })

  it('is a native button element', () => {
    const wrapper = mountTab()
    expect(wrapper.element.tagName).toBe('BUTTON')
  })

  it('is disabled when disable is true', () => {
    const wrapper = mountTab({ disable: true })
    expect(wrapper.attributes('disabled')).toBeDefined()
  })

  it('is not disabled by default', () => {
    const wrapper = mountTab()
    expect(wrapper.attributes('disabled')).toBeUndefined()
  })
})
