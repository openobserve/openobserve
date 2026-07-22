// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, VueWrapper, flushPromises } from '@vue/test-utils'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

import BrowserJourney from './BrowserJourney.vue'

// Stubs emit native-component click so parent @click handlers fire.
const OButtonStub = { template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>' }
const OIconStub = { template: '<i />' }
const OBadgeStub = { template: '<span><slot /></span>' }
const OInputStub = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
}
const OSelectStub = {
  props: ['modelValue', 'options', 'label', 'error', 'errorMessage'],
  template: '<select v-bind="$attrs" />',
}
const OCheckboxStub = {
  props: ['modelValue', 'size'],
  template: '<input type="checkbox" v-bind="$attrs" />',
}
const OTooltipStub = {
  props: ['content'],
  template: '<div />',
}
const JourneyStepsStub = {
  props: ['data', 'mode', 'selectedIds', 'expandedIds'],
  template: '<div class="journey-steps-stub" :data-test-multi="$attrs[\'data-test\']"><div v-for="item in data" :key="item.id" class="step-row">{{ item.name }}</div></div>',
}

// Stub that renders the expansion slot so inline-editor interactions (selector,
// value, timeout inputs) can be tested through the DOM.
const JourneyStepsStubWithExpansion = {
  props: ['data', 'mode', 'selectedIds', 'expandedIds', 'selectionEnabled', 'locked', 'readonly'],
  template: `
    <div class="journey-steps-stub" :data-test-multi="$attrs['data-test']">
      <div v-for="item in data" :key="item.id" class="step-row">
        {{ item.name }}
        <slot name="expansion" :row="item" />
      </div>
    </div>`,
}

const ConfirmDialogStub = {
  template: '<div class="confirm-dialog-stub" />',
}

// Minimal stubs for components used in the expansion slot and toolbar.
const OSelectStub = {
  props: ['modelValue', 'options', 'label', 'error', 'errorMessage'],
  emits: ['update:modelValue'],
  template: '<select v-bind="$attrs" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select>',
}
const OTooltipStub = {
  props: ['content'],
  template: '<span class="tooltip-stub" />',
}
const OCheckboxStub = {
  props: ['modelValue', 'size', 'class'],
  emits: ['update:modelValue'],
  template: '<input type="checkbox" v-bind="$attrs" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
}

const STUBS = {
  OButton: OButtonStub,
  OIcon: OIconStub,
  OBadge: OBadgeStub,
  OInput: OInputStub,
  OSelect: OSelectStub,
  OCheckbox: OCheckboxStub,
  OTooltip: OTooltipStub,
  JourneySteps: JourneyStepsStub,
  ConfirmDialog: ConfirmDialogStub,
  OSelect: OSelectStub,
  OTooltip: OTooltipStub,
  OCheckbox: OCheckboxStub,
}

// ── Bridge transport helpers ──────────────────────────────────────────────

let postMessageSpy: ReturnType<typeof vi.fn>

function getLastCommandNonce(): string | null {
  const calls = postMessageSpy.mock.calls
  for (let i = calls.length - 1; i >= 0; i--) {
    const data = calls[i]?.[0]
    if (data?.msg?.type === 'synthetics-command') return data.nonce as string
  }
  return null
}

function respondToLastCommand(msg: unknown) {
  const nonce = getLastCommandNonce()
  if (!nonce) throw new Error('No pending command nonce to respond to')
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      data: { ch: 'oo-bridge', dir: 'to-page', nonce, msg },
    }),
  )
}

function emitStreamEvent(payload: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      data: {
        ch: 'oo-bridge',
        dir: 'to-page',
        msg: { type: 'synthetics-recorder', recordingId: 'rec_1', payload },
      },
    }),
  )
}

async function settleProbeDelay() {
  await vi.advanceTimersByTimeAsync(500)
}

// ── Mount helper ──────────────────────────────────────────────────────────

function mountJourney(props: Record<string, unknown> = {}) {
  return mount(BrowserJourney, {
    props: { modelValue: [], ...props },
    global: { stubs: STUBS },
  }) as VueWrapper
}

