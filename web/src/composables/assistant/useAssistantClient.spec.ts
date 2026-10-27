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

// The real non-destructive refresh runs here, so the global http mock is lifted (as http.spec.ts does).
vi.unmock("@/services/http.ts");

vi.mock("@/stores", () => ({
  default: {
    state: { API_ENDPOINT: "http://o2.test", zoConfig: { sso_enabled: false } },
    dispatch: vi.fn(),
  },
}));

vi.mock("@/aws-exports", () => ({ default: { isCloud: "false", isEnterprise: "false" } }));

vi.mock("@/utils/zincutils", () => ({ useLocalCurrentUser: vi.fn(), useLocalUserInfo: vi.fn() }));

vi.mock("axios");

const { incidents } = vi.hoisted(() => ({ incidents: { get: vi.fn(), getRcaRun: vi.fn() } }));
vi.mock("@/services/incidents", () => ({ __esModule: true, default: incidents }));

import axios from "axios";

import config from "@/aws-exports";
import store from "@/stores";

import type { SendRequest } from "./assistantStore.types";
import { readIncidentReport, useAssistantClient, type FrameSink } from "./useAssistantClient";

const sse = (frames: object[], init: ResponseInit = {}) =>
  new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream", ...(init.headers as object) },
  });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const request = (over: Partial<SendRequest> = {}): SendRequest => ({
  org: "org 1",
  sid: "sid-1",
  turnId: "turn-1",
  message: { text: "why?" },
  context: {
    currentPage: "logs",
    client: {
      container: "sidebar",
      entry_kind: "header_button",
      entry_verb: "ask",
      object_kind: "none",
      ui_version: "abc",
    },
    user_timezone: "UTC",
  },
  ...over,
});

const sink = () => {
  let ended: (reason: string) => void = () => undefined;
  const done = new Promise<string>((resolve) => (ended = resolve));
  const s: FrameSink & { frames: unknown[]; done: Promise<string> } = {
    frames: [],
    done,
    onAdmitted: vi.fn(),
    onFrame: (frame) => void s.frames.push(frame),
    onKeepalive: vi.fn(),
    onUnknown: vi.fn(),
    onEnd: (reason) => ended(reason),
  };
  return s;
};

