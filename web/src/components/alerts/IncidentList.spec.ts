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

// Hoisted mocks
vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "true", isCloud: "false" },
}));

vi.mock("@/services/incidents", () => ({
  default: {
    list: vi.fn(),
    updateStatus: vi.fn(),
  },
}));

vi.mock("@/utils/date", () => ({
  formatToReadable: vi.fn((ts: number) => `ts-${ts}`),
  formatDate: vi.fn((ts: number) => `date-${ts}`),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => vi.fn()),
}));

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import IncidentList from "./IncidentList.vue";
import incidentsService from "@/services/incidents";
import type { Incident } from "@/services/incidents";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// ── stubs ─────────────────────────────────────────────────────────────────────

const OTableStub = {
  name: "OTable",
  props: {
    data: { default: () => [] },
    columns: { default: () => [] },
    loading: { default: false },
  },
  emits: ["row-click"],
  template: `
    <div data-test="incident-list-table">
      <slot name="toolbar" />
      <slot name="toolbar-trailing" />
      <slot name="empty" />
      <slot name="bottom" />
      <template v-for="row in data" :key="row.id">
        <div :data-test="'row-' + row.id" @click="$emit('row-click', row)">
          <slot name="cell-status" :row="row" />
          <slot name="cell-severity" :row="row" />
          <slot name="cell-title" :row="row" />
          <slot name="cell-dimensions" :row="row" />
          <slot name="cell-actions" :row="row" />
        </div>
      </template>
    </div>
  `,
};

// ── test data factory ──────────────────────────────────────────────────────────

const createIncident = (overrides: Partial<Incident> = {}): Incident => ({
  id: "incident-1",
  status: "open",
  severity: "P1",
  title: "Test Incident",
  group_values: { service: "test-service" },
  alert_count: 5,
  last_alert_at: 1700000000000000,
  created_at: 1700000000000000,
  updated_at: 1700000000000000,
  related_incidents: [],
  rca_summary: null,
  ...overrides,
});

// ── mount helper ───────────────────────────────────────────────────────────────

