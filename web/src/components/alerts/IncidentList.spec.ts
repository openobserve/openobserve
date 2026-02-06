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

    // Reset incidents store state
    store.state.incidents = {
      incidents: {},
      pageBeforeSearch: 1,
      isInitialized: false
    };

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
      expect(wrapper.vm.columns).toHaveLength(8);
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

  describe("State Persistence - Vuex Store Integration", () => {
    beforeEach(() => {
      // Reset incidents store state
      store.state.incidents = {
        incidents: {},
        pageBeforeSearch: 1,
        isInitialized: false
      };
    });

    it("should save state to store when navigating to incident detail", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.pagination.page = 3;
      wrapper.vm.pagination.rowsPerPage = 50;
      wrapper.vm.searchQuery = "test query";

      const incident = wrapper.vm.incidents[0];
      wrapper.vm.viewIncident(incident);

      const savedState = store.state.incidents.incidents;
      expect(savedState.searchQuery).toBe("test query");
      expect(savedState.pagination.page).toBe(3);
      expect(savedState.pagination.rowsPerPage).toBe(50);
      expect(savedState.organizationIdentifier).toBe("default");
    });

    it("should restore state from store on mount", async () => {
      // Mock enough incidents
      const mockIncidents = Array.from({ length: 500 }, (_, i) =>
        createIncident({ id: `${i}`, title: `Incident ${i}` })
      );

      (incidentsService.list as any).mockResolvedValue({
        data: {
          incidents: mockIncidents,
          total: 500,
        },
      });

      // Pre-populate store with saved state (without search query to avoid watch complications)
      store.state.incidents = {
        incidents: {
          searchQuery: "",
          pagination: { page: 3, rowsPerPage: 50 },
          organizationIdentifier: "default"
        },
        pageBeforeSearch: 1,
        isInitialized: true
      };

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      // Verify key restoration happened
      expect(wrapper.vm.pagination.page).toBe(3);
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
    });

    it("should reset state when organization changes", async () => {
      // Simulate previous org state
      store.state.incidents = {
        incidents: {
          searchQuery: "old org query",
          pagination: { page: 3, rowsPerPage: 50 },
          organizationIdentifier: "old-org"
        },
        pageBeforeSearch: 3,
        isInitialized: true
      };

      // New organization
      store.state.selectedOrganization = {
        label: "new Organization",
        id: 200,
        identifier: "new-org",
        user_email: "new@example.com",
        subscription_type: "",
      };

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      // Should have reset to defaults
      expect(wrapper.vm.searchQuery).toBe("");
      expect(wrapper.vm.pagination.page).toBe(1);
      expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
    });

    it("should not restore state if not initialized", async () => {
      store.state.incidents = {
        incidents: {
          searchQuery: "should not restore",
          pagination: { page: 10, rowsPerPage: 500 },
          organizationIdentifier: "default"
        },
        pageBeforeSearch: 10,
        isInitialized: false // Not initialized
      };

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      // Should use defaults, not restored values
      expect(wrapper.vm.searchQuery).toBe("");
      expect(wrapper.vm.pagination.page).toBe(1);
      expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
    });
  });

  describe("Search Query Watch - Page Management", () => {
    beforeEach(async () => {
      store.state.incidents = {
        incidents: {},
        pageBeforeSearch: 1,
        isInitialized: false
      };

      (incidentsService.list as any).mockResolvedValue({
        data: {
          incidents: Array.from({ length: 100 }, (_, i) =>
            createIncident({ id: `${i}`, title: `Incident ${i}` })
          ),
          total: 100,
        },
      });

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();
    });

    it("should save current page and reset to page 1 when starting a search", async () => {
      wrapper.vm.pagination.page = 3;
      await nextTick();
      await flushPromises();

      // Start search (empty -> value)
      wrapper.vm.searchQuery = "test";
      await nextTick();
      await flushPromises(); // Wait for store dispatch to complete

      expect(store.state.incidents.pageBeforeSearch).toBe(3);
      expect(wrapper.vm.pagination.page).toBe(1);
    });

    it("should restore pageBeforeSearch when clearing search", async () => {
      wrapper.vm.pagination.page = 5;
      await nextTick();
      await flushPromises();

      // Start search
      wrapper.vm.searchQuery = "test";
      await nextTick();
      await flushPromises(); // Wait for store dispatch to complete

      expect(wrapper.vm.pagination.page).toBe(1);
      expect(store.state.incidents.pageBeforeSearch).toBe(5);

      // Clear search (value -> empty)
      wrapper.vm.searchQuery = "";
      await nextTick();
      await flushPromises();

      expect(wrapper.vm.pagination.page).toBe(5);
    });

    it("should reset to page 1 when changing search query", async () => {
      wrapper.vm.pagination.page = 3;
      await nextTick();

      wrapper.vm.searchQuery = "first";
      await nextTick();
      expect(wrapper.vm.pagination.page).toBe(1);

      wrapper.vm.pagination.page = 2;
      await nextTick();

      // Change search query (value -> different value)
      wrapper.vm.searchQuery = "second";
      await nextTick();

      expect(wrapper.vm.pagination.page).toBe(1);
    });

    it("should not manipulate pages during state restoration", async () => {
      // Set up stored state with search query
      store.state.incidents = {
        incidents: {
          searchQuery: "restored search",
          pagination: { page: 1, rowsPerPage: 20 },
          organizationIdentifier: "default"
        },
        pageBeforeSearch: 3,
        isInitialized: true
      };

      const setPageBeforeSearchSpy = vi.spyOn(store, 'dispatch');

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      // Verify searchQuery was restored
      expect(wrapper.vm.searchQuery).toBe("restored search");

      // During restoration, setPageBeforeSearch should NOT be called
      // (because isRestoringState flag prevents watch logic)
      const setPageBeforeSearchCalls = setPageBeforeSearchSpy.mock.calls
        .filter((call: any) => call[0] === 'incidents/setPageBeforeSearch');

      expect(setPageBeforeSearchCalls).toHaveLength(0);
    });
  });

  describe("Edge Case: Clearing Restored Search Resets Page (PRIMARY BUG FIX)", () => {
    beforeEach(async () => {
      store.state.incidents = {
        incidents: {},
        pageBeforeSearch: 1,
        isInitialized: false
      };

      (incidentsService.list as any).mockResolvedValue({
        data: {
          incidents: Array.from({ length: 100 }, (_, i) =>
            createIncident({ id: `${i}`, title: `Incident ${i}` })
          ),
          total: 100,
        },
      });
    });

    it("should preserve original page when clearing restored search query", async () => {
      // STEP 1: User on page 3 with no search
      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      wrapper.vm.pagination.page = 3;
      await nextTick();

      // STEP 2: User types search query
      wrapper.vm.searchQuery = "test";
      await nextTick();
      await flushPromises(); // Wait for store dispatch to complete

      expect(store.state.incidents.pageBeforeSearch).toBe(3);
      expect(wrapper.vm.pagination.page).toBe(1);

      // STEP 3: Save state (simulate navigation)
      store.dispatch('incidents/setIncidents', {
        searchQuery: wrapper.vm.searchQuery,
        pagination: {
          page: wrapper.vm.pagination.page,
          rowsPerPage: wrapper.vm.pagination.rowsPerPage
        },
        organizationIdentifier: store.state.selectedOrganization.identifier
      });

      // STEP 4: Restore state (simulate coming back)
      store.state.incidents.isInitialized = true;
      const restoredWrapper = createWrapper();
      await flushPromises();
      await nextTick();

      expect(restoredWrapper.vm.searchQuery).toBe("test");
      expect(restoredWrapper.vm.pagination.page).toBe(1);
      expect(store.state.incidents.pageBeforeSearch).toBe(3);

      // STEP 5: User clears search query
      restoredWrapper.vm.searchQuery = "";
      await nextTick();

      // CRITICAL: Should restore to page 3, NOT stay at page 1
      expect(restoredWrapper.vm.pagination.page).toBe(3);
    });
  });

  describe("Edge Case: Restored Page Out of Bounds", () => {
    beforeEach(() => {
      store.state.incidents = {
        incidents: {},
        pageBeforeSearch: 1,
        isInitialized: false
      };
    });

    it("should auto-correct page when restored page exceeds available pages", async () => {
      // User had page 5 with 100+ records
      store.state.incidents = {
        incidents: {
          searchQuery: "",
          pagination: { page: 5, rowsPerPage: 20 },
          organizationIdentifier: "default"
        },
        pageBeforeSearch: 1,
        isInitialized: true
      };

      // Now only 10 records exist (1 page max)
      (incidentsService.list as any).mockResolvedValue({
        data: {
          incidents: Array.from({ length: 10 }, (_, i) =>
            createIncident({ id: `${i}` })
          ),
          total: 10,
        },
      });

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      // Should auto-correct to page 1
      expect(wrapper.vm.pagination.page).toBe(1);
    });

    it("should handle restoration when all data is deleted", async () => {
      store.state.incidents = {
        incidents: {
          searchQuery: "",
          pagination: { page: 3, rowsPerPage: 20 },
          organizationIdentifier: "default"
        },
        pageBeforeSearch: 1,
        isInitialized: true
      };

      // No data available
      (incidentsService.list as any).mockResolvedValue({
        data: { incidents: [], total: 0 },
      });

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      // Should reset to page 1
      expect(wrapper.vm.pagination.page).toBe(1);
      expect(wrapper.vm.pagination.rowsNumber).toBe(0);
    });
  });

  describe("Edge Case: pageBeforeSearch Out of Bounds", () => {
    beforeEach(() => {
      store.state.incidents = {
        incidents: {},
        pageBeforeSearch: 1,
        isInitialized: false
      };

      (incidentsService.list as any).mockResolvedValue({
        data: {
          incidents: Array.from({ length: 20 }, (_, i) =>
            createIncident({ id: `${i}` })
          ),
          total: 20,
        },
      });
    });

    it("should auto-correct when clearing search if pageBeforeSearch is out of bounds", async () => {
      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      // User was on page 5
      wrapper.vm.pagination.page = 5;
      await nextTick();
      await flushPromises();

      // Start search
      wrapper.vm.searchQuery = "test";
      await nextTick();
      await flushPromises(); // Wait for store dispatch to complete

      expect(store.state.incidents.pageBeforeSearch).toBe(5);
      expect(wrapper.vm.pagination.page).toBe(1);

      // Simulate data deletion - now only 20 records (1 page at 20/page)
      (incidentsService.list as any).mockResolvedValue({
        data: {
          incidents: Array.from({ length: 20 }, (_, i) =>
            createIncident({ id: `${i}` })
          ),
          total: 20,
        },
      });

      wrapper.vm.allIncidents = Array.from({ length: 20 }, (_, i) =>
        createIncident({ id: `${i}` })
      );
      wrapper.vm.pagination.rowsNumber = 20;

      // Clear search - should validate and correct
      wrapper.vm.searchQuery = "";
      await nextTick();

      // Should auto-correct to max page (1) instead of trying to go to page 5
      expect(wrapper.vm.pagination.page).toBe(1);
    });
  });

  describe("Edge Case: Invalid Pagination Values", () => {
    beforeEach(() => {
      store.state.incidents = {
        incidents: {},
        pageBeforeSearch: 1,
        isInitialized: false
      };

      (incidentsService.list as any).mockResolvedValue({
        data: {
          incidents: Array.from({ length: 50 }, (_, i) =>
            createIncident({ id: `${i}` })
          ),
          total: 50,
        },
      });
    });

    it("should handle invalid rowsPerPage (0)", async () => {
      store.state.incidents = {
        incidents: {
          searchQuery: "",
          pagination: { page: 1, rowsPerPage: 0 }, // Invalid
          organizationIdentifier: "default"
        },
        pageBeforeSearch: 1,
        isInitialized: true
      };

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      // Should reset to default (20)
      expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
    });

    it("should handle invalid rowsPerPage (negative)", async () => {
      store.state.incidents = {
        incidents: {
          searchQuery: "",
          pagination: { page: 1, rowsPerPage: -10 }, // Invalid
          organizationIdentifier: "default"
        },
        pageBeforeSearch: 1,
        isInitialized: true
      };

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      // Should reset to default (20)
      expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
    });

    it("should handle invalid currentPage (0)", async () => {
      store.state.incidents = {
        incidents: {
          searchQuery: "",
          pagination: { page: 0, rowsPerPage: 20 }, // Invalid
          organizationIdentifier: "default"
        },
        pageBeforeSearch: 1,
        isInitialized: true
      };

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      // Should reset to page 1
      expect(wrapper.vm.pagination.page).toBe(1);
    });

    it("should handle invalid currentPage (negative)", async () => {
      store.state.incidents = {
        incidents: {
          searchQuery: "",
          pagination: { page: -5, rowsPerPage: 20 }, // Invalid
          organizationIdentifier: "default"
        },
        pageBeforeSearch: 1,
        isInitialized: true
      };

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      // Should reset to page 1
      expect(wrapper.vm.pagination.page).toBe(1);
    });
  });

  describe("Edge Case: Search Results Fewer Than Expected", () => {
    beforeEach(() => {
      store.state.incidents = {
        incidents: {},
        pageBeforeSearch: 1,
        isInitialized: false
      };
    });

    it("should auto-correct page when search results have fewer items", async () => {
      // Initial load with 100 incidents
      (incidentsService.list as any).mockResolvedValue({
        data: {
          incidents: Array.from({ length: 100 }, (_, i) =>
            createIncident({ id: `${i}`, title: `Incident ${i}` })
          ),
          total: 100,
        },
      });

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      // User navigates to page 3
      wrapper.vm.pagination.page = 3;
      await nextTick();

      // User searches - only 5 results (fits on 1 page)
      wrapper.vm.allIncidents = Array.from({ length: 5 }, (_, i) =>
        createIncident({ id: `${i}`, title: `Match ${i}` })
      );

      wrapper.vm.searchQuery = "Match";
      await nextTick();

      // Should auto-correct to page 1 (only 1 page of results)
      expect(wrapper.vm.pagination.page).toBe(1);
    });
  });

  describe("Frontend Search Filtering", () => {
    beforeEach(async () => {
      (incidentsService.list as any).mockResolvedValue({
        data: {
          incidents: [
            createIncident({ id: "1", title: "Database Error", status: "open", severity: "P1" }),
            createIncident({ id: "2", title: "API Timeout", status: "acknowledged", severity: "P2" }),
            createIncident({ id: "3", title: "Login Issue", status: "resolved", severity: "P3" }),
            createIncident({ id: "4", title: "Database Connection Failed", status: "open", severity: "P1" }),
          ],
          total: 4,
        },
      });

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();
    });

    it("should filter incidents by title", async () => {
      wrapper.vm.searchQuery = "Database";
      await nextTick();

      expect(wrapper.vm.pagination.rowsNumber).toBe(2);
    });

    it("should filter incidents by status", async () => {
      wrapper.vm.searchQuery = "open";
      await nextTick();

      expect(wrapper.vm.pagination.rowsNumber).toBe(2);
    });

    it("should filter incidents by severity", async () => {
      wrapper.vm.searchQuery = "P1";
      await nextTick();

      expect(wrapper.vm.pagination.rowsNumber).toBe(2);
    });

    it("should be case-insensitive", async () => {
      wrapper.vm.searchQuery = "DATABASE";
      await nextTick();

      expect(wrapper.vm.pagination.rowsNumber).toBe(2);
    });

    it("should return all incidents when search is cleared", async () => {
      wrapper.vm.searchQuery = "Database";
      await nextTick();
      expect(wrapper.vm.pagination.rowsNumber).toBe(2);

      wrapper.vm.searchQuery = "";
      await nextTick();
      expect(wrapper.vm.pagination.rowsNumber).toBe(4);
    });

    it("should save search state to store on search", async () => {
      wrapper.vm.searchQuery = "Database";
      await nextTick();
      await flushPromises(); // Wait for store dispatch to complete

      const savedState = store.state.incidents.incidents;
      expect(savedState.searchQuery).toBe("Database");
    });
  });

  describe("Vuex Store Actions and Mutations", () => {
    beforeEach(() => {
      store.state.incidents = {
        incidents: {},
        pageBeforeSearch: 1,
        isInitialized: false
      };
    });

    it("should dispatch setPageBeforeSearch action", async () => {
      const dispatchSpy = vi.spyOn(store, 'dispatch');

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      wrapper.vm.pagination.page = 5;
      await nextTick();

      wrapper.vm.searchQuery = "test";
      await nextTick();

      expect(dispatchSpy).toHaveBeenCalledWith('incidents/setPageBeforeSearch', 5);
    });

    it("should dispatch setIncidents action on pagination change", async () => {
      const dispatchSpy = vi.spyOn(store, 'dispatch');

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      dispatchSpy.mockClear();

      await wrapper.vm.changePagination({ label: "50", value: 50 });

      expect(dispatchSpy).toHaveBeenCalledWith(
        'incidents/setIncidents',
        expect.objectContaining({
          searchQuery: expect.any(String),
          pagination: expect.objectContaining({
            page: expect.any(Number),
            rowsPerPage: 50
          }),
          organizationIdentifier: "default"
        })
      );
    });

    it("should dispatch resetIncidents when organization changes", async () => {
      const dispatchSpy = vi.spyOn(store, 'dispatch');

      // Set up old org state
      store.state.incidents = {
        incidents: {
          searchQuery: "old",
          pagination: { page: 3, rowsPerPage: 50 },
          organizationIdentifier: "old-org"
        },
        pageBeforeSearch: 3,
        isInitialized: true
      };

      store.state.selectedOrganization = {
        label: "new Organization",
        id: 200,
        identifier: "new-org",
        user_email: "new@example.com",
        subscription_type: "",
      };

      wrapper = createWrapper();
      await flushPromises();

      expect(dispatchSpy).toHaveBeenCalledWith('incidents/resetIncidents');
    });

    it("should dispatch setIsInitialized on first load", async () => {
      const dispatchSpy = vi.spyOn(store, 'dispatch');

      wrapper = createWrapper();
      await flushPromises();

      expect(dispatchSpy).toHaveBeenCalledWith('incidents/setIsInitialized', true);
    });
  });

  describe("isRestoringState Flag Behavior", () => {
    beforeEach(() => {
      store.state.incidents = {
        incidents: {},
        pageBeforeSearch: 1,
        isInitialized: false
      };
    });

    it("should set isRestoringState flag during restoration", async () => {
      store.state.incidents = {
        incidents: {
          searchQuery: "test",
          pagination: { page: 3, rowsPerPage: 20 },
          organizationIdentifier: "default"
        },
        pageBeforeSearch: 5,
        isInitialized: true
      };

      wrapper = createWrapper();

      // During mount, isRestoringState should be true
      // This is internal state, but we can verify side effects
      await flushPromises();
      await nextTick();

      // After nextTick, isRestoringState should be false
      // Verify by checking that subsequent search changes trigger normal behavior
      wrapper.vm.searchQuery = "new query";
      await nextTick();

      expect(wrapper.vm.pagination.page).toBe(1);
    });

    it("should clear isRestoringState flag after restoration completes", async () => {
      // Mock enough incidents
      const mockIncidents = Array.from({ length: 150 }, (_, i) =>
        createIncident({ id: `${i}`, title: `test Incident ${i}` })
      );

      (incidentsService.list as any).mockResolvedValue({
        data: {
          incidents: mockIncidents,
          total: 150,
        },
      });

      // Start with empty state (no restoration)
      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      // After component is mounted, search watch should work normally
      wrapper.vm.pagination.page = 4;
      await nextTick();
      await flushPromises();

      // Start a search - should save current page and reset to 1
      wrapper.vm.searchQuery = "test";
      await nextTick();
      await flushPromises(); // Wait for store dispatch to complete

      // Should save pageBeforeSearch and reset to page 1 (normal behavior)
      expect(store.state.incidents.pageBeforeSearch).toBe(4);
      expect(wrapper.vm.pagination.page).toBe(1);
    });
  });

  describe("validateAndCorrectPagination Function", () => {
    beforeEach(async () => {
      (incidentsService.list as any).mockResolvedValue({
        data: {
          incidents: Array.from({ length: 50 }, (_, i) =>
            createIncident({ id: `${i}` })
          ),
          total: 50,
        },
      });

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();
    });

    it("should return true when correction was needed", async () => {
      wrapper.vm.pagination.page = 10;
      wrapper.vm.pagination.rowsPerPage = 20;
      wrapper.vm.pagination.rowsNumber = 50;

      const wasCorrected = wrapper.vm.validateAndCorrectPagination();

      expect(wasCorrected).toBe(true);
      expect(wrapper.vm.pagination.page).toBe(3); // max page = ceil(50/20) = 3
    });

    it("should return false when no correction needed", async () => {
      wrapper.vm.pagination.page = 2;
      wrapper.vm.pagination.rowsPerPage = 20;
      wrapper.vm.pagination.rowsNumber = 50;

      const wasCorrected = wrapper.vm.validateAndCorrectPagination();

      expect(wasCorrected).toBe(false);
      expect(wrapper.vm.pagination.page).toBe(2);
    });

    it("should correct invalid rowsPerPage to default", async () => {
      wrapper.vm.pagination.rowsPerPage = 0;
      wrapper.vm.pagination.page = 1;

      const wasCorrected = wrapper.vm.validateAndCorrectPagination();

      expect(wasCorrected).toBe(true);
      expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
    });

    it("should correct invalid page to 1", async () => {
      wrapper.vm.pagination.page = -5;
      wrapper.vm.pagination.rowsPerPage = 20;

      const wasCorrected = wrapper.vm.validateAndCorrectPagination();

      expect(wasCorrected).toBe(true);
      expect(wrapper.vm.pagination.page).toBe(1);
    });

    it("should handle zero records gracefully", async () => {
      wrapper.vm.pagination.page = 3;
      wrapper.vm.pagination.rowsPerPage = 20;
      wrapper.vm.pagination.rowsNumber = 0;
      wrapper.vm.allIncidents = [];

      const wasCorrected = wrapper.vm.validateAndCorrectPagination();

      expect(wasCorrected).toBe(true);
      expect(wrapper.vm.pagination.page).toBe(1);
    });
  });
});
