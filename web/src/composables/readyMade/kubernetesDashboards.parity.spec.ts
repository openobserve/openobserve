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

// Parity guard: the curated page (through its real composable) and the 4 ready-made dashboards, built from ONE fixture, must query identically.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";

const { getStreamsMock, getStreamMock, loadSemanticGroupsMock } = vi.hoisted(() => ({
  getStreamsMock: vi.fn(),
  getStreamMock: vi.fn(),
  loadSemanticGroupsMock: vi.fn(),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: getStreamsMock, getStream: getStreamMock }),
}));
vi.mock("@/services/stream", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/utils/semanticGroupsCache", () => ({
  loadSemanticGroups: loadSemanticGroupsMock,
  clearSemanticGroupsCacheForOrg: vi.fn(),
  getCachedSemanticGroups: vi.fn(() => null),
}));
vi.mock("@/services/search", () => ({
  default: { search: vi.fn(), metrics_query: vi.fn(), metrics_query_range: vi.fn() },
}));

import stream from "@/services/stream";
import { queryClient } from "@/composables/query/queryClient";
import type { FieldAlias } from "@/services/service_streams";
import defaultSemanticGroups from "@/views/Infrastructure/curated/packs/__fixtures__/semanticGroups.default.json";
import {
  useCuratedPage,
  __resetSchemaReadsForTest,
} from "@/views/Infrastructure/curated/useCuratedPage";
import { kubernetesPage } from "@/views/Infrastructure/curated/packs/kubernetes.page";
import { buildKubernetesDashboards } from "./kubernetesDashboards";
import { READYMADE_K8S_STREAMS, k8sSchemaEntry, k8sStreamList } from "./__fixtures__/k8sStreams";

const ORG = "org1";
const HOUR_US = 60 * 60 * 1_000_000;
const svc = stream as unknown as Record<string, ReturnType<typeof vi.fn>>;

interface Scenario {
  name: string;
  streams: readonly string[];
  dictionary: "loaded" | "forbidden";
}

const SCENARIOS: Scenario[] = [
  {
    name: "readymade cluster, dictionary loaded",
    streams: READYMADE_K8S_STREAMS,
    dictionary: "loaded",
  },
  {
    name: "readymade cluster, dictionary forbidden (OSS)",
    streams: READYMADE_K8S_STREAMS,
    dictionary: "forbidden",
  },
  {
    name: "utilization variants present",
    streams: [...READYMADE_K8S_STREAMS, "k8s_node_cpu_utilization", "k8s_pod_cpu_utilization"],
    dictionary: "loaded",
  },
];

/** Both pipelines read the same fixture: the page through useStreams, the dashboards through the stream service. */
const serve = (scenario: Scenario) => {
  const list = () => k8sStreamList(scenario.streams);
  getStreamsMock.mockImplementation(async (type: string) => ({
    name: type,
    schema: false,
    list: type === "metrics" ? list() : [],
  }));
  getStreamMock.mockImplementation(async (name: string) => k8sSchemaEntry(name));
  svc.nameList.mockImplementation(async () => ({ data: { list: list() } }));
  svc.schema.mockImplementation(async (_org: string, name: string) => ({
    data: k8sSchemaEntry(name),
  }));
  if (scenario.dictionary === "loaded") {
    loadSemanticGroupsMock.mockResolvedValue(defaultSemanticGroups as FieldAlias[]);
  } else {
    loadSemanticGroupsMock.mockImplementation(async (_org: string, onError: any) => {
      onError?.(Object.assign(new Error("403"), { response: { status: 403 } }));
      return [];
    });
  }
};

let wrapper: ReturnType<typeof mount> | undefined;

/** The curated page's own dashboard object, built by the real composable. */
const renderPage = async (): Promise<any> => {
  const store = createStore({
    state: { selectedOrganization: { identifier: ORG }, timezone: "UTC", theme: "light" },
  });
  let page!: ReturnType<typeof useCuratedPage>;
  wrapper = mount(
    defineComponent({
      setup() {
        page = useCuratedPage(kubernetesPage);
        return () => null;
      },
    }),
    { global: { plugins: [store] } },
  );
  const end = Date.now() * 1000;
  await page.refresh({ orgId: ORG, start: end - 3 * HOUR_US, end });
  await flushPromises();
  return page.dashboard.value;
};

const panelsOf = (doc: any): any[] =>
  (doc?.tabs ?? []).flatMap((tab: any) => tab.panels).filter((p: any) => p.type !== "markdown");

/** What the node picker adds to a Nodes panel; with every node selected it narrows nothing. */
const withoutNodeMatcher = (query: string) =>
  query
    .replace(/,\s*\w+=~"\$node"/g, "")
    .replace(/\{\s*\w+=~"\$node"\s*,?/g, "{")
    .replace(/\{\s*\}/g, "");

/** Everything a panel's numbers depend on. */
const reading = (panel: any, normalise: (query: string) => string = (query) => query) => ({
  type: panel.type,
  queryType: panel.queryType,
  unit: panel.config.unit,
  unit_custom: panel.config.unit_custom,
  decimals: panel.config.decimals,
  promql_table_mode: panel.config.promql_table_mode,
  queries: panel.queries.map((query: any) => ({
    query: normalise(query.query),
    legend: query.config.promql_legend,
    mode: query.config.query_type ?? "range",
  })),
});

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  __resetSchemaReadsForTest();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

describe.each(SCENARIOS)("curated page vs ready-made dashboards — $name", (scenario) => {
  it("every shared panel id reads identically", async () => {
    serve(scenario);
    const page = await renderPage();
    const docs = await buildKubernetesDashboards(ORG);
    const pagePanels = new Map(panelsOf(page).map((panel) => [panel.id, panel]));
    expect(pagePanels.size).toBeGreaterThan(30);

    const sharedPerDoc = docs.map((doc) => {
      const normalise = doc.title === "Kubernetes / Node" ? withoutNodeMatcher : undefined;
      let shared = 0;
      for (const panel of panelsOf(doc)) {
        const theirs = pagePanels.get(panel.id);
        if (!theirs) continue;
        shared += 1;
        expect(reading(panel, normalise), `${doc.title} / ${panel.id}`).toEqual(reading(theirs));
      }
      return shared;
    });
    // Cluster, Node, Pod all share their whole grid; Workload shares its health tables.
    expect(sharedPerDoc[0]).toBeGreaterThanOrEqual(20);
    expect(sharedPerDoc[1]).toBe(5);
    expect(sharedPerDoc[2]).toBe(8);
    expect(sharedPerDoc[3]).toBeGreaterThanOrEqual(3);
  });

  it("every panel the page renders, quadrant aside, is on some dashboard", async () => {
    serve(scenario);
    const page = await renderPage();
    const docs = await buildKubernetesDashboards(ORG);
    const placed = new Set(docs.flatMap((doc) => panelsOf(doc).map((panel) => panel.id)));
    const missing = panelsOf(page)
      .map((panel) => panel.id)
      .filter((id) => !placed.has(id));
    expect(missing).toEqual(["k8s_sm_fleet_quadrant"]);
  });

  it("the Node dashboard narrows by node and nothing else", async () => {
    serve(scenario);
    const page = await renderPage();
    const [, node] = await buildKubernetesDashboards(ORG);
    for (const panel of panelsOf(node)) {
      const theirs = panelsOf(page).find((candidate) => candidate.id === panel.id);
      for (const [index, query] of panel.queries.entries()) {
        expect(query.query).toMatch(/=~"\$node"/);
        expect(query.query).not.toBe(theirs.queries[index].query);
      }
    }
  });
});
