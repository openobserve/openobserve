// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { reactive, ref } from "vue";
import type { TranslateFn } from "@/types/i18n";
import { mapWireSteps } from "@/utils/synthetics/mapRecordedStep";
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
  RestoreFailureReason,
  StepReplayResult,
  StructuredError,
  WireStep,
} from "@/types/synthetics";
import { substituteVariables } from "@/utils/synthetics/mapRecordedStep";
import { classifyRestoreFailure } from "@/utils/synthetics/replayFailure";
import { DEFAULT_TEST_ID_ATTR, MIN_EXTENSION_VERSION } from "@/constants/synthetics";

/**
 * Encapsulates all communication with the OpenObserve Extension (playwright-crx)
 * via the content-script bridge (window.postMessage). Works on any origin —
 * cloud, self-hosted, localhost. No externally_connectable or chrome.runtime.* needed.
 * Components never touch the transport directly — they drive recording through this
 * composable's state and methods. See ../playwright-crx/.docs/synthetics-recorder-prd.md.
 */
/**
 * Is the connected extension too old for this build of the web app?
 *
 * Compares numerically per segment rather than lexically: "0.10.0" is newer than
 * "0.9.0", which a string comparison gets backwards. An absent version means an
 * extension from before the handshake existed, which is by definition too old.
 */
export function isExtensionOutdated(version: string | undefined): boolean {
  if (!version) return true;
  const parse = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const actual = parse(version);
  const minimum = parse(MIN_EXTENSION_VERSION);
  for (let i = 0; i < Math.max(actual.length, minimum.length); i++) {
    const a = actual[i] ?? 0;
    const m = minimum[i] ?? 0;
    if (a !== m) return a < m;
  }
  return false;
}