const signal = () => new AbortController().signal;

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (config as any).isCloud = "false";
  (config as any).isEnterprise = "false";
  (store.state as any).zoConfig.sso_enabled = false;
  reload = vi.fn();
  Object.defineProperty(window, "location", {
    value: { ...window.location, reload },
    writable: true,
    configurable: true,
  });
  sessionStorage.setItem("o2.assistant.draft:k1:sid-1", "draft");
  sessionStorage.setItem("other", "x");
});

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useAssistantClient: send", () => {
  it("posts one chat_stream with the idempotency headers and credentials (00 §5.1)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sse([{ type: "complete" }]));
    const client = useAssistantClient({ fetchImpl });
    await client.send(request(), sink(), signal());
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://o2.test/api/org%201/ai/chat_stream");
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-o2-assistant-session-id": "sid-1",
      "x-o2-assistant-turn-id": "turn-1",
    });
    expect(init.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it("sends only the new message and known_seq on the persisted path (HT-07 AC 2)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sse([]));
    const image = { data: "AAAA", mimeType: "image/png" as const, filename: "a.png", size: 3 };
    await useAssistantClient({ fetchImpl }).send(
      request({ knownSeq: 41, message: { text: "next", images: [image] } }),
      sink(),
      signal(),
    );
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.messages).toEqual([{ role: "user", content: "next" }]);
    expect(body.known_seq).toBe(41);
    expect(body.images).toEqual([{ data: "AAAA", mime_type: "image/png", filename: "a.png" }]);
    expect(body.context).toMatchObject({ user_timezone: "UTC", client: { ui_version: "abc" } });
    expect(body).not.toHaveProperty("mode");
  });

  it("sends an explicit chat mode as the request names it, and never an RCA route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sse([{ type: "complete" }]));
    await useAssistantClient({ fetchImpl }).send(request({ mode: "chat" }), sink(), signal());
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://o2.test/api/org%201/ai/chat_stream");
    expect(JSON.parse(init.body)).toMatchObject({ mode: "chat" });
  });

  it("carries the transcript only when the request does (browser-only chats)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sse([]));
    const transcript = [
      { role: "user" as const, content: "first" },
      { role: "assistant" as const, content: "answer" },
    ];
    await useAssistantClient({ fetchImpl }).send({ ...request(), transcript }, sink(), signal());
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.messages).toEqual([...transcript, { role: "user", content: "why?" }]);
    expect(body).not.toHaveProperty("known_seq");
  });

  it("resolves on admission and streams frames to the sink until EOF", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sse([{ type: "status" }, { type: "complete", trace_id: "t" }], {
        headers: { "x-o2-trace-id": "tr-1" },
      }),
    );
    const s = sink();
    const result = await useAssistantClient({ fetchImpl }).send(request(), s, signal());
    expect(result).toEqual({ ok: true, status: 200, traceId: "tr-1" });
    await expect(s.done).resolves.toBe("eof");
    expect(s.frames).toEqual([{ type: "status" }, { type: "complete", trace_id: "t" }]);
  });

  it("returns a typed error and the body for a refusal; never null", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        json(409, { code: 409, message: "Another turn is already running in this conversation" }),
      );
    const result = await useAssistantClient({ fetchImpl }).send(request(), sink(), signal());
    expect(result).toMatchObject({
      ok: false,
      error: { code: "turn_busy", httpStatus: 409, phase: "pre_admission" },
      body: { code: 409 },
    });
  });

  it("is offline or unreachable by navigator.onLine on a fetch rejection", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("navigator", { onLine: false });
    const offline = await useAssistantClient({ fetchImpl }).send(request(), sink(), signal());
    expect(offline).toMatchObject({ ok: false, error: { code: "offline" } });
    vi.stubGlobal("navigator", { onLine: true });
    const down = await useAssistantClient({ fetchImpl }).send(request(), sink(), signal());
    expect(down).toMatchObject({ ok: false, error: { code: "unreachable" } });
  });

  it("reports admission to the sink before the first frame (round 3 #1)", async () => {
    const order: string[] = [];
    const fetchImpl = vi.fn().mockResolvedValue(sse([{ type: "status" }]));
    const s = sink();
    s.onAdmitted = () => void order.push("admitted");
    s.onFrame = () => void order.push("frame");
    await useAssistantClient({ fetchImpl }).send(request(), s, signal());
    await s.done;
    expect(order).toEqual(["admitted", "frame"]);
  });

  it("does not call an AbortError a Stop unless our own signal aborted", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("timeout", "AbortError"));
    const result = await useAssistantClient({ fetchImpl }).send(request(), sink(), signal());
    expect(result).toMatchObject({ ok: false, error: { code: "unreachable" } });
    expect(result).not.toHaveProperty("aborted");
  });

  it("marks a request the caller aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    const result = await useAssistantClient({ fetchImpl }).send(
      request(),
      sink(),
      controller.signal,
    );
    expect(result).toMatchObject({ ok: false, aborted: true });
  });
});

