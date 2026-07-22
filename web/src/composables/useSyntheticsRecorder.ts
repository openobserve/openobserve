// Copyright 2026 OpenObserve Inc.

import { reactive, ref } from "vue";
import { synthetics } from "@/constants/config";
import { mapWireSteps } from "@/utils/synthetics/mapRecordedStep";
import type {
  BrowserStep,
  RecorderCommand,
  RecorderCommandEnvelope,
  RecorderMode,
  RecorderPortInbound,
  RecorderStartResponse,
  RecorderStatus,
  RecorderStopResponse,
  ReplayResponse,
  ReplayPhase,
  StepReplayResult,
  WireStep,
} from "@/types/synthetics";
import { substituteVariables } from "@/utils/synthetics/mapRecordedStep";

const RECORDING_PORT_NAME = "synthetics-recorder";

/**
 * Encapsulates all communication with the OpenObserve Extension (playwright-crx)
 * over Chrome's externally_connectable messaging. Components never touch
 * `chrome.*` directly — they drive recording through this composable's state and
 * methods. See ../playwright-crx/.docs/synthetics-recorder.md → "Web-side integration".
 */
const useSyntheticsRecorder = () => {
  // Extension public key/id to match the extension
  const extensionId = "hliehalmlioilejmkoaidkdmplalamki";

  const isSupported = ref(typeof chrome !== "undefined" && !!chrome.runtime);
  const isInstalled = ref(false);
  const isRecording = ref(false);
  const liveSteps = ref<BrowserStep[]>([]);
  const currentUrl = ref("");
  const mode = ref<RecorderMode>("recording");
  const error = ref("");
  const isReplaying = ref(false);
  const replayResult = ref<ReplayResponse | null>(null);
  const replayPhase = ref<ReplayPhase>("idle");
  const stepResults = reactive<Map<string, StepReplayResult>>(new Map());
  const activeStepId = ref<string | null>(null);

  let port: ChromePort | null = null;
  // Synchronous callback invoked when recording stops externally (user closes the extension
  // window without clicking "Stop"). BrowserJourney sets this to commit the steps immediately,
  // avoiding the timing race inherent in watching a reactive ref across async boundaries.
  let onExternalStop: ((steps: BrowserStep[]) => void) | null = null;

  function getRuntime(): ChromeRuntime | null {
    if (typeof chrome === "undefined" || !chrome.runtime) return null;
    return chrome.runtime;
  }

  /** Promisified one-shot command send. Resolves `null` when the extension is unreachable. */
  function sendCommand<T>(command: RecorderCommand): Promise<T | null> {
    const runtime = getRuntime();
    if (!runtime) {
      error.value = "Chrome extension messaging is not available in this browser.";
      return Promise.resolve(null);
    }
    const envelope: RecorderCommandEnvelope = { type: "synthetics-command", command };
    return new Promise((resolve) => {
      runtime.sendMessage(extensionId, envelope, (response) => {
        if (runtime.lastError) {
          resolve(null);
          return;
        }
        resolve((response as T) ?? null);
      });
    });
  }

  /**
   * Ping the extension to learn whether it is reachable. The extension's
   * getStatus reply has no `installed` flag — any non-null response (no
   * `chrome.runtime.lastError`) means it is installed and connectable.
   */
  async function detectExtension(): Promise<boolean> {
    const status = await sendCommand<RecorderStatus>({ action: "getStatus" });
    isInstalled.value = status !== null;
    if (status?.isRecording) isRecording.value = true;
    return isInstalled.value;
  }

  function teardownPort() {
    if (port) {
      console.log("terdown---");
      port.onMessage.removeListener(handlePortMessage);
      port.disconnect();
      port = null;
    }
  }

  // The extension pushes `{ type:'synthetics-recorder', recordingId, payload }`
  // data events (discriminated by `payload.method`) and `synthetics-response`
  // command acks over the port. We consume the data events; acks are ignored
  // since commands use the one-shot sendMessage request/response path.
  function handlePortMessage(message: unknown) {
    const msg = message as RecorderPortInbound;
    if (msg.type !== "synthetics-recorder") return;
    const { payload } = msg;
    switch (payload.method) {
      case "setActions":
        liveSteps.value = mapWireSteps(payload.browserSteps);
        break;
      case "recordingStarted":
        currentUrl.value = payload.url;
        isRecording.value = true;
        break;
      case "recordingStopped":
        // Commit steps synchronously if a listener is registered (external stop).
        // For explicit stopRecording(), the listener is temporarily nulled, so this is a no-op.
        if (onExternalStop) {
          onExternalStop([...liveSteps.value]);
        }
        isRecording.value = false;
        break;
      case "setMode":
        mode.value = payload.mode;
        break;
      case "stepReplayResult":
        stepResults.set(payload.stepId, {
          stepId: payload.stepId,
          stepName: payload.stepName ?? "",
          passed: payload.passed,
          durationMs: payload.duration_ms,
          error: payload.error,
          structuredError: payload.structuredError,
        });
        activeStepId.value = null;
        break;
      case "stepReplayStarted":
        activeStepId.value = payload.stepId;
        break;
      // setSources / elementPicked: not consumed yet
    }
  }

  // Open the long-lived port the extension streams events over. Guarded because
  // a stale extension context (e.g. extension reloaded after the page loaded)
  // makes `connect`/`onMessage` throw "Extension context invalidated".
  function connectPort(): boolean {
    const runtime = getRuntime();
    if (!runtime) {
      error.value = "Chrome extension messaging is not available in this browser.";
      return false;
    }
    try {
      port = runtime.connect(extensionId, { name: RECORDING_PORT_NAME });
      port.onMessage.addListener(handlePortMessage);
      port.onDisconnect.addListener(() => {
        port = null;
        // If recording is still active (no recordingStopped received yet), commit via callback.
        // This covers the case where the port drops without a recordingStopped message
        // (e.g. the extension tab crashes or the window is closed).
        if (onExternalStop && isRecording.value) {
          onExternalStop([...liveSteps.value]);
        }
        isRecording.value = false;
      });
      return true;
    } catch (err) {
      port = null;
      error.value =
        err instanceof Error && /context invalidated/i.test(err.message)
          ? "The recorder extension was reloaded — please refresh this page and try again."
          : "Could not connect to the recorder extension.";
      return false;
    }
  }

  /**
   * Open the live port and ask the extension to start recording. The extension
   * opens its own top-level tab; steps stream back over the port via setActions.
   * `targetUrl` is kept only for the local recording banner — the extension
   * command itself takes no URL.
   */
  async function startRecording(targetUrl: string): Promise<void> {
    error.value = "";
    liveSteps.value = [];
    currentUrl.value = targetUrl;
    mode.value = "recording";

    if (!connectPort()) return;

    const res = await sendCommand<RecorderStartResponse>({ action: "startRecording", targetUrl });
    if (!res?.success) {
      error.value = res?.error || "Failed to start recording.";
      teardownPort();
      return;
    }
    isRecording.value = true;
  }

  /**
   * Stop recording and return the final mapped steps. The stop response carries
   * no steps — the journey was already built live from setActions pushes, so we
   * return the accumulated `liveSteps`.
   */
  async function stopRecording(): Promise<BrowserStep[]> {
    // Null the external-stop callback so recordingStopped arriving during the await
    // doesn't commit via the callback path — we handle the commit explicitly below.
    const savedOnExternalStop = onExternalStop;
    onExternalStop = null;
    await sendCommand<RecorderStopResponse>({ action: "stopRecording" });
    const steps = [...liveSteps.value];
    isRecording.value = false; // set before teardown so onDisconnect's guard sees isRecording=false
    teardownPort();
    liveSteps.value = [];
    onExternalStop = savedOnExternalStop;
    return steps;
  }

  /** Synchronous fire-and-forget stop. Captures current steps, sends the stop
   *  command without awaiting the response, and cleans up locally. Safe to call
   *  from onBeforeUnmount / beforeunload where awaiting is not possible. */
  function stopAndForget(): BrowserStep[] {
    const steps = [...liveSteps.value];
    sendCommand({ action: "stopRecording" }); // fire-and-forget
    isRecording.value = false;
    teardownPort();
    liveSteps.value = [];
    return steps;
  }

  /** Synchronous fire-and-forget stop for replay. Safe for lifecycle hooks. */
  function stopReplayAndForget(): void {
    sendCommand({ action: "stopReplay" }); // fire-and-forget
  }

  /** Abandon the current recording without persisting any steps. */
  function cancelRecording() {
    // Null the callback so onDisconnect doesn't commit discarded steps.
    onExternalStop = null;
    teardownPort();
    liveSteps.value = [];
    isRecording.value = false;
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
    auth?: { type: "basic"; username: string; password: string },
    headers?: { key: string; value: string }[],
    cookies?: { name: string; value: string; domain: string }[],
  ): Promise<ReplayResponse | null> {
    if (steps.length === 0) {
      error.value = "No replayable steps in this journey.";
      return null;
    }
    error.value = "";
    replayResult.value = null;
    stepResults.clear();
    activeStepId.value = null;
    replayPhase.value = "running";
    isReplaying.value = true;

    // Substitute {{ VAR_NAME }} placeholders in wire step fields with actual variable values.
    const vars = Object.fromEntries((variables ?? []).map((v) => [v.name, v.value]));
    const resolvedSteps =
      vars && Object.keys(vars).length > 0 ? steps.map((s) => substituteVariables(s, vars)) : steps;

    // Ensure port is open so stepReplayResult events flow through handlePortMessage.
    teardownPort(); // discard any previous port (recording)
    if (!connectPort()) {
      error.value = "Could not connect to the recorder extension.";
      replayPhase.value = "idle";
      isReplaying.value = false;
      return null;
    }

    const res = await sendCommand<ReplayResponse>({
      action: "replay",
      steps: resolvedSteps,
      targetUrl,
      auth,
      headers,
      cookies,
    });
    isReplaying.value = false;
    replayResult.value = res;
    if (res) {
      if (res.stopped) replayPhase.value = "stopped";
      else if (res.passed) replayPhase.value = "passed";
      else if (stepResults.size === 0)
        replayPhase.value = "idle"; // pre-flight failure (e.g. incognito)
      else replayPhase.value = "failed";
    } else {
      replayPhase.value = "idle";
    }
    return res;
  }

  /** Cancel an in-flight replay; the pending `replay` promise resolves with `stopped`. */
  function stopReplay(): Promise<unknown> {
    return sendCommand({ action: "stopReplay" });
  }

  function setMode(next: RecorderMode): Promise<unknown> {
    mode.value = next;
    return sendCommand({ action: "setMode", mode: next });
  }

  /** Register a callback for when recording stops externally (extension window closed). */
  function setOnExternalStop(cb: ((steps: BrowserStep[]) => void) | null) {
    onExternalStop = cb;
  }

  /** Release the port; call from the host component's onUnmounted. */
  function cleanup() {
    teardownPort();
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
  };
};

export default useSyntheticsRecorder;