const useSyntheticsRecorder = (t: TranslateFn) => {
  // Bridge transport — replaces chrome.runtime.* with window.postMessage.
  // Works on any origin: cloud, self-hosted, localhost. No externally_connectable needed.
  // The content script (content.js) on the OO page acts as a relay: postMessage ↔ internal Port ↔ SW.

  const isSupported = ref(typeof window !== "undefined");
  const isInstalled = ref(false);
  /** Build of the installed extension, or null when it has not introduced itself. */
  const extVersion = ref<string | null>(null);
  /** What the installed extension says it supports; null when it reports no list. */
  const capabilities = ref<string[] | null>(null);
  const isRecording = ref(false);
  const liveSteps = ref<BrowserStep[]>([]);
  const currentUrl = ref("");
  /**
   * The last selector the user picked in the extension.
   *
   * Set by "Pick locator" in the action picker, and by any click while the
   * recorder is in inspecting mode. It creates no step — it is a selector handed
   * to the user, not a recorded action.
   */
  const pickedSelector = ref<string | null>(null);
  /** The connected extension is older than MIN_EXTENSION_VERSION. */
  const extensionOutdated = ref(false);
  const mode = ref<RecorderMode>("recording");
  const error = ref("");
  const isReplaying = ref(false);
  const replayResult = ref<ReplayResponse | null>(null);
  const replayPhase = ref<ReplayPhase>("idle");
  const stepResults = reactive<Map<string, StepReplayResult>>(new Map());
  const activeStepId = ref<string | null>(null);
  /**
   * Where the author's own capture starts within `liveSteps`, for a restore-then-record
   * session. Null for a plain recording, which has no artifacts to skip.
   *
   * The recorder logs `openPage`/`closePage` past its own enabled guard, so the
   * collection already holds entries by the time recording is switched on. Returning
   * those as recorded steps would put a bogus navigate at the head of every inserted
   * block. The extension reports the count at the moment it enables recording.
   */
  const baselineStepCount = ref<number | null>(null);
  /**
   * How the restore ended short, or null when nothing has ended it this session.
   *
   * `reason` is what the surface downstream keys on: a cancel is narrated with a
   * toast and nothing else, while a step that genuinely failed earns a banner with
   * a way out. `structuredError` is kept for the same reason the step error card
   * keeps it — it carries the error class the human wording is derived from.
   */
  const prefixFailure = ref<{
    stepId: string;
    error?: string;
    structuredError?: StructuredError;
    reason: RestoreFailureReason;
  } | null>(null);

  // Synchronous callback invoked when recording stops externally (user closes the extension
  // window without clicking "Stop"). BrowserJourney sets this to commit the steps immediately,
  // avoiding the timing race inherent in watching a reactive ref across async boundaries.
  let onExternalStop: ((steps: BrowserStep[]) => void) | null = null;

  // ---- Bridge transport ----

  const BRIDGE_CHANNEL = "oo-bridge";
  const COMMAND_TIMEOUT_MS = 4000;

  // `replay` is the one command the extension answers only when the whole
  // journey has finished — the service worker resolves it from handleReplay,
  // after the last step. Racing it against COMMAND_TIMEOUT_MS made the UI fall
  // back to "idle" four seconds in while the extension kept replaying in its
  // own window. A single step alone may legitimately take 60 s (the flat
  // preview timeout, P1.R.1), so this is not a journey bound — it is a
  // last-resort watchdog for a bridge that died without answering. Sized to
  // LEASE_SECS = 900 (D-9), the outer bound one attempt is ever contained in;
  // anything shorter would make the preview stricter than production (X-8.1).
  // See docs/synthetics/reliability/synthetics-recorded-test-reliability-spec.md.
  const REPLAY_TIMEOUT_MS = 15 * 60 * 1000;

  // Bumped on every replay start and on every stop. `replay()` captures the value it
  // started with and refuses to touch phase state once it no longer matches — otherwise a
  // Stop followed quickly by Re-run lets the OLD replay's response land on the NEW run and
  // knock `running` back to `stopped`. Latent until stopping became fast enough to hit.
  let replayGeneration = 0;

  // The same rule for a restore, and it needs its own counter because a restore and a
  // replay can be abandoned independently.
  //
  // `startRecordingFrom` is answered only when the whole prefix has finished, so at the
  // moment anyone cancels one, its command is ALWAYS still outstanding. Ending the
  // session force-resolves it — `bridgeDisconnect` answers every pending command with
  // null — and the continuation then ran on a session that no longer existed, writing
  // "Failed to start recording." over the cleanup the cancel had just done. The author
  // pressed a button to stop things and was shown a failure.
  let restoreGeneration = 0;

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
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;

    // Content script announces itself when injected on demand (toolbar icon
    // click after mid-session install). Auto-trigger detection.
    if (event.data?.ch === "oo-bridge-ready") {
      detectExtension()
        .then((installed: boolean) => {
          if (installed) onAutoDetected?.();
        })
        .catch(() => {});
      return;
    }

    if (event.data?.ch !== BRIDGE_CHANNEL) return;
    if (event.data?.dir !== "to-page") return;

    const { nonce, msg } = event.data;

    // Bridge disconnection notification
    if (msg?.type === "bridge-disconnected") {
      bridgeDisconnectHandler?.();
      return;
    }

    // Resolve pending command promise by nonce
    if (nonce && pendingCommands.has(nonce)) {
      const resolve = pendingCommands.get(nonce)!;
      pendingCommands.delete(nonce);
      // Content script unwraps synthetics-response → forwards msg.response.
      // msg?.response is only set when the content script passes through
      // a not-fully-unwrapped envelope; normally msg IS the response object.
      resolve(msg?.response ?? msg);
      return;
    }

    // Also resolve if msg is a synthetics-response with its own nonce
    if (msg?.type === "synthetics-response" && msg.nonce && pendingCommands.has(msg.nonce)) {
      const resolve = pendingCommands.get(msg.nonce)!;
      pendingCommands.delete(msg.nonce);
      resolve(msg.response);
      return;
    }

    // Streaming data push (synthetics-recorder type) → data handler
    bridgeDataHandler?.(msg);
  });

  /**
   * One-shot command via postMessage. Resolves `null` when the extension is
   * unreachable. `timeoutMs` is how long to wait for the ack — long-running
   * commands (`replay`) pass their own window.
   */
  function sendCommand<T>(
    command: RecorderCommand,
    timeoutMs: number = COMMAND_TIMEOUT_MS,
  ): Promise<T | null> {
    const nonce = nextNonce();

    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        pendingCommands.delete(nonce);
        resolve(null);
      }, timeoutMs);
    });

    const promise = new Promise<T | null>((resolve) => {
      pendingCommands.set(nonce, (response) => {
        // Release the watchdog — a replay's is 15 minutes long, and leaving one
        // armed per replay would keep the timer alive well past the answer.
        clearTimeout(timer);
        resolve(response);
      });
    });
    window.postMessage(
      { ch: BRIDGE_CHANNEL, dir: "to-ext", nonce, msg: { type: "synthetics-command", command } },
      "*",
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
    window.postMessage({ ch: "oo-bridge-probe" }, "*");
    // Give the content script time to open the port before sending the
    // first command. 150ms is generous for a local postMessage round-trip
    // and chrome.runtime.connect call.
    // 500ms settle — if the SW just restarted (incognito toggle), it needs
    // time to initialise. chrome.runtime.connect queues messages internally.
    await new Promise((r) => setTimeout(r, 500));

    const status = await sendCommand<RecorderStatus>({ action: "getStatus" });
    isInstalled.value = status !== null;
    // Replaced, never merged: a re-probe (the incognito toggle reloads the extension
    // and forces one) must be able to report FEWER capabilities than the last one.
    // Merging would keep a withdrawn capability alive and re-enable a dead affordance.
    extVersion.value = status?.extVersion ?? null;
    capabilities.value = status?.capabilities ?? null;
    // Reads `extVersion`, not the older `version` the extension also still sends —
    // which is the condition background.ts names for dropping that duplicate field.
    if (status !== null) extensionOutdated.value = isExtensionOutdated(status.extVersion);
    if (status?.isRecording) isRecording.value = true;
    return isInstalled.value;
  }

  /**
   * Whether the installed extension supports `name`.
   *
   * Every affordance added after the handshake gates on this rather than on a version
   * comparison, so a capability can be added or withdrawn without O2 parsing versions.
   *
   * The absent-list case is the one that matters and is defined here, once: an
   * extension older than the handshake reports nothing, and it can still record and
   * replay — reading that as "supports nothing" would disable working buttons for
   * everyone who has not updated, and reading it as "supports everything" would put a
   * dead button on screen. It supports exactly what shipped before the handshake.
   */
  const PRE_HANDSHAKE_CAPABILITIES = ["record", "replay"];

  function hasCapability(name: string): boolean {
    // Nothing answered the probe, so nothing is installed — not even the two the
    // absent-list default would otherwise grant.
    if (!isInstalled.value) return false;
    return (capabilities.value ?? PRE_HANDSHAKE_CAPABILITIES).includes(name);
  }

  // The extension pushes `{ type:'synthetics-recorder', recordingId, payload }`
  // data events (discriminated by `payload.method`) and `synthetics-response`
  // command acks over the bridge. We consume the data events; acks are resolved
  // by sendCommand's nonce-based promise.
  function handleBridgeData(message: unknown) {
    const msg = message as RecorderPortInbound;
    if (msg.type !== "synthetics-recorder") return;
    const { payload } = msg;
    switch (payload.method) {
      case "setActions":
        // Live capture: keep the extension's own step for replay fidelity. These
        // wires still carry fields the v2 schema cannot store (options, modifiers,
        // position, framePath); button and clickCount are now promoted onto the
        // step by mapWireStep and stored.
        liveSteps.value = mapWireSteps(payload.browserSteps, { preserveWire: true });
        break;
      case "recordingStarted":
        currentUrl.value = payload.url;
        isRecording.value = true;
        // A restore-then-record session announces itself here, after the prefix has
        // landed — which is also the moment the restore stops and the capture starts.
        if (payload.mode === "insert") {
          baselineStepCount.value = payload.baselineStepCount ?? 0;
          replayPhase.value = "idle";
          activeStepId.value = null;
        }
        break;
      case "prefixFailed":
        // The restore could not reach the requested point. The extension leaves the
        // session open and the browser sitting where the failing step stopped, so the
        // recovery is a mode flip rather than another replay — see design §7.6.
        prefixFailure.value = {
          stepId: payload.stepId,
          error: payload.error,
          structuredError: payload.structuredError,
          reason: classifyRestoreFailure(payload),
        };
        // This message describes the failure in full; the `{success:false}` answer to
        // the command is the same event with less in it. Clearing here — and refusing
        // to set it below — is what stops one cause rendering as two banners.
        error.value = "";
        replayPhase.value = "failed";
        activeStepId.value = null;
        isRecording.value = false;
        break;
      case "recordingStopped":
        // Commit steps synchronously if a listener is registered (external stop).
        // For explicit stopRecording(), the listener is temporarily nulled, so this is a no-op.
        // `recordedSteps()` rather than the raw list: this fires for a restore-then-record
        // session too, whose `liveSteps` still carries the replayed prefix in front.
        if (onExternalStop) {
          onExternalStop(recordedSteps());
        }
        isRecording.value = false;
        break;
      case "setMode":
        mode.value = payload.mode;
        break;
      case "stepReplayResult":
        // A result already in flight when Stop was pressed is real evidence — the step
        // did run — so it still counts toward "completed X of N" while `stopping`. Once
        // the replay is over, late arrivals belong to a run nobody is looking at.
        //
        // `restoring` belongs here for that same reason, and was missing: this gate
        // predates the phase, so it admitted only the two that existed when it was
        // written. A restore streams its prefix over these very messages, and dropping
        // them left the banner reading "step 0 of N" for the whole restore while the
        // recorder window visibly worked through it.
        if (
          replayPhase.value !== "running" &&
          replayPhase.value !== "stopping" &&
          replayPhase.value !== "restoring"
        )
          break;
        stepResults.set(payload.stepId, {
          stepId: payload.stepId,
          stepName: payload.stepName ?? "",
          passed: payload.passed,
          durationMs: payload.duration_ms,
          error: payload.error,
          structuredError: payload.structuredError,
          // X-8.2: the player reports what it could not reproduce. Dropping this
          // made every such divergence silent — including a skipped step that
          // would otherwise read as a pass.
          fidelity: payload.fidelity,
        });
        activeStepId.value = null;
        break;
      case "stepReplayStarted":
        // Only a running replay may light a step up. A `stepStarted` that arrives after
        // Stop describes a step that will never report a result, and honouring it is what
        // left the journey with a step spinning forever.
        if (replayPhase.value !== "running") break;
        activeStepId.value = payload.stepId;
        break;
      case "elementPicked":
        // Unlike setSources — removed from playwright-core, so its branch could
        // never fire — this message is live on every pick and every inspect-mode
        // click. Dropping it made inspecting a dead end: the user clicked an
        // element and nothing came back.
        pickedSelector.value = payload.elementInfo.selector;
        break;
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
    pendingCommands.forEach((resolve) => resolve(null));
    pendingCommands.clear();
  }

  /**
   * Open the live port and ask the extension to start recording. The extension
   * opens its own top-level tab; steps stream back over the port via setActions.
   * `targetUrl` is kept only for the local recording banner — the extension
   * command itself takes no URL.
   */
  async function startRecording(targetUrl: string, testIdAttr?: string): Promise<void> {
    error.value = "";
    liveSteps.value = [];
    currentUrl.value = targetUrl;
    mode.value = "recording";

    // Ensure bridge is alive — the port may have died since detectExtension()
    // ran (SW suspend, tab backgrounding, etc.). Sending the probe re-activates
    // the bridge before we send the startRecording command.
    window.postMessage({ ch: "oo-bridge-probe" }, "*");
    await new Promise((r) => setTimeout(r, 500));

    bridgeConnect();
    bridgeDisconnectHandler = () => {
      if (onExternalStop && isRecording.value) {
        onExternalStop(recordedSteps());
      }
      isRecording.value = false;
    };

    // The extension defaults to Playwright's `data-testid` when this is absent,
    // and it was absent on every recording ever made — the field existed on the
    // command type but nothing populated it. O2 markup uses `data-test`, which
    // only produced test-attribute candidates because upstream's generator
    // happens to carry a hardcoded fallback list containing it. An app on
    // `data-qa` or `data-cy` got none at all, silently.
    const res = await sendCommand<RecorderStartResponse>({
      action: "startRecording",
      targetUrl,
      testIdAttr: testIdAttr || DEFAULT_TEST_ID_ATTR,
    });
    if (!res?.success) {
      console.debug("Disconnect ---", res);
      error.value = res?.error || t("synthetics.failedToStartRecording");
      bridgeDisconnect();
      return;
    }
    isRecording.value = true;
  }

  /**
   * Replay `prefixSteps`, then record from where they left off — one continuous
   * extension session (P2).
   *
   * The phase is `restoring` until the extension reports `recordingStarted`, because
   * what the author is watching is their own journey being re-run, not a capture.
   * Calling it recording would invite them to start clicking during the restore.
   */
  async function startRecordingFrom(
    prefixSteps: WireStep[],
    opts: {
      targetUrl?: string;
      testIdAttr?: string;
      variables?: { name: string; value: string }[];
      auth?: { type: "basic"; username: string; password: string };
      headers?: { key: string; value: string }[];
      cookies?: { name: string; value: string; domain: string }[];
    } = {},
  ): Promise<void> {
    error.value = "";
    liveSteps.value = [];
    baselineStepCount.value = null;
    // Cleared here, not on failure: a stale recovery banner must not outlive the
    // session it describes.
    prefixFailure.value = null;
    stepResults.clear();
    activeStepId.value = null;
    currentUrl.value = opts.targetUrl ?? "";
    mode.value = "recording";
    replayPhase.value = "restoring";
    const generation = ++restoreGeneration;

    window.postMessage({ ch: "oo-bridge-probe" }, "*");
    await new Promise((r) => setTimeout(r, 500));

    bridgeConnect();
    bridgeDisconnectHandler = () => {
      if (onExternalStop && isRecording.value) {
        onExternalStop(recordedSteps());
      }
      isRecording.value = false;
    };

    // The prefix replays against a real browser, so the same variable substitution
    // the replay path does has to happen here — otherwise the restore runs with
    // `{{ VAR }}` typed literally into the page.
    const vars = Object.fromEntries((opts.variables ?? []).map((v) => [v.name, v.value]));
    const resolved =
      Object.keys(vars).length > 0
        ? prefixSteps.map((s) => substituteVariables(s, vars))
        : prefixSteps;

    // Unwrap Vue reactive proxies before structured clone — see `replay`.
    const plainSteps = JSON.parse(JSON.stringify(resolved)) as WireStep[];

    const res = await sendCommand<RecorderStartResponse>(
      {
        action: "startRecordingFrom",
        prefixSteps: plainSteps,
        targetUrl: opts.targetUrl,
        testIdAttr: opts.testIdAttr || DEFAULT_TEST_ID_ATTR,
        auth: opts.auth,
        headers: opts.headers,
        cookies: opts.cookies,
      },
      // Same class of command as `replay`, and for the same reason: the extension
      // answers only once the whole prefix has finished replaying, which is far longer
      // than the 4 s one-shot ack window. Racing it against COMMAND_TIMEOUT_MS declared
      // failure four seconds in and tore the bridge down — so the restore carried on in
      // the extension's own window while every step the author then recorded was
      // dropped on the floor, and Stop returned an empty journey. This is a watchdog for
      // a bridge that died without answering, not a bound on how long a restore may take.
      REPLAY_TIMEOUT_MS,
    );

    // Superseded — this answer belongs to a restore that has already been abandoned or
    // replaced, and everything it would touch describes a session that is gone. The
    // one state it must NOT touch is `error`: a cancel clears that on its way out, and
    // the null this promise was force-resolved with reads as a failure.
    if (generation !== restoreGeneration) return;

    if (!res?.success) {
      // A `prefixFailed` has already said what happened, with the step and the error
      // class this answer does not carry. Repeating it here is what put a raw red
      // banner under the warning banner describing the same event.
      if (!prefixFailure.value) error.value = res?.error || "Failed to start recording.";
      replayPhase.value = "idle";
      // A prefix failure is the one refusal the extension does NOT tear down after: it
      // keeps the browser sitting where the failing step stopped, which is what makes
      // the recovery a mode flip rather than a second restore (design §7.6). Dropping
      // the stream handler here would leave that session running with nothing in O2
      // listening to it, so the recovery would record into a void.
      if (!prefixFailure.value) bridgeDisconnect();
    }
  }

  /**
   * Record on the session a failed prefix left open, starting where it stopped.
   *
   * The extension does not tear down after a prefix failure: the browser sits at the
   * state the failing step reached, which is a legitimate restored state — simply an
   * earlier one than was asked for, and exactly where an author fixing that step
   * wants to be. So this is a mode flip on the live session rather than a second
   * restore: no window teardown, no replay, no wasted minute (design §7.6).
   *
   * The extension still decides when capture begins — it has to empty the collection
   * of the restore's artifacts first — so `isRecording` is left for the
   * `recordingStarted` push to set, as it is for every other way recording starts.
   */
  async function recordFromHere(): Promise<void> {
    error.value = "";
    liveSteps.value = [];
    baselineStepCount.value = null;
    // The failure is over the moment its recovery starts; leaving it set would keep a
    // warning on screen above a live recording.
    prefixFailure.value = null;
    replayPhase.value = "idle";
    mode.value = "recording";

    bridgeConnect();
    const res = await sendCommand<RecorderStartResponse>({ action: "recordFromHere" });
    if (!res?.success) {
      error.value = res?.error || "Failed to start recording.";
      bridgeDisconnect();
    }
  }

  /**
   * Abandon a restore that is still replaying.
   *
   * The recorder window used to be the only exit from a restore, and closing it
   * surfaces as an exception the extension can only report as a failing step. This
   * is the exit that says what it means.
   *
   * Stopping the player makes the in-flight action throw, so the extension answers
   * this cancel with a `prefixFailed` describing an abort O2 asked for. Reporting
   * that back to the author would be the same misattribution in reverse — which is
   * what the teardown below prevents: the stream handler goes with the session, so
   * the failure it provoked has nowhere to land.
   */
  function cancelRestore(): void {
    // Orphan the start command before tearing anything down. Its promise outlives the
    // session, and the teardown below is what resolves it.
    restoreGeneration++;
    sendCommand({ action: "stopReplay" }); // fire-and-forget: nothing waits on the abort
    prefixFailure.value = null;
    error.value = "";
    replayPhase.value = "idle";
    activeStepId.value = null;
    isRecording.value = false;
    liveSteps.value = [];
    baselineStepCount.value = null;
    bridgeDisconnect();
  }

  /**
   * What the author actually recorded this session.
   *
   * For a restore-then-record session that is everything past the baseline; for a
   * plain recording it is the whole list. Both callers of "give me the steps" go
   * through here so the artifact-skipping rule lives in exactly one place.
   */
  function recordedSteps(): BrowserStep[] {
    const baseline = baselineStepCount.value;
    return baseline == null ? [...liveSteps.value] : liveSteps.value.slice(baseline);
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
    const steps = recordedSteps();
    isRecording.value = false; // set before disconnect so onDisconnect's guard sees isRecording=false
    bridgeDisconnect();
    liveSteps.value = [];
    baselineStepCount.value = null;
    onExternalStop = savedOnExternalStop;
    return steps;
  }

  /** Synchronous fire-and-forget stop. Captures current steps, sends the stop
   *  command without awaiting the response, and cleans up locally. Safe to call
   *  from onBeforeUnmount / beforeunload where awaiting is not possible. */
  function stopAndForget(): BrowserStep[] {
    const steps = recordedSteps();
    sendCommand({ action: "stopRecording" }); // fire-and-forget
    isRecording.value = false;
    bridgeDisconnect();
    liveSteps.value = [];
    baselineStepCount.value = null;
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
    bridgeDisconnect();
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
    _auth?: { type: "basic"; username: string; password: string },
    _headers?: { key: string; value: string }[],
    _cookies?: { name: string; value: string; domain: string }[],
  ): Promise<ReplayResponse | null> {
    if (steps.length === 0) {
      error.value = t("synthetics.noReplayableSteps");
      return null;
    }
    error.value = "";
    replayResult.value = null;
    stepResults.clear();
    activeStepId.value = null;
    replayPhase.value = "running";
    isReplaying.value = true;
    const generation = ++replayGeneration;

    // // Substitute {{ VAR_NAME }} placeholders in wire step fields with actual variable values.
    const vars = Object.fromEntries((variables ?? []).map((v) => [v.name, v.value]));
    const resolvedSteps =
      vars && Object.keys(vars).length > 0 ? steps.map((s) => substituteVariables(s, vars)) : steps;

    // Wake the content script bridge if it went idle. The port may have
    // died between stopRecording and replay (bfcache, SW suspend, etc.).
    // The probe re-activates the bridge before we send the replay command.
    window.postMessage({ ch: "oo-bridge-probe" }, "*");
    await new Promise((r) => setTimeout(r, 500));

    bridgeDisconnect(); // discard any previous session
    bridgeConnect();
    bridgeDisconnectHandler = () => {
      isRecording.value = false;

      // The bridge is the ONLY channel a replay's outcome travels on — the answer to
      // the command sent below. Once it is gone that answer can never arrive, and
      // nothing else moves the run out of `running`: the banner goes on counting and
      // the step the player was on keeps the spinner it was given, because the result
      // that would clear it is undeliverable. Closing the recorder window is how this
      // is reached in practice.
      //
      // #13592 cleared that spinner for every ending it knew about, but each of its
      // guards is conditioned on the phase having already left `running`, and here
      // nothing takes it there. The 15-minute watchdog is the only other backstop, and
      // it resolves to `idle` — dropping the results as well as the spinner.
      //
      // `stopped` rather than `failed`: no step failed. The run ended before it
      // finished, which is exactly what that banner says, and it offers Re-run.
      if (replayPhase.value !== "running" && replayPhase.value !== "stopping") return;
      // Orphan the in-flight answer. The worker buffers what it cannot deliver and
      // re-sends on the next connect, so it can still arrive — after the author has
      // dismissed this banner, or started another run.
      replayGeneration++;
      activeStepId.value = null;
      isReplaying.value = false;
      replayPhase.value = "stopped";
    };

    // Unwrap Vue reactive proxies before structured clone. Vue Proxy traps
    // intercept property access — postMessage structured clone sees the proxy,
    // not the underlying object, and silently drops all fields.
    const plainSteps = JSON.parse(JSON.stringify(resolvedSteps)) as WireStep[];
    const res = await sendCommand<ReplayResponse>(
      {
        action: "replay",
        steps: plainSteps,
        targetUrl,
      },
      REPLAY_TIMEOUT_MS,
    );
    // Superseded — this response belongs to a replay the user has already stopped or
    // re-run past. Reporting it would overwrite the state of the run now on screen.
    if (generation !== replayGeneration) return res;
    isReplaying.value = false;
    replayResult.value = res;
    if (res) {
      if (res.stopped) replayPhase.value = "stopped";
      else if (res.passed) replayPhase.value = "passed";
      // Nothing streamed back, so no step ran: a pre-flight failure, not a
      // journey that failed on the page. Stay `idle` rather than `failed` —
      // the caller classifies the cause from `res.error` (see
      // CreateBrowserTest's `blockedReason`) and must not assume incognito.
      else if (stepResults.size === 0) replayPhase.value = "idle";
      else replayPhase.value = "failed";
    } else {
      replayPhase.value = "idle";
    }
    return res;
  }

  /**
   * Cancel an in-flight replay, holding the UI in `stopping` until the extension has
   * confirmed. The wait is what makes the Stop button honest — the run is not over the
   * instant the button is clicked — and `sendCommand` resolves `null` at
   * COMMAND_TIMEOUT_MS, so `stopping` is bounded and cannot strand the journey.
   */
  async function stopReplay(): Promise<void> {
    if (replayPhase.value !== "running") return;
    replayPhase.value = "stopping";
    await sendCommand({ action: "stopReplay" });
    // Orphan the in-flight `replay` promise: its response describes a run the user has
    // already abandoned, and it would otherwise re-report a phase behind this one.
    replayGeneration++;
    // The step that was mid-flight never produced a result, so nothing else will ever
    // clear this. Left set, it renders as a step stuck in progress.
    activeStepId.value = null;
    isReplaying.value = false;
    replayPhase.value = "stopped";
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
    bridgeDisconnect();
  }

  return {
    isSupported,
    isInstalled,
    extVersion,
    capabilities,
    hasCapability,
    isRecording,
    liveSteps,
    pickedSelector,
    extensionOutdated,
    currentUrl,
    mode,
    error,
    isReplaying,
    replayResult,
    replayPhase,
    stepResults,
    activeStepId,
    registerAutoDetect: (cb: (() => void) | null) => {
      onAutoDetected = cb;
    },
    detectExtension,
    startRecording,
    startRecordingFrom,
    recordFromHere,
    cancelRestore,
    recordedSteps,
    baselineStepCount,
    prefixFailure,
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
