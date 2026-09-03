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

// Shared create-if-absent import of the bundled Host Metrics dashboard (design 4.2/§6).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { importHostMetricsDashboard } from "@/composables/useHostMetricsDashboard";
import dashboardsService from "@/services/dashboards";
import dashboardJson from "@/assets/dashboards/host_metrics.dashboard.json";

vi.mock("@/services/dashboards", () => ({
  default: {
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));

const listMock = vi.mocked(dashboardsService.list);
const createMock = vi.mocked(dashboardsService.create);
const deleteMock = vi.mocked(dashboardsService.delete);

const listResponse = (dashboards: any[]) => ({ data: { dashboards } }) as any;
const createResponse = (dashboardId: string) =>
  ({ data: { version: 8, v8: { dashboardId } } }) as any;

describe("importHostMetricsDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMock.mockResolvedValue(listResponse([]));
    createMock.mockResolvedValue(createResponse("dash-new"));
  });

  it("creates the bundled v8 dashboard in the default folder when absent", async () => {
    const result = await importHostMetricsDashboard("org-a");
    expect(createMock).toHaveBeenCalledTimes(1);
    const [org, body, folder] = createMock.mock.calls[0];
    expect(org).toBe("org-a");
    expect(folder).toBe("default");
    // §6: the create body IS the bundled JSON — anything less lets a stub dashboard pass.
    expect(body).toEqual(dashboardJson);
    // The id comes from the versioned response envelope (3.6).
    expect(result).toEqual({ status: "created", dashboardId: "dash-new", folderId: "default" });
  });

  it("runs the exists-check through the server-side title param, not a 1000-row scan", async () => {
    await importHostMetricsDashboard("org-a");
    expect(listMock).toHaveBeenCalledWith(
      0,
      50,
      "name",
      false,
      "",
      "org-a",
      "default",
      "Host Metrics",
    );
  });

  it("still confirms the exact title on returned rows (server filter may be substring)", async () => {
    listMock.mockResolvedValue(
      listResponse([{ dashboardId: "near-miss", title: "Host Metrics Extended" }]),
    );
    const result = await importHostMetricsDashboard("org-a");
    expect(result.status).toBe("created");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("returns exists without deleting or re-creating when the dashboard is found", async () => {
    listMock.mockResolvedValue(listResponse([{ dashboardId: "dash-old", title: "Host Metrics" }]));
    const result = await importHostMetricsDashboard("org-a");
    // An automatic trigger must never destroy user edits silently (4.2).
    expect(result).toEqual({ status: "exists", dashboardId: "dash-old", folderId: "default" });
    expect(createMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("maps HTTP 403 to kind 'forbidden'", async () => {
    createMock.mockRejectedValue({ response: { status: 403 } });
    const result = await importHostMetricsDashboard("org-a");
    expect(result.status).toBe("error");
    expect((result as any).kind).toBe("forbidden");
  });

  it("maps network/other failures to kind 'generic'", async () => {
    createMock.mockRejectedValue(new Error("network down"));
    const result = await importHostMetricsDashboard("org-a");
    expect(result.status).toBe("error");
    expect((result as any).kind).toBe("generic");
  });

  it("dedupes concurrent calls through the in-flight guard", async () => {
    let release: (v: any) => void = () => {};
    listMock.mockReturnValue(new Promise((r) => (release = r)) as any);
    const first = importHostMetricsDashboard("org-a");
    const second = importHostMetricsDashboard("org-a");
    release(listResponse([]));
    const [r1, r2] = await Promise.all([first, second]);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
  });
});
