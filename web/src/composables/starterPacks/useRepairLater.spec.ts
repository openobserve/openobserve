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

import type { PackInstallRecord } from "./types";

const MIN = 60 * 1_000_000;
const fake = vi.hoisted(() => ({
  records: [] as any[],
  alertSaveFails: false,
  dashboard: null as any,
  alert: null as any,
  saved: [] as any[],
  stats: {} as Record<string, any[]>,
  columns: {} as Record<string, string[]>,
}));

vi.mock("@/constants/starterPacks", () => ({ STARTER_PACKS_ENABLED: true }));
vi.mock("@tanstack/vue-query", () => ({
  useMutation: () => ({
    mutateAsync: async ({ payload }: any) => {
      if (fake.alertSaveFails) throw new Error("save failed");
      fake.alert = JSON.parse(JSON.stringify(payload));
    },
  }),
}));
vi.mock("@/services/alerts.queries", () => ({
  alertDetailQuery: (_org: string, id: string) => ({ kind: "alert", id }),
  saveAlertMutation: () => ({}),
}));
vi.mock("@/services/dashboards.queries", () => ({
  dashboardDetailQuery: (_org: string, id: string) => ({ kind: "dashboard", id }),
}));
vi.mock("@/services/stream.queries", () => ({
  streamNameListQuery: (_org: string, type: string) => ({ kind: "streams", type }),
}));
vi.mock("@/services/dashboards", () => ({
  default: {
    save: async (_org: string, _id: string, body: any) => {
      fake.saved.push(body);
      fake.dashboard = JSON.parse(JSON.stringify(body));
    },
  },
}));
vi.mock("@/composables/query/readQuery", () => ({
  readQuery: async (query: any) => {
    if (query.kind === "dashboard") return { version: 8, hash: "h", v8: fake.dashboard };
    if (query.kind === "alert") return fake.alert;
    return fake.stats[query.type] ?? [];
  },
}));
vi.mock("./packMatchData", () => ({
  readSchemaColumns: async (_org: string, _type: string, name: string) => fake.columns[name] ?? [],
}));
vi.mock("./useRewriteChecks", () => ({
  useRewriteChecks: () => ({ sql: async () => {}, promql: async () => ({}) }),
}));
vi.mock("./useInstallRecords", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("./useInstallRecords");
  return {
    ...actual,
    useInstallRecords: () => ({
      list: async () => fake.records,
      write: async (record: PackInstallRecord) => {
        fake.records = [JSON.parse(JSON.stringify(record))];
      },
    }),
  };
});

import { panelHash } from "./repairLater";
import { alertBody, dashboardBody } from "./useStarterPacks";
import { contentHash } from "./useInstallRecords";
import { useRepairLater } from "./useRepairLater";

const panel = (id: string, stream: string, title = id) => ({
  id,
  title,
  type: "line",
  queryType: "sql",
  queries: [{ query: `SELECT count(*) FROM "${stream}"`, fields: { stream } }],
});

const repairer = () => {
  let api!: ReturnType<typeof useRepairLater>;
  mount(
    defineComponent({
      setup() {
        api = useRepairLater("org");
        return () => null;
      },
    }),
  );
  return api;
};

