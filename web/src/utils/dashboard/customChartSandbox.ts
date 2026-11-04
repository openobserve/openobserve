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

import { gt } from "@/types/i18n";
import echartsUrl from "echarts/dist/echarts.min.js?url";
import echartsGlUrl from "echarts-gl/dist/echarts-gl.min.js?url";
import geistFontUrl from "@/styles/fonts/Geist-Variable.woff2?url";
import { validateUserCode, type CustomChartContext } from "./convertCustomChartData";

// import.meta.url is this chunk's URL, so relative ?url paths resolve to the correct assets directory.
const sandboxEchartsUrl = new URL(echartsUrl, import.meta.url).href;
const sandboxEchartsGlUrl = new URL(echartsGlUrl, import.meta.url).href;
const sandboxFontUrl = new URL(geistFontUrl, import.meta.url).href;

// Counted from the frame's "started", so boot and queueing behind other frames never count; a loop stops the frame's own timers.
export const SANDBOX_RUN_TIMEOUT_MS = 10000;

const MAX_ERROR_LENGTH = 2000;
const MAX_DRILLDOWN_VALUE_LENGTH = 512;

const GL_CHART_PATTERN = /[A-Za-z]+(?:3D|GL)\b|\bglobe\b/;

/** One run of a panel's chart code: the frame is rebuilt only when `code` changes. */
export interface CustomChartRun {
  code: string;
  data: unknown;
  context?: CustomChartContext;
  panelId?: string | number;
}

/** App look the frame cannot read itself: it has none of the app's stylesheets or fonts. */
export interface CustomChartAppearance {
  dark: boolean;
  palette: string[];
  fontFamily: string;
}

/** Drilldowns chart code may request with `o2.drilldown(name, detail)`; anything else is dropped. */
export const CUSTOM_CHART_DRILLDOWN_EVENTS = {
  cluster: "o2-curated-cluster-drilldown",
} as const;

export type CustomChartDrilldownName = keyof typeof CUSTOM_CHART_DRILLDOWN_EVENTS;

export interface CustomChartDrilldown {
  name: CustomChartDrilldownName;
  detail: { cluster: string };
}

export type SandboxMessage =
  | { type: "started"; runId: number }
  | { type: "rendered"; runId: number }
  | { type: "error"; runId: number; message: string }
  | { type: "drilldown"; drilldown: CustomChartDrilldown };

export interface CustomChartSandboxHandlers {
  onError: (message: string) => void;
  onDrilldown: (drilldown: CustomChartDrilldown) => void;
  onRendered?: () => void;
}

export interface CustomChartSandbox {
  render: (run: CustomChartRun, appearance: CustomChartAppearance) => void;
  setAppearance: (appearance: CustomChartAppearance) => void;
  clear: () => void;
  destroy: () => void;
}

interface SandboxFont {
  family: string;
  data: ArrayBuffer;
}

interface Frame {
  iframe: HTMLIFrameElement;
  code: string;
  readyToken: string;
  channel: MessageChannel;
  connected: boolean;
  queue: Record<string, unknown>[];
  onWindowMessage: (event: MessageEvent) => void;
}

let sandboxFontPromise: Promise<SandboxFont | null> | null = null;

/** True when the chart code names an echarts-gl series or coordinate system. */
export const usesEchartsGl = (code: string): boolean => GL_CHART_PATTERN.test(code);

