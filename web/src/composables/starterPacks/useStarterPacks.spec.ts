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

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

import { queryClient } from "@/composables/query/queryClient";
import store from "@/test/unit/helpers/store";

import type { StarterPack } from "./types";
import { StarterPackPermissionError } from "./types";

const fake = vi.hoisted(() => {
  type Row = Record<string, any>;
  type Fault = { method: string; url: RegExp; status?: number; afterCommit?: boolean };
  const state = {
    seq: 0,
    kv: new Map<string, string>(),
    folders: { alerts: [] as Row[], dashboards: [] as Row[] } as Record<string, Row[]>,
    alerts: [] as Row[],
    dashboards: [] as Row[],
    views: [] as Row[],
    faults: [] as Fault[],
    calls: [] as string[],
  };
  const reply = (data: unknown) => ({ status: 200, data });
  const httpError = (status: number) => Object.assign(new Error("http"), { response: { status } });
  const nextId = (prefix: string) => `${prefix}${(state.seq += 1)}`;
  const folderParam = (url: string, config?: Row) =>
    config?.params?.folder ?? new URL(url, "http://x").searchParams.get("folder") ?? "";

  const commit = (method: string, url: string, body: any, config?: Row) => {
    let match: RegExpMatchArray | null;
    if ((match = url.match(/\/kv\/(.+)$/))) {
      const key = decodeURIComponent(match[1]);
      if (method === "post") state.kv.set(key, body);
      if (method === "delete") state.kv.delete(key);
      if (method === "get" && !state.kv.has(key)) throw httpError(404);
      return reply(method === "get" ? state.kv.get(key) : "OK");
    }
    if (url.match(/\/kv$/)) {
      const prefix = config?.params?.prefix ?? "";
      return reply([...state.kv.keys()].filter((key) => key.startsWith(prefix)));
    }
    if ((match = url.match(/\/folders\/(alerts|dashboards)(?:\/(.+))?$/))) {
      const list = state.folders[match[1]];
      if (method === "get") return reply({ list });
      if (method === "post") {
        const folder = { ...body, folderId: nextId("f") };
        list.push(folder);
        return reply(folder);
      }
      state.folders[match[1]] = list.filter((folder) => folder.folderId !== match![2]);
      return reply({});
    }
    if ((match = url.match(/\/api\/v2\/org\/alerts(?:\/([^?]+))?/))) {
      const id = match[1];
      if (method === "post") {
        state.alerts.push({ ...body, id: nextId("a"), folder_id: folderParam(url) });
        return reply({});
      }
      if (id) {
        const alert = state.alerts.find((row) => row.id === id);
        if (!alert) throw httpError(404);
        if (method === "delete") state.alerts = state.alerts.filter((row) => row !== alert);
        return reply(method === "get" ? { ...alert, last_triggered_at: state.seq } : {});
      }
      const wanted = config?.params?.tags?.split(",") ?? [];
      const folder = folderParam(url, config);
      const rows = state.alerts
        .filter((row) => wanted.every((tag: string) => row.tags.includes(tag)))
        .filter((row) => !folder || row.folder_id === folder)
        .map((row) => ({ ...row, alert_id: row.id }));
      return reply({ list: rows });
    }
    if ((match = url.match(/\/api\/org\/dashboards(?:\/([^?]+))?/))) {
      const id = match[1];
      if (method === "post") {
        state.dashboards.push({
          dashboard_id: nextId("d"),
          title: body.title,
          folder_id: folderParam(url),
          body,
        });
        return reply({});
      }
      if (id) {
        const row = state.dashboards.find((candidate) => candidate.dashboard_id === id);
        if (!row) throw httpError(404);
        if (method === "delete") state.dashboards = state.dashboards.filter((r) => r !== row);
        return reply({ version: 8, v8: { ...row.body, updatedAt: state.seq } });
      }
      const folder = folderParam(url, config);
      return reply({ dashboards: state.dashboards.filter((row) => row.folder_id === folder) });
    }
    if ((match = url.match(/\/savedviews(?:\/(.+))?$/))) {
      const id = match[1];
      if (method === "post") {
        state.views.push({ ...body, view_id: nextId("v") });
        return reply({});
      }
      if (id) {
        const view = state.views.find((row) => row.view_id === id);
        if (!view) throw httpError(404);
        if (method === "delete") state.views = state.views.filter((row) => row !== view);
        return reply(view);
      }
      return reply({ views: state.views });
    }
    throw new Error(`unrouted ${method} ${url}`);
  };

  const request = async (method: string, url: string, body?: unknown, config?: Row) => {
    state.calls.push(`${method} ${url}`);
    const index = state.faults.findIndex((f) => f.method === method && f.url.test(url));
    if (index < 0) return commit(method, url, body, config);
    const [fault] = state.faults.splice(index, 1);
    if (fault.afterCommit) commit(method, url, body, config);
    throw httpError(fault.status ?? 500);
  };
  const client = {
    get: (url: string, config?: Row) => request("get", url, undefined, config),
    post: (url: string, body: unknown, config?: Row) => request("post", url, body, config),
    put: (url: string, body: unknown, config?: Row) => request("put", url, body, config),
    delete: (url: string, config?: Row) => request("delete", url, undefined, config),
  };
  return { state, client };
});

