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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { list, create, invalidateQueries } = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock("@/services/dashboards", () => ({ default: { list, create } }));
vi.mock("@/composables/query/queryClient", () => ({ queryClient: { invalidateQueries } }));

import {
  importSetupDashboard,
  NVIDIA_GPU_DASHBOARD,
  SETUP_DASHBOARD_BY_SLUG,
  type SetupDashboardRef,
} from "./useSetupDashboardImport";

const JSON_DOC = { version: 5, title: "Renamed upstream", tabs: [] };
const DASH: SetupDashboardRef = { title: "GPU Monitoring - NVIDIA", load: async () => JSON_DOC };

describe("importSetupDashboard", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // An automatic import must never reach the network for the dashboard itself.
    vi.stubGlobal("fetch", fetchSpy);
    list.mockResolvedValue({ data: { dashboards: [] } });
    create.mockResolvedValue({ data: { version: 5, v5: { dashboardId: "new-1" } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps the nvidiaDcgm card to the bundled GPU dashboard", async () => {
    expect(SETUP_DASHBOARD_BY_SLUG.nvidiaDcgm).toBe(NVIDIA_GPU_DASHBOARD);
    const doc = await NVIDIA_GPU_DASHBOARD.load();
    expect(doc.title).toBe(NVIDIA_GPU_DASHBOARD.title);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the existing dashboard without creating (never overwrites)", async () => {
    list.mockResolvedValue({
      data: {
        dashboards: [
          { title: "GPU Monitoring - NVIDIA (copy)", dashboard_id: "other" },
          { title: "GPU Monitoring - NVIDIA", dashboard_id: "existing-1" },
        ],
      },
    });
    const load = vi.fn(DASH.load);
    const result = await importSetupDashboard("org1", { ...DASH, load });
    expect(result).toEqual({ status: "exists", dashboardId: "existing-1", folderId: "default" });
    expect(list).toHaveBeenCalledWith(
      0,
      50,
      "name",
      false,
      "",
      "org1",
      "default",
      "GPU Monitoring - NVIDIA",
    );
    expect(load).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("creates in Default with the pinned title and invalidates the dashboard lists", async () => {
    const result = await importSetupDashboard("org1", DASH);
    expect(result).toEqual({ status: "created", dashboardId: "new-1", folderId: "default" });
    expect(create).toHaveBeenCalledWith(
      "org1",
      expect.objectContaining({ title: "GPU Monitoring - NVIDIA", version: 8 }),
      "default",
    );
    expect(invalidateQueries).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a create response without an id as an error instead of a blank target", async () => {
    create.mockResolvedValue({ data: { version: 5 } });
    const result = await importSetupDashboard("org1", DASH);
    expect(result).toMatchObject({ status: "error", kind: "generic" });
  });

  it("never duplicates a listed dashboard whose row carries no id", async () => {
    list.mockResolvedValue({ data: { dashboards: [{ title: "GPU Monitoring - NVIDIA" }] } });
    const result = await importSetupDashboard("org1", DASH);
    expect(result).toMatchObject({ status: "error", kind: "generic" });
    expect(create).not.toHaveBeenCalled();
  });

  it("stamps the creation time instead of keeping the bundled one", async () => {
    await importSetupDashboard("org1", DASH);
    const sent = create.mock.calls[0][1];
    expect(Date.now() - Date.parse(sent.created)).toBeLessThan(60_000);
  });

  it("reports a failed lookup as a generic error without creating", async () => {
    list.mockRejectedValue(new Error("network down"));
    const result = await importSetupDashboard("org1", DASH);
    expect(result).toMatchObject({ status: "error", kind: "generic", message: "network down" });
    expect(create).not.toHaveBeenCalled();
  });

  it("classifies a 403 from the dashboards API as forbidden", async () => {
    create.mockRejectedValue({ response: { status: 403 }, message: "Forbidden" });
    const result = await importSetupDashboard("org1", DASH);
    expect(result).toMatchObject({ status: "error", kind: "forbidden" });
  });

  it("dedupes concurrent imports for the same org and dashboard", async () => {
    const [a, b] = await Promise.all([
      importSetupDashboard("org1", DASH),
      importSetupDashboard("org1", DASH),
    ]);
    expect(a).toEqual(b);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
