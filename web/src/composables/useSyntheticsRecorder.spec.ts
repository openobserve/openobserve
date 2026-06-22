// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useSyntheticsRecorder from './useSyntheticsRecorder'
import type { WireStep } from '@/types/synthetics'

type CommandHandler = (cb: (response: unknown) => void) => void

interface FakePort {
  name: string
  postMessage: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  onMessage: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> }
  onDisconnect: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> }
  emit: (msg: unknown) => void
}

function makePort(): FakePort {
  let listener: ((msg: unknown) => void) | null = null
  return {
    name: 'synthetics-recording',
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener: vi.fn((fn: (msg: unknown) => void) => { listener = fn }),
      removeListener: vi.fn(() => { listener = null }),
    },
    onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
    emit: (msg: unknown) => listener?.(msg),
  }
}

function installChrome(handlers: Record<string, CommandHandler>, port: FakePort) {
  const runtime: any = {
    lastError: undefined,
    sendMessage: vi.fn((_id: string, message: any, cb: (r: unknown) => void) => {
      handlers[message.command.action]?.(cb)
    }),
    connect: vi.fn(() => port),
  }
  ;(globalThis as any).chrome = { runtime }
  return runtime
}

describe('useSyntheticsRecorder', () => {
  let port: FakePort

  beforeEach(() => {
    port = makePort()
  })

  afterEach(() => {
    delete (globalThis as any).chrome
    vi.clearAllMocks()
  })

  describe('detectExtension', () => {
    it('should return true when the extension replies (no installed field)', async () => {
      // Real getStatus payload — reachability is the install signal, not a flag.
      installChrome({ getStatus: (cb) => cb({ isRecording: false, mode: 'recording', tabId: null, stepCount: 0 }) }, port)
      const r = useSyntheticsRecorder()
      expect(await r.detectExtension()).toBe(true)
      expect(r.isInstalled.value).toBe(true)
    })

    it('should reflect an in-progress recording reported by getStatus', async () => {
      installChrome({ getStatus: (cb) => cb({ isRecording: true, mode: 'recording', tabId: 3, stepCount: 2 }) }, port)
      const r = useSyntheticsRecorder()
      expect(await r.detectExtension()).toBe(true)
      expect(r.isRecording.value).toBe(true)
    })

    it('should return false when chrome.runtime.lastError is set', async () => {
      const runtime = installChrome({ getStatus: (cb) => { runtime.lastError = { message: 'nope' }; cb(undefined) } }, port)
      const r = useSyntheticsRecorder()
      expect(await r.detectExtension()).toBe(false)
      expect(r.isInstalled.value).toBe(false)
    })

    it('should return false when chrome is unavailable', async () => {
      const r = useSyntheticsRecorder()
      expect(await r.detectExtension()).toBe(false)
      expect(r.error.value).toContain('not available')
    })
  })

  describe('startRecording', () => {
    it('should open a port, start recording, and map streamed steps', async () => {
      const runtime = installChrome(
        { startRecording: (cb) => cb({ success: true, tabId: 7 }) },
        port,
      )
      const r = useSyntheticsRecorder()
      await r.startRecording('https://app.test/login')

      expect(runtime.connect).toHaveBeenCalledWith(expect.any(String), { name: 'synthetics-recording' })
      expect(r.isRecording.value).toBe(true)
      expect(r.currentUrl.value).toBe('https://app.test/login')

      const wire: WireStep[] = [{ id: 's1', action: 'click', selector: '#go', selector_type: 'css' }]
      port.emit({ type: 'steps', steps: wire })
      expect(r.liveSteps.value).toHaveLength(1)
      expect(r.liveSteps.value[0].selectorType).toBe('CSS')

      port.emit({ type: 'url', url: 'https://app.test/next' })
      expect(r.currentUrl.value).toBe('https://app.test/next')
    })

    it('should surface an error and tear down when start fails', async () => {
      installChrome({ startRecording: (cb) => cb({ success: false, error: 'boom' }) }, port)
      const r = useSyntheticsRecorder()
      await r.startRecording('https://app.test')
      expect(r.isRecording.value).toBe(false)
      expect(r.error.value).toBe('boom')
      expect(port.disconnect).toHaveBeenCalled()
    })
  })

  describe('stopRecording', () => {
    it('should return mapped final steps and tear down the port', async () => {
      installChrome(
        {
          startRecording: (cb) => cb({ success: true }),
          stopRecording: (cb) => cb({ success: true, steps: [{ id: 's1', action: 'navigate', url: 'https://x.test' }] }),
        },
        port,
      )
      const r = useSyntheticsRecorder()
      await r.startRecording('https://x.test')
      const steps = await r.stopRecording()

      expect(steps).toHaveLength(1)
      expect(steps[0].action).toBe('navigate')
      expect(steps[0].value).toBe('https://x.test')
      expect(r.isRecording.value).toBe(false)
      expect(port.disconnect).toHaveBeenCalled()
    })
  })

  describe('cancelRecording', () => {
    it('should disconnect the port and clear state without returning steps', async () => {
      installChrome({ startRecording: (cb) => cb({ success: true }) }, port)
      const r = useSyntheticsRecorder()
      await r.startRecording('https://x.test')
      r.cancelRecording()
      expect(r.isRecording.value).toBe(false)
      expect(r.liveSteps.value).toHaveLength(0)
      expect(port.disconnect).toHaveBeenCalled()
    })
  })
})
