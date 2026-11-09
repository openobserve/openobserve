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

import { queryClient } from "@/composables/query/queryClient";
import { resolveTourTarget, SAMPLE_TOUR_STEPS, windowParams } from "./tour";

const fetchQuery = vi.spyOn(queryClient, "fetchQuery");
const win = { startUs: 1000, endUs: 2000 };
const loaded = { status: "loaded", start_time: 1000, end_time: 2000 };

const target = async (id: Parameters<typeof resolveTourTarget>[1]) =>
  (await resolveTourTarget("acme", id)) as { name: string; query: Record<string, string> };

describe("windowParams", () => {
  it("uses the window when there is one", () => {
    expect(windowParams(win, "1h")).toEqual({ from: "1000", to: "2000" });
  });

  it("falls back to the period, or to nothing", () => {
    expect(windowParams(undefined, "1h")).toEqual({ period: "1h" });
    expect(windowParams(undefined)).toEqual({});
  });
});

describe("resolveTourTarget", () => {
  beforeEach(() => {
    fetchQuery.mockReset();
  });

  it("carries the saved window on logs, traces and metrics links", async () => {
    fetchQuery.mockResolvedValue(loaded);
    for (const id of ["logs", "deploy", "traces", "metrics"] as const) {
      const { query } = await target(id);
      expect(query).toMatchObject({ from: "1000", to: "2000" });
      expect(query.period).toBeUndefined();
    }
  });

  it("keeps the relative period when no window was saved", async () => {
    fetchQuery.mockResolvedValue({ status: "none" });
    expect((await target("logs")).query.period).toBe("1h");
    expect((await target("traces")).query.period).toBe("1h");
    expect((await target("metrics")).query.period).toBeUndefined();
  });

  it("keeps the relative period when the state cannot be read", async () => {
    fetchQuery.mockRejectedValue(new Error("down"));
    expect((await target("logs")).query.period).toBe("1h");
  });

  // a user's copy of a sample dashboard, with the same title, lives in their own folder
  const withUserCopy = async (opts: any) => {
    const { SAMPLE_DASHBOARD_TITLES, SAMPLE_FOLDER_NAME } = await import("./catalog");
    const key: unknown[] = opts.queryKey;
    const title = SAMPLE_DASHBOARD_TITLES.overview;
    if (key.includes("sampleData")) return loaded;
    if (key.includes("folders")) {
      return [
        { name: "Mine", folderId: "mine" },
        { name: SAMPLE_FOLDER_NAME, folderId: "sf" },
      ];
    }
    if (key.includes("search")) {
      return [
        { title, dashboardId: "copy", folderId: "mine" },
        { title, dashboardId: "d1", folderId: "sf" },
      ];
    }
    return key.includes("sf") ? [{ title, dashboard_id: "d1", folder_id: "sf" }] : [];
  };

  it("opens the dashboard without a period so its own range applies", async () => {
    fetchQuery.mockImplementation(withUserCopy);
    const res = await target("dashboard");
    expect(res.name).toBe("viewDashboard");
    expect(res.query.period).toBeUndefined();
    expect(res.query.from).toBeUndefined();
  });

  it("opens the dashboard in the sample folder, not a same-titled copy elsewhere", async () => {
    fetchQuery.mockImplementation(withUserCopy);
    const res = await target("dashboard");
    expect(res.query).toMatchObject({ dashboard: "d1", folder: "sf" });
  });

  it("opens the alert list on the sample alerts folder", async () => {
    const { SAMPLE_FOLDER_NAME } = await import("./catalog");
    fetchQuery.mockImplementation(async (opts: any) =>
      opts.queryKey.includes("sampleData")
        ? loaded
        : [{ name: SAMPLE_FOLDER_NAME, folderId: "af1" }],
    );
    const res = await target("alert");
    expect(res.name).toBe("alertList");
    expect(res.query.folder).toBe("af1");
    expect(SAMPLE_TOUR_STEPS.find((s) => s.id === "alert")?.route).toBe("alertList");
  });
});
