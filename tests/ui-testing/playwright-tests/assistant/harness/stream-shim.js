// Copyright 2026 OpenObserve Inc.
// Browser init script: replaces window.fetch for the AI streaming endpoints so the
// UI receives a real, incrementally delivered SSE body (Playwright's route.fulfill
// can only deliver a body at once). Expects window.__O2MOCK_SCENARIOS__ and
// window.__O2MOCK_HTTP_SCENARIOS__ to be defined before this script runs.
(() => {
  const SCENARIOS = window.__O2MOCK_SCENARIOS__ || {};
  const HTTP_SCENARIOS = window.__O2MOCK_HTTP_SCENARIOS__ || {};
  const mock = (window.__o2mock = window.__o2mock || {});
  // `next` is consumed by the next chat_stream call; `sticky` applies to every call.
  mock.next = mock.next ?? null;
  mock.sticky = mock.sticky ?? null;
  mock.speed = mock.speed ?? 1;
  mock.requests = [];
  mock.confirmations = [];
  let confirmWaiters = [];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const origFetch = window.fetch.bind(window);

  const pickScenario = (bodyText, stack) => {
    if (mock.next) {
      const s = mock.next;
      mock.next = null;
      return s;
    }
    if (mock.sticky) return mock.sticky;
    // Natural-language query mode shares chat_stream; in the dev build the caller's module name is in the stack.
    if (/useNLQuery/.test(stack || "")) return mock.nlScenario || "nl_sql";
    try {
      const body = JSON.parse(bodyText || "{}");
      const last = (body.messages || []).slice(-1)[0];
      const text = String(last?.content || "").toLowerCase();
      for (const key of Object.keys(SCENARIOS)) if (text.includes(`[${key}]`)) return key;
      if (text.includes("promql")) return "promql";
      if (text.includes("vrl")) return "vrl";
    } catch (_) {
      /* not JSON */
    }
    return "complete";
  };

  const sseStream = (scenario, signal) => {
    const enc = new TextEncoder();
    return new ReadableStream({
      async start(controller) {
        const onAbort = () => {
          try {
            controller.error(new DOMException("The user aborted a request.", "AbortError"));
          } catch (_) {}
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        for (const frame of scenario.frames) {
          if (signal?.aborted) return;
          if (frame.waitForConfirm) {
            await new Promise((r) => confirmWaiters.push(r));
            continue;
          }
          await sleep((scenario.delayMs ?? 30) / (mock.speed || 1));
          if (signal?.aborted) return;
          controller.enqueue(enc.encode(`data: ${JSON.stringify(frame)}\n\n`));
        }
        if (scenario.holdOpen) {
          await new Promise((r) => (mock.release = r));
        }
        signal?.removeEventListener("abort", onAbort);
        controller.close();
      },
    });
  };

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/\/api\/[^/]+\/ai\/chat_stream(\?|$)/.test(url)) {
      const bodyText = typeof init.body === "string" ? init.body : "";
      const name = pickScenario(bodyText, new Error().stack);
      mock.requests.push({ url, scenario: name, body: bodyText, headers: init.headers, stack: new Error().stack });
      // Tell the Node-side mock which scenario this session ran, so GET /ai/chats/{id} can replay it.
      try {
        const sid = (init.headers || {})["x-o2-assistant-session-id"];
        const last = (JSON.parse(bodyText || "{}").messages || []).slice(-1)[0];
        if (sid) origFetch(new URL("/__o2mock/turn", url).href, { method: "POST", body: JSON.stringify({ session_id: sid, scenario: name, text: String(last?.content || "") }) }).catch(() => {});
      } catch (_) {}
      const httpErr = HTTP_SCENARIOS[name];
      if (httpErr) {
        await sleep(150);
        return new Response(JSON.stringify(httpErr.body), {
          status: httpErr.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      const scenario = SCENARIOS[name] || SCENARIOS.complete;
      return new Response(sseStream(scenario, init.signal), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    if (/\/api\/[^/]+\/ai\/confirm\//.test(url)) {
      const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
      mock.confirmations.push(body);
      const waiters = confirmWaiters;
      confirmWaiters = [];
      waiters.forEach((r) => r(body));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (/\/api\/[^/]+\/ai\/chats\/[^/]+\/cancel/.test(url)) {
      mock.release?.();
      return new Response(JSON.stringify({ cancelled: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return origFetch(input, init);
  };
})();
