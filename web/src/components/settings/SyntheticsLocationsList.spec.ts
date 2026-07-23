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
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import SyntheticsLocationsList from "./SyntheticsLocationsList.vue";

// ── Hoisted mock references (accessible inside vi.mock factories) ──────────────

const { mockToast, mockConfirm, mockGetLocations, mockUpdateLocation, mockDeleteLocation } =
  vi.hoisted(() => ({
    mockToast: vi.fn(),
    mockConfirm: vi.fn().mockResolvedValue(true),
    mockGetLocations: vi.fn(),
    mockUpdateLocation: vi.fn(),
    mockDeleteLocation: vi.fn(),
  }));

// ── Mock external modules ──────────────────────────────────────────────────────

vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "true" },
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path: string) => path),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));

vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({
    confirm: mockConfirm,
  }),
}));

// ── Mock synthetics service ────────────────────────────────────────────────────

vi.mock("@/services/synthetics", () => ({
  default: {
    getLocations: (...args: any[]) => mockGetLocations(...args),
    updateLocation: (...args: any[]) => mockUpdateLocation(...args),
    deleteLocation: (...args: any[]) => mockDeleteLocation(...args),
  },
}));

// ── Stubs ──────────────────────────────────────────────────────────────────────

const OPageLayoutStub = {
  name: "OPageLayout",
  template: `
    <div
      data-test="page-layout"
      :data-title="title"
      :data-icon="icon"
      :data-subtitle="subtitle"
    >
      <div data-test="page-actions"><slot name="actions" /></div>
      <slot />
    </div>
  `,
  props: ["title", "icon", "subtitle", "bleed"],
};

const OTableStub = {
  name: "OTable",
  template: `
    <div :data-test="$attrs['data-test']">
      <div data-test="table-toolbar"><slot name="toolbar" /></div>
      <div data-test="table-toolbar-trailing"><slot name="toolbar-trailing" /></div>
      <div data-test="table-empty"><slot name="empty" /></div>
      <div data-test="table-cells">
        <div
          v-for="(row, idx) in data"
          :key="row[rowKey] || idx"
          :data-row-id="row[rowKey]"
        >
          <slot name="cell-actions" :row="row" />
        </div>
      </div>
      <div data-test="table-bottom"><slot name="bottom" /></div>
    </div>
  `,
  props: [
    "data",
    "columns",
    "row-key",
    "selected-ids",
    "selection",
    "pagination",
    "page-size",
    "page-size-options",
    "sorting",
    "filter-mode",
    "default-columns",
    "show-index",
    "enable-column-resize",
    "persist-columns",
    "table-id",
    "show-global-filter",
    "loading",
    "frame",
  ],
  emits: ["update:selected-ids"],
};

const OButtonStub = {
  name: "OButton",
  template: `
    <button
      :data-test="$attrs['data-test']"
      :data-row-action="$attrs['data-row-action']"
      :disabled="$attrs['disabled']"
      @click="$emit('click', $event)"
    >
      <slot />
    </button>
  `,
  props: ["variant", "size", "icon-left", "icon-right", "title", "loading", "disabled"],
  emits: ["click"],
};

const OTooltipStub = {
  name: "OTooltip",
  template: "<span><slot /></span>",
  props: ["side", "content"],
};

const OSearchInputStub = {
  name: "OSearchInput",
  template: `
    <input
      data-test="search-input"
      :value="modelValue"
      :placeholder="placeholder"
      @input="$emit('update:modelValue', $event.target.value)"
    />
  `,
  props: ["modelValue", "placeholder", "class"],
  emits: ["update:modelValue"],
};

const OEmptyStateStub = {
  name: "OEmptyState",
  template: `
    <div
      data-test="empty-state"
      :data-preset="preset"
      :data-filtered="String(filtered)"
    />
  `,
  props: ["size", "preset", "filtered"],
  emits: ["action"],
};

const OSpinnerStub = {
  name: "OSpinner",
  template: '<div data-test="spinner" :data-size="size" />',
  props: ["size"],
};

const SyntheticsLocationFormStub = {
  name: "SyntheticsLocationForm",
  template: '<div data-test="synthetics-location-form-drawer" />',
  props: ["open", "data", "isEdit"],
  emits: ["update:list", "close"],
};

const ImportSyntheticsLocationsStub = {
  name: "ImportSyntheticsLocations",
  template: '<div data-test="import-synthetics-locations" />',
  emits: ["cancel:hideform", "update:list"],
};

// ── Test data ──────────────────────────────────────────────────────────────────

interface TestLocation {
  id: string;
  name: string;
  provider: string;
  region: string;
  enabled: boolean;
  kind: string;
  pool: string;
}

const createLocation = (overrides: Partial<TestLocation> = {}): TestLocation => ({
  id: "loc-1",
  name: "AWS US East",
  provider: "aws",
  region: "us-east-1",
  enabled: true,
  kind: "public",
  pool: "default",
  ...overrides,
});

