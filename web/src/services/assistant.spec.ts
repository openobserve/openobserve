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

import { beforeEach, describe, expect, it, vi } from "vitest";

import assistant, { parseAiUsage, parseChatDetail, PROBE_TIMEOUT_MS } from "./assistant";
import http from "./http";

vi.mock("./http", () => ({ default: vi.fn() }));

const managed = { silentForbidden: true, assistantManaged: true };

const httpError = (status?: number) =>
  Object.assign(new Error("request failed"), status ? { response: { status } } : {});

describe("assistant service", () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    api = {
      get: vi.fn().mockResolvedValue({ data: { can_chat: true } }),
      post: vi.fn().mockResolvedValue({ data: { ok: true, duration_ms: 12 } }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
    };
    (http as any).mockReturnValue(api);
  });

  it("reads B-06 capabilities as an assistant-managed request", async () => {
    await expect(assistant.capabilities("org 1")).resolves.toEqual({ can_chat: true });
    expect(api.get).toHaveBeenCalledWith("/api/org%201/ai/capabilities", managed);
  });

  it("reads usage as a validated, assistant-managed request and null where it is not served", async () => {
    api.get.mockResolvedValue({
      data: { mode: "free", credits_used: 412, credits_limit: 1000, credits_remaining: 588 },
    });
    await expect(assistant.usage("org1")).resolves.toEqual({
      mode: "free",
      credits_used: 412,
      credits_limit: 1000,
    });
    expect(api.get).toHaveBeenCalledWith("/api/org1/ai/usage", managed);
    api.get.mockRejectedValue(httpError(404));
    await expect(assistant.usage("org1")).resolves.toBeNull();
  });

  it("rejects a usage body it cannot trust and keeps only a valid renewal date", () => {
    expect(parseAiUsage({ mode: "free", credits_used: "412", credits_limit: 1000 })).toBeNull();
    expect(parseAiUsage({ mode: "gratis", credits_used: 1, credits_limit: 2 })).toBeNull();
    expect(parseAiUsage(JSON.parse('{"__proto__":{"mode":"free"},"credits_used":1}'))).toBeNull();
    expect(parseAiUsage({ mode: "free", credits_used: 1e300, credits_limit: 2 })).toBeNull();
    expect(
      parseAiUsage({ mode: "free", credits_used: 1, credits_limit: 2, resets_at: "not a date" }),
    ).toEqual({ mode: "free", credits_used: 1, credits_limit: 2 });
    expect(
      parseAiUsage({
        mode: "free",
        credits_used: 1,
        credits_limit: 2,
        resets_at: "2026-11-01T00:00:00Z",
      }),
    ).toEqual({ mode: "free", credits_used: 1, credits_limit: 2, resetsAt: Date.UTC(2026, 10, 1) });
  });

  it("answers null when the backend predates B-06 (404)", async () => {
    api.get.mockRejectedValue(httpError(404));
    await expect(assistant.capabilities("org1")).resolves.toBeNull();
  });

  it("rethrows any other capabilities failure", async () => {
    const failure = httpError(500);
    api.get.mockRejectedValue(failure);
    await expect(assistant.capabilities("org1")).rejects.toBe(failure);
  });

  it("posts the capabilities test with the managed flags", async () => {
    await expect(assistant.testCapabilities("org1")).resolves.toEqual({
      ok: true,
      duration_ms: 12,
    });
    expect(api.post).toHaveBeenCalledWith("/api/org1/ai/capabilities/test", {}, managed);
  });

  it("probes with a fresh UUIDv7 cancel, an empty body and a 5 s timeout", async () => {
    await assistant.probeChatAccess("org1");
    await assistant.probeChatAccess("org1");
    const [first, second] = api.post.mock.calls;
    expect(first[0]).toMatch(
      /^\/api\/org1\/ai\/chats\/[0-9a-f-]{8}-[0-9a-f]{4}-7[0-9a-f-]+\/cancel$/,
    );
    expect(first[0]).not.toBe(second[0]);
    expect(first[1]).toEqual({});
    expect(first[2]).toEqual({ ...managed, timeout: PROBE_TIMEOUT_MS });
  });

  it("reads a 403 as no access", async () => {
    api.post.mockRejectedValue(httpError(403));
    await expect(assistant.probeChatAccess("org1")).resolves.toBe("no");
  });

  it.each([404, 400, 500, 502])(
    "reads %s as access (authorization let it through)",
    async (status) => {
      api.post.mockRejectedValue(httpError(status));
      await expect(assistant.probeChatAccess("org1")).resolves.toBe("yes");
    },
  );

  it("reads a 200 as access", async () => {
    await expect(assistant.probeChatAccess("org1")).resolves.toBe("yes");
  });

  it("stays unknown on a network error, a timeout or a 401", async () => {
    api.post.mockRejectedValueOnce(httpError());
    await expect(assistant.probeChatAccess("org1")).resolves.toBe("unknown");
    api.post.mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "ECONNABORTED" }));
    await expect(assistant.probeChatAccess("org1")).resolves.toBe("unknown");
    api.post.mockRejectedValueOnce(httpError(401));
    await expect(assistant.probeChatAccess("org1")).resolves.toBe("unknown");
  });

  it("cancels a turn with keepalive and a JSON body carrying turn_id (constraint 15)", async () => {
    await assistant.cancelTurn("org 1", "sid/1", "turn-1");
    expect(api.post).toHaveBeenCalledWith(
      "/api/org%201/ai/chats/sid%2F1/cancel",
      { turn_id: "turn-1" },
      {
        ...managed,
        adapter: "fetch",
        fetchOptions: { keepalive: true },
        headers: { "x-o2-assistant-session-id": "sid/1" },
      },
    );
  });

  it("rejects when the cancel fails, so the caller can report it unconfirmed", async () => {
    api.post.mockRejectedValue(httpError(503));
    await expect(assistant.cancelTurn("org1", "s", "t")).rejects.toBeDefined();
  });

  it("posts a decision on the originating session, bounded in time, and returns the result", async () => {
    api.post.mockResolvedValue({ data: { deleted: 1, count: 1, total: 1, results: [] } });
    await expect(
      assistant.confirm("org1", "sid-1", { approved: true, scope: "once" }),
    ).resolves.toEqual({
      deleted: 1,
      count: 1,
      total: 1,
      results: [],
    });
    expect(api.post).toHaveBeenCalledWith(
      "/api/org1/ai/confirm/sid-1",
      { approved: true, scope: "once" },
      { ...managed, adapter: "fetch", fetchOptions: { keepalive: true }, timeout: 65_000 },
    );
  });

  it("posts feedback with the session header and the managed flags", async () => {
    const body = { feedback_type: "thumbs_up", query_index: 2, trace_id: "tr" };
    await assistant.feedback("org1", "sid-1", body);
    expect(api.post).toHaveBeenCalledWith("/api/org1/ai/feedback", body, {
      ...managed,
      headers: { "x-o2-assistant-session-id": "sid-1" },
    });
  });
});

