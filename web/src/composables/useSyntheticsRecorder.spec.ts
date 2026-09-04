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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gt } from "@/types/i18n";
import useSyntheticsRecorder, { isExtensionOutdated } from "./useSyntheticsRecorder";
import type { BrowserStep, WireStep } from "@/types/synthetics";

// ── Bridge test helpers ───────────────────────────────────────────────────

let postMessageSpy: ReturnType<typeof vi.fn>;

/** Return the nonce embedded in the last synthetics-command postMessage call. */
function getLastCommandNonce(): string | null {
  const calls = postMessageSpy.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const data = calls[i]?.[0];
    if (data?.msg?.type === "synthetics-command") return data.nonce as string;
  }
  return null;
}

/** Return the cmd object from the last synthetics-command postMessage call. */
function getLastCommand(): { action: string; [k: string]: unknown } | null {
  const calls = postMessageSpy.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const data = calls[i]?.[0];
    if (data?.msg?.type === "synthetics-command") return data.msg.command as any;
  }
  return null;
}

/** Dispatch a bridge response matching the last command's nonce. */
function respondToLastCommand(msg: unknown) {
  const nonce = getLastCommandNonce();
  if (!nonce) throw new Error("No pending command nonce to respond to");
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: { ch: "oo-bridge", dir: "to-page", nonce, msg },
    }),
  );
}

/** Dispatch a streaming data event (synthetics-recorder type) on the bridge. */
function emitStreamEvent(payload: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: {
        ch: "oo-bridge",
        dir: "to-page",
        msg: { type: "synthetics-recorder", recordingId: "rec_1", payload },
      },
    }),
  );
}

/** Mirrors REPLAY_TIMEOUT_MS in the composable — the replay watchdog window. */
const REPLAY_TIMEOUT_MS = 15 * 60 * 1000;

/** Mirrors COMMAND_TIMEOUT_MS — the one-shot ack window that bounds `stopping`. */
const COMMAND_TIMEOUT_MS = 4000;

/** Let the 500 ms probe delay + any pending microtasks settle. */
async function settleProbeDelay() {
  await vi.advanceTimersByTimeAsync(500);
}

// ── Test suite ────────────────────────────────────────────────────────────