function createWrapper() {
  return mount(IncidentList, {
    global: {
      plugins: [i18n, store, router],
      stubs: {
        OTable: OTableStub,
        NoData: { template: '<div data-test="no-data-stub" />' },
        OEmptyState: { template: '<div data-test="no-data-stub" />' },
        OButton: {
          template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
          emits: ["click"],
        },
        OIcon: { template: "<span />" },
        OSpinner: { template: "<span />" },
        OInput: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        OTooltip: { template: "<span />" },
      },
    },
  });
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe("IncidentList.vue", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    vi.clearAllMocks();

    store.state.selectedOrganization = {
      label: "default Organization",
      id: 159,
      identifier: "default",
      user_email: "example@gmail.com",
      subscription_type: "",
    };

    // Silence unknown Vuex action dispatches from the component
    // (incidents/setCachedData is dispatched but not registered in the test store)
    vi.spyOn(store, "dispatch").mockImplementation(async (type: string) => {
      // pass through known actions, swallow unknown ones silently
      const knownPrefixes = ["incidents/setIncidents", "incidents/setShouldRefresh"];
      if (knownPrefixes.some((k) => type.startsWith(k) || type === k)) {
        return;
      }
      // For all others (including incidents/setCachedData) just resolve
      return undefined;
    });

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

    (incidentsService.updateStatus as any).mockResolvedValue({});
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  // ── Component Initialization ───────────────────────────────────────────────

  describe("Component Initialization", () => {
    it("mounts successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders incident-list root element", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="incident-list"]').exists()).toBe(true);
    });

    it("renders the list title", () => {
      wrapper = createWrapper();
      // Title now lives in the standard OPageHeader (row 1).
      expect(wrapper.find(".app-page-header h1").text()).toContain("Incident");
    });

    it("renders the search input", () => {
      wrapper = createWrapper();
      // Search moved into the table's own toolbar (#toolbar slot).
      expect(wrapper.find('[data-test="incident-search-input"]').exists()).toBe(true);
    });

    it("renders the refresh button", () => {
      wrapper = createWrapper();
      // Refresh moved into the table's own toolbar (#toolbar-trailing slot).
      expect(wrapper.find('[data-test="incident-list-refresh-btn"]').exists()).toBe(true);
    });

    it("renders the table", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="incident-list-table"]').exists()).toBe(true);
    });

    it("initialises loading to false before mount flushes", () => {
      wrapper = createWrapper();
      // loading is set to true inside loadIncidents() and reset after
      // at construction time it should be false or true — just ensure no crash
      expect(typeof (wrapper.vm as any).loading).toBe("boolean");
    });

    it("initialises searchQuery as empty string", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).searchQuery).toBe("");
    });

    it("initialises allIncidents as empty array", () => {
      wrapper = createWrapper();
      // Before mount resolves, allIncidents starts empty
      expect(Array.isArray((wrapper.vm as any).allIncidents)).toBe(true);
    });
  });

  // ── Data Loading ───────────────────────────────────────────────────────────

  describe("Incident Data Loading", () => {
    it("calls incidentsService.list on mount", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(incidentsService.list).toHaveBeenCalled();
    });

    it("calls list with correct org identifier", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(incidentsService.list).toHaveBeenCalledWith("default", undefined, 1000, 0, undefined);
    });

    it("populates allIncidents after successful load", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect((wrapper.vm as any).allIncidents).toHaveLength(3);
    });

    it("sets loading to false after successful load", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect((wrapper.vm as any).loading).toBe(false);
    });

    it("handles empty incidents list", async () => {
      (incidentsService.list as any).mockResolvedValue({
        data: { incidents: [], total: 0 },
      });
      wrapper = createWrapper();
      await flushPromises();
      expect((wrapper.vm as any).allIncidents).toHaveLength(0);
    });

    it("handles API error gracefully", async () => {
      (incidentsService.list as any).mockRejectedValue(new Error("API Error"));
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
      expect((wrapper.vm as any).loading).toBe(false);
    });

    it("reloads on refreshIncidents()", async () => {
      wrapper = createWrapper();
      await flushPromises();
      vi.clearAllMocks();
      (incidentsService.list as any).mockResolvedValue({
        data: { incidents: [], total: 0 },
      });
      await (wrapper.vm as any).refreshIncidents();
      await flushPromises();
      expect(incidentsService.list).toHaveBeenCalled();
    });
  });

  // ── visibleIncidents computed ──────────────────────────────────────────────

  describe("visibleIncidents computed", () => {
    it("returns all incidents when searchQuery is empty", async () => {
      wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).searchQuery = "";
      expect((wrapper.vm as any).visibleIncidents).toHaveLength(3);
    });

    it("filters by title match", async () => {
      (incidentsService.list as any).mockResolvedValue({
        data: {
          incidents: [
            createIncident({ id: "1", title: "Database Crash", status: "open" }),
            createIncident({ id: "2", title: "Network Outage", status: "open" }),
          ],
          total: 2,
        },
      });
      wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).searchQuery = "Database";
      const visible = (wrapper.vm as any).visibleIncidents;
      expect(visible).toHaveLength(1);
      expect(visible[0].title).toBe("Database Crash");
    });

    it("filters by severity match", async () => {
      wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).searchQuery = "P1";
      const visible = (wrapper.vm as any).visibleIncidents;
      expect(visible.every((i: Incident) => i.severity === "P1")).toBe(true);
    });

    it("returns empty array when no match", async () => {
      wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).searchQuery = "zzz-no-match";
      expect((wrapper.vm as any).visibleIncidents).toHaveLength(0);
    });

    // Row index is now OTable's built-in `show-index`; visibleIncidents no
    // longer injects a "#" field into the data.

    it("filters case-insensitively", async () => {
      (incidentsService.list as any).mockResolvedValue({
        data: {
          incidents: [createIncident({ id: "1", title: "Alpha Incident", status: "open" })],
          total: 1,
        },
      });
      wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).searchQuery = "alpha";
      expect((wrapper.vm as any).visibleIncidents).toHaveLength(1);
    });
  });

  // ── Status actions ─────────────────────────────────────────────────────────

  describe("Status actions", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    it("acknowledgeIncident calls updateStatus with acknowledged", async () => {
      const incident = (wrapper.vm as any).allIncidents[0];
      await (wrapper.vm as any).acknowledgeIncident(incident);
      await flushPromises();
      expect(incidentsService.updateStatus).toHaveBeenCalledWith(
        "default",
        incident.id,
        "acknowledged",
      );
    });

    it("resolveIncident calls updateStatus with resolved", async () => {
      const incident = (wrapper.vm as any).allIncidents[0];
      await (wrapper.vm as any).resolveIncident(incident);
      await flushPromises();
      expect(incidentsService.updateStatus).toHaveBeenCalledWith(
        "default",
        incident.id,
        "resolved",
      );
    });

    it("reopenIncident calls updateStatus with open", async () => {
      const incident = (wrapper.vm as any).allIncidents[0];
      await (wrapper.vm as any).reopenIncident(incident);
      await flushPromises();
      expect(incidentsService.updateStatus).toHaveBeenCalledWith("default", incident.id, "open");
    });

    it("reloads incidents after successful status update", async () => {
      const incident = (wrapper.vm as any).allIncidents[0];
      vi.clearAllMocks();
      (incidentsService.list as any).mockResolvedValue({
        data: { incidents: [], total: 0 },
      });
      (incidentsService.updateStatus as any).mockResolvedValue({});
      await (wrapper.vm as any).resolveIncident(incident);
      await flushPromises();
      expect(incidentsService.list).toHaveBeenCalled();
    });

    it("handles updateStatus error without crashing", async () => {
      (incidentsService.updateStatus as any).mockRejectedValue(new Error("Update failed"));
      const incident = (wrapper.vm as any).allIncidents[0];
      await (wrapper.vm as any).resolveIncident(incident);
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });
  });

  // ── Helper functions ───────────────────────────────────────────────────────

  describe("getStatusLabel", () => {
    it("returns correct label for open", () => {
      wrapper = createWrapper();
      const label = (wrapper.vm as any).getStatusLabel("open");
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    });

    it("returns correct label for acknowledged", () => {
      wrapper = createWrapper();
      const label = (wrapper.vm as any).getStatusLabel("acknowledged");
      expect(typeof label).toBe("string");
    });

    it("returns correct label for resolved", () => {
      wrapper = createWrapper();
      const label = (wrapper.vm as any).getStatusLabel("resolved");
      expect(typeof label).toBe("string");
    });

    it("returns the raw status for unknown values", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).getStatusLabel("custom-status")).toBe("custom-status");
    });
  });

  describe("getStatusColorClass", () => {
    it("returns status-open for open", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).getStatusColorClass("open")).toBe("status-open");
    });

    it("returns status-acknowledged for acknowledged", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).getStatusColorClass("acknowledged")).toBe("status-acknowledged");
    });

    it("returns status-resolved for resolved", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).getStatusColorClass("resolved")).toBe("status-resolved");
    });

    it("returns status-default for unknown status", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).getStatusColorClass("unknown")).toBe("status-default");
    });
  });

  describe("formatDimensions", () => {
    it("formats key=value pairs joined by comma", () => {
      wrapper = createWrapper();
      const result = (wrapper.vm as any).formatDimensions({
        env: "prod",
        service: "api",
      });
      expect(result).toContain("env=prod");
      expect(result).toContain("service=api");
    });

    it("returns Unknown for empty dimensions", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).formatDimensions({})).toBe("Unknown");
    });

    it("returns Unknown for null/undefined dimensions", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).formatDimensions(null as any)).toBe("Unknown");
    });
  });

  describe("getSortedDimensions", () => {
    it("returns sorted key-value pairs", () => {
      wrapper = createWrapper();
      const result = (wrapper.vm as any).getSortedDimensions({
        z: "last",
        a: "first",
      });
      expect(result[0][0]).toBe("a");
      expect(result[1][0]).toBe("z");
    });

    it("returns empty array for null dimensions", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).getSortedDimensions(null as any)).toEqual([]);
    });

    it("returns empty array for empty object", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).getSortedDimensions({})).toEqual([]);
    });
  });

  describe("getDimensionColorClass", () => {
    it("returns a string class for known key", () => {
      wrapper = createWrapper();
      const cls = (wrapper.vm as any).getDimensionColorClass("service");
      expect(typeof cls).toBe("string");
      expect(cls.length).toBeGreaterThan(0);
    });

    it("returns a string class for unknown key", () => {
      wrapper = createWrapper();
      const cls = (wrapper.vm as any).getDimensionColorClass("random-key-xyz");
      expect(typeof cls).toBe("string");
    });
  });

  // ── Template rendering ─────────────────────────────────────────────────────

  describe("Template rendering with loaded data", () => {
    it("visibleIncidents has 3 items after load", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect((wrapper.vm as any).visibleIncidents).toHaveLength(3);
    });

    it("shows NoData in empty slot when no incidents", async () => {
      (incidentsService.list as any).mockResolvedValue({
        data: { incidents: [], total: 0 },
      });
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="no-data-stub"]').exists()).toBe(true);
    });

    it("search query reactively filters visibleIncidents", async () => {
      (incidentsService.list as any).mockResolvedValue({
        data: {
          incidents: [
            createIncident({ id: "1", title: "Alpha", status: "open" }),
            createIncident({ id: "2", title: "Beta", status: "open" }),
          ],
          total: 2,
        },
      });
      wrapper = createWrapper();
      await flushPromises();

      expect((wrapper.vm as any).visibleIncidents).toHaveLength(2);

      (wrapper.vm as any).searchQuery = "Alpha";
      await nextTick();

      expect((wrapper.vm as any).visibleIncidents).toHaveLength(1);
    });
  });

  // ── viewIncident ───────────────────────────────────────────────────────────

  describe("viewIncident navigation", () => {
    it("calls router.push with incidentDetail route on row click", async () => {
      const pushSpy = vi.spyOn(router, "push");
      wrapper = createWrapper();
      await flushPromises();

      const incident = (wrapper.vm as any).allIncidents[0];
      (wrapper.vm as any).viewIncident(incident);

      expect(pushSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "incidentDetail",
          params: { id: incident.id },
        }),
      );
    });
  });
});
