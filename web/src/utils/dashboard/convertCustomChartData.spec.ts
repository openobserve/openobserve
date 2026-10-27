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

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  CustomChartSkippedError,
  runJavaScriptCode,
  panelRefreshEpoch,
  panelRefreshTargets,
  rehydrateFunctions,
  settlePanelRefresh,
  trustCustomChartCode,
} from "./convertCustomChartData";

type PortHandler = (event: { data: unknown }) => void;

// Synchronous stand-in for MessageChannel that, like the real one, queues until a handler is set.
class FakePort {
  other!: FakePort;
  closed = false;
  private queue: unknown[] = [];
  private handler: PortHandler | null = null;
  set onmessage(handler: PortHandler | null) {
    this.handler = handler;
    this.queue.splice(0).forEach((data) => handler?.({ data }));
  }
  get onmessage() {
    return this.handler;
  }
  postMessage(data: unknown) {
    if (this.closed || this.other.closed) return;
    if (this.other.handler) this.other.handler({ data });
    else this.other.queue.push(data);
  }
  close() {
    this.closed = true;
  }
}

class FakeMessageChannel {
  port1 = new FakePort();
  port2 = new FakePort();
  constructor() {
    this.port1.other = this.port2;
    this.port2.other = this.port1;
  }
}

vi.stubGlobal("MessageChannel", FakeMessageChannel);

const parentMessageHandler = () =>
  vi.mocked(window.addEventListener).mock.calls.find((call) => call[0] === "message")?.[1] as (
    event: any,
  ) => void;

const readyTokenOf = (iframe: { srcdoc: string }) =>
  /type: 'ready', token: '([0-9a-f]{32})'/.exec(iframe.srcdoc)![1];

// Plays the srcdoc's ready handshake and returns what the parent then sends to the frame.
const connectSandbox = (iframe: { srcdoc: string; contentWindow: any }) => {
  parentMessageHandler()({
    source: iframe.contentWindow,
    data: { type: "ready", token: readyTokenOf(iframe) },
  });
  const [message, target, ports] = iframe.contentWindow.postMessage.mock.calls[0];
  let payload: any;
  ports[0].onmessage = (event: { data: unknown }) => {
    payload = event.data;
  };
  return { message, target, port: ports[0] as FakePort, payload };
};

// Mock router
vi.mock("src/router", () => ({
  default: {},
}));

// Mock acorn modules
vi.mock("acorn", () => ({
  parse: vi.fn(),
}));

vi.mock("acorn-walk", () => ({
  simple: vi.fn(),
}));

