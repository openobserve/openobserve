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
vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
  });
});

vi.mock("@/services/slack", () => ({ default: { listInstallations: vi.fn() } }));
vi.mock("@/services/oncall", () => ({
  default: {
    listTeams: vi.fn(() => Promise.resolve({ data: [{ id: "t1", name: "payments" }] })),
    getTeamChannel: vi.fn(() =>
      Promise.resolve({
        data: { team_id: "t1", destinations: ["oncall-room-slack"], source: "team" },
      }),
    ),
  },
}));

vi.mock("@/services/alert_templates", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(),
    },
  });
});

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
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
import { resetListViewState, useListViewState } from "@/composables/useListViewState";
import { mount, flushPromises } from "@vue/test-utils";
import AlertsDestinationList from "./AlertsDestinationList.vue";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import slack from "@/services/slack";
import { queryClient } from "@/composables/query/queryClient";
import { installationView } from "@/test/unit/helpers/slack";

// ── stubs ────────────────────────────────────────────────────────────────────

const cellValue = (columns: any[], id: string, row: any) => {
  const col = columns.find((c) => c.id === id);
  if (col?.accessorFn) return col.accessorFn(row);
  if (col?.accessorKey) return row[col.accessorKey];
  return "";
};

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
  methods: {
    urlOf(row: any) {
      return cellValue(this.columns, "url", row);
    },
    methodOf(row: any) {
      return cellValue(this.columns, "method", row);
    },
  },
  template: `
    <div data-test="o-table-stub">
      <slot name="toolbar" />
      <slot name="empty" />
      <slot name="actions" />
      <slot name="selection-actions" />
      <template v-for="row in data" :key="row.name">
        <div :data-test="'destination-url-' + row.name">
          <slot name="cell-url" :row="row">{{ urlOf(row) }}</slot>
        </div>
        <div :data-test="'destination-method-' + row.name">
          <slot name="cell-method" :row="row">{{ methodOf(row) }}</slot>
        </div>
        <slot name="cell-type" :row="row" />
        <slot name="cell-actions" :row="row" />
      </template>
    </div>
  `,
};

