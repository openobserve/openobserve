// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockIngestionRoutes = [
  { path: "ingestion", name: "ingestion" },
  { path: "ingestion/logs", name: "ingestLogs" },
];

vi.mock("./shared/useIngestionRoutes", () => ({
  default: vi.fn(() => mockIngestionRoutes),
}));

import useOSRoutes from "./router";
import useIngestionRoutes from "./shared/useIngestionRoutes";

describe("useOSRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parentRoutes is an empty array", () => {
    const { parentRoutes } = useOSRoutes();
    expect(parentRoutes).toEqual([]);
  });

  it("homeChildRoutes contains the routes returned by useIngestionRoutes", () => {
    const { homeChildRoutes } = useOSRoutes();
    expect(homeChildRoutes).toEqual(mockIngestionRoutes);
  });

  it("homeChildRoutes has the same length as the mocked ingestion routes", () => {
    const { homeChildRoutes } = useOSRoutes();
    expect(homeChildRoutes).toHaveLength(mockIngestionRoutes.length);
  });

  it("homeChildRoutes items match the mocked route objects", () => {
    const { homeChildRoutes } = useOSRoutes();
    expect(homeChildRoutes[0]).toEqual({ path: "ingestion", name: "ingestion" });
    expect(homeChildRoutes[1]).toEqual({ path: "ingestion/logs", name: "ingestLogs" });
  });

  it("useIngestionRoutes is called when the composable is invoked", () => {
    useOSRoutes();
    expect(useIngestionRoutes).toHaveBeenCalledTimes(1);
  });

  it("multiple calls return independent instances with separate arrays", () => {
    const result1 = useOSRoutes();
    const result2 = useOSRoutes();

    expect(result1).not.toBe(result2);
    expect(result1.parentRoutes).not.toBe(result2.parentRoutes);
    expect(result1.homeChildRoutes).not.toBe(result2.homeChildRoutes);
  });

  it("multiple calls each invoke useIngestionRoutes independently", () => {
    useOSRoutes();
    useOSRoutes();
    expect(useIngestionRoutes).toHaveBeenCalledTimes(2);
  });

  it("returns an object with parentRoutes and homeChildRoutes keys", () => {
    const result = useOSRoutes();
    expect(result).toHaveProperty("parentRoutes");
    expect(result).toHaveProperty("homeChildRoutes");
  });

  it("parentRoutes is always an empty array regardless of ingestion routes", () => {
    vi.mocked(useIngestionRoutes).mockReturnValueOnce([
      { path: "extra", name: "extra" },
    ] as any);
    const { parentRoutes } = useOSRoutes();
    expect(parentRoutes).toEqual([]);
    expect(parentRoutes).toHaveLength(0);
  });

  it("homeChildRoutes reflects updated mock return values", () => {
    const customRoutes = [{ path: "custom", name: "customRoute" }];
    vi.mocked(useIngestionRoutes).mockReturnValueOnce(customRoutes as any);

    const { homeChildRoutes } = useOSRoutes();
    expect(homeChildRoutes).toEqual(customRoutes);
  });
});
