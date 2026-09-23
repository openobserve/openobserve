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

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGet, mockCreate } = vi.hoisted(() => {
  const mockGet = vi.fn();
  return { mockGet, mockCreate: vi.fn(() => ({ get: mockGet })) };
});

vi.mock("axios", () => ({ default: { create: mockCreate } }));
vi.mock("@/stores", () => ({
  default: { state: { API_ENDPOINT: "http://api.example" } },
}));

import service from "./public_dashboards";

describe("public_dashboards viewer service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ data: {}, status: 200 });
  });

  it("uses a bare axios client seeded with the store API_ENDPOINT", async () => {
    await service.getConfig("slug1");
    expect(mockCreate).toHaveBeenCalledWith({ baseURL: "http://api.example" });
  });

  it("getConfig() hits the unauth config endpoint", async () => {
    await service.getConfig("slug1");
    expect(mockGet).toHaveBeenCalledWith("/api/public_dashboards/slug1");
  });

  it("getData() passes the preset as a query param", async () => {
    await service.getData("slug1", 3600);
    expect(mockGet).toHaveBeenCalledWith("/api/public_dashboards/slug1/data", {
      params: { preset: 3600 },
    });
  });
});
