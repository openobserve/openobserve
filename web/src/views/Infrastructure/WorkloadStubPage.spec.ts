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

// Thin v1 Kubernetes / AWS workload pages (design 4.9/§6): setup-state vs detected-state.
//
// This spec lives exactly as long as WorkloadStubPage.vue does. §8.1 step 3 deletes
// the component and this file in ONE commit, after step 2 swaps the two routes; a
// live component with no spec is an untested route, so it is never deleted first.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { createRouter, createMemoryHistory } from "vue-router";
import { ref } from "vue";
import WorkloadStubPage from "./WorkloadStubPage.vue";
import dashboardsService from "@/services/dashboards";
import i18n from "@/locales";

const { detectionRefresh } = vi.hoisted(() => ({ detectionRefresh: vi.fn() }));

vi.mock("@/composables/useWorkloadDetection", () => ({
  useWorkloadDetection: () => ({ states: workloadStates, refresh: detectionRefresh }),
}));

vi.mock("@/services/dashboards", () => ({
  default: { list: vi.fn(), create: vi.fn(), delete: vi.fn(), list_Folders: vi.fn() },
}));

const workloadStates = ref<Record<string, string>>({
  hosts: "undetected",
  kubernetes: "undetected",
  aws: "undetected",
});

const listMock = vi.mocked(dashboardsService.list);
const listFoldersMock = vi.mocked(dashboardsService.list_Folders);

const setupCardStub = {
  name: "DataSourceSetupCard",
  props: ["slug"],
  template: "<div data-test='setup-card-stub' :data-slug='slug' />",
};

const drawerStub = {
  name: "AddDashboardFromGitHub",
  props: ["modelValue", "initialSearch"],
  emits: ["update:modelValue", "added"],
  template:
    "<div data-test='github-drawer-stub' :data-open='modelValue' :data-search='initialSearch' />",
};

