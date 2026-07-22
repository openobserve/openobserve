// Copyright 2026 OpenObserve Inc.

import { reactive, ref } from 'vue'
import { synthetics } from '@/constants/config'
import { mapWireSteps } from '@/utils/synthetics/mapRecordedStep'
import type {
  BrowserStep,
  RecorderCommand,
  RecorderMode,
  RecorderPortInbound,
  RecorderStartResponse,
  RecorderStatus,
  RecorderStopResponse,
  ReplayResponse,
  ReplayPhase,
  StepReplayResult,
  WireStep,
} from '@/types/synthetics'
import { substituteVariables } from '@/utils/synthetics/mapRecordedStep'

/**
 * Encapsulates all communication with the OpenObserve Extension (playwright-crx)
 * via the content-script bridge (window.postMessage). Works on any origin —
 * cloud, self-hosted, localhost. No externally_connectable or chrome.runtime.* needed.
 * Components never touch the transport directly — they drive recording through this
 * composable's state and methods. See ../playwright-crx/.docs/synthetics-recorder-prd.md.
 */
const useSyntheticsRecorder = () => {
  // Bridge transport — replaces chrome.runtime.* with window.postMessage.
  // Works on any origin: cloud, self-hosted, localhost. No externally_connectable needed.
  // The content script (content.js) on the OO page acts as a relay: postMessage ↔ internal Port ↔ SW.

  const isSupported = ref(typeof window !== 'undefined')
  const isInstalled = ref(false)
  const isRecording = ref(false)
  const liveSteps = ref<BrowserStep[]>([])
  const currentUrl = ref('')
  const mode = ref<RecorderMode>('recording')
  const error = ref('')
  const isReplaying = ref(false)
  const replayResult = ref<ReplayResponse | null>(null)
  const replayPhase = ref<ReplayPhase>('idle')
  const stepResults = reactive<Map<string, StepReplayResult>>(new Map())
  const activeStepId = ref<string | null>(null)

  // Synchronous callback invoked when recording stops externally (user closes the extension
  // window without clicking "Stop"). BrowserJourney sets this to commit the steps immediately,
  // avoiding the timing race inherent in watching a reactive ref across async boundaries.
  let onExternalStop: ((steps: BrowserStep[]) => void) | null = null

  // ---- Bridge transport ----

  const BRIDGE_CHANNEL = 'oo-bridge';
  const COMMAND_TIMEOUT_MS = 5000;

  let nonceCounter = 0;
  function nextNonce(): string {
    return `${Date.now()}_${nonceCounter++}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // Pending one-shot command responses (nonce → resolve)
  const pendingCommands = new Map<string, (response: any) => void>();

  // Streaming data handlers (registered by bridgeConnect)
  let bridgeDataHandler: ((msg: any) => void) | null = null;
  let bridgeDisconnectHandler: (() => void) | null = null;

  /** Callback invoked when content script announces itself (toolbar icon injection). */
  let onAutoDetected: (() => void) | null = null;

  // Global message listener — processes all bridge messages from the content script.
  window.addEventListener('message', (event: MessageEvent) => {
    console.log("MEssage", event);
    if (event.source !== window) return;

    // Content script announces itself when injected on demand (toolbar icon
    // click after mid-session install). Auto-trigger detection.
    if (event.data?.ch === 'oo-bridge-ready') {
      detectExtension().then((installed: boolean) => {
        if (installed) onAutoDetected?.();
      }).catch(() => {});
      return;
    }

    if (event.data?.ch !== BRIDGE_CHANNEL) return;
    if (event.data?.dir !== 'to-page') return;

    const { nonce, msg } = event.data;

    // Bridge disconnection notification
    if (msg?.type === 'bridge-disconnected') {
      bridgeDisconnectHandler?.();
      return;
    }

    // Resolve pending command promise by nonce
    if (nonce && pendingCommands.has(nonce)) {
      const resolve = pendingCommands.get(nonce)!;
      pendingCommands.delete(nonce);
      resolve(msg?.response ?? msg);
      return;
    }

    // Also resolve if msg is a synthetics-response with its own nonce
    if (msg?.type === 'synthetics-response' && msg.nonce && pendingCommands.has(msg.nonce)) {
      const resolve = pendingCommands.get(msg.nonce)!;
      pendingCommands.delete(msg.nonce);
      resolve(msg.response);
      return;
    }

    // Streaming data push (synthetics-recorder type) → data handler
    bridgeDataHandler?.(msg);
  });

  /** One-shot command via postMessage. Resolves `null` when the extension is unreachable. */
  function sendCommand<T>(command: RecorderCommand): Promise<T | null> {
    const nonce = nextNonce();

    const timeout = new Promise<null>(resolve =>
      setTimeout(() => {
        pendingCommands.delete(nonce);
        resolve(null);
      }, COMMAND_TIMEOUT_MS),
    );

    const promise = new Promise<T | null>(resolve => {
      pendingCommands.set(nonce, resolve);
    });

    console.log("Post message", command);
    window.postMessage(
      { ch: BRIDGE_CHANNEL, dir: 'to-ext', nonce, msg: { type: 'synthetics-command', command } },
      '*',
    );

    return Promise.race([promise, timeout]);
  }

  /**
   * Ping the extension to learn whether it is reachable. The extension's
   * getStatus reply has no `installed` flag — any non-null response means
   * it is installed and connectable.
   */
  async function detectExtension(): Promise<boolean> {
    // Wake the content script's bridge. The content script defaults to
    // overlay mode on all pages — this probe tells it to open a bridge
    // port to the service worker so we can send commands.
    window.postMessage({ ch: 'oo-bridge-probe' }, '*');
    // Give the content script time to open the port before sending the
    // first command. 150ms is generous for a local postMessage round-trip
    // and chrome.runtime.connect call.
    await new Promise(r => setTimeout(r, 200));

    const status = await sendCommand<RecorderStatus>({ action: 'getStatus' })
    isInstalled.value = status !== null
    if (status?.isRecording) isRecording.value = true
    console.log("detect extension ---", status, isInstalled.value);
    return isInstalled.value
  }

  // The extension pushes `{ type:'synthetics-recorder', recordingId, payload }`
  // data events (discriminated by `payload.method`) and `synthetics-response`
  // command acks over the bridge. We consume the data events; acks are resolved
  // by sendCommand's nonce-based promise.
  function handleBridgeData(message: unknown) {
    const msg = message as RecorderPortInbound;
    console.log("MEssage ---", message);
    if (msg.type !== 'synthetics-recorder') return
    const { payload } = msg
    switch (payload.method) {
      case 'setActions':
        liveSteps.value = mapWireSteps(payload.browserSteps)
        break
      case 'recordingStarted':
        currentUrl.value = payload.url
        isRecording.value = true
        break
      case 'recordingStopped':
        // Commit steps synchronously if a listener is registered (external stop).
        // For explicit stopRecording(), the listener is temporarily nulled, so this is a no-op.
        if (onExternalStop) {
          onExternalStop([...liveSteps.value])
        }
        isRecording.value = false
        break
      case 'setMode':
        mode.value = payload.mode
        break
      case 'stepReplayResult':
        stepResults.set(payload.stepId, {
          stepId: payload.stepId,
          stepName: payload.stepName ?? '',
          passed: payload.passed,
          durationMs: payload.duration_ms,
          error: payload.error,
          structuredError: payload.structuredError,
        })
        activeStepId.value = null
        break
      case 'stepReplayStarted':
        activeStepId.value = payload.stepId
        break
      // setSources / elementPicked: not consumed yet
    }
  }

  // "Connection" via bridge — registers handlers for streaming data and disconnect.
  function bridgeConnect(): boolean {
    bridgeDataHandler = handleBridgeData;
    return true;
  }

  function bridgeDisconnect(): void {
    bridgeDataHandler = null;
    bridgeDisconnectHandler = null;
    // Reject all pending commands
    pendingCommands.forEach(resolve => resolve(null));
    pendingCommands.clear();
  }

  /**
   * Open the live port and ask the extension to start recording. The extension
   * opens its own top-level tab; steps stream back over the port via setActions.
   * `targetUrl` is kept only for the local recording banner — the extension
   * command itself takes no URL.
   */
  async function startRecording(targetUrl: string): Promise<void> {
    error.value = ''
    liveSteps.value = []
    currentUrl.value = targetUrl
    mode.value = 'recording'

    bridgeConnect()
    bridgeDisconnectHandler = () => {
      if (onExternalStop && isRecording.value) {
        onExternalStop([...liveSteps.value])
      }
      isRecording.value = false
    }

    console.log("Start Recording -----");
    const res = await sendCommand<RecorderStartResponse>({ action: 'startRecording', targetUrl })
    if (!res?.success) {
      console.debug("Disconnect ---", res);
      error.value = res?.error || 'Failed to start recording.'
      bridgeDisconnect()
      return
    }
    isRecording.value = true
  }

  /**
   * Stop recording and return the final mapped steps. The stop response carries
   * no steps — the journey was already built live from setActions pushes, so we
   * return the accumulated `liveSteps`.
   */
  async function stopRecording(): Promise<BrowserStep[]> {
    // Null the external-stop callback so recordingStopped arriving during the await
    // doesn't commit via the callback path — we handle the commit explicitly below.
    const savedOnExternalStop = onExternalStop
    onExternalStop = null
    await sendCommand<RecorderStopResponse>({ action: 'stopRecording' })
    const steps = [...liveSteps.value]
    isRecording.value = false // set before disconnect so onDisconnect's guard sees isRecording=false
    console.log("Disconnect ---");
    bridgeDisconnect()
    liveSteps.value = []
    onExternalStop = savedOnExternalStop
    return steps
  }

  /** Synchronous fire-and-forget stop. Captures current steps, sends the stop
   *  command without awaiting the response, and cleans up locally. Safe to call
   *  from onBeforeUnmount / beforeunload where awaiting is not possible. */
  function stopAndForget(): BrowserStep[] {
    const steps = [...liveSteps.value]
    sendCommand({ action: 'stopRecording' }) // fire-and-forget
    isRecording.value = false
    console.log("Disconnect ---");
    bridgeDisconnect()
    liveSteps.value = []
    return steps
  }

  /** Synchronous fire-and-forget stop for replay. Safe for lifecycle hooks. */
  function stopReplayAndForget(): void {
    sendCommand({ action: 'stopReplay' }) // fire-and-forget
  }

  /** Abandon the current recording without persisting any steps. */
  function cancelRecording() {
    // Null the callback so onDisconnect doesn't commit discarded steps.
    onExternalStop = null
    console.log("Disconnect ---");
    bridgeDisconnect()
    liveSteps.value = []
    isRecording.value = false
  }

  /**
   * Replay a journey in the extension's recording window. `stepReplayResult`
   * events stream over the port and are accumulated in `stepResults`. The final
   * `ReplayResponse` arrives via the sendCommand promise.
   */
  async function replay(
    steps: WireStep[],
    targetUrl?: string,
    variables?: { name: string; value: string }[],
    auth?: { type: 'basic'; username: string; password: string },
    headers?: { key: string; value: string }[],
    cookies?: { name: string; value: string; domain: string }[],
  ): Promise<ReplayResponse | null> {
    if (steps.length === 0) {
      error.value = 'No replayable steps in this journey.'
      return null
    }
    error.value = ''
    replayResult.value = null
    stepResults.clear()
    activeStepId.value = null
    replayPhase.value = 'running'
    isReplaying.value = true

    // // Substitute {{ VAR_NAME }} placeholders in wire step fields with actual variable values.
    const vars = Object.fromEntries((variables ?? []).map(v => [v.name, v.value]))
    const resolvedSteps = vars && Object.keys(vars).length > 0
      ? steps.map(s => substituteVariables(s, vars))
      : steps

    // Wake the content script bridge if it went idle. The port may have
    // died between stopRecording and replay (bfcache, SW suspend, etc.).
    // The probe re-activates the bridge before we send the replay command.
    window.postMessage({ ch: 'oo-bridge-probe' }, '*');
    await new Promise(r => setTimeout(r, 200));

    bridgeDisconnect() // discard any previous session
    bridgeConnect()
    bridgeDisconnectHandler = () => {
      isRecording.value = false
    }

    // Unwrap Vue reactive proxies before structured clone. Vue Proxy traps
    // intercept property access — postMessage structured clone sees the proxy,
    // not the underlying object, and silently drops all fields.
    const plainSteps = JSON.parse(JSON.stringify(resolvedSteps)) as WireStep[]
    const res = await sendCommand<ReplayResponse>({ action: 'replay', steps: plainSteps, targetUrl })
    isReplaying.value = false
    replayResult.value = res
    console.log("response ----", res);
    if (res) {
      if (res.stopped) replayPhase.value = 'stopped'
      else if (res.passed) replayPhase.value = 'passed'
      else if (stepResults.size === 0) replayPhase.value = 'idle' // pre-flight failure (e.g. incognito)
      else replayPhase.value = 'failed'
    } else {
      replayPhase.value = 'idle'
    }
    return res
  }

  /** Cancel an in-flight replay; the pending `replay` promise resolves with `stopped`. */
  function stopReplay(): Promise<unknown> {
    return sendCommand({ action: 'stopReplay' })
  }

  function setMode(next: RecorderMode): Promise<unknown> {
    mode.value = next
    return sendCommand({ action: 'setMode', mode: next })
  }

  /** Register a callback for when recording stops externally (extension window closed). */
  function setOnExternalStop(cb: ((steps: BrowserStep[]) => void) | null) {
    onExternalStop = cb
  }

  /** Release the port; call from the host component's onUnmounted. */
  function cleanup() {
    console.log("Disconnect ---");
    bridgeDisconnect()
  }

  return {
    isSupported,
    isInstalled,
    isRecording,
    liveSteps,
    currentUrl,
    mode,
    error,
    isReplaying,
    replayResult,
    replayPhase,
    stepResults,
    activeStepId,
    registerAutoDetect: (cb: (() => void) | null) => { onAutoDetected = cb; },
    detectExtension,
    startRecording,
    stopRecording,
    stopAndForget,
    stopReplayAndForget,
    cancelRecording,
    setOnExternalStop,
    replay,
    stopReplay,
    setMode,
    cleanup,
  }
}

export default useSyntheticsRecorder
