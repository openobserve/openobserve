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

// Empty-state template cards (design 4.3/§6): zero network on render, lazy gallery, badge, confirmed replace.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { createRouter, createMemoryHistory } from "vue-router";
import { ref } from "vue";
import TemplateSuggestionCards from "./TemplateSuggestionCards.vue";
import dashboardsService from "@/services/dashboards";
import dashboardJson from "@/assets/dashboards/host_metrics.dashboard.json";
import i18n from "@/locales";

const { importHostMetricsDashboard, toastMock, refreshMock } = vi.hoisted(() => ({
  importHostMetricsDashboard: vi.fn(),
  toastMock: vi.fn(),
  refreshMock: vi.fn(),
}));

// Factories dereference these at call time, so the vue refs can live at module scope.
vi.mock("@/composables/useWorkloadDetection", () => ({
  useWorkloadDetection: () => ({ states: workloadStates, refresh: refreshMock }),
}));

vi.mock("@/composables/useHostMetricsDashboard", () => ({ importHostMetricsDashboard }));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

vi.mock("@/composables/useDashboardGallery", () => ({
  useDashboardGallery: () => galleryState,
  CATEGORY_ORDER: ["aws", "kubernetes", "networking"],
  getCategoryInfo: (d: { name: string }) => {
    const n = d.name.toLowerCase();
    if (n.includes("kubernetes"))
      return { icon: "hub", variant: "indigo-soft", category: "kubernetes" };
    if (n.includes("aws")) return { icon: "cloud", variant: "orange-soft", category: "aws" };
    return { icon: "dashboard", variant: "gray-soft", category: "networking" };
  },
}));

const workloadStates = ref<Record<string, string>>({
  hosts: "undetected",
  kubernetes: "undetected",
  aws: "undetected",
});

const galleryState = {
  dashboards: ref<any[]>([]),
  loading: ref(false),
  error: ref(""),
  loadDashboards: vi.fn(),
};

vi.mock("@/services/dashboards", () => ({
  default: { list: vi.fn(), create: vi.fn(), delete: vi.fn() },
}));

const t = (key: string) => i18n.global.t(key);

