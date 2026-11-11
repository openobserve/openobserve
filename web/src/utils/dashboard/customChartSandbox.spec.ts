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
import fs from "fs";
import { flushPromises } from "@vue/test-utils";
import {
  LOOP_GUARD_LIMIT_MS,
  SANDBOX_RUN_TIMEOUT_MS,
  __resetSandboxFont,
  buildSandboxDocument,
  createCustomChartSandbox,
  guardLoops,
  parseSandboxMessage,
  usesEchartsGl,
  type CustomChartAppearance,
  type CustomChartSandbox,
} from "./customChartSandbox";

type PortHandler = ((event: { data: unknown }) => void) | null;

// Synchronous stand-in for MessageChannel that, like the real one, queues until a handler is set.
class FakePort {
  other!: FakePort;
  closed = false;
  private queue: unknown[] = [];
  private handler: PortHandler = null;
  set onmessage(handler: PortHandler) {
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

const LIGHT: CustomChartAppearance = { dark: false, palette: ["#111"], fontFamily: "Geist" };
const DARK: CustomChartAppearance = {
  dark: true,
  palette: ["#abc", "#def"],
  fontFamily: "Geist",
};

const scriptsOf = (doc: string): string[] =>
  [...doc.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)].map((match) => match[1]);

// Each run waits one macrotask inside the frame, so drain several.
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

interface FakeChart {
  theme: string | undefined;
  handlers: Record<string, (params: unknown) => void>;
  setOption: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  dispatchAction: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
}

// Executes the frame's own runtime and chart scripts against fake globals, the way the iframe would.
const bootFrame = (code: string) => {
  const [runtime, user] = scriptsOf(
    buildSandboxDocument({ code, nonce: "n0", readyToken: "t0", dark: false }),
  );
  const charts: FakeChart[] = [];
  const echarts = {
    init: vi.fn((_el: unknown, theme: string | undefined) => {
      const chart: FakeChart = {
        theme,
        handlers: {},
        setOption: vi.fn(),
        clear: vi.fn(),
        dispose: vi.fn(),
        resize: vi.fn(),
        dispatchAction: vi.fn(),
        on: vi.fn((name: string, fn: (params: unknown) => void) => {
          chart.handlers[name] = fn;
        }),
        off: vi.fn((name: string) => {
          delete chart.handlers[name];
        }),
      };
      charts.push(chart);
      return chart;
    }),
  };
  const listeners: Record<string, ((event?: any) => void)[]> = {};
  const docListeners: Record<string, ((event?: any) => void)[]> = {};
  const rootListeners: Record<string, ((event?: any) => void)[]> = {};
  const parentWindow = {};
  const frameWindow: any = {
    echarts,
    addEventListener: (type: string, fn: (event?: any) => void) =>
      (listeners[type] ??= []).push(fn),
  };
  const el = { clientWidth: 800, clientHeight: 400 };
  const frameDocument = {
    getElementById: () => el,
    addEventListener: (type: string, fn: (event?: any) => void) =>
      (docListeners[type] ??= []).push(fn),
    documentElement: {
      style: {} as Record<string, string>,
      addEventListener: (type: string, fn: (event?: any) => void) =>
        (rootListeners[type] ??= []).push(fn),
    },
    fonts: { add: vi.fn() },
  };
  new Function("window", "document", "parent", "FontFace", runtime)(
    frameWindow,
    frameDocument,
    parentWindow,
    undefined,
  );
  // In the real frame the guard is a global; here the chart script gets it as a parameter.
  frameWindow.__o2UserChart = new Function("__o2Guardn0", `${user}\nreturn __o2UserChart;`)(
    frameWindow.__o2Guardn0,
  );

  const sent: any[] = [];
  const started: any[] = [];
  const executed: any[] = [];
  const port = {
    postMessage: (message: any) =>
      (message?.type === "started" ? started : message?.type === "executed" ? executed : sent).push(
        message,
      ),
    onmessage: null as any,
  };
  listeners.message[0]({ source: parentWindow, data: { type: "connect" }, ports: [port] });
  const send = (message: Record<string, unknown>) => port.onmessage({ data: message });
  const run = (runId: number, data: unknown = [], context: unknown = {}) =>
    send({ type: "run", runId, data: JSON.stringify(data), context: JSON.stringify(context) });

  return {
    send,
    run,
    sent,
    started,
    executed,
    charts,
    echarts,
    el,
    frameDocument,
    fire: (type: string, event?: unknown) => listeners[type]?.forEach((fn) => fn(event)),
    fireDocument: (type: string, event?: unknown) => docListeners[type]?.forEach((fn) => fn(event)),
    fireRoot: (type: string, event?: unknown) => rootListeners[type]?.forEach((fn) => fn(event)),
  };
};

describe("buildSandboxDocument", () => {
  const doc = buildSandboxDocument({
    code: "var option = {};",
    nonce: "abc123",
    readyToken: "tok",
    dark: true,
  });
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(doc)![1];

  it("locks the frame down to its own nonce-tagged scripts and no network", () => {
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-abc123';");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*'self'/);
  });

  it("allows only the inline styles ECharts tooltips need", () => {
    expect(csp).toContain("style-src 'unsafe-inline'");
  });

  it("tags every script with the nonce", () => {
    const tags = [...doc.matchAll(/<script[^>]*>/gi)].map((match) => match[0]);
    expect(tags.length).toBeGreaterThanOrEqual(4);
    for (const tag of tags) expect(tag).toContain('nonce="abc123"');
  });

  it("matches the frame's colour scheme to the app so its background stays transparent", () => {
    expect(doc).toContain("color-scheme: dark");
  });

  it("allows eval only in a frame that loads echarts-gl, which compiles its compositor with new Function", () => {
    const gl = buildSandboxDocument({
      code: 'var option = { series: [{ type: "bar3D" }] };',
      nonce: "n",
      readyToken: "t",
      dark: false,
    });
    const glCsp = /Content-Security-Policy" content="([^"]+)"/.exec(gl)![1];
    expect(glCsp).toContain("script-src 'nonce-n' 'unsafe-eval';");
    expect(fs.readFileSync(require.resolve("echarts-gl/dist/echarts-gl.min.js"), "utf8")).toContain(
      "new Function(",
    );
  });

  it("loads echarts-gl only for code that uses a 3D or GL type", () => {
    const plain = buildSandboxDocument({
      code: "var option = {};",
      nonce: "n",
      readyToken: "t",
      dark: false,
    });
    const gl = buildSandboxDocument({
      code: 'var option = { series: [{ type: "bar3D" }] };',
      nonce: "n",
      readyToken: "t",
      dark: false,
    });
    expect(plain).not.toContain("echarts-gl");
    expect(gl).toContain("echarts-gl");
  });

  it("keeps a closing script tag inside the chart code from ending the script", async () => {
    const frame = bootFrame('var option = { title: { text: "</script><b>x</b>" } };');
    frame.send({ type: "appearance", ...LIGHT });
    frame.run(1);
    await settle();
    expect(frame.charts[0].setOption.mock.calls[0][0].title.text).toBe("</script><b>x</b>");
  });
});

describe("usesEchartsGl", () => {
  it.each(["scatter3D", "bar3D", "grid3D", "geo3D", "scatterGL", "globe"])("detects %s", (type) => {
    expect(usesEchartsGl(`option = { series: [{ type: "${type}" }] }`)).toBe(true);
  });

  it("ignores ordinary chart types", () => {
    expect(usesEchartsGl('option = { series: [{ type: "line" }, { type: "graph" }] }')).toBe(false);
  });
});

describe("sandbox runtime", () => {
  it("runs the code, draws the chart and reports the run as rendered", async () => {
    const frame = bootFrame("var option = { series: [{ type: 'bar', data: data[0] }] };");
    frame.send({ type: "appearance", ...LIGHT });
    frame.run(1, [[1, 2, 3]]);
    await settle();

    expect(frame.echarts.init).toHaveBeenCalledTimes(1);
    expect(frame.charts[0].theme).toBeUndefined();
    const applied = frame.charts[0].setOption.mock.calls[0][0];
    expect(applied.series[0].data).toEqual([1, 2, 3]);
    expect(applied.textStyle).toEqual({ fontFamily: "Geist" });
    expect(applied.backgroundColor).toBeUndefined();
    expect(frame.sent).toEqual([{ type: "rendered", runId: 1 }]);
  });

  it("keeps formatters and o2_events working because they never leave the frame", async () => {
    const frame = bootFrame(`var option = {
      tooltip: { formatter: function (p) { return "<b>" + p.name + "</b>"; } },
      o2_events: { click: function (params) { o2.drilldown("cluster", { cluster: params.name }); } },
    };`);
    frame.send({ type: "appearance", ...LIGHT });
    frame.run(1);
    await settle();

    const applied = frame.charts[0].setOption.mock.calls[0][0];
    expect(applied.tooltip.formatter({ name: "a" })).toBe("<b>a</b>");
    frame.charts[0].handlers.click({ name: "prod-eu" });
    expect(frame.sent).toContainEqual({
      type: "drilldown",
      name: "cluster",
      detail: { cluster: "prod-eu" },
    });
  });

  it("confines tooltips to the frame unless the code chose otherwise", async () => {
    const frame = bootFrame("var option = { tooltip: [{ show: true }, { confine: false }] };");
    frame.send({ type: "appearance", ...LIGHT });
    frame.run(1);
    await settle();

    expect(frame.charts[0].setOption.mock.calls[0][0].tooltip).toEqual([
      { show: true, confine: true },
      { confine: false },
    ]);
  });

  it("adds no tooltip to a chart that has none", async () => {
    const frame = bootFrame("var option = {};");
    frame.send({ type: "appearance", ...LIGHT });
    frame.run(1);
    await settle();

    expect(frame.charts[0].setOption.mock.calls[0][0].tooltip).toBeUndefined();
  });

  it("announces each run before executing the code, so the parent times only the run", async () => {
    const frame = bootFrame("var option = {};");
    frame.send({ type: "appearance", ...LIGHT });
    frame.run(1);
    frame.run(2);
    await settle();

    expect(frame.started).toEqual([
      { type: "started", runId: 1 },
      { type: "started", runId: 2 },
    ]);
  });

  it("re-runs new data in the same chart instance", async () => {
    const frame = bootFrame("var option = { series: [{ data: data }] };");
    frame.send({ type: "appearance", ...LIGHT });
    frame.run(1, [1]);
    frame.run(2, [2]);
    await settle();

    expect(frame.echarts.init).toHaveBeenCalledTimes(1);
    expect(frame.charts[0].clear).toHaveBeenCalledTimes(1);
    expect(frame.charts[0].setOption.mock.calls[1][0].series[0].data).toEqual([2]);
    expect(frame.sent).toEqual([
      { type: "rendered", runId: 1 },
      { type: "rendered", runId: 2 },
    ]);
  });

  it("uses the dark theme with a transparent background and the panel palette in dark mode", async () => {
    const frame = bootFrame("var option = {};");
    frame.send({ type: "appearance", ...DARK });
    frame.run(1);
    await settle();

    expect(frame.charts[0].theme).toBe("dark");
    const applied = frame.charts[0].setOption.mock.calls[0][0];
    expect(applied.backgroundColor).toBe("transparent");
    expect(applied.color).toEqual(["#abc", "#def"]);
    expect(frame.frameDocument.documentElement.style.colorScheme).toBe("dark");
  });

  it("keeps a background and palette the code sets in dark mode", async () => {
    const frame = bootFrame('var option = { backgroundColor: "#000", color: ["red"] };');
    frame.send({ type: "appearance", ...DARK });
    frame.run(1);
    await settle();

    const applied = frame.charts[0].setOption.mock.calls[0][0];
    expect(applied.backgroundColor).toBe("#000");
    expect(applied.color).toEqual(["red"]);
  });

  it("re-creates the chart in the new theme without re-running the code", async () => {
    const frame = bootFrame("var option = { marker: {} };");
    frame.send({ type: "appearance", ...LIGHT });
    frame.run(1);
    await settle();
    frame.send({ type: "appearance", ...DARK });
    await settle();

    expect(frame.charts).toHaveLength(2);
    expect(frame.charts[0].dispose).toHaveBeenCalled();
    expect(frame.charts[1].theme).toBe("dark");
    const first = frame.charts[0].setOption.mock.calls[0][0];
    expect(frame.charts[1].setOption.mock.calls[0][0].marker).toBe(first.marker);
    expect(frame.sent).toEqual([{ type: "rendered", runId: 1 }]);
  });

  it("ends a runaway loop with the timeout error instead of hanging every frame in the process", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 100));
    const frame = bootFrame("var i = 0; while (i >= 0) { i++; } var option = {};");
    frame.run(1);
    await settle();
    vi.restoreAllMocks();

    expect(now).toBeGreaterThan(LOOP_GUARD_LIMIT_MS);
    expect(frame.sent).toHaveLength(1);
    expect(frame.sent[0]).toMatchObject({ type: "error", runId: 1 });
    expect(frame.sent[0].message).toContain("Script took too long to run");
    expect(frame.executed).toEqual([]);
  });

  it("reports when the chart code returned, before drawing", async () => {
    const frame = bootFrame("var option = {};");
    frame.send({ type: "appearance", ...LIGHT });
    frame.run(4);
    await settle();

    expect(frame.executed).toEqual([{ type: "executed", runId: 4 }]);
    expect(frame.sent).toEqual([{ type: "rendered", runId: 4 }]);
  });

  it("reports a thrown error with the execution error prefix", async () => {
    const frame = bootFrame('throw new Error("boom");');
    frame.run(7);
    await settle();

    expect(frame.sent).toHaveLength(1);
    expect(frame.sent[0]).toMatchObject({ type: "error", runId: 7 });
    expect(frame.sent[0].message).toMatch(/boom$/);
    expect(frame.echarts.init).not.toHaveBeenCalled();
  });

  it("reports a CSP violation during a run instead of rendering", async () => {
    const frame = bootFrame("var option = {}; triggerViolation();");
    // The violation fires while the chart code runs, as a blocked load inside it would.
    vi.stubGlobal("triggerViolation", () =>
      frame.fireDocument("securitypolicyviolation", {
        violatedDirective: "img-src",
        blockedURI: "https://evil.example",
      }),
    );
    frame.run(3);
    await settle();
    vi.unstubAllGlobals();

    expect(frame.sent).toHaveLength(1);
    expect(frame.sent[0]).toMatchObject({ type: "error", runId: 3 });
    expect(frame.sent[0].message).toContain("img-src blocked https://evil.example");
  });

  it("hands the code a deeply frozen context", async () => {
    const frame = bootFrame(
      "var option = { frozen: Object.isFrozen(context) && Object.isFrozen(context.variables) };",
    );
    frame.send({ type: "appearance", ...LIGHT });
    frame.run(1, [], { variables: { env: "prod" } });
    await settle();

    expect(frame.charts[0].setOption.mock.calls[0][0].frozen).toBe(true);
  });

  it("defers drawing in a zero-size frame until it gets a size", async () => {
    const frame = bootFrame("var option = {};");
    frame.el.clientWidth = 0;
    frame.send({ type: "appearance", ...LIGHT });
    frame.run(1);
    await settle();

    expect(frame.echarts.init).not.toHaveBeenCalled();
    expect(frame.sent).toEqual([{ type: "rendered", runId: 1 }]);

    frame.el.clientWidth = 600;
    frame.fire("resize");
    expect(frame.echarts.init).toHaveBeenCalledTimes(1);
  });

  it("resizes the chart when the frame resizes", async () => {
    const frame = bootFrame("var option = {};");
    frame.send({ type: "appearance", ...LIGHT });
    frame.run(1);
    await settle();
    frame.fire("resize");

    expect(frame.charts[0].resize).toHaveBeenCalled();
  });

  it("clears the chart when the panel has nothing to draw", async () => {
    const frame = bootFrame("var option = {};");
    frame.send({ type: "appearance", ...LIGHT });
    frame.run(1);
    await settle();
    frame.send({ type: "clear" });
    await settle();

    expect(frame.charts[0].clear).toHaveBeenCalled();
  });

  it("reports the pointer once per entry, re-armed by the parent's hideTip", async () => {
    const frame = bootFrame("var option = {};");
    frame.fireDocument("pointermove");
    frame.fireDocument("pointermove");
    frame.fireDocument("pointermove");
    expect(frame.sent.filter((message) => message.type === "pointer")).toHaveLength(1);

    frame.send({ type: "hideTip" });
    frame.fireDocument("pointermove");
    expect(frame.sent.filter((message) => message.type === "pointer")).toHaveLength(2);
  });

  it("hides the tooltip when the parent asks, as the panel's pointer leaves", async () => {
    const frame = bootFrame("var option = { tooltip: { trigger: 'item' } };");
    frame.send({ type: "hideTip" });
    frame.send({ type: "appearance", ...LIGHT });
    frame.run(1);
    await settle();
    frame.send({ type: "hideTip" });

    expect(frame.charts[0].dispatchAction).toHaveBeenCalledTimes(1);
    expect(frame.charts[0].dispatchAction).toHaveBeenCalledWith({ type: "hideTip" });
  });

  it("hides the tooltip when the pointer leaves the frame document", async () => {
    const frame = bootFrame("var option = { tooltip: { trigger: 'item' } };");
    frame.send({ type: "appearance", ...LIGHT });
    frame.run(1);
    await settle();
    frame.fireRoot("mouseleave");

    expect(frame.charts[0].dispatchAction).toHaveBeenCalledWith({ type: "hideTip" });
  });

  it("ignores a second connect, so only the first port ever talks to the frame", async () => {
    const frame = bootFrame("var option = {};");
    const intruder = { postMessage: vi.fn(), onmessage: null };
    frame.fire("message", { source: {}, data: { type: "connect" }, ports: [intruder] });

    expect(intruder.onmessage).toBeNull();
  });
});