const mockLocationsResponse = (locations: TestLocation[]) => ({
  data: { locations },
});

// ── Store & i18n factory ───────────────────────────────────────────────────────

const createMockStore = () =>
  createStore({
    state: {
      selectedOrganization: { identifier: "test-org" },
      theme: "light",
    },
  });

const createMockI18n = () =>
  createI18n({
    locale: "en",
    messages: {
      en: {
        synthetics: {
          locations: {
            title: "Locations",
            description: "Manage public probe locations for synthetic monitoring",
            addLocation: "Add Location",
            importTitle: "Import",
            exportTitle: "Export",
            locationId: "Location ID",
            label: "Label",
            provider: "Provider",
            region: "Region",
            searchPlaceholder: "Search locations…",
            enable: "Enable",
            disable: "Disable",
            enabling: "Enabling…",
            disabling: "Disabling…",
            enabledSuccess: "Location enabled",
            disabledSuccess: "Location disabled",
            toggleFailed: "Failed to toggle location",
            deleteConfirmTitle: "Delete Location",
            deleteConfirmMessage: "Are you sure you want to delete this location?",
            deleteSuccess: "Location deleted successfully",
            deleteFailed: "Failed to delete location",
            exportSuccess: "Locations exported successfully",
            exportFailed: "Failed to export locations",
            fetchFailed: "Failed to fetch locations",
            bottomHeader: "locations",
            selectedCount: "{selected} of {total} locations selected",
            bulkEnabledSuccess: "{count} locations enabled",
            bulkDisabledSuccess: "{count} locations disabled",
            bulkEnabledPartial: "{success} of {total} locations enabled",
            bulkDisabledPartial: "{success} of {total} locations disabled",
            bulkEnableFailed: "Failed to enable locations",
            bulkDisableFailed: "Failed to disable locations",
            bulkDeleteConfirmTitle: "Delete Locations",
            bulkDeleteConfirmMessage: "Are you sure you want to delete {count} locations?",
            bulkDeleteSuccess: "{count} locations deleted",
            bulkDeletePartial: "{success} of {total} locations deleted",
            bulkDeleteFailed: "Failed to delete locations",
          },
        },
        common: {
          refresh: "Refresh",
          edit: "Edit",
          delete: "Delete",
        },
      },
    },
  });

// ── Mount helper ───────────────────────────────────────────────────────────────