describe("parseChatDetail approvals", () => {
  const detail = (approvals: unknown) => parseChatDetail({ session_id: "s1", approvals });

  it("reads each approval row's id, status and decision time", () => {
    const parsed = detail([
      {
        id: "apr_1",
        status: "approved",
        scope: "once",
        card: { type: "confirmation_required" },
        resolved: { type: "confirmation_resolved", approved: true, at: 1_700_000_000_000, by: "u" },
        expires_at: 1,
      },
      { id: "apr_2", status: "expired", resolved: null },
      { id: "apr_3", status: "denied", resolved: { at: 0 } },
    ]);
    expect(parsed.approvals).toEqual([
      { id: "apr_1", status: "approved", at: 1_700_000_000_000 },
      { id: "apr_2", status: "expired" },
      { id: "apr_3", status: "denied" },
    ]);
  });

  it("reads a row the chat withdrew or that ran out of time as such, never as declined", () => {
    const parsed = detail([
      { id: "apr_w", status: "denied", resolved: { approved: false, withdrawn: true, at: 5 } },
      { id: "apr_e", status: "denied", resolved: { approved: false, expired: true } },
      { id: "apr_d", status: "denied", resolved: { approved: false, withdrawn: "yes" } },
      { id: "apr_a", status: "approved", resolved: { approved: true, withdrawn: true, at: 7 } },
    ]);
    expect(parsed.approvals).toEqual([
      { id: "apr_w", status: "withdrawn", at: 5 },
      { id: "apr_e", status: "expired" },
      { id: "apr_d", status: "denied" },
      { id: "apr_a", status: "approved", at: 7 },
    ]);
  });

  it("skips a malformed row, bounds the list and leaves the field off when absent", () => {
    expect(detail([{ id: "apr_1", status: "maybe" }, { status: "denied" }]).approvals).toEqual([]);
    const many = Array.from({ length: 900 }, (_, i) => ({ id: `apr_${i}`, status: "pending" }));
    expect(detail(many).approvals).toHaveLength(500);
    expect(parseChatDetail({ session_id: "s1" })).not.toHaveProperty("approvals");
  });
});
