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

import type { AlertLibraryEntry } from "@/types/alertLibrary";

const fake = vi.hoisted(() => ({
  isEnterprise: "false",
  streams: {} as Record<string, Array<Record<string, unknown>>>,
  columns: {} as Record<string, string[]>,
  groups: vi.fn(async () => [] as Array<{ fields: string[] }>),
  files: {} as Record<string, unknown>,
  schemaReads: [] as Array<{ name: string; force: boolean }>,
  failForced: false,
}));

vi.mock("@/constants/starterPacks", () => ({ STARTER_PACKS_ENABLED: true }));
vi.mock("@/aws-exports", () => ({
  default: {
    get isEnterprise() {
      return fake.isEnterprise;
    },
    isCloud: "false",
  },
}));
vi.mock("@/utils/semanticGroupsCache", () => ({ loadSemanticGroups: fake.groups }));
vi.mock("@/composables/query/readQuery", () => ({
  readQuery: async (options: { queryKey: string[] }, force?: boolean) => {
    const [, type, name] = options.queryKey;
    if (name) fake.schemaReads.push({ name, force: !!force });
    if (name && force && fake.failForced) throw new Error("schema read failed");
    if (name) return { schema: (fake.columns[name] ?? []).map((n) => ({ name: n })) };
    return fake.streams[type] ?? [];
  },
}));
vi.mock("@/services/stream.queries", () => ({
  streamNameListQuery: (org: string, type: string) => ({ queryKey: [org, type] }),
  streamSchemaQuery: (org: string, name: string, type: string) => ({
    queryKey: [org, type, name],
  }),
}));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: async (request: any, handlers: any) =>
      handlers.complete(request, {}),
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));
vi.mock("@/composables/alerts/useAlertLibrary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/alerts/useAlertLibrary")>()),
  useAlertLibrary: () => library,
}));
vi.mock("./kubernetesPack", () => ({
  KUBERNETES_PACK: {
    id: "kubernetes",
    alerts: ["k8s/one"],
    dashboards: [] as unknown[],
    aliases: [["k8s_cluster", "k8s_cluster_name"]],
  },
}));

import { KUBERNETES_PACK } from "./kubernetesPack";
import { matchAlerts, matchPack, readOrgStreams } from "./packMatchData";
import { useStarterPackMatcher } from "./useStarterPackMatcher";

const entry = {
  id: "k8s/one",
  stream_type: "metrics",
  required_streams: ["kube_pod"],
} as AlertLibraryEntry;

const library = {
  loadManifest: vi.fn(async () => ({ alerts: [entry] })),
  loadAlertFile: vi.fn(async (item: AlertLibraryEntry) => fake.files[item.id] as any),
};

const recent = () => Date.now() * 1000;
const query = (promql: string) => ({ query_condition: { type: "promql", promql } });

const bannerState = async () => {
  let api!: ReturnType<typeof useStarterPackMatcher>;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useStarterPackMatcher("org");
        return () => null;
      },
    }),
  );
  await api.check();
  await flushPromises();
  const state = api.state.value;
  wrapper.unmount();
  return state;
};

const libraryReady = async () => {
  const streams = await readOrgStreams("org");
  const verdicts = await matchAlerts("org", [entry], streams, {
    loadFile: library.loadAlertFile,
    packs: [KUBERNETES_PACK],
  });
  return verdicts.get(entry.id);
};

const metric = (doc: number | undefined) => ({ name: "kube_pod", stats: { doc_time_max: doc } });

