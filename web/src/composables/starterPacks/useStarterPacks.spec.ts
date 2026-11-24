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

import type { PackStreamRole, StarterPack } from "./types";
import {
  leftOutIds,
  StarterPackBusyError,
  StarterPackPermissionError,
  StarterPackStaleError,
} from "./types";
import { catalogVersion, packById } from "./usePackCatalog";
import { UNDO_WINDOW_US } from "./useStarterPackFlow";
import { loadCatalogFixture } from "@/test/unit/helpers/starterPacksCatalog";

const library = vi.hoisted(() => ({
  down: false,
  livePromql: false,
  lastIngested: 0,
  onlyType: "",
  version: "",
  description: "d1",
  threshold: 3,
  schemas: {} as Record<string, string[]>,
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
    onRequest: null as null | ((method: string, url: string, body: any) => void),
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
      if (library.onlyType && !url.includes(`type=${library.onlyType}`)) {
        return reply({ list: [], schema: [] });
      }
      const type = url.match(/type=(\w+)/)?.[1] ?? "";
      const schema = (library.schemas[type] ?? ["value"]).map((name) => ({ name }));
      return reply({ list: [{ name: "kube_present", stats }], schema });
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
      if (method === "get" && match[2]) {
        const folder = list.find((row) => row.folderId === match![2]);
        if (!folder) throw httpError(404);
        return reply(folder);
      }
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
        const dashboardId = nextId("d");
        state.dashboards.push({
          dashboard_id: dashboardId,
          title: body.title,
          folder_id: folderParam(url),
          body,
        });
        return reply({ version: 8, v8: { dashboardId } });
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
        const view = { ...body, view_id: nextId("v") };
        state.views.push(view);
        return reply({ org_id: "org", view_id: view.view_id, view_name: view.view_name });
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
    state.onRequest?.(method, url, body);
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
    description: `fires for ${id}`,
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
          query_condition: { type: "promql", promql: library.livePromql ? "kube_present" : "s" },
        };
      },
    }),
  };
});

import { contentHash } from "./useInstallRecords";
import { alertBody, useStarterPacks } from "./useStarterPacks";

loadCatalogFixture();

