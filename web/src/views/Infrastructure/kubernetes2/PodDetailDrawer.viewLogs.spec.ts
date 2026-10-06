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

// View logs end to end: real vuex store, real useStreams and podLogsLink, only the HTTP services mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent, h } from "vue";
import i18n from "@/locales";
import store from "@/stores";
import StreamService from "@/services/stream";
import { queryClient } from "@/composables/query/queryClient";
import { b64EncodeUnicode } from "@/utils/zincutils";
import PodDetailDrawer from "./PodDetailDrawer.vue";
import type { PodRow } from "./kubernetesModel";

const toastMock = vi.fn();

vi.mock("@/services/search", () => ({
  default: { metrics_query_range: vi.fn().mockResolvedValue({ data: { data: { result: [] } } }) },
}));
vi.mock("@/services/stream", () => ({ default: { nameList: vi.fn(), schema: vi.fn() } }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...args: any[]) => toastMock(...args) }));

const drawerStub = defineComponent({
  name: "ODrawer",
  setup(_p, { slots }) {
    return () => h("div", [slots.default?.()]);
  },
});

const pod = {
  key: "prod/shop/web-1",
  cluster: "prod",
  namespace: "shop",
  name: "web-1",
  usage: null,
  containers: [],
  status: null,
} as unknown as PodRow;

describe("PodDetailDrawer View logs (real stream lookup)", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    vi.mocked(StreamService.nameList).mockResolvedValue({
      data: { list: [{ name: "default", stream_type: "logs" }] },
    } as any);
    vi.mocked(StreamService.schema).mockResolvedValue({
      data: {
        name: "default",
        stream_type: "logs",
        schema: ["k8s_pod_name", "k8s_namespace_name", "k8s_cluster"].map((name) => ({
          name,
          type: "Utf8",
        })),
      },
    } as any);
  });

  afterEach(() => wrapper?.unmount());

  it("navigates to the pod's logs from the click handler", async () => {
    store.state.selectedOrganization = { ...store.state.selectedOrganization, identifier: "org1" };
    const dispatch = vi.spyOn(store, "dispatch");
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/logs", component: { template: "<div />" } },
      ],
    });
    await router.push("/");
    wrapper = mount(PodDetailDrawer, {
      props: {
        target: ["prod", "shop", "web-1"],
        pod,
        range: { start: 100, end: 200 },
        orgId: "org1",
        multiCluster: false,
        usageStreams: { cpu: true, memory: true },
      },
      global: { plugins: [store, router, i18n], stubs: { ODrawer: drawerStub } },
    });
    await flushPromises();
    await wrapper.find('[data-test="k8s2-drawer-view-logs"]').trigger("click");
    await flushPromises();
    expect(toastMock).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith("logs/setIsInitialized", false);
    expect(router.currentRoute.value.path).toBe("/logs");
    expect(router.currentRoute.value.query).toMatchObject({
      stream: "default",
      query: b64EncodeUnicode(
        "k8s_pod_name='web-1' AND k8s_namespace_name='shop' AND k8s_cluster='prod'",
      ),
    });
  });
});
