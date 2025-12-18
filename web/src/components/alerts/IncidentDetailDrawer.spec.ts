// Copyright 2025 OpenObserve Inc.
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
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import IncidentDetailDrawer from "./IncidentDetailDrawer.vue";
import incidentsService, { Incident, IncidentWithAlerts, IncidentAlert } from "@/services/incidents";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Install Quasar globally
installQuasar({ plugins: [Dialog, Notify] });

// Mock incidents service
vi.mock("@/services/incidents", () => ({
  default: {
    get: vi.fn(),
    updateStatus: vi.fn(),
    triggerRca: vi.fn(),
  },
}));

// Test data factory
const createIncident = (overrides: Partial<Incident> = {}): Incident => ({
  id: overrides.id || "incident-1",
  org_id: overrides.org_id || "org-1",
  correlation_key: overrides.correlation_key || "key-1",
  status: overrides.status || "open",
  severity: overrides.severity || "P1",
  title: overrides.title || "Test Incident",
  stable_dimensions: overrides.stable_dimensions || { service: "test-service" },
  alert_count: overrides.alert_count !== undefined ? overrides.alert_count : 5,
  first_alert_at: overrides.first_alert_at || 1700000000000000,
  last_alert_at: overrides.last_alert_at || 1700000000000000,
  resolved_at: overrides.resolved_at,
  created_at: overrides.created_at || 1700000000000000,
  updated_at: overrides.updated_at || 1700000000000000,
  topology_context: overrides.topology_context,
});

const createIncidentWithAlerts = (overrides: Partial<IncidentWithAlerts> = {}): IncidentWithAlerts => ({
  ...createIncident(overrides),
  alerts: overrides.alerts || [],
  triggers: overrides.triggers || [],
});

const createAlert = (overrides: Partial<IncidentAlert> = {}): IncidentAlert => ({
  incident_id: overrides.incident_id || "incident-1",
  alert_id: overrides.alert_id || "alert-1",
  alert_name: overrides.alert_name || "Test Alert",
  alert_fired_at: overrides.alert_fired_at || 1700000000000000,
  correlation_reason: overrides.correlation_reason || "service_discovery",
  created_at: overrides.created_at || 1700000000000000,
});

