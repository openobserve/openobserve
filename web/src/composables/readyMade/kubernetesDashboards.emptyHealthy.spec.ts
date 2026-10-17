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

// Every panel the curated page paints "All clear" when empty must say so in its stored copy's description.

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
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
import i18n from "@/locales";
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
const HEALTHY = i18n.global.t("dashboard.readyMade.emptyMeansHealthy");
const svc = stream as unknown as Record<string, ReturnType<typeof vi.fn>>;

const panelsOf = (doc: any): any[] =>
  (doc?.tabs ?? []).flatMap((tab: any) => tab.panels).filter((p: any) => p.type !== "markdown");

let wrapper: ReturnType<typeof mount> | undefined;
let pageAllClear: string[] = [];
let docs: any[] = [];

/** The curated page's own dashboard object, built by the real composable over one live-shaped fixture. */
const renderPage = async (): Promise<any> => {
  const list = () => k8sStreamList(READYMADE_K8S_STREAMS);
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
  loadSemanticGroupsMock.mockResolvedValue(defaultSemanticGroups as FieldAlias[]);
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

beforeAll(async () => {
  vi.clearAllMocks();
  queryClient.clear();
  __resetSchemaReadsForTest();
  const page = await renderPage();
  // The exact flag PanelContainer and PromQLTableChart read to paint "All clear".
  pageAllClear = panelsOf(page)
    .filter((panel) => panel.config?.curated_empty_means_healthy === true)
    .map((panel) => panel.id);
  docs = await buildKubernetesDashboards(ORG);
});

afterAll(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

describe("stored Kubernetes copies say what an empty panel means, wherever the page says All clear", () => {
  it("the page paints All clear on the unhealthy-pods table and every Health panel, nowhere else", () => {
    expect(pageAllClear).toEqual([
      "k8s_ov_unhealthy_pods",
      "k8s_wh_containers_failing",
      "k8s_wh_deploy_short",
      "k8s_wh_sts_short",
      "k8s_wh_ds_unavailable",
      "k8s_wh_jobs_failed",
      "k8s_wh_waiting_top",
      "k8s_wh_terminated_top",
      "k8s_wh_deploy_short_top",
      "k8s_wh_sts_short_top",
      "k8s_wh_ds_unavailable_top",
      "k8s_wh_jobs_failed_top",
    ]);
  });

  it("every one of those panels is on some dashboard, and each copy of it carries the sentence", () => {
    for (const id of pageAllClear) {
      const copies = docs.flatMap((doc) =>
        panelsOf(doc)
          .filter((panel) => panel.id === id)
          .map((panel) => ({ title: doc.title, panel })),
      );
      expect(copies.length, `${id} is on no dashboard`).toBeGreaterThan(0);
      for (const { title, panel } of copies) {
        expect(panel.description, `${title} / ${id}`).toBe(HEALTHY);
      }
    }
  });

  it("no panel the page leaves as No Data claims it", () => {
    const flagged = new Set(pageAllClear);
    for (const doc of docs) {
      for (const panel of panelsOf(doc)) {
        if (flagged.has(panel.id)) continue;
        expect(panel.description, `${doc.title} / ${panel.id}`).not.toBe(HEALTHY);
      }
    }
  });

  it("enumerates the carriers per dashboard: Cluster and Workload only", () => {
    const carriers = Object.fromEntries(
      docs.map((doc) => [
        doc.title,
        panelsOf(doc)
          .filter((panel) => panel.description === HEALTHY)
          .map((panel) => panel.id),
      ]),
    );
    expect(carriers).toEqual({
      "Kubernetes / Cluster": pageAllClear,
      "Kubernetes / Node": [],
      "Kubernetes / Pod": [],
      "Kubernetes / Workload": [
        "k8s_wh_deploy_short_top",
        "k8s_wh_sts_short_top",
        "k8s_wh_ds_unavailable_top",
        "k8s_wh_jobs_failed_top",
      ],
    });
  });
});
