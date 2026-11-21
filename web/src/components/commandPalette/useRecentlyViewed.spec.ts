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

import { describe, expect, it } from "vitest";
import { computed, defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  captureRecentResourceRequest,
  captureRecentVisitScope,
  recordResourceVisit,
  removeFailedResourceRequest,
  useRecentlyViewed,
  RecentVisitsStore,
} from "./useRecentlyViewed";

const scope = { deployment: "https://observe.invalid", subject: "user-a", org: "acme" };
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
const hit = (id: string) => ({
  type: "function" as const,
  id,
  name: id,
  route_ref: { function_name: id },
});

describe("Command K local visits", () => {
  it("waits for identity, partitions by it and rejects late replies", () => {
    const disk = storage();
    let reads = 0;
    const history = new RecentVisitsStore(
      () => ({
        ...disk,
        getItem: (key) => {
          reads++;
          return disk.getItem(key);
        },
      }),
      () => 1000,
    );
    history.select({ ...scope, subject: "" });
    expect(reads).toBe(0);
    history.select(scope);
    const before = history.capture();
    history.record(before, hit("normalize"));
    expect(history.items.value[0].id).toBe("normalize");
    history.select({ ...scope, subject: "user-b" });
    expect(history.items.value).toEqual([]);
    history.record(before, hit("late"));
    expect(history.items.value).toEqual([]);
    history.select(scope);
    expect(history.items.value.map((visit) => visit.id)).toEqual(["normalize"]);
  });
  it("deduplicates, caps twenty, shows five and expires after thirty days", () => {
    const disk = storage();
    let now = 1000;
    const history = new RecentVisitsStore(
      () => disk,
      () => now,
    );
    history.select(scope);
    for (let i = 0; i < 25; i++) {
      now++;
      history.record(history.capture(), hit(`f${i}`));
    }
    history.record(history.capture(), hit("f24"));
    expect(history.items.value).toHaveLength(5);
    expect(JSON.parse([...disk.values.values()][0])).toHaveLength(20);
    now += 31 * 24 * 60 * 60 * 1000;
    history.select({ ...scope, org: "other" });
    history.select(scope);
    expect(history.items.value).toEqual([]);
  });
  it("keeps quota-failed writes in memory, removes only forbidden/not-found targets and clears", () => {
    const disk = storage();
    let quotaExceeded = false;
    const history = new RecentVisitsStore(
      () => ({
        ...disk,
        setItem(key, value) {
          if (quotaExceeded) throw new Error("quota");
          disk.setItem(key, value);
        },
      }),
      () => 1000,
    );
    history.select(scope);
    history.record(history.capture(), hit("old-on-disk"));
    quotaExceeded = true;
    history.record(history.capture(), hit("new-in-memory"));
    history.select({ ...scope, org: "other" });
    history.select(scope);
    expect(history.items.value.map((visit) => visit.id)).toEqual(["new-in-memory", "old-on-disk"]);
    expect(history.storageFailed.value).toBe(true);
    history.removeAfterFailure(history.capture(), "function", "old-on-disk", 401);
    expect(history.items.value).toHaveLength(2);
    history.removeAfterFailure(history.capture(), "function", "old-on-disk", 404);
    expect(history.items.value.map((visit) => visit.id)).toEqual(["new-in-memory"]);
    history.clear();
    history.select({ ...scope, org: "other" });
    history.select(scope);
    expect(history.items.value).toEqual([]);
  });
  it("removes an explicit destination refusal without treating a child data failure as a resource failure", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/dashboards/view", name: "viewDashboard", component: { render: () => h("div") } },
      ],
    });
    await router.push({
      name: "viewDashboard",
      query: { dashboard: "dash-one", org_identifier: "acme" },
    });
    const view = mount(
      defineComponent({
        setup() {
          useRecentlyViewed({
            deployment: computed(() => "history-test"),
            subject: computed(() => "user"),
            org: computed(() => "acme"),
          });
          return () => h("div");
        },
      }),
      { global: { plugins: [router] } },
    );
    recordResourceVisit(captureRecentVisitScope(), {
      type: "dashboard",
      id: "dash-one",
      name: "Overview",
      route_ref: { dashboard_id: "dash-one", folder_id: "default" },
    });
    expect(captureRecentResourceRequest("/api/acme/_search_stream", "post")).toBeUndefined();
    expect(captureRecentResourceRequest("/api/acme/dashboards/dash-two", "get")).toBeUndefined();
    expect(captureRecentResourceRequest("/api/other/dashboards/dash-one", "get")).toBeUndefined();
    const request = captureRecentResourceRequest(
      "/api/acme/dashboards/dash-one?folder=default",
      "get",
    );
    expect(request).toMatchObject({ kind: "dashboard", id: "dash-one" });
    removeFailedResourceRequest(request, 404);
    const saved = localStorage.getItem("o2.commandPalette.recent.v2:history-test:user:acme");
    expect(JSON.parse(saved ?? "[]")).toEqual([]);
    view.unmount();
    localStorage.removeItem("o2.commandPalette.recent.v2:history-test:user:acme");
  });
});
