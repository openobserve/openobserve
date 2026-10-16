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

import assistant, { PROBE_TIMEOUT_MS } from "./assistant";
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
    };
    (http as any).mockReturnValue(api);
  });

  it("reads B-06 capabilities as an assistant-managed request", async () => {
    await expect(assistant.capabilities("org 1")).resolves.toEqual({ can_chat: true });
    expect(api.get).toHaveBeenCalledWith("/api/org%201/ai/capabilities", managed);
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
});
