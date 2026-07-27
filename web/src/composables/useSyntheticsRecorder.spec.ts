// Copyright 2026 OpenObserve Inc.

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

      // Stream steps
      const browserSteps: WireStep[] = [
        { id: "s1", action: "click", selector: "#go", selector_type: "css" },
      ];
      emitStreamEvent({ method: "setActions", browserSteps });
      expect(r.liveSteps.value).toHaveLength(1);
      expect(r.liveSteps.value[0].selectorType).toBe("CSS");

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

    it("stopReplay should send a stopReplay command", async () => {
      const r = useSyntheticsRecorder();
      const promise = r.stopReplay();
      respondToLastCommand({ success: true });
      await promise;

      const sentCmd = getLastCommand();
      expect(sentCmd).toMatchObject({ action: "stopReplay" });
    });

    it("should return null when the command times out", async () => {
      const r = useSyntheticsRecorder();
      const promise = r.replay(steps);

      // Let probe delay + command timeout fire
      await settleProbeDelay();
      await vi.advanceTimersByTimeAsync(4000);

      const res = await promise;
      expect(res).toBeNull();
      expect(r.isReplaying.value).toBe(false);
    });
  });
});