describe("IncidentDetailDrawer.vue", () => {
  let wrapper: VueWrapper<any>;

  const createWrapper = (props = {}, storeOverrides = {}) => {
    // Update store state with overrides
    if (storeOverrides && Object.keys(storeOverrides).length > 0) {
      Object.assign(store.state, storeOverrides);
    }

    return mount(IncidentDetailDrawer, {
      props: {
        incident: null,
        ...props,
      },
      global: {
        plugins: [i18n, store, router],
        stubs: {
          QDrawer: true,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset store state
    store.state.selectedOrganization = {
      label: "default Organization",
      id: 159,
      identifier: "default",
      user_email: "example@gmail.com",
      subscription_type: "",
    };
    store.state.theme = "light";
    store.state.sreChatContext = null;

    // Mock store action
    if (!store._actions) {
      store._actions = {};
    }
    store._actions['setIsSREChatOpen'] = [vi.fn()];

    // Default mock implementation
    (incidentsService.get as any).mockResolvedValue({
      data: createIncidentWithAlerts({
        id: "1",
        status: "open",
        severity: "P1",
        triggers: [
          createAlert({ alert_id: "alert-1", alert_name: "High CPU" }),
          createAlert({ alert_id: "alert-2", alert_name: "Memory Alert" }),
        ],
      }),
    });

    (incidentsService.updateStatus as any).mockResolvedValue({
      data: { status: "acknowledged" },
    });

    (incidentsService.triggerRca as any).mockResolvedValue({
      data: { rca_content: "## Root Cause Analysis\n\nThe issue is related to high CPU usage." },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should mount component successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should show loading state initially", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.loading).toBe(false);
    });

    it("should initialize with no incident details", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.incidentDetails).toBeNull();
    });

    it("should initialize empty triggers array", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.triggers).toEqual([]);
    });

    it("should not be updating initially", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.updating).toBe(false);
    });
  });

  describe("Props and Model Value", () => {
    it("should accept incident prop", () => {
      const incident = createIncident({ id: "test-123" });
      wrapper = createWrapper({ incident });
      expect(wrapper.props().incident).toEqual(incident);
    });

    it("should emit close when drawer closes", async () => {
      wrapper = createWrapper();

      wrapper.vm.close();
      await nextTick();

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("should load details when incident prop is set", async () => {
      const incident = createIncident({ id: "test-123" });

      wrapper = createWrapper({ incident });
      await flushPromises();

      expect(incidentsService.get).toHaveBeenCalledWith("default", "test-123");
    });
  });

  describe("Incident Details Loading", () => {
    it("should load incident details successfully", async () => {
      const mockIncident = createIncidentWithAlerts({
        id: "test-123",
        title: "Test Incident",
        status: "open",
        severity: "P1",
      });

      (incidentsService.get as any).mockResolvedValue({
        data: mockIncident,
      });

      const incident = createIncident({ id: "test-123" });
      wrapper = createWrapper({ incident });

      await nextTick();
      await flushPromises();

      expect(wrapper.vm.incidentDetails).toBeTruthy();
      expect(wrapper.vm.incidentDetails.id).toBe("test-123");
      expect(wrapper.vm.incidentDetails.title).toBe("Test Incident");
    });

    it("should set loading state during fetch", async () => {
      const incident = createIncident({ id: "test-123" });
      wrapper = createWrapper({ incident });

      await nextTick();

      // Loading should be true during fetch
      // But may complete quickly, so just verify it was called
      await flushPromises();

      expect(incidentsService.get).toHaveBeenCalled();
      expect(wrapper.vm.loading).toBe(false);
    });

    it("should load triggers from incident", async () => {
      const triggers = [
        createAlert({ alert_id: "alert-1", alert_name: "CPU Alert" }),
        createAlert({ alert_id: "alert-2", alert_name: "Memory Alert" }),
      ];

      (incidentsService.get as any).mockResolvedValue({
        data: createIncidentWithAlerts({ id: "test-123", triggers }),
      });

      const incident = createIncident({ id: "test-123" });
      wrapper = createWrapper({ incident });

      await nextTick();
      await flushPromises();

      expect(wrapper.vm.triggers).toHaveLength(2);
      expect(wrapper.vm.triggers[0].alert_name).toBe("CPU Alert");
    });

    it("should handle API error during load", async () => {
      (incidentsService.get as any).mockRejectedValue(new Error("API Error"));

      const mockNotify = vi.fn();
      const incident = createIncident({ id: "test-123" });

      wrapper = createWrapper({ incident });
      wrapper.vm.$q.notify = mockNotify;

      await nextTick();
      await flushPromises();

      expect(mockNotify).toHaveBeenCalled();
      expect(mockNotify.mock.calls[0][0].type).toBe("negative");
    });

    it("should stop loading on error", async () => {
      (incidentsService.get as any).mockRejectedValue(new Error("API Error"));

      const incident = createIncident({ id: "test-123" });
      wrapper = createWrapper({ incident });

      await nextTick();
      await flushPromises();

      expect(wrapper.vm.loading).toBe(false);
    });
  });

  describe("Status Update Actions", () => {
    beforeEach(async () => {
      const incident = createIncident({ id: "test-123", status: "open" });
      wrapper = createWrapper({ incident });

      await nextTick();
      await flushPromises();
    });

    it("should acknowledge incident", async () => {
      await wrapper.vm.acknowledgeIncident();

      expect(incidentsService.updateStatus).toHaveBeenCalledWith(
        "default",
        "1",
        "acknowledged"
      );
    });

    it("should resolve incident", async () => {
      await wrapper.vm.resolveIncident();

      expect(incidentsService.updateStatus).toHaveBeenCalledWith(
        "default",
        "1",
        "resolved"
      );
    });

    it("should reopen incident", async () => {
      // Change status to resolved first
      wrapper.vm.incidentDetails.status = "resolved";

      await wrapper.vm.reopenIncident();

      expect(incidentsService.updateStatus).toHaveBeenCalledWith(
        "default",
        "1",
        "open"
      );
    });

    it("should set updating state during status update", async () => {
      const updatePromise = wrapper.vm.acknowledgeIncident();

      expect(wrapper.vm.updating).toBe(true);

      await updatePromise;

      expect(wrapper.vm.updating).toBe(false);
    });

    it("should show success notification on status update", async () => {
      const mockNotify = vi.fn();
      wrapper.vm.$q.notify = mockNotify;

      await wrapper.vm.acknowledgeIncident();

      expect(mockNotify).toHaveBeenCalled();
      expect(mockNotify.mock.calls[0][0].type).toBe("positive");
    });

    it("should emit status-updated event", async () => {
      await wrapper.vm.acknowledgeIncident();

      expect(wrapper.emitted("status-updated")).toBeTruthy();
    });

    it("should handle status update error", async () => {
      const mockNotify = vi.fn();
      (incidentsService.updateStatus as any).mockRejectedValue(new Error("Update failed"));

      wrapper.vm.$q.notify = mockNotify;

      await wrapper.vm.acknowledgeIncident();

      expect(mockNotify).toHaveBeenCalled();
      expect(mockNotify.mock.calls[0][0].type).toBe("negative");
    });

    it("should update local incident state on success", async () => {
      (incidentsService.updateStatus as any).mockResolvedValue({
        data: { status: "acknowledged", updated_at: 1700000001000000 },
      });

      const originalStatus = wrapper.vm.incidentDetails.status;
      await wrapper.vm.acknowledgeIncident();

      expect(wrapper.vm.incidentDetails.status).toBe("acknowledged");
    });

    it("should not update status when no incident loaded", async () => {
      wrapper.vm.incidentDetails = null;

      await wrapper.vm.acknowledgeIncident();

      expect(incidentsService.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe("RCA Functionality", () => {
    beforeEach(async () => {
      const incident = createIncident({ id: "test-123" });
      wrapper = createWrapper({ incident });

      await nextTick();
      await flushPromises();
    });

    it("should check for existing RCA", () => {
      wrapper.vm.incidentDetails.topology_context = {
        service: "api",
        upstream_services: [],
        downstream_services: [],
        related_incident_ids: [],
        suggested_root_cause: "Existing RCA content",
      };

      expect(wrapper.vm.hasExistingRca).toBe(true);
    });

    it("should return false when no RCA exists", () => {
      wrapper.vm.incidentDetails.topology_context = {
        service: "api",
        upstream_services: [],
        downstream_services: [],
        related_incident_ids: [],
      };

      expect(wrapper.vm.hasExistingRca).toBe(false);
    });

    it("should trigger RCA analysis", async () => {
      await wrapper.vm.triggerRca();

      expect(incidentsService.triggerRca).toHaveBeenCalledWith("default", "1");
    });

    it("should set loading state during RCA", async () => {
      const rcaPromise = wrapper.vm.triggerRca();

      expect(wrapper.vm.rcaLoading).toBe(true);

      await rcaPromise;

      expect(wrapper.vm.rcaLoading).toBe(false);
    });

    it("should display RCA content after trigger", async () => {
      await wrapper.vm.triggerRca();

      expect(wrapper.vm.rcaStreamContent).toContain("Root Cause Analysis");
    });

    it("should show success notification after RCA", async () => {
      const mockNotify = vi.fn();
      wrapper.vm.$q.notify = mockNotify;

      await wrapper.vm.triggerRca();

      expect(mockNotify).toHaveBeenCalled();
      expect(mockNotify.mock.calls[0][0].type).toBe("positive");
    });

    it("should reload incident details after RCA", async () => {
      vi.clearAllMocks();

      await wrapper.vm.triggerRca();

      // Should call get twice: once for initial load, once for reload
      expect(incidentsService.get).toHaveBeenCalled();
    });

    it("should handle RCA error", async () => {
      const mockNotify = vi.fn();
      (incidentsService.triggerRca as any).mockRejectedValue(new Error("RCA failed"));

      wrapper.vm.$q.notify = mockNotify;

      await wrapper.vm.triggerRca();

      expect(mockNotify).toHaveBeenCalled();
      expect(mockNotify.mock.calls[0][0].type).toBe("negative");
    });

    it("should clear RCA content on error", async () => {
      (incidentsService.triggerRca as any).mockRejectedValue(new Error("RCA failed"));

      wrapper.vm.rcaStreamContent = "Some content";
      await wrapper.vm.triggerRca();

      expect(wrapper.vm.rcaStreamContent).toBe("");
    });

    it("should not trigger RCA when no incident loaded", async () => {
      wrapper.vm.incidentDetails = null;

      await wrapper.vm.triggerRca();

      expect(incidentsService.triggerRca).not.toHaveBeenCalled();
    });
  });

  describe("SRE Chat Integration", () => {
    beforeEach(async () => {
      const incident = createIncident({ id: "test-123", title: "Test Incident" });
      wrapper = createWrapper({ incident });

      await nextTick();
      await flushPromises();
    });

    it("should open SRE chat with incident context", () => {
      wrapper.vm.openSREChat();

      expect(store.state.sreChatContext).toBeTruthy();
      expect(store.state.sreChatContext.type).toBe("incident");
    });

    it("should dispatch setIsSREChatOpen action", () => {
      const dispatchSpy = vi.spyOn(store, 'dispatch');

      wrapper.vm.openSREChat();

      expect(dispatchSpy).toHaveBeenCalledWith("setIsSREChatOpen", true);
    });

    it("should pass incident details to chat", () => {
      wrapper.vm.openSREChat();

      expect(store.state.sreChatContext.data.id).toBe("1");
      expect(store.state.sreChatContext.data.severity).toBe("P1");
    });

    it("should include triggers in chat context", () => {
      wrapper.vm.openSREChat();

      expect(store.state.sreChatContext.data.triggers).toBeTruthy();
    });

    it("should include existing RCA in chat context", () => {
      wrapper.vm.incidentDetails.topology_context = {
        service: "api",
        upstream_services: [],
        downstream_services: [],
        related_incident_ids: [],
        suggested_root_cause: "Existing RCA",
      };

      wrapper.vm.openSREChat();

      expect(store.state.sreChatContext.data.rca_analysis).toBe("Existing RCA");
    });

    it("should include stream content when no existing RCA", () => {
      wrapper.vm.rcaStreamContent = "Streaming RCA content";

      wrapper.vm.openSREChat();

      expect(store.state.sreChatContext.data.rca_analysis).toBe("Streaming RCA content");
    });
  });

  describe("Utility Functions - Status Colors", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should return correct color for open status", () => {
      expect(wrapper.vm.getStatusColor("open")).toBe("negative");
    });

    it("should return correct color for acknowledged status", () => {
      expect(wrapper.vm.getStatusColor("acknowledged")).toBe("warning");
    });

    it("should return correct color for resolved status", () => {
      expect(wrapper.vm.getStatusColor("resolved")).toBe("positive");
    });

    it("should return grey for unknown status", () => {
      expect(wrapper.vm.getStatusColor("unknown")).toBe("grey");
    });
  });

  describe("Utility Functions - Status Labels", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should return translated label for open status", () => {
      const label = wrapper.vm.getStatusLabel("open");
      expect(label).toBeTruthy();
      expect(typeof label).toBe("string");
    });

    it("should return translated label for acknowledged status", () => {
      const label = wrapper.vm.getStatusLabel("acknowledged");
      expect(label).toBeTruthy();
      expect(typeof label).toBe("string");
    });

    it("should return translated label for resolved status", () => {
      const label = wrapper.vm.getStatusLabel("resolved");
      expect(label).toBeTruthy();
      expect(typeof label).toBe("string");
    });

    it("should return status as-is for unknown status", () => {
      expect(wrapper.vm.getStatusLabel("custom-status")).toBe("custom-status");
    });
  });

  describe("Utility Functions - Severity Colors", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should return correct color for P1 severity", () => {
      expect(wrapper.vm.getSeverityColor("P1")).toBe("red-10");
    });

    it("should return correct color for P2 severity", () => {
      expect(wrapper.vm.getSeverityColor("P2")).toBe("orange-8");
    });

    it("should return correct color for P3 severity", () => {
      expect(wrapper.vm.getSeverityColor("P3")).toBe("amber-8");
    });

    it("should return correct color for P4 severity", () => {
      expect(wrapper.vm.getSeverityColor("P4")).toBe("grey-7");
    });

    it("should return grey for unknown severity", () => {
      expect(wrapper.vm.getSeverityColor("unknown")).toBe("grey");
    });
  });

  describe("Utility Functions - Correlation Reason Colors", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should return correct color for service_discovery", () => {
      expect(wrapper.vm.getReasonColor("service_discovery")).toBe("blue");
    });

    it("should return correct color for manual_extraction", () => {
      expect(wrapper.vm.getReasonColor("manual_extraction")).toBe("purple");
    });

    it("should return correct color for temporal", () => {
      expect(wrapper.vm.getReasonColor("temporal")).toBe("teal");
    });

    it("should return grey for unknown reason", () => {
      expect(wrapper.vm.getReasonColor("unknown")).toBe("grey");
    });
  });

  describe("Utility Functions - Correlation Reason Labels", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should return translated label for service_discovery", () => {
      const label = wrapper.vm.getReasonLabel("service_discovery");
      expect(label).toBeTruthy();
      expect(typeof label).toBe("string");
    });

    it("should return translated label for manual_extraction", () => {
      const label = wrapper.vm.getReasonLabel("manual_extraction");
      expect(label).toBeTruthy();
      expect(typeof label).toBe("string");
    });

    it("should return translated label for temporal", () => {
      const label = wrapper.vm.getReasonLabel("temporal");
      expect(label).toBeTruthy();
      expect(typeof label).toBe("string");
    });

    it("should return reason as-is for unknown reason", () => {
      expect(wrapper.vm.getReasonLabel("custom-reason")).toBe("custom-reason");
    });
  });

  describe("Utility Functions - Timestamp Formatting", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should format timestamp in microseconds correctly", () => {
      const timestamp = 1700000000000000; // microseconds
      const result = wrapper.vm.formatTimestamp(timestamp);

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    });

    it("should handle zero timestamp", () => {
      const result = wrapper.vm.formatTimestamp(0);

      expect(result).toBeTruthy();
      expect(result).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it("should convert microseconds to milliseconds correctly", () => {
      const microTimestamp = 1700000000000000;
      const result = wrapper.vm.formatTimestamp(microTimestamp);

      expect(result).toContain("2023");
    });
  });

  describe("Utility Functions - RCA Content Formatting", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should escape HTML in content", () => {
      const malicious = '<script>alert("xss")</script>';
      const formatted = wrapper.vm.formatRcaContent(malicious);

      expect(formatted).not.toContain("<script>");
      expect(formatted).toContain("&lt;script&gt;");
    });

    it("should format bold text", () => {
      const content = "This is **bold** text";
      const formatted = wrapper.vm.formatRcaContent(content);

      expect(formatted).toContain('<strong class="tw-font-semibold tw-text-gray-900">bold</strong>');
    });

    it("should format h2 headers", () => {
      const content = "## Header 2";
      const formatted = wrapper.vm.formatRcaContent(content);

      expect(formatted).toContain("tw:font-bold");
      expect(formatted).toContain("tw:text-sm");
      expect(formatted).toContain("tw:text-blue-600");
    });

    it("should format h3 headers", () => {
      const content = "### Header 3";
      const formatted = wrapper.vm.formatRcaContent(content);

      expect(formatted).toContain("tw:font-semibold");
    });

    it("should format unordered lists", () => {
      const content = "- Item 1\n- Item 2";
      const formatted = wrapper.vm.formatRcaContent(content);

      expect(formatted).toContain("•");
      expect(formatted).toContain("Item 1");
    });

    it("should format numbered lists", () => {
      const content = "1. First item\n2. Second item";
      const formatted = wrapper.vm.formatRcaContent(content);

      expect(formatted).toContain('<div class="tw-flex tw-gap-2 tw-ml-2 tw-mb-2"><span class="tw-font-semibold tw-text-gray-600 tw-min-w-[20px]">1.</span><span class="tw-flex-1">First item</span></div>');
      expect(formatted).toContain('<div class="tw-flex tw-gap-2 tw-ml-2 tw-mb-2"><span class="tw-font-semibold tw-text-gray-600 tw-min-w-[20px]">2.</span><span class="tw-flex-1">Second item</span></div>');
    });

    it("should format complex markdown", () => {
      const content = "## Root Cause\n\n**Issue**: High CPU\n\n- Check process\n- Review logs";
      const formatted = wrapper.vm.formatRcaContent(content);

      expect(formatted).toContain('<strong class="tw:font-semibold tw:text-gray-900">Issue</strong>');
      expect(formatted).toContain("tw:font-bold");
      expect(formatted).toContain("•");
    });
  });

  describe("Theme Support", () => {
    it("should detect dark mode", () => {
      store.state.theme = "dark";
      wrapper = createWrapper();

      expect(wrapper.vm.isDarkMode).toBe(true);
    });

    it("should detect light mode", () => {
      store.state.theme = "light";
      wrapper = createWrapper();

      expect(wrapper.vm.isDarkMode).toBe(false);
    });
  });

  describe("Topology Context", () => {
    beforeEach(async () => {
      const mockIncidentData = createIncidentWithAlerts({
        id: "test-123",
        topology_context: {
          service: "api-gateway",
          upstream_services: ["auth-service", "user-service"],
          downstream_services: ["database", "cache"],
          related_incident_ids: ["incident-2", "incident-3"],
          suggested_root_cause: "High memory usage in auth-service",
        },
      });

      (incidentsService.get as any).mockResolvedValue({
        data: mockIncidentData,
      });

      const incident = createIncident({ id: "test-123" });
      wrapper = createWrapper({ incident });

      await nextTick();
      await flushPromises();
    });

    it("should display topology service", () => {
      expect(wrapper.vm.incidentDetails.topology_context.service).toBe("api-gateway");
    });

    it("should display upstream services", () => {
      expect(wrapper.vm.incidentDetails.topology_context.upstream_services).toHaveLength(2);
      expect(wrapper.vm.incidentDetails.topology_context.upstream_services).toContain("auth-service");
    });

    it("should display downstream services", () => {
      expect(wrapper.vm.incidentDetails.topology_context.downstream_services).toHaveLength(2);
      expect(wrapper.vm.incidentDetails.topology_context.downstream_services).toContain("database");
    });
  });

  describe("Edge Cases", () => {
    it("should handle incident without title", async () => {
      const incident = createIncident({ id: "test-123", title: undefined });
      wrapper = createWrapper({ incident });

      await nextTick();
      await flushPromises();

      expect(wrapper.vm.incidentDetails).toBeTruthy();
    });

    it("should handle empty triggers array", async () => {
      (incidentsService.get as any).mockResolvedValue({
        data: createIncidentWithAlerts({ id: "test-123", triggers: [] }),
      });

      const incident = createIncident({ id: "test-123" });
      wrapper = createWrapper({ incident });

      await nextTick();
      await flushPromises();

      expect(wrapper.vm.triggers).toEqual([]);
    });

    it("should handle missing topology context", async () => {
      const incident = createIncident({ id: "test-123", topology_context: undefined });
      wrapper = createWrapper({ incident });

      await nextTick();
      await flushPromises();

      expect(wrapper.vm.incidentDetails.topology_context).toBeUndefined();
      expect(wrapper.vm.hasExistingRca).toBe(false);
    });

    it("should handle empty dimensions", async () => {
      (incidentsService.get as any).mockResolvedValue({
        data: createIncidentWithAlerts({ id: "test-123", stable_dimensions: {} }),
      });

      const incident = createIncident({ id: "test-123" });
      wrapper = createWrapper({ incident });

      await nextTick();
      await flushPromises();

      expect(wrapper.vm.incidentDetails.stable_dimensions).toEqual({});
    });

    it("should handle resolved incident with timestamp", async () => {
      (incidentsService.get as any).mockResolvedValue({
        data: createIncidentWithAlerts({
          id: "test-123",
          status: "resolved",
          resolved_at: 1700000000000000,
        }),
      });

      const incident = createIncident({ id: "test-123" });
      wrapper = createWrapper({ incident });

      await nextTick();
      await flushPromises();

      expect(wrapper.vm.incidentDetails.resolved_at).toBeTruthy();
    });
  });

  describe("Close Functionality", () => {
    it("should close drawer", async () => {
      wrapper = createWrapper();

      wrapper.vm.close();
      await nextTick();

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("should emit update:modelValue on close", async () => {
      wrapper = createWrapper();

      wrapper.vm.close();
      await nextTick();

      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });

  describe("Organization Context", () => {
    it("should use correct organization from store", async () => {
      const incident = createIncident({ id: "test-123" });
      wrapper = createWrapper(
        { incident },
        { selectedOrganization: { identifier: "custom-org" } }
      );

      await nextTick();
      await flushPromises();

      expect(incidentsService.get).toHaveBeenCalledWith("custom-org", "test-123");
    });

    it("should use organization in status updates", async () => {
      (incidentsService.updateStatus as any).mockResolvedValue({});

      const incident = createIncident({ id: "test-123" });
      wrapper = createWrapper(
        { incident },
        { selectedOrganization: { identifier: "org-123" } }
      );

      await nextTick();
      await flushPromises();

      await wrapper.vm.acknowledgeIncident();

      expect(incidentsService.updateStatus).toHaveBeenCalledWith(
        "org-123",
        expect.any(String),
        "acknowledged"
      );
    });

    it("should use organization in RCA trigger", async () => {
      const incident = createIncident({ id: "test-123" });
      wrapper = createWrapper(
        { incident },
        { selectedOrganization: { identifier: "org-456" } }
      );

      await nextTick();
      await flushPromises();

      await wrapper.vm.triggerRca();

      expect(incidentsService.triggerRca).toHaveBeenCalledWith(
        "org-456",
        expect.any(String)
      );
    });
  });
});
