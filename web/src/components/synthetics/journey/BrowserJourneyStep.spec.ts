// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'

// ── Stubs ──────────────────────────────────────────────────────────────────
const OButtonStub = {
  template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
}
const OIconStub = {
  template: '<i :data-icon="$attrs.name" />',
}
const OBadgeStub = {
  template: '<span class="badge-stub"><slot /></span>',
}
const OInputStub = {
  props: ['modelValue', 'label', 'placeholder', 'type'],
  emits: ['update:modelValue'],
  template: '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" :data-label="label" />',
}
const OSelectStub = {
  props: ['modelValue', 'label', 'options'],
  emits: ['update:modelValue'],
  template: '<select v-bind="$attrs" @change="$emit(\'update:modelValue\', $event.target.value)" :data-label="label"><option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select>',
}
const OCheckboxStub = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<input type="checkbox" v-bind="$attrs" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
}
const OSpinnerStub = {
  template: '<div class="spinner-stub" />',
}

vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: vi.fn(),
}));

import i18n from "@/locales";
import BrowserJourneyStep from "./BrowserJourneyStep.vue";
import type { BrowserStep } from '@/types/synthetics'

// ── Factory ────────────────────────────────────────────────────────────────
function makeStep(overrides: Partial<BrowserStep> = {}): BrowserStep {
  return {
    id: 'step-1',
    action: 'navigate',
    name: 'Open page',
    value: 'https://example.com',
    timeout: 30000,
    code: '',
    ...overrides,
  }
}

function mountStep(props: Record<string, unknown> = {}) {
  return mount(BrowserJourneyStep, {
    props: {
      step: makeStep(),
      index: 0,
      ...props,
    },
    global: {
      plugins: [i18n],
      stubs: {
        OButton: OButtonStub,
        OIcon: OIconStub,
        OBadge: OBadgeStub,
        OInput: OInputStub,
        OSelect: OSelectStub,
        OCheckbox: OCheckboxStub,
        OSpinner: OSpinnerStub,
      },
    },
  }) as VueWrapper
}