// The house ODialog teleports via DialogPortal — the sibling suites' stub keeps it findable in-wrapper.
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "size",
    "width",
    "title",
    "subTitle",
    "showClose",
    "persistent",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test-stub="o-dialog"
      :data-open="open"
      :data-title="title"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
    >
      <slot name="header" />
      <slot />
      <slot name="footer" />
    </div>
  `,
};

describe("TemplateSuggestionCards", () => {
  let wrapper: VueWrapper<any>;
  let router: any;

  const mockFetch = vi.fn();

  const mountCards = (props: Record<string, any> = {}) => {
    const store = createStore({
      state: { selectedOrganization: { identifier: "test-org" }, theme: "light" },
    });
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/dashboards/view", name: "viewDashboard", component: { template: "<div />" } },
      ],
    });
    vi.spyOn(router, "push");
    return mount(TemplateSuggestionCards, {
      props: { activeFolderId: "default", filterQuery: "", ...props },
      global: { plugins: [store, router, i18n], stubs: { ODialog: ODialogStub } },
    });
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    vi.clearAllMocks();
    workloadStates.value = { hosts: "undetected", kubernetes: "undetected", aws: "undetected" };
    galleryState.dashboards.value = [];
    galleryState.error.value = "";
    galleryState.loadDashboards.mockResolvedValue(undefined);
    importHostMetricsDashboard.mockResolvedValue({
      status: "created",
      dashboardId: "dash-1",
      folderId: "default",
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders only for the default folder with no filter", async () => {
    wrapper = mountCards({ activeFolderId: "folder1" });
    expect(wrapper.find('[data-test="template-suggestion-cards"]').exists()).toBe(false);
    await wrapper.setProps({ activeFolderId: "default", filterQuery: "cpu" });
    expect(wrapper.find('[data-test="template-suggestion-cards"]').exists()).toBe(false);
    await wrapper.setProps({ filterQuery: "" });
    expect(wrapper.find('[data-test="template-suggestion-cards"]').exists()).toBe(true);
  });

  it("renders the bundled Host Metrics card with ZERO network on mount", async () => {
    wrapper = mountCards();
    await flushPromises();
    expect(wrapper.find('[data-test="template-card-hostmetrics"]').exists()).toBe(true);
    // Every empty-Dashboards visit would otherwise generate S3 egress (4.3).
    expect(mockFetch).not.toHaveBeenCalled();
    expect(galleryState.loadDashboards).not.toHaveBeenCalled();
  });

  it("loads the gallery lazily on Browse all templates, then opens the drawer", async () => {
    wrapper = mountCards();
    await wrapper.find('[data-test="template-browse-all"]').trigger("click");
    await flushPromises();
    expect(galleryState.loadDashboards).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("open-drawer")).toBeTruthy();
  });

  it("badges the Host Metrics card from the hosts workload state", async () => {
    workloadStates.value = { ...workloadStates.value, hosts: "detected" };
    wrapper = mountCards();
    await flushPromises();
    expect(wrapper.find('[data-test="template-card-badge-hostmetrics"]').exists()).toBe(true);
  });

  it("shows no badge while hosts are undetected", async () => {
    wrapper = mountCards();
    await flushPromises();
    expect(wrapper.find('[data-test="template-card-badge-hostmetrics"]').exists()).toBe(false);
  });

  it("badges the Kubernetes template card off the kubernetes workload state and sorts it first", async () => {
    workloadStates.value = { ...workloadStates.value, kubernetes: "detected" };
    galleryState.dashboards.value = [
      { name: "nginx", displayName: "Nginx", folderPath: "nginx", jsonFiles: [] },
      { name: "kubernetes", displayName: "Kubernetes", folderPath: "kubernetes", jsonFiles: [] },
    ];
    wrapper = mountCards();
    await wrapper.find('[data-test="template-browse-all"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="template-card-badge-kubernetes"]').exists()).toBe(true);
    const cardIds = wrapper
      .findAll('[data-test^="template-card-"]')
      .map((el) => el.attributes("data-test"))
      .filter((dt) => !dt?.includes("badge"));
    // Badged cards sort first.
    expect(cardIds.indexOf("template-card-kubernetes")).toBeLessThan(
      cardIds.indexOf("template-card-nginx"),
    );
  });

  it("imports and navigates straight to the dashboard when Host Metrics is absent", async () => {
    wrapper = mountCards();
    await wrapper.find('[data-test="template-card-hostmetrics"]').trigger("click");
    await flushPromises();
    expect(importHostMetricsDashboard).toHaveBeenCalledWith("test-org");
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/dashboards/view",
        query: expect.objectContaining({ dashboard: "dash-1", folder: "default" }),
      }),
    );
  });

  it("offers the confirm-replace dialog on exists; confirming deletes, settles 500ms, re-creates", async () => {
    vi.useFakeTimers();
    importHostMetricsDashboard.mockResolvedValue({
      status: "exists",
      dashboardId: "dash-old",
      folderId: "default",
    });
    vi.mocked(dashboardsService.delete).mockResolvedValue({} as any);
    vi.mocked(dashboardsService.create).mockResolvedValue({
      data: { version: 8, v8: { dashboardId: "dash-new" } },
    } as any);
    wrapper = mountCards();
    await wrapper.find('[data-test="template-card-hostmetrics"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="template-replace-confirm"]').exists()).toBe(true);

    await wrapper.find('[data-test="template-replace-confirm-ok"]').trigger("click");
    await flushPromises();
    expect(dashboardsService.delete).toHaveBeenCalledWith("test-org", "dash-old", "default");
    // The AWS-tile mechanics: create only after the 500ms settle window.
    expect(dashboardsService.create).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    // §6: the create body IS the bundled JSON, not merely something title-shaped.
    expect(dashboardsService.create).toHaveBeenCalledWith("test-org", dashboardJson, "default");
  });

  it("declining the replace navigates to the existing dashboard untouched", async () => {
    importHostMetricsDashboard.mockResolvedValue({
      status: "exists",
      dashboardId: "dash-old",
      folderId: "default",
    });
    wrapper = mountCards();
    await wrapper.find('[data-test="template-card-hostmetrics"]').trigger("click");
    await flushPromises();
    await wrapper.find('[data-test="template-replace-confirm-cancel"]').trigger("click");
    await flushPromises();
    expect(dashboardsService.delete).not.toHaveBeenCalled();
    expect(dashboardsService.create).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/dashboards/view",
        query: expect.objectContaining({ dashboard: "dash-old" }),
      }),
    );
  });

  it("shows the cause-naming toast on a user-invoked import error", async () => {
    importHostMetricsDashboard.mockResolvedValue({
      status: "error",
      kind: "forbidden",
      message: "403",
    });
    wrapper = mountCards();
    await wrapper.find('[data-test="template-card-hostmetrics"]').trigger("click");
    await flushPromises();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: t("ingestion.setupCard.hostDashboardImportForbidden"),
      }),
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it("opens the drawer when any non-bundled card is clicked", async () => {
    galleryState.dashboards.value = [
      { name: "nginx", displayName: "Nginx", folderPath: "nginx", jsonFiles: [] },
    ];
    wrapper = mountCards();
    await wrapper.find('[data-test="template-browse-all"]').trigger("click");
    await flushPromises();
    await wrapper.find('[data-test="template-card-nginx"]').trigger("click");
    expect(wrapper.emitted("open-drawer")).toBeTruthy();
    expect(importHostMetricsDashboard).not.toHaveBeenCalled();
  });

  it("still imports directly — the card's own framing already asked, so it gets no extra confirm", async () => {
    wrapper = mountCards();
    await wrapper.find('[data-test="template-card-hostmetrics"]').trigger("click");
    await flushPromises();
    expect(importHostMetricsDashboard).toHaveBeenCalledWith("test-org");
    expect(wrapper.find('[data-test="host-drawer-import-confirm"]').exists()).toBe(false);
  });

  it("keeps the bundled card standing when the lazy gallery fetch fails", async () => {
    // Pinned contract (useDashboardGallery.spec): loadDashboards never rejects.
    galleryState.loadDashboards.mockImplementation(async () => {
      galleryState.error.value = "offline";
    });
    wrapper = mountCards();
    await wrapper.find('[data-test="template-browse-all"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="template-card-hostmetrics"]').exists()).toBe(true);
  });
});