describe("useSyntheticsRecorder", () => {
  beforeEach(() => {
    postMessageSpy = vi.fn();
    vi.spyOn(window, "postMessage").mockImplementation(postMessageSpy);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── detectExtension ───────────────────────────────────────────────────

  describe("extension version handshake", () => {
    it("compares versions numerically per segment, not lexically", () => {
      // "0.10.0" is newer than "0.9.0", which a string comparison gets backwards.
      expect(isExtensionOutdated("0.1.1")).toBe(true);
      expect(isExtensionOutdated("0.2.0")).toBe(false);
      expect(isExtensionOutdated("0.10.0")).toBe(false);
      expect(isExtensionOutdated("1.0.0")).toBe(false);
    });

    it("treats a missing version as outdated, since only pre-0.2.0 builds omit it", () => {
      expect(isExtensionOutdated(undefined)).toBe(true);
    });

    it("marks a pre-0.2.0 extension outdated from its getStatus reply", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.detectExtension();
      await settleProbeDelay();
      // No `version` field: exactly what an extension older than 0.2.0 replies.
      respondToLastCommand({ isRecording: false, mode: "none", tabId: null, stepCount: 0 });
      await promise;

      expect(r.extensionOutdated.value).toBe(true);
    });

    it("accepts a current extension", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.detectExtension();
      await settleProbeDelay();
      respondToLastCommand({
        isRecording: false,
        mode: "none",
        tabId: null,
        stepCount: 0,
        extVersion: "0.2.0",
      });
      await promise;

      expect(r.extensionOutdated.value).toBe(false);
    });
  });

  describe("elementPicked", () => {
    it("keeps the selector the user picked in the extension", async () => {
      // Fires on "Pick locator" in the action picker, and on any click while the
      // recorder is in inspecting mode. Unlike setSources — which playwright-core
      // removed outright and which can never fire — this message is live, and
      // dropping it made inspect mode a dead end for the user.
      const r = useSyntheticsRecorder(gt);
      const promise = r.startRecording("https://app.test");
      await settleProbeDelay();
      respondToLastCommand({ success: true, tabId: 9 });
      await promise;

      emitStreamEvent({
        method: "elementPicked",
        elementInfo: { selector: "#login", ariaSnapshot: "" },
      });

      expect(r.pickedSelector.value).toBe("#login");
    });
  });

  describe("detectExtension", () => {
    it("should return true when the extension replies (no installed field)", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.detectExtension();

      await settleProbeDelay();
      respondToLastCommand({ isRecording: false, mode: "recording", tabId: null, stepCount: 0 });

      expect(await promise).toBe(true);
      expect(r.isInstalled.value).toBe(true);
    });

    it("should reflect an in-progress recording reported by getStatus", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.detectExtension();

      await settleProbeDelay();
      respondToLastCommand({ isRecording: true, mode: "recording", tabId: 3, stepCount: 2 });

      expect(await promise).toBe(true);
      expect(r.isInstalled.value).toBe(true);
      expect(r.isRecording.value).toBe(true);
    });

    it("should return false when the command times out (no extension reachable)", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.detectExtension();

      // Let the probe delay pass, then let the command timeout fire.
      await settleProbeDelay();
      await vi.advanceTimersByTimeAsync(4000);

      expect(await promise).toBe(false);
      expect(r.isInstalled.value).toBe(false);
    });
  });

  // ── startRecording ─────────────────────────────────────────────────────

  // ── capabilities (P1 handshake) ────────────────────────────────────────
  //
  // The extension is user-installed and updates asynchronously, so O2 always runs
  // against a mix of versions. Every affordance added from here on gates on a
  // capability STRING rather than a version number, so a capability can be added
  // or withdrawn without O2 parsing versions.
  //
  // The load-bearing case is the extension that predates the handshake entirely:
  // it reports no list at all, and O2 must read that as "record and replay, and
  // nothing newer" rather than as "nothing" (which would disable working buttons)
  // or "everything" (which would enable dead ones).
  //
  // See docs/synthetics/record-from-step-plan.md §2.
  describe("capabilities", () => {
    it("should expose a capability the extension reports", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.detectExtension();

      await settleProbeDelay();
      respondToLastCommand({
        isRecording: false,
        mode: "recording",
        tabId: null,
        stepCount: 0,
        extVersion: "0.2.0",
        capabilities: ["record", "replay", "recordFrom"],
      });
      await promise;

      expect(r.hasCapability("recordFrom")).toBe(true);
    });

    it("should not expose a capability the extension omits", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.detectExtension();

      await settleProbeDelay();
      respondToLastCommand({
        isRecording: false,
        mode: "recording",
        tabId: null,
        stepCount: 0,
        extVersion: "0.2.0",
        capabilities: ["record", "replay"],
      });
      await promise;

      expect(r.hasCapability("recordFrom")).toBe(false);
    });

    // The pre-handshake extension (0.1.1 and earlier). It can record and replay —
    // disabling those because it cannot introduce itself would break working
    // installs for everyone who has not updated.
    it("should assume record and replay when the extension reports no capability list", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.detectExtension();

      await settleProbeDelay();
      respondToLastCommand({ isRecording: false, mode: "recording", tabId: null, stepCount: 0 });
      await promise;

      expect(r.hasCapability("record")).toBe(true);
      expect(r.hasCapability("replay")).toBe(true);
    });

    // The other half of the same default, and the one that keeps a dead button off
    // the screen: absence must never be read as "supports everything".
    it("should not assume newer capabilities when the extension reports no list", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.detectExtension();

      await settleProbeDelay();
      respondToLastCommand({ isRecording: false, mode: "recording", tabId: null, stepCount: 0 });
      await promise;

      expect(r.hasCapability("recordFrom")).toBe(false);
    });

    it("should store the extension version reported by getStatus", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.detectExtension();

      await settleProbeDelay();
      respondToLastCommand({
        isRecording: false,
        mode: "recording",
        tabId: null,
        stepCount: 0,
        extVersion: "0.2.0",
        capabilities: ["record", "replay"],
      });
      await promise;

      expect(r.extVersion.value).toBe("0.2.0");
    });

    // Nothing answered, so nothing is installed — including the two capabilities
    // the absent-list default would otherwise grant.
    it("should report no capabilities when the extension is unreachable", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.detectExtension();

      await settleProbeDelay();
      await vi.advanceTimersByTimeAsync(COMMAND_TIMEOUT_MS);
      await promise;

      expect(r.hasCapability("record")).toBe(false);
      expect(r.hasCapability("recordFrom")).toBe(false);
    });

    // A capability list from a previous, richer extension must not survive a
    // re-probe that finds an older one (or none) — the toggle-incognito flow
    // re-probes, and a stale "recordFrom" there would re-enable a dead affordance.
    it("should drop a previously reported capability when a later probe finds it gone", async () => {
      const r = useSyntheticsRecorder(gt);

      const first = r.detectExtension();
      await settleProbeDelay();
      respondToLastCommand({
        isRecording: false,
        mode: "recording",
        tabId: null,
        stepCount: 0,
        capabilities: ["record", "replay", "recordFrom"],
      });
      await first;
      expect(r.hasCapability("recordFrom")).toBe(true);

      const second = r.detectExtension();
      await settleProbeDelay();
      respondToLastCommand({
        isRecording: false,
        mode: "recording",
        tabId: null,
        stepCount: 0,
        capabilities: ["record", "replay"],
      });
      await second;

      expect(r.hasCapability("recordFrom")).toBe(false);
    });
  });

  // ── startRecordingFrom (P2 restore-then-record) ───────────────────────
  //
  // The session is one continuous extension session: the prefix replays with the
  // recorder attached but disabled, then the recorder is enabled in place. Two things
  // must be true for the result to be trustworthy — the author must be told the
  // difference between "restoring" and "recording", and the steps handed back must be
  // ONLY what was recorded, never the openPage artifacts the collection accumulates
  // while disabled (recorderCollection pushes openPage/closePage past the enabled
  // guard). `baselineStepCount` is how the extension reports where the real capture
  // starts. See docs/synthetics/record-from-step-plan.md §3.
  describe("startRecordingFrom", () => {
    const prefix = [
      { id: "a", action: "navigate", url: "https://app.test/" },
      { id: "b", action: "click", selector: "#login" },
    ] as unknown as WireStep[];

    /** Drive a session to the point where the prefix has replayed and recording is live. */
    async function startInsertSession(r: ReturnType<typeof useSyntheticsRecorder>) {
      const promise = r.startRecordingFrom(prefix);
      await settleProbeDelay();
      respondToLastCommand({ success: true });
      await promise;
      emitStreamEvent({
        method: "recordingStarted",
        tabId: 7,
        url: "https://app.test/dashboard",
        mode: "insert",
        baselineStepCount: 1,
      });
    }

    it("should send the prefix steps for the extension to replay", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.startRecordingFrom(prefix);

      await settleProbeDelay();
      const command = getLastCommand();

      expect(command?.action).toBe("startRecordingFrom");
      expect(command?.prefixSteps).toHaveLength(2);

      respondToLastCommand({ success: true });
      await promise;
    });

    // The author is watching their own journey replay. Calling that "recording" would
    // invite them to start clicking, and every click would land during the restore.
    it("should report the restoring phase while the prefix replays", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.startRecordingFrom(prefix);

      await settleProbeDelay();
      respondToLastCommand({ success: true });
      await promise;

      expect(r.replayPhase.value).toBe("restoring");
      expect(r.isRecording.value).toBe(false);
    });

    it("should start recording only once the extension reports the prefix landed", async () => {
      const r = useSyntheticsRecorder(gt);
      await startInsertSession(r);

      expect(r.isRecording.value).toBe(true);
      expect(r.replayPhase.value).not.toBe("restoring");
    });

    // The load-bearing one. liveSteps carries the openPage the recorder logs while
    // disabled; returning it would insert a bogus navigate at the head of every
    // inserted block.
    it("should return only the steps recorded after the baseline", async () => {
      const r = useSyntheticsRecorder(gt);
      await startInsertSession(r);

      emitStreamEvent({
        method: "setActions",
        actions: [],
        sources: [],
        browserSteps: [
          { id: "art", action: "navigate", url: "https://app.test/dashboard" },
          { id: "n1", action: "click", selector: "#new" },
          { id: "n2", action: "type", selector: "#q", value: "hello" },
        ],
      });

      const steps = await (async () => {
        const p = r.stopRecording();
        respondToLastCommand({ success: true });
        return await p;
      })();

      expect(steps.map((s) => s.action)).toEqual(["click", "type"]);
    });

    // The same rule, on the exit the author is far more likely to take: closing the
    // recorder window ends the session through `recordingStopped` rather than the Stop
    // button. Handing the raw list over there splices the whole replayed prefix back
    // into the journey at the anchor, so a 15-step journey returns with 19.
    it("should return only the post-baseline steps when the extension stops the session", async () => {
      const r = useSyntheticsRecorder(gt);
      const committed: BrowserStep[][] = [];
      r.setOnExternalStop((steps) => committed.push(steps));

      await startInsertSession(r);

      emitStreamEvent({
        method: "setActions",
        actions: [],
        sources: [],
        browserSteps: [
          { id: "art", action: "navigate", url: "https://app.test/dashboard" },
          { id: "n1", action: "click", selector: "#new" },
          { id: "n2", action: "type", selector: "#q", value: "hello" },
        ],
      });

      emitStreamEvent({ method: "recordingStopped" });

      expect(committed).toHaveLength(1);
      expect(committed[0].map((s) => s.action)).toEqual(["click", "type"]);
    });

    // A plain recording has no baseline, so the same stopRecording must not slice.
    it("should return every step for a plain recording, which has no baseline", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.startRecording("https://app.test/");
      await settleProbeDelay();
      respondToLastCommand({ success: true });
      await promise;

      emitStreamEvent({
        method: "setActions",
        actions: [],
        sources: [],
        browserSteps: [
          { id: "n1", action: "navigate", url: "https://app.test/" },
          { id: "n2", action: "click", selector: "#new" },
        ],
      });

      const p = r.stopRecording();
      respondToLastCommand({ success: true });
      const steps = await p;

      expect(steps).toHaveLength(2);
    });

    // Found end-to-end: the restore ran, the browser reached the right state, the
    // author recorded — and nothing arrived. `startRecordingFrom` is answered only
    // once the whole prefix has replayed, which is far longer than the 4 s one-shot
    // ack window. Timing out tore the bridge down, so every later setActions push was
    // dropped and Stop returned an empty journey. Same class as `replay`, which is why
    // that one carries REPLAY_TIMEOUT_MS.
    it("should keep the session alive while the prefix is still replaying", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.startRecordingFrom(prefix);
      await settleProbeDelay();

      // Well past the one-shot ack window, but a perfectly ordinary restore duration.
      await vi.advanceTimersByTimeAsync(COMMAND_TIMEOUT_MS * 2);

      expect(
        r.replayPhase.value,
        "the restore was abandoned before the extension could answer",
      ).toBe("restoring");
      expect(r.error.value).toBe("");

      respondToLastCommand({ success: true });
      await promise;

      // The bridge must still be live, or the recorded steps never arrive.
      emitStreamEvent({
        method: "recordingStarted",
        tabId: 1,
        url: "https://app.test/",
        mode: "insert",
        baselineStepCount: 0,
      });
      emitStreamEvent({
        method: "setActions",
        actions: [],
        sources: [],
        browserSteps: [{ id: "n1", action: "click", selector: "#new" }],
      });
      expect(
        r.liveSteps.value.length,
        "the bridge was torn down, so recorded steps never reached the journey",
      ).toBe(1);
    });

    it("should surface which step made the restore fail", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.startRecordingFrom(prefix);
      await settleProbeDelay();
      respondToLastCommand({ success: true });
      await promise;

      emitStreamEvent({
        method: "prefixFailed",
        stepId: "b",
        error: "locator resolved to 0 elements",
      });

      expect(r.prefixFailure.value?.stepId).toBe("b");
      expect(r.prefixFailure.value?.error).toContain("locator");
    });

    // A failed restore must not leave the UI claiming a recording is in progress.
    it("should not be recording after the restore failed", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.startRecordingFrom(prefix);
      await settleProbeDelay();
      respondToLastCommand({ success: true });
      await promise;

      emitStreamEvent({ method: "prefixFailed", stepId: "b", error: "boom" });

      expect(r.isRecording.value).toBe(false);
      expect(r.replayPhase.value).not.toBe("restoring");
    });

    // The reason decides the whole surface downstream — a toast for a cancel, a
    // recovery banner for a real failure — so it is classified once, here.
    it("should say a restore ended because the window was closed", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.startRecordingFrom(prefix);
      await settleProbeDelay();
      respondToLastCommand({ success: true });
      await promise;

      emitStreamEvent({
        method: "prefixFailed",
        stepId: "b",
        error: "crxRecorder.runActions: Target page, context or browser has been closed",
        structuredError: { message: "…", name: "TargetClosedError" },
      });

      expect(r.prefixFailure.value?.reason).toBe("window-closed");
    });

    it("should say a restore ended because a step failed", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.startRecordingFrom(prefix);
      await settleProbeDelay();
      respondToLastCommand({ success: true });
      await promise;

      emitStreamEvent({
        method: "prefixFailed",
        stepId: "b",
        error: "locator.click: Timeout 30000ms exceeded",
        structuredError: { message: "…", name: "TimeoutError" },
      });

      expect(r.prefixFailure.value?.reason).toBe("step-failed");
      // The error card's vocabulary keys on this, so dropping it forced the
      // banner to render the raw Playwright string instead.
      expect(r.prefixFailure.value?.structuredError?.name).toBe("TimeoutError");
    });

    /**
     * The extension reports one failure twice — a `prefixFailed` push and a
     * `{success:false}` on the command it is answering. Both used to render, so a
     * closed window produced a warning banner AND a raw red banner, one cause
     * stacked on itself.
     *
     * The push always lands first: the extension sends it before returning, and both
     * travel the same relay in order. That ordering is what this suppression relies
     * on, so it is the ordering the test drives.
     */
    it("should not raise a second, rawer report of the failure it already described", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.startRecordingFrom(prefix);
      await settleProbeDelay();

      emitStreamEvent({
        method: "prefixFailed",
        stepId: "b",
        error: "Target page, context or browser has been closed",
      });
      respondToLastCommand({
        success: false,
        error: "Target page, context or browser has been closed",
      });
      await promise;

      expect(r.error.value).toBe("");
    });

    /**
     * The session the extension deliberately left open has to stay reachable.
     *
     * On a prefix failure the extension keeps the browser sitting where the failing
     * step stopped — that is what makes the recovery a mode flip rather than a second
     * restore. Tearing the stream handler down here would leave that session running
     * with nothing in O2 listening, so the steps the author then records arrive
     * nowhere.
     */
    it("should keep listening to the session a failed prefix left open", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.startRecordingFrom(prefix);
      await settleProbeDelay();
      emitStreamEvent({ method: "prefixFailed", stepId: "b", error: "boom" });
      respondToLastCommand({ success: false, error: "boom" });
      await promise;

      emitStreamEvent({
        method: "recordingStarted",
        tabId: 1,
        url: "https://app.test/",
        mode: "insert",
        baselineStepCount: 0,
      });
      emitStreamEvent({
        method: "setActions",
        actions: [],
        sources: [],
        browserSteps: [{ id: "n1", action: "click", selector: "#new" }],
      });

      expect(r.liveSteps.value).toHaveLength(1);
    });

    // A start that never got as far as replaying a step has no prefixFailed to
    // speak for it, so the raw report is all there is and must survive.
    it("should still report a start that failed before the prefix ran", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.startRecordingFrom(prefix);
      await settleProbeDelay();
      respondToLastCommand({ success: false, error: "Recording needs incognito access." });
      await promise;

      expect(r.error.value).toBe("Recording needs incognito access.");
    });

    /**
     * The restore banner counts `stepResults`, and the prefix streams its results over
     * the same messages a replay uses. Those were being dropped: the stream gate
     * admits only `running` and `stopping`, and a restore is neither — so the banner
     * read "step 0 of N" for the whole restore while the recorder window visibly
     * worked through it.
     */
    it("should count the steps a restore has replayed", async () => {
      const r = useSyntheticsRecorder(gt);
      // Left in flight deliberately: the extension answers only once the prefix has
      // finished, so this is the state every one of these results arrives in.
      void r.startRecordingFrom(prefix);
      await settleProbeDelay();
      expect(r.replayPhase.value).toBe("restoring");

      emitStreamEvent({ method: "stepReplayResult", stepId: "a", passed: true, duration_ms: 10 });
      emitStreamEvent({ method: "stepReplayResult", stepId: "b", passed: true, duration_ms: 12 });

      expect(r.stepResults.size).toBe(2);
    });

    /**
     * The gate this widens exists to keep late events out of a run nobody is watching
     * (#13592). Widening it to `restoring` must not reopen that: once the restore has
     * handed over to recording, its results are history.
     */
    it("should still ignore a result that arrives once the restore is over", async () => {
      const r = useSyntheticsRecorder(gt);
      void r.startRecordingFrom(prefix);
      await settleProbeDelay();
      emitStreamEvent({
        method: "recordingStarted",
        tabId: 1,
        url: "https://app.test/",
        mode: "insert",
        baselineStepCount: 0,
      });
      expect(r.replayPhase.value).not.toBe("restoring");

      emitStreamEvent({ method: "stepReplayResult", stepId: "late", passed: true, duration_ms: 9 });

      expect(r.stepResults.has("late")).toBe(false);
    });

    // ── Cancelling a restore ────────────────────────────────────────────────
    //
    // Until there was a Cancel, closing the recorder window was the only way out of
    // a restore — and that arrives as an exception, which is how walking away came
    // to be reported as a failing step.

    /**
     * The command is STILL OUTSTANDING when the author cancels — which is the only
     * state a cancel can happen in, since the extension answers `startRecordingFrom`
     * only once the whole prefix has finished.
     *
     * Ending the session force-resolves that promise (`bridgeDisconnect` answers every
     * pending command with null), so its continuation runs AFTER the cancel has
     * cleaned up and wrote "Failed to start recording." over the top — a failure
     * banner for the button the author had just pressed to make things stop.
     */
    it("should not report a failure for the restore it just cancelled", async () => {
      const r = useSyntheticsRecorder(gt);
      const pending = r.startRecordingFrom(prefix);
      await settleProbeDelay();

      r.cancelRestore();
      await pending;

      expect(r.error.value).toBe("");
      expect(r.replayPhase.value).toBe("idle");
    });

    /**
     * Why the guard counts sessions rather than raising a "cancelled" flag.
     *
     * The abandoned restore's answer arrives whenever it arrives — possibly after the
     * author has started another one. A flag would still be up, and the new session's
     * genuine refusal would be swallowed by the previous session's cancel.
     */
    it("should not let a cancelled restore silence the next one's failure", async () => {
      const r = useSyntheticsRecorder(gt);
      const abandoned = r.startRecordingFrom(prefix);
      await settleProbeDelay();
      r.cancelRestore();
      await abandoned;

      const second = r.startRecordingFrom(prefix);
      await settleProbeDelay();
      respondToLastCommand({ success: false, error: "Recording needs incognito access." });
      await second;

      expect(r.error.value).toBe("Recording needs incognito access.");
    });

    it("should ask the extension to stop the prefix it is replaying", async () => {
      const r = useSyntheticsRecorder(gt);
      const pending = r.startRecordingFrom(prefix);
      await settleProbeDelay();

      r.cancelRestore();
      await pending;

      expect(getLastCommand()?.action).toBe("stopReplay");
      expect(r.replayPhase.value).toBe("idle");
      expect(r.isRecording.value).toBe(false);
    });

    /**
     * Stopping the player makes the in-flight action throw, so the extension reports
     * the cancel back as a `prefixFailed` — the same message a real failure uses. O2
     * asked for it, so it must not turn round and report it as a problem: the cancel
     * ends the session, and the stream handler ends with it.
     */
    it("should stay quiet about the failure its own cancel provokes", async () => {
      const r = useSyntheticsRecorder(gt);
      const pending = r.startRecordingFrom(prefix);
      await settleProbeDelay();

      r.cancelRestore();
      emitStreamEvent({ method: "prefixFailed", stepId: "b", error: "Stopped" });
      await pending;

      expect(r.prefixFailure.value).toBeNull();
      expect(r.error.value).toBe("");
    });

    // The suppression is scoped to the cancelled session: the next restore has to be
    // able to report its own failures.
    it("should report a failure in the restore that follows a cancelled one", async () => {
      const r = useSyntheticsRecorder(gt);
      const first = r.startRecordingFrom(prefix);
      await settleProbeDelay();
      r.cancelRestore();
      await first;

      const second = r.startRecordingFrom(prefix);
      await settleProbeDelay();
      respondToLastCommand({ success: true });
      await second;
      emitStreamEvent({ method: "prefixFailed", stepId: "b", error: "Timeout 30000ms exceeded" });

      expect(r.prefixFailure.value?.stepId).toBe("b");
    });

    // ── Recovering from a failed prefix ─────────────────────────────────────
    //
    // The browser is already sitting where the failing step stopped, which is a
    // legitimate restored state — just an earlier one than was asked for. So the
    // recovery is a mode flip on the session that is still open, not another
    // restore: no teardown, no second replay, no wasted minute (design §7.6).

    async function failedRestore(r: ReturnType<typeof useSyntheticsRecorder>) {
      const promise = r.startRecordingFrom(prefix);
      await settleProbeDelay();
      emitStreamEvent({
        method: "prefixFailed",
        stepId: "b",
        error: "locator.click: Timeout 30000ms exceeded",
        structuredError: { message: "…", name: "TimeoutError" },
      });
      respondToLastCommand({ success: false, error: "Timeout" });
      await promise;
    }

    it("should record on the session the failed prefix left open", async () => {
      const r = useSyntheticsRecorder(gt);
      await failedRestore(r);

      const promise = r.recordFromHere();
      expect(getLastCommand()?.action).toBe("recordFromHere");

      respondToLastCommand({ success: true });
      await promise;
      // The extension still has the last word on when capture starts — it has to
      // reset the collection and flip the mode first.
      emitStreamEvent({
        method: "recordingStarted",
        tabId: 7,
        url: "https://app.test/",
        mode: "insert",
        baselineStepCount: 0,
      });

      expect(r.isRecording.value).toBe(true);
      expect(r.prefixFailure.value).toBeNull();
    });

    // The banner is the only thing still describing that failure; a recovery that
    // starts while it is on screen leaves the author recording under a warning.
    it("should retire the failure the moment the recovery starts", async () => {
      const r = useSyntheticsRecorder(gt);
      await failedRestore(r);

      const promise = r.recordFromHere();
      expect(r.prefixFailure.value).toBeNull();

      respondToLastCommand({ success: true });
      await promise;
    });

    /**
     * An extension too old for the command answers `unsupported-command` rather than
     * hanging (P1). The failure has to come back so the author is told, instead of a
     * banner quietly closing over a recording that never started.
     */
    it("should report a refusal to record on the open session", async () => {
      const r = useSyntheticsRecorder(gt);
      await failedRestore(r);

      const promise = r.recordFromHere();
      respondToLastCommand({ success: false, error: "unsupported-command" });
      await promise;

      expect(r.error.value).toBe("unsupported-command");
      expect(r.isRecording.value).toBe(false);
    });

    // Starting a fresh session must clear the previous failure, or the recovery
    // banner outlives the problem it describes.
    it("should clear a previous restore failure when a new session starts", async () => {
      const r = useSyntheticsRecorder(gt);
      const first = r.startRecordingFrom(prefix);
      await settleProbeDelay();
      respondToLastCommand({ success: true });
      await first;
      emitStreamEvent({ method: "prefixFailed", stepId: "b", error: "boom" });
      expect(r.prefixFailure.value).not.toBeNull();

      const second = r.startRecordingFrom(prefix);
      await settleProbeDelay();
      respondToLastCommand({ success: true });
      await second;

      expect(r.prefixFailure.value).toBeNull();
    });
  });

  describe("startRecording", () => {
    it("should send a startRecording command via the bridge and map setActions pushes", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.startRecording("https://app.test/login");

      await settleProbeDelay();
      respondToLastCommand({ success: true });

      await promise;
      expect(r.isRecording.value).toBe(true);
      expect(r.currentUrl.value).toBe("https://app.test/login");

      // Verify the command was posted correctly
      const cmd = getLastCommand();
      expect(cmd).toMatchObject({ action: "startRecording", targetUrl: "https://app.test/login" });
      // The field existed on the command type and was never populated, so every
      // recording silently fell back to Playwright's `data-testid`.
      expect(cmd.testIdAttr).toBe("data-test");

      // Stream steps
      const browserSteps: WireStep[] = [{ id: "s1", action: "click", selector: "#go" }];
      emitStreamEvent({ method: "setActions", browserSteps });
      expect(r.liveSteps.value).toHaveLength(1);
      expect(r.liveSteps.value[0].selector).toBe("#go");

      emitStreamEvent({ method: "recordingStarted", tabId: 9, url: "https://app.test/next" });
      expect(r.currentUrl.value).toBe("https://app.test/next");
    });

    it("should ignore command-ack messages on the bridge", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.startRecording("https://app.test");

      await settleProbeDelay();
      respondToLastCommand({ success: true });
      await promise;

      // A synthetics-response with its own nonce should be ignored (no matching nonce in pendingCommands)
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: {
            ch: "oo-bridge",
            dir: "to-page",
            msg: {
              type: "synthetics-response",
              nonce: "unknown_nonce",
              response: { success: true },
            },
          },
        }),
      );
      expect(r.liveSteps.value).toHaveLength(0);
    });

    it("should surface an error and tear down when start fails", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.startRecording("https://app.test");

      await settleProbeDelay();
      respondToLastCommand({ success: false, error: "boom" });

      await promise;
      expect(r.isRecording.value).toBe(false);
      expect(r.error.value).toBe("boom");
    });

    it("should set a fallback error when the start response has no error text", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.startRecording("https://app.test");

      await settleProbeDelay();
      respondToLastCommand({ success: false });

      await promise;
      expect(r.isRecording.value).toBe(false);
      expect(r.error.value).toBe("Failed to start recording.");
    });
  });

  it("sends the configured test-id attribute when one is given", async () => {
    const r = useSyntheticsRecorder(gt);
    const promise = r.startRecording("https://app.test", "data-qa");

    await settleProbeDelay();
    respondToLastCommand({ success: true });
    await promise;

    // An application on data-qa/data-cy/data-pw produced NO test-attribute
    // candidates before this — upstream's hardcoded fallback list covers only
    // data-testid, data-test-id and data-test, so their strongest attribute
    // was stored as plain css, rank 3, behind text.
    expect(getLastCommand().testIdAttr).toBe("data-qa");
  });

  it("falls back to the O2 default when no attribute is given", async () => {
    const r = useSyntheticsRecorder(gt);
    const promise = r.startRecording("https://app.test", "");

    await settleProbeDelay();
    respondToLastCommand({ success: true });
    await promise;

    expect(getLastCommand().testIdAttr).toBe("data-test");
  });

  // ── stopRecording ──────────────────────────────────────────────────────

  describe("stopRecording", () => {
    it("should return the live-accumulated steps via the bridge", async () => {
      const r = useSyntheticsRecorder(gt);
      const startPromise = r.startRecording("https://x.test");

      await settleProbeDelay();
      respondToLastCommand({ success: true });
      await startPromise;

      // Steps arrive live over the bridge
      emitStreamEvent({
        method: "setActions",
        browserSteps: [{ id: "s1", action: "navigate", url: "https://x.test" }],
      });

      const stopPromise = r.stopRecording();
      respondToLastCommand({ success: true });
      const steps = await stopPromise;

      expect(steps).toHaveLength(1);
      expect(steps[0].action).toBe("navigate");
      expect(steps[0].value).toBe("https://x.test");
      expect(r.isRecording.value).toBe(false);
    });
  });

  // ── cancelRecording ────────────────────────────────────────────────────

  describe("cancelRecording", () => {
    it("should clear state without returning steps", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.startRecording("https://x.test");

      await settleProbeDelay();
      respondToLastCommand({ success: true });
      await promise;

      r.cancelRecording();
      expect(r.isRecording.value).toBe(false);
      expect(r.liveSteps.value).toHaveLength(0);
    });
  });

  // ── replay ─────────────────────────────────────────────────────────────

  describe("replay", () => {
    const steps: WireStep[] = [{ id: "s1", action: "navigate", url: "https://x.test" }];

    it("should send a replay command, toggle isReplaying, and store the result", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.replay(steps, "https://x.test");

      await settleProbeDelay();
      respondToLastCommand({ success: true, passed: true });
      const res = await promise;

      // The command should be a synthetics-command with action 'replay'
      const lastCmdCall = postMessageSpy.mock.calls.find(
        (c: any) => c[0]?.msg?.command?.action === "replay",
      );
      expect(lastCmdCall).toBeTruthy();
      const sent = lastCmdCall![0];
      expect(sent.msg.command.action).toBe("replay");
      expect(sent.msg.command.steps).toEqual(steps);
      expect(sent.msg.command.targetUrl).toBe("https://x.test");

      expect(res).toEqual({ success: true, passed: true });
      expect(r.isReplaying.value).toBe(false);
      expect(r.replayResult.value).toEqual({ success: true, passed: true });
    });

    it("should accept auth, headers, cookies, and variables without throwing", async () => {
      const r = useSyntheticsRecorder(gt);
      const vars = [{ name: "BASE_URL", value: "https://example.com" }];
      const auth = { type: "basic" as const, username: "admin", password: "secret" };
      const headers = [{ key: "X-Custom", value: "val" }];
      const cookies = [{ name: "session", value: "abc123", domain: "example.com" }];

      const promise = r.replay(steps, "https://x.test", vars, auth, headers, cookies);

      await settleProbeDelay();
      respondToLastCommand({ success: true, passed: true });
      const res = await promise;

      // The replay command includes action, steps, and targetUrl.
      // (auth/headers/cookies are accepted by the API but forwarded by the
      // bridge transport, not embedded in the command object.)
      const sentCmd = getLastCommand();
      expect(sentCmd).toMatchObject({
        action: "replay",
        steps,
        targetUrl: "https://x.test",
      });
      expect(res).toEqual({ success: true, passed: true });
    });

    it("should substitute variables in wire steps before sending", async () => {
      const r = useSyntheticsRecorder(gt);
      const stepsWithVars: WireStep[] = [
        { id: "s1", action: "navigate", url: "https://{{ BASE_URL }}/login" },
        { id: "s2", action: "type", selector: "#email", value: "{{ EMAIL }}" },
      ];
      const vars = [
        { name: "BASE_URL", value: "example.com" },
        { name: "EMAIL", value: "test@test.com" },
      ];

      const promise = r.replay(stepsWithVars, "https://example.com", vars);

      await settleProbeDelay();
      respondToLastCommand({ success: true, passed: true });
      await promise;

      const sentCmd = getLastCommand()!;
      expect(sentCmd.steps[0].url).toBe("https://example.com/login");
      expect(sentCmd.steps[1].value).toBe("test@test.com");
    });

    it("should store a failed replay result with the step error", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.replay(steps);

      await settleProbeDelay();
      respondToLastCommand({ success: true, passed: false, error: "Timeout on #go" });
      const res = await promise;

      expect(res).toMatchObject({ passed: false, error: "Timeout on #go" });
    });

    it("should not send a command when there are no steps", async () => {
      const r = useSyntheticsRecorder(gt);
      const res = await r.replay([]);
      expect(res).toBeNull();
      expect(r.error.value).toContain("No replayable steps");
    });

    // ── Stop ────────────────────────────────────────────────────────────
    //
    // The extension cannot stop instantly, so the phase machine has to say so.
    // Before this, Stop flipped straight to "stopped" while the run was still
    // winding down, and the step it was interrupted on kept its spinner forever
    // because nothing ever cleared activeStepId.

    /**
     * Start a replay and settle into the `running` phase, mid-journey. The replay
     * promise is deliberately left floating — these tests are about what Stop does
     * while it is still in flight, and the extension never answers it.
     */
    async function startRunningReplay(r: ReturnType<typeof useSyntheticsRecorder>) {
      void r.replay(steps);
      await settleProbeDelay();
    }

    it("stopReplay should send a stopReplay command", async () => {
      const r = useSyntheticsRecorder(gt);
      await startRunningReplay(r);

      const promise = r.stopReplay();
      respondToLastCommand({ success: true });
      await promise;

      expect(getLastCommand()).toMatchObject({ action: "stopReplay" });
    });

    it("should hold the stopping phase until the extension confirms", async () => {
      const r = useSyntheticsRecorder(gt);
      await startRunningReplay(r);
      emitStreamEvent({ method: "stepReplayStarted", stepId: "s1" });

      const promise = r.stopReplay();
      await vi.advanceTimersByTimeAsync(0);
      expect(r.replayPhase.value).toBe("stopping");

      respondToLastCommand({ success: true });
      await promise;

      expect(r.replayPhase.value).toBe("stopped");
      expect(r.isReplaying.value).toBe(false);
    });

    it("should clear the active step so no step is left in progress after a stop", async () => {
      // Regression: the step the replay was interrupted on never reports a result,
      // so a non-null activeStepId rendered as a permanently spinning status dot.
      const r = useSyntheticsRecorder(gt);
      await startRunningReplay(r);
      emitStreamEvent({ method: "stepReplayStarted", stepId: "s1" });
      expect(r.activeStepId.value).toBe("s1");

      const promise = r.stopReplay();
      respondToLastCommand({ success: true });
      await promise;

      expect(r.activeStepId.value).toBeNull();
    });

    it("should reach stopped even when the extension never acknowledges the stop", async () => {
      const r = useSyntheticsRecorder(gt);
      await startRunningReplay(r);

      const promise = r.stopReplay();
      // No response — only the one-shot command timeout releases it.
      await vi.advanceTimersByTimeAsync(COMMAND_TIMEOUT_MS);
      await promise;

      expect(r.replayPhase.value).toBe("stopped");
      expect(r.isReplaying.value).toBe(false);
    });

    it("should ignore a stepReplayStarted that arrives after the stop", async () => {
      // The player can announce a step in the instant before the abort lands.
      // Honouring it would re-arm the spinner on a step that never ran.
      const r = useSyntheticsRecorder(gt);
      await startRunningReplay(r);

      const promise = r.stopReplay();
      respondToLastCommand({ success: true });
      await promise;

      emitStreamEvent({ method: "stepReplayStarted", stepId: "s2" });
      expect(r.activeStepId.value).toBeNull();
    });

    it("should still record a step result that was already in flight when stopping", async () => {
      // That step genuinely ran, so it must keep counting toward "completed X of N".
      const r = useSyntheticsRecorder(gt);
      await startRunningReplay(r);

      const promise = r.stopReplay();
      await vi.advanceTimersByTimeAsync(0);
      emitStreamEvent({ method: "stepReplayResult", stepId: "s1", passed: true, duration_ms: 12 });

      respondToLastCommand({ success: true });
      await promise;

      expect(r.stepResults.size).toBe(1);
    });

    it("should not let a stopped replay's response clobber a newer run", async () => {
      // Regression: Stop returns as soon as the extension acknowledges, but the
      // original `replay` promise resolves later. Without a generation guard it
      // landed on the run started in between and knocked "running" back to "stopped".
      const r = useSyntheticsRecorder(gt);
      const firstReplay = r.replay(steps);
      await settleProbeDelay();
      const firstNonce = getLastCommandNonce()!;

      const stopPromise = r.stopReplay();
      respondToLastCommand({ success: true });
      await stopPromise;
      expect(r.replayPhase.value).toBe("stopped");

      // User immediately hits Re-run.
      const secondReplay = r.replay(steps);
      await settleProbeDelay();
      expect(r.replayPhase.value).toBe("running");

      // Only now does the abandoned first replay answer.
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: {
            ch: "oo-bridge",
            dir: "to-page",
            nonce: firstNonce,
            msg: { success: true, passed: false, stopped: true },
          },
        }),
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(r.replayPhase.value).toBe("running");
      expect(r.isReplaying.value).toBe(true);

      respondToLastCommand({ success: true, passed: true });
      await secondReplay;
      expect(r.replayPhase.value).toBe("passed");
      void firstReplay;
    });

    it("should not resurrect the stopped banner after the results are dismissed", async () => {
      // Regression: the abandoned replay answers long after Stop. If it is still
      // allowed to report, dismissing the stopped banner only hides it until that
      // response lands and puts the journey back into "stopped".
      const r = useSyntheticsRecorder(gt);
      await startRunningReplay(r);
      const replayNonce = getLastCommandNonce()!;

      const stopPromise = r.stopReplay();
      respondToLastCommand({ success: true });
      await stopPromise;

      // User dismisses the banner (CreateBrowserTest's onClearResults).
      r.replayPhase.value = "idle";

      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: {
            ch: "oo-bridge",
            dir: "to-page",
            nonce: replayNonce,
            msg: { success: true, passed: false, stopped: true },
          },
        }),
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(r.replayPhase.value).toBe("idle");
    });

    // ── The bridge dies mid-replay ──────────────────────────────────────────
    //
    // Closing the recorder window can take the extension's ability to report with
    // it. The outcome of a replay travels on exactly ONE channel — the answer to the
    // `replay` command — so when that channel goes, nothing moves the run out of
    // `running`: the banner keeps counting and the step it was on keeps its spinner.
    //
    // #13592 made every KNOWN ending clear that spinner. It could not cover this one,
    // because all of its guards are conditioned on the phase having already left
    // `running`, and here nothing takes it there.

    /** The content script telling the page its port to the worker has dropped. */
    function emitBridgeDisconnect() {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: { ch: "oo-bridge", dir: "to-page", msg: { type: "bridge-disconnected" } },
        }),
      );
    }

    it("should end a replay whose bridge died rather than leave it running", async () => {
      const r = useSyntheticsRecorder(gt);
      await startRunningReplay(r);
      emitStreamEvent({ method: "stepReplayStarted", stepId: "s1" });

      emitBridgeDisconnect();

      expect(r.replayPhase.value, "the journey is still claiming to replay").toBe("stopped");
      expect(r.isReplaying.value).toBe(false);
    });

    it("should clear the step a dead bridge left in progress", async () => {
      // The reported symptom: a step spinning forever, because the result that would
      // have cleared it can no longer be delivered.
      const r = useSyntheticsRecorder(gt);
      await startRunningReplay(r);
      emitStreamEvent({ method: "stepReplayStarted", stepId: "s1" });
      expect(r.activeStepId.value).toBe("s1");

      emitBridgeDisconnect();

      expect(r.activeStepId.value).toBeNull();
    });

    // What the run did manage to prove is still real, and the stopped banner counts it.
    it("should keep the results the replay had already reported", async () => {
      const r = useSyntheticsRecorder(gt);
      await startRunningReplay(r);
      emitStreamEvent({ method: "stepReplayResult", stepId: "s1", passed: true, duration_ms: 12 });

      emitBridgeDisconnect();

      expect(r.stepResults.size).toBe(1);
    });

    /**
     * The worker buffers what it could not deliver and re-sends on the next connect,
     * so the abandoned run's answer can arrive minutes later — after the author has
     * dismissed the banner, or started another run.
     */
    it("should ignore the answer of a replay the bridge already ended", async () => {
      const r = useSyntheticsRecorder(gt);
      await startRunningReplay(r);
      const abandonedNonce = getLastCommandNonce()!;
      // A reported step, so the late answer has something to be classified as: with
      // results present it reads as `failed`, which is what would land on the author.
      emitStreamEvent({ method: "stepReplayResult", stepId: "s1", passed: true, duration_ms: 12 });

      emitBridgeDisconnect();
      r.replayPhase.value = "idle"; // author dismisses the banner

      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: {
            ch: "oo-bridge",
            dir: "to-page",
            nonce: abandonedNonce,
            msg: { success: true, passed: false, error: "Target page… has been closed" },
          },
        }),
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(r.replayPhase.value).toBe("idle");
    });

    // A disconnect once the run is over describes nothing — it must not overwrite the
    // result the author is reading.
    it("should leave a finished replay's result alone", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.replay(steps);
      await settleProbeDelay();
      respondToLastCommand({ success: true, passed: true });
      await promise;
      expect(r.replayPhase.value).toBe("passed");

      emitBridgeDisconnect();

      expect(r.replayPhase.value).toBe("passed");
    });

    it("should be a no-op when no replay is running", async () => {
      const r = useSyntheticsRecorder(gt);
      await r.stopReplay();

      expect(r.replayPhase.value).toBe("idle");
      expect(getLastCommand()).toBeNull();
    });

    it("should stay running past the one-shot command timeout while steps stream in", async () => {
      // Regression: a real journey takes far longer than COMMAND_TIMEOUT_MS.
      // The extension only answers the `replay` command once the whole journey
      // has finished, so a blanket short timeout made the UI fall back to
      // "idle" a few steps in while the extension kept replaying.
      const journey: WireStep[] = [
        { id: "s1", action: "navigate", url: "https://x.test" },
        { id: "s2", action: "click", selector: "#login" },
        { id: "s3", action: "click", selector: "#logout" },
      ];
      const r = useSyntheticsRecorder(gt);
      const promise = r.replay(journey);

      await settleProbeDelay();

      // Two steps land inside the first four seconds.
      await vi.advanceTimersByTimeAsync(2000);
      emitStreamEvent({ method: "stepReplayResult", stepId: "s1", passed: true, duration_ms: 900 });
      await vi.advanceTimersByTimeAsync(2000);
      emitStreamEvent({ method: "stepReplayResult", stepId: "s2", passed: true, duration_ms: 800 });

      // Past the one-shot timeout the replay is still in flight.
      await vi.advanceTimersByTimeAsync(5000);
      expect(r.replayPhase.value).toBe("running");
      expect(r.isReplaying.value).toBe(true);

      // The extension finally answers, 30s in.
      await vi.advanceTimersByTimeAsync(21000);
      emitStreamEvent({ method: "stepReplayResult", stepId: "s3", passed: true, duration_ms: 700 });
      respondToLastCommand({ success: true, passed: true });

      expect(await promise).toEqual({ success: true, passed: true });
      expect(r.replayPhase.value).toBe("passed");
      expect(r.isReplaying.value).toBe(false);
      expect(r.stepResults.size).toBe(3);
    });

    it("should give up when the extension never answers the replay command", async () => {
      const r = useSyntheticsRecorder(gt);
      const promise = r.replay(steps);

      await settleProbeDelay();
      await vi.advanceTimersByTimeAsync(REPLAY_TIMEOUT_MS);

      const res = await promise;
      expect(res).toBeNull();
      expect(r.isReplaying.value).toBe(false);
    });
  });
});
