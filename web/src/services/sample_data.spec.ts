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
  const client = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
  return { default: vi.fn(() => client) };
});

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