vi.mock("@/services/http", () => ({ default: () => fake.client }));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/composables/alerts/useAlertLibrary", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/composables/alerts/useAlertLibrary",
  );
  const alerts = ["k8s/one", "k8s/two", "k8s/anomaly"].map((id) => ({
    id,
    alert_type: id === "k8s/anomaly" ? "anomaly_detection" : "scheduled",
    name: id,
    pack: "k8s",
    title: id,
    severity: "warning",
    stream_type: "metrics",
    query_type: "sql",
    content_hash: `hash-${id}`,
  }));
  return {
    ...actual,
    useAlertLibrary: () => ({
      loadManifest: async () => ({ alerts }),
      loadAlertFile: async (entry: { id: string }) => ({
        name: entry.id,
        stream_name: "s",
        destinations: ["someone"],
        enabled: true,
        trigger_condition: {},
      }),
    }),
  };
});

import { useStarterPacks } from "./useStarterPacks";

const PACK: StarterPack = {
  id: "kubernetes",
  titleKey: "starterPacks.kubernetes.title",
  descriptionKey: "starterPacks.kubernetes.description",
  folder: { name: "Kubernetes", description: "pack" },
  dashboards: [{ id: "overview", title: "Overview", load: async () => ({ version: 8, tabs: [] }) }],
  alerts: ["k8s/one", "k8s/two"],
  savedViews: [
    {
      id: "events",
      name: "Events",
      search: { meta: {}, data: { stream: { selectedStream: ["e"] }, query: "" } },
    },
  ],
};

const packs = () => {
  let api!: ReturnType<typeof useStarterPacks>;
  mount(
    defineComponent({
      setup() {
        api = useStarterPacks("org");
        return () => null;
      },
    }),
    { global: { plugins: [store] } },
  );
  return api;
};

const counts = () => ({
  alertFolders: fake.state.folders.alerts.length,
  dashboardFolders: fake.state.folders.dashboards.length,
  dashboards: fake.state.dashboards.length,
  alerts: fake.state.alerts.length,
  views: fake.state.views.length,
});
const FULL = { alertFolders: 1, dashboardFolders: 1, dashboards: 1, alerts: 2, views: 1 };
const EMPTY = { alertFolders: 0, dashboardFolders: 0, dashboards: 0, alerts: 0, views: 0 };