/** Builds the frame document: the CSP, ECharts, the runtime, the chart code and the ready signal. */
export const buildSandboxDocument = (options: {
  code: string;
  nonce: string;
  readyToken: string;
  dark: boolean;
}): string => {
  const { code, nonce, readyToken, dark } = options;
  const messages = toScriptJson({
    cspViolationPrefix: gt("dashboard.utils.cspViolationPrefix"),
    executionErrorPrefix: gt("dashboard.utils.executionErrorPrefix"),
    cspViolationBlocked: gt("dashboard.utils.cspViolationBlocked"),
    renderError: gt("dashboard.customChartRenderer.errorExecutingCode"),
  });
  const gl = usesEchartsGl(code);
  const glScript = gl ? `<script src="${sandboxEchartsGlUrl}" nonce="${nonce}"></script>` : "";
  // echarts-gl (claygl) compiles its compositor size expressions with new Function, which throws without 'unsafe-eval'.
  const scriptSrc = gl ? `'nonce-${nonce}' 'unsafe-eval'` : `'nonce-${nonce}'`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${scriptSrc}; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
<style>:root { color-scheme: ${dark ? "dark" : "light"}; } html, body, #chart { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }</style>
</head>
<body>
<div id="chart"></div>
<script src="${sandboxEchartsUrl}" nonce="${nonce}"></script>
${glScript}
<script nonce="${nonce}">${sandboxRuntime(messages)}</script>
<script nonce="${nonce}">${userChartScript(code)}</script>
<script nonce="${nonce}">parent.postMessage({ type: "ready", token: "${readyToken}" }, "*");</script>
</body>
</html>`;
};

/** Accepts only well-formed messages of a known type; returns null for anything else. */
export const parseSandboxMessage = (data: unknown): SandboxMessage | null => {
  if (!isRecord(data)) return null;
  if ((data.type === "started" || data.type === "rendered") && isRunId(data.runId)) {
    return { type: data.type, runId: data.runId };
  }
  if (data.type === "error" && isRunId(data.runId) && typeof data.message === "string") {
    return { type: "error", runId: data.runId, message: data.message.slice(0, MAX_ERROR_LENGTH) };
  }
  if (data.type === "drilldown") {
    const drilldown = parseDrilldown(data.name, data.detail);
    return drilldown ? { type: "drilldown", drilldown } : null;
  }
  return null;
};

/** Mounts a sandboxed chart frame in `host` and keeps it for every run of the same code. */
export const createCustomChartSandbox = (
  host: HTMLElement,
  handlers: CustomChartSandboxHandlers,
  title = "",
): CustomChartSandbox => {
  let frame: Frame | null = null;
  let appearanceKey = "";
  let runSeq = 0;
  let activeRunId: number | null = null;
  let watchedRunId: number | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const stopWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = null;
    watchedRunId = null;
  };

  const destroyFrame = () => {
    stopWatchdog();
    activeRunId = null;
    if (!frame) return;
    window.removeEventListener("message", frame.onWindowMessage);
    frame.channel.port1.close();
    frame.iframe.remove();
    frame = null;
  };

  // Any run still unfinished at the deadline has hung the frame, superseded or not, since runs execute in order.
  const armWatchdog = (runId: number) => {
    stopWatchdog();
    watchedRunId = runId;
    watchdog = setTimeout(() => {
      destroyFrame();
      handlers.onError(gt("dashboard.utils.executionTimeout"));
    }, SANDBOX_RUN_TIMEOUT_MS);
  };

  const send = (target: Frame, message: Record<string, unknown>) => {
    if (!target.connected) {
      // Only the latest run and look matter once the frame is up.
      target.queue = target.queue.filter((queued) => queued.type !== message.type);
      target.queue.push(message);
      return;
    }
    target.channel.port1.postMessage(message);
  };

  const onPortMessage = (event: MessageEvent) => {
    const message = parseSandboxMessage(event.data);
    if (!message) return;
    if (message.type === "drilldown") {
      handlers.onDrilldown(message.drilldown);
      return;
    }
    if (message.type === "started") {
      armWatchdog(message.runId);
      return;
    }
    if (message.runId === watchedRunId) stopWatchdog();
    if (message.runId !== activeRunId) return;
    activeRunId = null;
    if (message.type === "error") handlers.onError(message.message);
    else handlers.onRendered?.();
  };

  const connect = async (target: Frame) => {
    target.iframe.contentWindow?.postMessage({ type: "connect" }, "*", [target.channel.port2]);
    const font = await loadSandboxFont();
    if (frame !== target) return;
    target.channel.port1.postMessage({ type: "init", font });
    target.connected = true;
    target.queue.splice(0).forEach((message) => send(target, message));
  };

  const createFrame = (code: string, dark: boolean): Frame => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.className = "block h-full w-full border-0";
    if (title) iframe.title = title;
    const target: Frame = {
      iframe,
      code,
      readyToken: randomHex(),
      channel: new MessageChannel(),
      connected: false,
      queue: [],
      onWindowMessage: () => {},
    };
    target.onWindowMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow || frame !== target) return;
      if (event.data?.type !== "ready" || event.data.token !== target.readyToken) return;
      // A later "ready" can only come from chart code that read the token out of the frame.
      window.removeEventListener("message", target.onWindowMessage);
      void connect(target);
    };
    target.channel.port1.onmessage = onPortMessage;
    window.addEventListener("message", target.onWindowMessage);
    iframe.srcdoc = buildSandboxDocument({
      code,
      nonce: randomHex(),
      readyToken: target.readyToken,
      dark,
    });
    host.appendChild(iframe);
    return target;
  };

  const postAppearance = (target: Frame, next: CustomChartAppearance) => {
    const key = JSON.stringify(next);
    if (key === appearanceKey) return;
    appearanceKey = key;
    send(target, { type: "appearance", ...next, palette: [...next.palette] });
  };

  return {
    render(run, nextAppearance) {
      const validationError = validateUserCode(run.code ?? "");
      if (validationError) {
        handlers.onError(gt("dashboard.utils.unsafeCodeDetected", { error: validationError }));
        return;
      }
      if (!frame || frame.code !== run.code) {
        destroyFrame();
        appearanceKey = "";
        frame = createFrame(run.code, nextAppearance.dark);
      }
      postAppearance(frame, nextAppearance);
      const runId = ++runSeq;
      activeRunId = runId;
      send(frame, {
        type: "run",
        runId,
        data: JSON.stringify(run.data ?? null),
        context: JSON.stringify(run.context ?? {}),
      });
    },
    setAppearance(nextAppearance) {
      if (frame) postAppearance(frame, nextAppearance);
    },
    clear() {
      activeRunId = null;
      if (frame) send(frame, { type: "clear" });
    },
    destroy() {
      destroyFrame();
    },
  };
};

/** Test-only: forget the fetched font so the next frame fetches it again. */
export const __resetSandboxFont = (): void => {
  sandboxFontPromise = null;
};

// ECharts paints text on a canvas, so the frame needs the app's font bytes, not just its family name.
const loadSandboxFont = (): Promise<SandboxFont | null> => {
  if (!sandboxFontPromise) {
    sandboxFontPromise =
      typeof fetch === "function"
        ? fetch(sandboxFontUrl)
            .then((response) => (response.ok ? response.arrayBuffer() : null))
            .then((data) => (data ? { family: "Geist", data } : null))
            .catch(() => null)
        : Promise.resolve(null);
  }
  return sandboxFontPromise;
};

const parseDrilldown = (name: unknown, detail: unknown): CustomChartDrilldown | null => {
  if (name !== "cluster" || !isRecord(detail)) return null;
  const cluster = detail.cluster;
  if (typeof cluster !== "string" || !cluster || cluster.length > MAX_DRILLDOWN_VALUE_LENGTH) {
    return null;
  }
  return { name, detail: { cluster } };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRunId = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

// JSON is valid JS, but a "</script" inside it would end the inline script early.
const toScriptJson = (value: unknown): string => JSON.stringify(value).replace(/</g, "\\u003c");

// Inside a script element only "</script" and "<!--" change how the HTML parser reads the text.
const escapeInlineScript = (code: string): string =>
  code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

// A block, so `let option` stays scoped to it while `var option` and a bare assignment are returned.
const userChartScript = (
  code: string,
): string => `function __o2UserChart(data, echarts, context, o2) {
  {
${escapeInlineScript(code)}
  }
  return option;
}`;

// Runs inside the frame; it reads globals only, since it is shipped as text.
const sandboxRuntime = (messagesJson: string): string => `(function () {
  var messages = ${messagesJson};
  var port = null;
  var chart = null;
  var chartDark = null;
  var appearance = { dark: false, palette: [], fontFamily: "" };
  var lastOption = null;
  var deferred = false;
  var activeRun = null;
  var cspViolation = false;
  var loadError = "";
  var fontReady = Promise.resolve();
  var queue = Promise.resolve();

  var post = function (message) {
    if (port) port.postMessage(message);
  };
  var finish = function (runId, error) {
    if (activeRun !== runId) return;
    activeRun = null;
    post(error === undefined ? { type: "rendered", runId: runId } : { type: "error", runId: runId, message: String(error) });
  };
  var deepFreeze = function (value) {
    if (typeof value === "object" && value !== null) {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  };
  var o2 = Object.freeze({
    drilldown: function (name, detail) {
      var safe;
      try {
        safe = JSON.parse(JSON.stringify(detail === undefined ? null : detail));
      } catch (err) {
        return;
      }
      post({ type: "drilldown", name: String(name), detail: safe });
    },
  });
  var confine = function (tooltip) {
    if (!tooltip || typeof tooltip !== "object" || tooltip.confine !== undefined) return tooltip;
    return Object.assign({}, tooltip, { confine: true });
  };
  var themed = function (option) {
    var out = Object.assign({}, option);
    var unset = function (key) {
      return out[key] === null || out[key] === undefined;
    };
    if (appearance.dark) {
      if (unset("backgroundColor")) out.backgroundColor = "transparent";
      if (unset("color") && appearance.palette.length) out.color = appearance.palette.slice();
    }
    if (appearance.fontFamily) {
      out.textStyle = Object.assign({ fontFamily: appearance.fontFamily }, option.textStyle || {});
    }
    if (out.tooltip) out.tooltip = Array.isArray(out.tooltip) ? out.tooltip.map(confine) : confine(out.tooltip);
    return out;
  };
  var bindEvents = function (events) {
    if (!events || typeof events !== "object") return;
    var bound = chart;
    Object.keys(events).forEach(function (name) {
      var handler = events[name];
      if (typeof handler !== "function") return;
      bound.off(name);
      bound.on(name, function (params) {
        handler(params, bound);
      });
    });
  };
  var draw = function () {
    var el = document.getElementById("chart");
    if (!lastOption || !el) return true;
    if (!el.clientWidth || !el.clientHeight) {
      deferred = true;
      return true;
    }
    deferred = false;
    try {
      if (chart && chartDark !== appearance.dark) {
        chart.dispose();
        chart = null;
      }
      if (!chart) {
        chart = window.echarts.init(el, appearance.dark ? "dark" : undefined, { renderer: "canvas" });
        chartDark = appearance.dark;
      } else {
        chart.clear();
      }
      chart.setOption(themed(lastOption));
      bindEvents(lastOption.o2_events);
      return true;
    } catch (err) {
      return false;
    }
  };
  var run = function (message) {
    var runId = message.runId;
    var option;
    activeRun = runId;
    cspViolation = false;
    post({ type: "started", runId: runId });
    try {
      if (typeof window.__o2UserChart !== "function") throw new Error(loadError);
      var data = JSON.parse(message.data);
      var context = deepFreeze(JSON.parse(message.context || "{}"));
      option = window.__o2UserChart(data, window.echarts, context, o2);
    } catch (err) {
      finish(runId, messages.executionErrorPrefix + (err && err.message !== undefined ? err.message : String(err)));
      return;
    }
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    }).then(function () {
      if (activeRun !== runId) return;
      if (cspViolation) {
        finish(runId, messages.cspViolationBlocked);
        return;
      }
      lastOption = option && typeof option === "object" ? option : {};
      if (!draw()) {
        finish(runId, messages.renderError);
        return;
      }
      finish(runId);
    });
  };
  var enqueue = function (task) {
    queue = queue
      .then(function () {
        return fontReady;
      })
      .then(task)
      .catch(function () {});
  };
  var loadFont = function (font) {
    if (!font || !font.data || typeof FontFace !== "function") return;
    try {
      var face = new FontFace(String(font.family), font.data, { weight: "100 900" });
      document.fonts.add(face);
      fontReady = face.load().catch(function () {});
    } catch (err) {}
  };
  var handle = function (message) {
    if (!message || typeof message !== "object") return;
    if (message.type === "init") {
      loadFont(message.font);
    } else if (message.type === "appearance") {
      appearance = {
        dark: message.dark === true,
        palette: Array.isArray(message.palette) ? message.palette.map(String) : [],
        fontFamily: typeof message.fontFamily === "string" ? message.fontFamily : "",
      };
      document.documentElement.style.colorScheme = appearance.dark ? "dark" : "light";
      enqueue(function () {
        if (lastOption) draw();
      });
    } else if (message.type === "run") {
      enqueue(function () {
        return run(message);
      });
    } else if (message.type === "clear") {
      enqueue(function () {
        lastOption = null;
        if (chart) chart.clear();
      });
    }
  };

  window.onerror = function (message) {
    if (activeRun !== null) finish(activeRun, message);
    else if (!port) loadError = String(message);
  };
  document.addEventListener("securitypolicyviolation", function (event) {
    cspViolation = true;
    if (activeRun !== null) {
      finish(activeRun, messages.cspViolationPrefix + event.violatedDirective + " blocked " + event.blockedURI);
    }
  });
  window.addEventListener("resize", function () {
    if (deferred) draw();
    else if (chart) chart.resize();
  });
  window.addEventListener("message", function (event) {
    if (event.source !== parent || port) return;
    var data = event.data;
    if (!data || data.type !== "connect" || !event.ports || !event.ports[0]) return;
    port = event.ports[0];
    port.onmessage = function (portEvent) {
      handle(portEvent.data);
    };
  });
})();`;

// crypto.randomUUID needs a secure context; plain-http deployments still need an unguessable token.
const randomHex = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