describe("useAssistantClient: 401 (round 1 E-01)", () => {
  it("refreshes once and resends the same turn id", async () => {
    const refreshSession = vi.fn().mockResolvedValue("refreshed");
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(sse([]));
    const result = await useAssistantClient({ fetchImpl, refreshSession }).send(
      request(),
      sink(),
      signal(),
    );
    expect(result.ok).toBe(true);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([, init]) => init.headers["x-o2-assistant-turn-id"])).toEqual([
      "turn-1",
      "turn-1",
    ]);
  });

  it("maps a second 401 or an expired refresh to session_expired", async () => {
    const twice = vi.fn().mockResolvedValue(json(401, {}));
    const again = await useAssistantClient({
      fetchImpl: twice,
      refreshSession: vi.fn().mockResolvedValue("refreshed"),
    }).send(request(), sink(), signal());
    expect(again).toMatchObject({
      ok: false,
      error: { code: "session_expired", action: "sign_in", httpStatus: 401 },
    });
    expect(twice).toHaveBeenCalledTimes(2);

    const once = vi.fn().mockResolvedValue(json(401, {}));
    const expired = await useAssistantClient({
      fetchImpl: once,
      refreshSession: vi.fn().mockResolvedValue("expired"),
    }).send(request(), sink(), signal());
    expect(expired).toMatchObject({ ok: false, error: { code: "session_expired" } });
    expect(once).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Cloud", { isCloud: "true", isEnterprise: "false", sso: false }],
    ["non-SSO", { isCloud: "false", isEnterprise: "true", sso: false }],
    ["SSO with a failed refresh", { isCloud: "false", isEnterprise: "true", sso: true }],
  ])("on %s never logs out, clears sessionStorage or reloads", async (_name, env) => {
    (config as any).isCloud = env.isCloud;
    (config as any).isEnterprise = env.isEnterprise;
    (store.state as any).zoConfig.sso_enabled = env.sso;
    const get = vi.fn().mockRejectedValue(new Error("refresh failed"));
    vi.mocked(axios.create).mockReturnValue({ get } as any);
    const clear = vi.spyOn(Storage.prototype, "clear");
    const fetchImpl = vi.fn().mockResolvedValue(json(401, {}));
    const result = await useAssistantClient({ fetchImpl }).send(request(), sink(), signal());
    expect(result).toMatchObject({ ok: false, error: { code: "session_expired" } });
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalledWith("/config/logout");
    expect(sessionStorage.getItem("o2.assistant.draft:k1:sid-1")).toBe("draft");
    expect(sessionStorage.getItem("other")).toBe("x");
    clear.mockRestore();
  });

  it("owns the stream's 401 alone: one dex_refresh and one replay, never stacked on the interceptor", async () => {
    (config as any).isEnterprise = "true";
    (store.state as any).zoConfig.sso_enabled = true;
    const get = vi.fn().mockResolvedValue({ status: 200 });
    vi.mocked(axios.create).mockReturnValue({ get } as any);
    const fetchImpl = vi.fn().mockResolvedValue(json(401, {}));
    const result = await useAssistantClient({ fetchImpl }).send(request(), sink(), signal());
    expect(result).toMatchObject({ ok: false, error: { code: "session_expired" } });
    expect(get.mock.calls.filter(([url]) => url === "/config/dex_refresh")).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never retries the axios-path calls itself; their 401 belongs to the interceptor", async () => {
    const refreshSession = vi.fn().mockResolvedValue("refreshed");
    const unauthorized = Object.assign(new Error("401"), { response: { status: 401 } });
    const services = {
      cancelTurn: vi.fn().mockRejectedValue(unauthorized),
      confirm: vi.fn().mockRejectedValue(unauthorized),
      feedback: vi.fn().mockRejectedValue(unauthorized),
    };
    const client = useAssistantClient({ refreshSession, services });
    const target = {
      sid: "sid-1",
      origin: {
        entryKind: "header_button" as const,
        objectKind: "none" as const,
        container: "sidebar" as const,
      },
      record: {} as never,
    };
    await expect(client.stop("org1", target)).rejects.toBe(unauthorized);
    await expect(client.confirm("org1", "sid-1", { approved: true })).rejects.toBe(unauthorized);
    await expect(
      client.feedback("org1", "sid-1", { feedback_type: "x", query_index: 0 }),
    ).rejects.toBe(unauthorized);
    expect(services.cancelTurn).toHaveBeenCalledTimes(1);
    expect(services.confirm).toHaveBeenCalledTimes(1);
    expect(services.feedback).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("resends after an SSO refresh that succeeds, sharing dex_refresh", async () => {
    (config as any).isEnterprise = "true";
    (store.state as any).zoConfig.sso_enabled = true;
    const get = vi.fn().mockResolvedValue({ status: 200 });
    vi.mocked(axios.create).mockReturnValue({ get } as any);
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(sse([]));
    const result = await useAssistantClient({ fetchImpl }).send(request(), sink(), signal());
    expect(result.ok).toBe(true);
    expect(get.mock.calls.filter(([url]) => url === "/config/dex_refresh")).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(store.dispatch).not.toHaveBeenCalled();
  });
});

