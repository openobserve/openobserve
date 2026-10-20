// Copyright 2026 OpenObserve Inc.
// Replaces window.fetch for AI streams because route.fulfill cannot deliver an SSE body incrementally.
(() => {
  const SCENARIOS = window.__O2MOCK_SCENARIOS__ || {};
  const HTTP_SCENARIOS = window.__O2MOCK_HTTP_SCENARIOS__ || {};
  const mock = (window.__o2mock = window.__o2mock || {});
  // tailEnabled (B-03), envelopeEnabled (B-01), lifecycleFramesEnabled (B-02), cancelDelayMs, cancelStatus.
  mock.knobs = { ...(window.__O2MOCK_KNOBS__ || {}), ...(mock.knobs || {}) };
  // The last streamed turn, so the tail route can resume it.
  mock.lastTurn = null;
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

  // Pseudo frames: `keepalive` (an SSE comment), `oversized` (one line over 1 MiB), `raw` (a literal line).
  const encodeFrame = (frame, seq) => {
    if (frame.keepalive) return ": keepalive\n\n";
    if (frame.oversized) return `data: {"type":"message_delta","content":"${"x".repeat(1024 * 1024 + 16)}"}\n\n`;
    if (frame.raw) return `${frame.raw}\n\n`;
    // The server's own ids (WP-18): `boundary` is an id-only message; `sseId` tags a frame with the seq it comes after.
    if (frame.boundary !== undefined) return `id: ${frame.boundary}\n\n`;
    if (frame.sseId !== undefined) {
      const { sseId, ...data } = frame;
      return `id: ${sseId}\ndata: ${JSON.stringify(data)}\n\n`;
    }
    const id = mock.knobs.tailEnabled ? `id: ${seq}\n` : "";
    return `${id}data: ${JSON.stringify(frame)}\n\n`;
  };

  const withLifecycle = (frames, turnId) => {
    if (!mock.knobs.lifecycleFramesEnabled) return frames;
    const out = [{ type: "turn_started", turn_id: turnId || "turn" }];
    for (const frame of frames) {
      if (frame.type === "tool_call") out.push({ type: "step", kind: "tool", label: frame.tool, params: { call_id: frame.call_id, stream: frame.context?.stream_name } });
      out.push(frame);
    }
    return out;
  };

  const sseStream = (scenario, signal, firstSeq = 1) => {
    const enc = new TextEncoder();
    return new ReadableStream({
      async start(controller) {
        const onAbort = () => {
          try {
            controller.error(new DOMException("The user aborted a request.", "AbortError"));
          } catch (_) {}
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        let seq = firstSeq;
        for (const frame of scenario.frames) {
          if (signal?.aborted) return;
          if (frame.waitForConfirm) {
            await new Promise((r) => confirmWaiters.push(r));
            continue;
          }
          await sleep((scenario.delayMs ?? 30) / (mock.speed || 1));
          if (signal?.aborted) return;
          controller.enqueue(enc.encode(encodeFrame(frame, seq)));
          seq += 1;
        }
        if (mock.lastTurn) mock.lastTurn.seq = seq - 1;
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
        // `repeat` keeps the scenario for the next call too (consent_twice: the same-turn retry is refused again).
        mock.repeats = mock.repeats || {};
        mock.repeats[name] = (mock.repeats[name] ?? httpErr.repeat ?? 1) - 1;
        if (mock.repeats[name] > 0) mock.next = name;
        else delete mock.repeats[name];
        if (httpErr.networkError) throw new TypeError("Failed to fetch");
        const body = mock.knobs.envelopeEnabled && httpErr.envelope ? httpErr.envelope : httpErr.body;
        return new Response(JSON.stringify(body), {
          status: httpErr.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      const scenario = SCENARIOS[name] || SCENARIOS.complete;
      const turnId = (init.headers || {})["x-o2-assistant-turn-id"];
      mock.lastTurn = { name, turnId, seq: 0 };
      return new Response(sseStream({ ...scenario, frames: withLifecycle(scenario.frames, turnId) }, init.signal), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    // B-03 resumable tail: 404 while `tailEnabled` is off, else the scenario's `tailFrames` after `from_seq`.
    const tail = url.match(/\/api\/[^/]+\/ai\/chats\/[^/]+\/turns\/[^/]+\/stream\?from_seq=(\d+)/);
    if (tail) {
      mock.tails = (mock.tails || []).concat([{ url, fromSeq: Number(tail[1]) }]);
      if (!mock.knobs.tailEnabled || !mock.lastTurn) {
        return new Response(JSON.stringify({ code: 404, message: "Not Found" }), { status: 404, headers: { "Content-Type": "application/json" } });
      }
      const scenario = SCENARIOS[mock.lastTurn.name] || SCENARIOS.complete;
      const frames = scenario.tailFrames || [{ type: "complete" }];
      return new Response(sseStream({ ...scenario, frames }, init.signal, Number(tail[1]) + 1), {
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
      // axios' fetch adapter passes a Request whose body is a stream, so the body and headers are read back from it.
      const request = new Request(input, init);
      const body = typeof init.body === "string" ? init.body : await request.clone().text().catch(() => "");
      mock.cancels = (mock.cancels || []).concat([{ url, body, contentType: request.headers.get("content-type") || "", keepalive: !!(init.keepalive ?? input?.keepalive ?? request.keepalive) }]);
      if (mock.knobs.cancelDelayMs) await sleep(mock.knobs.cancelDelayMs);
      mock.release?.();
      const status = mock.knobs.cancelStatus || 200;
      return new Response(JSON.stringify(status === 200 ? { cancelled: true } : { code: status, message: "cancel failed" }), { status, headers: { "Content-Type": "application/json" } });
    }
    return origFetch(input, init);
  };
})();