const ConfirmDialogStub = {
  name: "ConfirmDialog",
  props: ["modelValue", "title", "message", "messageKeypath", "messageName", "okVariant"],
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

// ── tests ─────────────────────────────────────────────────────────────────────

describe("AlertsDestinationList", () => {
  let wrapper: ReturnType<typeof mountComponent> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    resetListViewState();

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

    it("titles itself with the SECTION, so the peer tabs never move", async () => {
      // Identical on all four alerting pages — see TemplateList.spec.ts.
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find(".app-page-header h1").text()).toBe("Alerts");
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
      expect(wrapper.find('[data-test="alert-destination-list-add-alert-btn"]').exists()).toBe(
        true,
      );
    });
  });

  // ── data loading ───────────────────────────────────────────────────────────

  describe("data loading", () => {
    it("calls destinationService.list on mount", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(destinationService.list).toHaveBeenCalled();
    });

    it("asks for include_usage, so its own request shares the dependency graph's cache entry", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(destinationService.list).toHaveBeenCalledWith(
        expect.objectContaining({ include_usage: true }),
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
      await flushPromises();
      const dialog = wrapper
        .findAllComponents({ name: "ConfirmDialog" })
        .find(
          (c: any) => c.props("messageKeypath") === "alert_destinations.deleteDestinationMessage",
        );
      expect(dialog!.props("messageName")).toBe(dest.name);
      expect(dialog!.props("okVariant")).toBe("destructive");
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

    it("drops the deleted row in place, without refetching the list", async () => {
      wrapper = mountComponent();
      await flushPromises();

      const before = [...(wrapper.vm as any).destinations];
      const dest = before[0];
      (destinationService.list as any).mockClear();

      (wrapper.vm as any).confirmDelete.data = dest;
      (wrapper.vm as any).deleteDestination();
      await flushPromises();

      // A refetch would blank the table behind its spinner and a loading toast
      // for a row the server has already confirmed gone.
      expect(destinationService.list).not.toHaveBeenCalled();
      const after = (wrapper.vm as any).destinations;
      expect(after).toHaveLength(before.length - 1);
      expect(after.map((d: any) => d.name)).not.toContain(dest.name);
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
      const dialog = wrapper
        .findAllComponents({ name: "ConfirmDialog" })
        .find(
          (c: any) =>
            c.props("title") === i18n.global.t("alert_destinations.deleteDestinationsTitle"),
        );
      expect(dialog!.props("okVariant")).toBe("destructive");
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

  // Email destinations store recipients in emails[]; URL shows them and Method stays blank.
  describe("email destination URL and method cells", () => {
    const emailDest = makeDestination(4, {
      name: "email-ops",
      type: "email",
      url: "",
      method: "post",
      emails: ["alerts@example.com", "oncall@example.com"],
    });
    const lowerPutDest = makeDestination(5, { name: "lower-put", method: "put" });

    beforeEach(async () => {
      (destinationService.list as any).mockResolvedValue({
        data: [makeDestination(1), emailDest, lowerPutDest],
      });
      wrapper = mountComponent();
      await flushPromises();
    });

    it("renders email recipients in the URL cell instead of an empty URL", () => {
      const urlCell = wrapper!.find('[data-test="destination-url-email-ops"]');
      expect(urlCell.exists()).toBe(true);
      expect(urlCell.text()).toBe("alerts@example.com, oncall@example.com");
    });

    it("does not render a meaningless post method for email destinations", () => {
      const methodCell = wrapper!.find('[data-test="destination-method-email-ops"]');
      expect(methodCell.exists()).toBe(true);
      expect(methodCell.text().toLowerCase()).not.toBe("post");
      expect(methodCell.text().trim()).toBe("");
    });

    it("still renders URL and method for HTTP destinations", () => {
      expect(wrapper!.find('[data-test="destination-url-destination-1"]').text()).toBe(
        "https://example.com/hook-1",
      );
      expect(wrapper!.find('[data-test="destination-method-destination-1"]').text()).toBe("POST");
    });

    it("shows a lowercase stored method in uppercase", () => {
      expect(wrapper!.find('[data-test="destination-method-lower-put"]').text()).toBe("PUT");
    });

    it("labels the column URL / Recipients, not URL", () => {
      const table = wrapper!.findComponent({ name: "OTable" });
      const urlCol = table.props("columns").find((c: any) => c.id === "url");
      expect(urlCol?.header).toBe("URL / Recipients");
    });
  });

  // ── pagination restoration ──────────────────────────────────────────────────
  // OTable is stubbed in this harness (see OTableStub above), so the actual
  // TanStack pageIndex restoration (setTimeout(0) + OTable restorePage) cannot
  // be exercised end-to-end here. These tests cover what IS reachable: seeding
  // currentPage from the URL, and that navigating to/from the add/edit/import
  // views preserves the `page` query param instead of stripping it.

  describe("pagination restoration", () => {
    it("seeds currentPage from the URL's page query param", async () => {
      (router as any).currentRoute.value.query = { page: "3" };
      wrapper = mountComponent();
      await flushPromises();

      expect((wrapper.vm as any).currentPage).toBe(3);
    });

    it("defaults currentPage to 1 when no page query param is present", async () => {
      wrapper = mountComponent();
      await flushPromises();

      expect((wrapper.vm as any).currentPage).toBe(1);
    });

    it("onPageChange updates currentPage and replaces the URL, preserving other query params", async () => {
      (router as any).currentRoute.value.query = { org_identifier: "test-org" };
      wrapper = mountComponent();
      await flushPromises();
      const replaceSpy = vi.spyOn(router, "replace");

      (wrapper.vm as any).onPageChange(3);

      expect((wrapper.vm as any).currentPage).toBe(3);
      expect(replaceSpy).toHaveBeenCalledWith({
        query: { org_identifier: "test-org", page: "3" },
      });
    });

    it("onPageChange is a no-op on the URL when the page hasn't actually changed", async () => {
      (router as any).currentRoute.value.query = { page: "1" };
      wrapper = mountComponent();
      await flushPromises();
      const replaceSpy = vi.spyOn(router, "replace");

      (wrapper.vm as any).onPageChange(1);

      expect(replaceSpy).not.toHaveBeenCalled();
    });

    it("waits for the Review destination to load before opening its editor", async () => {
      queryClient.clear();
      let resolveList!: (value: { data: unknown[] }) => void;
      vi.mocked(destinationService.list).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveList = resolve;
          }),
      );
      const destination = makeDestination(1);
      router.currentRoute.value = {
        ...router.currentRoute.value,
        query: {
          action: "update",
          name: destination.name,
          slack_app_installation: "inst-test",
          slack_app_refusal: "shared_channel_unconfirmed",
        },
      };
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper!.vm.showDestinationEditor).toBe(false);
      resolveList({ data: [destination] });
      await flushPromises();
      expect(wrapper!.vm.showDestinationEditor).toBe(true);
      expect(wrapper!.vm.editingDestination.name).toBe(destination.name);
    });

    it("opens the destination editor when Review changes the current list route", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const name = wrapper!.vm.destinations[0].name;
      router.currentRoute.value = {
        ...router.currentRoute.value,
        query: {
          action: "update",
          name,
          slack_app_installation: "inst-test",
          slack_app_refusal: "shared_channel_unconfirmed",
        },
      };
      await flushPromises();
      expect(wrapper!.vm.showDestinationEditor).toBe(true);
      expect(wrapper!.vm.editingDestination.name).toBe(name);
      const nextName = wrapper!.vm.destinations[1].name;
      router.currentRoute.value = {
        ...router.currentRoute.value,
        query: {
          action: "update",
          name: nextName,
          slack_app_installation: "inst-test",
          slack_app_refusal: "oncall_room_unconfirmed",
        },
      };
      await flushPromises();
      expect(wrapper!.vm.showDestinationEditor).toBe(true);
      expect(wrapper!.vm.editingDestination.name).toBe(nextName);
    });

    it("editDestination(null) preserves the page query param when opening the add form", async () => {
      wrapper = mountComponent();
      await flushPromises();
      (router as any).currentRoute.value.query = { page: "3", org_identifier: "test-org" };
      const pushSpy = vi.spyOn(router, "push");

      (wrapper.vm as any).editDestination(null);

      const pushedQuery = pushSpy.mock.calls[0][0].query;
      expect(pushedQuery.page).toBe("3");
      expect(pushedQuery.action).toBe("add");
    });

    it("editDestination(row) preserves the page query param when opening the edit form", async () => {
      wrapper = mountComponent();
      await flushPromises();
      (router as any).currentRoute.value.query = { page: "3", org_identifier: "test-org" };
      const pushSpy = vi.spyOn(router, "push");
      const dest = (wrapper.vm as any).destinations[0];

      (wrapper.vm as any).editDestination(dest);

      const pushedQuery = pushSpy.mock.calls[0][0].query;
      expect(pushedQuery.page).toBe("3");
      expect(pushedQuery.action).toBe("update");
      expect(pushedQuery.name).toBe(dest.name);
    });

    it("toggleDestinationEditor drops action/name but keeps page when closing the editor", async () => {
      wrapper = mountComponent();
      await flushPromises();
      (wrapper.vm as any).showDestinationEditor = true;
      (router as any).currentRoute.value.query = {
        action: "update",
        name: "destination-1",
        page: "3",
        org_identifier: "test-org",
      };
      const pushSpy = vi.spyOn(router, "push");

      (wrapper.vm as any).toggleDestinationEditor();

      const pushedQuery = pushSpy.mock.calls[0][0].query;
      expect(pushedQuery.page).toBe("3");
      expect(pushedQuery.action).toBeUndefined();
      expect(pushedQuery.name).toBeUndefined();
    });

    it("drops every Review param on cancel, so a later Edit opens the normal form", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const dest = wrapper!.vm.destinations[0];
      const review = {
        action: "update",
        name: dest.name,
        page: "3",
        org_identifier: "test-org",
        slack_app_installation: "inst-test",
        slack_app_refusal: "oncall_room_unconfirmed",
        slack_app_team: "Test team",
        slack_app_room: "oncall-test",
      };
      const reviewKeys = (query: Record<string, unknown>) =>
        Object.keys(query).filter((key) => key.startsWith("slack_app_"));
      wrapper!.vm.showDestinationEditor = true;
      router.currentRoute.value = { ...router.currentRoute.value, query: { ...review } };
      const pushSpy = vi.spyOn(router, "push");

      wrapper!.vm.toggleDestinationEditor();
      const closed = pushSpy.mock.calls[0][0].query;
      expect(reviewKeys(closed)).toEqual([]);
      expect(closed.page).toBe("3");

      router.currentRoute.value = { ...router.currentRoute.value, query: { ...review } };
      wrapper!.vm.editDestination(dest);
      const edited = pushSpy.mock.calls[1][0].query;
      expect(edited.action).toBe("update");
      expect(edited.name).toBe(dest.name);
      expect(reviewKeys(edited)).toEqual([]);
    });

    it("drops the Review params once its save closes the editor, so a later Edit opens the normal form", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const [reviewed, other] = wrapper!.vm.destinations;
      router.currentRoute.value = {
        ...router.currentRoute.value,
        query: {
          action: "update",
          name: reviewed.name,
          slack_app_installation: "inst-test",
          slack_app_refusal: "shared_channel_unconfirmed",
        },
      };
      await flushPromises();
      expect(wrapper!.vm.showDestinationEditor).toBe(true);
      const pushSpy = vi.spyOn(router, "push");
      const editor = wrapper!.findComponent('[data-test="add-destination-stub"]');
      editor.vm.$emit("get:destinations");
      editor.vm.$emit("cancel:hideform");
      expect(wrapper!.vm.showDestinationEditor).toBe(false);
      const closed = pushSpy.mock.calls.at(-1)![0].query;
      expect(Object.keys(closed).filter((key) => key.startsWith("slack_app_"))).toEqual([]);
      router.currentRoute.value = { ...router.currentRoute.value, query: closed };
      await flushPromises();
      expect(wrapper!.vm.showDestinationEditor).toBe(false);

      wrapper!.vm.editDestination(other);
      await flushPromises();
      const edited = pushSpy.mock.calls.at(-1)![0].query;
      expect(edited).toMatchObject({ action: "update", name: other.name });
      expect(Object.keys(edited).filter((key) => key.startsWith("slack_app_"))).toEqual([]);
      expect(wrapper!.vm.editingDestination.name).toBe(other.name);
    });

    it("keeps the Review params while the route itself opens the switch form", async () => {
      queryClient.clear();
      let resolveList!: (value: { data: unknown[] }) => void;
      vi.mocked(destinationService.list).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveList = resolve;
          }),
      );
      const destination = makeDestination(1);
      router.currentRoute.value = {
        ...router.currentRoute.value,
        query: {
          action: "update",
          name: destination.name,
          slack_app_installation: "inst-test",
          slack_app_refusal: "shared_channel_unconfirmed",
        },
      };
      const pushSpy = vi.spyOn(router, "push");
      wrapper = mountComponent();
      await flushPromises();
      resolveList({ data: [destination] });
      await flushPromises();
      expect(wrapper!.vm.showDestinationEditor).toBe(true);
      const opened = pushSpy.mock.calls.at(-1)![0].query;
      expect(opened.slack_app_installation).toBe("inst-test");
      expect(opened.slack_app_refusal).toBe("shared_channel_unconfirmed");
    });

    it("importDestination preserves the page query param", async () => {
      wrapper = mountComponent();
      await flushPromises();
      (router as any).currentRoute.value.query = { page: "3", org_identifier: "test-org" };
      const pushSpy = vi.spyOn(router, "push");

      (wrapper.vm as any).importDestination();

      const pushedQuery = pushSpy.mock.calls[0][0].query;
      expect(pushedQuery.page).toBe("3");
      expect(pushedQuery.action).toBe("import");
    });
  });

  describe("view state restore", () => {
    it("restores search, tab, page size and sort", () => {
      useListViewState("alertDestinations", {
        filterQuery: "slack",
        tab: "custom",
        pageSize: 50,
        sortBy: "name",
        sortOrder: "desc",
      });
      wrapper = mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.filterQuery).toBe("slack");
      expect(vm.activeTab).toBe("custom");
      expect(vm.pageSize).toBe(50);
      expect(vm.sortBy).toBe("name");
      expect(vm.sortOrder).toBe("desc");
    });

    it("saves changes to the view state", async () => {
      wrapper = mountComponent();
      const vm = wrapper.vm as any;
      vm.filterQuery = "abc";
      vm.activeTab = "prebuilt";
      vm.pageSize = 100;
      await vm.$nextTick();
      const saved: any = useListViewState("alertDestinations", {});
      expect(saved.filterQuery).toBe("abc");
      expect(saved.tab).toBe("prebuilt");
      expect(saved.pageSize).toBe(100);
    });
  });
  describe("templates load denied", () => {
    it("falls back to no templates without an unhandled rejection on a 403", async () => {
      const { queryClient } = await import("@/composables/query/queryClient");
      queryClient.clear();
      (templateService.list as any).mockRejectedValue({ response: { status: 403 } });
      (destinationService.list as any).mockResolvedValue({ data: [] });
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);

      const w: any = mountComponent();
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 20));

      process.off("unhandledRejection", unhandled);
      expect(unhandled.mock.calls.map(([reason]) => reason)).not.toContainEqual({
        response: { status: 403 },
      });
      expect(w.vm.templates).toEqual([]);
      w.unmount();
    });
  });

  // ── Slack app rows (MK-6a, without Last send) ──────────────────────────────

  describe("Slack app and Slack webhook rows", () => {
    const HOOK = "https://hooks.slack.com/services/T0SAMPLE01/B000/xyz";
    const appRow = (over: any = {}) => ({
      name: "sre-prod-slack",
      type: "slack_app",
      template: "prebuilt_slack",
      installation_id: "inst-1",
      channel_id: "C9",
      channel_name: "sre-prod",
      buttons: true,
      mention: "default",
      refire_reuse_minutes: 30,
      auto_investigate: "off",
      shared_channel_confirmed: false,
      oncall_room_confirmed: false,
      ...over,
    });
    const hookRow = (name: string, team = "T0SAMPLE01") => ({
      name,
      type: "http",
      url: HOOK,
      method: "post",
      template: "prebuilt_slack",
      metadata: {
        prebuilt_type: "slack",
        slack_team_id: team,
        slack_channel_id: "C1",
        credential_channel: "#payments",
      },
    });
    const previous = { url: HOOK, method: "post", skip_tls_verify: false, metadata: {} };
    const zo = (store.state as any).zoConfig;
    let slackWas: unknown;

    beforeEach(async () => {
      queryClient.clear();
      slackWas = zo.slack_enabled;
      zo.slack_enabled = true;
      vi.mocked(slack.listInstallations).mockResolvedValue({
        data: { installations: [installationView()] },
      } as any);
      (destinationService.update as any).mockResolvedValue({});
      (destinationService.list as any).mockResolvedValue({
        data: [
          appRow(),
          appRow({ name: "switched-slack", previous_webhook: previous }),
          hookRow("payments-slack"),
          hookRow("other-team-slack", "T0OTHER"),
          hookRow("oncall-room-slack"),
        ],
      });
      wrapper = mountComponent();
      await flushPromises();
      await flushPromises();
    });

    afterEach(() => {
      zo.slack_enabled = slackWas;
    });

    const text = (test: string) => wrapper!.find(`[data-test="${test}"]`);

    it("lists Slack app rows, tagged Slack app and Two-way, with #channel · workspace", () => {
      expect((wrapper!.vm as any).visibleRows.map((r: any) => r.name)).toContain("sre-prod-slack");
      expect(text("destination-type-badge-slack-app-sre-prod-slack").text()).toContain("Slack app");
      expect(text("destination-type-two-way-sre-prod-slack").text()).toContain("Two-way");
      expect(text("destination-url-sre-prod-slack").text()).toBe("#sre-prod · Acme Corp");
      expect(text("destination-method-sre-prod-slack").text().trim()).toBe("");
    });

    it("has no Last send column", () => {
      const table = wrapper!.findComponent({ name: "OTable" });
      const ids = table.props("columns").map((c: any) => c.id);
      expect(ids).not.toContain("last_send");
      expect(wrapper!.text()).not.toContain("Last send");
      const urlCol = table.props("columns").find((c: any) => c.id === "url");
      expect(urlCol?.header).toBe("URL / recipients / channel");
    });

    it("labels webhook rows Slack webhook and offers the switch only for a connected team", () => {
      expect(text("destination-type-badge-slack-webhook-payments-slack").text()).toContain(
        "Slack webhook",
      );
      expect(text("destination-switch-to-app-payments-slack").exists()).toBe(true);
      expect(text("destination-switch-to-app-other-team-slack").exists()).toBe(false);
      expect(text("destination-switch-to-app-sre-prod-slack").exists()).toBe(false);
      expect(text("destination-switch-to-app-oncall-room-slack").exists()).toBe(false);
    });

    it("switches a webhook row in place, keeping its name and webhook", async () => {
      await text("destination-switch-to-app-payments-slack").trigger("click");
      await flushPromises();
      expect(destinationService.update).toHaveBeenCalledTimes(1);
      const call = (destinationService.update as any).mock.calls[0][0];
      expect(call).toMatchObject({
        org_identifier: "default",
        destination_name: "payments-slack",
        data: {
          name: "payments-slack",
          type: "slack_app",
          installation_id: "inst-1",
          channel_id: "C1",
          channel_name: "payments",
          previous_webhook: { url: HOOK },
        },
      });
    });

    it("switches back only a row that kept its webhook", async () => {
      expect(text("destination-switch-back-sre-prod-slack").exists()).toBe(false);
      await text("destination-switch-back-switched-slack").trigger("click");
      await flushPromises();
      const call = (destinationService.update as any).mock.calls[0][0];
      expect(call).toMatchObject({
        destination_name: "switched-slack",
        data: { name: "switched-slack", type: "http", url: HOOK },
      });
    });
  });
});