describe("one matcher", () => {
  beforeEach(() => {
    fake.isEnterprise = "false";
    fake.streams = {};
    fake.columns = {};
    fake.files = {};
    fake.schemaReads = [];
    fake.failForced = false;
    KUBERNETES_PACK.alerts = ["k8s/one"];
    KUBERNETES_PACK.dashboards = [];
    fake.groups.mockClear();
    library.loadAlertFile.mockClear();
  });

  it.each([
    ["fits", () => [metric(recent())], ["k8s_cluster", "phase"], "sum by (phase) (kube_pod)"],
    ["alias", () => [metric(recent())], ["k8s_cluster_name"], "sum by (k8s_cluster) (kube_pod)"],
    ["case", () => [metric(recent())], ["phase"], "sum by (PHASE) (KUBE_POD)"],
    ["missing label", () => [metric(recent())], ["phase"], "sum by (verb) (kube_pod)"],
    ["extra metric", () => [metric(recent())], ["phase"], "kube_pod / kube_other"],
    ["stale", () => [metric(recent() - 90_000_000_000)], ["phase"], "kube_pod"],
    ["never ingested", () => [metric(undefined)], ["phase"], "kube_pod"],
    ["no stream", () => [], [], "kube_pod"],
  ])("Library and banner agree: %s", async (_name, rows, columns, promql) => {
    fake.streams = { metrics: rows() };
    fake.columns = { kube_pod: columns };
    fake.files = { "k8s/one": query(promql) };
    const ready = await libraryReady();
    const banner = await bannerState();
    expect(banner === "matched").toBe(ready);
  });

  it("reads only owned, non-sample streams", async () => {
    fake.streams = {
      metrics: [
        metric(recent()),
        { name: "o2_demo_container_cpu_usage_percent", stats: { doc_time_max: recent() } },
        { name: "o2_internal_metric", is_internal: true, stats: { doc_time_max: recent() } },
      ],
      logs: [
        { name: "app", stats: { doc_time_max: recent() } },
        { name: "o2_demo_app_logs", stats: { doc_time_max: recent() } },
        { name: "synthetics_results", stats: { doc_time_max: recent() } },
      ],
    };
    const streams = await readOrgStreams("org");
    expect([...(streams.metrics?.keys() ?? [])]).toEqual(["kube_pod"]);
    expect([...(streams.logs?.keys() ?? [])]).toEqual(["app"]);
  });

  it("counts a stream with no flushed data yet from its creation", async () => {
    fake.streams = {
      metrics: [{ name: "kube_pod", stats: { doc_time_max: 0, created_at: recent() } }],
    };
    fake.columns = { kube_pod: ["phase"] };
    fake.files = { "k8s/one": query("kube_pod") };
    expect(await libraryReady()).toBe(true);
  });

  describe("a pack with a dashboard", () => {
    const panel = (promql: string) => ({ queryType: "promql", queries: [{ query: promql }] });
    const dashboard = (panels: unknown[], load?: () => Promise<unknown>) => ({
      id: "overview",
      title: "Overview",
      load: load ?? (async () => ({ tabs: [{ panels }] })),
    });
    const match = async () =>
      matchPack("org", KUBERNETES_PACK, await readOrgStreams("org"), library as any);

    beforeEach(() => {
      KUBERNETES_PACK.alerts = [];
      fake.streams = { metrics: [metric(recent())] };
      fake.columns = { kube_pod: ["phase"] };
    });

    it.each([
      ["fits", panel("sum by (phase) (kube_pod)"), true],
      ["lacks data", panel("kube_other"), false],
      ["text only", { queries: [{ query: "" }] }, false],
    ])("%s", async (_name, item, expected) => {
      KUBERNETES_PACK.dashboards = [dashboard([item])];
      const result = await match();
      expect(result.dashboards.get("overview")).toBe(expected);
      expect(result.ready).toBe(expected);
      expect((await bannerState()) === "matched").toBe(expected);
    });

    // The forced-read gap is module state, so each test reads at a later time.
    const clock = { at: Date.now(), next: () => (clock.at += 60 * 60 * 1000) };
    afterEach(() => vi.restoreAllMocks());

    it("re-reads a cached schema once when a pack fails on a field", async () => {
      vi.spyOn(Date, "now").mockReturnValue(clock.next());
      KUBERNETES_PACK.dashboards = [dashboard([panel("sum by (late) (kube_pod)")])];
      const result = await match();
      expect(result.ready).toBe(false);
      expect(fake.schemaReads).toContainEqual({ name: "kube_pod", force: true });
    });

    it("does not force the same schema again on the next poll", async () => {
      vi.spyOn(Date, "now").mockReturnValue(clock.next());
      KUBERNETES_PACK.dashboards = [dashboard([panel("sum by (late) (kube_pod)")])];
      await match();
      fake.schemaReads = [];
      await match();
      expect(fake.schemaReads.filter(({ force }) => force)).toEqual([]);
    });

    it("retries a forced read that failed on the next match", async () => {
      vi.spyOn(Date, "now").mockReturnValue(clock.next());
      KUBERNETES_PACK.dashboards = [dashboard([panel("sum by (late) (kube_pod)")])];
      fake.failForced = true;
      await match();
      fake.failForced = false;
      fake.schemaReads = [];
      await match();
      expect(fake.schemaReads).toContainEqual({ name: "kube_pod", force: true });
    });

    it("counts a strict rename as ready, since the installer fixes it", async () => {
      KUBERNETES_PACK.alerts = ["k8s/one"];
      entry.required_streams = ["KUBE_POD"];
      fake.files = { "k8s/one": query("KUBE_POD") };
      KUBERNETES_PACK.dashboards = [];
      const result = await match();
      entry.required_streams = ["kube_pod"];
      expect(result.ready).toBe(true);
    });

    it("reads each schema once and never forces it", async () => {
      KUBERNETES_PACK.alerts = ["k8s/one"];
      fake.files = { "k8s/one": query("kube_pod") };
      KUBERNETES_PACK.dashboards = [dashboard([panel("kube_pod")])];
      await match();
      expect(fake.schemaReads).toEqual([{ name: "kube_pod", force: false }]);
    });

    it("keeps alert verdicts when a dashboard fails, and retries the load", async () => {
      KUBERNETES_PACK.alerts = ["k8s/one"];
      fake.files = { "k8s/one": query("kube_pod") };
      const load = vi
        .fn()
        .mockRejectedValueOnce(new Error("chunk"))
        .mockResolvedValue({ tabs: [{ panels: [panel("kube_pod")] }] });
      KUBERNETES_PACK.dashboards = [dashboard([], load)];
      const first = await match();
      expect(first.alerts.get("k8s/one")).toBe(true);
      expect(first.dashboards.get("overview")).toBe(false);
      expect((await match()).dashboards.get("overview")).toBe(true);
    });
  });

  it("re-reads a required schema that came back empty", async () => {
    const { readSchemaColumns } = await import("./packMatchData");
    fake.columns = {};
    fake.schemaReads = [];
    await readSchemaColumns("org", "metrics", "late");
    expect(fake.schemaReads).toEqual([
      { name: "late", force: false },
      { name: "late", force: true },
    ]);
  });

  it("uses only pack aliases on OSS, without calling semantic groups", async () => {
    fake.streams = { metrics: [metric(recent())] };
    fake.columns = { kube_pod: ["k8s_cluster_name"] };
    fake.files = { "k8s/one": query("sum by (k8s_cluster) (kube_pod)") };
    expect(await libraryReady()).toBe(true);
    expect(fake.groups).not.toHaveBeenCalled();
  });

  it("adds the org's semantic groups on Enterprise", async () => {
    fake.isEnterprise = "true";
    fake.groups.mockResolvedValue([{ fields: ["verb", "http_verb"] }]);
    fake.streams = { metrics: [metric(recent())] };
    fake.columns = { kube_pod: ["http_verb"] };
    fake.files = { "k8s/one": query("sum by (verb) (kube_pod)") };
    expect(await libraryReady()).toBe(true);
    expect(fake.groups).toHaveBeenCalledWith("org");
  });

  it("does not read a file for an alert whose stream is absent", async () => {
    expect(await libraryReady()).toBe(false);
    expect(library.loadAlertFile).not.toHaveBeenCalled();
  });

  it("falls back to the bundled file when the Library is out of reach", async () => {
    library.loadAlertFile.mockRejectedValueOnce(new Error("down"));
    fake.streams = { metrics: [metric(recent())] };
    fake.columns = { kube_pod: ["phase"] };
    const pack = {
      ...KUBERNETES_PACK,
      bundledAlerts: [{ entry, file: query("sum by (verb) (kube_pod)") }],
    };
    const match = await matchPack("org", pack, await readOrgStreams("org"), library as any);
    expect(match.ready).toBe(false);
  });
});
