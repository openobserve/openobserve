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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import DiscoveredServices from "./DiscoveredServices.vue";

installQuasar();

vi.mock("@/services/service_streams", () => ({
  default: {
    getServicesList: vi.fn(),
    resetServices: vi.fn(),
  },
}));

const notifyMock = vi.fn();
vi.mock("quasar", async () => {
  const actual = await vi.importActual<any>("quasar");
  return {
    ...actual,
    useQuasar: () => ({ notify: notifyMock }),
  };
});

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
  "q-spinner-hourglass": true,
  "OIcon": { template: "<span />", props: ["name", "size", "color"] },
  "q-btn": { template: '<button :data-test="$attrs[\'data-test\']" @click="$emit(\'click\')"><slot /></button>', props: ["label", "flat", "dense", "color", "loading", "icon"], emits: ["click"] },
  "q-btn-toggle": { template: "<div />", props: ["modelValue", "options", "dense", "unelevated"] },
  "q-input": { template: '<input :placeholder="placeholder" />', props: ["modelValue", "dense", "filled", "placeholder", "clearable"] },
  "q-select": { template: "<select />", props: ["modelValue", "dense", "filled", "options", "emitValue", "mapOptions"] },
  "q-table": { template: '<div class="q-table"><slot name="no-data" /></div>', props: ["rows", "columns", "pagination", "filter", "loading", "dense"] },
  "q-tooltip": { template: "<span><slot /></span>" },
  "q-chip": { template: "<span class='q-chip'><slot /></span>", props: ["dense", "size", "color", "textColor"] },
  "q-badge": { template: "<span><slot /></span>", props: ["color"] },
  "q-card": { template: "<div><slot /></div>" },
  "q-card-section": { template: "<div><slot /></div>" },
  "q-card-actions": { template: "<div><slot /></div>" },
  "q-list": { template: "<div><slot /></div>" },
  "q-item": { template: "<div><slot /></div>" },
  "q-item-section": { template: "<div><slot /></div>" },
  "q-item-label": { template: "<div><slot /></div>" },
  "q-separator": true,
  "q-expansion-item": { template: "<div><slot /></div>", props: ["label", "icon", "dense"] },
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
      vi.mocked(serviceStreamsService.getServicesList).mockRejectedValueOnce(
        new Error("fail"),
      );
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

  describe("filteredGroups computed", () => {
    it("should return all groups when searchQuery is empty", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.searchQuery = "";
      expect(wrapper.vm.filteredGroups).toHaveLength(2);
    });

    it("should filter by search query on service_name", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.searchQuery = "api-server";
      const filtered = wrapper.vm.filteredGroups;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].service_name).toContain("api-server");
    });

    it("should filter by dimension key/value", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.filterKey = "k8s-statefulset";
      wrapper.vm.filterValue = "worker";
      const filtered = wrapper.vm.filteredGroups;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].service_name).toBe("worker");
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

      expect(vi.mocked(serviceStreamsService.getServicesList).mock.calls.length).toBe(callCount + 1);
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

      expect(wrapper.find('[data-test="confirm-dialog-stub"]').attributes("data-open")).toBe("false");

      wrapper.vm.confirmResetServices();
      await flushPromises();

      expect(wrapper.vm.confirmResetOpen).toBe(true);
      expect(wrapper.find('[data-test="confirm-dialog-stub"]').attributes("data-open")).toBe("true");
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
      vi.mocked(serviceStreamsService.resetServices).mockRejectedValueOnce(
        new Error("boom"),
      );
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
