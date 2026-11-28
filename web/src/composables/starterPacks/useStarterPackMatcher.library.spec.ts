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

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

const fake = vi.hoisted(() => ({
  metrics: [] as string[],
  logs: [] as string[],
  traces: [] as string[],
  lastIngested: 1,
  columns: [] as string[],
  requests: [] as any[],
  ready: false,
  matchPack: vi.fn(),
}));

vi.mock("@/constants/starterPacks", () => ({ STARTER_PACKS_ENABLED: true }));
vi.mock("@/composables/alerts/useAlertLibrary", () => ({
  useAlertLibrary: () => ({ loadManifest: vi.fn(), loadAlertFile: vi.fn() }),
}));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (request: any, handlers: any) => {
      fake.requests.push(request);
      handlers.complete(request, {});
    },
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));
vi.mock("./packMatchData", () => ({
  readOrgStreams: async () => ({
    metrics: new Map(fake.metrics.map((name) => [name, fake.lastIngested])),
    logs: new Map(fake.logs.map((name) => [name, fake.lastIngested])),
    traces: new Map(fake.traces.map((name) => [name, fake.lastIngested])),
  }),
  readSchemaColumns: async () => fake.columns,
  matchPack: (...args: unknown[]) => {
    fake.matchPack(...args);
    return Promise.resolve({ ready: fake.ready });
  },
}));

import { packById } from "./usePackCatalog";
import { loadCatalogFixture } from "@/test/unit/helpers/starterPacksCatalog";
import { useStarterPackMatcher } from "./useStarterPackMatcher";

loadCatalogFixture();

const HOSTS_PACK = packById("hosts")!;
const KUBERNETES_PACK = packById("kubernetes")!;

const check = async (pack = HOSTS_PACK) => {
  let api!: ReturnType<typeof useStarterPackMatcher>;
  mount(
    defineComponent({
      setup() {
        api = useStarterPackMatcher("org", { pack });
        return () => null;
      },
    }),
  );
  await api.check();
  return api.state.value;
};

describe("useStarterPackMatcher with the Library on, Hosts pack", () => {
  beforeEach(() => {
    Object.assign(fake, {
      metrics: [],
      logs: [],
      traces: [],
      lastIngested: 1,
      columns: [],
      requests: [],
      ready: false,
    });
    fake.matchPack.mockClear();
  });

  it("matches when the Library match is ready", async () => {
    fake.metrics = ["node_cpu_seconds_total"];
    fake.ready = true;
    expect(await check()).toBe("matched");
    expect(fake.matchPack).toHaveBeenCalledWith(
      "org",
      HOSTS_PACK,
      expect.anything(),
      expect.anything(),
    );
  });

  it("waits while a host stream exists but nothing in the pack fits yet", async () => {
    fake.metrics = ["system_cpu_time"];
    expect(await check()).toBe("waiting");
  });

  it("reports none without a host stream and never runs the Library match", async () => {
    fake.metrics = ["kube_pod_status_phase"];
    expect(await check()).toBe("none");
    expect(fake.matchPack).not.toHaveBeenCalled();
  });
});

describe("useStarterPackMatcher with the Library on, Kubernetes pack", () => {
  beforeEach(() => {
    Object.assign(fake, {
      metrics: [],
      logs: [],
      traces: [],
      lastIngested: 1,
      columns: [],
      requests: [],
      ready: true,
    });
    fake.matchPack.mockClear();
  });

  const setupKubernetes = async () => {
    let api!: ReturnType<typeof useStarterPackMatcher>;
    mount(
      defineComponent({
        setup() {
          api = useStarterPackMatcher("org", { pack: KUBERNETES_PACK });
          return () => null;
        },
      }),
    );
    await api.check();
    return api;
  };

  it.each(["logs", "traces"] as const)(
    "does not offer Kubernetes on a %s stream named default",
    async (type) => {
      fake[type] = ["default"];
      const api = await setupKubernetes();
      expect(api.state.value).toBe("none");
      expect(api.streams.value).toEqual([]);
      expect(fake.matchPack).not.toHaveBeenCalled();
    },
  );

  it.each([
    [["k8s_cluster"], 1],
    [["value"], 0],
  ])("offers Kubernetes on its metrics with columns %j", async (columns, clusterReads) => {
    fake.metrics = ["kube_pod_status_phase"];
    fake.columns = columns;
    const api = await setupKubernetes();
    expect(api.state.value).toBe("matched");
    expect(api.streams.value).toEqual(["kube_pod_status_phase"]);
    expect(fake.requests).toHaveLength(clusterReads);
  });

  it("offers Kubernetes on k8s_events alone, with no clusters seen", async () => {
    fake.logs = ["k8s_events"];
    const api = await setupKubernetes();
    expect(api.state.value).toBe("matched");
    expect([api.streams.value, api.clusters.value]).toEqual([["k8s_events"], []]);
  });

  it("reads clusters in the day before a stale stream's last data", async () => {
    const lastIngested = Date.now() * 1000 - 3 * 24 * 60 * 60 * 1_000_000;
    Object.assign(fake, {
      metrics: ["kube_pod_status_phase"],
      lastIngested,
      columns: ["k8s_cluster"],
      requests: [],
      ready: true,
    });
    expect(await check(KUBERNETES_PACK)).toBe("matched");
    const { query } = fake.requests[0].queryReq;
    expect(query.end_time).toBe(lastIngested + 1);
    expect(query.start_time).toBe(lastIngested + 1 - 24 * 60 * 60 * 1_000_000);
  });

  it("reads clusters up to now for a stream created within the day", async () => {
    const before = Date.now() * 1000;
    Object.assign(fake, {
      metrics: ["kube_pod_status_phase"],
      lastIngested: before - 3_600_000_000,
      columns: ["k8s_cluster"],
      requests: [],
      ready: true,
    });
    expect(await check(KUBERNETES_PACK)).toBe("matched");
    expect(fake.requests[0].queryReq.query.end_time).toBeGreaterThanOrEqual(before);
  });
});
