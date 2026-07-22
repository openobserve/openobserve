// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useSyntheticsRecorder from "./useSyntheticsRecorder";
import type { WireStep } from "@/types/synthetics";

type CommandHandler = (cb: (response: unknown) => void) => void;

interface FakePort {
  name: string;
  postMessage: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onMessage: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
  onDisconnect: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
  emit: (msg: unknown) => void;
}

function makePort(): FakePort {
  let listener: ((msg: unknown) => void) | null = null;
  return {
    name: "synthetics-recorder",
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener: vi.fn((fn: (msg: unknown) => void) => {
        listener = fn;
      }),
      removeListener: vi.fn(() => {
        listener = null;
      }),
    },
    onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
    emit: (msg: unknown) => listener?.(msg),
  };
}

function installChrome(handlers: Record<string, CommandHandler>, port: FakePort) {
  const runtime: any = {
    lastError: undefined,
    sendMessage: vi.fn((_id: string, message: any, cb: (r: unknown) => void) => {
      handlers[message.command.action]?.(cb);
    }),
    connect: vi.fn(() => port),
  };
  (globalThis as any).chrome = { runtime };
  return runtime;
}

describe("useSyntheticsRecorder", () => {
  let port: FakePort;

  beforeEach(() => {
    port = makePort();
  });

  afterEach(() => {
    delete (globalThis as any).chrome;
    vi.clearAllMocks();
  });

  describe("detectExtension", () => {
    it("should return true when the extension replies (no installed field)", async () => {
      // Real getStatus payload — reachability is the install signal, not a flag.
      installChrome(
        {
          getStatus: (cb) =>
            cb({ isRecording: false, mode: "recording", tabId: null, stepCount: 0 }),
        },
        port,
      );
      const r = useSyntheticsRecorder();
      expect(await r.detectExtension()).toBe(true);
      expect(r.isInstalled.value).toBe(true);
    });

    it("should reflect an in-progress recording reported by getStatus", async () => {
      installChrome(
        { getStatus: (cb) => cb({ isRecording: true, mode: "recording", tabId: 3, stepCount: 2 }) },
        port,
      );
      const r = useSyntheticsRecorder();
      expect(await r.detectExtension()).toBe(true);
      expect(r.isRecording.value).toBe(true);
    });

    it("should return false when chrome.runtime.lastError is set", async () => {
      const runtime = installChrome(
        {
          getStatus: (cb) => {
            runtime.lastError = { message: "nope" };
            cb(undefined);
          },
        },
        port,
      );
      const r = useSyntheticsRecorder();
      expect(await r.detectExtension()).toBe(false);
      expect(r.isInstalled.value).toBe(false);
    });

    it("should return false when chrome is unavailable", async () => {
      const r = useSyntheticsRecorder();
      expect(await r.detectExtension()).toBe(false);
      expect(r.error.value).toContain("not available");
    });
  });

  describe("startRecording", () => {
    it("should open the named port, start recording, and map setActions pushes", async () => {
      const runtime = installChrome({ startRecording: (cb) => cb({ success: true }) }, port);
      const r = useSyntheticsRecorder();
      await r.startRecording("https://app.test/login");

      expect(runtime.connect).toHaveBeenCalledWith(expect.any(String), {
        name: "synthetics-recorder",
      });
      expect(r.isRecording.value).toBe(true);
      expect(r.currentUrl.value).toBe("https://app.test/login");

      const browserSteps: WireStep[] = [
        { id: "s1", action: "click", selector: "#go", selector_type: "css" },
      ];
      port.emit({
        type: "synthetics-recorder",
        recordingId: "rec_1",
        payload: { method: "setActions", browserSteps },
      });
      expect(r.liveSteps.value).toHaveLength(1);
      expect(r.liveSteps.value[0].selectorType).toBe("CSS");

      port.emit({
        type: "synthetics-recorder",
        recordingId: "rec_1",
        payload: { method: "recordingStarted", tabId: 9, url: "https://app.test/next" },
      });
      expect(r.currentUrl.value).toBe("https://app.test/next");
    });

    it("should ignore command-ack messages on the port", async () => {
      installChrome({ startRecording: (cb) => cb({ success: true }) }, port);
      const r = useSyntheticsRecorder();
      await r.startRecording("https://app.test");
      port.emit({ type: "synthetics-response", response: { success: true } });
      expect(r.liveSteps.value).toHaveLength(0);
    });

    it("should surface an error and tear down when start fails", async () => {
      installChrome({ startRecording: (cb) => cb({ success: false, error: "boom" }) }, port);
      const r = useSyntheticsRecorder();
      await r.startRecording("https://app.test");
      expect(r.isRecording.value).toBe(false);
      expect(r.error.value).toBe("boom");
      expect(port.disconnect).toHaveBeenCalled();
    });
  });

  describe("stopRecording", () => {
    it("should return the live-accumulated steps and tear down the port", async () => {
      installChrome(
        {
          startRecording: (cb) => cb({ success: true }),
          stopRecording: (cb) => cb({ success: true }),
        },
        port,
      );
      const r = useSyntheticsRecorder();
      await r.startRecording("https://x.test");
      // Steps arrive live over the port, not in the stop response.
      port.emit({
        type: "synthetics-recorder",
        recordingId: "rec_1",
        payload: {
          method: "setActions",
          browserSteps: [{ id: "s1", action: "navigate", url: "https://x.test" }],
        },
      });

      const steps = await r.stopRecording();
      expect(steps).toHaveLength(1);
      expect(steps[0].action).toBe("navigate");
      expect(steps[0].value).toBe("https://x.test");
      expect(r.isRecording.value).toBe(false);
      expect(port.disconnect).toHaveBeenCalled();
    });
  });

  describe("cancelRecording", () => {
    it("should disconnect the port and clear state without returning steps", async () => {
      installChrome({ startRecording: (cb) => cb({ success: true }) }, port);
      const r = useSyntheticsRecorder();
      await r.startRecording("https://x.test");
      r.cancelRecording();
      expect(r.isRecording.value).toBe(false);
      expect(r.liveSteps.value).toHaveLength(0);
      expect(port.disconnect).toHaveBeenCalled();
    });
  });

  describe("replay", () => {
    const steps: WireStep[] = [{ id: "s1", action: "navigate", url: "https://x.test" }];

    it("should send a replay command, toggle isReplaying, and store the result", async () => {
      const runtime = installChrome({ replay: (cb) => cb({ success: true, passed: true }) }, port);
      const r = useSyntheticsRecorder();
      const res = await r.replay(steps, "https://x.test");

      expect(runtime.sendMessage).toHaveBeenCalledWith(
        expect.any(String),
        {
          type: "synthetics-command",
          command: { action: "replay", steps, targetUrl: "https://x.test" },
        },
        expect.any(Function),
      );
      expect(res).toEqual({ success: true, passed: true });
      expect(r.isReplaying.value).toBe(false);
      expect(r.replayResult.value).toEqual({ success: true, passed: true });
    });

    it("should pass auth, headers, cookies, and variables in the replay command", async () => {
      const runtime = installChrome({ replay: (cb) => cb({ success: true, passed: true }) }, port);
      const r = useSyntheticsRecorder();
      const vars = [{ name: "BASE_URL", value: "https://example.com" }];
      const auth = { type: "basic" as const, username: "admin", password: "secret" };
      const headers = [{ key: "X-Custom", value: "val" }];
      const cookies = [{ name: "session", value: "abc123", domain: "example.com" }];

      await r.replay(steps, "https://x.test", vars, auth, headers, cookies);

      expect(runtime.sendMessage).toHaveBeenCalledWith(
        expect.any(String),
        {
          type: "synthetics-command",
          command: {
            action: "replay",
            steps,
            targetUrl: "https://x.test",
            auth,
            headers,
            cookies,
          },
        },
        expect.any(Function),
      );
    });

    it("should substitute variables in wire steps before sending", async () => {
      const runtime = installChrome({ replay: (cb) => cb({ success: true, passed: true }) }, port);
      const r = useSyntheticsRecorder();
      const stepsWithVars: WireStep[] = [
        { id: "s1", action: "navigate", url: "https://{{ BASE_URL }}/login" },
        { id: "s2", action: "type", selector: "#email", value: "{{ EMAIL }}" },
      ];
      const vars = [
        { name: "BASE_URL", value: "example.com" },
        { name: "EMAIL", value: "test@test.com" },
      ];

      await r.replay(stepsWithVars, "https://example.com", vars);

      const sentCommand = runtime.sendMessage.mock.calls[0][1] as any;
      expect(sentCommand.command.steps[0].url).toBe("https://example.com/login");
      expect(sentCommand.command.steps[1].value).toBe("test@test.com");
    });

    it("should store a failed replay result with the step error", async () => {
      installChrome(
        { replay: (cb) => cb({ success: true, passed: false, error: "Timeout on #go" }) },
        port,
      );
      const r = useSyntheticsRecorder();
      const res = await r.replay(steps);
      expect(res).toMatchObject({ passed: false, error: "Timeout on #go" });
    });

    it("should not send a command when there are no steps", async () => {
      const runtime = installChrome({}, port);
      const r = useSyntheticsRecorder();
      const res = await r.replay([]);
      expect(res).toBeNull();
      expect(runtime.sendMessage).not.toHaveBeenCalled();
      expect(r.error.value).toContain("No replayable steps");
    });

    it("stopReplay should send a stopReplay command", async () => {
      const runtime = installChrome({ stopReplay: (cb) => cb({ success: true }) }, port);
      const r = useSyntheticsRecorder();
      await r.stopReplay();
      expect(runtime.sendMessage).toHaveBeenCalledWith(
        expect.any(String),
        { type: "synthetics-command", command: { action: "stopReplay" } },
        expect.any(Function),
      );
    });
  });
});