describe("convertCustomChartData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    panelRefreshTargets.clear();

    // Mock DOM methods
    Object.defineProperty(document, "createElement", {
      value: vi.fn(() => ({
        style: {},
        setAttribute: vi.fn(),
        onload: null,
        srcdoc: "",
        contentWindow: {
          postMessage: vi.fn(),
        },
      })),
      writable: true,
    });

    Object.defineProperty(document.body, "appendChild", {
      value: vi.fn(),
      writable: true,
    });

    Object.defineProperty(document.body, "removeChild", {
      value: vi.fn(),
      writable: true,
    });

    Object.defineProperty(window, "addEventListener", {
      value: vi.fn(),
      writable: true,
    });

    Object.defineProperty(window, "removeEventListener", {
      value: vi.fn(),
      writable: true,
    });

    // Mock location.pathname
    delete window.location;
    window.location = { pathname: "/test" } as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Basic functionality", () => {
    it("rejects with CustomChartSkippedError when another panel is being refreshed", async () => {
      panelRefreshTargets.set("panel1", false);

      const panelSchema = {
        id: "panel2",
        customChartContent: "var option = {};",
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toBeInstanceOf(
        CustomChartSkippedError,
      );
      expect(document.body.appendChild).not.toHaveBeenCalled();
    });

    it("should reject with validation error for unsafe code", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");

      // Mock acorn to parse the code successfully
      vi.mocked(acorn.parse).mockReturnValue({
        type: "Program",
        body: [],
      } as any);

      // Mock walk to detect forbidden function
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        // Simulate finding a forbidden function call
        if (visitors.CallExpression) {
          visitors.CallExpression({
            type: "CallExpression",
            callee: {
              type: "Identifier",
              name: "eval",
            },
            arguments: [],
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "eval('malicious code');",
      };
      const searchQueryData = [];

      await expect(runJavaScriptCode(panelSchema, searchQueryData)).rejects.toThrow(
        "Unsafe code detected: Use of 'eval()' is not allowed.",
      );
    });
  });

  describe("Successful execution flow", () => {
    it("should create iframe and execute valid code successfully", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");

      // Mock acorn to parse valid code
      vi.mocked(acorn.parse).mockReturnValue({
        type: "Program",
        body: [],
      } as any);

      // Mock walk to not find any violations
      vi.mocked(walk.simple).mockImplementation(() => {
        // No violations found
      });

      const mockIframe = {
        style: { display: "" },
        setAttribute: vi.fn(),
        onload: null,
        srcdoc: "",
        contentWindow: {
          postMessage: vi.fn(),
        },
      };

      vi.mocked(document.createElement).mockReturnValue(mockIframe as any);

      const panelSchema = {
        id: "panel1",
        customChartContent: "var option = { title: { text: 'Test' } };",
      };
      const searchQueryData = [{ field: "value" }];

      const promise = runJavaScriptCode(panelSchema, searchQueryData);

      // Verify iframe creation and setup
      expect(document.createElement).toHaveBeenCalledWith("iframe");
      expect(mockIframe.style.display).toBe("none");
      expect(mockIframe.setAttribute).toHaveBeenCalledWith("sandbox", "allow-scripts");
      expect(document.body.appendChild).toHaveBeenCalledWith(mockIframe);

      // Verify script content is set
      expect(mockIframe.srcdoc).toContain('<meta http-equiv="Content-Security-Policy"');
      expect(mockIframe.srcdoc).toContain("script-src 'self' 'nonce-");
      expect(mockIframe.srcdoc).toContain("echarts.min.js");
      expect(mockIframe.srcdoc).toContain("purify.min.js");

      const { message, target, payload } = connectSandbox(mockIframe);

      // Only an empty connect message crosses with "*"; the payload goes over the port.
      expect(message).toEqual({ type: "connect" });
      expect(target).toBe("*");
      expect(payload).toEqual({
        type: "execute",
        code: panelSchema.customChartContent,
        data: JSON.stringify(searchQueryData),
        context: "{}",
        fnTag: expect.stringMatching(/^__o2_fn_[0-9a-f]{32}$/),
      });

      // Simulate successful response
      const mockEvent = {
        source: mockIframe.contentWindow,
        data: {
          type: "success",
          result: JSON.stringify({ title: { text: "Test" } }),
        },
      };

      // Get the message handler
      const addEventListenerCalls = vi.mocked(window.addEventListener).mock.calls;
      const messageHandler = addEventListenerCalls.find((call) => call[0] === "message")?.[1];

      if (messageHandler && typeof messageHandler === "function") {
        messageHandler(mockEvent as any);
      }

      const result = await promise;
      expect(result).toEqual({ title: { text: "Test" } });
    });

    it("should load echarts and dompurify from npm packages, not the deleted static assets", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");

      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation(() => {});

      const mockIframe = {
        style: { display: "" },
        setAttribute: vi.fn(),
        onload: null,
        srcdoc: "",
        contentWindow: { postMessage: vi.fn() },
      };

      vi.mocked(document.createElement).mockReturnValue(mockIframe as any);

      const panelSchema = {
        id: "panel1",
        customChartContent: "var option = {};",
      };

      runJavaScriptCode(panelSchema, []);

      // Verify the srcdoc loads scripts from the npm packages (Vite ?url imports),
      // not from the deleted static files under /src/assets/dashboard/.
      expect(mockIframe.srcdoc).toMatch(/<script src="[^"]*echarts/);
      expect(mockIframe.srcdoc).toMatch(/<script src="[^"]*purify/);
      expect(mockIframe.srcdoc).not.toContain("/src/assets/dashboard/");
    });

    it("should handle execution errors from iframe", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");

      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation(() => {});

      const mockIframe = {
        style: { display: "" },
        setAttribute: vi.fn(),
        onload: null,
        srcdoc: "",
        contentWindow: { postMessage: vi.fn() },
      };

      vi.mocked(document.createElement).mockReturnValue(mockIframe as any);

      const panelSchema = {
        id: "panel1",
        customChartContent: "throw new Error('test error');",
      };

      const promise = runJavaScriptCode(panelSchema, []);

      // Trigger onload
      if (mockIframe.onload) {
        mockIframe.onload();
      }

      // Simulate error response
      const mockEvent = {
        source: mockIframe.contentWindow,
        data: {
          type: "error",
          message: "Execution Error: test error",
        },
      };

      // Get and trigger message handler
      const addEventListenerCalls = vi.mocked(window.addEventListener).mock.calls;
      const messageHandler = addEventListenerCalls.find((call) => call[0] === "message")?.[1];

      if (messageHandler && typeof messageHandler === "function") {
        messageHandler(mockEvent as any);
      }

      await expect(promise).rejects.toThrow("Execution Error: test error");
    });

    it("should ignore messages from different sources", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");

      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation(() => {});

      const mockIframe = {
        style: { display: "" },
        setAttribute: vi.fn(),
        onload: null,
        srcdoc: "",
        contentWindow: { postMessage: vi.fn() },
      };

      vi.mocked(document.createElement).mockReturnValue(mockIframe as any);

      const panelSchema = {
        id: "panel1",
        customChartContent: "var option = {};",
      };

      const promise = runJavaScriptCode(panelSchema, []);
      connectSandbox(mockIframe);

      // Simulate message from different source
      const mockEvent = {
        source: { postMessage: vi.fn() }, // Different source
        data: {
          type: "success",
          result: JSON.stringify({ fake: "data" }),
        },
      };

      // Get and trigger message handler
      const addEventListenerCalls = vi.mocked(window.addEventListener).mock.calls;
      const messageHandler = addEventListenerCalls.find((call) => call[0] === "message")?.[1];

      if (messageHandler && typeof messageHandler === "function") {
        messageHandler(mockEvent as any);
      }

      // The promise should still be pending since the message was ignored
      // Let's trigger a real message after to complete the test
      const realEvent = {
        source: mockIframe.contentWindow,
        data: {
          type: "success",
          result: JSON.stringify({ real: "data" }),
        },
      };

      if (messageHandler && typeof messageHandler === "function") {
        messageHandler(realEvent as any);
      }

      const result = await promise;
      expect(result).toEqual({ real: "data" });
    });

    it("still resolves when another panel's refresh starts mid-run", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");

      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation(() => {});

      const mockIframe = {
        style: { display: "" },
        setAttribute: vi.fn(),
        onload: null,
        srcdoc: "",
        contentWindow: { postMessage: vi.fn() },
      };

      vi.mocked(document.createElement).mockReturnValue(mockIframe as any);

      const panelSchema = {
        id: "panel1",
        customChartContent: "var option = {};",
      };

      const promise = runJavaScriptCode(panelSchema, []);
      connectSandbox(mockIframe);

      panelRefreshTargets.set("panel2", false);

      // Simulate message from iframe
      const mockEvent = {
        source: mockIframe.contentWindow,
        data: {
          type: "success",
          result: JSON.stringify({ data: "test" }),
        },
      };

      // Get and trigger message handler
      const addEventListenerCalls = vi.mocked(window.addEventListener).mock.calls;
      const messageHandler = addEventListenerCalls.find((call) => call[0] === "message")?.[1];

      if (messageHandler && typeof messageHandler === "function") {
        messageHandler(mockEvent as any);
      }

      expect(window.removeEventListener).toHaveBeenCalledWith("message", messageHandler);
      await expect(promise).resolves.toEqual({ data: "test" });
    });

    it("runs a refreshed panel's code after its load settles while a later refresh is in flight", async () => {
      const acorn = await import("acorn");
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      const mockIframe = {
        style: { display: "" },
        setAttribute: vi.fn(),
        onload: null,
        srcdoc: "",
        contentWindow: { postMessage: vi.fn() },
      };
      vi.mocked(document.createElement).mockReturnValue(mockIframe as any);
      panelRefreshTargets.set("panel1", false);
      panelRefreshTargets.set("panel2", false);
      settlePanelRefresh("panel1");

      const promise = runJavaScriptCode(
        { id: "panel1", customChartContent: "var option = {};" },
        [],
      );
      connectSandbox(mockIframe);
      const messageHandler = vi
        .mocked(window.addEventListener)
        .mock.calls.find((call) => call[0] === "message")?.[1] as (event: any) => void;
      messageHandler({
        source: mockIframe.contentWindow,
        data: { type: "success", result: JSON.stringify({ data: "test" }) },
      });

      await expect(promise).resolves.toEqual({ data: "test" });
      await expect(
        runJavaScriptCode({ id: "panel3", customChartContent: "var option = {};" }, []),
      ).rejects.toBeInstanceOf(CustomChartSkippedError);
    });
  });

  describe("settlePanelRefresh", () => {
    it("ends the refresh only once every target has settled", () => {
      panelRefreshTargets.set("panel1", false);
      panelRefreshTargets.set("panel2", false);

      settlePanelRefresh("panel1");
      expect([...panelRefreshTargets]).toEqual([
        ["panel1", true],
        ["panel2", false],
      ]);

      settlePanelRefresh("panel2");
      expect(panelRefreshTargets.size).toBe(0);
    });

    it("ignores a panel that is not a target", () => {
      panelRefreshTargets.set("panel1", false);

      settlePanelRefresh("panel2");

      expect([...panelRefreshTargets]).toEqual([["panel1", false]]);
    });
  });

  describe("Function callbacks returned by the sandbox", () => {
    const advisoryPayload = "function(){globalThis.__o2AuditMarker = 'executed'}()";

    const runAndRespond = async (
      code: string,
      buildResult: (fnTag: string) => unknown,
    ): Promise<any> => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation(() => {});

      const mockIframe = {
        style: { display: "" },
        setAttribute: vi.fn(),
        onload: null as null | (() => void),
        srcdoc: "",
        contentWindow: { postMessage: vi.fn() },
      };
      vi.mocked(document.createElement).mockReturnValue(mockIframe as any);

      const promise = runJavaScriptCode({ id: "p", customChartContent: code }, []);
      const { fnTag } = connectSandbox(mockIframe).payload;

      const messageHandler = vi
        .mocked(window.addEventListener)
        .mock.calls.find((call) => call[0] === "message")?.[1] as (e: any) => void;
      messageHandler({
        source: mockIframe.contentWindow,
        data: { type: "success", result: JSON.stringify(buildResult(fnTag)) },
      });
      return promise;
    };

    afterEach(() => {
      delete (globalThis as any).__o2AuditMarker;
    });

    it("never compiles a function-looking string from stored dashboard code", async () => {
      const result = await runAndRespond("option = {}", () => ({ audit_probe: advisoryPayload }));

      expect((globalThis as any).__o2AuditMarker).toBeUndefined();
      expect(result.audit_probe).toBe(advisoryPayload);
    });

    it("drops real callbacks from stored dashboard code instead of rebuilding them in the app", async () => {
      const result = await runAndRespond("option = {}", (fnTag) => ({
        tooltip: { formatter: { [fnTag]: advisoryPayload } },
        o2_events: { click: { [fnTag]: "function(){}" } },
      }));

      expect((globalThis as any).__o2AuditMarker).toBeUndefined();
      expect(result.tooltip.formatter).toBeUndefined();
      expect(result.o2_events.click).toBeUndefined();
    });

    it("rebuilds tagged callbacks for trusted first-party code only, never a plain string", async () => {
      const code = trustCustomChartCode("option = { trusted: true }");
      const result = await runAndRespond(code, (fnTag) => ({
        tooltip: { formatter: { [fnTag]: "function (p) { return p.name; }" } },
        series: [{ name: advisoryPayload }],
        spoofed: { __o2_fn_00000000000000000000000000000000: advisoryPayload },
      }));

      expect(result.tooltip.formatter({ name: "a" })).toBe("a");
      expect(result.series[0].name).toBe(advisoryPayload);
      expect((globalThis as any).__o2AuditMarker).toBeUndefined();
    });

    it("only lets the parent page hand code to the sandbox", async () => {
      const mockIframe = {
        style: { display: "" },
        setAttribute: vi.fn(),
        onload: null,
        srcdoc: "",
        contentWindow: { postMessage: vi.fn() },
      };
      vi.mocked(document.createElement).mockReturnValue(mockIframe as any);
      const acorn = await import("acorn");
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);

      void runJavaScriptCode({ id: "p", customChartContent: "option = {}" }, []);

      expect(mockIframe.srcdoc).toContain("if (event.source !== parent || executed) return;");
    });
  });

  describe("Read-only context", () => {
    const context = {
      variables: { service: "api", regions: ["eu", "us"] },
      timeRange: { start: 1_000_000, end: 2_000_000 },
      timezone: "Asia/Kolkata",
      theme: "dark" as const,
    };

    const runSandbox = async (code: string, ctx?: typeof context) => {
      const acorn = await import("acorn");
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      const mockIframe = {
        style: { display: "" },
        setAttribute: vi.fn(),
        onload: null as null | (() => void),
        srcdoc: "",
        contentWindow: { postMessage: vi.fn() },
      };
      vi.mocked(document.createElement).mockReturnValue(mockIframe as any);
      void runJavaScriptCode({ id: "p", customChartContent: code }, [], ctx);

      const script = mockIframe.srcdoc.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1];
      const listeners: Record<string, (e: any) => void> = {};
      const fakeWindow = {
        addEventListener: (t: string, h: any) => (listeners[t] = h),
        echarts: {},
      };
      const fakeParent = { postMessage: vi.fn() };
      const fakeDocument = { addEventListener: vi.fn() };
      new Function("window", "parent", "document", "DOMPurify", script)(
        fakeWindow,
        fakeParent,
        fakeDocument,
        { sanitize: (v: string) => v },
      );
      const [ready] = fakeParent.postMessage.mock.calls[0];
      parentMessageHandler()({ source: mockIframe.contentWindow, data: ready });
      const [connect, , ports] = mockIframe.contentWindow.postMessage.mock.calls[0];
      const payload = (ports[0] as any).queue[0];
      listeners.message({ source: fakeParent, data: connect, ports });
      await new Promise((r) => setTimeout(r, 0));
      return {
        payload,
        posted: fakeParent.postMessage.mock.calls.slice(1).map((c) => c[0]),
      };
    };

    afterEach(() => {
      delete (globalThis as any).option;
    });

    it("posts the context to the sandbox as JSON", async () => {
      const { payload } = await runSandbox("option = {}", context);

      expect(JSON.parse(payload.context)).toEqual(context);
    });

    it("exposes a deeply frozen context to the chart code", async () => {
      const code = `
        try { context.theme = "light"; context.timeRange.start = 0; context.variables.regions.push("x"); } catch (e) {}
        option = {
          theme: context.theme,
          start: context.timeRange.start,
          regions: context.variables.regions,
          frozen: Object.isFrozen(context) && Object.isFrozen(context.variables.regions),
        };`;
      const { posted } = await runSandbox(code, context);

      expect(posted).toHaveLength(1);
      expect(posted[0].type).toBe("success");
      expect(JSON.parse(posted[0].result)).toEqual({
        theme: "dark",
        start: 1_000_000,
        regions: ["eu", "us"],
        frozen: true,
      });
    });

    it("gives chart code an empty context when none is passed", async () => {
      const { posted } = await runSandbox("option = { keys: Object.keys(context) };");

      expect(JSON.parse(posted[0].result)).toEqual({ keys: [] });
    });
  });

  describe("Sandbox handshake", () => {
    const startRun = async (customChartContent = "option = {}") => {
      const acorn = await import("acorn");
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      const mockIframe = {
        style: { display: "" },
        setAttribute: vi.fn(),
        onload: null as null | (() => void),
        srcdoc: "",
        contentWindow: { postMessage: vi.fn() },
      };
      vi.mocked(document.createElement).mockReturnValue(mockIframe as any);
      const promise = runJavaScriptCode({ id: "p", customChartContent }, [{ secret: 1 }], {
        variables: { env: "prod" },
        timeRange: { start: 1, end: 2 },
        timezone: "UTC",
        theme: "light",
      });
      return { mockIframe, promise };
    };

    it("hands the code over once, so a frame that navigated away never receives data or context", async () => {
      const { mockIframe } = await startRun();
      const first = connectSandbox(mockIframe);
      expect(first.payload.data).toBe(JSON.stringify([{ secret: 1 }]));

      // The navigated document sends the same ready message, token included, on every load.
      for (let i = 0; i < 3; i++) {
        parentMessageHandler()({
          source: mockIframe.contentWindow,
          data: { type: "ready", token: readyTokenOf(mockIframe) },
        });
      }

      expect(mockIframe.contentWindow.postMessage).toHaveBeenCalledTimes(1);
      expect(mockIframe.onload).toBeNull();
    });

    it("never posts the payload with a wildcard target", async () => {
      const { mockIframe } = await startRun();
      connectSandbox(mockIframe);

      for (const [message] of mockIframe.contentWindow.postMessage.mock.calls) {
        expect(JSON.stringify(message)).not.toContain("secret");
        expect(JSON.stringify(message)).not.toContain("prod");
      }
    });

    it("ignores a ready message without the run's token", async () => {
      const { mockIframe } = await startRun();
      parentMessageHandler()({
        source: mockIframe.contentWindow,
        data: { type: "ready", token: "0".repeat(32) },
      });

      expect(mockIframe.contentWindow.postMessage).not.toHaveBeenCalled();
    });

    it("ignores a result that arrives before the code was handed over", async () => {
      const { mockIframe, promise } = await startRun();
      const handler = parentMessageHandler();
      handler({
        source: mockIframe.contentWindow,
        data: { type: "success", result: JSON.stringify({ spoofed: true }) },
      });
      connectSandbox(mockIframe);
      handler({
        source: mockIframe.contentWindow,
        data: { type: "success", result: JSON.stringify({ real: true }) },
      });

      await expect(promise).resolves.toEqual({ real: true });
    });

    it("warns once per run when stored chart code returned callbacks that were dropped", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { mockIframe, promise } = await startRun();
      const { fnTag } = connectSandbox(mockIframe).payload;
      parentMessageHandler()({
        source: mockIframe.contentWindow,
        data: {
          type: "success",
          result: JSON.stringify({
            tooltip: { formatter: { [fnTag]: "function(){}" } },
            label: { formatter: { [fnTag]: "function(){}" } },
          }),
        },
      });
      await promise;

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("2");
    });

    it("counts every dropped callback and none for trusted code", () => {
      const tagged = { a: { tag: "function(){ return 1; }" }, b: [{ tag: "function(){}" }] };
      const dropped = { count: 0 };
      rehydrateFunctions(tagged, "tag", false, dropped);
      expect(dropped.count).toBe(2);

      const kept = { count: 0 };
      const result: any = rehydrateFunctions(tagged, "tag", true, kept);
      expect(kept.count).toBe(0);
      expect(result.a()).toBe(1);
    });
  });

  describe("Replaying skipped runs", () => {
    it("bumps the refresh epoch once every target has settled", () => {
      const before = panelRefreshEpoch.value;
      panelRefreshTargets.set("a", false);
      panelRefreshTargets.set("b", false);

      settlePanelRefresh("a");
      expect(panelRefreshEpoch.value).toBe(before);

      settlePanelRefresh("b");
      expect(panelRefreshEpoch.value).toBe(before + 1);
    });
  });

  describe("Validation function tests", () => {
    it("should reject code with forbidden functions", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");

      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.CallExpression) {
          visitors.CallExpression({
            type: "CallExpression",
            callee: { type: "Identifier", name: "fetch" },
            arguments: [],
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "fetch('http://evil.com');",
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Use of 'fetch()' is not allowed.",
      );
    });

    it("should reject setTimeout with delay less than 100ms", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");

      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.CallExpression) {
          visitors.CallExpression({
            type: "CallExpression",
            callee: { type: "Identifier", name: "setTimeout" },
            arguments: [{ type: "FunctionExpression" }, { type: "Literal", value: 50 }],
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "setTimeout(function(){}, 50);",
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Use of 'setTimeout()' with delay < 100ms is not allowed.",
      );
    });

    it("should reject setTimeout with invalid usage", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");

      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.CallExpression) {
          visitors.CallExpression({
            type: "CallExpression",
            callee: { type: "Identifier", name: "setTimeout" },
            arguments: [
              { type: "FunctionExpression" },
              { type: "Identifier", name: "variable" }, // Not a literal
            ],
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "setTimeout(function(){}, variable);",
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Invalid usage of 'setTimeout()'.",
      );
    });

    it("should reject setTimeout with eval inside", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");

      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.CallExpression) {
          visitors.CallExpression({
            type: "CallExpression",
            callee: { type: "Identifier", name: "setTimeout" },
            arguments: [
              {
                type: "CallExpression",
                callee: { type: "Identifier", name: "eval" },
              },
              { type: "Literal", value: 1000 },
            ],
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "setTimeout(eval('code'), 1000);",
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Use of eval inside 'setTimeout()' is not allowed.",
      );
    });

    it("should reject obfuscated function calls", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");

      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.CallExpression) {
          visitors.CallExpression({
            type: "CallExpression",
            callee: {
              type: "MemberExpression",
              property: { type: "Identifier", name: "join" },
            },
            arguments: [{ type: "Literal", value: "" }],
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "['f','e','t','c','h'].join('');",
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Obfuscated function call detected.",
      );
    });

    it("should reject access to forbidden objects", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");

      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.MemberExpression) {
          visitors.MemberExpression({
            type: "MemberExpression",
            object: { type: "Identifier", name: "window" },
            property: { type: "Identifier", name: "location" },
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "window.location.href;",
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Access to 'window' is not allowed.",
      );
    });

    it("should reject infinite while loops", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");

      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.WhileStatement) {
          visitors.WhileStatement({
            type: "WhileStatement",
            test: { type: "Literal", value: true },
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "while(true) { console.log('infinite'); }",
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Infinite loop using 'while(true)' is not allowed.",
      );
    });

    it("should reject infinite for loops", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");

      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.ForStatement) {
          visitors.ForStatement({
            type: "ForStatement",
            init: null,
            test: null, // No test condition = infinite loop
            update: null,
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "for(;;) { console.log('infinite'); }",
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Infinite loop using 'for(;;)' is not allowed.",
      );
    });

    it("should reject new Function constructor", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");

      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.NewExpression) {
          visitors.NewExpression({
            type: "NewExpression",
            callee: { type: "Identifier", name: "Function" },
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "new Function('return 1');",
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Use of 'new Function()' is not allowed.",
      );
    });

    it("should reject invalid syntax", async () => {
      const acorn = await import("acorn");

      vi.mocked(acorn.parse).mockImplementation(() => {
        throw new Error("Invalid syntax");
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "invalid javascript syntax {",
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Invalid JavaScript syntax.",
      );
    });

    it("should reject obfuscated method/property access", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");

      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.MemberExpression) {
          visitors.MemberExpression({
            type: "MemberExpression",
            object: { type: "ThisExpression" },
            property: {
              type: "CallExpression",
              callee: {
                type: "MemberExpression",
                property: { type: "Identifier", name: "join" },
              },
            },
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "this[['e','v','a','l'].join('')]('code');",
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Obfuscated method/property access detected.",
      );
    });
  });
});
