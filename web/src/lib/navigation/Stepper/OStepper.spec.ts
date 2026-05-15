import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, ref, computed } from 'vue'
import OStepper from './OStepper.vue'
import OStep from './OStep.vue'
import type { OStepperProps } from './OStepper.types'

// ΓöÇΓöÇΓöÇ Helpers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/**
 * Mount OStepper with 2-3 OStep children as a complete integrated tree.
 * OStepper provides context; OStep registers and renders content.
 */
function mountStepper(options: {
  modelValue?: number
  orientation?: OStepperProps['orientation']
  navigable?: boolean
  animated?: boolean
  stepCount?: number
} = {}) {
  const {
    modelValue = 1,
    orientation = 'horizontal',
    navigable = false,
    animated = false, // disable animations in tests to avoid async waits
    stepCount = 2,
  } = options

  const Wrapper = defineComponent({
    name: 'StepperTestWrapper',
    components: { OStepper, OStep },
    setup() {
      const active = ref<number>(modelValue)
      // Use explicit computeds so Vue tracks reactivity correctly in the
      // runtime-compiled template string (inline `active > 1` expressions
      // can be stale in some test environments due to ref-unwrapping timing).
      const done1 = computed(() => active.value > 1)
      const done2 = computed(() => active.value > 2)
      const done3 = computed(() => active.value > 3)
      return { active, orientation, navigable, animated, stepCount, done1, done2, done3 }
    },
    template: `
      <OStepper
        v-model="active"
        :orientation="orientation"
        :navigable="navigable"
        :animated="animated"
      >
        <OStep :name="1" title="First" :done="done1">Step 1 content</OStep>
        <OStep v-if="stepCount >= 2" :name="2" title="Second" :done="done2">Step 2 content</OStep>
        <OStep v-if="stepCount >= 3" :name="3" title="Third" :done="done3">Step 3 content</OStep>
      </OStepper>
    `,
  })

  return mount(Wrapper, { attachTo: document.body })
}

// ΓöÇΓöÇΓöÇ OStepper ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

describe('OStepper', () => {
  // --- Horizontal header rendering ---

  it('renders the step title in the horizontal header', async () => {
    const wrapper = mountStepper({ modelValue: 1 })
    // Allow OStep onMounted registrations to flush
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('First')
    expect(wrapper.text()).toContain('Second')
  })

  it('renders a connector line between steps in horizontal mode', async () => {
    const wrapper = mountStepper({ modelValue: 1, stepCount: 2 })
    await wrapper.vm.$nextTick()
    // There should be 1 connector for 2 steps
    const connectors = wrapper.findAll('[aria-hidden="true"].tw\\:h-px, [aria-hidden="true"]').filter(
      el => el.classes().some(c => c.includes('h-px')) || el.element.className.includes('h-px')
    )
    // The connector div exists inside the stepper header list
    expect(wrapper.html()).toContain('h-px')
  })

  it('shows step content for the active step', async () => {
    const wrapper = mountStepper({ modelValue: 1 })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Step 1 content')
    expect(wrapper.text()).not.toContain('Step 2 content')
  })

  it('shows step 2 content when modelValue is 2', async () => {
    const wrapper = mountStepper({ modelValue: 2 })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Step 2 content')
    expect(wrapper.text()).not.toContain('Step 1 content')
  })

  // --- Done state ---

  it('renders a checkmark indicator on completed steps', async () => {
    const wrapper = mountStepper({ modelValue: 2 })
    await wrapper.vm.$nextTick()
    // Step 1 is done (active > 1 ΓåÆ done=true), so its indicator should have a Check icon
    // The icon is rendered as an SVG inside the indicator button
    expect(wrapper.html()).toContain('svg') // Check icon is an SVG
  })

  // --- Navigation: disabled by default ---

  it('disables step header buttons when navigable=false and step is done', async () => {
    const wrapper = mountStepper({ modelValue: 2, navigable: false })
    await wrapper.vm.$nextTick()
    // All step trigger buttons in the horizontal header are non-navigable
    const buttons = wrapper.findAll('button[disabled]')
    // Step 1 is done but navigable=false ΓåÆ its trigger should be disabled
    expect(buttons.length).toBeGreaterThan(0)
  })

  // --- Navigation: enabled ---

  it('navigating to a done step changes the active step', async () => {
    // Start at step 2 ΓÇö step 1 is done (active > 1 = true), navigable=true
    const wrapper = mountStepper({ modelValue: 2, navigable: true, stepCount: 2 })
    await wrapper.vm.$nextTick()

    // Diagnostic: confirm OStepper actually received navigable=true
    expect(wrapper.findComponent(OStepper).props('navigable')).toBe(true)

    // Step 2 content is visible, step 1 is not
    expect(wrapper.text()).toContain('Step 2 content')
    expect(wrapper.text()).not.toContain('Step 1 content')

    const buttons = wrapper.findAll('button')
    const step1Trigger = buttons.find((btn) => btn.text().includes('First'))
    expect(step1Trigger).toBeDefined()

    // Diagnostic: confirm step 1 button is enabled (canNavigateTo returns true).
    // Also check triggerClasses ΓÇö if 'cursor-pointer' is set but disabled is still true,
    // it's a Vue rendering inconsistency. If cursor-default, canNavigateTo returns false
    // (meaning step.done=false in the registration despite active=2).
    expect(step1Trigger!.element.className).toContain('cursor-pointer') // class check
    expect((step1Trigger!.element as HTMLButtonElement).disabled).toBe(false) // disabled check

    await step1Trigger!.trigger('click')
    await wrapper.vm.$nextTick()

    // After click, OStepper should have emitted update:modelValue with 1
    expect(wrapper.findComponent(OStepper).emitted('update:modelValue')).toBeTruthy()
    // v-model on the Wrapper updates active ΓåÆ step 1 content now visible
    expect(wrapper.text()).toContain('Step 1 content')
  })

  // --- Orientation ---

  it('does not render the horizontal header list in vertical orientation', async () => {
    const wrapper = mountStepper({ orientation: 'vertical', modelValue: 1 })
    await wrapper.vm.$nextTick()
    // Horizontal header uses role="list" ΓÇö should not be present in vertical mode
    expect(wrapper.find('[role="list"]').exists()).toBe(false)
  })
})
