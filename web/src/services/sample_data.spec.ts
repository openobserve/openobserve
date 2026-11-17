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
const invalidateQueries = vi.hoisted(() => vi.fn());
vi.mock("@/composables/query/queryClient", () => ({
  queryClient: { fetchQuery, invalidateQueries },
}));
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

  it("answers with the window a failed save left in this tab, until the state is deleted", async () => {
    client.get.mockResolvedValue({ data: { status: "none" } });
    sampleData.keepWindow("acme", 10, 20);
    expect((await sampleData.getState("acme")).data).toMatchObject({
      status: "loaded",
      start_time: 10,
      end_time: 20,
    });
    expect((await sampleData.getState("other")).data).toEqual({ status: "none" });
    await sampleData.deleteState("acme");
    expect((await sampleData.getState("acme")).data).toEqual({ status: "none" });
  });

  it("saves the window as a loaded state", async () => {
    await sampleData.putState("acme", 10, 20);
    expect(client.put).toHaveBeenCalledWith("/api/acme/sample_data", {
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

  it("fails with the passcode error when there is no org token", async () => {
    const failure = { response: { status: 500 } };
    fetchQuery.mockImplementation(async (query: string) => {
      if (query === "tokens") return { data: [] };
      throw failure;
    });
    await expect(sampleData.ingestLogs("acme", "s", [{}])).rejects.toBe(failure);
  });
});

describe("sampleData ingest 401", () => {
  const client = (http as unknown as ReturnType<typeof vi.fn>)();
  const bearer = (n: number) =>
    atob((vi.mocked(http).mock.calls[n][0] as any).headers.Authorization.replace("Basic ", ""));

  beforeEach(() => {
    vi.clearAllMocks();
    client.post.mockReset();
  });

  it("reads the credential again and retries once when the token was rotated", async () => {
    let token = "o2oi_old";
    fetchQuery.mockImplementation(async (query: string) =>
      query === "tokens"
        ? { data: [{ token, enabled: true }] }
        : { data: { user: "u", passcode: "p" } },
    );
    client.post.mockImplementationOnce(async () => {
      token = "o2oi_new";
      throw { response: { status: 401 } };
    });
    client.post.mockResolvedValueOnce({ data: {} });
    await sampleData.ingestLogs("acme", "s", [{}]);
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(client.post).toHaveBeenCalledTimes(2);
    expect(bearer(0)).toMatch(/:o2oi_old$/);
    expect(bearer(1)).toMatch(/:o2oi_new$/);
  });

  it("fails when the retry is refused too", async () => {
    fetchQuery.mockResolvedValue({ data: [{ token: "o2oi_x", enabled: true }] });
    const refused = { response: { status: 401 } };
    client.post.mockRejectedValue(refused);
    await expect(sampleData.ingestMetrics("acme", [{}])).rejects.toBe(refused);
    expect(client.post).toHaveBeenCalledTimes(2);
  });

  it("does not retry other errors", async () => {
    fetchQuery.mockResolvedValue({ data: [{ token: "o2oi_x", enabled: true }] });
    const down = { response: { status: 500 } };
    client.post.mockRejectedValue(down);
    await expect(sampleData.ingestTraces("acme", "t", {})).rejects.toBe(down);
    expect(client.post).toHaveBeenCalledTimes(1);
  });
});