describe("parseSandboxMessage", () => {
  it("accepts the known message types", () => {
    expect(parseSandboxMessage({ type: "pointer", x: 1 })).toEqual({ type: "pointer" });
    expect(parseSandboxMessage({ type: "rendered", runId: 1 })).toEqual({
      type: "rendered",
      runId: 1,
    });
    expect(parseSandboxMessage({ type: "error", runId: 2, message: "bad" })).toEqual({
      type: "error",
      runId: 2,
      message: "bad",
    });
    expect(
      parseSandboxMessage({ type: "drilldown", name: "cluster", detail: { cluster: "a", x: 1 } }),
    ).toEqual({ type: "drilldown", drilldown: { name: "cluster", detail: { cluster: "a" } } });
  });

  it.each([
    ["a non-object", "rendered"],
    ["an unknown type", { type: "navigate", url: "https://evil.example" }],
    ["a run id that is not a positive integer", { type: "rendered", runId: "1" }],
    ["an error without a string message", { type: "error", runId: 1, message: { html: "<b>" } }],
    ["a drilldown name off the allow-list", { type: "drilldown", name: "logout", detail: {} }],
    [
      "a drilldown with a non-string cluster",
      { type: "drilldown", name: "cluster", detail: { cluster: 1 } },
    ],
    [
      "a drilldown with an empty cluster",
      { type: "drilldown", name: "cluster", detail: { cluster: "" } },
    ],
    [
      "a drilldown with an oversized cluster",
      { type: "drilldown", name: "cluster", detail: { cluster: "x".repeat(513) } },
    ],
  ])("rejects %s", (_label, data) => {
    expect(parseSandboxMessage(data)).toBeNull();
  });

  it("caps a long error message", () => {
    const parsed = parseSandboxMessage({ type: "error", runId: 1, message: "x".repeat(5000) });
    expect(parsed?.type === "error" && parsed.message.length).toBe(2000);
  });
});

