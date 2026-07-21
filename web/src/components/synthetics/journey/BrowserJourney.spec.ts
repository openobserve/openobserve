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
  template: '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
}
const JourneyStepsStub = {
  props: ['data', 'mode', 'selectedIds', 'expandedIds'],
  template: '<div class="journey-steps-stub" :data-test-multi="$attrs[\'data-test\']"><div v-for="item in data" :key="item.id" class="step-row">{{ item.name }}</div></div>',
}

const ConfirmDialogStub = {
  template: '<div class="confirm-dialog-stub" />',
}

const STUBS = {
  OButton: OButtonStub,
  OIcon: OIconStub,
  OBadge: OBadgeStub,
  OInput: OInputStub,
  JourneySteps: JourneyStepsStub,
  ConfirmDialog: ConfirmDialogStub,
}

interface FakePort {
  postMessage: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  onMessage: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> }
  onDisconnect: { addListener: ReturnType<typeof vi.fn> }
  emit: (msg: unknown) => void
}

function makePort(): FakePort {
  let listener: ((msg: unknown) => void) | null = null
  return {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener: vi.fn((fn: (msg: unknown) => void) => { listener = fn }),
      removeListener: vi.fn(() => { listener = null }),
    },
    onDisconnect: { addListener: vi.fn() },
    emit: (msg: unknown) => listener?.(msg),
  }
}

function installChrome(handlers: Record<string, (cb: (r: unknown) => void) => void>, port: FakePort) {
  ;(globalThis as any).chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: vi.fn((_id: string, message: any, cb: (r: unknown) => void) => {
        handlers[message.command.action]?.(cb)
      }),
      connect: vi.fn(() => port),
    },
  }
}

function mountJourney(props: Record<string, unknown> = {}) {
  return mount(BrowserJourney, {
    props: { modelValue: [], ...props },
    global: { stubs: STUBS },
  }) as VueWrapper
}

describe('BrowserJourney recording', () => {
  let wrapper: VueWrapper
  let port: FakePort

  beforeEach(() => {
    port = makePort()
  })

  afterEach(() => {
    wrapper?.unmount()
    delete (globalThis as any).chrome
    vi.clearAllMocks()
  })

  it('should emit need-extension-setup when recording without a ready extension', async () => {
    installChrome({}, port)
    wrapper = mountJourney({ extensionReady: false })

    await wrapper.find('[data-test="synthetics-journey-record-btn"]').trigger('click')

    expect(wrapper.emitted('need-extension-setup')).toBeTruthy()
    expect(wrapper.emitted('update:modelValue')).toBeFalsy()
  })

  it('should start recording and render streamed live steps', async () => {
    installChrome({ startRecording: (cb) => cb({ success: true }) }, port)
    wrapper = mountJourney({ extensionReady: true, startUrl: 'https://app.test/login' })

    await wrapper.find('[data-test="synthetics-journey-record-btn"]').trigger('click')
    await flushPromises()

    expect((globalThis as any).chrome.runtime.connect).toHaveBeenCalled()
    expect(wrapper.find('[data-test="synthetics-journey-stop-btn"]').exists()).toBe(true)

    port.emit({ type: 'synthetics-recorder', recordingId: 'rec_1', payload: { method: 'setActions', browserSteps: [{ id: 's1', action: 'click', name: 'Click login', selector: '#login' }] } })
    await flushPromises()

    expect(wrapper.findAll('.step-row')).toHaveLength(1)
    expect(wrapper.find('.step-row').text()).toBe('Click login')
  })

  it('should merge recorded steps into the journey on stop', async () => {
    installChrome(
      {
        startRecording: (cb) => cb({ success: true }),
        stopRecording: (cb) => cb({ success: true }),
      },
      port,
    )
    wrapper = mountJourney({ modelValue: [], extensionReady: true })

    await wrapper.find('[data-test="synthetics-journey-record-btn"]').trigger('click')
    await flushPromises()
    // Steps stream in live over the port, then Stop merges them.
    port.emit({ type: 'synthetics-recorder', recordingId: 'rec_1', payload: { method: 'setActions', browserSteps: [{ id: 's1', action: 'navigate', url: 'https://app.test' }] } })
    await flushPromises()
    await wrapper.find('[data-test="synthetics-journey-stop-btn"]').trigger('click')
    await flushPromises()

    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    const finalSteps = emitted![emitted!.length - 1][0] as any[]
    expect(finalSteps).toHaveLength(1)
    expect(finalSteps[0].action).toBe('navigate')
    expect(finalSteps[0].value).toBe('https://app.test')
  })

  it('should auto-start recording on mount when autoRecord is set', async () => {
    installChrome({ startRecording: (cb) => cb({ success: true }) }, port)
    wrapper = mountJourney({ extensionReady: true, autoRecord: true, startUrl: 'https://app.test' })
    await flushPromises()

    expect((globalThis as any).chrome.runtime.connect).toHaveBeenCalled()
    expect(wrapper.find('[data-test="synthetics-journey-stop-btn"]').exists()).toBe(true)
  })
})
