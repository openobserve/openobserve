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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Notify } from "quasar";
import IncidentList from "./IncidentList.vue";
import store from "@/test/unit/helpers/store";
import alertsService from "@/services/alerts";

// Mock the alerts service
vi.mock("@/services/alerts", () => ({
  default: {
    listIncidents: vi.fn(),
  },
}));

// Mock IncidentDetailsDrawer since it's imported
vi.mock("./IncidentDetailsDrawer.vue", () => ({
  default: {
    name: "IncidentDetailsDrawer",
    template: '<div class="incident-details-drawer-mock"></div>',
  },
}));

installQuasar({ plugins: [Notify] });

describe("IncidentList", () => {
  const mockIncidents = [
    {
      incident_id: "incident-1",
      org_id: "test-org",
      status: "open",
      created_at: 1704067200000000, // microseconds
      updated_at: 1704067200000000,
      alert_count: 5,
      temporal_only_count: 2,
      canonical_dimensions: { service: "api", host: "prod-1" },
      primary_correlation_type: "semantic_fields",
      correlation_confidence: "high",
    },
    {
      incident_id: "incident-2",
      org_id: "test-org",
      status: "acknowledged",
      created_at: 1704067100000000,
      updated_at: 1704067150000000,
      alert_count: 3,
      temporal_only_count: 0,
      canonical_dimensions: { service: "db", cluster: "prod" },
      primary_correlation_type: "mixed",
      correlation_confidence: "medium",
    },
    {
      incident_id: "incident-3",
      org_id: "test-org",
      status: "resolved",
      created_at: 1704067000000000,
      updated_at: 1704067300000000,
      resolved_at: 1704067300000000,
      alert_count: 10,
      temporal_only_count: 5,
      canonical_dimensions: { service: "cache" },
      primary_correlation_type: "temporal_only",
      correlation_confidence: "low",
    },
  ];

  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (alertsService.listIncidents as any).mockResolvedValue({
      data: { incidents: mockIncidents },
    });

    store.state.selectedOrganization = {
      identifier: "test-org",
      name: "Test Organization",
    };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it("renders correctly", async () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    await flushPromises();
    expect(wrapper.find(".incident-list").exists()).toBe(true);
    expect(wrapper.find(".q-table").exists()).toBe(true);
  });

  it("loads incidents on mount", async () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    await flushPromises();

    expect(alertsService.listIncidents).toHaveBeenCalledWith("test-org");
    expect(alertsService.listIncidents).toHaveBeenCalledTimes(1);
  });

  it("displays correct number of incidents", async () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    await flushPromises();

    const vm = wrapper.vm as any;
    expect(vm.incidents).toHaveLength(3);
  });

  it("displays loading state during fetch", async () => {
    let resolveFunc: any;
    (alertsService.listIncidents as any).mockImplementation(
      () => new Promise((resolve) => { resolveFunc = resolve; })
    );

    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    await flushPromises();
    const vm = wrapper.vm as any;
    expect(vm.loading).toBe(true);

    // Resolve the promise
    resolveFunc({ data: { incidents: [] } });
    await flushPromises();
    expect(vm.loading).toBe(false);
  });

  it("handles API error gracefully", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    (alertsService.listIncidents as any).mockRejectedValue(
      new Error("API Error")
    );

    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    await flushPromises();

    const vm = wrapper.vm as any;
    expect(vm.incidents).toHaveLength(0);
    expect(vm.loading).toBe(false);

    consoleError.mockRestore();
  });

  it("returns correct status color for open status", () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    const vm = wrapper.vm as any;
    expect(vm.getStatusColor("open")).toBe("negative");
  });

  it("returns correct status color for acknowledged status", () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    const vm = wrapper.vm as any;
    expect(vm.getStatusColor("acknowledged")).toBe("warning");
  });

  it("returns correct status color for resolved status", () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    const vm = wrapper.vm as any;
    expect(vm.getStatusColor("resolved")).toBe("positive");
  });

  it("returns correct status color for unknown status", () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    const vm = wrapper.vm as any;
    expect(vm.getStatusColor("unknown")).toBe("grey");
  });

  it("formats status label correctly", () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    const vm = wrapper.vm as any;
    expect(vm.getStatusLabel("open")).toBe("Open");
    expect(vm.getStatusLabel("acknowledged")).toBe("Acknowledged");
    expect(vm.getStatusLabel("resolved")).toBe("Resolved");
  });

  it("returns Unknown for null status label", () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    const vm = wrapper.vm as any;
    expect(vm.getStatusLabel(null)).toBe("Unknown");
  });

  it("returns correct correlation type color", () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    const vm = wrapper.vm as any;
    expect(vm.getCorrelationTypeColor("semantic_fields")).toBe("primary");
    expect(vm.getCorrelationTypeColor("mixed")).toBe("info");
    expect(vm.getCorrelationTypeColor("temporal_only")).toBe("secondary");
    expect(vm.getCorrelationTypeColor("unknown")).toBe("grey");
  });

  it("formats correlation type label correctly", () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    const vm = wrapper.vm as any;
    expect(vm.getCorrelationTypeLabel("semantic_fields")).toBe("Semantic Fields");
    expect(vm.getCorrelationTypeLabel("temporal_only")).toBe("Temporal Only");
    expect(vm.getCorrelationTypeLabel("mixed")).toBe("Mixed");
  });

  it("formats timestamp correctly", () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    const vm = wrapper.vm as any;
    const now = Date.now() * 1000; // Convert to microseconds
    const result = vm.formatTimestamp(now);
    expect(result).toContain("ago");
  });

  it("returns -- for invalid timestamp", () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    const vm = wrapper.vm as any;
    expect(vm.formatTimestamp(0)).toBe("--");
    expect(vm.formatTimestamp(null)).toBe("--");
  });

  it("opens details drawer when row clicked", async () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    await flushPromises();

    const vm = wrapper.vm as any;
    const mockRow = mockIncidents[0];

    vm.showIncidentDetails({}, mockRow);

    expect(vm.selectedIncident).toEqual(mockRow);
    expect(vm.showDetailsDrawer).toBe(true);
  });

  it("refreshes incidents when refreshIncidents called", async () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    await flushPromises();

    vi.clearAllMocks();

    const vm = wrapper.vm as any;
    await vm.refreshIncidents();

    expect(alertsService.listIncidents).toHaveBeenCalledWith("test-org");
  });

  it("exposes refreshIncidents method", async () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    await flushPromises();

    expect(wrapper.vm.refreshIncidents).toBeDefined();
    expect(typeof wrapper.vm.refreshIncidents).toBe("function");
  });

  it("displays no data message when incidents array is empty", async () => {
    (alertsService.listIncidents as any).mockResolvedValue({
      data: { incidents: [] },
    });

    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    await flushPromises();

    // Check that "No incidents found" text exists in HTML
    expect(wrapper.html()).toContain("No incidents found");
  });

  it("has correct table columns defined", async () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    const vm = wrapper.vm as any;
    const columnNames = vm.columns.map((col: any) => col.name);

    expect(columnNames).toContain("status");
    expect(columnNames).toContain("created_at");
    expect(columnNames).toContain("alert_count");
    expect(columnNames).toContain("canonical_dimensions");
    expect(columnNames).toContain("primary_correlation_type");
    expect(columnNames).toContain("updated_at");
  });

  it("sets pagination to 50 rows per page", () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    const vm = wrapper.vm as any;
    expect(vm.pagination.rowsPerPage).toBe(50);
  });

  it("returns grey for null status color", () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    const vm = wrapper.vm as any;
    expect(vm.getStatusColor(null)).toBe("grey");
  });

  it("returns Unknown for empty correlation type label", () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    const vm = wrapper.vm as any;
    expect(vm.getCorrelationTypeLabel("")).toBe("Unknown");
  });

  it("has correct table class", () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.find(".incident-list").exists()).toBe(true);
    expect(wrapper.find(".q-table").exists()).toBe(true);
  });

  it("displays table with correct styling", async () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    await flushPromises();

    expect(wrapper.find(".o2-quasar-table").exists()).toBe(true);
  });

  it("formats status label for lowercase input", () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    const vm = wrapper.vm as any;
    expect(vm.getStatusLabel("open")).toBe("Open");
    expect(vm.getStatusLabel("resolved")).toBe("Resolved");
  });

  it("has all column definitions", () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    const vm = wrapper.vm as any;
    expect(vm.columns).toHaveLength(6);
  });

  it("column definitions have correct properties", () => {
    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    const vm = wrapper.vm as any;
    vm.columns.forEach((col: any) => {
      expect(col.name).toBeDefined();
      expect(col.label).toBeDefined();
      expect(col.field).toBeDefined();
    });
  });

  it("handles empty incident list correctly", async () => {
    (alertsService.listIncidents as any).mockResolvedValue({
      data: { incidents: [] },
    });

    wrapper = mount(IncidentList, {
      global: {
        plugins: [store],
      },
    });

    await flushPromises();

    const vm = wrapper.vm as any;
    expect(vm.incidents).toHaveLength(0);
  });
});