const PACK: StarterPack = {
  id: "kubernetes",
  titleKey: "starterPacks.packs.kubernetes.title",
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
const MINUTE_US = 60_000_000;

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
      onRequest: null,
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

    const withCopies = {
      repairs: [{ from: "s", to: "a", also: ["b"] }],
      copies: [
        { copyOf: "k8s/one", stream: "a" },
        { copyOf: "k8s/one", stream: "b" },
      ],
    };

    it("makes the base alert even when per-stream copies of it already exist", async () => {
      const api = packs();
      const one = { ...PACK, alerts: ["k8s/one"] };
      await api.installPack(one, withCopies);
      const record = await api.installPack(one);
      const base = record.items.find(({ itemId }) => itemId === "k8s/one");
      expect(fake.state.alerts).toHaveLength(3);
      const made = fake.state.alerts.find(({ id }) => id === base?.id);
      expect(made?.tags.some((tag: string) => tag.startsWith("stream:"))).toBe(false);
    });

    it("reports each kept per-stream copy once on Remove", async () => {
      const api = packs();
      const one = { ...PACK, alerts: ["k8s/one"] };
      await api.installPack(one, withCopies);
      for (const alert of fake.state.alerts) alert.description = "edited";

      const result = await api.removePack(one);

      const alerts = result.kept.filter(({ kind }) => kind === "alert");
      expect(alerts.map(({ itemId }) => itemId).sort()).toEqual(["k8s/one@a", "k8s/one@b"]);
    });

    it("names a Use all copy so the server accepts it whatever the stream is called", async () => {
      await packs().installPack(
        { ...PACK, alerts: ["k8s/one"] },
        {
          repairs: [{ from: "s", to: "a:b c/d", also: ["e"] }],
          copies: [{ copyOf: "k8s/one", stream: "a:b c/d" }],
        },
      );

      const [name] = fake.state.alerts.map((alert) => alert.name);
      expect(name).toBe("k8s/one_a_b_c_d");
      expect(name.slice("k8s/one_".length)).toMatch(/^[^:#?\s'"%&/]+$/);
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

  it("marks an alert failed, not skipped, when the check is down", async () => {
    fake.state.parseFails = 503;
    const record = await packs().installPack(PACK, { repairs: [{ from: "s", to: "r" }] });
    expect(record.items.filter(({ status }) => status === "failed")).toHaveLength(2);
    expect(record.status).toBe("incomplete");
  });

  describe("Set up in", () => {
    it("uses the chosen folder and keeps it on the record", async () => {
      const record = await packs().installPack(PACK, { folderName: "Platform" });
      expect(fake.state.folders.alerts[0].name).toBe("Platform");
      expect(record.folderName).toBe("Platform");
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

    it("creates each alert once with the chosen destination, on or off", async () => {
      await packs().installPack(PACK, { enableAlerts: true, destination: "oncall" });
      expect(fake.state.alerts).toHaveLength(2);
      for (const alert of fake.state.alerts) {
        expect(alert.enabled).toBe(true);
        expect(alert.destinations).toEqual(["oncall"]);
      }
      expect(fake.state.calls.filter((c) => c.startsWith("put") && c.includes("/alerts"))).toEqual(
        [],
      );
    });

    it("stores the alert choice on the record so a retry after a reload reuses it", async () => {
      await packs().installPack(PACK, { enableAlerts: true, destination: "oncall" });
      const [value] = [...fake.state.kv.values()];
      expect(JSON.parse(value)).toMatchObject({ enableAlerts: true, destination: "oncall" });
    });

    it("stores why Email me failed on the record, and a resume replaces it", async () => {
      fake.state.faults.push({ method: "post", url: /\/api\/v2\/org\/alerts/ });
      const api = packs();
      await api.installPack(PACK, { emailFailure: "forbidden" });
      expect(JSON.parse([...fake.state.kv.values()][0])).toMatchObject({
        emailFailure: "forbidden",
      });
      const resumed = await api.installPack(PACK, { emailFailure: "email" });
      expect(resumed.emailFailure).toBe("email");
    });

    it("sets the destination on alerts created off", async () => {
      await packs().installPack(PACK, { destination: "oncall" });
      for (const alert of fake.state.alerts) {
        expect(alert.enabled).toBe(false);
        expect(alert.destinations).toEqual(["oncall"]);
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

    it("records a made folder and view by the id their create returned, with no list read", async () => {
      await packs().installPack(PACK);

      const after = (post: RegExp) => {
        const calls = fake.state.calls;
        return calls.slice(calls.findIndex((call) => post.test(call)) + 1);
      };
      const folderLists = after(/^post .*\/folders\/alerts/).filter((call) =>
        /^get .*\/folders\/alerts$/.test(call),
      );
      const viewLists = after(/^post .*\/savedviews/).filter((call) =>
        /^get .*\/savedviews$/.test(call),
      );
      expect(folderLists).toEqual([]);
      const folderReads = fake.state.calls.filter((call) => /^get .*\/folders\/\w+\/./.test(call));
      expect(folderReads).toEqual([]);
      expect(viewLists).toEqual([]);
      const [stored] = [...fake.state.kv.values()].map((value) => JSON.parse(value));
      const idOf = (itemId: string) =>
        stored.items.find((item: { itemId: string }) => item.itemId === itemId).id;
      expect(idOf("alerts")).toBe(fake.state.folders.alerts[0].folderId);
      expect(idOf("events")).toBe(fake.state.views[0].view_id);
    });

    it("stores only ids, kinds, the content hash and status in the record", async () => {
      await packs().installPack(PACK);

      const [value] = [...fake.state.kv.values()];
      const record = JSON.parse(value);
      for (const item of record.items) {
        expect(
          Object.keys(item).every((key) =>
            ["kind", "itemId", "status", "id", "folderId", "sourceHash", "attempted"].includes(key),
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

    describe("an alert already installed from the Alert Library", () => {
      const seedLibraryAlert = (stream = "s") =>
        fake.state.alerts.push({
          id: "lib1",
          name: "k8s/one",
          tags: ["pack:k8s"],
          folder_id: "default",
          stream_name: stream,
          context_attributes: { library_id: "k8s/one", library_hash: "hash-k8s/one" },
        });

      it("plans it as already there and creates no second copy", async () => {
        seedLibraryAlert();
        const api = packs();
        const preview = await api.previewPack(PACK);
        expect(preview.notIncluded).toContainEqual({
          kind: "alert",
          itemId: "k8s/one",
          name: "k8s/one",
          reason: "already_have",
        });

        const record = await api.installPack(PACK);

        const one = record.items.find(({ itemId }) => itemId === "k8s/one");
        expect(one).toMatchObject({ status: "existing", id: "lib1" });
        expect(fake.state.alerts.filter(({ name }) => name === "k8s/one")).toHaveLength(1);
        expect(counts().alerts).toBe(2);
      });

      it("leaves it alone on Undo and Remove", async () => {
        seedLibraryAlert();
        const api = packs();
        const record = await api.installPack(PACK);

        await api.undoPack(PACK, record.installId);
        await api.removePack(PACK);

        expect(fake.state.alerts.map(({ id }) => id)).toEqual(["lib1"]);
      });

      it("matches a per-stream copy only on the same stream", async () => {
        seedLibraryAlert("a");
        const record = await packs().installPack(
          { ...PACK, alerts: ["k8s/one"] },
          {
            repairs: [{ from: "s", to: "a", also: ["b"] }],
            copies: [
              { copyOf: "k8s/one", stream: "a" },
              { copyOf: "k8s/one", stream: "b" },
            ],
          },
        );

        const status = (itemId: string) => record.items.find((item) => item.itemId === itemId);
        expect(status("k8s/one@a")).toMatchObject({ status: "existing", id: "lib1" });
        expect(status("k8s/one@b")?.status).toBe("created");
        expect(fake.state.alerts.map((alert) => alert.stream_name)).toEqual(["a", "b"]);
      });
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

    describe("another install of the same pack at the same time", () => {
      const otherKey = "starter_pack.kubernetes.other";
      const seedOther = (installedAt: number) => {
        const other = {
          packId: "kubernetes",
          installId: "other",
          status: "installing",
          installedAt,
          installedBy: "first@example.com",
          items: [],
        };
        fake.state.onRequest = (method, url) => {
          if (method !== "post" || !url.includes("/kv/") || fake.state.kv.has(otherKey)) return;
          fake.state.kv.set(otherKey, JSON.stringify(other));
        };
      };

      it("keeps the ids its own creates returned when the other's copies match first", async () => {
        fake.state.onRequest = (method, url, body) => {
          if (method !== "post") return;
          const folder_id = new URL(url, "http://x").searchParams.get("folder") ?? "";
          if (url.includes("/api/v2/org/alerts")) {
            fake.state.alerts.unshift({ ...body, id: `other-${body.name}`, folder_id });
          } else if (url.includes("/api/org/dashboards")) {
            fake.state.dashboards.unshift({
              dashboard_id: "other-d",
              title: body.title,
              folder_id,
              body,
            });
          }
        };
        const api = packs();
        const record = await api.installPack(PACK);
        fake.state.onRequest = null;

        const ids = record.items.filter(({ kind }) => kind !== "folder").map(({ id }) => id);
        expect(ids.some((id) => id?.startsWith("other-"))).toBe(false);
        await api.undoPack(PACK, record.installId);
        expect(fake.state.alerts.map(({ id }) => id).sort()).toEqual([
          "other-k8s/one",
          "other-k8s/two",
        ]);
        expect(fake.state.dashboards.map(({ dashboard_id }) => dashboard_id)).toEqual(["other-d"]);
      });

      it("links, never owns, an alert another install made after the plan", async () => {
        fake.state.onRequest = (method, url) => {
          if (method !== "post" || !url.includes("/kv/")) return;
          if (fake.state.alerts.some(({ id }) => id === "theirs")) return;
          const tags = ["pack:kubernetes", "library:k8s/one"];
          fake.state.alerts.push({ id: "theirs", name: "k8s/one", folder_id: "elsewhere", tags });
        };
        const api = packs();
        const record = await api.installPack(PACK);
        fake.state.onRequest = null;

        const one = record.items.find(({ itemId }) => itemId === "k8s/one");
        expect(one).toMatchObject({ id: "theirs", status: "existing" });
        await api.undoPack(PACK, record.installId);
        expect(fake.state.alerts.map(({ id }) => id)).toEqual(["theirs"]);
      });

      it("stops, removes its own record and creates nothing when the other started first", async () => {
        seedOther(1);

        const error = await packs()
          .installPack(PACK)
          .catch((caught) => caught);

        expect(error).toBeInstanceOf(StarterPackBusyError);
        expect(error.installedBy).toBe("first@example.com");
        expect([...fake.state.kv.keys()]).toEqual([otherKey]);
        expect(counts()).toEqual(EMPTY);
      });

      it("stops when the other wrote its record while this one was still planning", async () => {
        let now = 1_000;
        vi.spyOn(Date, "now").mockImplementation(() => (now += 1));
        const other = { packId: "kubernetes", installId: "zz", status: "installing", items: [] };
        fake.state.onRequest = (method, url) => {
          if (method !== "get" || !url.includes("/folders/") || fake.state.kv.has(otherKey)) return;
          const row = {
            ...other,
            installedAt: Date.now() * 1000,
            installedBy: "first@example.com",
          };
          fake.state.kv.set(otherKey, JSON.stringify(row));
        };

        const error = await packs()
          .installPack(PACK)
          .catch((caught) => caught);
        vi.restoreAllMocks();

        expect(error).toBeInstanceOf(StarterPackBusyError);
        expect(counts()).toEqual(EMPTY);
      });

      it("never resumes a setup someone else is still running", async () => {
        const theirs = {
          packId: "kubernetes",
          installId: "other",
          status: "installing",
          installedAt: Date.now() * 1000 - MINUTE_US * 20,
          updatedAt: Date.now() * 1000 - 5_000_000,
          installedBy: "first@example.com",
          items: [],
        };
        fake.state.kv.set(otherKey, JSON.stringify(theirs));

        const error = await packs()
          .installPack(PACK)
          .catch((caught) => caught);

        expect(error).toBeInstanceOf(StarterPackBusyError);
        expect(error.installedBy).toBe("first@example.com");
        expect(JSON.parse(fake.state.kv.get(otherKey)!)).toEqual(theirs);
        expect([...fake.state.kv.keys()]).toEqual([otherKey]);
        expect(counts()).toEqual(EMPTY);
      });

      it("never resumes this user's own setup still running in another tab", async () => {
        const mine = {
          packId: "kubernetes",
          installId: "other",
          status: "installing",
          installedAt: Date.now() * 1000 - 5_000_000,
          installedBy: store.state.userInfo?.email ?? "",
          items: [],
        };
        fake.state.kv.set(otherKey, JSON.stringify(mine));

        const error = await packs()
          .installPack(PACK)
          .catch((caught) => caught);

        expect(error).toBeInstanceOf(StarterPackBusyError);
        expect(JSON.parse(fake.state.kv.get(otherKey)!)).toEqual(mine);
        expect(counts()).toEqual(EMPTY);
      });

      it("carries on when the other started later", async () => {
        seedOther(Number.MAX_SAFE_INTEGER);
        const record = await packs().installPack(PACK);
        expect(record.status).toBe("complete");
        expect(counts()).toEqual(FULL);
      });
    });

    describe("a setup that stopped partway", () => {
      const ago = (us: number) => Date.now() * 1000 - us;
      // An install that failed one alert, then handed to another user and left quiet.
      const stopIt = async (patch: Record<string, unknown> = {}) => {
        const api = packs();
        fake.state.faults.push({ method: "post", url: /\/api\/v2\/org\/alerts/ });
        const first = await api.installPack(PACK);
        const key = [...fake.state.kv.keys()][0];
        const stored = JSON.parse(fake.state.kv.get(key)!);
        const aged = {
          ...stored,
          installedBy: "first@example.com",
          updatedAt: ago(MINUTE_US * 10),
          ...patch,
        };
        fake.state.kv.set(key, JSON.stringify(aged));
        return { api, first, key };
      };

      it("lets another user finish it, keeping its starter", async () => {
        const { api, first, key } = await stopIt();

        const record = await api.installPack(PACK);

        expect(record.installId).toBe(first.installId);
        expect(record.status).toBe("complete");
        expect(record.installedBy).toBe("first@example.com");
        expect(JSON.parse(fake.state.kv.get(key)!).installedBy).toBe("first@example.com");
        expect([...fake.state.kv.keys()]).toEqual([key]);
        expect(counts()).toEqual(FULL);
      });

      it("finishes an older record with no updatedAt once its start is old", async () => {
        const { api, first } = await stopIt({
          status: "installing",
          updatedAt: undefined,
          installedAt: ago(MINUTE_US * 10),
        });

        const record = await api.installPack(PACK);

        expect(record.installId).toBe(first.installId);
        expect(record.status).toBe("complete");
      });

      it("stops a second continuer whose claim was overwritten, creating nothing", async () => {
        const { api, key } = await stopIt();
        const before = counts();
        // The other continuer's claim lands right after this one's write commits.
        fake.state.onRequest = (method, url, body) => {
          if (method !== "post" || !url.includes("/kv/")) return;
          fake.state.onRequest = null;
          const claim = { ...JSON.parse(body as string), runId: "someone-else" };
          queueMicrotask(() => fake.state.kv.set(key, JSON.stringify(claim)));
        };

        const error = await api.installPack(PACK).catch((caught) => caught);

        expect(error).toBeInstanceOf(StarterPackBusyError);
        expect(error.installedBy).toBe("first@example.com");
        expect(counts()).toEqual(before);
        expect(JSON.parse(fake.state.kv.get(key)!).runId).toBe("someone-else");
      });

      it("restarts the Undo window when a setup stopped days ago is finished", async () => {
        const startedAt = ago(MINUTE_US * 60 * 24 * 4);
        const { api, key } = await stopIt({ installedAt: startedAt });
        const before = Date.now() * 1000;

        const record = await api.installPack(PACK);

        expect(record.status).toBe("complete");
        expect(record.installedAt).toBeGreaterThanOrEqual(before);
        expect(JSON.parse(fake.state.kv.get(key)!).installedAt).toBe(record.installedAt);
        expect(record.installedAt! + UNDO_WINDOW_US).toBeGreaterThan(Date.now() * 1000);
      });

      it("reads a setup removed mid-claim as gone, not as busy", async () => {
        const { api, key } = await stopIt();
        // An admin's Undo deletes the record right after this continuer's claim commits.
        fake.state.onRequest = (method, url) => {
          if (method !== "post" || !url.includes("/kv/")) return;
          fake.state.onRequest = null;
          queueMicrotask(() => fake.state.kv.delete(key));
        };

        const error = await api.installPack(PACK).catch((caught) => caught);

        expect(error).toBeInstanceOf(StarterPackStaleError);
        expect(fake.state.kv.has(key)).toBe(false);
      });

      it("refuses to Undo a setup that is still running", async () => {
        const { api, first, key } = await stopIt({ status: "installing", updatedAt: ago(5e6) });
        const before = counts();

        const error = await api.undoPack(PACK, first.installId).catch((caught) => caught);

        expect(error).toBeInstanceOf(StarterPackBusyError);
        expect(counts()).toEqual(before);
        expect(fake.state.kv.has(key)).toBe(true);
      });

      it("refuses to Remove the pack while one of its setups is still running", async () => {
        const { api, key } = await stopIt({ status: "installing", updatedAt: ago(5e6) });
        const before = counts();
        const stored = fake.state.kv.get(key);

        const error = await api.removePack(PACK).catch((caught) => caught);

        expect(error).toBeInstanceOf(StarterPackBusyError);
        expect(error.installedBy).toBe("first@example.com");
        expect(counts()).toEqual(before);
        expect(fake.state.kv.get(key)).toBe(stored);
      });

      it("never starts a fresh setup when the one to finish is gone", async () => {
        const { api, first, key } = await stopIt();
        fake.state.kv.set(
          key,
          JSON.stringify({ ...JSON.parse(fake.state.kv.get(key)!), status: "complete" }),
        );
        const before = counts();

        const error = await api
          .installPack(PACK, { resumeOf: first.installId })
          .catch((caught) => caught);

        expect(error).toBeInstanceOf(StarterPackStaleError);
        expect(counts()).toEqual(before);
        expect([...fake.state.kv.keys()]).toEqual([key]);
      });

      it("stops creating once another continuer claims the record mid-run", async () => {
        const { api, key } = await stopIt();
        // Three items left to make: both alerts and the view.
        const stored = JSON.parse(fake.state.kv.get(key)!);
        const reset = (item: { kind: string }) =>
          item.kind === "alert" || item.kind === "savedView"
            ? { kind: item.kind, itemId: (item as { itemId: string }).itemId, status: "pending" }
            : item;
        fake.state.kv.set(key, JSON.stringify({ ...stored, items: stored.items.map(reset) }));
        fake.state.alerts = [];
        fake.state.views = [];
        let writes = 0;
        // The other continuer's claim lands right after this run's first item write.
        fake.state.onRequest = (method, url, body) => {
          if (method !== "post" || !url.includes("/kv/") || (writes += 1) !== 3) return;
          const claim = { ...JSON.parse(body as string), runId: "someone-else" };
          queueMicrotask(() => fake.state.kv.set(key, JSON.stringify(claim)));
        };

        const error = await api.installPack(PACK).catch((caught) => caught);

        expect(error).toBeInstanceOf(StarterPackBusyError);
        expect(fake.state.alerts.length + fake.state.views.length).toBe(1);
        const after = JSON.parse(fake.state.kv.get(key)!);
        expect(after.runId).toBe("someone-else");
        expect(after.status).toBe("installing");
      });

      it("links, never owns, a saved view of its name it never tried to make", async () => {
        const api = packs();
        const first = await api.installPack(PACK);
        const key = [...fake.state.kv.keys()][0];
        const stored = JSON.parse(fake.state.kv.get(key)!);
        const reset = (item: { kind: string; itemId: string }) =>
          item.kind === "savedView"
            ? { kind: item.kind, itemId: item.itemId, status: "pending" }
            : item;
        const stopped = { status: "incomplete", updatedAt: ago(MINUTE_US * 10) };
        fake.state.kv.set(
          key,
          JSON.stringify({ ...stored, ...stopped, items: stored.items.map(reset) }),
        );

        const record = await api.installPack(PACK);
        await api.undoPack(PACK, first.installId);

        const view = record.items.find(({ kind }) => kind === "savedView");
        expect(view).toMatchObject({ status: "existing" });
        expect(fake.state.views).toHaveLength(1);
      });

      it("finds a view it made by id on a resume, even renamed by hand", async () => {
        const api = packs();
        fake.state.faults.push({ method: "get", url: /\/savedviews\/.+/ });
        const first = await api.installPack(PACK);
        expect(first.status).toBe("incomplete");
        const madeView = first.items.find(({ kind }) => kind === "savedView");
        expect(madeView).toMatchObject({ status: "failed", id: fake.state.views[0].view_id });
        fake.state.views[0].view_name = "Renamed";

        const record = await api.installPack(PACK);

        expect(record.status).toBe("complete");
        expect(counts()).toEqual(FULL);
        const view = record.items.find(({ kind }) => kind === "savedView");
        expect(view).toMatchObject({ status: "created", id: fake.state.views[0].view_id });
        await api.undoPack(PACK, first.installId);
        expect(counts()).toEqual(EMPTY);
      });

      it("ends the run, creating nothing, when the attempt cannot be written", async () => {
        let failed = false;
        fake.state.onRequest = (method, url, body) => {
          if (failed || method !== "post" || !url.includes("/kv/")) return;
          const items: Array<{ attempted?: boolean }> = JSON.parse(body as string).items;
          if (!items.some((item) => item.attempted)) return;
          failed = true;
          fake.state.faults.unshift({ method: "post", url: /\/kv\//, status: 500 });
        };

        await expect(packs().installPack(PACK)).rejects.toThrow();

        const [stored] = [...fake.state.kv.values()].map((value) => JSON.parse(value));
        expect(stored.items.some((item: { attempted?: boolean }) => item.attempted)).toBe(false);
        expect(counts()).toEqual(EMPTY);
      });

      it("marks an item attempted in the record before creating it", async () => {
        let marked: boolean | undefined;
        fake.state.onRequest = (method, url) => {
          if (method !== "post" || !url.includes("/savedviews")) return;
          const stored = JSON.parse([...fake.state.kv.values()][0]);
          const view = stored.items.find(({ itemId }: { itemId: string }) => itemId === "events");
          marked = view?.attempted;
        };

        await packs().installPack(PACK);

        expect(marked).toBe(true);
      });

      it("lets Undo remove what another user's stopped setup created, and its record", async () => {
        const { api, first } = await stopIt({ status: "incomplete" });
        expect(counts()).not.toEqual(EMPTY);

        const result = await api.undoPack(PACK, first.installId);

        expect(result.kept).toEqual([]);
        expect(counts()).toEqual(EMPTY);
        expect(fake.state.kv.size).toBe(0);
      });
    });

    it("advances updatedAt on every record write of a run", async () => {
      let now = 1_000_000;
      vi.spyOn(Date, "now").mockImplementation(() => (now += 1));
      const stamps: number[] = [];
      fake.state.onRequest = (method, url, body) => {
        if (method === "post" && url.includes("/kv/")) {
          stamps.push(JSON.parse(body as string).updatedAt);
        }
      };

      await packs().installPack(PACK);
      vi.restoreAllMocks();

      expect(stamps.length).toBeGreaterThan(2);
      for (let index = 1; index < stamps.length; index += 1) {
        expect(stamps[index]).toBeGreaterThan(stamps[index - 1]);
      }
      expect(stamps.every((stamp) => typeof stamp === "number")).toBe(true);
    });

    it("joins a concurrent install of the same pack", async () => {
      const api = packs();
      const [left, right] = await Promise.all([api.installPack(PACK), api.installPack(PACK)]);

      expect(left).toBe(right);
      expect(counts()).toEqual(FULL);
    });
  });

  describe("previewPack", () => {
    it("leaves out an alert the shared matcher rejects", async () => {
      library.livePromql = true;
      const stale = (Date.now() - 3 * 24 * 60 * 60 * 1000) * 1000;
      const reasons = async (lastIngested: number) => {
        library.lastIngested = lastIngested;
        const { notIncluded } = await packs().previewPack(PACK);
        return notIncluded.map(({ itemId }) => itemId);
      };
      const [live, old, never] = [
        await reasons(Date.now() * 1000),
        await reasons(stale),
        await reasons(0),
      ];
      library.livePromql = false;
      library.lastIngested = 0;
      expect(live).not.toContain("k8s/one");
      expect(old).not.toContain("k8s/one");
      expect(never).toContain("k8s/one");
    });

    it("takes a flavour whose data is days old", async () => {
      library.lastIngested = (Date.now() - 3 * 24 * 60 * 60 * 1000) * 1000;
      const preview = await packs().previewPack({
        ...PACK,
        alerts: ["k8s/two"],
        flavours: [
          {
            id: "otel",
            titleKey: "starterPacks.packs.kubernetes.title",
            detect: ["kube_present"],
            alerts: { "k8s/two": { promql: "kube_present", streams: ["kube_present"] } },
          },
        ],
      });
      library.lastIngested = 0;
      expect(preview.flavours).toEqual({ "k8s/two": "otel" });
    });

    it("takes a flavour's query when its data is here, and says when none exists", async () => {
      library.lastIngested = Date.now() * 1000;
      const preview = await packs().previewPack({
        ...PACK,
        alerts: ["k8s/two", "k8s/one"],
        flavours: [
          {
            id: "otel",
            titleKey: "starterPacks.packs.kubernetes.title",
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
        titleKey: "starterPacks.packs.kubernetes.title",
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
      library.livePromql = false;
      const preview = await api.previewPack({
        ...PACK,
        alerts: ["k8s/two"],
        savedViews: [],
        dashboards: [],
        flavours: [],
      });
      expect(preview.notIncluded.filter(({ itemId }) => itemId === "k8s/two")).toHaveLength(1);
    });

    it("keeps each alert's Library severity and description, and the dashboard's own description", async () => {
      const preview = await packs().previewPack({
        ...PACK,
        dashboards: [
          {
            id: "overview",
            title: "Overview",
            load: async () => ({ version: 8, description: "Pods and nodes", tabs: [] }),
          },
        ],
      });
      expect(preview.severities).toEqual({ "k8s/one": "warning", "k8s/two": "warning" });
      expect(preview.descriptions).toEqual({
        overview: "Pods and nodes",
        "k8s/one": "fires for k8s/one",
        "k8s/two": "fires for k8s/two",
      });
    });

    it("names items and gives a reason for each one left out, creating nothing", async () => {
      fake.state.views.push({ view_id: "v9", view_name: "Events", data: {}, view_type: "logs" });
      library.livePromql = true;
      library.lastIngested = Date.now() * 1000;
      const preview = await packs().previewPack({
        ...PACK,
        alerts: ["k8s/one", "k8s/two", "k8s/lost"],
      });
      library.livePromql = false;
      library.lastIngested = 0;
      expect(preview.names["k8s/one"]).toBe("k8s/one");
      expect(preview.notIncluded.map(({ itemId, reason }) => [itemId, reason])).toEqual([
        ["k8s/two", "no_data"],
        ["k8s/lost", "unavailable"],
        ["events", "already_have"],
      ]);
      expect(counts()).toEqual({ ...EMPTY, views: 1 });
    });

    describe("a saved view whose stream is missing", () => {
      const EVENTS_PACK: StarterPack = {
        ...PACK,
        alerts: [],
        dashboards: [],
        savedViews: [
          {
            id: "events",
            name: "Events",
            search: { meta: {}, data: { stream: { selectedStream: ["k8s_events"] }, query: "" } },
          },
        ],
      };
      const role = (fields: string[]): PackStreamRole => ({
        id: "events",
        titleKey: "starterPacks.packs.kubernetes.title",
        stream: "k8s_events",
        fields,
        identity: [{ field: "service_name", pattern: "^k8s-events$" }],
      });
      const viewOf = (preview: Awaited<ReturnType<ReturnType<typeof packs>["previewPack"]>>) => ({
        included: preview.items.some(({ itemId }) => itemId === "events"),
        left: preview.notIncluded.find(({ itemId }) => itemId === "events")?.reason,
      });

      beforeEach(() => {
        library.lastIngested = (Date.now() - 3 * 24 * 60 * 60 * 1000) * 1000;
      });
      afterEach(() => {
        library.lastIngested = 0;
      });

      it("leaves out the view when k8s_events cannot be found, and install skips it", async () => {
        const api = packs();
        const preview = await api.previewPack(EVENTS_PACK);
        expect(viewOf(preview)).toEqual({ included: false, left: "no_data" });
        const pack = { ...EVENTS_PACK, roles: [role(["missing_field"])] };
        expect(viewOf(await api.previewPack(pack))).toEqual({ included: false, left: "no_data" });
        await api.installPack(EVENTS_PACK, {
          exclude: preview.notIncluded.map((row) => row.itemId),
        });
        expect(fake.state.views).toEqual([]);
      });

      it("leaves the view out while its stream question is open, and brings it back once chosen", async () => {
        const api = packs();
        const pack = { ...EVENTS_PACK, roles: [role(["value"])] };
        const open = await api.previewPack(pack);
        expect(open.questions[0]).toMatchObject({ want: "k8s_events", answer: undefined });
        expect(viewOf(open)).toEqual({ included: false, left: "no_data" });
        await api.installPack(pack, { exclude: leftOutIds(open), repairs: open.repairs });
        expect(fake.state.views).toEqual([]);
        const choices = { streams: { k8s_events: { to: "kube_present" } }, fields: {} };
        const chosen = await api.previewPack(pack, choices);
        expect(viewOf(chosen)).toEqual({ included: true, left: undefined });
        await api.installPack(pack, { exclude: leftOutIds(chosen), repairs: chosen.repairs });
        expect(JSON.stringify(fake.state.views[0])).toContain("kube_present");
      });

      it("finds the view's stream under the stream type it declares", async () => {
        const traces: StarterPack = {
          ...EVENTS_PACK,
          savedViews: [
            {
              id: "events",
              name: "Events",
              search: {
                meta: {},
                data: { stream: { streamType: "traces", selectedStream: ["kube_present"] } },
              },
            },
          ],
        };
        library.onlyType = "traces";
        const preview = await packs().previewPack(traces);
        library.onlyType = "";
        expect(viewOf(preview)).toEqual({ included: true, left: undefined });
      });
    });

    it("records the catalog version the install came from", async () => {
      const record = await packs().installPack(PACK);
      expect(record.catalogVersion).toBe(catalogVersion());
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

    it("leaves out a dashboard that cannot load and installs the rest", async () => {
      const lost: StarterPack = {
        ...PACK,
        alerts: [],
        bundledAlerts: BUNDLED_PACK.bundledAlerts,
        dashboards: [
          ...PACK.dashboards,
          {
            id: "gallery",
            title: "Gallery",
            load: async () => {
              throw new Error("gallery 404");
            },
          },
        ],
      };
      const api = packs();
      const preview = await api.previewPack(lost);
      expect(preview.notIncluded).toContainEqual(
        expect.objectContaining({ kind: "dashboard", itemId: "gallery", reason: "unavailable" }),
      );
      expect(preview.items.some(({ itemId }) => itemId === "gallery")).toBe(false);
      const record = await api.installPack(lost, { exclude: leftOutIds(preview) });
      expect(record.status).toBe("complete");
      expect(fake.state.dashboards.map(({ body }: any) => body.title)).toEqual(["Overview"]);
    });

    it("keeps a panel that reads a traces stream", async () => {
      const tracesPack: StarterPack = {
        ...PACK,
        alerts: [],
        bundledAlerts: BUNDLED_PACK.bundledAlerts,
        dashboards: [
          {
            id: "apm",
            title: "APM",
            load: async () => ({
              version: 8,
              tabs: [
                {
                  tabId: "t",
                  panels: [
                    {
                      title: "Spans",
                      queryType: "sql",
                      layout: { x: 0, y: 0, w: 4, h: 4 },
                      queries: [{ query: 'SELECT count(*) FROM "kube_present"' }],
                    },
                  ],
                },
              ],
            }),
          },
        ],
      };
      library.onlyType = "traces";
      try {
        const api = packs();
        expect((await api.previewPack(tracesPack)).panels).toEqual({ kept: 1, dropped: 0 });
        await api.installPack(tracesPack);
      } finally {
        library.onlyType = "";
      }
      expect(fake.state.dashboards[0].body.tabs[0].panels.map((p: any) => p.title)).toEqual([
        "Spans",
      ]);
    });

    it("reads a logs stream's schema when traces has a stream of the same name", async () => {
      const logsPack: StarterPack = {
        ...PACK,
        alerts: [],
        bundledAlerts: BUNDLED_PACK.bundledAlerts,
        dashboards: [
          {
            id: "events",
            title: "Events",
            load: async () => ({
              version: 8,
              tabs: [
                {
                  tabId: "t",
                  panels: [
                    {
                      title: "By host",
                      queryType: "sql",
                      layout: { x: 0, y: 0, w: 4, h: 4 },
                      queries: [{ query: 'SELECT host FROM "kube_present"' }],
                    },
                  ],
                },
              ],
            }),
          },
        ],
      };
      library.schemas = { logs: ["value", "host"], traces: ["value"], metrics: ["value"] };
      try {
        expect((await packs().previewPack(logsPack)).panels).toEqual({ kept: 1, dropped: 0 });
      } finally {
        library.schemas = {};
      }
    });

    it("still fails a pack with no bundled copy", async () => {
      await expect(packs().previewPack(PACK)).rejects.toThrow("library down");
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

    const pointRecordAt = (itemId: string, patch: Record<string, unknown>) => {
      const key = [...fake.state.kv.keys()][0];
      const stored = JSON.parse(fake.state.kv.get(key)!);
      Object.assign(
        stored.items.find((item: { itemId: string }) => item.itemId === itemId),
        patch,
      );
      fake.state.kv.set(key, JSON.stringify(stored));
    };

    it("still lists and undoes a record that carries the older update fields", async () => {
      const api = packs();
      const record = await api.installPack(PACK);
      pointRecordAt("k8s/one", { libraryHash: "h1", base: { description: "x" } });
      pointRecordAt("overview", { panelHashes: { p1: "h2" } });

      expect(await api.listInstalls(PACK.id)).toHaveLength(1);
      const result = await api.undoPack(PACK, record.installId);
      expect(result.kept).toEqual([]);
    });

    it("keeps an alert the record names when it lacks this pack's tags", async () => {
      const api = packs();
      const record = await api.installPack(PACK);
      const victim = { id: "theirs", name: "theirs", folder_id: "default", tags: ["team"] };
      fake.state.alerts.push(victim);
      pointRecordAt("k8s/one", {
        id: "theirs",
        folderId: "default",
        sourceHash: contentHash(alertBody({ ...victim })),
      });

      const result = await api.undoPack(PACK, record.installId);

      expect(fake.state.alerts.map(({ id }) => id)).toContain("theirs");
      expect(result.kept).toContainEqual({ kind: "alert", itemId: "k8s/one", reason: "changed" });
      expect(result.removed.map(({ id }) => id)).not.toContain("theirs");
    });

    it("keeps a dashboard the record names when it is outside the pack's folder", async () => {
      const api = packs();
      const record = await api.installPack(PACK);
      const body = { title: "Theirs", tabs: [] };
      fake.state.dashboards.push({
        dashboard_id: "theirs",
        title: "Theirs",
        folder_id: "default",
        body,
      });
      pointRecordAt("overview", {
        id: "theirs",
        folderId: "default",
        sourceHash: contentHash(body),
      });

      const result = await api.undoPack(PACK, record.installId);

      expect(fake.state.dashboards.map(({ dashboard_id }) => dashboard_id)).toContain("theirs");
      expect(result.kept).toContainEqual({
        kind: "dashboard",
        itemId: "overview",
        reason: "changed",
      });
    });

    it("counts as live an alert created on and left unchanged", async () => {
      const api = packs();
      const pack = { ...PACK, alerts: ["k8s/one"] };
      const record = await api.installPack(pack, { enableAlerts: true });
      const one = record.items.find(({ itemId }) => itemId === "k8s/one")!;

      expect(await api.countLiveAlerts(pack, record, new Set([one.id!]))).toBe(1);
    });

    it("leaves out of the count a live alert it could not read back, as Undo keeps it", async () => {
      const api = packs();
      const pack = { ...PACK, alerts: ["k8s/one"] };
      const record = await api.installPack(pack, { enableAlerts: true });
      const one = record.items.find(({ itemId }) => itemId === "k8s/one")!;
      const detail = new RegExp(`/alerts/${one.id}$`);

      expect(await api.countLiveAlerts(pack, record, new Set([one.id!]))).toBe(1);
      fake.state.faults.push({ method: "get", url: detail, status: 500 });
      expect(await api.countLiveAlerts(pack, record, new Set([one.id!]))).toBe(0);
    });

    it("does not count as live an alert turned on after setup, or one there before it", async () => {
      fake.state.alerts.push({
        id: "pre",
        name: "k8s/two",
        folder_id: "default",
        tags: ["pack:kubernetes", "library:k8s/two"],
        enabled: true,
      });
      const api = packs();
      const record = await api.installPack(PACK);
      const one = record.items.find(({ itemId }) => itemId === "k8s/one")!;
      fake.state.alerts.find(({ id }) => id === one.id)!.enabled = true;

      expect(record.items.find(({ itemId }) => itemId === "k8s/two")?.status).toBe("existing");
      expect(await api.countLiveAlerts(PACK, record, new Set([one.id!, "pre"]))).toBe(0);
    });

    it("keeps a dashboard the catalog no longer lists and still finishes the Undo", async () => {
      const api = packs();
      const record = await api.installPack(PACK);
      pointRecordAt("overview", { itemId: "retired" });

      const result = await api.undoPack(PACK, record.installId);

      expect(result.kept).toEqual([
        { kind: "dashboard", itemId: "retired", reason: "changed" },
        { kind: "folder", itemId: "dashboards", reason: "not_empty" },
      ]);
      const [stored] = await api.listInstalls(PACK.id);
      expect(stored.status).toBe("removed");
      expect(stored.items.map(({ itemId }) => itemId)).toEqual(["dashboards", "retired"]);
      await expect(api.removePack(PACK)).resolves.toBeTruthy();
    });

    it("keeps the setup after a failed delete, and the next Undo sends that delete again", async () => {
      const api = packs();
      const record = await api.installPack(PACK);
      fake.state.faults.push({ method: "delete", url: /\/savedviews\// });

      await api.undoPack(PACK, record.installId);

      const [stored] = await api.listInstalls(PACK.id);
      expect(stored.status).toBe("complete");
      expect(stored.items.map(({ itemId }) => itemId)).toEqual(["events"]);
      const before = fake.state.calls.length;
      const again = await api.undoPack(PACK, record.installId);
      const deletes = fake.state.calls
        .slice(before)
        .filter((call) => call.startsWith("delete") && call.includes("/savedviews/"));
      expect(deletes).toHaveLength(1);
      expect(again.kept).toEqual([]);
      expect(fake.state.kv.size).toBe(0);
    });

    it("reads a stopped setup as set up after an Undo that failed partway", async () => {
      const api = packs();
      fake.state.faults.push({ method: "post", url: /\/api\/v2\/org\/alerts/ });
      const record = await api.installPack(PACK);
      expect(record.status).toBe("incomplete");
      fake.state.faults.push({ method: "delete", url: /\/savedviews\// });

      await api.undoPack(PACK, record.installId);

      const [stored] = await api.listInstalls(PACK.id);
      expect(stored.status).toBe("complete");
      expect(stored.items.map(({ itemId }) => itemId)).toEqual(["events"]);
    });

    it("reads a setup whose run went quiet as set up after an Undo that failed partway", async () => {
      const api = packs();
      const record = await api.installPack(PACK);
      const key = [...fake.state.kv.keys()][0];
      const stale = Date.now() * 1000 - MINUTE_US * 10;
      const stored = JSON.parse(fake.state.kv.get(key)!);
      fake.state.kv.set(key, JSON.stringify({ ...stored, status: "installing", updatedAt: stale }));
      fake.state.faults.push({ method: "delete", url: /\/savedviews\// });

      await api.undoPack(PACK, record.installId);

      const [after] = await api.listInstalls(PACK.id);
      expect(after.status).toBe("complete");
      expect(after.items.map(({ itemId }) => itemId)).toEqual(["events"]);
    });

    it("keeps an undone setup removed when a later Remove fails to delete its folder", async () => {
      const api = packs();
      const record = await api.installPack(PACK);
      const folderId = fake.state.folders.dashboards[0].folderId;
      fake.state.dashboards.push({
        dashboard_id: "mine",
        title: "Mine",
        folder_id: folderId,
        body: {},
      });
      await api.undoPack(PACK, record.installId);
      expect((await api.listInstalls(PACK.id))[0].status).toBe("removed");
      fake.state.dashboards = [];
      fake.state.faults.push({ method: "delete", url: /\/folders\/dashboards\// });

      const result = await api.removePack(PACK);

      expect(result.kept).toContainEqual({
        kind: "folder",
        itemId: "dashboards",
        reason: "delete_failed",
      });
      const [stored] = await api.listInstalls(PACK.id);
      expect(stored.status).toBe("removed");
    });

    it("leaves the setup in place when every delete is refused", async () => {
      const api = packs();
      const record = await api.installPack(PACK);
      for (const url of [/\/savedviews\//, /\/api\/v2\/org\/alerts/, /\/api\/org\/dashboards/]) {
        fake.state.faults.push({ method: "delete", url, status: 403 });
      }
      fake.state.faults.push({ method: "delete", url: /\/api\/v2\/org\/alerts/, status: 403 });

      const result = await api.undoPack(PACK, record.installId);

      expect(result.removed).toEqual([]);
      const [stored] = await api.listInstalls(PACK.id);
      expect(stored.status).toBe("complete");
      expect(counts()).toEqual(FULL);
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

    it("removePack waits for an install of the pack still in flight", async () => {
      const api = packs();
      const install = api.installPack(PACK);
      const result = await api.removePack(PACK);
      await install;

      expect(result.kept).toEqual([]);
      expect(counts()).toEqual(EMPTY);
      expect(fake.state.kv.size).toBe(0);
    });

    it("undoPack waits for an install of the pack still in flight", async () => {
      const api = packs();
      const first = await api.installPack(PACK);
      fake.state.kv.clear();
      fake.state.alerts = [];
      const rerun = api.installPack(PACK);
      const order: string[] = [];
      void rerun.then(() => order.push("install"));
      await api.undoPack(PACK, first.installId).then(() => order.push("undo"));
      expect(order).toEqual(["install", "undo"]);
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
    const HOSTS = { ...packById("hosts")!, alerts: [] };
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
        folderId: "default",
        find: vi.fn(async () => (seen ? { id: "setup-card", folderId: "default" } : null)),
        create: vi.fn(async () => {
          seen = true;
          setupCardImport();
          return null;
        }),
      };
      const [dashboard] = HOSTS.dashboards;
      const pack = { ...HOSTS, dashboards: [{ ...dashboard, shared }] };
      const record = await packs().installPack(pack);
      expect(shared.create).toHaveBeenCalledTimes(1);
      expect(dashboardItem(record)).toMatchObject({ status: "existing", id: "setup-card" });
    });

    it("keeps its own dashboard's id when another install creates one at the same time", async () => {
      fake.state.onRequest = (method, url, body) => {
        if (method !== "post" || !url.includes("/api/org/dashboards")) return;
        fake.state.onRequest = null;
        fake.state.dashboards.unshift({
          dashboard_id: "other-host",
          title: body.title,
          folder_id: "default",
          body,
        });
      };
      const api = packs();
      const record = await api.installPack(HOSTS);

      expect(hostDashboards()).toHaveLength(2);
      expect(dashboardItem(record)).toMatchObject({ status: "created" });
      expect((dashboardItem(record) as { id?: string }).id).not.toBe("other-host");
      await api.undoPack(HOSTS, record.installId);
      expect(hostDashboards().map(({ dashboard_id }) => dashboard_id)).toEqual(["other-host"]);
    });

    it("keeps a Host Metrics dashboard the record names outside the importer's folder", async () => {
      const api = packs();
      const record = await api.installPack(HOSTS);
      const body = { title: HOST_METRICS_DASHBOARD_TITLE, tabs: [] };
      fake.state.dashboards.push({
        dashboard_id: "theirs",
        title: HOST_METRICS_DASHBOARD_TITLE,
        folder_id: "team",
        body,
      });
      const key = [...fake.state.kv.keys()][0];
      const stored = JSON.parse(fake.state.kv.get(key)!);
      Object.assign(dashboardItem(stored)!, {
        id: "theirs",
        folderId: "team",
        sourceHash: contentHash(body),
      });
      fake.state.kv.set(key, JSON.stringify(stored));

      const result = await api.undoPack(HOSTS, record.installId);

      expect(fake.state.dashboards.map(({ dashboard_id }) => dashboard_id)).toContain("theirs");
      expect(result.kept.map(({ reason }) => reason)).toEqual(["changed"]);
    });

    it("owns its own import on a resume when the record shows it tried to make it", async () => {
      const api = packs();
      const first = await api.installPack(HOSTS);
      const key = [...fake.state.kv.keys()][0];
      const stored = JSON.parse(fake.state.kv.get(key)!);
      const { itemId } = dashboardItem(stored) as { itemId: string };
      const items = stored.items.map((item: { kind: string }) =>
        item.kind === "dashboard"
          ? { kind: "dashboard", itemId, status: "pending", attempted: true }
          : item,
      );
      const stopped = { status: "incomplete", updatedAt: Date.now() * 1000 - MINUTE_US * 10 };
      fake.state.kv.set(key, JSON.stringify({ ...stored, ...stopped, items }));

      const record = await api.installPack(HOSTS);

      expect(dashboardItem(record)).toMatchObject({
        status: "created",
        id: hostDashboards()[0].dashboard_id,
      });
      await api.undoPack(HOSTS, first.installId);
      expect(hostDashboards()).toHaveLength(0);
    });

    it("fails, not owns, an import that returns no dashboard id", async () => {
      const shared = {
        folderId: "default",
        find: vi.fn(async () =>
          fake.state.dashboards.length ? { id: "other-host", folderId: "default" } : null,
        ),
        create: vi.fn(async () => {
          fake.state.dashboards.push({
            dashboard_id: "other-host",
            title: HOST_METRICS_DASHBOARD_TITLE,
            folder_id: "default",
            body: { title: HOST_METRICS_DASHBOARD_TITLE },
          });
          return { id: "", folderId: "default" };
        }),
      };
      const [dashboard] = HOSTS.dashboards;
      const pack = { ...HOSTS, dashboards: [{ ...dashboard, shared }] };
      const record = await packs().installPack(pack);
      expect(dashboardItem(record)).toMatchObject({ status: "failed" });
      expect((dashboardItem(record) as { id?: string }).id).toBeUndefined();
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
