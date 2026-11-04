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

import http from "./http";
import sampleData from "./sample_data";

vi.mock("./http", () => {
  const client = { get: vi.fn(), put: vi.fn(), delete: vi.fn(), post: vi.fn() };
  return { default: vi.fn(() => client) };
});

const fetchQuery = vi.hoisted(() => vi.fn());
vi.mock("@/composables/query/queryClient", () => ({ queryClient: { fetchQuery } }));
vi.mock("@/services/organizations.queries", () => ({
  ingestionTokensQuery: () => "tokens",
  orgPasscodeQuery: () => "passcode",
}));

describe("sampleData state calls", () => {
  const client = (http as unknown as ReturnType<typeof vi.fn>)();

  beforeEach(() => vi.clearAllMocks());

  it("reads the state of the org", async () => {
    await sampleData.getState("acme");
    expect(client.get).toHaveBeenCalledWith("/api/acme/sample_data", {
      skipAccessToast: true,
    });
  });

  it("saves the window as a loaded state", async () => {
    await sampleData.putState("acme", 10, 20);
    expect(client.put).toHaveBeenCalledWith("/api/acme/sample_data", {
      status: "loaded",
      start_time: 10,
      end_time: 20,
    });
  });

  it("deletes the state of the org", async () => {
    await sampleData.deleteState("acme");
    expect(client.delete).toHaveBeenCalledWith("/api/acme/sample_data");
  });
});

describe("sampleData ingest credential", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ingests with the org token when the passcode cannot be read", async () => {
    fetchQuery.mockImplementation(async (query: string) => {
      if (query === "tokens") return { data: [{ token: "o2oi_x", enabled: true }] };
      throw { response: { status: 500 } };
    });
    await sampleData.ingestLogs("acme", "s", [{}]);
    const { headers } = vi.mocked(http).mock.calls.at(-1)![0] as any;
    expect(atob(headers.Authorization.replace("Basic ", ""))).toMatch(/:o2oi_x$/);
  });

  it("keeps the session when the server refuses the ingest credential", async () => {
    fetchQuery.mockResolvedValue({ data: [{ token: "o2oi_x", enabled: true }] });
    const client = (http as unknown as ReturnType<typeof vi.fn>)();
    await sampleData.ingestLogs("acme", "s", [{}]);
    await sampleData.ingestMetrics("acme", [{}]);
    await sampleData.ingestTraces("acme", "t", {});
    expect(client.post).toHaveBeenCalledTimes(3);
    for (const call of client.post.mock.calls) {
      expect(call[2]).toEqual({ keepSessionOn401: true });
    }
  });

  it("fails with the passcode error when there is no org token", async () => {
    const failure = { response: { status: 500 } };
    fetchQuery.mockImplementation(async (query: string) => {
      if (query === "tokens") return { data: [] };
      throw failure;
    });
    await expect(sampleData.ingestLogs("acme", "s", [{}])).rejects.toBe(failure);
  });
});
