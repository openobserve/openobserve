import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, provide, computed } from 'vue'
import { TabsRoot, TabsList } from 'reka-ui'
import OTab from './OTab.vue'
import { TABS_CONTEXT_KEY } from './OTabs.types'
import type { TabsContext } from './OTabs.types'

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Mount OTab inside the required TabsRoot > TabsList ancestor chain that
 * TabsTrigger (used internally) needs for its context injection.
 * The TABS_CONTEXT_KEY context is also provided so OTab's isDense /
 * isVertical / isActive computed properties work correctly.
 */
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
  const {
    name = 'tab1',
    label,
    icon,
    disable = false,
    activeTab = 'tab1',
    isVertical = false,
    dense = false,
    slots = {},
  } = options

  const Wrapper = defineComponent({
    name: 'TabTestWrapper',
    components: { TabsRoot, TabsList, OTab },
    setup() {
      provide(
        TABS_CONTEXT_KEY,
        computed<TabsContext>(() => ({
          modelValue: activeTab,
          isVertical,
          dense,
          onTabClick: () => {},
        }))
      )
      return {
        tabProps: { name, label, icon, disable },
        modelValue: activeTab,
        orientation: isVertical ? 'vertical' : 'horizontal',
      }
    },
    template: `
      <TabsRoot :model-value="modelValue" :orientation="orientation">
        <TabsList>
          <OTab v-bind="tabProps"><slot /></OTab>
        </TabsList>
      </TabsRoot>
    `,
  })

  return mount(Wrapper, {
    slots,
    attachTo: document.body,
  })
}

// ─── OTab ────────────────────────────────────────────────────────────────────

describe('OTab', () => {
  // --- ARIA ---

  it('renders with role="tab"', () => {
    const wrapper = mountTab()
    expect(wrapper.find('[role="tab"]').attributes('role')).toBe('tab')
  })

  it('sets aria-selected="true" when it is the active tab', () => {
    const wrapper = mountTab({ name: 'tab1', activeTab: 'tab1' })
    expect(wrapper.find('[role="tab"]').attributes('aria-selected')).toBe('true')
  })

  it('sets aria-selected="false" when it is not the active tab', () => {
    const wrapper = mountTab({ name: 'tab2', activeTab: 'tab1' })
    expect(wrapper.find('[role="tab"]').attributes('aria-selected')).toBe('false')
  })

  it('has data-state="active" on the active tab', () => {
    const wrapper = mountTab({ name: 'tab1', activeTab: 'tab1' })
    expect(wrapper.find('[role="tab"]').attributes('data-state')).toBe('active')
  })

  it('has data-state="inactive" on inactive tabs', () => {
    const wrapper = mountTab({ name: 'tab2', activeTab: 'tab1' })
    expect(wrapper.find('[role="tab"]').attributes('data-state')).toBe('inactive')
  })

  it('sets aria-disabled when disable is true', () => {
    const wrapper = mountTab({ disable: true })
    expect(wrapper.find('[role="tab"]').attributes('aria-disabled')).toBe('true')
  })

  // --- Label prop ---

  it('renders the label prop as text', () => {
    const wrapper = mountTab({ label: 'Overview' })
    expect(wrapper.find('[role="tab"]').text()).toContain('Overview')
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

  // --- Element type + CSS class ---

  it('has o-tab class', () => {
    const wrapper = mountTab()
    expect(wrapper.find('[role="tab"]').classes()).toContain('o-tab')
  })

  it('is a native button element', () => {
    const wrapper = mountTab()
    expect(wrapper.find('[role="tab"]').element.tagName).toBe('BUTTON')
  })

  it('is disabled when disable is true', () => {
    const wrapper = mountTab({ disable: true })
    expect(wrapper.find('[role="tab"]').attributes('disabled')).toBeDefined()
  })

  it('is not disabled by default', () => {
    const wrapper = mountTab()
    expect(wrapper.find('[role="tab"]').attributes('disabled')).toBeUndefined()
  })
})
