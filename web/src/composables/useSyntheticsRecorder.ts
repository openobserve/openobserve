// Copyright 2026 OpenObserve Inc.

import { ref } from 'vue'
import { synthetics } from '@/constants/config'
import { mapWireSteps } from '@/utils/synthetics/mapRecordedStep'
import type {
  BrowserStep,
  RecorderCommand,
  RecorderCommandEnvelope,
  RecorderMode,
  RecorderPortMessage,
  RecorderStartResponse,
  RecorderStatus,
  RecorderStopResponse,
} from '@/types/synthetics'

const RECORDING_PORT_NAME = 'synthetics-recording'

/**
 * Encapsulates all communication with the OpenObserve Extension (playwright-crx)
 * over Chrome's externally_connectable messaging. Components never touch
 * `chrome.*` directly — they drive recording through this composable's state and
 * methods. See ../playwright-crx/.docs/synthetics-recorder.md → "Web-side integration".
 */
const useSyntheticsRecorder = () => {
  const extensionId = "jpeegljpiapbjajeohcoccnimjfpigla";

  const isSupported = ref(typeof chrome !== 'undefined' && !!chrome.runtime)
  const isInstalled = ref(false)
  const isRecording = ref(false)
  const liveSteps = ref<BrowserStep[]>([])
  const currentUrl = ref('')
  const mode = ref<RecorderMode>('recording')
  const error = ref('')

  let port: ChromePort | null = null

  function getRuntime(): ChromeRuntime | null {
    if (typeof chrome === 'undefined' || !chrome.runtime) return null
    return chrome.runtime
  }

  /** Promisified one-shot command send. Resolves `null` when the extension is unreachable. */
  function sendCommand<T>(command: RecorderCommand): Promise<T | null> {
    const runtime = getRuntime()
    if (!runtime) {
      error.value = 'Chrome extension messaging is not available in this browser.'
      return Promise.resolve(null)
    }
    const envelope: RecorderCommandEnvelope = { type: 'synthetics-command', command }
    return new Promise((resolve) => {
      runtime.sendMessage(extensionId, envelope, (response) => {
        if (runtime.lastError) {
          resolve(null)
          return
        }
        resolve((response as T) ?? null)
      })
    })
  }

  /**
   * Ping the extension to learn whether it is reachable. The extension's
   * getStatus reply has no `installed` flag — any non-null response (no
   * `chrome.runtime.lastError`) means it is installed and connectable.
   */
  async function detectExtension(): Promise<boolean> {
    const status = await sendCommand<RecorderStatus>({ action: 'getStatus' })
    isInstalled.value = status !== null
    if (status?.isRecording) isRecording.value = true
    return isInstalled.value
  }

  function teardownPort() {
    if (port) {
      port.onMessage.removeListener(handlePortMessage)
      port.disconnect()
      port = null
    }
  }

  function handlePortMessage(message: unknown) {
    const msg = message as RecorderPortMessage
    switch (msg.type) {
      case 'steps':
        liveSteps.value = mapWireSteps(msg.steps)
        break
      case 'url':
        currentUrl.value = msg.url
        break
      case 'mode':
        mode.value = msg.mode
        break
      case 'stopped':
        liveSteps.value = mapWireSteps(msg.steps)
        isRecording.value = false
        break
    }
  }

  /**
   * Open the live port and ask the extension to start recording.
   * The extension opens its own top-level tab; steps arrive over the port.
   */
  async function startRecording(targetUrl: string): Promise<void> {
    const runtime = getRuntime()
    if (!runtime) {
      error.value = 'Chrome extension messaging is not available in this browser.'
      return
    }
    error.value = ''
    liveSteps.value = []
    currentUrl.value = targetUrl
    mode.value = 'recording'

    port = runtime.connect(extensionId, { name: RECORDING_PORT_NAME })
    port.onMessage.addListener(handlePortMessage)
    port.onDisconnect.addListener(() => {
      port = null
      isRecording.value = false
    })

    const res = await sendCommand<RecorderStartResponse>({ action: 'startRecording', targetUrl })
    if (!res?.success) {
      error.value = res?.error || 'Failed to start recording.'
      teardownPort()
      return
    }
    console.log("res ----- ", res);
    isRecording.value = true
  }

  /** Stop recording and return the final mapped steps. */
  async function stopRecording(): Promise<BrowserStep[]> {
    const res = await sendCommand<RecorderStopResponse>({ action: 'stopRecording' })
    const steps = res?.steps ? mapWireSteps(res.steps) : liveSteps.value
    teardownPort()
    isRecording.value = false
    liveSteps.value = []
    return steps
  }

  /** Abandon the current recording without persisting any steps. */
  function cancelRecording() {
    teardownPort()
    isRecording.value = false
    liveSteps.value = []
  }

  function setMode(next: RecorderMode): Promise<unknown> {
    mode.value = next
    return sendCommand({ action: 'setMode', mode: next })
  }

  /** Release the port; call from the host component's onUnmounted. */
  function cleanup() {
    teardownPort()
  }

  return {
    isSupported,
    isInstalled,
    isRecording,
    liveSteps,
    currentUrl,
    mode,
    error,
    detectExtension,
    startRecording,
    stopRecording,
    cancelRecording,
    setMode,
    cleanup,
  }
}

export default useSyntheticsRecorder
