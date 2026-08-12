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
import useSyntheticsRecorder from "./useSyntheticsRecorder";
import type { WireStep } from "@/types/synthetics";

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

  describe("elementPicked", () => {
    it("keeps the selector the user picked in the extension", async () => {
      // Fires on "Pick locator" in the action picker, and on any click while the
      // recorder is in inspecting mode. Unlike setSources — which playwright-core
      // removed outright and which can never fire — this message is live, and
      // dropping it made inspect mode a dead end for the user.
      const r = useSyntheticsRecorder();
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
      const r = useSyntheticsRecorder();
      const promise = r.detectExtension();

      await settleProbeDelay();
      respondToLastCommand({ isRecording: false, mode: "recording", tabId: null, stepCount: 0 });

      expect(await promise).toBe(true);
      expect(r.isInstalled.value).toBe(true);
    });

    it("should reflect an in-progress recording reported by getStatus", async () => {
      const r = useSyntheticsRecorder();
      const promise = r.detectExtension();

      await settleProbeDelay();
      respondToLastCommand({ isRecording: true, mode: "recording", tabId: 3, stepCount: 2 });

      expect(await promise).toBe(true);
      expect(r.isInstalled.value).toBe(true);
      expect(r.isRecording.value).toBe(true);
    });

    it("should return false when the command times out (no extension reachable)", async () => {
      const r = useSyntheticsRecorder();
      const promise = r.detectExtension();

      // Let the probe delay pass, then let the command timeout fire.
      await settleProbeDelay();
      await vi.advanceTimersByTimeAsync(4000);

      expect(await promise).toBe(false);
      expect(r.isInstalled.value).toBe(false);
    });
  });

  // ── startRecording ─────────────────────────────────────────────────────

  describe("startRecording", () => {
    it("should send a startRecording command via the bridge and map setActions pushes", async () => {
      const r = useSyntheticsRecorder();
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
      const r = useSyntheticsRecorder();
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
      const r = useSyntheticsRecorder();
      const promise = r.startRecording("https://app.test");

      await settleProbeDelay();
      respondToLastCommand({ success: false, error: "boom" });

      await promise;
      expect(r.isRecording.value).toBe(false);
      expect(r.error.value).toBe("boom");
    });

    it("should set a fallback error when the start response has no error text", async () => {
      const r = useSyntheticsRecorder();
      const promise = r.startRecording("https://app.test");

      await settleProbeDelay();
      respondToLastCommand({ success: false });

      await promise;
      expect(r.isRecording.value).toBe(false);
      expect(r.error.value).toBe("Failed to start recording.");
    });
  });

  it("sends the configured test-id attribute when one is given", async () => {
    const r = useSyntheticsRecorder();
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
    const r = useSyntheticsRecorder();
    const promise = r.startRecording("https://app.test", "");

    await settleProbeDelay();
    respondToLastCommand({ success: true });
    await promise;

    expect(getLastCommand().testIdAttr).toBe("data-test");
  });

  // ── stopRecording ──────────────────────────────────────────────────────

  describe("stopRecording", () => {
    it("should return the live-accumulated steps via the bridge", async () => {
      const r = useSyntheticsRecorder();
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
      const r = useSyntheticsRecorder();
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
      const r = useSyntheticsRecorder();
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
      const r = useSyntheticsRecorder();
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
      const r = useSyntheticsRecorder();
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
      const r = useSyntheticsRecorder();
      const promise = r.replay(steps);

      await settleProbeDelay();
      respondToLastCommand({ success: true, passed: false, error: "Timeout on #go" });
      const res = await promise;

      expect(res).toMatchObject({ passed: false, error: "Timeout on #go" });
    });

    it("should not send a command when there are no steps", async () => {
      const r = useSyntheticsRecorder();
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
      const r = useSyntheticsRecorder();
      await startRunningReplay(r);

      const promise = r.stopReplay();
      respondToLastCommand({ success: true });
      await promise;

      expect(getLastCommand()).toMatchObject({ action: "stopReplay" });
    });

    it("should hold the stopping phase until the extension confirms", async () => {
      const r = useSyntheticsRecorder();
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
      const r = useSyntheticsRecorder();
      await startRunningReplay(r);
      emitStreamEvent({ method: "stepReplayStarted", stepId: "s1" });
      expect(r.activeStepId.value).toBe("s1");

      const promise = r.stopReplay();
      respondToLastCommand({ success: true });
      await promise;

      expect(r.activeStepId.value).toBeNull();
    });

    it("should reach stopped even when the extension never acknowledges the stop", async () => {
      const r = useSyntheticsRecorder();
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
      const r = useSyntheticsRecorder();
      await startRunningReplay(r);

      const promise = r.stopReplay();
      respondToLastCommand({ success: true });
      await promise;

      emitStreamEvent({ method: "stepReplayStarted", stepId: "s2" });
      expect(r.activeStepId.value).toBeNull();
    });

    it("should still record a step result that was already in flight when stopping", async () => {
      // That step genuinely ran, so it must keep counting toward "completed X of N".
      const r = useSyntheticsRecorder();
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
      const r = useSyntheticsRecorder();
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
      const r = useSyntheticsRecorder();
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

    it("should be a no-op when no replay is running", async () => {
      const r = useSyntheticsRecorder();
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
      const r = useSyntheticsRecorder();
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
      const r = useSyntheticsRecorder();
      const promise = r.replay(steps);

      await settleProbeDelay();
      await vi.advanceTimersByTimeAsync(REPLAY_TIMEOUT_MS);

      const res = await promise;
      expect(res).toBeNull();
      expect(r.isReplaying.value).toBe(false);
    });
  });
});