function mountComponent(store?: ReturnType<typeof createMockStore>) {
  const i18n = createMockI18n();
  const s = store || createMockStore();

  return mount(SyntheticsLocationsList, {
    global: {
      plugins: [i18n],
      provide: { store: s },
      stubs: {
        OPageLayout: OPageLayoutStub,
        OTable: OTableStub,
        OButton: OButtonStub,
        OTooltip: OTooltipStub,
        OSearchInput: OSearchInputStub,
        OEmptyState: OEmptyStateStub,
        OSpinner: OSpinnerStub,
        SyntheticsLocationForm: SyntheticsLocationFormStub,
        ImportSyntheticsLocations: ImportSyntheticsLocationsStub,
      },
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("SyntheticsLocationsList", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockToast.mockClear();
    mockConfirm.mockClear();
    mockGetLocations.mockReset();
    mockUpdateLocation.mockReset();
    mockDeleteLocation.mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  // ── Rendering ────────────────────────────────────────────────────────────────

  describe("rendering", () => {
    it("renders the page layout with correct title, icon, and subtitle", async () => {
      mockGetLocations.mockResolvedValue(mockLocationsResponse([]));
      wrapper = mountComponent();
      await flushPromises();

      const layout = wrapper.find('[data-test="page-layout"]');
      expect(layout.exists()).toBe(true);
      expect(layout.attributes("data-title")).toBe("Locations");
      expect(layout.attributes("data-icon")).toBe("location-on");
      expect(layout.attributes("data-subtitle")).toContain("Manage public probe locations");
    });

    it("renders add, import, and export buttons in the header actions", async () => {
      mockGetLocations.mockResolvedValue(mockLocationsResponse([]));
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="synthetics-locations-add-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="synthetics-locations-import-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="synthetics-locations-export-btn"]').exists()).toBe(true);
    });

    it("defines expected columns: name, id, provider, region, actions", async () => {
      mockGetLocations.mockResolvedValue(mockLocationsResponse([]));
      wrapper = mountComponent();
      await flushPromises();

      const columnIds = wrapper.vm.columns.map((c: any) => c.id);
      expect(columnIds).toContain("name");
      expect(columnIds).toContain("id");
      expect(columnIds).toContain("provider");
      expect(columnIds).toContain("region");
      expect(columnIds).toContain("actions");
    });

    it("renders the OTable with the correct data-test attribute", async () => {
      mockGetLocations.mockResolvedValue(mockLocationsResponse([]));
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="synthetics-locations-list-table"]').exists()).toBe(true);
    });

    it("renders the search input in the toolbar slot", async () => {
      mockGetLocations.mockResolvedValue(mockLocationsResponse([]));
      wrapper = mountComponent();
      await flushPromises();

      const searchInput = wrapper.find('[data-test="search-input"]');
      expect(searchInput.exists()).toBe(true);
      expect(searchInput.attributes("placeholder")).toBe("Search locations…");
    });
  });

  // ── Data fetching ────────────────────────────────────────────────────────────

  describe("fetchLocations", () => {
    it("calls getLocations with the org identifier on mount", async () => {
      mockGetLocations.mockResolvedValue(mockLocationsResponse([]));
      wrapper = mountComponent();
      await flushPromises();

      expect(mockGetLocations).toHaveBeenCalledWith("test-org");
      expect(mockGetLocations).toHaveBeenCalledTimes(1);
    });

    it("populates locations ref with the fetched data", async () => {
      const locs = [
        createLocation({ id: "loc-1", name: "AWS US East" }),
        createLocation({ id: "loc-2", name: "GCP Europe", provider: "gcp" }),
      ];
      mockGetLocations.mockResolvedValue(mockLocationsResponse(locs));
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.vm.locations).toHaveLength(2);
      expect(wrapper.vm.locations[0].name).toBe("AWS US East");
      expect(wrapper.vm.locations[1].name).toBe("GCP Europe");
      expect(wrapper.vm.resultTotal).toBe(2);
    });

    it("filters out private locations, keeping only public ones", async () => {
      const locs = [
        createLocation({ id: "pub-1", name: "Public 1", kind: "public" }),
        createLocation({ id: "priv-1", name: "Private 1", kind: "private" }),
        createLocation({ id: "pub-2", name: "Public 2", kind: "public" }),
        createLocation({ id: "priv-2", name: "Private 2", kind: "private" }),
      ];
      mockGetLocations.mockResolvedValue(mockLocationsResponse(locs));
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.vm.locations).toHaveLength(2);
      const ids = wrapper.vm.locations.map((l: TestLocation) => l.id);
      expect(ids).toEqual(["pub-1", "pub-2"]);
      expect(ids).not.toContain("priv-1");
      expect(ids).not.toContain("priv-2");
      expect(wrapper.vm.resultTotal).toBe(2);
    });

    it("shows loading state while fetching, and clears it afterward", async () => {
      let resolvePromise: (v: any) => void;
      const pending = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockGetLocations.mockReturnValue(pending);

      wrapper = mountComponent();
      await nextTick();

      expect(wrapper.vm.listLoading).toBe(true);

      resolvePromise!(mockLocationsResponse([]));
      await flushPromises();

      expect(wrapper.vm.listLoading).toBe(false);
    });

    it("handles fetch error gracefully: shows toast and stops loading", async () => {
      mockGetLocations.mockRejectedValue({
        response: { data: { message: "Server error" } },
      });
      wrapper = mountComponent();
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Server error",
          variant: "error",
        }),
      );
      expect(wrapper.vm.listLoading).toBe(false);
      expect(wrapper.vm.locations).toHaveLength(0);
    });

    it("shows default error message when fetch error has no response message", async () => {
      mockGetLocations.mockRejectedValue(new Error("Network error"));
      wrapper = mountComponent();
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Failed to fetch locations",
          variant: "error",
        }),
      );
    });

    it("handles response with no locations array gracefully", async () => {
      mockGetLocations.mockResolvedValue({ data: {} });
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.vm.locations).toHaveLength(0);
      expect(wrapper.vm.resultTotal).toBe(0);
    });
  });

  // ── Client-side filtering ────────────────────────────────────────────────────

  describe("filtering", () => {
    beforeEach(async () => {
      const locs = [
        createLocation({ id: "loc-1", name: "AWS US East", provider: "aws", region: "us-east-1" }),
        createLocation({
          id: "loc-2",
          name: "GCP Europe",
          provider: "gcp",
          region: "europe-west1",
        }),
        createLocation({ id: "loc-3", name: "Azure West US", provider: "azure", region: "westus" }),
      ];
      mockGetLocations.mockResolvedValue(mockLocationsResponse(locs));
      wrapper = mountComponent();
      await flushPromises();
    });

    it("filters visible rows by name (case-insensitive)", async () => {
      wrapper.vm.filterQuery = "azure";
      await nextTick();
      expect(wrapper.vm.visibleRows).toHaveLength(1);
      expect(wrapper.vm.visibleRows[0].name).toBe("Azure West US");
    });

    it("filters visible rows by id", async () => {
      wrapper.vm.filterQuery = "loc-2";
      await nextTick();
      expect(wrapper.vm.visibleRows).toHaveLength(1);
      expect(wrapper.vm.visibleRows[0].id).toBe("loc-2");
    });

    it("filters visible rows by provider", async () => {
      wrapper.vm.filterQuery = "gcp";
      await nextTick();
      expect(wrapper.vm.visibleRows).toHaveLength(1);
      expect(wrapper.vm.visibleRows[0].provider).toBe("gcp");
    });

    it("filters visible rows by region", async () => {
      wrapper.vm.filterQuery = "west";
      await nextTick();
      expect(wrapper.vm.visibleRows).toHaveLength(2); // "us-east-1" doesn't match
      const regions = wrapper.vm.visibleRows.map((r: TestLocation) => r.region);
      expect(regions).toContain("europe-west1");
      expect(regions).toContain("westus");
    });

    it("returns all rows when filter query is empty", async () => {
      wrapper.vm.filterQuery = "";
      await nextTick();
      expect(wrapper.vm.visibleRows).toHaveLength(3);
    });

    it("returns empty array when no rows match", async () => {
      wrapper.vm.filterQuery = "nonexistent";
      await nextTick();
      expect(wrapper.vm.visibleRows).toHaveLength(0);
    });

    it("updates resultTotal after filtering", async () => {
      wrapper.vm.filterQuery = "aws";
      await nextTick();
      expect(wrapper.vm.resultTotal).toBe(1);
    });

    it("shows filtered empty state when search yields no results", async () => {
      wrapper.vm.filterQuery = "nonexistent";
      await nextTick();

      const emptyState = wrapper.find('[data-test="empty-state"]');
      expect(emptyState.exists()).toBe(true);
      expect(emptyState.attributes("data-preset")).toBe("no-search-results");
      expect(emptyState.attributes("data-filtered")).toBe("true");
    });

    it("shows no-data empty state when there are no locations at all", async () => {
      // Re-mount with no locations
      wrapper.unmount();
      mockGetLocations.mockResolvedValue(mockLocationsResponse([]));
      wrapper = mountComponent();
      await flushPromises();

      const emptyState = wrapper.find('[data-test="empty-state"]');
      expect(emptyState.exists()).toBe(true);
      expect(emptyState.attributes("data-preset")).toBe("no-data");
      expect(emptyState.attributes("data-filtered")).toBe("false");
    });
  });

  // ── Create / Edit dialog ─────────────────────────────────────────────────────

  describe("dialog management", () => {
    beforeEach(async () => {
      mockGetLocations.mockResolvedValue(mockLocationsResponse([]));
      wrapper = mountComponent();
      await flushPromises();
    });

    it("opens create dialog when add button is clicked", async () => {
      const addBtn = wrapper.find('[data-test="synthetics-locations-add-btn"]');
      await addBtn.trigger("click");

      expect(wrapper.vm.formDialog.show).toBe(true);
      expect(wrapper.vm.formDialog.isEdit).toBe(false);
      expect(wrapper.vm.formDialog.data).toEqual({});
    });

    it("opens edit dialog with the correct row data", async () => {
      const row = createLocation({ id: "loc-1", name: "AWS US East" });
      wrapper.vm.openEditDialog(row);
      await nextTick();

      expect(wrapper.vm.formDialog.show).toBe(true);
      expect(wrapper.vm.formDialog.isEdit).toBe(true);
      expect(wrapper.vm.formDialog.data).toEqual(row);
    });

    it("closes the form dialog via closeFormDialog", async () => {
      wrapper.vm.formDialog.show = true;
      wrapper.vm.closeFormDialog();
      await nextTick();

      expect(wrapper.vm.formDialog.show).toBe(false);
    });

    it("opens import dialog when import button is clicked", async () => {
      const importBtn = wrapper.find('[data-test="synthetics-locations-import-btn"]');
      await importBtn.trigger("click");

      expect(wrapper.vm.showImportDialog).toBe(true);
    });
  });

  // ── Enable / Disable toggle (single row) ─────────────────────────────────────

  describe("toggleLocationEnabled", () => {
    beforeEach(async () => {
      const locs = [
        createLocation({ id: "loc-1", name: "AWS US East", enabled: true }),
        createLocation({ id: "loc-2", name: "GCP Europe", enabled: false }),
      ];
      mockGetLocations.mockResolvedValue(mockLocationsResponse(locs));
      wrapper = mountComponent();
      await flushPromises();
    });

    it("calls updateLocation with toggled enabled state and correct params", async () => {
      const row = wrapper.vm.locations[0]; // enabled: true
      mockUpdateLocation.mockResolvedValue({ data: {} });

      await wrapper.vm.toggleLocationEnabled(row);
      await flushPromises();

      expect(mockUpdateLocation).toHaveBeenCalledWith("test-org", "loc-1", {
        label: "AWS US East",
        enabled: false,
      });
    });

    it("updates the local row enabled state in-place after successful toggle", async () => {
      const row = wrapper.vm.locations[0];
      expect(row.enabled).toBe(true);

      mockUpdateLocation.mockResolvedValue({ data: {} });
      await wrapper.vm.toggleLocationEnabled(row);
      await flushPromises();

      expect(wrapper.vm.locations[0].enabled).toBe(false);
    });

    it("enables a disabled location", async () => {
      const row = wrapper.vm.locations[1]; // enabled: false
      mockUpdateLocation.mockResolvedValue({ data: {} });

      await wrapper.vm.toggleLocationEnabled(row);
      await flushPromises();

      expect(mockUpdateLocation).toHaveBeenCalledWith("test-org", "loc-2", {
        label: "GCP Europe",
        enabled: true,
      });
      expect(wrapper.vm.locations[1].enabled).toBe(true);
    });

    it("shows success toast after enabling", async () => {
      const row = wrapper.vm.locations[1];
      mockUpdateLocation.mockResolvedValue({ data: {} });

      await wrapper.vm.toggleLocationEnabled(row);
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Location enabled",
          variant: "success",
        }),
      );
    });

    it("shows success toast after disabling", async () => {
      const row = wrapper.vm.locations[0];
      mockUpdateLocation.mockResolvedValue({ data: {} });

      await wrapper.vm.toggleLocationEnabled(row);
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Location disabled",
          variant: "success",
        }),
      );
    });

    it("sets and clears toggleLoadingMap during the toggle operation", async () => {
      let resolvePromise: (v: any) => void;
      const pending = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockUpdateLocation.mockReturnValue(pending);

      const row = wrapper.vm.locations[0];
      const togglePromise = wrapper.vm.toggleLocationEnabled(row);
      await nextTick();

      expect(wrapper.vm.toggleLoadingMap["loc-1"]).toBe(true);

      resolvePromise!({ data: {} });
      await togglePromise;
      await flushPromises();

      expect(wrapper.vm.toggleLoadingMap["loc-1"]).toBe(false);
    });

    it("handles toggle error gracefully", async () => {
      const row = wrapper.vm.locations[0];
      mockUpdateLocation.mockRejectedValue({
        response: { data: { message: "Toggle error" } },
      });

      await wrapper.vm.toggleLocationEnabled(row);
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Toggle error",
          variant: "error",
        }),
      );
      // The enabled state should NOT have changed
      expect(wrapper.vm.locations[0].enabled).toBe(true);
    });

    it("clears selected locations after a successful toggle", async () => {
      const row = wrapper.vm.locations[0];
      wrapper.vm.selectedLocations = [{ id: "some-other" }];
      mockUpdateLocation.mockResolvedValue({ data: {} });

      await wrapper.vm.toggleLocationEnabled(row);
      await flushPromises();

      expect(wrapper.vm.selectedLocations).toHaveLength(0);
    });
  });

  // ── Bulk enable / disable ────────────────────────────────────────────────────

  describe("bulkToggleEnabled", () => {
    beforeEach(async () => {
      const locs = [
        createLocation({ id: "loc-1", name: "Loc 1", enabled: true }),
        createLocation({ id: "loc-2", name: "Loc 2", enabled: true }),
        createLocation({ id: "loc-3", name: "Loc 3", enabled: false }),
      ];
      mockGetLocations.mockResolvedValue(mockLocationsResponse(locs));
      wrapper = mountComponent();
      await flushPromises();
    });

    it("calls updateLocation for each selected location", async () => {
      mockUpdateLocation.mockResolvedValue({ data: {} });
      wrapper.vm.selectedLocations = [wrapper.vm.locations[0], wrapper.vm.locations[1]];

      await wrapper.vm.bulkToggleEnabled(false);
      await flushPromises();

      expect(mockUpdateLocation).toHaveBeenCalledTimes(2);
      expect(mockUpdateLocation).toHaveBeenCalledWith("test-org", "loc-1", {
        label: "Loc 1",
        enabled: false,
      });
      expect(mockUpdateLocation).toHaveBeenCalledWith("test-org", "loc-2", {
        label: "Loc 2",
        enabled: false,
      });
    });

    it("updates local rows in-place after successful bulk operation", async () => {
      mockUpdateLocation.mockResolvedValue({ data: {} });
      wrapper.vm.selectedLocations = [wrapper.vm.locations[0], wrapper.vm.locations[1]];

      await wrapper.vm.bulkToggleEnabled(false);
      await flushPromises();

      expect(wrapper.vm.locations[0].enabled).toBe(false);
      expect(wrapper.vm.locations[1].enabled).toBe(false);
    });

    it("shows success toast when all bulk operations succeed", async () => {
      mockUpdateLocation.mockResolvedValue({ data: {} });
      wrapper.vm.selectedLocations = [wrapper.vm.locations[0]];

      await wrapper.vm.bulkToggleEnabled(true);
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "1 locations enabled",
          variant: "success",
        }),
      );
    });

    it("shows warning toast when some bulk operations fail", async () => {
      mockUpdateLocation
        .mockResolvedValueOnce({ data: {} })
        .mockRejectedValueOnce(new Error("fail"));
      wrapper.vm.selectedLocations = [wrapper.vm.locations[0], wrapper.vm.locations[1]];

      await wrapper.vm.bulkToggleEnabled(false);
      await flushPromises();

      // The first call succeeded, the second failed
      expect(wrapper.vm.locations[0].enabled).toBe(false);
      expect(wrapper.vm.locations[1].enabled).toBe(true); // unchanged

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "1 of 2 locations disabled",
          variant: "warning",
        }),
      );
    });

    it("shows error toast when all bulk operations fail", async () => {
      mockUpdateLocation.mockRejectedValue(new Error("fail"));
      wrapper.vm.selectedLocations = [wrapper.vm.locations[0], wrapper.vm.locations[1]];

      await wrapper.vm.bulkToggleEnabled(true);
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Failed to enable locations",
          variant: "error",
        }),
      );
    });

    it("clears selected locations after bulk operation", async () => {
      mockUpdateLocation.mockResolvedValue({ data: {} });
      wrapper.vm.selectedLocations = [wrapper.vm.locations[0]];

      await wrapper.vm.bulkToggleEnabled(true);
      await flushPromises();

      expect(wrapper.vm.selectedLocations).toHaveLength(0);
    });

    it("sets and clears bulkActionLoading flag", async () => {
      let resolvePromise: (v: any) => void;
      const pending = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockUpdateLocation.mockReturnValue(pending);
      wrapper.vm.selectedLocations = [wrapper.vm.locations[0]];

      const bulkPromise = wrapper.vm.bulkToggleEnabled(true);
      await nextTick();

      expect(wrapper.vm.bulkActionLoading).toBe(true);

      resolvePromise!({ data: {} });
      await bulkPromise;
      await flushPromises();

      expect(wrapper.vm.bulkActionLoading).toBe(false);
    });
  });

  // ── Delete ───────────────────────────────────────────────────────────────────

  describe("confirmDelete", () => {
    beforeEach(async () => {
      const locs = [
        createLocation({ id: "loc-1", name: "AWS US East" }),
        createLocation({ id: "loc-2", name: "GCP Europe" }),
      ];
      mockGetLocations.mockResolvedValue(mockLocationsResponse(locs));
      wrapper = mountComponent();
      await flushPromises();
    });

    it("shows confirm dialog and deletes on confirmation", async () => {
      mockConfirm.mockResolvedValue(true);
      mockDeleteLocation.mockResolvedValue({ data: {} });
      const row = wrapper.vm.locations[0];

      await wrapper.vm.confirmDelete(row);
      await flushPromises();

      expect(mockConfirm).toHaveBeenCalledWith({
        title: "Delete Location",
        message: "Are you sure you want to delete this location?",
      });
      expect(mockDeleteLocation).toHaveBeenCalledWith("test-org", "loc-1");
    });

    it("removes the location from the local array on successful delete", async () => {
      mockConfirm.mockResolvedValue(true);
      mockDeleteLocation.mockResolvedValue({ data: {} });
      const row = wrapper.vm.locations[0];

      await wrapper.vm.confirmDelete(row);
      await flushPromises();

      expect(wrapper.vm.locations).toHaveLength(1);
      expect(wrapper.vm.locations[0].id).toBe("loc-2");
      expect(wrapper.vm.resultTotal).toBe(1);
    });

    it("does NOT delete when the user cancels the confirmation", async () => {
      mockConfirm.mockResolvedValue(false);
      const row = wrapper.vm.locations[0];

      await wrapper.vm.confirmDelete(row);
      await flushPromises();

      expect(mockDeleteLocation).not.toHaveBeenCalled();
      expect(wrapper.vm.locations).toHaveLength(2);
    });

    it("shows success toast after deletion", async () => {
      mockConfirm.mockResolvedValue(true);
      mockDeleteLocation.mockResolvedValue({ data: {} });
      const row = wrapper.vm.locations[0];

      await wrapper.vm.confirmDelete(row);
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Location deleted successfully",
          variant: "success",
        }),
      );
    });

    it("shows error toast on delete failure", async () => {
      mockConfirm.mockResolvedValue(true);
      mockDeleteLocation.mockRejectedValue({
        response: { data: { message: "Delete error" } },
      });
      const row = wrapper.vm.locations[0];

      await wrapper.vm.confirmDelete(row);
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Delete error",
          variant: "error",
        }),
      );
    });
  });

  // ── Bulk delete ──────────────────────────────────────────────────────────────

  describe("bulkDeleteLocations", () => {
    beforeEach(async () => {
      const locs = [
        createLocation({ id: "loc-1", name: "Loc 1" }),
        createLocation({ id: "loc-2", name: "Loc 2" }),
        createLocation({ id: "loc-3", name: "Loc 3" }),
      ];
      mockGetLocations.mockResolvedValue(mockLocationsResponse(locs));
      wrapper = mountComponent();
      await flushPromises();
    });

    it("calls deleteLocation for each selected location", async () => {
      mockDeleteLocation.mockResolvedValue({ data: {} });
      wrapper.vm.selectedLocations = [wrapper.vm.locations[0], wrapper.vm.locations[1]];

      await wrapper.vm.bulkDeleteLocations();
      await flushPromises();

      expect(mockDeleteLocation).toHaveBeenCalledTimes(2);
      expect(mockDeleteLocation).toHaveBeenCalledWith("test-org", "loc-1");
      expect(mockDeleteLocation).toHaveBeenCalledWith("test-org", "loc-2");
    });

    it("removes deleted locations from the local array", async () => {
      mockDeleteLocation.mockResolvedValue({ data: {} });
      wrapper.vm.selectedLocations = [wrapper.vm.locations[0], wrapper.vm.locations[1]];

      await wrapper.vm.bulkDeleteLocations();
      await flushPromises();

      expect(wrapper.vm.locations).toHaveLength(1);
      expect(wrapper.vm.locations[0].id).toBe("loc-3");
      expect(wrapper.vm.resultTotal).toBe(1);
    });

    it("handles partial failures during bulk delete", async () => {
      mockDeleteLocation
        .mockResolvedValueOnce({ data: {} })
        .mockRejectedValueOnce(new Error("fail"));
      wrapper.vm.selectedLocations = [wrapper.vm.locations[0], wrapper.vm.locations[1]];

      await wrapper.vm.bulkDeleteLocations();
      await flushPromises();

      // Only loc-1 should be removed (succeeded), loc-2 stays (failed), loc-3 is untouched
      expect(wrapper.vm.locations).toHaveLength(2);
      const remainingIds = wrapper.vm.locations.map((l: TestLocation) => l.id);
      expect(remainingIds).toContain("loc-2");
      expect(remainingIds).toContain("loc-3");

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "1 of 2 locations deleted",
          variant: "warning",
        }),
      );
    });

    it("shows confirm dialog before bulk delete", async () => {
      mockConfirm.mockResolvedValue(true);
      mockDeleteLocation.mockResolvedValue({ data: {} });
      wrapper.vm.selectedLocations = [wrapper.vm.locations[0], wrapper.vm.locations[1]];

      await wrapper.vm.openBulkDeleteConfirm();
      await flushPromises();

      expect(mockConfirm).toHaveBeenCalledWith({
        title: "Delete Locations",
        message: "Are you sure you want to delete 2 locations?",
      });
    });

    it("clears selected locations after bulk delete", async () => {
      mockDeleteLocation.mockResolvedValue({ data: {} });
      wrapper.vm.selectedLocations = [wrapper.vm.locations[0]];

      await wrapper.vm.bulkDeleteLocations();
      await flushPromises();

      expect(wrapper.vm.selectedLocations).toHaveLength(0);
    });
  });

  // ── Export ───────────────────────────────────────────────────────────────────

  describe("exportLocations", () => {
    beforeEach(async () => {
      const locs = [
        createLocation({
          id: "loc-1",
          name: "AWS US East",
          provider: "aws",
          region: "us-east-1",
          enabled: true,
        }),
        createLocation({
          id: "loc-2",
          name: "GCP Europe",
          provider: "gcp",
          region: "europe-west1",
          enabled: false,
        }),
      ];
      mockGetLocations.mockResolvedValue(mockLocationsResponse(locs));
      wrapper = mountComponent();
      await flushPromises();
    });

    it("creates a download blob and triggers a click on an anchor element", async () => {
      const linkClickSpy = vi.fn();
      const originalCreateElement = document.createElement.bind(document);
      const createElementSpy = vi
        .spyOn(document, "createElement")
        .mockImplementation((tagName: string, _options?: any) => {
          const el = originalCreateElement(tagName);
          if (tagName === "a") {
            el.click = linkClickSpy;
          }
          return el;
        });

      wrapper.vm.exportLocations();
      await nextTick();

      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(linkClickSpy).toHaveBeenCalled();
      expect(global.URL.revokeObjectURL).toHaveBeenCalled();

      createElementSpy.mockRestore();
    });

    it("exports correct JSON structure with provider, region, label, enabled", () => {
      const stringifySpy = vi.spyOn(JSON, "stringify");

      wrapper.vm.exportLocations();

      // Verify that JSON.stringify was called with the correct export shape
      expect(stringifySpy).toHaveBeenCalled();
      const exportedData = stringifySpy.mock.calls[0][0];
      expect(exportedData).toHaveLength(2);
      expect(exportedData[0]).toEqual({
        provider: "aws",
        region: "us-east-1",
        label: "AWS US East",
        enabled: true,
      });
      expect(exportedData[1]).toEqual({
        provider: "gcp",
        region: "europe-west1",
        label: "GCP Europe",
        enabled: false,
      });

      stringifySpy.mockRestore();
    });

    it("shows success toast after export", async () => {
      wrapper.vm.exportLocations();
      await nextTick();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Locations exported successfully",
          variant: "success",
        }),
      );
    });

    it("triggers export on export button click", async () => {
      const exportBtn = wrapper.find('[data-test="synthetics-locations-export-btn"]');
      expect(exportBtn.exists()).toBe(true);

      await exportBtn.trigger("click");
      await nextTick();

      // The exportLocations method should have been invoked via the @click handler
      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });
  });

  // ── Row selection ────────────────────────────────────────────────────────────

  describe("handleSelectedIdsUpdate", () => {
    beforeEach(async () => {
      const locs = [
        createLocation({ id: "loc-1", name: "Loc 1" }),
        createLocation({ id: "loc-2", name: "Loc 2" }),
        createLocation({ id: "loc-3", name: "Loc 3" }),
      ];
      mockGetLocations.mockResolvedValue(mockLocationsResponse(locs));
      wrapper = mountComponent();
      await flushPromises();
    });

    it("maps selected ids to full location objects", async () => {
      wrapper.vm.handleSelectedIdsUpdate(["loc-1", "loc-3"]);
      await nextTick();

      expect(wrapper.vm.selectedLocations).toHaveLength(2);
      expect(wrapper.vm.selectedLocations[0].id).toBe("loc-1");
      expect(wrapper.vm.selectedLocations[1].id).toBe("loc-3");
    });

    it("computed selectedLocationIds returns the correct array of ids", async () => {
      wrapper.vm.handleSelectedIdsUpdate(["loc-2"]);
      await nextTick();

      expect(wrapper.vm.selectedLocationIds).toEqual(["loc-2"]);
    });

    it("ignores ids that do not match any location", async () => {
      wrapper.vm.handleSelectedIdsUpdate(["loc-1", "nonexistent"]);
      await nextTick();

      expect(wrapper.vm.selectedLocations).toHaveLength(1);
      expect(wrapper.vm.selectedLocations[0].id).toBe("loc-1");
    });

    it("clears selection when empty array is passed", async () => {
      wrapper.vm.handleSelectedIdsUpdate(["loc-1"]);
      await nextTick();
      expect(wrapper.vm.selectedLocations).toHaveLength(1);

      wrapper.vm.handleSelectedIdsUpdate([]);
      await nextTick();
      expect(wrapper.vm.selectedLocations).toHaveLength(0);
    });
  });

  // ── Template: bulk action buttons ────────────────────────────────────────────

  describe("bulk action buttons template", () => {
    beforeEach(async () => {
      const locs = [
        createLocation({ id: "loc-1", name: "Loc 1" }),
        createLocation({ id: "loc-2", name: "Loc 2" }),
      ];
      mockGetLocations.mockResolvedValue(mockLocationsResponse(locs));
      wrapper = mountComponent();
      await flushPromises();
    });

    it("renders no bulk action buttons when no rows are selected", () => {
      wrapper.vm.selectedLocations = [];
      // No bulk buttons should be visible since selectedLocations is empty
      expect(wrapper.find('[data-test="synthetics-locations-enable-selected-btn"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="synthetics-locations-disable-selected-btn"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="synthetics-locations-delete-selected-btn"]').exists()).toBe(
        false,
      );
    });

    it("shows count text with total when no rows selected", () => {
      wrapper.vm.selectedLocations = [];
      expect(wrapper.vm.resultTotal).toBe(2);
    });
  });

  // ── Refresh ──────────────────────────────────────────────────────────────────

  describe("refresh", () => {
    it("refreshes locations when the refresh button is clicked", async () => {
      mockGetLocations.mockResolvedValue(mockLocationsResponse([]));
      wrapper = mountComponent();
      await flushPromises();
      expect(mockGetLocations).toHaveBeenCalledTimes(1);

      mockGetLocations.mockClear();
      mockGetLocations.mockResolvedValue(mockLocationsResponse([]));

      const refreshBtn = wrapper.find('[data-test="synthetics-locations-refresh-btn"]');
      await refreshBtn.trigger("click");
      await flushPromises();

      expect(mockGetLocations).toHaveBeenCalledTimes(1);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles null/undefined locations gracefully in filterData", async () => {
      mockGetLocations.mockResolvedValue(mockLocationsResponse([]));
      wrapper = mountComponent();
      await flushPromises();

      // Manually push a location with null fields to verify filterData handles it
      wrapper.vm.locations = [
        {
          id: "null-loc",
          name: null,
          provider: null,
          region: null,
          enabled: false,
          kind: "public",
        },
      ];
      wrapper.vm.filterQuery = "test";
      await nextTick();

      // Should not throw; filterData uses ?. operators
      expect(wrapper.vm.visibleRows).toHaveLength(0);
    });

    it("response with locations as undefined defaults to empty array", async () => {
      mockGetLocations.mockResolvedValue({ data: {} });
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.vm.locations).toHaveLength(0);
      expect(wrapper.vm.resultTotal).toBe(0);
    });
  });
});