describe("useRepairLater", () => {
  const now = Date.now() * 1000;
  const scope = { dashboardId: "d1" };

  beforeEach(() => {
    const ours = panel("p1", "nginx_logs");
    const mine = panel("p2", "nginx_logs");
    fake.dashboard = { title: "Nginx", tabs: [{ tabId: "t", panels: [ours, mine] }] };
    fake.alert = { id: "a1", name: "5xx", stream_name: "nginx_logs", stream_type: "logs" };
    fake.alert.query_condition = { type: "sql", sql: 'SELECT count(*) FROM "nginx_logs"' };
    const panelHashes = { p1: panelHash(ours), p2: panelHash(mine) };
    fake.dashboard.tabs[0].panels[1] = panel("p2", "nginx_logs", "Edited by me");
    const dashboardHash = contentHash(dashboardBody({ version: 8, v8: fake.dashboard }));
    fake.records = [
      {
        packId: "kubernetes",
        installId: "i1",
        status: "complete",
        items: [
          { kind: "dashboard", itemId: "overview", status: "created", id: "d1", panelHashes },
          {
            kind: "alert",
            itemId: "k8s/one",
            status: "created",
            id: "a1",
            sourceHash: contentHash(alertBody(fake.alert)),
          },
        ],
      },
    ];
    fake.records[0].items[0].sourceHash = dashboardHash;
    fake.saved = [];
    fake.alertSaveFails = false;
    fake.stats = {
      logs: [
        { name: "nginx_logs", stats: { doc_time_min: 1, doc_time_max: now - 40 * MIN } },
        { name: "edge", stats: { doc_time_min: now - 38 * MIN, doc_time_max: now - MIN } },
      ],
    };
    fake.columns = { nginx_logs: ["_timestamp", "status"], edge: ["_timestamp", "status"] };
  });

  it("repairs a renamed stream from the dashboard and keeps the panel the user changed", async () => {
    const api = repairer();
    await api.check(scope);
    expect(api.issue.value).toMatchObject({ from: "nginx_logs", to: "edge", panels: 1, alerts: 1 });

    expect(await api.apply(scope)).toBe(true);
    const [moved, kept] = fake.dashboard.tabs[0].panels;
    expect(moved.queries[0].fields.stream).toBe("edge");
    expect(kept.title).toBe("Edited by me");
    expect(kept.queries[0].fields.stream).toBe("nginx_logs");
    expect(fake.alert.query_condition.sql).toContain('"edge"');
    expect(api.issue.value).toBeNull();
    expect(api.undoable.value).not.toBeNull();
    expect(fake.records[0].repairs).toEqual([{ from: "nginx_logs", to: "edge" }]);
    expect(fake.records[0].laterRepair.panels).toEqual({ overview: ["p1"] });
  });

  it("undoes the repair within a day", async () => {
    const api = repairer();
    await api.check(scope);
    await api.apply(scope);
    await flushPromises();
    expect(api.undoable.value).not.toBeNull();

    expect(await api.undo(scope)).toBe(true);
    expect(fake.dashboard.tabs[0].panels[0].queries[0].fields.stream).toBe("nginx_logs");
    expect(fake.alert.query_condition.sql).toContain('"nginx_logs"');
    expect(fake.records[0].repairs).toEqual([]);
    expect(fake.records[0].laterRepair).toBeUndefined();
  });

  it("keeps Undo for the dashboard when a later alert save fails", async () => {
    fake.alertSaveFails = true;
    const api = repairer();
    await api.check(scope);
    expect(await api.apply(scope)).toBe(false);
    expect(fake.dashboard.tabs[0].panels[0].queries[0].fields.stream).toBe("edge");
    expect(fake.records[0].laterRepair.panels).toEqual({ overview: ["p1"] });
    expect(fake.records[0].laterRepair.alerts).toEqual([]);
  });

  it("retries after a partial failure and one Undo restores both runs", async () => {
    fake.alertSaveFails = true;
    const api = repairer();
    await api.check(scope);
    expect(await api.apply(scope)).toBe(false);
    expect(api.undoable.value).not.toBeNull();
    expect(api.issue.value).toMatchObject({ from: "nginx_logs", to: "edge", panels: 0, alerts: 1 });

    fake.alertSaveFails = false;
    expect(await api.apply(scope)).toBe(true);
    expect(fake.alert.query_condition.sql).toContain('"edge"');
    expect(fake.records[0].laterRepair).toMatchObject({
      panels: { overview: ["p1"] },
      alerts: ["k8s/one"],
      repairsBefore: [],
    });

    expect(await api.undo(scope)).toBe(true);
    expect(fake.dashboard.tabs[0].panels[0].queries[0].fields.stream).toBe("nginx_logs");
    expect(fake.alert.query_condition.sql).toContain('"nginx_logs"');
    expect(fake.records[0].repairs).toEqual([]);
  });

  it("offers nothing when every affected panel was changed and no alert reads the stream", async () => {
    fake.records[0].items[0].panelHashes = {};
    fake.records[0].items.pop();
    const api = repairer();
    await api.check(scope);
    expect(api.issue.value).toBeNull();
  });

  it("offers nothing when no stream with the same fields started", async () => {
    fake.columns.edge = ["_timestamp", "other"];
    const api = repairer();
    await api.check(scope);
    expect(api.issue.value).toBeNull();
  });
});
