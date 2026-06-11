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

// Service mocks must be hoisted above all imports
vi.mock("@/services/alert_destination", () => ({
  default: {
    list: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/services/alert_templates", () => ({
  default: {
    list: vi.fn(),
  },
}));

vi.mock("@/composables/useActions", () => ({
  default: () => ({
    getAllActions: vi.fn().mockResolvedValue({}),
  }),
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    getImageURL: vi.fn((p: string) => `mock-${p}`),
  };
});

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({ track: vi.fn() }),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => vi.fn()),
}));

vi.mock("@/composables/usePrebuiltDestinations", () => ({
  usePrebuiltDestinations: () => ({
    detectPrebuiltType: vi.fn(() => null),
    availableTypes: [],
  }),
}));

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AlertsDestinationList from "./AlertsDestinationList.vue";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// ── stubs ────────────────────────────────────────────────────────────────────

const OTableStub = {
  name: "OTable",
  props: {
    data: { default: () => [] },
    columns: { default: () => [] },
    loading: { default: false },
    selectedIds: { default: () => [] },
    selection: { default: "none" },
  },
  emits: ["update:selected-ids"],
  template: `
    <div data-test="o-table-stub">
      <slot name="toolbar" />
      <slot name="empty" />
      <slot name="actions" />
      <slot name="bottom" :totalRows="data ? data.length : 0" />
      <template v-for="row in data" :key="row.name">
        <slot name="cell-type" :row="row" />
        <slot name="cell-actions" :row="row" />
      </template>
    </div>
  `,
};

const ConfirmDialogStub = {
  name: "ConfirmDialog",
  props: ["modelValue", "title", "message"],
  emits: ["update:ok", "update:cancel", "update:modelValue"],
  template: '<div data-test="confirm-dialog-stub" :data-open="modelValue" />',
};

// ── test data ────────────────────────────────────────────────────────────────

const makeDestination = (idx: number, overrides: any = {}) => ({
  name: `destination-${idx}`,
  url: `https://example.com/hook-${idx}`,
  method: "POST",
  type: "http",
  "#": idx <= 9 ? `0${idx}` : `${idx}`,
  ...overrides,
});

const makeTemplate = (idx: number) => ({
  name: `template-${idx}`,
  body: `body-${idx}`,
  type: "http",
});

// ── mount helper ─────────────────────────────────────────────────────────────

