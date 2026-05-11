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

  // --- Transition & focus ring (post-migration tweaks) ---

  it('applies the multi-property transition utility for smooth state changes', () => {
    const wrapper = mountTab()
    const classes = wrapper.find('[role="tab"]').classes()
    // The migration replaced `tw:transition-colors` with an explicit
    // multi-property transition that also animates border-color and box-shadow.
    expect(classes).toContain(
      'tw:transition-[color,background-color,border-color,text-decoration-color,fill,stroke,box-shadow]'
    )
    expect(classes).toContain('tw:duration-150')
    // Sanity: the old narrow utility should NOT be present anymore.
    expect(classes).not.toContain('tw:transition-colors')
  })

  it('renders ring offset utilities so the focus ring is visually separated from the tab edge', () => {
    const wrapper = mountTab()
    const classes = wrapper.find('[role="tab"]').classes()
    expect(classes).toContain('tw:ring-offset-1')
    expect(classes).toContain('tw:ring-offset-surface-base')
  })

  it('applies a focus-visible ring using the tabs indicator color', () => {
    const wrapper = mountTab()
    const classes = wrapper.find('[role="tab"]').classes()
    expect(classes).toContain('tw:focus-visible:outline-none')
    expect(classes).toContain('tw:focus-visible:ring-2')
    expect(classes).toContain('tw:focus-visible:ring-tabs-indicator')
  })

  it('keeps the focus ring utilities on disabled tabs (keyboard navigation still highlights them)', () => {
    const wrapper = mountTab({ disable: true })
    const classes = wrapper.find('[role="tab"]').classes()
    // Focus ring classes belong to baseClasses and must remain regardless of state.
    expect(classes).toContain('tw:focus-visible:ring-2')
    expect(classes).toContain('tw:focus-visible:ring-tabs-indicator')
    expect(classes).toContain('tw:ring-offset-1')
  })

  it('keeps the focus ring utilities on the active tab', () => {
    const wrapper = mountTab({ name: 'tab1', activeTab: 'tab1' })
    const classes = wrapper.find('[role="tab"]').classes()
    expect(classes).toContain('tw:focus-visible:ring-2')
    expect(classes).toContain('tw:focus-visible:ring-tabs-indicator')
    expect(classes).toContain('tw:ring-offset-surface-base')
  })
})
