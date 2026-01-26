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

// Mock config to enable enterprise routes - must be first before any imports
vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "true",
    isCloud: "false",
  },
}));

// Mock incidents service
vi.mock("@/services/incidents", () => ({
  default: {
    list: vi.fn(),
    updateStatus: vi.fn(),
  },
}));

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import IncidentList from "./IncidentList.vue";
import incidentsService, { Incident } from "@/services/incidents";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Install Quasar globally
installQuasar({ plugins: [Dialog, Notify] });

// Test data factory
const createIncident = (overrides: Partial<Incident> = {}): Incident => ({
  id: overrides.id || "incident-1",
  status: overrides.status || "open",
  severity: overrides.severity || "P1",
  title: overrides.title || "Test Incident",
  stable_dimensions: overrides.stable_dimensions || { service: "test-service" },
  alert_count: overrides.alert_count !== undefined ? overrides.alert_count : 5,
  last_alert_at: overrides.last_alert_at || 1700000000000000,
  created_at: overrides.created_at || 1700000000000000,
  updated_at: overrides.updated_at || 1700000000000000,
  related_incidents: overrides.related_incidents || [],
  rca_summary: overrides.rca_summary || null,
});

describe("IncidentList.vue", () => {
  let wrapper: VueWrapper<any>;

  const createWrapper = (storeOverrides = {}) => {
    // Update store state with overrides
    if (storeOverrides && Object.keys(storeOverrides).length > 0) {
      Object.assign(store.state, storeOverrides);
    }

    return mount(IncidentList, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          IncidentDetailDrawer: true,
          QTablePagination: true,
          O2AIContextAddBtn: true,
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
    store.state.sreChatContext = null;

    // Mock store action
    if (!store._actions) {
      store._actions = {};
    }
    store._actions['setIsSREChatOpen'] = [vi.fn()];

    // Default mock implementation
    (incidentsService.list as any).mockResolvedValue({
      data: {
        incidents: [
          createIncident({ id: "1", status: "open", severity: "P1" }),
          createIncident({ id: "2", status: "acknowledged", severity: "P2" }),
          createIncident({ id: "3", status: "resolved", severity: "P3" }),
        ],
        total: 3,
      },
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
      expect(wrapper.find('[data-test="incident-list"]').exists()).toBe(true);
    });

    it("should load incidents on mount", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(incidentsService.list).toHaveBeenCalledWith(
        "default",
        undefined,
        1000,
        0,
        undefined
      );
      expect(wrapper.vm.incidents).toHaveLength(3);
    });

    it("should initialize with correct default pagination", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.pagination).toEqual({
        sortBy: "last_alert_at",
        descending: true,
        page: 1,
        rowsPerPage: 20,
        rowsNumber: 0,
      });
    });

    it("should initialize with empty filters", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.statusFilter).toEqual([]);
      expect(wrapper.vm.severityFilter).toEqual([]);
    });

    it("should set loading state during data fetch", async () => {
      wrapper = createWrapper();

      expect(wrapper.vm.loading).toBe(true);
      await flushPromises();
      expect(wrapper.vm.loading).toBe(false);
    });

    it("should update pagination rowsNumber after loading", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.pagination.rowsNumber).toBe(3);
    });
  });

  describe("Incident Data Loading", () => {
    it("should handle successful data load", async () => {
      const mockIncidents = [
        createIncident({ id: "1", title: "Incident 1" }),
        createIncident({ id: "2", title: "Incident 2" }),
      ];

      (incidentsService.list as any).mockResolvedValue({
        data: { incidents: mockIncidents, total: 2 },
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.incidents).toHaveLength(2);
      expect(wrapper.vm.incidents[0].title).toBe("Incident 1");
    });

    it("should handle empty incidents list", async () => {
      (incidentsService.list as any).mockResolvedValue({
        data: { incidents: [], total: 0 },
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.incidents).toHaveLength(0);
      expect(wrapper.vm.pagination.rowsNumber).toBe(0);
    });

    it("should handle API error during load", async () => {
      const mockNotify = vi.fn();
      (incidentsService.list as any).mockRejectedValue(new Error("API Error"));

      wrapper = createWrapper();
      wrapper.vm.$q.notify = mockNotify;

      await flushPromises();

      expect(mockNotify).toHaveBeenCalled();
      expect(mockNotify.mock.calls[0][0].type).toBe("negative");
    });

    it("should stop loading on error", async () => {
      (incidentsService.list as any).mockRejectedValue(new Error("API Error"));

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.loading).toBe(false);
    });
  });

  describe("Filter Functionality - Status", () => {
    beforeEach(async () => {
      (incidentsService.list as any).mockResolvedValue({
        data: {
          incidents: [
            createIncident({ id: "1", status: "open" }),
            createIncident({ id: "2", status: "acknowledged" }),
            createIncident({ id: "3", status: "resolved" }),
            createIncident({ id: "4", status: "open" }),
          ],
          total: 4,
        },
      });

      wrapper = createWrapper();
      await flushPromises();
    });

    it("should show all incidents when no filter is active", () => {
      expect(wrapper.vm.filteredIncidents).toHaveLength(4);
    });

    it("should toggle status filter on", () => {
      wrapper.vm.toggleStatusFilter("open");

      expect(wrapper.vm.statusFilter).toContain("open");
    });

    it("should toggle status filter off", () => {
      wrapper.vm.toggleStatusFilter("open");
      expect(wrapper.vm.statusFilter).toContain("open");

      wrapper.vm.toggleStatusFilter("open");
      expect(wrapper.vm.statusFilter).not.toContain("open");
    });

    it("should filter incidents by open status", () => {
      wrapper.vm.statusFilter = ["open"];

      const filtered = wrapper.vm.filteredIncidents;
      expect(filtered).toHaveLength(2);
      expect(filtered.every((i: Incident) => i.status === "open")).toBe(true);
    });

    it("should filter incidents by acknowledged status", () => {
      wrapper.vm.statusFilter = ["acknowledged"];

      const filtered = wrapper.vm.filteredIncidents;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].status).toBe("acknowledged");
    });

    it("should filter by multiple statuses", () => {
      wrapper.vm.statusFilter = ["open", "acknowledged"];

      const filtered = wrapper.vm.filteredIncidents;
      expect(filtered).toHaveLength(3);
    });

    it("should clear status filter", () => {
      wrapper.vm.statusFilter = ["open", "acknowledged"];
      wrapper.vm.clearStatusFilter();

      expect(wrapper.vm.statusFilter).toEqual([]);
      expect(wrapper.vm.filteredIncidents).toHaveLength(4);
    });

    it("should have correct status options", () => {
      expect(wrapper.vm.statusOptions).toEqual(["open", "acknowledged", "resolved"]);
    });
  });

  describe("Filter Functionality - Severity", () => {
    beforeEach(async () => {
      (incidentsService.list as any).mockResolvedValue({
        data: {
          incidents: [
            createIncident({ id: "1", severity: "P1" }),
            createIncident({ id: "2", severity: "P2" }),
            createIncident({ id: "3", severity: "P3" }),
            createIncident({ id: "4", severity: "P1" }),
          ],
          total: 4,
        },
      });

      wrapper = createWrapper();
      await flushPromises();
    });

    it("should toggle severity filter on", () => {
      wrapper.vm.toggleSeverityFilter("P1");

      expect(wrapper.vm.severityFilter).toContain("P1");
    });

    it("should toggle severity filter off", () => {
      wrapper.vm.toggleSeverityFilter("P1");
      wrapper.vm.toggleSeverityFilter("P1");

      expect(wrapper.vm.severityFilter).not.toContain("P1");
    });

    it("should filter incidents by P1 severity", () => {
      wrapper.vm.severityFilter = ["P1"];

      const filtered = wrapper.vm.filteredIncidents;
      expect(filtered).toHaveLength(2);
      expect(filtered.every((i: Incident) => i.severity === "P1")).toBe(true);
    });

    it("should filter by multiple severities", () => {
      wrapper.vm.severityFilter = ["P1", "P2"];

      const filtered = wrapper.vm.filteredIncidents;
      expect(filtered).toHaveLength(3);
    });

    it("should clear severity filter", () => {
      wrapper.vm.severityFilter = ["P1", "P2"];
      wrapper.vm.clearSeverityFilter();

      expect(wrapper.vm.severityFilter).toEqual([]);
      expect(wrapper.vm.filteredIncidents).toHaveLength(4);
    });

    it("should have correct severity options", () => {
      expect(wrapper.vm.severityOptions).toEqual(["P1", "P2", "P3", "P4"]);
    });
  });

  describe("Combined Filters", () => {
    beforeEach(async () => {
      (incidentsService.list as any).mockResolvedValue({
        data: {
          incidents: [
            createIncident({ id: "1", status: "open", severity: "P1" }),
            createIncident({ id: "2", status: "acknowledged", severity: "P1" }),
            createIncident({ id: "3", status: "open", severity: "P2" }),
            createIncident({ id: "4", status: "resolved", severity: "P3" }),
          ],
          total: 4,
        },
      });

      wrapper = createWrapper();
      await flushPromises();
    });

    it("should apply both status and severity filters", () => {
      wrapper.vm.statusFilter = ["open"];
      wrapper.vm.severityFilter = ["P1"];

      const filtered = wrapper.vm.filteredIncidents;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].status).toBe("open");
      expect(filtered[0].severity).toBe("P1");
    });

    it("should return empty when filters match nothing", () => {
      wrapper.vm.statusFilter = ["resolved"];
      wrapper.vm.severityFilter = ["P1"];

      expect(wrapper.vm.filteredIncidents).toHaveLength(0);
    });
  });

  describe("Pagination", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    it("should calculate correct offset for page 1", () => {
      wrapper.vm.pagination.page = 1;
      wrapper.vm.pagination.rowsPerPage = 25;

      const offset = (wrapper.vm.pagination.page - 1) * wrapper.vm.pagination.rowsPerPage;
      expect(offset).toBe(0);
    });

    it("should calculate correct offset for page 2", () => {
      wrapper.vm.pagination.page = 2;
      wrapper.vm.pagination.rowsPerPage = 25;

      const offset = (wrapper.vm.pagination.page - 1) * wrapper.vm.pagination.rowsPerPage;
      expect(offset).toBe(25);
    });

    it("should handle page change via onRequest", async () => {
      const props = {
        pagination: {
          page: 2,
          rowsPerPage: 50,
          sortBy: "last_alert_at",
          descending: true,
        },
        searchQuery: "",
      };

      await wrapper.vm.onRequest(props);

      expect(wrapper.vm.pagination.page).toBe(2);
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
      // onRequest no longer calls API, it just filters FE data
    });

    it("should handle rows per page change", async () => {
      await wrapper.vm.changePagination({ label: "50", value: 50 });

      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
      expect(wrapper.vm.pagination.page).toBe(1);
    });

    it("should reset to page 1 on rows per page change", async () => {
      wrapper.vm.pagination.page = 3;

      await wrapper.vm.changePagination({ label: "100", value: 100 });

      expect(wrapper.vm.pagination.page).toBe(1);
    });
  });

  describe("Incident Actions - View", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    it("should set selected incident and navigate when viewing incident", async () => {
      const incident = wrapper.vm.incidents[0];
      const pushSpy = vi.spyOn(router, 'push');

      // viewIncident navigates via router to incident detail page
      wrapper.vm.viewIncident(incident);

      // Verify router.push was called with correct route
      expect(pushSpy).toHaveBeenCalledWith({
        name: "incidentDetail",
        params: {
          id: incident.id,
        },
        query: {
          org_identifier: "default",
        },
      });
    });

    it("should set correct incident when viewing", async () => {
      const incident = createIncident({ id: "test-123", title: "Test Incident" });
      wrapper.vm.incidents.push(incident);
      const pushSpy = vi.spyOn(router, 'push');

      await wrapper.vm.viewIncident(incident);
      await flushPromises();

      // Verify router.push was called with correct incident ID
      expect(pushSpy).toHaveBeenCalledWith({
        name: "incidentDetail",
        params: {
          id: "test-123",
        },
        query: {
          org_identifier: "default",
        },
      });
    });
  });

  describe("Incident Status Updates", () => {
    beforeEach(async () => {
      (incidentsService.updateStatus as any).mockResolvedValue({});
      wrapper = createWrapper();
      await flushPromises();
    });

    it("should acknowledge incident", async () => {
      const incident = wrapper.vm.incidents[0];

      await wrapper.vm.acknowledgeIncident(incident);

      expect(incidentsService.updateStatus).toHaveBeenCalledWith(
        "default",
        incident.id,
        "acknowledged"
      );
    });

    it("should resolve incident", async () => {
      const incident = wrapper.vm.incidents[0];

      await wrapper.vm.resolveIncident(incident);

      expect(incidentsService.updateStatus).toHaveBeenCalledWith(
        "default",
        incident.id,
        "resolved"
      );
    });

    it("should reopen incident", async () => {
      const incident = createIncident({ status: "resolved" });

      await wrapper.vm.reopenIncident(incident);

      expect(incidentsService.updateStatus).toHaveBeenCalledWith(
        "default",
        incident.id,
        "open"
      );
    });

    it("should show success notification on status update", async () => {
      const mockNotify = vi.fn();
      wrapper.vm.$q.notify = mockNotify;

      const incident = wrapper.vm.incidents[0];
      await wrapper.vm.acknowledgeIncident(incident);

      expect(mockNotify).toHaveBeenCalled();
      expect(mockNotify.mock.calls[0][0].type).toBe("positive");
    });

    it("should reload incidents after status update", async () => {
      vi.clearAllMocks();

      const incident = wrapper.vm.incidents[0];
      await wrapper.vm.resolveIncident(incident);

      expect(incidentsService.list).toHaveBeenCalled();
    });

    it("should handle status update error", async () => {
      const mockNotify = vi.fn();
      (incidentsService.updateStatus as any).mockRejectedValue(new Error("Update failed"));

      wrapper.vm.$q.notify = mockNotify;
      const incident = wrapper.vm.incidents[0];

      await wrapper.vm.acknowledgeIncident(incident);

      expect(mockNotify).toHaveBeenCalled();
      expect(mockNotify.mock.calls[0][0].type).toBe("negative");
    });

    it("should call service with correct parameters when acknowledging", async () => {
      const incident = createIncident({ id: "custom-id" });

      await wrapper.vm.acknowledgeIncident(incident);

      expect(incidentsService.updateStatus).toHaveBeenCalledWith(
        "default",
        "custom-id",
        "acknowledged"
      );
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

    it("should handle empty status", () => {
      expect(wrapper.vm.getStatusColor("")).toBe("grey");
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

      // Should contain date parts
      expect(result).toContain("2023");
    });
  });

  describe("Utility Functions - Dimensions Formatting", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should format dimensions as key=value pairs", () => {
      const dimensions = { service: "api", environment: "prod" };
      const result = wrapper.vm.formatDimensions(dimensions);

      expect(result).toContain("service=api");
      expect(result).toContain("environment=prod");
      expect(result).toContain(", ");
    });

    it("should handle single dimension", () => {
      const dimensions = { service: "api" };
      const result = wrapper.vm.formatDimensions(dimensions);

      expect(result).toBe("service=api");
    });

    it("should return Unknown for empty dimensions", () => {
      const result = wrapper.vm.formatDimensions({});

      expect(result).toBe("Unknown");
    });

    it("should handle null dimensions", () => {
      const result = wrapper.vm.formatDimensions(null as any);

      expect(result).toBe("Unknown");
    });

    it("should handle undefined dimensions", () => {
      const result = wrapper.vm.formatDimensions(undefined as any);

      expect(result).toBe("Unknown");
    });

    it("should format multiple dimensions in order", () => {
      const dimensions = { a: "1", b: "2", c: "3" };
      const result = wrapper.vm.formatDimensions(dimensions);

      expect(result).toContain("a=1");
      expect(result).toContain("b=2");
      expect(result).toContain("c=3");
    });
  });

  describe("Table Columns Configuration", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should have correct number of columns", () => {
      expect(wrapper.vm.columns).toHaveLength(7);
    });

    it("should have status column with correct config", () => {
      const statusCol = wrapper.vm.columns.find((c: any) => c.name === "status");

      expect(statusCol).toBeDefined();
      expect(statusCol.sortable).toBe(false);
      expect(statusCol.field).toBe("status");
    });

    it("should have severity column with correct config", () => {
      const severityCol = wrapper.vm.columns.find((c: any) => c.name === "severity");

      expect(severityCol).toBeDefined();
      expect(severityCol.sortable).toBe(false);
      expect(severityCol.field).toBe("severity");
    });

    it("should have title column", () => {
      const titleCol = wrapper.vm.columns.find((c: any) => c.name === "title");

      expect(titleCol).toBeDefined();
      expect(titleCol.field).toBe("title");
    });

    it("should have alert_count column", () => {
      const countCol = wrapper.vm.columns.find((c: any) => c.name === "alert_count");

      expect(countCol).toBeDefined();
      expect(countCol.align).toBe("center");
    });

    it("should have last_alert_at column with sorting", () => {
      const dateCol = wrapper.vm.columns.find((c: any) => c.name === "last_alert_at");

      expect(dateCol).toBeDefined();
      expect(dateCol.sortable).toBe(true);
    });

    it("should have actions column", () => {
      const actionsCol = wrapper.vm.columns.find((c: any) => c.name === "actions");

      expect(actionsCol).toBeDefined();
      expect(actionsCol.align).toBe("center");
    });
  });

  describe("SRE Chat Integration", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    it("should open SRE chat with incident context", () => {
      const incident = wrapper.vm.incidents[0];

      wrapper.vm.openSREChat(incident);

      expect(store.state.sreChatContext).toEqual({
        type: 'incident',
        data: incident,
      });
    });

    it("should dispatch setIsSREChatOpen action", () => {
      const incident = wrapper.vm.incidents[0];
      const dispatchSpy = vi.spyOn(store, 'dispatch');

      wrapper.vm.openSREChat(incident);

      expect(dispatchSpy).toHaveBeenCalledWith("setIsSREChatOpen", true);
    });

    it("should pass correct incident data to chat", () => {
      const customIncident = createIncident({
        id: "custom-id",
        title: "Custom Incident",
        severity: "P1",
      });

      wrapper.vm.openSREChat(customIncident);

      expect(store.state.sreChatContext.data.id).toBe("custom-id");
      expect(store.state.sreChatContext.data.title).toBe("Custom Incident");
    });
  });

  describe("Edge Cases", () => {
    it("should handle incident without title", () => {
      wrapper = createWrapper();
      const incident = createIncident({ title: undefined as any });

      // Should use dimensions instead
      const formatted = wrapper.vm.formatDimensions(incident.stable_dimensions);
      expect(formatted).toBeTruthy();
    });

    it("should handle very large pagination", () => {
      wrapper = createWrapper();
      wrapper.vm.pagination.page = 1000;
      wrapper.vm.pagination.rowsPerPage = 100;

      const offset = (wrapper.vm.pagination.page - 1) * wrapper.vm.pagination.rowsPerPage;
      expect(offset).toBe(99900);
    });

    it("should handle empty filter arrays", () => {
      wrapper = createWrapper();
      wrapper.vm.statusFilter = [];
      wrapper.vm.severityFilter = [];

      expect(wrapper.vm.filteredIncidents).toBeDefined();
    });

    it("should handle zero alert count", () => {
      wrapper = createWrapper();
      const incident = createIncident({ alert_count: 0 });

      expect(incident.alert_count).toBe(0);
    });

    it("should handle missing dimensions", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatDimensions(null as any)).toBe("Unknown");
      expect(wrapper.vm.formatDimensions(undefined as any)).toBe("Unknown");
      expect(wrapper.vm.formatDimensions({})).toBe("Unknown");
    });
  });

  describe("Computed Property - filteredIncidents", () => {
    beforeEach(async () => {
      (incidentsService.list as any).mockResolvedValue({
        data: {
          incidents: [
            createIncident({ id: "1", status: "open", severity: "P1" }),
            createIncident({ id: "2", status: "open", severity: "P2" }),
            createIncident({ id: "3", status: "acknowledged", severity: "P1" }),
          ],
          total: 3,
        },
      });

      wrapper = createWrapper();
      await flushPromises();
    });

    it("should reactively update when status filter changes", async () => {
      expect(wrapper.vm.filteredIncidents).toHaveLength(3);

      wrapper.vm.statusFilter = ["open"];
      await nextTick();

      expect(wrapper.vm.filteredIncidents).toHaveLength(2);
    });

    it("should reactively update when severity filter changes", async () => {
      wrapper.vm.severityFilter = ["P1"];
      await nextTick();

      expect(wrapper.vm.filteredIncidents).toHaveLength(2);
      expect(wrapper.vm.filteredIncidents.every((i: Incident) => i.severity === "P1")).toBe(true);
    });

    it("should reactively update when both filters change", async () => {
      wrapper.vm.statusFilter = ["open"];
      wrapper.vm.severityFilter = ["P1"];
      await nextTick();

      expect(wrapper.vm.filteredIncidents).toHaveLength(1);
      expect(wrapper.vm.filteredIncidents[0].id).toBe("1");
    });
  });

  describe("Organization Context", () => {
    it("should use correct organization from store", async () => {
      wrapper = createWrapper({
        selectedOrganization: { identifier: "custom-org" },
      });
      await flushPromises();

      expect(incidentsService.list).toHaveBeenCalledWith(
        "custom-org",
        undefined,
        1000,
        0,
        undefined
      );
    });

    it("should use organization in status updates", async () => {
      (incidentsService.updateStatus as any).mockResolvedValue({});

      wrapper = createWrapper({
        selectedOrganization: { identifier: "org-123" },
      });
      await flushPromises();

      const incident = wrapper.vm.incidents[0];
      await wrapper.vm.acknowledgeIncident(incident);

      expect(incidentsService.updateStatus).toHaveBeenCalledWith(
        "org-123",
        expect.any(String),
        "acknowledged"
      );
    });
  });
});
