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

const service = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  getViewDetail: vi.fn(),
}));

vi.mock("@/services/saved_views", () => ({ default: service }));
vi.mock("vuex", () => ({
  useStore: () => ({
    state: { selectedOrganization: { identifier: "org1" } },
  }),
}));

import useMetricsSavedViews from "./useMetricsSavedViews";

const metricsView = (id: string, name: string) => ({
  view_id: id,
  view_name: name,
  // The list now carries `view_type` (the backend returns it); that is what the
  // filter keys on, not the data blob.
  view_type: "metrics",
});

describe("useMetricsSavedViews", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists only the Metrics views, dropping Logs views in a shared list", async () => {
    service.get.mockResolvedValue({
      data: {
        views: [
          metricsView("1", "Morning latency"),
          // A Logs view in the same org list — no metrics kind, must be filtered.
          { view_id: "2", view_name: "logs view", data: { some: "logsblob" } },
        ],
      },
    });

    const sv = useMetricsSavedViews();
    const list = await sv.listViews();

    expect(list).toEqual([{ view_id: "1", view_name: "Morning latency" }]);
    expect(sv.views.value).toHaveLength(1);
  });

  it("a failed list leaves an empty list, not a broken one", async () => {
    service.get.mockRejectedValue(new Error("boom"));
    const sv = useMetricsSavedViews();
    expect(await sv.listViews()).toEqual([]);
    expect(sv.loading.value).toBe(false);
  });

  it("creates a view with the { view_name, data } shape and tracks the new id", async () => {
    service.post.mockResolvedValue({ data: { view_id: "new-1" } });
    const sv = useMetricsSavedViews();
    const snapshot = { kind: "metrics" as const, filters: { type: "counter" }, pinned: ["m1"] };

    const id = await sv.createView("My view", snapshot);

    expect(id).toBe("new-1");
    expect(service.post).toHaveBeenCalledWith("org1", {
      view_name: "My view",
      data: snapshot,
      view_type: "metrics",
    });
    expect(sv.views.value).toContainEqual({ view_id: "new-1", view_name: "My view" });
    expect(sv.activeViewId.value).toBe("new-1");
  });

  it("updates an existing view (name + snapshot) via PUT", async () => {
    service.put.mockResolvedValue({ data: {} });
    const sv = useMetricsSavedViews();
    sv.views.value = [{ view_id: "v1", view_name: "old" }];
    const snapshot = { kind: "metrics" as const, filters: {}, pinned: [] };

    await sv.updateView("v1", "renamed", snapshot);

    expect(service.put).toHaveBeenCalledWith("org1", "v1", {
      view_name: "renamed",
      data: snapshot,
      view_type: "metrics",
    });
    expect(sv.views.value[0].view_name).toBe("renamed");
  });

  it("deletes a view and drops it from the list", async () => {
    service.delete.mockResolvedValue({ data: {} });
    const sv = useMetricsSavedViews();
    sv.views.value = [
      { view_id: "v1", view_name: "a" },
      { view_id: "v2", view_name: "b" },
    ];
    sv.activeViewId.value = "v1";

    await sv.deleteView("v1");

    expect(service.delete).toHaveBeenCalledWith("org1", "v1");
    expect(sv.views.value.map((v) => v.view_id)).toEqual(["v2"]);
    expect(sv.activeViewId.value).toBe("");
  });

  it("returns a view's snapshot for rehydration, and null for a non-metrics blob", async () => {
    const sv = useMetricsSavedViews();

    service.getViewDetail.mockResolvedValueOnce({
      data: { data: { kind: "metrics", filters: { type: "gauge" }, pinned: [] } },
    });
    const snap = await sv.getViewSnapshot("v1");
    expect(snap?.filters.type).toBe("gauge");

    service.getViewDetail.mockResolvedValueOnce({
      data: { data: { not: "ours" } },
    });
    expect(await sv.getViewSnapshot("v2")).toBeNull();
  });
});