describe("createCustomChartSandbox", () => {
  let host: HTMLElement;
  // Destroyed after each test, so the shared pointer listener starts from no live sandbox.
  let made: CustomChartSandbox[] = [];
  const make = (...args: Parameters<typeof createCustomChartSandbox>) => {
    const sandbox = createCustomChartSandbox(...args);
    made.push(sandbox);
    return sandbox;
  };
  const run = (code = "var option = {};", data: unknown = [[1]]) => ({ code, data, panelId: "p1" });

  beforeEach(() => {
    vi.stubGlobal("MessageChannel", FakeMessageChannel);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }),
    );
    __resetSandboxFont();
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    made.forEach((sandbox) => sandbox.destroy());
    made = [];
    host.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const handlers = () => ({
    onError: vi.fn(),
    onDrilldown: vi.fn(),
    onRendered: vi.fn(),
    onPointer: vi.fn(),
  });

  // Plays the frame's ready handshake and returns everything the parent then sends over the port.
  const connect = async (iframe: HTMLIFrameElement, token?: string) => {
    const post = vi.spyOn(iframe.contentWindow!, "postMessage");
    const readyToken = token ?? /token: "([0-9a-f]{32})"/.exec(iframe.srcdoc)![1];
    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow,
        data: { type: "ready", token: readyToken },
      }),
    );
    await flushPromises();
    const received: any[] = [];
    const port = post.mock.calls[0]?.[2]?.[0] as unknown as FakePort | undefined;
    if (port) port.onmessage = (event) => received.push(event.data);
    return { post, port, received };
  };

  it("mounts one script-only sandboxed frame", () => {
    const sandbox = make(host, handlers(), "Custom Chart");
    sandbox.render(run(), LIGHT);

    const frames = host.querySelectorAll("iframe");
    expect(frames).toHaveLength(1);
    expect(frames[0].getAttribute("sandbox")).toBe("allow-scripts");
    expect(frames[0].title).toBe("Custom Chart");
  });

  it("hands over the port first and sends font, look and data only over it", async () => {
    const sandbox = make(host, handlers());
    sandbox.render(run("var option = {};", [[42]]), LIGHT);
    const { post, received } = await connect(host.querySelector("iframe")!);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toEqual({ type: "connect" });
    expect(received.map((message) => message.type)).toEqual(["init", "appearance", "run"]);
    expect(received[0].font.family).toBe("Geist");
    expect(received[0].font.data).toBeInstanceOf(ArrayBuffer);
    expect(received[2]).toMatchObject({ runId: 1, data: "[[42]]" });
  });

  it("re-runs the same code in the same frame, and rebuilds it only when the code changes", async () => {
    const sandbox = make(host, handlers());
    sandbox.render(run(), LIGHT);
    const first = host.querySelector("iframe")!;
    const { received } = await connect(first);

    sandbox.render(run("var option = {};", [[2]]), LIGHT);
    expect(host.querySelectorAll("iframe")).toHaveLength(1);
    expect(received.filter((message) => message.type === "run").map((m) => m.runId)).toEqual([
      1, 2,
    ]);

    sandbox.render(run("var option = { title: {} };"), LIGHT);
    const frames = host.querySelectorAll("iframe");
    expect(frames).toHaveLength(1);
    expect(frames[0]).not.toBe(first);
  });

  it("ignores a ready message from another window or with the wrong token", async () => {
    const sandbox = make(host, handlers());
    sandbox.render(run(), LIGHT);
    const iframe = host.querySelector("iframe")!;
    const post = vi.spyOn(iframe.contentWindow!, "postMessage");

    window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "ready" } }));
    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow,
        data: { type: "ready", token: "not-the-token" },
      }),
    );
    await flushPromises();

    expect(post).not.toHaveBeenCalled();
  });

  it("surfaces an error for the current run and ignores one from a superseded run", async () => {
    const h = handlers();
    const sandbox = make(host, h);
    sandbox.render(run(), LIGHT);
    const { port } = await connect(host.querySelector("iframe")!);
    sandbox.render(run("var option = {};", [[2]]), LIGHT);

    port!.postMessage({ type: "error", runId: 1, message: "stale" });
    expect(h.onError).not.toHaveBeenCalled();

    port!.postMessage({ type: "error", runId: 2, message: "Execution Error: boom" });
    expect(h.onError).toHaveBeenCalledWith("Execution Error: boom");
  });

  it("passes only a validated drilldown on", async () => {
    const h = handlers();
    const sandbox = make(host, h);
    sandbox.render(run(), LIGHT);
    const { port } = await connect(host.querySelector("iframe")!);

    port!.postMessage({ type: "drilldown", name: "navigate", detail: { url: "x" } });
    port!.postMessage({ type: "drilldown", name: "cluster", detail: { cluster: "prod" } });

    expect(h.onDrilldown).toHaveBeenCalledTimes(1);
    expect(h.onDrilldown).toHaveBeenCalledWith({ name: "cluster", detail: { cluster: "prod" } });
  });

  it("gives up on a hung frame with the timeout message and starts fresh next time", async () => {
    const h = handlers();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const sandbox = make(host, h);
    sandbox.render(run("while (1) {}"), LIGHT);
    const { port } = await connect(host.querySelector("iframe")!);
    port!.postMessage({ type: "started", runId: 1 });
    vi.advanceTimersByTime(SANDBOX_RUN_TIMEOUT_MS);

    expect(h.onError).toHaveBeenCalledWith("Execution Timeout: Script took too long to run");
    expect(host.querySelector("iframe")).toBeNull();

    sandbox.render(run(), LIGHT);
    expect(host.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("does not count a slow frame boot or a run still queued in the frame against the timeout", async () => {
    const h = handlers();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const sandbox = make(host, h);
    sandbox.render(run(), LIGHT);
    vi.advanceTimersByTime(SANDBOX_RUN_TIMEOUT_MS * 2);
    const { port } = await connect(host.querySelector("iframe")!);
    vi.advanceTimersByTime(SANDBOX_RUN_TIMEOUT_MS * 2);

    port!.postMessage({ type: "started", runId: 1 });
    vi.advanceTimersByTime(SANDBOX_RUN_TIMEOUT_MS - 1);
    port!.postMessage({ type: "rendered", runId: 1 });
    vi.advanceTimersByTime(SANDBOX_RUN_TIMEOUT_MS * 2);

    expect(h.onError).not.toHaveBeenCalled();
    expect(h.onRendered).toHaveBeenCalledTimes(1);
    expect(host.querySelector("iframe")).not.toBeNull();
  });

  it("still times out a hung run after a newer run was queued behind it", async () => {
    const h = handlers();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const sandbox = make(host, h);
    sandbox.render(run(), LIGHT);
    const { port } = await connect(host.querySelector("iframe")!);
    port!.postMessage({ type: "started", runId: 1 });
    sandbox.render(run("var option = {};", [[2]]), LIGHT);
    vi.advanceTimersByTime(SANDBOX_RUN_TIMEOUT_MS);

    expect(h.onError).toHaveBeenCalledWith("Execution Timeout: Script took too long to run");
    expect(host.querySelector("iframe")).toBeNull();
  });

  it("stops timing once the chart code returned, so a frame waiting behind a sibling never times out", async () => {
    const h = handlers();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const sandbox = make(host, h);
    sandbox.render(run(), LIGHT);
    const { port } = await connect(host.querySelector("iframe")!);
    port!.postMessage({ type: "started", runId: 1 });
    port!.postMessage({ type: "executed", runId: 1 });
    vi.advanceTimersByTime(SANDBOX_RUN_TIMEOUT_MS * 3);
    port!.postMessage({ type: "rendered", runId: 1 });

    expect(h.onError).not.toHaveBeenCalled();
    expect(h.onRendered).toHaveBeenCalledTimes(1);
    expect(host.querySelector("iframe")).not.toBeNull();
  });

  it("does not time out a run that rendered", async () => {
    const h = handlers();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const sandbox = make(host, h);
    sandbox.render(run(), LIGHT);
    const { port } = await connect(host.querySelector("iframe")!);
    port!.postMessage({ type: "started", runId: 1 });
    port!.postMessage({ type: "rendered", runId: 1 });
    vi.advanceTimersByTime(SANDBOX_RUN_TIMEOUT_MS * 2);

    expect(h.onRendered).toHaveBeenCalledTimes(1);
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("refuses unsafe code before building any frame", () => {
    const h = handlers();
    const sandbox = make(host, h);
    sandbox.render(run("fetch('https://evil.example');"), LIGHT);

    expect(h.onError).toHaveBeenCalledWith(
      "Unsafe code detected: Use of 'fetch()' is not allowed.",
    );
    expect(host.querySelector("iframe")).toBeNull();
  });

  it("sends the look again only when it changes", async () => {
    const sandbox = make(host, handlers());
    sandbox.render(run(), LIGHT);
    const { received } = await connect(host.querySelector("iframe")!);

    sandbox.setAppearance(LIGHT);
    sandbox.setAppearance(DARK);

    const looks = received.filter((message) => message.type === "appearance");
    expect(looks.map((message) => message.dark)).toEqual([false, true]);
  });

  it("asks a connected frame to hide its tooltip and never queues the request", async () => {
    const sandbox = make(host, handlers());
    sandbox.hideTooltip();
    sandbox.render(run(), LIGHT);
    sandbox.hideTooltip();
    const { received } = await connect(host.querySelector("iframe")!);
    sandbox.hideTooltip();

    expect(received.map((message) => message.type)).toEqual([
      "init",
      "appearance",
      "run",
      "hideTip",
    ]);
  });

  // Each sandbox in its own host, connected, with what the parent sends it collected.
  const connectedSandbox = async () => {
    const own = document.createElement("div");
    host.appendChild(own);
    const h = handlers();
    const sandbox = make(own, h);
    sandbox.render(run(), LIGHT);
    const { port, received } = await connect(own.querySelector("iframe")!);
    const hideTips = () => received.filter((message) => message.type === "hideTip").length;
    return { sandbox, h, port: port!, hideTips };
  };

  it("hides every other frame's tooltip when the pointer enters a frame", async () => {
    const a = await connectedSandbox();
    const b = await connectedSandbox();

    a.port.postMessage({ type: "pointer" });
    expect(a.h.onPointer).toHaveBeenCalledTimes(1);
    expect(b.hideTips()).toBe(0);

    b.port.postMessage({ type: "pointer" });
    expect(a.hideTips()).toBe(1);
    expect(b.hideTips()).toBe(0);
    expect(b.h.onPointer).toHaveBeenCalledTimes(1);
  });

  it("hides the last-entered frame's tooltip once when the pointer moves over the page", async () => {
    const a = await connectedSandbox();
    const b = await connectedSandbox();
    a.port.postMessage({ type: "pointer" });

    document.dispatchEvent(new Event("pointermove"));
    document.dispatchEvent(new Event("pointermove"));

    expect(a.hideTips()).toBe(1);
    expect(b.hideTips()).toBe(0);
  });

  it("listens for page pointer moves only while a sandbox is live", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const pointerCalls = (spy: typeof add) =>
      spy.mock.calls.filter(([type]) => type === "pointermove");
    const a = make(host, handlers());
    const b = make(host, handlers());
    expect(pointerCalls(add)).toHaveLength(1);
    expect(pointerCalls(add)[0][2]).toEqual({ passive: true });

    a.destroy();
    a.destroy();
    expect(pointerCalls(remove)).toHaveLength(0);
    b.destroy();
    expect(pointerCalls(remove)).toHaveLength(1);
    expect(pointerCalls(remove)[0][1]).toBe(pointerCalls(add)[0][1]);
  });

  it("removes the frame and stops listening on destroy", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const sandbox = make(host, handlers());
    sandbox.render(run(), LIGHT);
    sandbox.destroy();

    expect(host.querySelector("iframe")).toBeNull();
    expect(remove).toHaveBeenCalledWith("message", expect.any(Function));
  });
});

describe("guardLoops", () => {
  const evaluate = (code: string, guard?: (started?: number) => number | void) =>
    guard
      ? new Function("g", `${code}\nreturn out;`)(guard)
      : new Function(`${code}\nreturn out;`)();
  const noLimit = (started?: number) => (started === undefined ? 0 : undefined);

  it.each([
    [
      "labelled continue",
      "var out = []; outer: for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) { if (j === 1) continue outer; out.push(i + ':' + j); } }",
    ],
    [
      "loops without braces",
      "var out = 0; for (var i = 0; i < 3; i++) for (var j = 0; j < 2; j++) out += j;",
    ],
    [
      "a loop as the body of if/else",
      "var out = 0; if (true) while (out < 4) out++; else out = -1;",
    ],
    ["do-while", "var out = 0; do out++; while (out < 5)"],
    [
      "for-in and for-of",
      "var out = []; for (var k in { a: 1, b: 2 }) out.push(k); for (var v of [3, 4]) out.push(v);",
    ],
    ["back-to-back loops", "var out = 0;for(var i=0;i<2;i++){out++}while(out<5){out++}"],
    ["an empty loop body", "var out = 0; for (; out < 3; out++);"],
  ])("keeps %s working", (_name, code) => {
    expect(evaluate(guardLoops(code, "g"), noLimit)).toEqual(evaluate(code));
  });

  it("checks the guard in every loop", () => {
    const guarded = guardLoops(
      "var out = 0; while (out < 2) out++; for (;out < 4;) { out++; }",
      "g",
    );
    const guard = vi.fn(noLimit);
    evaluate(guarded, guard);

    expect(guard.mock.calls.filter((args) => args.length === 0)).toHaveLength(2);
    expect(guard.mock.calls.filter((args) => args[0] !== undefined)).toHaveLength(4);
  });

  it("leaves code it cannot parse unchanged", () => {
    expect(guardLoops("while (", "g")).toBe("while (");
  });
});

describe("bundled templates", () => {
  const templates = import.meta.glob<{ customChartExample: { code: string } }>(
    "@/components/dashboards/addPanel/customChartExamples/customChartTemplates/*.ts",
    { eager: true },
  );
  const GL_TEMPLATES = [
    "bar3dDataset",
    "bar3dPunchCard",
    "scatter3dScatterMatrix",
    "scatter3dDataset",
  ];
  const nameOf = (path: string) => path.split("/").pop()!.replace(/\.ts$/, "");
  const host = () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    return el;
  };

  beforeEach(() => {
    vi.stubGlobal("MessageChannel", FakeMessageChannel);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("covers every bundled template, the four 3D ones included", () => {
    const names = Object.keys(templates).map(nameOf);
    expect(names.length).toBeGreaterThanOrEqual(20);
    for (const name of GL_TEMPLATES) expect(names).toContain(name);
  });

  it.each(Object.keys(templates))("%s builds a frame without an error", (path) => {
    const key = nameOf(path);
    const template = templates[path].customChartExample;
    const el = host();
    const onError = vi.fn();
    createCustomChartSandbox(el, { onError, onDrilldown: vi.fn() }).render(
      { code: template.code, data: [[]] },
      LIGHT,
    );

    expect(onError).not.toHaveBeenCalled();
    const iframe = el.querySelector("iframe")!;
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(iframe.srcdoc)![1];
    const gl = GL_TEMPLATES.includes(key);
    expect(iframe.srcdoc.includes("echarts-gl"), "echarts-gl loaded").toBe(gl);
    expect(csp.includes("'unsafe-eval'"), "eval allowed for echarts-gl").toBe(gl);
    el.remove();
  });
});