describe('BrowserJourneyStep', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
    vi.clearAllMocks()
  })

  // ── Initial Render ───────────────────────────────────────────────────────
  describe('initial render', () => {
    it('should render action icon for the step action', () => {
      wrapper = mountStep({ step: makeStep({ action: 'click', name: 'Click login', selector: '#login' }) })

      const icon = wrapper.find('[data-icon="ads-click"]')
      expect(icon.exists()).toBe(true)
    })

    it('should render the action label badge', () => {
      wrapper = mountStep({ step: makeStep({ action: 'click', name: 'Click login' }) })

      const badge = wrapper.find('.badge-stub')
      expect(badge.exists()).toBe(true)
      expect(badge.text()).toBe('Click')
    })

    it('should render step display name', () => {
      wrapper = mountStep({ step: makeStep({ action: 'click', name: 'Click login' }) })

      expect(wrapper.text()).toContain('Click login')
    })

    it('should render selector preview text', () => {
      wrapper = mountStep({ step: makeStep({ action: 'click', selector: '#login-btn' }) })

      expect(wrapper.text()).toContain('#login-btn')
    })

    it('should render value as preview when no selector', () => {
      wrapper = mountStep({ step: makeStep({ action: 'navigate', value: 'https://example.com' }) })

      expect(wrapper.text()).toContain('https://example.com')
    })

    it('should show step index plus one', () => {
      wrapper = mountStep({ step: makeStep(), index: 2 })

      expect(wrapper.text()).toContain('3')
    })

    it('should render a checkbox for selection', () => {
      wrapper = mountStep()

      const checkbox = wrapper.find('[data-test="synthetics-journey-step-checkbox-0"]')
      expect(checkbox.exists()).toBe(true)
    })
  })

  // ── Expand / Collapse ────────────────────────────────────────────────────
  describe('expanded editor', () => {
    it('should show editor fields when expanded', () => {
      wrapper = mountStep({ step: makeStep({ action: 'click', selector: '#btn' }), expanded: true })

      const actionSelect = wrapper.find('[data-test="synthetics-journey-step-action-select"]')
      expect(actionSelect.exists()).toBe(true)
    })

    it('should hide editor fields when not expanded', () => {
      wrapper = mountStep({ step: makeStep({ action: 'click' }), expanded: false })

      const actionSelect = wrapper.find('[data-test="synthetics-journey-step-action-select"]')
      expect(actionSelect.exists()).toBe(false)
    })

    it('should show selector fields for click action', () => {
      wrapper = mountStep({ step: makeStep({ action: 'click', selector: '#btn' }), expanded: true })

      const selectorInput = wrapper.find('[data-test="synthetics-journey-step-selector-input"]')
      const selectorTypeSelect = wrapper.find('[data-test="synthetics-journey-step-selector-type-select"]')
      expect(selectorInput.exists()).toBe(true)
      expect(selectorTypeSelect.exists()).toBe(true)
    })

    it('should hide selector fields for navigate action', () => {
      wrapper = mountStep({ step: makeStep({ action: 'navigate', value: 'https://example.com' }), expanded: true })

      const selectorInput = wrapper.find('[data-test="synthetics-journey-step-selector-input"]')
      expect(selectorInput.exists()).toBe(false)
    })

    it('should show value input for type action', () => {
      wrapper = mountStep({ step: makeStep({ action: 'type', selector: '#input', value: 'hello' }), expanded: true })

      const valueInput = wrapper.find('[data-test="synthetics-journey-step-value-input"]')
      expect(valueInput.exists()).toBe(true)
    })

    it('should show value input for navigate action', () => {
      wrapper = mountStep({ step: makeStep({ action: 'navigate', value: 'https://example.com' }), expanded: true })

      const valueInput = wrapper.find('[data-test="synthetics-journey-step-value-input"]')
      expect(valueInput.exists()).toBe(true)
    })

    it('should show timeout input when expanded', () => {
      wrapper = mountStep({ step: makeStep(), expanded: true })

      const timeoutInput = wrapper.find('[data-test="synthetics-journey-step-timeout-input"]')
      expect(timeoutInput.exists()).toBe(true)
    })

    it('should show step name input when expanded', () => {
      wrapper = mountStep({ step: makeStep({ name: 'My Step' }), expanded: true })

      const nameInput = wrapper.find('[data-test="synthetics-journey-step-name-input"]')
      expect(nameInput.exists()).toBe(true)
    })
  })

  // ── Emit Events ──────────────────────────────────────────────────────────
  describe('emit events', () => {
    it('should emit toggle-select when checkbox is toggled', async () => {
      wrapper = mountStep()

      const checkbox = wrapper.find('[data-test="synthetics-journey-step-checkbox-0"]')
      await checkbox.trigger('change')

      expect(wrapper.emitted('toggle-select')).toBeTruthy()
    })

    it('should emit update:expanded when expand button is clicked', async () => {
      wrapper = mountStep()

      const expandBtn = wrapper.find('[data-test="synthetics-journey-step-expand-btn"]')
      await expandBtn.trigger('click')

      expect(wrapper.emitted('update:expanded')).toBeTruthy()
      expect(wrapper.emitted('update:expanded')?.[0]).toEqual([true])
    })

    it('should emit delete when delete button is clicked', async () => {
      wrapper = mountStep()

      const deleteBtn = wrapper.find('[data-test="synthetics-journey-step-delete-btn"]')
      await deleteBtn.trigger('click')

      expect(wrapper.emitted('delete')).toBeTruthy()
    })

    it('should emit duplicate when duplicate button is clicked', async () => {
      wrapper = mountStep()

      const duplicateBtn = wrapper.find('[data-test="synthetics-journey-step-duplicate-btn"]')
      await duplicateBtn.trigger('click')

      expect(wrapper.emitted('duplicate')).toBeTruthy()
    })

    it('should emit insert-below when insert button is clicked', async () => {
      wrapper = mountStep()

      const insertBtn = wrapper.find('[data-test="synthetics-journey-step-insert-btn"]')
      await insertBtn.trigger('click')

      expect(wrapper.emitted('insert-below')).toBeTruthy()
    })

    it('should emit update:step when value field is changed', async () => {
      wrapper = mountStep({ step: makeStep({ action: 'navigate', value: 'https://old.example.com' }), expanded: true })

      const valueInput = wrapper.find('[data-test="synthetics-journey-step-value-input"]')
      await valueInput.setValue('https://new.example.com')

      const emitted = wrapper.emitted('update:step')
      expect(emitted).toBeTruthy()
      expect((emitted![0][0] as BrowserStep).value).toBe('https://new.example.com')
    })

    it('should emit update:step when name field is changed', async () => {
      wrapper = mountStep({ step: makeStep({ name: 'Old name' }), expanded: true })

      const nameInput = wrapper.find('[data-test="synthetics-journey-step-name-input"]')
      await nameInput.setValue('New name')

      const emitted = wrapper.emitted('update:step')
      expect(emitted).toBeTruthy()
      expect((emitted![0][0] as BrowserStep).name).toBe('New name')
    })
  })

  // ── Replay State ─────────────────────────────────────────────────────────
  describe('replay state', () => {
    it('should hide row action buttons when replayLocked is true', () => {
      wrapper = mountStep({ step: makeStep(), replayLocked: true })

      const deleteBtn = wrapper.find('[data-test="synthetics-journey-step-delete-btn"]')
      const duplicateBtn = wrapper.find('[data-test="synthetics-journey-step-duplicate-btn"]')
      const insertBtn = wrapper.find('[data-test="synthetics-journey-step-insert-btn"]')

      expect(deleteBtn.attributes('disabled')).toBeDefined()
      expect(duplicateBtn.attributes('disabled')).toBeDefined()
      expect(insertBtn.attributes('disabled')).toBeDefined()
    })

    it('should show active spinner when replayDotState is active', () => {
      wrapper = mountStep({ step: makeStep(), replayDotState: 'active' })

      const spinner = wrapper.find('.spinner-stub')
      expect(spinner.exists()).toBe(true)
    })

    it('should show error card when replayDotState is fail with error', () => {
      wrapper = mountStep({
        step: makeStep(),
        replayDotState: 'fail',
        replayResult: {
          stepId: 'step-1',
          stepName: 'Click login',
          passed: false,
          durationMs: 1500,
          error: 'Element not found',
        },
      })

      const errorCard = wrapper.find('[data-test="synthetics-journey-step-error-card"]')
      expect(errorCard.exists()).toBe(true)
      expect(errorCard.text()).toContain('Element not found')
    })

    it('should not show error card when replayDotState is fail without error', () => {
      wrapper = mountStep({
        step: makeStep(),
        replayDotState: 'fail',
        replayResult: {
          stepId: 'step-1',
          stepName: 'Click login',
          passed: false,
          durationMs: 1500,
        },
      })

      const errorCard = wrapper.find('[data-test="synthetics-journey-step-error-card"]')
      expect(errorCard.exists()).toBe(false)
    })

    it('should show error card with structured error message', () => {
      wrapper = mountStep({
        step: makeStep(),
        replayDotState: 'fail',
        replayResult: {
          stepId: 'step-1',
          stepName: 'Click login',
          passed: false,
          durationMs: 1500,
          error: 'Timeout waiting for element',
          structuredError: {
            message: 'Timeout 30000ms exceeded',
            name: 'TimeoutError',
            selector: '#login-btn',
          },
        },
      })

      const errorCard = wrapper.find('[data-test="synthetics-journey-step-error-card"]')
      expect(errorCard.exists()).toBe(true)
      // Component maps 'TimeoutError' name to human label 'Timeout Error'
      expect(errorCard.text()).toContain('Timeout Error')
      expect(errorCard.text()).toContain('Timeout 30000ms exceeded')
    })

    it('should emit retry-replay from error card', async () => {
      wrapper = mountStep({
        step: makeStep(),
        replayDotState: 'fail',
        replayResult: {
          stepId: 'step-1',
          stepName: 'Click login',
          passed: false,
          durationMs: 1500,
          error: 'Element not found',
        },
      })

      const retryBtn = wrapper.find('[data-test="synthetics-journey-error-retry-btn"]')
      expect(retryBtn.exists()).toBe(true)
      await retryBtn.trigger('click')

      expect(wrapper.emitted('retry-replay')).toBeTruthy()
    })

    it('should render step dot with correct data-test for active state', () => {
      wrapper = mountStep({ step: makeStep(), replayDotState: 'active', index: 2 })

      const dot = wrapper.find('[data-test="synthetics-journey-step-dot-2"]')
      expect(dot.exists()).toBe(true)
    })

    it('should render pass dot state', () => {
      wrapper = mountStep({ step: makeStep(), replayDotState: 'pass', index: 0 })

      const dot = wrapper.find('[data-test="synthetics-journey-step-dot-0"]')
      expect(dot.exists()).toBe(true)
    })
  })
})