describe("WorkloadStubPage", () => {
  let wrapper: VueWrapper<any>;
  let store: any;
  let router: any;

  const mountPage = async (workload: "kubernetes" | "aws") => {
    store = createStore({
      state: {
        selectedOrganization: { identifier: "test-org" },
        theme: "light",
        zoConfig: {},
        organizationData: {},
        userInfo: { email: "t@e.com" },
      },
    });
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/dashboards/view", name: "viewDashboard", component: { template: "<div />" } },
        { path: "/ingestion/aws", name: "AWSConfig", component: { template: "<div />" } },
      ],
    });
    vi.spyOn(router, "push");
    const w = mount(WorkloadStubPage, {
      props: { workload },
      global: {
        plugins: [store, router, i18n],
        stubs: { DataSourceSetupCard: setupCardStub, AddDashboardFromGitHub: drawerStub },
      },
    });
    await flushPromises();
    return w;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    workloadStates.value = { hosts: "undetected", kubernetes: "undetected", aws: "undetected" };
    listMock.mockResolvedValue({ data: { dashboards: [] } } as any);
    listFoldersMock.mockResolvedValue({
      data: {
        list: [
          { name: "default", folderId: "default" },
          { name: "AWS", folderId: "xyz" },
        ],
      },
    } as any);
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders the kubernetes setup card inline when undetected — a setup page, not a dead end", async () => {
    wrapper = await mountPage("kubernetes");
    const card = wrapper.find('[data-test="setup-card-stub"]');
    expect(card.exists()).toBe(true);
    expect(card.attributes("data-slug")).toBe("kubernetes");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("force-refreshes detection when the embedded card emits detected (stale-cache flip)", async () => {
    wrapper = await mountPage("kubernetes");
    detectionRefresh.mockClear();
    wrapper.findComponent({ name: "DataSourceSetupCard" }).vm.$emit("detected", 2);
    await flushPromises();
    expect(detectionRefresh).toHaveBeenCalledWith({ force: true });
  });

  it("routes the undetected AWS page to the Data Sources AWS surface (no registered card)", async () => {
    wrapper = await mountPage("aws");
    expect(wrapper.find('[data-test="setup-card-stub"]').exists()).toBe(false);
    const cta = wrapper.find('[data-test="workload-setup-cta"]');
    expect(cta.exists()).toBe(true);
    await cta.trigger("click");
    expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ name: "AWSConfig" }));
  });

  describe("detected state", () => {
    it("lists this workload's dashboards from the default folder, deep-linking each", async () => {
      workloadStates.value = { ...workloadStates.value, kubernetes: "detected" };
      listMock.mockResolvedValue({
        data: {
          dashboards: [
            { dashboard_id: "k1", title: "Kubernetes Overview" },
            { dashboard_id: "x1", title: "Nginx Ingress-Free" },
          ],
        },
      } as any);
      wrapper = await mountPage("kubernetes");
      expect(listMock).toHaveBeenCalled();
      const folders = listMock.mock.calls.map((c) => c[6]);
      expect(folders).toContain("default");
      expect(wrapper.find('[data-test="workload-dashboard-row-k1"]').exists()).toBe(true);
      // Keyword-filtered: unrelated titles stay out of the workload list.
      expect(wrapper.find('[data-test="workload-dashboard-row-x1"]').exists()).toBe(false);
    });

    it("unions default with the AWS folder RESOLVED to its server id, never its name", async () => {
      workloadStates.value = { ...workloadStates.value, aws: "detected" };
      listMock.mockImplementation((...args: any[]) => {
        const folder = args[6];
        return Promise.resolve({
          data: {
            dashboards:
              folder === "xyz"
                ? [{ dashboard_id: "a2", title: "AWS CloudWatch" }]
                : [{ dashboard_id: "a1", title: "AWS EC2" }],
          },
        } as any);
      });
      wrapper = await mountPage("aws");
      const folders = listMock.mock.calls.map((c) => c[6]);
      expect(folders).toContain("default");
      // ensureIntegrationsFolderExists creates the folder NAMED "AWS" with a server-generated id.
      expect(folders).toContain("xyz");
      expect(folders).not.toContain("AWS");
      expect(wrapper.find('[data-test="workload-dashboard-row-a1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workload-dashboard-row-a2"]').exists()).toBe(true);
      // The deep link must carry the real folder id too.
      await wrapper.find('[data-test="workload-dashboard-row-a2"]').trigger("click");
      expect(router.push).toHaveBeenCalledWith(
        expect.objectContaining({ query: expect.objectContaining({ folder: "xyz" }) }),
      );
    });

    it("skips the AWS folder when it does not exist yet", async () => {
      workloadStates.value = { ...workloadStates.value, aws: "detected" };
      listFoldersMock.mockResolvedValue({
        data: { list: [{ name: "default", folderId: "default" }] },
      } as any);
      wrapper = await mountPage("aws");
      const folders = listMock.mock.calls.map((c) => c[6]);
      expect(folders).toEqual(["default"]);
    });

    it("drops a stale dashboards response that resolves after a newer load", async () => {
      workloadStates.value = { ...workloadStates.value, kubernetes: "detected" };
      let resolveStale!: (v: any) => void;
      listMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = resolve;
          }) as any,
      );
      listMock.mockResolvedValue({
        data: { dashboards: [{ dashboard_id: "new1", title: "Kubernetes New" }] },
      } as any);
      wrapper = await mountPage("kubernetes");
      // Org switch issues a fresh load while the first is still in flight.
      store.state.selectedOrganization = { identifier: "other-org" };
      await flushPromises();
      resolveStale({
        data: { dashboards: [{ dashboard_id: "stale1", title: "Kubernetes Stale" }] },
      });
      await flushPromises();
      expect(wrapper.find('[data-test="workload-dashboard-row-stale1"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="workload-dashboard-row-new1"]').exists()).toBe(true);
    });

    it("reloads the dashboards list when the drawer reports an import (@added)", async () => {
      workloadStates.value = { ...workloadStates.value, kubernetes: "detected" };
      wrapper = await mountPage("kubernetes");
      listMock.mockClear();
      wrapper.findComponent({ name: "AddDashboardFromGitHub" }).vm.$emit("added");
      await flushPromises();
      // An imported template must appear without a remount.
      expect(listMock).toHaveBeenCalled();
    });

    it("opens the template drawer with the gallery search pre-seeded", async () => {
      workloadStates.value = { ...workloadStates.value, kubernetes: "detected" };
      wrapper = await mountPage("kubernetes");
      await wrapper.find('[data-test="workload-import-templates"]').trigger("click");
      await flushPromises();
      const drawer = wrapper.find('[data-test="github-drawer-stub"]');
      expect(drawer.attributes("data-open")).toBe("true");
      expect(drawer.attributes("data-search")).toBe("kubernetes");
    });

    it("shows the detection chip naming the matched streams", async () => {
      workloadStates.value = { ...workloadStates.value, kubernetes: "detected" };
      wrapper = await mountPage("kubernetes");
      const chip = wrapper.find('[data-test="workload-chip"]');
      expect(chip.exists()).toBe(true);
      expect(chip.text()).toContain("k8s_");
    });
  });

  it("re-runs detection and resets the dashboards list on org switch", async () => {
    workloadStates.value = { ...workloadStates.value, kubernetes: "detected" };
    listMock.mockResolvedValue({
      data: { dashboards: [{ dashboard_id: "k1", title: "Kubernetes Overview" }] },
    } as any);
    wrapper = await mountPage("kubernetes");
    detectionRefresh.mockClear();
    listMock.mockClear();
    // A k8s-detected org's "detected" face must not linger on the next org.
    store.state.selectedOrganization = { identifier: "other-org" };
    await flushPromises();
    expect(detectionRefresh).toHaveBeenCalled();
    expect(listMock).toHaveBeenCalled();
  });
});
