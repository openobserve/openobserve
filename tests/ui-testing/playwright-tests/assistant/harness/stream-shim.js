// Copyright 2026 OpenObserve Inc.
// Replaces window.fetch for AI streams because route.fulfill cannot deliver an SSE body incrementally.
(() => {
  const SCENARIOS = window.__O2MOCK_SCENARIOS__ || {};
  const HTTP_SCENARIOS = window.__O2MOCK_HTTP_SCENARIOS__ || {};
  const mock = (window.__o2mock = window.__o2mock || {});
  // tailEnabled, envelopeEnabled, lifecycleFramesEnabled, cancelDelayMs, cancelStatus, confirmStatus, confirmDelayMs, confirmFail (item names /confirm fails), confirmUndoable (items the server can undo).
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

  // o2-ai's /confirm answer for the last turn's card: a delete batch item by item, a permission or CLI echo (app.py confirm_action).
  const confirmAnswer = (body) => {
    const status = mock.knobs.confirmStatus || 200;
    if (status !== 200) return { status, body: { code: status, message: `Confirmation failed: upstream ${status}` } };
    const scenario = SCENARIOS[mock.lastTurn?.name] || {};
    const card = (scenario.frames || []).find((frame) => frame.type === "confirmation_required");
    const items = card?.tool === "o2_delete" ? card.args?.items || [] : null;
    if (!body.approved) return { status, body: items ? { approved: false, deleted: false, count: 0 } : { approved: false, kind: "opencode_permission" } };
    if (!items) return { status, body: { approved: true, replied: true, kind: "opencode_permission" } };
    const failed = new Set(mock.knobs.confirmFail || []);
    const results = items.map((item) => ({
      resource: item.name,
      resource_type: item.resource_type,
      deleted: !failed.has(item.name),
      status_code: failed.has(item.name) ? 403 : 200,
      detail: failed.has(item.name) ? "forbidden" : "",
      ...(mock.knobs.confirmUndoable && !failed.has(item.name) && { undoable: true, ledger_id: `led-${item.id || item.name}` }),
    }));
    const count = results.filter((r) => r.deleted).length;
    return { status, body: { approved: true, deleted: count === results.length, count, total: results.length, results } };
  };
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

  // Streams running in this page by session, so a Stop sent from another tab can end them (`cancelSid`).
  mock.active = mock.active || {};
  mock.cancelSid = (sid) => mock.active[sid]?.();
  // One channel object per page: a page never hears its own post, so only other tabs' streams end.
  const cancelChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel("o2mock-cancel") : null;
  if (cancelChannel) cancelChannel.onmessage = (event) => mock.cancelSid(event.data?.sid);

  const sseStream = (scenario, signal, firstSeq = 1, hooks = {}) => {
    const enc = new TextEncoder();
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      if (hooks.sid && mock.active[hooks.sid] === cancelHere) delete mock.active[hooks.sid];
      hooks.onEnd?.();
    };
    let cancelHere = () => {};
    return new ReadableStream({
      async start(controller) {
        const onAbort = () => {
          end();
          try {
            controller.error(new DOMException("The user aborted a request.", "AbortError"));
          } catch (_) {}
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        let seq = firstSeq;
        cancelHere = () => {
          if (ended) return;
          try {
            controller.enqueue(enc.encode(encodeFrame({ type: "cancelled" }, seq)));
            controller.close();
          } catch (_) {}
          end();
        };
        if (hooks.sid) mock.active[hooks.sid] = cancelHere;
        for (const frame of scenario.frames) {
          if (signal?.aborted || ended) return;
          if (frame.waitForConfirm) {
            await new Promise((r) => confirmWaiters.push(r));
            continue;
          }
          await sleep((scenario.delayMs ?? 30) / (mock.speed || 1));
          if (signal?.aborted || ended) return;
          controller.enqueue(enc.encode(encodeFrame(frame, seq)));
          seq += 1;
        }
        if (mock.lastTurn) mock.lastTurn.seq = seq - 1;
        if (scenario.holdOpen) {
          await new Promise((r) => (mock.release = r));
        }
        signal?.removeEventListener("abort", onAbort);
        if (ended) return;
        end();
        controller.close();
      },
    });
  };

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/\/api\/[^/]+\/ai\/chat_stream(\?|$)/.test(url)) {
      const bodyText = typeof init.body === "string" ? init.body : "";
      const name = pickScenario(bodyText, new Error().stack);
      mock.requests.push({ url, scenario: name, body: bodyText, headers: init.headers, stack: new Error().stack, at: Date.now() });
      const httpErr = HTTP_SCENARIOS[name];
      // Tell the Node-side mock which scenario an admitted turn ran; a refused turn never creates or runs a chat.
      try {
        const sid = (init.headers || {})["x-o2-assistant-session-id"];
        const last = (JSON.parse(bodyText || "{}").messages || []).slice(-1)[0];
        if (sid && !httpErr) origFetch(new URL("/__o2mock/turn", url).href, { method: "POST", body: JSON.stringify({ session_id: sid, turn_id: (init.headers || {})["x-o2-assistant-turn-id"], scenario: name, text: String(last?.content || "") }) }).catch(() => {});
      } catch (_) {}
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
      const sid = (init.headers || {})["x-o2-assistant-session-id"];
      const onEnd = () => sid && origFetch(new URL("/__o2mock/turn_end", url).href, { method: "POST", body: JSON.stringify({ session_id: sid }) }).catch(() => {});
      return new Response(sseStream({ ...scenario, frames: withLifecycle(scenario.frames, turnId) }, init.signal, 1, { sid, onEnd }), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    // The incident analysis streams its report on its own route, not through chat_stream.
    if (/\/api\/v2\/[^/]+\/alerts\/incidents\/[^/]+\/rca\?(.*&)?stream=true/.test(url) && (init.method || "GET").toUpperCase() === "POST") {
      mock.rcaRequests = (mock.rcaRequests || []).concat([{ url, headers: init.headers }]);
      // A re-analysis answers 202 and runs in the background until the server streams it (knob `rcaReanalysisStreams`).
      if (/[?&]reanalysis=true/.test(url) && !mock.knobs.rcaReanalysisStreams) {
        await sleep(150);
        mock.rcaBackgroundStartedAt = Date.now();
        return new Response(JSON.stringify({ message: "Analysis started" }), { status: 202, headers: { "Content-Type": "application/json" } });
      }
      const name = mock.rcaScenario || "rca_stream";
      const httpErr = HTTP_SCENARIOS[name];
      if (httpErr) {
        await sleep(150);
        return new Response(JSON.stringify(httpErr.body), { status: httpErr.status, headers: { "Content-Type": "application/json" } });
      }
      const scenario = SCENARIOS[name] || SCENARIOS.rca_stream;
      return new Response(sseStream(scenario, init.signal), { status: 200, headers: { "Content-Type": "text/event-stream" } });
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
      // The legacy chat posts a string body; axios' fetch adapter (keepalive) passes a Request.
      const request = new Request(input, init);
      const text = typeof init.body === "string" ? init.body : await request.clone().text().catch(() => "");
      let body = {};
      try {
        body = JSON.parse(text || "{}");
      } catch (_) {}
      mock.confirmations.push({ ...body, url, keepalive: !!(init.keepalive ?? input?.keepalive ?? request.keepalive) });
      // A real fetch gives up when the caller's timeout aborts it; the stand-in does the same.
      if (mock.knobs.confirmDelayMs)
        await Promise.race([
          sleep(mock.knobs.confirmDelayMs),
          new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))),
        ]);
      const answer = confirmAnswer(body);
      // A refused decision never reached the agent, so the paused stream keeps waiting.
      if (answer.status === 200) {
        const waiters = confirmWaiters;
        confirmWaiters = [];
        waiters.forEach((r) => r(body));
      }
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "Content-Type": "application/json" } });
    }
    if (/\/api\/[^/]+\/ai\/chats\/[^/]+\/cancel/.test(url)) {
      // axios' fetch adapter passes a Request whose body is a stream, so the body and headers are read back from it.
      const request = new Request(input, init);
      const body = typeof init.body === "string" ? init.body : await request.clone().text().catch(() => "");
      mock.cancels = (mock.cancels || []).concat([{ url, body, contentType: request.headers.get("content-type") || "", keepalive: !!(init.keepalive ?? input?.keepalive ?? request.keepalive) }]);
      if (mock.knobs.cancelDelayMs) await sleep(mock.knobs.cancelDelayMs);
      mock.release?.();
      const status = mock.knobs.cancelStatus || 200;
      const cancelled = url.match(/\/ai\/chats\/([^/]+)\/cancel/);
      if (status === 200 && cancelled) cancelChannel?.postMessage({ sid: decodeURIComponent(cancelled[1]) });
      return new Response(JSON.stringify(status === 200 ? { cancelled: true } : { code: status, message: "cancel failed" }), { status, headers: { "Content-Type": "application/json" } });
    }
    return origFetch(input, init);
  };
})();
