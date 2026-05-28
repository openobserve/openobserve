import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, ref, provide, computed, nextTick } from 'vue'
import OStep from './OStep.vue'
import { STEPPER_CONTEXT_KEY, STEPPER_REGISTER_KEY } from './OStepper.types'
import type { StepperContext, StepperRegisterAPI, StepRegistration } from './OStepper.types'

// ΓöÇΓöÇΓöÇ Helpers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/**
 * Mount OStep with a manually provided stepper context and registration API.
 * This mirrors the OTab spec approach: wrap in a defineComponent that provides
 * the required symbols so OStep's inject calls resolve correctly.
 */
function mountStep(options: {
  name?: number
  title?: string
  done?: boolean
  error?: boolean
  description?: string
  navigable?: boolean
  // Context overrides
  modelValue?: number
  orientation?: StepperContext['orientation']
  animated?: boolean
  rootNavigable?: boolean
  slots?: Record<string, string>
} = {}) {
  const {
    name = 1,
    title = 'Step One',
    done = false,
    error = false,
    description,
    navigable,
    modelValue = 1,
    orientation = 'horizontal',
    animated = false, // disable animations in unit tests
    rootNavigable = false,
    slots = { default: 'Step content' },
  } = options

  const onStepClick = vi.fn()
  const registeredSteps: Map<number, StepRegistration> = new Map()

  const Wrapper = defineComponent({
    name: 'StepTestWrapper',
    components: { OStep },
    setup() {
      provide(
        STEPPER_CONTEXT_KEY,
        computed<StepperContext>(() => ({
          modelValue,
          orientation,
          navigable: rootNavigable,
          animated,
          onStepClick,
        })),
      )

      provide<StepperRegisterAPI>(STEPPER_REGISTER_KEY, {
        registerStep: (step) => registeredSteps.set(step.name, step),
        unregisterStep: (n) => registeredSteps.delete(n),
        updateStep: (step) => { if (registeredSteps.has(step.name)) registeredSteps.set(step.name, step) },
      })

      return { name, title, done, error, description, navigable }
    },
    template: `
      <OStep
        :name="name"
        :title="title"
        :done="done"
        :error="error"
        :description="description"
        :navigable="navigable"
      ><slot /></OStep>
    `,
  })

  return {
    wrapper: mount(Wrapper, { slots, attachTo: document.body }),
    onStepClick,
    registeredSteps,
  }
}

// ΓöÇΓöÇΓöÇ OStep ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

describe('OStep', () => {
  // --- Content visibility ---

  it('shows content when the step is active (modelValue === name)', async () => {
    const { wrapper } = mountStep({ name: 1, modelValue: 1 })
    await nextTick()
    expect(wrapper.text()).toContain('Step content')
  })

  it('hides content when the step is not active', async () => {
    const { wrapper } = mountStep({ name: 2, modelValue: 1 })
    await nextTick()
    expect(wrapper.text()).not.toContain('Step content')
  })

  // --- Registration ---

  it('registers itself with the parent stepper on mount', async () => {
    const { registeredSteps } = mountStep({ name: 1, title: 'My Step' })
    await nextTick()
    expect(registeredSteps.has(1)).toBe(true)
    expect(registeredSteps.get(1)?.title).toBe('My Step')
  })

  it('registers done=true when done prop is true', async () => {
    const { registeredSteps } = mountStep({ name: 1, done: true })
    await nextTick()
    expect(registeredSteps.get(1)?.done).toBe(true)
  })

  // --- Vertical layout ---

  it('renders a trigger button with aria-current="step" when active in vertical mode', async () => {
    const { wrapper } = mountStep({
      name: 1,
      modelValue: 1,
      orientation: 'vertical',
    })
    await nextTick()
    const buttons = wrapper.findAll('button[aria-current="step"]')
    expect(buttons.length).toBeGreaterThan(0)
  })

  it('does NOT render aria-current on an inactive step in vertical mode', async () => {
    const { wrapper } = mountStep({
      name: 2,
      modelValue: 1,
      orientation: 'vertical',
    })
    await nextTick()
    expect(wrapper.find('[aria-current="step"]').exists()).toBe(false)
  })

  // --- Done indicator ---

  it('renders a checkmark SVG when done=true in vertical mode', async () => {
    const { wrapper } = mountStep({
      name: 1,
      done: true,
      orientation: 'vertical',
    })
    await nextTick()
    // Check icon is rendered as SVG inside the indicator button
    expect(wrapper.find('button svg').exists()).toBe(true)
  })

  // --- Error indicator ---

  it('renders an error SVG icon when error=true in vertical mode', async () => {
    const { wrapper } = mountStep({
      name: 1,
      error: true,
      orientation: 'vertical',
    })
    await nextTick()
    expect(wrapper.find('button svg').exists()).toBe(true)
  })

  // --- Description ---

  it('renders description text when provided in vertical mode', async () => {
    const { wrapper } = mountStep({
      name: 1,
      orientation: 'vertical',
      description: 'Setup your account',
    })
    await nextTick()
    expect(wrapper.text()).toContain('Setup your account')
  })

  // --- Navigation: vertical trigger click ---

  it('calls onStepClick when the vertical trigger is clicked and step is navigable', async () => {
    const { wrapper, onStepClick } = mountStep({
      name: 1,
      done: true,
      navigable: true,
      orientation: 'vertical',
    })
    await nextTick()
    // The first button in vertical mode is the indicator circle
    const triggerBtn = wrapper.find('button:not([disabled])')
    expect(triggerBtn.exists()).toBe(true)
    await triggerBtn.trigger('click')
    expect(onStepClick).toHaveBeenCalledWith(1)
  })

  it('does NOT call onStepClick when the step is not done (even if navigable)', async () => {
    const { wrapper, onStepClick } = mountStep({
      name: 1,
      done: false,
      navigable: true,
      orientation: 'vertical',
    })
    await nextTick()
    const buttons = wrapper.findAll('button')
    for (const btn of buttons) {
      await btn.trigger('click')
    }
    expect(onStepClick).not.toHaveBeenCalled()
  })

  // --- Horizontal content panel ---

  it('renders the content panel with role="region" in horizontal mode when active', async () => {
    const { wrapper } = mountStep({
      name: 1,
      modelValue: 1,
      orientation: 'horizontal',
    })
    await nextTick()
    expect(wrapper.find('[role="region"]').exists()).toBe(true)
  })

  it('omits the region panel in horizontal mode when not active', async () => {
    const { wrapper } = mountStep({
      name: 2,
      modelValue: 1,
      orientation: 'horizontal',
    })
    await nextTick()
    expect(wrapper.find('[role="region"]').exists()).toBe(false)
  })
})