describe("useStarterPacks", () => {
  beforeEach(() => {
    queryClient.clear();
    Object.assign(fake.state, {
      seq: 0,
      kv: new Map(),
      folders: { alerts: [], dashboards: [] },
      alerts: [],
      dashboards: [],
      views: [],
      faults: [],
      calls: [],
    });
  });

  describe("installPack", () => {
    it("creates folders, dashboards, disabled alerts and views, and records each", async () => {
      const record = await packs().installPack(PACK);

      expect(record.status).toBe("complete");
      expect(counts()).toEqual(FULL);
      for (const alert of fake.state.alerts) {
        expect(alert.enabled).toBe(false);
        expect(alert.destinations).toEqual([]);
        expect(alert.tags).toContain("pack:kubernetes");
        expect(alert.folder_id).toBe(fake.state.folders.alerts[0].folderId);
      }
      expect(fake.state.alerts.map((a) => a.tags.at(-1))).toEqual([
        "library:k8s/one",
        "library:k8s/two",
      ]);
      expect(fake.state.dashboards[0].folder_id).toBe(fake.state.folders.dashboards[0].folderId);
    });

    it("writes the record before the first item and after each item", async () => {
      await packs().installPack(PACK);

      const creates = fake.state.calls.filter((c) => c.startsWith("post"));
      expect(creates[0]).toContain("/kv/starter_pack.kubernetes.");
      const items = creates.filter((c) => !c.includes("/kv/"));
      expect(items).toHaveLength(6);
      for (const item of items) {
        expect(creates[creates.indexOf(item) + 1]).toContain("/kv/");
      }
    });

    it("stores only ids, kinds, hashes and status in the record", async () => {
      await packs().installPack(PACK);

      const [value] = [...fake.state.kv.values()];
      const record = JSON.parse(value);
      for (const item of record.items) {
        expect(
          Object.keys(item).every((key) =>
            ["kind", "itemId", "status", "id", "folderId", "sourceHash"].includes(key),
          ),
        ).toBe(true);
      }
    });

    it("creates nothing when the record write is refused with 403", async () => {
      fake.state.faults.push({ method: "post", url: /\/kv\//, status: 403 });

      await expect(packs().installPack(PACK)).rejects.toBeInstanceOf(StarterPackPermissionError);

      expect(counts()).toEqual(EMPTY);
    });

    it("reinstalling after a complete install adds no duplicates and claims nothing", async () => {
      const api = packs();
      await api.installPack(PACK);
      const second = await api.installPack(PACK);

      expect(counts()).toEqual(FULL);
      expect(second.items.every((item) => item.status === "existing")).toBe(true);
    });

    it("does not duplicate an alert whose create errored after it committed", async () => {
      fake.state.faults.push({
        method: "post",
        url: /\/api\/v2\/org\/alerts/,
        afterCommit: true,
      });

      const record = await packs().installPack(PACK);

      expect(record.status).toBe("complete");
      expect(counts()).toEqual(FULL);
    });

    it("forced retries after failed creates leave no duplicates", async () => {
      const api = packs();
      fake.state.faults.push(
        { method: "post", url: /\/api\/v2\/org\/alerts/ },
        { method: "post", url: /\/api\/v2\/org\/alerts/, afterCommit: true },
        { method: "post", url: /\/api\/org\/dashboards/ },
      );

      const first = await api.installPack(PACK);
      expect(first.status).toBe("incomplete");

      const second = await api.installPack(PACK);
      const third = await api.installPack(PACK);

      expect(second.installId).toBe(first.installId);
      expect(second.status).toBe("complete");
      expect(third.items.every((item) => item.status === "existing")).toBe(true);
      expect(counts()).toEqual(FULL);
    });

    it("resumes an interrupted install under the same install id", async () => {
      const api = packs();
      // A later record write dies mid-run, which is what a closed page leaves behind.
      fake.state.faults.push({ method: "post", url: /\/api\/v2\/org\/alerts/, afterCommit: true });
      let writes = 0;
      const realPush = fake.state.calls.push.bind(fake.state.calls);
      fake.state.calls.push = (...call: string[]) => {
        if (call[0].startsWith("post") && call[0].includes("/kv/") && (writes += 1) === 5) {
          fake.state.faults.unshift({ method: "post", url: /\/kv\//, status: 500 });
        }
        return realPush(...call);
      };
      await expect(api.installPack(PACK)).rejects.toThrow();
      fake.state.calls.push = realPush;
      const before = [...fake.state.kv.keys()];

      const record = await api.installPack(PACK);

      expect([...fake.state.kv.keys()]).toEqual(before);
      expect(record.status).toBe("complete");
      expect(counts()).toEqual(FULL);
    });

    it("stops when a folder cannot be created and still resumes", async () => {
      const api = packs();
      fake.state.faults.push({ method: "post", url: /\/folders\/dashboards/ });

      const first = await api.installPack(PACK);

      expect(first.status).toBe("incomplete");
      expect(counts()).toEqual(EMPTY);
      expect((await api.installPack(PACK)).status).toBe("complete");
      expect(counts()).toEqual(FULL);
    });

    it("fails an anomaly alert instead of creating it", async () => {
      const record = await packs().installPack({ ...PACK, alerts: ["k8s/anomaly"] });

      expect(record.status).toBe("incomplete");
      expect(fake.state.alerts).toEqual([]);
    });

    it("joins a concurrent install of the same pack", async () => {
      const api = packs();
      const [left, right] = await Promise.all([api.installPack(PACK), api.installPack(PACK)]);

      expect(left).toBe(right);
      expect(counts()).toEqual(FULL);
    });
  });

  describe("undoPack and removePack", () => {
    it("removes exactly the unchanged items and lists the rest", async () => {
      const api = packs();
      const record = await api.installPack(PACK);
      fake.state.alerts[0].description = "edited";

      const result = await api.undoPack(PACK, record.installId);

      expect(result.kept).toEqual(
        expect.arrayContaining([
          { kind: "alert", itemId: "k8s/one", reason: "changed" },
          { kind: "folder", itemId: "alerts", reason: "not_empty" },
        ]),
      );
      expect(result.kept).toHaveLength(2);
      expect(fake.state.alerts.map((a) => a.name)).toEqual(["k8s/one"]);
      expect(counts()).toEqual({ ...EMPTY, alerts: 1, alertFolders: 1 });
    });

    it("keeps the folder when a user item lives in it", async () => {
      const api = packs();
      const record = await api.installPack(PACK);
      fake.state.dashboards.push({
        dashboard_id: "mine",
        title: "Mine",
        folder_id: fake.state.folders.dashboards[0].folderId,
        body: {},
      });

      const result = await api.undoPack(PACK, record.installId);

      expect(result.kept).toEqual([{ kind: "folder", itemId: "dashboards", reason: "not_empty" }]);
      expect(fake.state.dashboards.map((d) => d.dashboard_id)).toEqual(["mine"]);
      expect(fake.state.folders.alerts).toEqual([]);
    });

    it("drops the record once nothing is left", async () => {
      const api = packs();
      const record = await api.installPack(PACK);

      const result = await api.undoPack(PACK, record.installId);

      expect(result.kept).toEqual([]);
      expect(result.removed).toHaveLength(6);
      expect(counts()).toEqual(EMPTY);
      expect(fake.state.kv.size).toBe(0);
    });

    it("treats an item that is already gone as removed", async () => {
      const api = packs();
      const record = await api.installPack(PACK);
      fake.state.views = [];

      const result = await api.undoPack(PACK, record.installId);

      expect(result.kept).toEqual([]);
      expect(fake.state.kv.size).toBe(0);
    });

    it("never touches items that predate the install", async () => {
      const api = packs();
      await api.installPack(PACK);
      const second = await api.installPack(PACK);

      const result = await api.undoPack(PACK, second.installId);

      expect(result).toEqual({ removed: [], kept: [] });
      expect(counts()).toEqual(FULL);
    });

    it("reports a failed delete as kept", async () => {
      const api = packs();
      const record = await api.installPack(PACK);
      fake.state.faults.push({ method: "delete", url: /\/savedviews\// });

      const result = await api.undoPack(PACK, record.installId);

      expect(result.kept).toEqual([
        { kind: "savedView", itemId: "events", reason: "delete_failed" },
      ]);
      expect(fake.state.views).toHaveLength(1);
      await flushPromises();
    });

    it("keeps an alert a failed install left unrecorded", async () => {
      const api = packs();
      const record = await api.installPack(PACK);
      const failed = await api.undoPack(PACK, "missing");
      expect(failed).toEqual({ removed: [], kept: [] });

      const stored = JSON.parse([...fake.state.kv.values()][0]);
      stored.items.find((i: { itemId: string }) => i.itemId === "k8s/two").id = undefined;
      fake.state.kv.set([...fake.state.kv.keys()][0], JSON.stringify(stored));

      const result = await api.undoPack(PACK, record.installId);

      expect(result.kept).toContainEqual({
        kind: "alert",
        itemId: "k8s/two",
        reason: "unrecorded",
      });
    });

    it("does not report never-created items as removed", async () => {
      const api = packs();
      fake.state.faults.push({ method: "post", url: /\/folders\/dashboards/ });
      const record = await api.installPack(PACK);

      const result = await api.undoPack(PACK, record.installId);

      expect(result).toEqual({ removed: [], kept: [] });
      expect(fake.state.kv.size).toBe(0);
    });

    it("skips foreign and corrupt values under the record prefix", async () => {
      const api = packs();
      fake.state.kv.set("starter_pack.kubernetes.bad", "{not json");
      fake.state.kv.set("starter_pack.kubernetes.other", '{"a":1}');
      fake.state.kv.set("starterXpack.kubernetes.like", "{}");

      const record = await api.installPack(PACK);

      expect(record.status).toBe("complete");
      expect(await api.listInstalls(PACK.id)).toHaveLength(1);
    });

    it("removePack reports a tagged alert no record accounts for", async () => {
      const api = packs();
      await api.installPack(PACK);
      fake.state.kv.clear();

      const result = await api.removePack(PACK);

      expect(result.kept).toEqual(
        PACK.alerts.map((itemId) => ({ kind: "alert", itemId, reason: "unrecorded" })),
      );
      expect(fake.state.alerts).toHaveLength(2);
    });

    it("removePack walks every install of the pack", async () => {
      const api = packs();
      await api.installPack(PACK);
      await api.installPack(PACK);

      const result = await api.removePack(PACK);

      expect(result.kept).toEqual([]);
      expect(counts()).toEqual(EMPTY);
      expect(fake.state.kv.size).toBe(0);
    });
  });
});
