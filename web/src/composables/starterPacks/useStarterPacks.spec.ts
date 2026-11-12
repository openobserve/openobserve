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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

import { queryClient } from "@/composables/query/queryClient";
import store from "@/test/unit/helpers/store";

import { HOST_METRICS_DASHBOARD_TITLE } from "@/composables/useHostMetricsDashboard";

import { HOSTS_PACK } from "./hostsPack";
import type { StarterPack } from "./types";
import { StarterPackPermissionError } from "./types";

const library = vi.hoisted(() => ({
  down: false,
  matcher: false,
  lastIngested: 0,
  version: "",
  description: "d1",
  threshold: 3,
}));
vi.mock("@/constants/starterPacks", () => ({
  get STARTER_PACKS_ENABLED() {
    return library.matcher;
  },
}));
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
    tagSearchLag: 0,
    parseFails: 0,
  };
  const reply = (data: unknown) => ({ status: 200, data });
  const httpError = (status: number) => Object.assign(new Error("http"), { response: { status } });
  const nextId = (prefix: string) => `${prefix}${(state.seq += 1)}`;
  const folderParam = (url: string, config?: Row) =>
    config?.params?.folder ?? new URL(url, "http://x").searchParams.get("folder") ?? "";

  const commit = (method: string, url: string, body: any, config?: Row) => {
    let match: RegExpMatchArray | null;
    if (url.includes("/streams")) {
      const stats = { doc_time_max: library.lastIngested };
      return reply({ list: [{ name: "kube_present", stats }], schema: [{ name: "value" }] });
    }
    if (url.endsWith("/parse_tree")) {
      if (state.parseFails) throw httpError(state.parseFails);
      return reply({ data: { type: "selector", name: (body as Row).query, matchers: [] } });
    }
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
        const created = { ...body, id: nextId("a"), folder_id: folderParam(url) };
        state.alerts.push(created);
        return reply({ code: 200, message: "Alert saved", id: created.id, name: created.name });
      }
      if (id) {
        const alert = state.alerts.find((row) => row.id === id);
        if (!alert) throw httpError(404);
        if (method === "delete") state.alerts = state.alerts.filter((row) => row !== alert);
        if (method === "put") Object.assign(alert, JSON.parse(JSON.stringify(body)));
        return reply(method === "get" ? { ...alert, last_triggered_at: state.seq } : {});
      }
      const wanted = config?.params?.tags?.split(",") ?? [];
      if (wanted.length && state.tagSearchLag > 0) {
        state.tagSearchLag -= 1;
        return reply({ list: [] });
      }
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
    required_streams: id === "k8s/two" ? ["kube_absent"] : ["kube_present"],
    content_hash: `hash-${id}`,
  }));
  return {
    ...actual,
    useAlertLibrary: () => ({
      loadManifest: async () => {
        if (library.down) throw new Error("library down");
        const hashed = (entry: (typeof alerts)[number]) => ({
          ...entry,
          content_hash: `${entry.content_hash}${library.version}`,
        });
        return { alerts: alerts.map(hashed) };
      },
      loadAlertFile: async (entry: { id: string }) => {
        if (library.down) throw new Error("library down");
        return {
          name: entry.id,
          stream_name: "s",
          destinations: ["someone"],
          enabled: true,
          description: library.description,
          trigger_condition: { threshold: library.threshold },
          query_condition: { type: "promql", promql: library.matcher ? "kube_present" : "s" },
        };
      },
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
      tagSearchLag: 0,
      parseFails: 0,
    });
  });

  describe("stream repairs", () => {
    const repairs = [{ from: "s", to: "renamed" }];

    it("rewrites the alert before create and records the repair", async () => {
      const record = await packs().installPack(PACK, { repairs });
      expect(fake.state.alerts[0].stream_name).toBe("renamed");
      expect(fake.state.alerts[0].query_condition.promql).toBe("renamed");
      expect(record.repairs).toEqual(repairs);
    });

    it("records bindings and writes one tagged alert copy per Use all stream", async () => {
      const record = await packs().installPack(
        { ...PACK, alerts: ["k8s/one"] },
        {
          repairs: [{ from: "s", to: "a", also: ["b"] }],
          bindings: [{ stream: "a", from: "x", to: "y", tier: "alias" }],
          copies: [
            { copyOf: "k8s/one", stream: "a" },
            { copyOf: "k8s/one", stream: "b" },
          ],
        },
      );
      expect(fake.state.alerts.map((alert) => alert.stream_name)).toEqual(["a", "b"]);
      expect(fake.state.alerts[1].tags).toContain("stream:b");
      expect(record.bindings?.[0].to).toBe("y");
      expect(record.items.filter(({ copyOf }) => copyOf === "k8s/one")).toHaveLength(2);
    });

    it("skips one unticked Use all copy and keeps the other", async () => {
      const record = await packs().installPack(
        { ...PACK, alerts: ["k8s/one"] },
        {
          repairs: [{ from: "s", to: "a", also: ["b"] }],
          copies: [
            { copyOf: "k8s/one", stream: "a" },
            { copyOf: "k8s/one", stream: "b" },
          ],
          exclude: ["k8s/one@b"],
        },
      );
      expect(fake.state.alerts.map((alert) => alert.stream_name)).toEqual(["a"]);
      expect(record.items.filter(({ copyOf }) => copyOf === "k8s/one")).toHaveLength(1);
    });

    it("repoints the saved view at the repaired stream", async () => {
      await packs().installPack(PACK, { repairs: [{ from: "e", to: "renamed" }] });
      expect(JSON.stringify(fake.state.views[0])).toContain("renamed");
    });

    it("skips an alert the rewrite cannot check and finishes the rest", async () => {
      fake.state.parseFails = 400;
      const record = await packs().installPack(PACK, { repairs });
      expect(fake.state.alerts).toHaveLength(0);
      expect(record.items.filter(({ status }) => status === "skipped")).toHaveLength(2);
      expect(record.status).toBe("complete");
    });
  });

  it("keeps editing the other alerts after one recorded alert was deleted", async () => {
    const api = packs();
    const record = await api.installPack(PACK);
    const [gone, kept] = record.items.filter(({ kind }) => kind === "alert");
    fake.state.alerts = fake.state.alerts.filter((alert) => alert.id !== gone.id);
    const work = vi.fn(async () => "done");
    expect(await api.trackAlertEdit(PACK, [gone.id!, kept.id!], work)).toBe("done");
  });

  it("marks an alert failed, not skipped, when the check is down", async () => {
    fake.state.parseFails = 503;
    const record = await packs().installPack(PACK, { repairs: [{ from: "s", to: "r" }] });
    expect(record.items.filter(({ status }) => status === "failed")).toHaveLength(2);
    expect(record.status).toBe("incomplete");
  });

  describe("library updates", () => {
    const pack = { ...PACK, alerts: ["k8s/one"] };

    afterEach(() => Object.assign(library, { version: "", description: "d1", threshold: 3 }));

    it("keeps a user-edited threshold, takes the unchanged field's new value, and reverts", async () => {
      const api = packs();
      const record = await api.installPack(pack);
      const alert = fake.state.alerts[0];
      alert.trigger_condition.threshold = 10;
      Object.assign(library, { version: "-v2", description: "d2", threshold: 5 });

      const updates = await api.checkUpdates(pack, record.installId);
      expect(updates).toHaveLength(1);
      const outcome = (field: string) => updates[0].rows.find((row) => row.field === field);
      expect(outcome("trigger_condition.threshold")).toMatchObject({ yours: 10, outcome: "kept" });
      expect(outcome("description")).toMatchObject({ library: "d2", outcome: "updated" });

      await api.applyUpdates(pack, record.installId, updates);
      expect(alert.trigger_condition.threshold).toBe(10);
      expect(alert.description).toBe("d2");
      expect(alert.context_attributes.library_hash).toBe("hash-k8s/one-v2");
      expect(await api.checkUpdates(pack, record.installId)).toEqual([]);

      await api.revertUpdates(pack, record.installId);
      expect(alert.description).toBe("d1");
      expect(alert.trigger_condition.threshold).toBe(10);
      expect(alert.context_attributes.library_hash).toBe("hash-k8s/one");
    });

    it("keeps edits made between the check and Update", async () => {
      const api = packs();
      const record = await api.installPack(pack);
      Object.assign(library, { version: "-v2", description: "d2", threshold: 5 });
      const updates = await api.checkUpdates(pack, record.installId);
      const alert = fake.state.alerts[0];
      Object.assign(alert, { enabled: true });
      alert.trigger_condition.threshold = 42;

      await api.applyUpdates(pack, record.installId, updates);
      expect(alert.enabled).toBe(true);
      expect(alert.trigger_condition.threshold).toBe(42);
      expect(alert.description).toBe("d2");
    });

    it("keeps Revert for the alerts saved before a later save failed", async () => {
      const api = packs();
      const record = await api.installPack(PACK);
      Object.assign(library, { version: "-v2", description: "d2" });
      const updates = await api.checkUpdates(PACK, record.installId);
      expect(updates).toHaveLength(2);
      const second = record.items.find(({ itemId }) => itemId === updates[1].itemId)!;
      fake.state.faults.push({ method: "put", url: new RegExp(`alerts/${second.id}`) });

      await expect(api.applyUpdates(PACK, record.installId, updates)).rejects.toThrow();
      const stored = JSON.parse([...fake.state.kv.values()][0]);
      const first = stored.items.find(({ itemId }: any) => itemId === updates[0].itemId);
      expect(first.update.fromHash).toBe(`hash-${updates[0].itemId}`);
    });

    it("re-applies the recorded repair to the new version", async () => {
      const api = packs();
      const record = await api.installPack(pack, { repairs: [{ from: "s", to: "renamed" }] });
      Object.assign(library, { version: "-v2", description: "d2" });
      const [update] = await api.checkUpdates(pack, record.installId);
      expect(update.next.stream_name).toBe("renamed");
      expect(update.rows.map(({ field }) => field)).toEqual(["description"]);
    });
  });

  describe("Set up in", () => {
    it("uses the chosen folder and keeps it on the record", async () => {
      const record = await packs().installPack(PACK, { folderName: "Platform" });
      expect(fake.state.folders.alerts[0].name).toBe("Platform");
      expect(record.folderName).toBe("Platform");
    });
  });

  describe("trackAlertEdit", () => {
    it("lets Undo remove an alert the pack itself changed", async () => {
      const api = packs();
      const record = await api.installPack(PACK);
      await api.trackAlertEdit(PACK, [fake.state.alerts[0].id], async () => {
        fake.state.alerts[0].enabled = true;
      });
      const { kept } = await api.undoPack(PACK, record.installId);
      expect(kept).toEqual([]);
      expect(fake.state.alerts).toHaveLength(0);
    });

    it("still detects an edit the user made first", async () => {
      const api = packs();
      const record = await api.installPack(PACK);
      fake.state.alerts[0].description = "mine";
      await api.trackAlertEdit(PACK, [fake.state.alerts[0].id], async () => {
        fake.state.alerts[0].enabled = true;
      });
      const { kept } = await api.undoPack(PACK, record.installId);
      expect(kept.map(({ reason }) => reason)).toContain("changed");
    });
  });

  describe("installPack", () => {
    it("records a saved alert by the id its create returned when the tag search lags", async () => {
      fake.state.tagSearchLag = 100;
      const record = await packs().installPack({ ...PACK, alerts: ["k8s/one"] });
      const alert = record.items.find(({ kind }) => kind === "alert");
      expect(alert).toMatchObject({ status: "created", id: fake.state.alerts[0].id });
      expect(fake.state.alerts).toHaveLength(1);
    });

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

    it("creates the alerts enabled when asked to start them", async () => {
      await packs().installPack(PACK, { enableAlerts: true });
      expect(fake.state.alerts).toHaveLength(2);
      for (const alert of fake.state.alerts) {
        expect(alert.enabled).toBe(true);
        expect(alert.destinations).toEqual([]);
      }
    });

    it("leaves out the items the user unticked", async () => {
      const record = await packs().installPack(PACK, { exclude: ["k8s/two", "events"] });
      expect(fake.state.alerts.map((a) => a.tags.at(-1))).toEqual(["library:k8s/one"]);
      expect(fake.state.views).toHaveLength(0);
      expect(record.items.some(({ itemId }) => itemId === "k8s/two")).toBe(false);
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

    it("stores only ids, kinds, hashes, status and the library's own fields in the record", async () => {
      await packs().installPack(PACK);

      const [value] = [...fake.state.kv.values()];
      const record = JSON.parse(value);
      for (const item of record.items) {
        expect(
          Object.keys(item).every((key) =>
            [
              "kind",
              "itemId",
              "status",
              "id",
              "folderId",
              "sourceHash",
              "libraryHash",
              "base",
              "panelHashes",
            ].includes(key),
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

    it("a resumed install never attempts an item the plan now leaves out", async () => {
      const api = packs();
      fake.state.faults.push({ method: "post", url: /\/api\/v2\/org\/alerts/ });
      expect((await api.installPack(PACK)).status).toBe("incomplete");
      const before = fake.state.calls.length;

      const record = await api.installPack(PACK, { exclude: ["k8s/one"] });

      const posts = fake.state.calls.slice(before).filter((c) => c.includes("/api/v2/org/alerts"));
      expect(posts.filter((c) => c.startsWith("post"))).toEqual([]);
      expect(record.status).toBe("complete");
      expect(record.items.some((item) => item.itemId === "k8s/one")).toBe(false);
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

  describe("previewPack", () => {
    it("leaves out an alert the shared matcher rejects once the constant is on", async () => {
      library.matcher = true;
      const stale = (Date.now() - 25 * 60 * 60 * 1000) * 1000;
      const reasons = async (lastIngested: number) => {
        library.lastIngested = lastIngested;
        const { notIncluded } = await packs().previewPack(PACK);
        return notIncluded.map(({ itemId }) => itemId);
      };
      const [live, old] = [await reasons(Date.now() * 1000), await reasons(stale)];
      library.matcher = false;
      expect(live).not.toContain("k8s/one");
      expect(old).toContain("k8s/one");
    });

    it("takes a flavour's query when its data is here, and says when none exists", async () => {
      library.lastIngested = Date.now() * 1000;
      const preview = await packs().previewPack({
        ...PACK,
        alerts: ["k8s/two", "k8s/one"],
        flavours: [
          {
            id: "otel",
            titleKey: "starterPacks.kubernetes.title",
            detect: ["kube_present"],
            alerts: { "k8s/two": { promql: "kube_present", streams: ["kube_present"] } },
          },
        ],
      });
      library.lastIngested = 0;
      expect(preview.flavours).toEqual({ "k8s/two": "otel" });
      expect(preview.notIncluded.map(({ itemId }) => itemId)).not.toContain("k8s/two");
    });

    it("takes the first usable flavour and does not call the alert unsupported", async () => {
      library.lastIngested = Date.now() * 1000;
      const flavour = {
        titleKey: "starterPacks.kubernetes.title",
        detect: ["kube_present"],
      } as const;
      const usable = { "k8s/two": { promql: "kube_present", streams: ["kube_present"] } };
      const preview = await packs().previewPack({
        ...PACK,
        alerts: ["k8s/two"],
        flavours: [
          { ...flavour, id: "first", alerts: usable },
          { ...flavour, id: "second", alerts: usable },
          { ...flavour, id: "third", alerts: {} },
        ],
      });
      library.lastIngested = 0;
      expect(preview.flavours).toEqual({ "k8s/two": "first" });
      expect(preview.notIncluded.some(({ reason }) => reason === "no_flavour")).toBe(false);
    });

    it("lists a left-out alert once, with its plain title, across Use all copies", async () => {
      const api = packs();
      library.matcher = false;
      const preview = await api.previewPack({
        ...PACK,
        alerts: ["k8s/two"],
        savedViews: [],
        dashboards: [],
        flavours: [],
      });
      expect(preview.notIncluded.filter(({ itemId }) => itemId === "k8s/two")).toHaveLength(1);
    });

    it("names items and gives a reason for each one left out, creating nothing", async () => {
      fake.state.views.push({ view_id: "v9", view_name: "Events", data: {}, view_type: "logs" });
      const preview = await packs().previewPack({
        ...PACK,
        alerts: ["k8s/one", "k8s/two", "k8s/lost"],
      });
      expect(preview.names["k8s/one"]).toBe("k8s/one");
      expect(preview.notIncluded.map(({ itemId, reason }) => [itemId, reason])).toEqual([
        ["k8s/two", "no_data"],
        ["k8s/lost", "unavailable"],
        ["events", "already_have"],
      ]);
      expect(counts()).toEqual({ ...EMPTY, views: 1 });
    });

    it("installs without excluded items, reporting progress and who installed", async () => {
      const seen: number[] = [];
      const record = await packs().installPack(PACK, {
        exclude: ["k8s/two"],
        onProgress: (next) =>
          seen.push(next.items.filter(({ status }) => status === "created").length),
      });
      expect(record.items.some(({ itemId }) => itemId === "k8s/two")).toBe(false);
      expect(fake.state.alerts).toHaveLength(1);
      expect(seen.at(-1)).toBe(record.items.length);
      expect(record.installedAt).toBeGreaterThan(0);
      expect(record.installedBy).toBe(store.state.userInfo?.email ?? "");
    });
  });

  describe("with the Library out of reach", () => {
    const BUNDLED_PACK: StarterPack = {
      ...PACK,
      alerts: ["k8s/one"],
      bundledAlerts: [
        {
          entry: {
            id: "k8s/one",
            title: "One",
            stream_type: "metrics",
            required_streams: ["kube_present"],
          } as any,
          file: { name: "k8s/one", stream_name: "s", trigger_condition: {} },
        },
      ],
    };

    beforeEach(() => {
      library.down = true;
    });
    afterEach(() => {
      library.down = false;
    });

    it("previews and installs from the bundled copy", async () => {
      const api = packs();
      const preview = await api.previewPack(BUNDLED_PACK);
      expect(preview.offline).toBe(true);
      expect(preview.names["k8s/one"]).toBe("One");
      const record = await api.installPack(BUNDLED_PACK);
      expect(record.status).toBe("complete");
      expect(fake.state.alerts).toHaveLength(1);
      expect(fake.state.alerts[0].enabled).toBe(false);
    });

    it("creates the dashboard with only the panels that fit, and leaves out one with none", async () => {
      const panel = (title: string, stream: string) => ({
        title,
        queryType: "sql",
        layout: { x: 0, y: 0, w: 4, h: 4 },
        queries: [{ query: `SELECT count(*) FROM "${stream}"` }],
      });
      const fitting: StarterPack = {
        ...PACK,
        alerts: [],
        bundledAlerts: BUNDLED_PACK.bundledAlerts,
        dashboards: [
          {
            id: "overview",
            title: "Overview",
            load: async () => ({
              version: 8,
              tabs: [{ tabId: "t", panels: [panel("Yes", "kube_present"), panel("No", "gone")] }],
            }),
          },
        ],
      };
      const api = packs();
      expect((await api.previewPack(fitting)).panels).toEqual({ kept: 1, dropped: 1 });
      await api.installPack(fitting);
      expect(fake.state.dashboards[0].body.tabs[0].panels.map((p: any) => p.title)).toEqual([
        "Yes",
      ]);

      const none: StarterPack = {
        ...fitting,
        dashboards: [
          {
            id: "other",
            title: "Other",
            load: async () => ({
              version: 8,
              tabs: [{ tabId: "t", panels: [panel("No", "gone")] }],
            }),
          },
        ],
      };
      expect((await api.previewPack(none)).notIncluded).toContainEqual(
        expect.objectContaining({ itemId: "other", reason: "no_data" }),
      );
    });

    it("still fails a pack with no bundled copy", async () => {
      await expect(packs().previewPack(PACK)).rejects.toThrow("library down");
    });
  });

  describe("appendToInstall and undoItems", () => {
    it("appends new items to the install's own record", async () => {
      const api = packs();
      const first = await api.installPack(PACK, { exclude: ["k8s/one"] });
      const record = await api.appendToInstall(PACK, first.installId, ["k8s/one"]);
      expect(record.installId).toBe(first.installId);
      expect(record.status).toBe("complete");
      expect(record.items.find(({ itemId }) => itemId === "k8s/one")?.status).toBe("created");
      expect(fake.state.alerts).toHaveLength(2);
      expect(fake.state.alerts.every((alert) => alert.enabled === false)).toBe(true);
      expect([...fake.state.kv.keys()]).toHaveLength(1);
    });

    it("leaves an item the record already holds alone", async () => {
      const api = packs();
      const first = await api.installPack(PACK);
      const record = await api.appendToInstall(PACK, first.installId, ["k8s/one"]);
      expect(record.items.filter(({ itemId }) => itemId === "k8s/one")).toHaveLength(1);
      expect(fake.state.alerts).toHaveLength(2);
    });

    it("creates the folder a first Add left out when a later Add needs it", async () => {
      const api = packs();
      const first = await api.installPack(PACK, {
        exclude: ["overview", "events", "dashboards"],
      });
      expect(fake.state.folders.dashboards).toHaveLength(0);
      const record = await api.appendToInstall(PACK, first.installId, ["overview"]);
      expect(fake.state.folders.dashboards).toHaveLength(1);
      expect(fake.state.dashboards).toHaveLength(1);
      expect(record.items.find(({ itemId }) => itemId === "overview")?.status).toBe("created");
    });

    it("runs an append after a running install of the pack, not instead of it", async () => {
      const api = packs();
      const first = await api.installPack(PACK, { exclude: ["k8s/one"] });
      const again = api.installPack(PACK);
      const appended = api.appendToInstall(PACK, first.installId, ["k8s/one"]);
      await again;
      const record = await appended;
      expect(record.installId).toBe(first.installId);
      expect(record.items.some(({ itemId }) => itemId === "k8s/one")).toBe(true);
      expect(fake.state.alerts).toHaveLength(2);
    });

    it("makes again an item the record holds but someone deleted", async () => {
      const api = packs();
      const first = await api.installPack(PACK, { exclude: ["overview", "events"] });
      fake.state.alerts = fake.state.alerts.filter(
        (alert) => !alert.tags.includes("library:k8s/one"),
      );
      const record = await api.appendToInstall(PACK, first.installId, ["k8s/one"]);
      expect(fake.state.alerts).toHaveLength(2);
      expect(record.items.filter(({ itemId }) => itemId === "k8s/one")).toHaveLength(1);
      expect(record.items.find(({ itemId }) => itemId === "k8s/one")?.status).toBe("created");
    });

    it("undoes only the appended items", async () => {
      const api = packs();
      const first = await api.installPack(PACK, { exclude: ["k8s/one"] });
      await api.appendToInstall(PACK, first.installId, ["k8s/one"]);
      const { removed, kept } = await api.undoItems(PACK, first.installId, ["k8s/one"]);
      expect(removed.map(({ itemId }) => itemId)).toEqual(["k8s/one"]);
      expect(kept).toEqual([]);
      expect(fake.state.alerts).toHaveLength(1);
      const stored = JSON.parse(fake.state.kv.values().next().value!);
      expect(stored.items.some(({ itemId }: { itemId: string }) => itemId === "k8s/one")).toBe(
        false,
      );
      expect(stored.items.some(({ itemId }: { itemId: string }) => itemId === "k8s/two")).toBe(
        true,
      );
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

  describe("shared host dashboard", () => {
    const HOSTS = { ...HOSTS_PACK, alerts: [] };
    const hostDashboards = () =>
      fake.state.dashboards.filter((row) => row.title === HOST_METRICS_DASHBOARD_TITLE);
    const dashboardItem = (record: { items: Array<{ kind: string }> }) =>
      record.items.find(({ kind }) => kind === "dashboard");
    const setupCardImport = () =>
      fake.state.dashboards.push({
        dashboard_id: "setup-card",
        title: HOST_METRICS_DASHBOARD_TITLE,
        folder_id: "default",
        body: { title: HOST_METRICS_DASHBOARD_TITLE },
      });

    it("imports through the setup-card importer once and owns what it made", async () => {
      const record = await packs().installPack(HOSTS);
      expect(hostDashboards()).toHaveLength(1);
      expect(hostDashboards()[0].folder_id).toBe("default");
      expect(dashboardItem(record)).toMatchObject({ status: "created", folderId: "default" });
      expect(fake.state.folders.dashboards).toHaveLength(0);
    });

    it("links a dashboard the setup card already imported instead of making another", async () => {
      setupCardImport();
      const record = await packs().installPack(HOSTS);
      expect(hostDashboards()).toHaveLength(1);
      expect(dashboardItem(record)).toMatchObject({ status: "existing", id: "setup-card" });
      expect(
        fake.state.calls.filter((call) => call.startsWith("post /api/org/dashboards")),
      ).toEqual([]);
    });

    it("reuses the first install's dashboard on a second install", async () => {
      const api = packs();
      await api.installPack(HOSTS);
      const second = await api.installPack(HOSTS);
      expect(hostDashboards()).toHaveLength(1);
      expect(dashboardItem(second)?.status).toBe("existing");
      await api.undoPack(HOSTS, second.installId);
      expect(hostDashboards()).toHaveLength(1);
    });

    it("leaves a reused dashboard on Undo and Remove", async () => {
      setupCardImport();
      const api = packs();
      const record = await api.installPack(HOSTS);
      await api.undoPack(HOSTS, record.installId);
      expect(hostDashboards()).toHaveLength(1);
      await api.installPack(HOSTS);
      const result = await api.removePack(HOSTS);
      expect(hostDashboards()).toHaveLength(1);
      expect(result.removed.some(({ kind }) => kind === "dashboard")).toBe(false);
    });

    it("does not own a dashboard the importer reports as already there", async () => {
      let seen = false;
      const shared = {
        find: vi.fn(async () => (seen ? { id: "setup-card", folderId: "default" } : null)),
        create: vi.fn(async () => {
          seen = true;
          setupCardImport();
          return false;
        }),
      };
      const [dashboard] = HOSTS.dashboards;
      const pack = { ...HOSTS, dashboards: [{ ...dashboard, shared }] };
      const record = await packs().installPack(pack);
      expect(shared.create).toHaveBeenCalledTimes(1);
      expect(dashboardItem(record)).toMatchObject({ status: "existing", id: "setup-card" });
    });

    it("links a dashboard the setup card imported after the plan, and never owns it", async () => {
      let imported = false;
      const record = await packs().installPack(HOSTS, {
        onProgress: () => {
          if (!imported) setupCardImport();
          imported = true;
        },
      });
      expect(hostDashboards()).toHaveLength(1);
      expect(dashboardItem(record)).toMatchObject({ status: "existing", id: "setup-card" });
    });
  });
});