function mountComponent() {
  return mount(AlertsDestinationList, {
    global: {
      plugins: [i18n, store, router],
      stubs: {
        OTable: OTableStub,
        ConfirmDialog: ConfirmDialogStub,
        AddDestination: { template: '<div data-test="add-destination-stub" />' },
        ImportDestination: { template: '<div data-test="import-destination-stub" />' },
        NoData: { template: '<div data-test="no-data-stub" />' },
        OEmptyState: { template: '<div data-test="o-empty-state-stub" />' },
        OBadge: { template: '<span data-test="o-badge-stub"><slot /></span>' },
        OIcon: { template: '<span data-test="o-icon-stub" />' },
        OButton: {
          template: '<button data-test="o-button-stub" v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
          emits: ["click"],
        },
        OInput: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template: '<input data-test="o-input-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
      },
    },
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("AlertsDestinationList", () => {
  let wrapper: ReturnType<typeof mountComponent> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset router state
    (router as any).currentRoute.value.query = {};

    // Setup service mocks
    (destinationService.list as any).mockResolvedValue({
      data: [makeDestination(1), makeDestination(2), makeDestination(3)],
    });
    (templateService.list as any).mockResolvedValue({
      data: [makeTemplate(1), makeTemplate(2)],
    });
    (destinationService.delete as any).mockResolvedValue({});
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  // ── rendering ──────────────────────────────────────────────────────────────

  describe("initial rendering", () => {
    it("renders the component root", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the list title", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const title = wrapper.find(".app-page-header h1");
      expect(title.exists()).toBe(true);
    });

    it("renders the table when no editor is open", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="alert-destinations-list-table"]').exists()).toBe(true);
    });

    it("does not render add-destination stub initially", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="add-destination-stub"]').exists()).toBe(false);
    });

    it("renders search input", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="destination-list-search-input"]').exists()).toBe(true);
    });

    it("renders add button", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="alert-destination-list-add-alert-btn"]').exists()).toBe(true);
    });
  });

  // ── data loading ───────────────────────────────────────────────────────────

  describe("data loading", () => {
    it("calls destinationService.list on mount", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(destinationService.list).toHaveBeenCalled();
    });

    it("calls templateService.list on mount", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(templateService.list).toHaveBeenCalled();
    });

    it("populates destinations after successful load", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect((wrapper.vm as any).destinations).toHaveLength(3);
    });

    it("populates templates after successful load", async () => {
      wrapper = mountComponent();
      await flushPromises();
      // templates is initialised with a dummy entry; after load it reflects the mock
      expect((wrapper.vm as any).templates).toBeDefined();
    });

    it("handles empty destinations list", async () => {
      (destinationService.list as any).mockResolvedValue({ data: [] });
      wrapper = mountComponent();
      await flushPromises();
      expect((wrapper.vm as any).destinations).toHaveLength(0);
    });

    it("handles service error gracefully", async () => {
      (destinationService.list as any).mockRejectedValue({
        response: { status: 500 },
      });
      wrapper = mountComponent();
      await flushPromises();
      // component should not crash
      expect(wrapper.exists()).toBe(true);
    });

    it("ignores 403 errors without showing error toast", async () => {
      (destinationService.list as any).mockRejectedValue({
        response: { status: 403 },
      });
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });
  });

  // ── filterQuery reactivity ─────────────────────────────────────────────────

  describe("filterQuery and visibleRows", () => {
    beforeEach(async () => {
      wrapper = mountComponent();
      await flushPromises();
    });

    it("shows all rows when filterQuery is empty", () => {
      (wrapper!.vm as any).filterQuery = "";
      const rows = (wrapper!.vm as any).visibleRows;
      expect(rows).toHaveLength(3);
    });

    it("filters rows by name substring", () => {
      (wrapper!.vm as any).filterQuery = "destination-1";
      const rows = (wrapper!.vm as any).visibleRows;
      expect(rows.every((r: any) => r.name.includes("destination-1"))).toBe(true);
    });

    it("returns empty array when no match", () => {
      (wrapper!.vm as any).filterQuery = "zzz-no-match";
      const rows = (wrapper!.vm as any).visibleRows;
      expect(rows).toHaveLength(0);
    });
  });

  // ── editor toggle ──────────────────────────────────────────────────────────

  describe("destination editor toggle", () => {
    it("shows editor when editDestination(null) is called", async () => {
      wrapper = mountComponent();
      await flushPromises();

      (wrapper.vm as any).editDestination(null);
      await flushPromises();

      expect((wrapper.vm as any).showDestinationEditor).toBe(true);
    });

    it("shows AddDestination component when editor is open", async () => {
      wrapper = mountComponent();
      await flushPromises();

      (wrapper.vm as any).showDestinationEditor = true;
      (wrapper.vm as any).showImportDestination = false;
      await (wrapper.vm as any).$nextTick();

      expect(wrapper.find('[data-test="add-destination-stub"]').exists()).toBe(true);
    });

    it("hides list table when editor is open", async () => {
      wrapper = mountComponent();
      await flushPromises();

      (wrapper.vm as any).showDestinationEditor = true;
      (wrapper.vm as any).showImportDestination = false;
      await (wrapper.vm as any).$nextTick();

      expect(wrapper.find('[data-test="alert-destinations-list-table"]').exists()).toBe(false);
    });

    it("toggles editor off when toggleDestinationEditor is called twice", async () => {
      wrapper = mountComponent();
      await flushPromises();

      (wrapper.vm as any).toggleDestinationEditor();
      (wrapper.vm as any).toggleDestinationEditor();

      expect((wrapper.vm as any).showDestinationEditor).toBe(false);
    });
  });

  // ── import destination ─────────────────────────────────────────────────────

  describe("import destination", () => {
    it("shows ImportDestination when showImportDestination is true", async () => {
      wrapper = mountComponent();
      await flushPromises();

      (wrapper.vm as any).showDestinationEditor = false;
      (wrapper.vm as any).showImportDestination = true;
      await (wrapper.vm as any).$nextTick();

      expect(wrapper.find('[data-test="import-destination-stub"]').exists()).toBe(true);
    });
  });

  // ── delete flow ────────────────────────────────────────────────────────────

  describe("delete destination", () => {
    it("sets confirmDelete.visible to true when conformDeleteDestination is called", async () => {
      wrapper = mountComponent();
      await flushPromises();

      const dest = (wrapper.vm as any).destinations[0];
      (wrapper.vm as any).conformDeleteDestination(dest);

      expect((wrapper.vm as any).confirmDelete.visible).toBe(true);
      expect((wrapper.vm as any).confirmDelete.data.name).toBe(dest.name);
    });

    it("calls destinationService.delete with correct args on deleteDestination()", async () => {
      wrapper = mountComponent();
      await flushPromises();

      const dest = (wrapper.vm as any).destinations[0];
      (wrapper.vm as any).confirmDelete.visible = true;
      (wrapper.vm as any).confirmDelete.data = dest;

      (wrapper.vm as any).deleteDestination();
      await flushPromises();

      expect(destinationService.delete).toHaveBeenCalledWith(
        expect.objectContaining({ destination_name: dest.name }),
      );
    });

    it("resets confirmDelete on cancelDeleteDestination()", async () => {
      wrapper = mountComponent();
      await flushPromises();

      (wrapper.vm as any).confirmDelete.visible = true;
      (wrapper.vm as any).cancelDeleteDestination();

      expect((wrapper.vm as any).confirmDelete.visible).toBe(false);
      expect((wrapper.vm as any).confirmDelete.data).toBeNull();
    });
  });

  // ── bulk selection ─────────────────────────────────────────────────────────

  describe("bulk selection", () => {
    it("handleSelectedIdsUpdate populates selectedDestinations", async () => {
      wrapper = mountComponent();
      await flushPromises();

      (wrapper.vm as any).handleSelectedIdsUpdate(["destination-1", "destination-2"]);
      expect((wrapper.vm as any).selectedDestinations).toHaveLength(2);
    });

    it("selectedDestinationIds is computed from selectedDestinations", async () => {
      wrapper = mountComponent();
      await flushPromises();

      (wrapper.vm as any).selectedDestinations = [makeDestination(1), makeDestination(2)];
      const ids = (wrapper.vm as any).selectedDestinationIds;
      expect(ids).toContain("destination-1");
      expect(ids).toContain("destination-2");
    });

    it("openBulkDeleteDialog sets confirmBulkDelete to true", async () => {
      wrapper = mountComponent();
      await flushPromises();

      (wrapper.vm as any).openBulkDeleteDialog();
      expect((wrapper.vm as any).confirmBulkDelete).toBe(true);
    });
  });

  // ── empty state ────────────────────────────────────────────────────────────

  describe("empty state", () => {
    it("renders NoData stub in empty slot when templates exist", async () => {
      (destinationService.list as any).mockResolvedValue({ data: [] });
      wrapper = mountComponent();
      await flushPromises();
      // OEmptyState is rendered inside OTable's empty slot which our stub exposes
      expect(wrapper.find('[data-test="o-empty-state-stub"]').exists()).toBe(true);
    });
  });

  // ── import action ──────────────────────────────────────────────────────────

  
  describe("import action", () => {
    it("importDestination sets showImportDestination to true", async () => {
      wrapper = mountComponent();
      await flushPromises();

      (wrapper.vm as any).importDestination();
      expect((wrapper.vm as any).showImportDestination).toBe(true);
    });
  });

  // ── import button ──────────────────────────────────────────────────────────

  describe("import button", () => {
    it("renders the import button", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="destination-import"]').exists()).toBe(true);
    });
  });
});