describe('BrowserJourney recording', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    postMessageSpy = vi.fn()
    vi.spyOn(window, 'postMessage').mockImplementation(postMessageSpy)
    vi.useFakeTimers()
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('should emit need-extension-setup when recording without a ready extension', async () => {
    wrapper = mountJourney({ extensionReady: false })

    await wrapper.find('[data-test="synthetics-journey-record-btn"]').trigger('click')

    expect(wrapper.emitted('need-extension-setup')).toBeTruthy()
    expect(wrapper.emitted('update:modelValue')).toBeFalsy()
  })

  it('should start recording and render streamed live steps', async () => {
    wrapper = mountJourney({ extensionReady: true, startUrl: 'https://app.test/login' })

    await wrapper.find('[data-test="synthetics-journey-record-btn"]').trigger('click')

    // The composable sends a probe then waits 500ms before sending the command.
    await settleProbeDelay()
    respondToLastCommand({ success: true })
    await flushPromises()

    // PostMessage should have been called (probe + command)
    expect(postMessageSpy).toHaveBeenCalled()
    // Stop button should be visible now that isRecording is true
    expect(wrapper.find('[data-test="synthetics-journey-stop-btn"]').exists()).toBe(true)

    // Stream steps via the bridge
    emitStreamEvent({
      method: 'setActions',
      browserSteps: [{ id: 's1', action: 'click', name: 'Click login', selector: '#login' }],
    })
    await flushPromises()

    expect(wrapper.findAll('.step-row')).toHaveLength(1)
    expect(wrapper.find('.step-row').text()).toBe('Click login')
  })

  it('should merge recorded steps into the journey on stop', async () => {
    wrapper = mountJourney({ modelValue: [], extensionReady: true })

    await wrapper.find('[data-test="synthetics-journey-record-btn"]').trigger('click')

    await settleProbeDelay()
    respondToLastCommand({ success: true })
    await flushPromises()

    // Steps stream in live over the bridge, then Stop merges them.
    emitStreamEvent({
      method: 'setActions',
      browserSteps: [{ id: 's1', action: 'navigate', url: 'https://app.test' }],
    })
    await flushPromises()

    await wrapper.find('[data-test="synthetics-journey-stop-btn"]').trigger('click')
    respondToLastCommand({ success: true })
    await flushPromises()

    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    const finalSteps = emitted![emitted!.length - 1][0] as any[]
    expect(finalSteps).toHaveLength(1)
    expect(finalSteps[0].action).toBe('navigate')
    expect(finalSteps[0].value).toBe('https://app.test')
  })

  it('should auto-start recording on mount when autoRecord is set', async () => {
    wrapper = mountJourney({ extensionReady: true, autoRecord: true, startUrl: 'https://app.test' })

    await settleProbeDelay()
    respondToLastCommand({ success: true })
    await flushPromises()

    expect(postMessageSpy).toHaveBeenCalled()
    expect(wrapper.find('[data-test="synthetics-journey-stop-btn"]').exists()).toBe(true)
  })

  it('should sync selector edit into step.wire when handleStepUpdate fires', async () => {
    const wire = { id: 'w1', action: 'click', selector: '#old', name: 'Old Click', selector_type: 'css' }
    const step = { id: 's1', action: 'click', name: 'Old Click', selector: '#old', timeout: 30000, code: '', wire }

    wrapper = mount(BrowserJourney, {
      props: { modelValue: [step] },
      global: {
        stubs: { ...STUBS, JourneySteps: JourneyStepsStubWithExpansion },
      },
    })

    // The expansion slot renders an OInput for the selector with
    // data-test="synthetics-journey-step-selector-input". Update its value.
    const selectorInput = wrapper.find('[data-test="synthetics-journey-step-selector-input"]')
    await selectorInput.setValue('#new')

    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    const updatedSteps = emitted![emitted!.length - 1][0] as any[]
    expect(updatedSteps[0].selector).toBe('#new')
    expect(updatedSteps[0].wire.selector).toBe('#new')
  })

  it('should emit clear-results when modelValue becomes empty', async () => {
    wrapper = mountJourney({
      modelValue: [{ id: 's1', action: 'click', name: 'Step 1', code: '' }],
    })

    // Clearing all steps should trigger the length watcher to emit clear-results
    // so the replay pass/fail banner does not persist.
    await wrapper.setProps({ modelValue: [] })

    expect(wrapper.emitted('clear-results')).toBeTruthy()
  })
})
