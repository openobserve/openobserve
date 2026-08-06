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

// TDD spec for tmp/code.md B4 — the query-function catalog endpoint.
//
// The frontend currently hand-maintains its list of SQL functions, which has
// no way of staying in step with what the backend actually registers. The
// server already computes the authoritative set; this service exposes it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "./http";
import queryFunctions from "./query_functions";

vi.mock("./http", () => {
  const mockClient = { get: vi.fn() };
  return { default: vi.fn(() => mockClient) };
});

describe("query_functions service", () => {
  const mockClient = (http as unknown as ReturnType<typeof vi.fn>)();

  beforeEach(() => vi.clearAllMocks());

  it("list() calls GET /api/{org}/query_functions", () => {
    queryFunctions.list("myorg");
    expect(mockClient.get).toHaveBeenCalledWith("/api/myorg/query_functions");
  });

  it("encodes an organisation identifier that needs it", () => {
    queryFunctions.list("my org/1");
    expect(mockClient.get).toHaveBeenCalledWith(
      `/api/${encodeURIComponent("my org/1")}/query_functions`,
    );
  });

  it("returns the client promise so callers can await it", async () => {
    mockClient.get.mockResolvedValue({ data: { list: [] } });
    await expect(queryFunctions.list("myorg")).resolves.toEqual({ data: { list: [] } });
  });
});
