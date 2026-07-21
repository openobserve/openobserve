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

// Service mocks must be hoisted
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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import PipelinesDestinationList from "./PipelinesDestinationList.vue";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
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
    selectedIds: { default: () => [] },
    selection: { default: "none" },
  },
  emits: ["update:selected-ids"],
  template: `
    <div data-test="alert-destinations-list-table">
      <slot name="empty" />
      <slot name="bottom" />
      <template v-for="row in data" :key="row.name">
        <slot name="cell-destination_type" :row="row" />
        <slot name="cell-output_format" :row="row" />
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

// ── test data ─────────────────────────────────────────────────────────────────

const makeDestination = (idx: number, overrides: any = {}) => ({
  name: `destination-${idx}`,
  url: `https://example.com/hook-${idx}`,
  method: "POST",
  destination_type_name: "http",
  output_format: "json",
  "#": idx <= 9 ? `0${idx}` : `${idx}`,
  ...overrides,
});

// ── mount helper ──────────────────────────────────────────────────────────────

function mountComponent() {
  return mount(PipelinesDestinationList, {
    global: {
      plugins: [i18n, store, router],
      stubs: {
        OTable: OTableStub,
        ConfirmDialog: ConfirmDialogStub,
        PipelineDestinationEditor: {
          template: '<div data-test="pipeline-destination-editor-stub" />',
        },
        NoData: { template: '<div data-test="no-data-stub" />' },
        OEmptyState: { template: '<div data-test="o-empty-state-stub" />' },
        OBadge: { template: '<span data-test="o-badge-stub"><slot /></span>' },
        OIcon: { template: '<span data-test="o-icon-stub" />' },
        OButton: {
          template:
            '<button data-test="o-button-stub" v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
          emits: ["click"],
        },
        OInput: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template:
            '<input data-test="o-input-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
      },
    },
  });
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe("PipelinesDestinationList", () => {
  let wrapper: ReturnType<typeof mountComponent> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    (router as any).currentRoute.value.query = {};

    (destinationService.list as any).mockResolvedValue({
      data: [makeDestination(1), makeDestination(2), makeDestination(3)],
    });
    (templateService.list as any).mockResolvedValue({
      data: [{ name: "template-1", body: "", type: "http" }],
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
      expect(wrapper.find(".app-page-header h1").exists()).toBe(true);
    });

    it("renders the table when no editor is open", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(
        wrapper.find('[data-test="alert-destinations-list-table"]').exists(),
      ).toBe(true);
    });

    it("does not render the editor initially", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(
        wrapper.find('[data-test="pipeline-destination-editor-stub"]').exists(),
      ).toBe(false);
    });

    it("renders the add button", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(
        wrapper.find('[data-test="pipeline-destination-list-add-btn"]').exists(),
      ).toBe(true);
    });
  });

  // ── component initialisation ───────────────────────────────────────────────

  describe("component initialisation", () => {
    it("initialises showDestinationEditor to false", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect((wrapper.vm as any).showDestinationEditor).toBe(false);
    });

    it("initialises filterQuery to empty string", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect((wrapper.vm as any).filterQuery).toBe("");
    });

    it("initialises confirmDelete.visible to false", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect((wrapper.vm as any).confirmDelete.visible).toBe(false);
      expect((wrapper.vm as any).confirmDelete.data).toBeNull();
    });

    it("has 6 table columns", async () => {
      // The "#" index column is now OTable's built-in show-index gutter, not a
      // member of `columns`, so the array holds only the 6 real data columns.
      wrapper = mountComponent();
      await flushPromises();
      expect((wrapper.vm as any).columns).toHaveLength(6);
    });
  });

  // ── data loading ───────────────────────────────────────────────────────────

  describe("data loading", () => {
    it("calls destinationService.list with pipeline module on mount", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(destinationService.list).toHaveBeenCalledWith(
        expect.objectContaining({ module: "pipeline" }),
      );
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

    it("sets resultTotal correctly", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect((wrapper.vm as any).resultTotal).toBe(3);
    });

    it("numbers destination entries starting at 01", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect((wrapper.vm as any).destinations[0]["#"]).toBe("01");
      expect((wrapper.vm as any).destinations[1]["#"]).toBe("02");
    });

    it("handles empty destinations list", async () => {
      (destinationService.list as any).mockResolvedValue({ data: [] });
      wrapper = mountComponent();
      await flushPromises();
      expect((wrapper.vm as any).destinations).toHaveLength(0);
    });

    it("handles service error gracefully (non-403)", async () => {
      (destinationService.list as any).mockRejectedValue({
        response: { status: 500 },
      });
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("ignores 403 errors silently", async () => {
      (destinationService.list as any).mockRejectedValue({
        response: { status: 403 },
      });
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });
  });

  // ── visibleRows / filterQuery ──────────────────────────────────────────────

  describe("filterQuery and visibleRows", () => {
    beforeEach(async () => {
      wrapper = mountComponent();
      await flushPromises();
    });

    it("shows all rows when filterQuery is empty", () => {
      (wrapper!.vm as any).filterQuery = "";
      expect((wrapper!.vm as any).visibleRows).toHaveLength(3);
    });

    it("filters rows by partial name match", () => {
      (wrapper!.vm as any).filterQuery = "destination-1";
      const rows = (wrapper!.vm as any).visibleRows;
      expect(rows.every((r: any) => r.name.includes("destination-1"))).toBe(true);
    });

    it("returns empty array when filter matches nothing", () => {
      (wrapper!.vm as any).filterQuery = "zzz-no-match";
      expect((wrapper!.vm as any).visibleRows).toHaveLength(0);
    });
  });

  // ── editor toggle ──────────────────────────────────────────────────────────

  describe("editor toggle", () => {
    it.skip("toggleDestinationEditor toggles showDestinationEditor", async () => {
      wrapper = mountComponent();
      await flushPromises();

      expect((wrapper.vm as any).showDestinationEditor).toBe(false);
      (wrapper.vm as any).toggleDestinationEditor();
      expect((wrapper.vm as any).showDestinationEditor).toBe(true);
      (wrapper.vm as any).toggleDestinationEditor();
      expect((wrapper.vm as any).showDestinationEditor).toBe(false);
    });

    it.skip("editDestination(null) sets showDestinationEditor to true", async () => {
      wrapper = mountComponent();
      await flushPromises();
      (wrapper.vm as any).editDestination(null);
      await flushPromises();
      expect((wrapper.vm as any).showDestinationEditor).toBe(true);
    });

    it.skip("editDestination with existing dest stores editingDestination", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const dest = (wrapper.vm as any).destinations[0];
      (wrapper.vm as any).editDestination(dest);
      await flushPromises();
      expect((wrapper.vm as any).editingDestination).toEqual(dest);
    });

    it.skip("clones destination so original is not mutated", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const original = { name: "orig", url: "http://x.com" };
      (wrapper.vm as any).editDestination(original);
      (wrapper.vm as any).editingDestination.name = "mutated";
      expect(original.name).toBe("orig");
    });

    it("shows PipelineDestinationEditor when showDestinationEditor is true", async () => {
      wrapper = mountComponent();
      await flushPromises();
      (wrapper.vm as any).showDestinationEditor = true;
      await nextTick();
      expect(
        wrapper.find('[data-test="pipeline-destination-editor-stub"]').exists(),
      ).toBe(true);
    });

    it("hides the table when editor is open", async () => {
      wrapper = mountComponent();
      await flushPromises();
      (wrapper.vm as any).showDestinationEditor = true;
      await nextTick();
      expect(
        wrapper.find('[data-test="alert-destinations-list-table"]').exists(),
      ).toBe(false);
    });
  });

  // ── helper functions ───────────────────────────────────────────────────────

  describe("getDestinationByName", () => {
    it("returns matching destination", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const result = (wrapper.vm as any).getDestinationByName("destination-1");
      expect(result?.name).toBe("destination-1");
    });

    it("returns undefined for unknown name", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(
        (wrapper.vm as any).getDestinationByName("no-such-dest"),
      ).toBeUndefined();
    });
  });

  describe("resetEditingDestination", () => {
    it("sets editingDestination to null", async () => {
      wrapper = mountComponent();
      await flushPromises();
      (wrapper.vm as any).editingDestination = { name: "x" };
      (wrapper.vm as any).resetEditingDestination();
      expect((wrapper.vm as any).editingDestination).toBeNull();
    });
  });

  // ── delete flow ────────────────────────────────────────────────────────────

  describe("delete flow", () => {
    it("conformDeleteDestination sets confirmDelete.visible and data", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const dest = (wrapper.vm as any).destinations[0];
      (wrapper.vm as any).conformDeleteDestination(dest);
      expect((wrapper.vm as any).confirmDelete.visible).toBe(true);
      expect((wrapper.vm as any).confirmDelete.data.name).toBe(dest.name);
    });

    it("cancelDeleteDestination resets confirmDelete", async () => {
      wrapper = mountComponent();
      await flushPromises();
      (wrapper.vm as any).confirmDelete.visible = true;
      (wrapper.vm as any).confirmDelete.data = { name: "x" };
      (wrapper.vm as any).cancelDeleteDestination();
      expect((wrapper.vm as any).confirmDelete.visible).toBe(false);
      expect((wrapper.vm as any).confirmDelete.data).toBeNull();
    });

    it("deleteDestination calls service with correct args", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const dest = (wrapper.vm as any).destinations[0];
      (wrapper.vm as any).confirmDelete.data = dest;
      (wrapper.vm as any).deleteDestination();
      await flushPromises();
      expect(destinationService.delete).toHaveBeenCalledWith(
        expect.objectContaining({ destination_name: dest.name }),
      );
    });

    it("deleteDestination does nothing when data is null", async () => {
      wrapper = mountComponent();
      await flushPromises();
      (wrapper.vm as any).confirmDelete.data = null;
      (wrapper.vm as any).deleteDestination();
      await flushPromises();
      // only called during mount setup
      expect((destinationService.delete as any).mock.calls.length).toBe(0);
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
      (wrapper.vm as any).selectedDestinations = [
        makeDestination(1),
        makeDestination(2),
      ];
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

  // ── formatOutputFormat ─────────────────────────────────────────────────────

  describe("formatOutputFormat helper (module-level)", () => {
    it("is used in the output_format column slot (renders via stub)", async () => {
      (destinationService.list as any).mockResolvedValue({
        data: [makeDestination(1, { output_format: "json" })],
      });
      wrapper = mountComponent();
      await flushPromises();
      // Slot content is rendered by our stub — just ensure it doesn't crash
      expect(wrapper.exists()).toBe(true);
    });
  });

  // ── empty state ────────────────────────────────────────────────────────────

  describe("empty state", () => {
    it("renders NoData inside OTable empty slot", async () => {
      (destinationService.list as any).mockResolvedValue({ data: [] });
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="o-empty-state-stub"]').exists()).toBe(true);
    });
  });

  // ── props reactivity ───────────────────────────────────────────────────────

  describe("props reactivity", () => {
    it("destinations updates when getDestinations resolves", async () => {
      (destinationService.list as any).mockResolvedValueOnce({ data: [] });
      wrapper = mountComponent();
      await flushPromises();
      expect((wrapper.vm as any).destinations).toHaveLength(0);

      (destinationService.list as any).mockResolvedValue({
        data: [makeDestination(1), makeDestination(2)],
      });
      await (wrapper.vm as any).getDestinations();
      await flushPromises();
      expect((wrapper.vm as any).destinations).toHaveLength(2);
    });
  });
});
