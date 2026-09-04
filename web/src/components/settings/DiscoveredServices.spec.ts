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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import DiscoveredServices from "./DiscoveredServices.vue";
import OTable from "@/lib/core/Table/OTable.vue";

vi.mock("@/services/service_streams", () => ({
  default: {
    getServicesList: vi.fn(),
    resetServices: vi.fn(),
  },
}));

vi.mock("@/components/common/GroupHeader.vue", () => ({
  default: {
    name: "GroupHeader",
    template: '<div class="group-header"><slot /></div>',
    props: ["title", "showIcon"],
  },
}));

import serviceStreamsService from "@/services/service_streams";

// ODrawer stub mirrors the migrated component API: open/title/size + slots
// (default, header-right) and emits update:open + click:primary/secondary/neutral.
const ODrawerStub = {
  name: "ODrawer",
  props: {
    open: { type: Boolean, default: false },
    size: { type: String, default: undefined },
    title: { type: String, default: undefined },
    subTitle: { type: String, default: undefined },
    persistent: { type: Boolean, default: false },
    showClose: { type: Boolean, default: true },
    width: { type: [String, Number], default: undefined },
    primaryButtonLabel: { type: String, default: undefined },
    secondaryButtonLabel: { type: String, default: undefined },
    neutralButtonLabel: { type: String, default: undefined },
    primaryButtonVariant: { type: String, default: undefined },
    secondaryButtonVariant: { type: String, default: undefined },
    neutralButtonVariant: { type: String, default: undefined },
    primaryButtonDisabled: { type: Boolean, default: false },
    secondaryButtonDisabled: { type: Boolean, default: false },
    neutralButtonDisabled: { type: Boolean, default: false },
    primaryButtonLoading: { type: Boolean, default: false },
    secondaryButtonLoading: { type: Boolean, default: false },
    neutralButtonLoading: { type: Boolean, default: false },
  },
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-drawer-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
    >
      <slot name="header-right" />
      <slot />
      <button
        data-test="o-drawer-stub-close"
        @click="$emit('update:open', false)"
      >close</button>
      <button
        data-test="o-drawer-stub-primary"
        @click="$emit('click:primary')"
      >primary</button>
    </div>
  `,
};

// ConfirmDialog stub exposes ok/cancel triggers without rendering the real
// underlying ODialog so the spec stays decoupled from that component.
const ConfirmDialogStub = {
  name: "ConfirmDialog",
  props: ["modelValue", "title", "message", "warningMessage"],
  emits: ["update:ok", "update:cancel", "update:modelValue"],
  template: `
    <div data-test="confirm-dialog-stub" :data-open="String(!!modelValue)">
      <button data-test="confirm-dialog-ok" @click="$emit('update:ok')">ok</button>
      <button data-test="confirm-dialog-cancel" @click="$emit('update:cancel')">cancel</button>
    </div>
  `,
};

const mockServicesResponse = [
  {
    id: "1",
    org_id: "test-org",
    service_name: "api-server",
    set_id: "api-server-set",
    disambiguation: { "k8s-cluster": "prod", "k8s-deployment": "api-server" },
    all_dimensions: {},
    logs_streams: ["api-logs"],
    traces_streams: ["api-traces"],
    metrics_streams: ["api-metrics"],
    field_name_mapping: {},
    last_seen: 1000000,
  },
  {
    id: "2",
    org_id: "test-org",
    service_name: "worker",
    set_id: "worker-set",
    disambiguation: { "k8s-cluster": "prod", "k8s-statefulset": "worker" },
    all_dimensions: {},
    logs_streams: ["worker-logs"],
    traces_streams: [],
    metrics_streams: [],
    field_name_mapping: {},
    last_seen: 2000000,
  },
];

const mockStore = createStore({
  state: {
    selectedOrganization: { identifier: "test-org" },
    theme: "light",
  },
});

const mockI18n = createI18n({
  locale: "en",
  messages: {
    en: {
      settings: {
        correlation: {
          discoveredServicesTitle: "Discovered Services",
          discoveredServicesDescription: "Services discovered from telemetry",
          retry: "Retry",
          noServicesYet: "No services yet",
          noServicesDescription: "Start sending telemetry data",
          services: "Services",
          searchServiceName: "Search service name...",
          allServices: "All Services",
          missingTelemetry: "Missing Telemetry",
          serviceName: "Service Name",
          howItWorksTitle: "How it works",
        },
      },
      common: {
        refresh: "Refresh",
        search: "Search...",
      },
    },
  },
});

const globalStubs = {
  OIcon: { template: "<span />", props: ["name", "size", "color"] },
  "i18n-t": { template: "<span><slot /></span>", props: ["keypath", "tag"] },
  ODrawer: ODrawerStub,
  ConfirmDialog: ConfirmDialogStub,
};

function mountComponent() {
  return mount(DiscoveredServices, {
    global: {
      plugins: [mockI18n],
      provide: { store: mockStore },
      stubs: globalStubs,
    },
  });
}

describe("DiscoveredServices", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(serviceStreamsService.getServicesList).mockResolvedValue({
      data: mockServicesResponse,
    } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("should render without errors", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should call getServicesList on mount", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(serviceStreamsService.getServicesList).toHaveBeenCalledWith("test-org");
    });

    it("should show loading spinner initially", () => {
      wrapper = mountComponent();
      expect(wrapper.vm.loading).toBe(true);
    });

    it("should hide loading after data loads", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.loading).toBe(false);
    });
  });

  describe("loaded state with services", () => {
    it("should populate services from response", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.services).toHaveLength(2);
    });

    it("should group services by service_name", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.serviceGroups).toHaveLength(2);
      const names = wrapper.vm.serviceGroups.map((g: any) => g.service_name);
      expect(names).toContain("api-server");
      expect(names).toContain("worker");
    });

    it("should show refresh button", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="refresh-discovered-services-btn"]').exists()).toBe(true);
    });
  });

  describe("empty state", () => {
    it("should show empty state when no services found", async () => {
      vi.mocked(serviceStreamsService.getServicesList).mockResolvedValue({
        data: [],
      } as any);
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.text()).toContain("No services yet");
    });

    it("should show refresh button in empty state", async () => {
      vi.mocked(serviceStreamsService.getServicesList).mockResolvedValue({
        data: [],
      } as any);
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="refresh-discovered-services-btn"]').exists()).toBe(true);
    });
  });

  describe("error state", () => {
    it("should set error message on API failure", async () => {
      vi.mocked(serviceStreamsService.getServicesList).mockRejectedValue(
        new Error("Network error"),
      );
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.error).toBe("Network error");
    });

    it("should show retry button in error state", async () => {
      vi.mocked(serviceStreamsService.getServicesList).mockRejectedValue(
        new Error("Network error"),
      );
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="retry-discovered-services-btn"]').exists()).toBe(true);
    });

    it("should clear error on retry", async () => {
      vi.mocked(serviceStreamsService.getServicesList).mockRejectedValueOnce(new Error("fail"));
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.error).toBeTruthy();

      vi.mocked(serviceStreamsService.getServicesList).mockResolvedValueOnce({
        data: mockServicesResponse,
      } as any);
      await wrapper.vm.loadServices();
      await flushPromises();
      expect(wrapper.vm.error).toBeNull();
    });
  });

  describe("flatRows computed (flat table, no expansion)", () => {
    // Two api-server instances + one worker: exercises grouping adjacency,
    // within-group ordering (default set last), and per-instance filtering.
    const multiInstanceResponse = [
      {
        id: "a1",
        org_id: "test-org",
        service_name: "api-server",
        set_id: "k8s-workload",
        disambiguation: { "k8s-cluster": "prod", "k8s-deployment": "api-server" },
        all_dimensions: {},
        logs_streams: ["api-logs"],
        traces_streams: ["api-traces"],
        metrics_streams: [],
        field_name_mapping: {},
        last_seen: 3000000,
      },
      {
        id: "a2",
        org_id: "test-org",
        service_name: "api-server",
        set_id: "default",
        disambiguation: {},
        all_dimensions: {},
        logs_streams: ["api-logs-legacy"],
        traces_streams: [],
        metrics_streams: [],
        field_name_mapping: {},
        last_seen: 1000000,
      },
      {
        id: "w1",
        org_id: "test-org",
        service_name: "worker",
        set_id: "worker-set",
        disambiguation: { "k8s-cluster": "prod", "k8s-statefulset": "worker" },
        all_dimensions: {},
        logs_streams: ["worker-logs"],
        traces_streams: [],
        metrics_streams: [],
        field_name_mapping: {},
        last_seen: 2000000,
      },
    ];

    beforeEach(() => {
      vi.mocked(serviceStreamsService.getServicesList).mockResolvedValue({
        data: multiInstanceResponse,
      } as any);
    });

    it("should emit every instance as a row with no expansion gate", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.flatRows).toHaveLength(3);
    });

    it("should keep instances of the same service adjacent, groups by last_seen desc", async () => {
      wrapper = mountComponent();
      await flushPromises();
      // api-server group max last_seen (3000000) > worker (2000000)
      expect(wrapper.vm.flatRows.map((r: any) => r.service_name)).toEqual([
        "api-server",
        "api-server",
        "worker",
      ]);
    });

    it("should order instances latest-first within their group", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const apiRows = wrapper.vm.flatRows.filter((r: any) => r.service_name === "api-server");
      // a1 (3000000) is newer than a2 (1000000)
      expect(apiRows.map((r: any) => r.id)).toEqual(["a1", "a2"]);
    });

    it("should put a default-set instance first when it is the newest", async () => {
      vi.mocked(serviceStreamsService.getServicesList).mockResolvedValue({
        data: [
          multiInstanceResponse[0], // a1, k8s-workload, 3000000
          { ...multiInstanceResponse[1], last_seen: 5000000 }, // a2, default, newest
        ],
      } as any);
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.flatRows.map((r: any) => r.id)).toEqual(["a2", "a1"]);
    });

    it("should keep all instances of a service when search matches its name", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.searchQuery = "api-server";
      expect(wrapper.vm.flatRows).toHaveLength(2);
      expect(wrapper.vm.flatRows.every((r: any) => r.service_name === "api-server")).toBe(true);
    });

    it("should reveal only the matching instance row on a dimension-value search", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.searchQuery = "statefulset";
      expect(wrapper.vm.flatRows).toHaveLength(1);
      expect(wrapper.vm.flatRows[0].id).toBe("w1");
    });

    it("should reveal only the matching instance row on a stream-name search", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.searchQuery = "api-logs-legacy";
      expect(wrapper.vm.flatRows).toHaveLength(1);
      expect(wrapper.vm.flatRows[0].id).toBe("a2");
    });

    it("should drop non-matching instances on a key/value filter", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.filterKey = "k8s-deployment";
      wrapper.vm.filterValue = "api-server";
      expect(wrapper.vm.flatRows).toHaveLength(1);
      expect(wrapper.vm.flatRows[0].id).toBe("a1");
    });

    it("should filter by set_id via the workload filter key", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.filterKey = "set_id";
      wrapper.vm.filterValue = "default";
      expect(wrapper.vm.flatRows).toHaveLength(1);
      expect(wrapper.vm.flatRows[0].id).toBe("a2");
    });

    it("should count services and instances for the footer", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.filteredGroupCount).toBe(2);
      expect(wrapper.vm.totalInstances).toBe(3);
    });
  });

  describe("per-service collapse", () => {
    const collapseResponse = [
      {
        id: "a1",
        org_id: "test-org",
        service_name: "api-server",
        set_id: "k8s-workload",
        disambiguation: { "k8s-cluster": "prod" },
        all_dimensions: {},
        logs_streams: ["api-logs", "api-logs-2"],
        traces_streams: ["api-traces"],
        metrics_streams: [],
        field_name_mapping: {},
        last_seen: 3000000,
      },
      {
        id: "a2",
        org_id: "test-org",
        service_name: "api-server",
        set_id: "default",
        disambiguation: {},
        all_dimensions: {},
        logs_streams: ["api-logs"],
        traces_streams: [],
        metrics_streams: ["api-metrics"],
        field_name_mapping: {},
        last_seen: 1000000,
      },
      {
        id: "w1",
        org_id: "test-org",
        service_name: "worker",
        set_id: "worker-set",
        disambiguation: { "k8s-statefulset": "worker" },
        all_dimensions: {},
        logs_streams: ["worker-logs"],
        traces_streams: [],
        metrics_streams: [],
        field_name_mapping: {},
        last_seen: 2000000,
      },
    ];

    beforeEach(() => {
      vi.mocked(serviceStreamsService.getServicesList).mockResolvedValue({
        data: collapseResponse,
      } as any);
    });

    it("should collapse a service to one aggregated summary row", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.toggleServiceCollapse("api-server");
      await nextTick();

      const rows = wrapper.vm.flatRows;
      expect(rows).toHaveLength(2); // summary + worker instance
      const summary = rows[0];
      expect(summary.__type).toBe("summary");
      expect(summary.service_name).toBe("api-server");
      expect(summary.instanceCount).toBe(2);
      // Unique stream unions across instances
      expect(summary.totalLogs).toBe(2);
      expect(summary.totalTraces).toBe(1);
      expect(summary.totalMetrics).toBe(1);
      expect(summary.lastSeen).toBe(3000000);
      // Worker stays a plain instance row
      expect(rows[1].id).toBe("w1");
    });

    it("should expand back to instance rows on a second toggle", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.toggleServiceCollapse("api-server");
      wrapper.vm.toggleServiceCollapse("api-server");
      await nextTick();
      expect(wrapper.vm.flatRows.map((r: any) => r.id)).toEqual(["a1", "a2", "w1"]);
    });

    it("should expand (not open the drawer) when a summary row is clicked", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.toggleServiceCollapse("api-server");
      await nextTick();
      wrapper.vm.handleRowClick(wrapper.vm.flatRows[0]);
      await nextTick();
      expect(wrapper.vm.selectedService).toBeNull();
      expect(wrapper.vm.flatRows.map((r: any) => r.id)).toEqual(["a1", "a2", "w1"]);
    });

    it("should ignore collapse while a search is active so matches stay visible", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.toggleServiceCollapse("api-server");
      wrapper.vm.searchQuery = "api-metrics";
      await nextTick();
      expect(wrapper.vm.flatRows).toHaveLength(1);
      expect(wrapper.vm.flatRows[0].id).toBe("a2");
    });

    it("should keep footer counts instance-accurate while collapsed", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.toggleServiceCollapse("api-server");
      await nextTick();
      expect(wrapper.vm.filteredGroupCount).toBe(2);
      expect(wrapper.vm.totalInstances).toBe(3);
    });

    it("should render a collapse toggle only on multi-instance services", async () => {
      wrapper = mountComponent();
      await flushPromises();
      await nextTick();
      const toggles = wrapper.findAll('[data-test="service-collapse-toggle"]');
      // api-server (2 instances) gets one toggle on its first row; the pivot
      // merge hides the continuation row's cell. worker (1 instance) gets none.
      expect(toggles).toHaveLength(1);
      await toggles[0].trigger("click");
      expect(wrapper.vm.flatRows[0].__type).toBe("summary");
      // Toggle click must not open the drawer
      expect(wrapper.vm.selectedService).toBeNull();
    });
  });

  describe("group-level sorting", () => {
    beforeEach(() => {
      vi.mocked(serviceStreamsService.getServicesList).mockResolvedValue({
        data: [
          { ...mockServicesResponse[0], id: "a1", last_seen: 3000000 },
          {
            ...mockServicesResponse[0],
            id: "a2",
            set_id: "default",
            disambiguation: {},
            last_seen: 1000000,
          },
          { ...mockServicesResponse[1], id: "w1", last_seen: 2000000 },
        ],
      } as any);
    });

    it("should sort groups by name ascending while keeping instances adjacent", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.onSortChange({ column: "service_name", order: "asc" });
      expect(wrapper.vm.flatRows.map((r: any) => r.service_name)).toEqual([
        "api-server",
        "api-server",
        "worker",
      ]);
      wrapper.vm.onSortChange({ column: "service_name", order: "desc" });
      expect(wrapper.vm.flatRows.map((r: any) => r.service_name)).toEqual([
        "worker",
        "api-server",
        "api-server",
      ]);
    });

    it("should fall back to last_seen desc when sort is cleared", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.onSortChange({ column: "service_name", order: "desc" });
      wrapper.vm.onSortChange({ column: "", order: "asc" });
      expect(wrapper.vm.sortColumn).toBe("last_seen");
      expect(wrapper.vm.sortOrder).toBe("desc");
      expect(wrapper.vm.flatRows.map((r: any) => r.id)).toEqual(["a1", "a2", "w1"]);
    });

    it("should toggle Last Seen order on header clicks despite OTable's clear-sort state", async () => {
      wrapper = mountComponent();
      await flushPromises();
      // Default: groups by max last_seen desc, instances latest-first
      expect(wrapper.vm.flatRows.map((r: any) => r.id)).toEqual(["a1", "a2", "w1"]);

      // First click: OTable's 3-state cycle emits "clear" (we start at desc).
      // It must act as the missing third state — ascending — not a no-op.
      const sortTrigger = () =>
        wrapper.find('[data-test="o2-table-th-last_seen"] [data-test="o2-table-th-sort-trigger"]');
      await sortTrigger().trigger("click");
      expect(wrapper.vm.sortOrder).toBe("asc");
      // Groups by max asc (worker 2000000 < api-server 3000000), instances oldest-first
      expect(wrapper.vm.flatRows.map((r: any) => r.id)).toEqual(["w1", "a2", "a1"]);

      // Second click: back to desc
      await sortTrigger().trigger("click");
      expect(wrapper.vm.sortOrder).toBe("desc");
      expect(wrapper.vm.flatRows.map((r: any) => r.id)).toEqual(["a1", "a2", "w1"]);
    });
  });

  describe("table wiring (merged name cell, no expansion)", () => {
    it("should inset the table from the page edge", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const table = wrapper.find('[data-test="services-list-table"]');
      expect(table.exists()).toBe(true);
      expect(table.element.closest(".px-page-edge")).not.toBeNull();
    });

    it("should pass pivotRowColumns for service_name and disable expansion", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const table = wrapper.findComponent(OTable);
      expect(table.exists()).toBe(true);
      expect(table.props("pivotRowColumns")).toEqual([{ name: "service_name" }]);
      expect(table.props("expansion")).toBe("none");
      expect(table.props("sorting")).toBe("server");
    });

    it("should render a shared service name once per group and every instance without expanding", async () => {
      vi.mocked(serviceStreamsService.getServicesList).mockResolvedValue({
        data: [
          { ...mockServicesResponse[0], id: "a1", set_id: "set-one", last_seen: 3000000 },
          {
            ...mockServicesResponse[0],
            id: "a2",
            set_id: "set-two",
            disambiguation: { "k8s-cluster": "staging" },
            last_seen: 1000000,
          },
          { ...mockServicesResponse[1], id: "w1", last_seen: 2000000 },
        ],
      } as any);
      wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // All three instance rows render with no expansion interaction: both
      // workload set ids of api-server are visible immediately.
      const cellText = (sel: string) =>
        wrapper.findAll(`[data-test="o2-table-cell-${sel}"]`).map((c) => c.text());
      expect(cellText("workload")).toEqual(["set-one", "set-two", "worker-set"]);

      // The pivot merge collapses the repeated name: "api-server" appears in
      // exactly one service_name cell even though it owns two rows.
      const nameCells = cellText("service_name");
      expect(nameCells).toHaveLength(3);
      expect(nameCells.filter((t) => t.includes("api-server"))).toHaveLength(1);
      expect(nameCells.filter((t) => t.includes("worker"))).toHaveLength(1);
    });

    it("should open the drawer on a single row click", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const row = wrapper.vm.flatRows[0];
      wrapper.vm.handleRowClick(row);
      await nextTick();
      expect(wrapper.vm.selectedService).toBeTruthy();
      expect(wrapper.vm.selectedService.id).toBe(row.id);
      const drawer = wrapper.findComponent({ name: "ODrawer" });
      expect(drawer.props("open")).toBe(true);
    });
  });

  describe("missing org error", () => {
    it("should set error when no org is selected", async () => {
      const storeNoOrg = createStore({
        state: { selectedOrganization: null, theme: "light" },
      });
      wrapper = mount(DiscoveredServices, {
        global: {
          plugins: [mockI18n],
          provide: { store: storeNoOrg },
          stubs: globalStubs,
        },
      });
      await flushPromises();
      expect(wrapper.vm.error).toBeTruthy();
    });
  });

  describe("loadServices on refresh", () => {
    it("should re-fetch services when loadServices is called", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const callCount = vi.mocked(serviceStreamsService.getServicesList).mock.calls.length;

      await wrapper.vm.loadServices();
      await flushPromises();

      expect(vi.mocked(serviceStreamsService.getServicesList).mock.calls.length).toBe(
        callCount + 1,
      );
    });
  });

  describe("ODrawer (service detail side panel) migration", () => {
    it("should render the ODrawer closed by default", async () => {
      wrapper = mountComponent();
      await flushPromises();
      await nextTick();
      const drawer = wrapper.findComponent({ name: "ODrawer" });
      expect(drawer.exists()).toBe(true);
      expect(drawer.props("open")).toBe(false);
    });

    it("should open the ODrawer when a service is selected", async () => {
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.selectedService = mockServicesResponse[0];
      await nextTick();
      await flushPromises();

      const drawer = wrapper.findComponent({ name: "ODrawer" });
      expect(drawer.exists()).toBe(true);
      expect(drawer.props("open")).toBe(true);
      expect(drawer.props("title")).toBe("api-server");
      expect(drawer.props("size")).toBe("lg");
    });

    it("should clear selectedService when ODrawer emits update:open false", async () => {
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.selectedService = mockServicesResponse[0];
      await nextTick();
      await flushPromises();
      expect(wrapper.vm.selectedService).not.toBeNull();

      const drawer = wrapper.findComponent({ name: "ODrawer" });
      drawer.vm.$emit("update:open", false);
      await nextTick();
      await flushPromises();

      expect(wrapper.vm.selectedService).toBeNull();
      expect(drawer.props("open")).toBe(false);
    });

    it("should keep selectedService unchanged when ODrawer emits update:open true", async () => {
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.selectedService = mockServicesResponse[0];
      await nextTick();
      await flushPromises();

      const drawer = wrapper.findComponent({ name: "ODrawer" });
      drawer.vm.$emit("update:open", true);
      await nextTick();
      await flushPromises();

      // update:open(true) must NOT null out the selection
      expect(wrapper.vm.selectedService).toEqual(mockServicesResponse[0]);
    });

    it("should render the header-right set_id badge slot inside the drawer", async () => {
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.selectedService = mockServicesResponse[0];
      await nextTick();
      await flushPromises();

      const drawer = wrapper.findComponent({ name: "ODrawer" });
      // header-right slot content (set-id-badge) renders inside the drawer stub
      expect(drawer.text()).toContain("api-server-set");
    });
  });

  describe("ConfirmDialog reset flow", () => {
    beforeEach(() => {
      vi.mocked(serviceStreamsService.resetServices).mockResolvedValue({
        data: { deleted_count: 5, note: "ok" },
      } as any);
    });

    it("should open ConfirmDialog when reset button triggers confirmResetServices", async () => {
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="confirm-dialog-stub"]').attributes("data-open")).toBe(
        "false",
      );

      wrapper.vm.confirmResetServices();
      await flushPromises();

      expect(wrapper.vm.confirmResetOpen).toBe(true);
      expect(wrapper.find('[data-test="confirm-dialog-stub"]').attributes("data-open")).toBe(
        "true",
      );
    });

    it("should call resetServices when ConfirmDialog emits update:ok", async () => {
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.confirmResetOpen = true;
      await flushPromises();

      await wrapper.find('[data-test="confirm-dialog-ok"]').trigger("click");
      await flushPromises();

      expect(serviceStreamsService.resetServices).toHaveBeenCalledWith("test-org");
    });

    it("should close ConfirmDialog when it emits update:cancel", async () => {
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.confirmResetOpen = true;
      await flushPromises();

      await wrapper.find('[data-test="confirm-dialog-cancel"]').trigger("click");
      await flushPromises();

      expect(wrapper.vm.confirmResetOpen).toBe(false);
      expect(serviceStreamsService.resetServices).not.toHaveBeenCalled();
    });

    it("should toggle resetting flag and reload services on successful reset", async () => {
      wrapper = mountComponent();
      await flushPromises();
      vi.mocked(serviceStreamsService.getServicesList).mockClear();

      await wrapper.vm.doResetServices();
      await flushPromises();

      expect(wrapper.vm.resetting).toBe(false);
      expect(serviceStreamsService.getServicesList).toHaveBeenCalledTimes(1);
    });

    it("should not throw and reset resetting flag when resetServices fails", async () => {
      vi.mocked(serviceStreamsService.resetServices).mockRejectedValueOnce(new Error("boom"));
      wrapper = mountComponent();
      await flushPromises();

      await wrapper.vm.doResetServices();
      await flushPromises();

      expect(wrapper.vm.resetting).toBe(false);
    });

    it("should throw via no-org branch when doResetServices is called without an org", async () => {
      const storeNoOrg = createStore({
        state: { selectedOrganization: null, theme: "light" },
      });
      wrapper = mount(DiscoveredServices, {
        global: {
          plugins: [mockI18n],
          provide: { store: storeNoOrg },
          stubs: globalStubs,
        },
      });
      await flushPromises();

      await wrapper.vm.doResetServices();
      await flushPromises();

      // resetServices must not be called when org is missing
      expect(serviceStreamsService.resetServices).not.toHaveBeenCalled();
      expect(wrapper.vm.resetting).toBe(false);
    });
  });
});