describe("useAssistantClient: tail, stop, confirm, feedback", () => {
  const services = () => ({
    cancelTurn: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn().mockResolvedValue({ deleted: 1 }),
    feedback: vi.fn().mockResolvedValue(undefined),
  });
  const session = (container: "sidebar") => ({
    sid: "sid-1",
    origin: { entryKind: "header_button" as const, objectKind: "incident" as const, container },
    record: {} as never,
  });

  it("tails from a seq with Last-Event-ID (B-03)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sse([{ type: "complete" }]));
    const s = sink();
    const result = await useAssistantClient({ fetchImpl }).tail(
      "org1",
      "sid-1",
      "turn-1",
      12,
      s,
      signal(),
    );
    expect(result.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://o2.test/api/org1/ai/chats/sid-1/turns/turn-1/stream?from_seq=12");
    expect(init).toMatchObject({ method: "GET", credentials: "include" });
    expect(init.headers).toMatchObject({
      "Last-Event-ID": "12",
      "x-o2-assistant-turn-id": "turn-1",
    });
    await expect(s.done).resolves.toBe("eof");
  });

  it("reads a 401 on the tail as signed out elsewhere", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(401, {}));
    const result = await useAssistantClient({
      fetchImpl,
      refreshSession: vi.fn().mockResolvedValue("expired"),
    }).tail("org1", "sid-1", "turn-1", 0, sink(), signal());
    expect(result).toMatchObject({
      ok: false,
      error: { code: "signed_out", phase: "post_admission" },
    });
  });

  it("stops a chat on its cancel route with the turn id (constraint 15)", async () => {
    const svc = services();
    await useAssistantClient({ services: svc }).stop("org1", {
      ...session("sidebar"),
      turnId: "turn-1",
    });
    expect(svc.cancelTurn).toHaveBeenCalledWith("org1", "sid-1", "turn-1");
  });

  it("rejects when the cancel fails, so the engine can say it was not confirmed", async () => {
    const svc = services();
    svc.cancelTurn.mockRejectedValue(new Error("503"));
    await expect(
      useAssistantClient({ services: svc }).stop("org1", session("sidebar")),
    ).rejects.toThrow();
  });

  it("posts confirm and feedback through services/assistant.ts", async () => {
    const svc = services();
    const client = useAssistantClient({ services: svc });
    await expect(client.confirm("org1", "sid-1", { approved: true })).resolves.toEqual({
      deleted: 1,
    });
    await client.feedback("org1", "sid-1", {
      feedback_type: "thumbs_up",
      query_index: 0,
      trace_id: "t",
    });
    expect(svc.confirm).toHaveBeenCalledWith("org1", "sid-1", { approved: true }, undefined);
    expect(svc.feedback).toHaveBeenCalledWith(
      "org1",
      "sid-1",
      expect.objectContaining({ trace_id: "t" }),
    );
  });
});

describe("readIncidentReport", () => {
  const incident = (rca: unknown) => ({
    data: {
      id: "inc-1",
      title: "Checkout latency",
      severity: "P2",
      status: "open",
      first_alert_at: 1_000_000,
      last_alert_at: 2_000_000,
      rca,
    },
  });

  it("reads incident.rca's report run, then that run's report", async () => {
    incidents.get.mockResolvedValue(
      incident({
        run_id: "run-3",
        report_run: { run_id: "run-2", started_at: 5 },
        history: [{ run_id: "run-3" }, { run_id: "run-2" }, { run_id: "run-1" }],
      }),
    );
    incidents.getRcaRun.mockResolvedValue({ data: { run_id: "run-2", report: "## Cause" } });
    const read = await readIncidentReport("org1", "inc-1");
    expect(incidents.getRcaRun).toHaveBeenCalledWith("org1", "inc-1", "run-2");
    expect(read?.run).toEqual({ id: "run-2", number: 2, startedAt: 5, report: "## Cause" });
    expect(read?.incident).toMatchObject({ id: "inc-1", title: "Checkout latency" });
  });

  it("keeps the incident with no run when there is no report run, an empty report or an unreadable run", async () => {
    incidents.get.mockResolvedValueOnce(incident(null));
    expect(await readIncidentReport("org1", "inc-1")).toMatchObject({
      incident: { id: "inc-1" },
      run: null,
    });
    expect(incidents.getRcaRun).not.toHaveBeenCalled();
    incidents.get.mockResolvedValue(incident({ report_run: { run_id: "run-1", started_at: 1 } }));
    incidents.getRcaRun.mockResolvedValueOnce({ data: { run_id: "run-1", report: "  " } });
    expect((await readIncidentReport("org1", "inc-1"))?.run).toBeNull();
    incidents.getRcaRun.mockRejectedValueOnce(Object.assign(new Error("403"), { status: 403 }));
    expect((await readIncidentReport("org1", "inc-1"))?.run).toBeNull();
  });
});
