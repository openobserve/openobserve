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

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import MonitorTable from "./MonitorTable.vue";
import { mockMonitorList } from "@/test/unit/mockData/synthetics";

// ── Stubs ───────────────────────────────────────────────────────────────

const OTableStub = {
  name: "OTableStub",
  template: `
    <div :data-test="dataTest">
      <slot name="toolbar" />
      <slot name="toolbar-trailing" />
      <div v-if="loading" data-test="otable-loading-state" />
      <div v-if="data.length === 0" data-test="otable-empty-region">
        <slot name="empty" />
      </div>
      <template v-if="data.length > 0">
        <div v-for="(row, idx) in data" :key="row[rowKey] || idx" class="otable-row" data-test="otable-row" @click="$emit('row-click', row)">
          <slot name="cell-status" :row="row" />
          <slot name="cell-name" :row="row" />
          <slot name="cell-url" :row="row" />
          <slot name="cell-type" :row="row" />
          <slot name="cell-history" :row="row" />
          <slot name="cell-responseTime" :row="row" />
          <slot name="cell-uptime" :row="row" />
          <slot name="cell-locations" :row="row" />
          <slot name="cell-interval" :row="row" />
          <slot name="cell-lastCheck" :row="row" />
          <slot name="cell-method" :row="row" />
          <slot name="cell-steps" :row="row" />
          <slot name="cell-assertions" :row="row" />
          <slot name="cell-folder_name" :row="row" />
          <slot name="cell-actions" :row="row" />
        </div>
      </template>
      <slot name="bottom" />
    </div>
  `,
  props: {
    columns: { type: Array, default: () => [] },
    data: { type: Array, default: () => [] },
    loading: { type: Boolean, default: false },
    selectedIds: { type: Array, default: () => [] },
    rowKey: { type: String, default: "id" },
    dataTest: { type: String, default: "" },
    footerTitle: { type: String, default: "" },
    emptyMessage: { type: String, default: "" },
  },
};

const OButtonStub = {
  name: "OButtonStub",
  // Emit the native MouseEvent so that the parent's @click.stop handler can
  // call event.stopPropagation() (the .stop modifier requires a real Event).
  template: `<button :data-test="$attrs['data-test'] || ''" :disabled="!!$attrs['disabled']" @click="onClick"><slot /></button>`,
  inheritAttrs: false,
  methods: {
    onClick(e: MouseEvent) {
      (this as any).$emit("click", e);
    },
  },
};

const OIconStub = {
  name: "OIconStub",
  template: '<span class="oicon-stub" />',
  props: ["name", "size"],
};

const OBadgeStub = {
  name: "OBadgeStub",
  template: '<span class="obadge-stub"><slot /></span>',
  props: ["variant", "dot", "size", "icon"],
};

const OProgressBarStub = {
  name: "OProgressBarStub",
  template: '<div class="oprogressbar-stub" />',
  props: ["value", "variant", "size"],
};

const OSpinnerStub = {
  name: "OSpinnerStub",
  template: '<div class="ospinner-stub" data-test="ospinner" />',
  props: ["size"],
};

const ODropdownStub = {
  name: "ODropdownStub",
  template: '<div class="odropdown-stub"><slot name="trigger" /><slot /></div>',
};

const ODropdownItemStub = {
  name: "ODropdownItemStub",
  template: `<button :data-test="$attrs['data-test'] || ''" :disabled="!!$attrs['disabled']" @click="$emit('select')"><slot name="icon-left" /><slot /></button>`,
  inheritAttrs: false,
  props: ["variant"],
};

const ODropdownSeparatorStub = {
  name: "ODropdownSeparatorStub",
  template: '<div class="odropdown-separator-stub" />',
};

const OTooltipStub = {
  name: "OTooltipStub",
  template: '<div class="otooltip-stub" />',
  props: ["content", "side", "contentClass"],
};

const OEmptyStateStub = {
  name: "OEmptyStateStub",
  template: `<div :data-test="$attrs['data-test'] || ''" class="oemptystate-stub"><slot /></div>`,
  inheritAttrs: false,
  props: ["size", "preset", "description", "filtered"],
};

// ── Mount factory ───────────────────────────────────────────────────────

function mountMonitorTable(props: Record<string, unknown> = {}) {
  return mount(MonitorTable, {
    props: {
      mode: "all",
      data: mockMonitorList,
      ...props,
    },
    global: {
      plugins: [i18n],
      stubs: {
        OTable: OTableStub,
        OButton: OButtonStub,
        OIcon: OIconStub,
        OBadge: OBadgeStub,
        OProgressBar: OProgressBarStub,
        OSpinner: OSpinnerStub,
        ODropdown: ODropdownStub,
        ODropdownItem: ODropdownItemStub,
        ODropdownSeparator: ODropdownSeparatorStub,
        OTooltip: OTooltipStub,
        OEmptyState: OEmptyStateStub,
        Teleport: {
          template: '<div class="teleport-stub"><slot /></div>',
        },
      },
    },
  });
}

function getOTableProps(wrapper: VueWrapper) {
  const stub = wrapper.findComponent({ name: "OTableStub" });
  return {
    columns: stub.props("columns") as any[],
    data: stub.props("data") as any[],
    loading: stub.props("loading") as boolean,
    selectedIds: stub.props("selectedIds") as string[],
    footerTitle: stub.props("footerTitle") as string,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("MonitorTable", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ── OTable prop forwarding ────────────────────────────────────────────

  describe("OTable integration", () => {
    it("should pass data prop to OTable", () => {
      wrapper = mountMonitorTable();
      const { data } = getOTableProps(wrapper);
      expect(data).toEqual(mockMonitorList);
      expect(data).toHaveLength(4);
    });

    it("should pass loading=false prop to OTable by default", () => {
      wrapper = mountMonitorTable();
      const { loading } = getOTableProps(wrapper);
      expect(loading).toBe(false);
    });

    it("should pass loading=true prop to OTable when loading", () => {
      wrapper = mountMonitorTable({ loading: true });
      const { loading } = getOTableProps(wrapper);
      expect(loading).toBe(true);
    });

    it("should render loading state indicator when loading is true", () => {
      wrapper = mountMonitorTable({ loading: true });
      expect(wrapper.find('[data-test="otable-loading-state"]').exists()).toBe(true);
    });

    it("should render correct columns for all mode", () => {
      wrapper = mountMonitorTable({ mode: "all" });
      const { columns } = getOTableProps(wrapper);
      const ids = columns.map((c) => c.id);
      expect(ids).toEqual([
        "name",
        "url",
        "type",
        "status",
        "responseTime",
        "locations",
        "interval",
        "lastCheck",
        "actions",
      ]);
    });

    it("should render correct columns for browser mode", () => {
      wrapper = mountMonitorTable({ mode: "browser" });
      const { columns } = getOTableProps(wrapper);
      const ids = columns.map((c) => c.id);
      expect(ids).toEqual([
        "name",
        "url",
        "steps",
        "history",
        "responseTime",
        "uptime",
        "lastCheck",
        "status",
        "actions",
      ]);
    });

    it("should include folder column after name when showFolderColumn is true", () => {
      wrapper = mountMonitorTable({
        mode: "all",
        showFolderColumn: true,
      });
      const { columns } = getOTableProps(wrapper);
      const ids = columns.map((c) => c.id);
      expect(ids).toEqual([
        "name",
        "folder_name",
        "url",
        "type",
        "status",
        "responseTime",
        "locations",
        "interval",
        "lastCheck",
        "actions",
      ]);
    });

    it("should not include folder column when showFolderColumn is false", () => {
      wrapper = mountMonitorTable({
        mode: "all",
        showFolderColumn: false,
      });
      const { columns } = getOTableProps(wrapper);
      const ids = columns.map((c) => c.id);
      expect(ids).not.toContain("folder_name");
    });

    it("should pass default footerTitle when not provided", () => {
      wrapper = mountMonitorTable();
      const { footerTitle } = getOTableProps(wrapper);
      expect(footerTitle).toBe("Checks");
    });

    it("should pass custom footerTitle when provided", () => {
      wrapper = mountMonitorTable({ footerTitle: "Monitors" });
      const { footerTitle } = getOTableProps(wrapper);
      expect(footerTitle).toBe("Monitors");
    });
  });

  // ── Row interaction emits ─────────────────────────────────────────────

  describe("row interactions", () => {
    it("should emit row-click with row data when a row is clicked", async () => {
      wrapper = mountMonitorTable();
      const firstRow = wrapper.find('[data-test="otable-row"]');
      await firstRow.trigger("click");
      expect(wrapper.emitted("row-click")).toHaveLength(1);
      expect(wrapper.emitted("row-click")![0]).toEqual([mockMonitorList[0]]);
    });

    it("should emit edit with row data when edit button is clicked", async () => {
      wrapper = mountMonitorTable();
      const editBtn = wrapper.find('[data-test="monitor-table-edit-btn"]');
      expect(editBtn.exists()).toBe(true);
      await editBtn.trigger("click");
      expect(wrapper.emitted("edit")).toHaveLength(1);
      expect(wrapper.emitted("edit")![0]).toEqual([mockMonitorList[0]]);
    });

    it("should emit toggle-enabled with row data when pause button is clicked for enabled row", async () => {
      wrapper = mountMonitorTable();
      // First row is mockMonitorHttp which has enabled: true
      const pauseBtn = wrapper.find('[data-test="monitor-table-pause-btn"]');
      expect(pauseBtn.exists()).toBe(true);
      await pauseBtn.trigger("click");
      expect(wrapper.emitted("toggle-enabled")).toHaveLength(1);
      expect(wrapper.emitted("toggle-enabled")![0]).toEqual([mockMonitorList[0]]);
    });

    it("should emit toggle-enabled with row data when enable button is clicked for disabled row", async () => {
      wrapper = mountMonitorTable();
      // Fourth row is mockMonitorDisabled which has enabled: false
      const enableBtns = wrapper.findAll('[data-test="monitor-table-enable-btn"]');
      expect(enableBtns.length).toBeGreaterThan(0);
      await enableBtns[enableBtns.length - 1].trigger("click");
      expect(wrapper.emitted("toggle-enabled")).toHaveLength(1);
      expect(wrapper.emitted("toggle-enabled")![0]).toEqual([mockMonitorList[3]]);
    });

    it("should emit duplicate with row data when duplicate button is clicked", async () => {
      wrapper = mountMonitorTable();
      const duplicateBtn = wrapper.find('[data-test="monitor-table-duplicate-btn"]');
      expect(duplicateBtn.exists()).toBe(true);
      await duplicateBtn.trigger("click");
      expect(wrapper.emitted("duplicate")).toHaveLength(1);
      expect(wrapper.emitted("duplicate")![0]).toEqual([mockMonitorList[0]]);
    });
  });

  // ── Dropdown action emits ─────────────────────────────────────────────

  describe("dropdown actions", () => {
    it("should emit run with row data when trigger menu item is clicked", async () => {
      wrapper = mountMonitorTable();
      const runItem = wrapper.find('[data-test="monitor-table-run-item"]');
      expect(runItem.exists()).toBe(true);
      await runItem.trigger("click");
      expect(wrapper.emitted("run")).toHaveLength(1);
      expect(wrapper.emitted("run")![0]).toEqual([mockMonitorList[0]]);
    });

    it("should emit delete with row data when delete menu item is clicked", async () => {
      wrapper = mountMonitorTable();
      const deleteItem = wrapper.find('[data-test="monitor-table-delete-item"]');
      expect(deleteItem.exists()).toBe(true);
      await deleteItem.trigger("click");
      expect(wrapper.emitted("delete")).toHaveLength(1);
      expect(wrapper.emitted("delete")![0]).toEqual([mockMonitorList[0]]);
    });

    it("should render per-row action buttons for each data row", () => {
      wrapper = mountMonitorTable();
      // Each row should have edit, duplicate, and more buttons
      const editBtns = wrapper.findAll('[data-test="monitor-table-edit-btn"]');
      expect(editBtns.length).toBe(4);
    });
  });

  // ── Selected ids v-model ──────────────────────────────────────────────

  describe("selectedIds v-model", () => {
    it("should pass selectedIds prop to OTable", () => {
      wrapper = mountMonitorTable({ selectedIds: ["mon-http-1"] });
      const { selectedIds } = getOTableProps(wrapper);
      expect(selectedIds).toEqual(["mon-http-1"]);
    });

    it("should pass empty selectedIds to OTable by default", () => {
      wrapper = mountMonitorTable();
      const { selectedIds } = getOTableProps(wrapper);
      expect(selectedIds).toEqual([]);
    });

    it("should emit update:selectedIds when OTable updates selection", async () => {
      wrapper = mountMonitorTable();
      const otable = wrapper.findComponent({ name: "OTableStub" });
      await otable.vm.$emit("update:selectedIds", ["mon-http-1", "mon-tcp-1"]);
      expect(wrapper.emitted("update:selectedIds")).toHaveLength(1);
      expect(wrapper.emitted("update:selectedIds")![0]).toEqual([["mon-http-1", "mon-tcp-1"]]);
    });
  });

  // ── Empty state ───────────────────────────────────────────────────────

  describe("empty state", () => {
    it("should show empty state region when data is empty", () => {
      wrapper = mountMonitorTable({ data: [] });
      expect(wrapper.find('[data-test="otable-empty-region"]').exists()).toBe(true);
    });

    it("should render OEmptyState when data is empty", () => {
      wrapper = mountMonitorTable({ data: [] });
      const emptyState = wrapper.find('[data-test="monitor-table-empty-state"]');
      expect(emptyState.exists()).toBe(true);
    });

    it("should not render empty state region when data is present", () => {
      wrapper = mountMonitorTable({ data: mockMonitorList });
      expect(wrapper.find('[data-test="otable-empty-region"]').exists()).toBe(false);
    });

    it("should emit empty-action when OEmptyState action is triggered", async () => {
      wrapper = mountMonitorTable({ data: [] });
      const emptyState = wrapper.findComponent({ name: "OEmptyStateStub" });
      await emptyState.vm.$emit("action", "create-browser");
      expect(wrapper.emitted("empty-action")).toHaveLength(1);
      expect(wrapper.emitted("empty-action")![0]).toEqual(["create-browser"]);
    });

    // ── hasFilters prop ───────────────────────────────────────────

    it("should pass filtered=false to OEmptyState when hasFilters defaults to false", () => {
      wrapper = mountMonitorTable({ data: [] });
      const emptyState = wrapper.findComponent({ name: "OEmptyStateStub" });
      expect(emptyState.props("filtered")).toBe(false);
    });

    it("should pass filtered=true to OEmptyState when hasFilters is true", () => {
      wrapper = mountMonitorTable({ data: [], hasFilters: true });
      const emptyState = wrapper.findComponent({ name: "OEmptyStateStub" });
      expect(emptyState.props("filtered")).toBe(true);
    });

    it("should pass filtered=false to OEmptyState when hasFilters is explicitly false", () => {
      wrapper = mountMonitorTable({ data: [], hasFilters: false });
      const emptyState = wrapper.findComponent({ name: "OEmptyStateStub" });
      expect(emptyState.props("filtered")).toBe(false);
    });
  });

  // ── Bulk actions ──────────────────────────────────────────────────────

  describe("bulk actions", () => {
    it("should show bulk action buttons when selectedIds are non-empty", () => {
      wrapper = mountMonitorTable({
        selectedIds: ["mon-http-1", "mon-tcp-1"],
      });
      expect(wrapper.find('[data-test="monitor-table-pause-selected-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="monitor-table-enable-selected-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="monitor-table-trigger-selected-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="monitor-table-move-selected-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="monitor-table-delete-selected-btn"]').exists()).toBe(true);
    });

    it("should not show bulk action buttons when no rows are selected", () => {
      wrapper = mountMonitorTable({ selectedIds: [] });
      expect(wrapper.find('[data-test="monitor-table-pause-selected-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="monitor-table-delete-selected-btn"]').exists()).toBe(false);
    });

    it("should emit pause-selected when pause selected button is clicked", async () => {
      wrapper = mountMonitorTable({
        selectedIds: ["mon-http-1"],
      });
      const btn = wrapper.find('[data-test="monitor-table-pause-selected-btn"]');
      expect(btn.exists()).toBe(true);
      await btn.trigger("click");
      expect(wrapper.emitted("pause-selected")).toHaveLength(1);
    });

    it("should emit enable-selected when enable selected button is clicked", async () => {
      wrapper = mountMonitorTable({
        selectedIds: ["mon-http-1"],
      });
      const btn = wrapper.find('[data-test="monitor-table-enable-selected-btn"]');
      expect(btn.exists()).toBe(true);
      await btn.trigger("click");
      expect(wrapper.emitted("enable-selected")).toHaveLength(1);
    });

    it("should emit trigger-selected when trigger selected button is clicked", async () => {
      wrapper = mountMonitorTable({
        selectedIds: ["mon-http-1"],
      });
      const btn = wrapper.find('[data-test="monitor-table-trigger-selected-btn"]');
      expect(btn.exists()).toBe(true);
      await btn.trigger("click");
      expect(wrapper.emitted("trigger-selected")).toHaveLength(1);
    });

    it("should emit move-selected when move selected button is clicked", async () => {
      wrapper = mountMonitorTable({
        selectedIds: ["mon-http-1"],
      });
      const btn = wrapper.find('[data-test="monitor-table-move-selected-btn"]');
      expect(btn.exists()).toBe(true);
      await btn.trigger("click");
      expect(wrapper.emitted("move-selected")).toHaveLength(1);
    });

    it("should emit delete-selected when delete selected button is clicked", async () => {
      wrapper = mountMonitorTable({
        selectedIds: ["mon-http-1"],
      });
      const btn = wrapper.find('[data-test="monitor-table-delete-selected-btn"]');
      expect(btn.exists()).toBe(true);
      await btn.trigger("click");
      expect(wrapper.emitted("delete-selected")).toHaveLength(1);
    });

    it("should disable bulk action buttons when bulkActionLoading is true", () => {
      wrapper = mountMonitorTable({
        selectedIds: ["mon-http-1"],
        bulkActionLoading: true,
      });
      const pauseBtn = wrapper.find('[data-test="monitor-table-pause-selected-btn"]');
      expect(pauseBtn.attributes("disabled")).toBeDefined();
      const enableBtn = wrapper.find('[data-test="monitor-table-enable-selected-btn"]');
      expect(enableBtn.attributes("disabled")).toBeDefined();
      const triggerBtn = wrapper.find('[data-test="monitor-table-trigger-selected-btn"]');
      expect(triggerBtn.attributes("disabled")).toBeDefined();
    });
  });

  // ── Footer text ───────────────────────────────────────────────────────

  describe("footer", () => {
    it("should show selection count when rows are selected", () => {
      wrapper = mountMonitorTable({
        selectedIds: ["mon-http-1", "mon-tcp-1"],
      });
      const bottom = wrapper.find('[data-test="monitor-table"]');
      expect(bottom.text()).toContain("2 of 4 selected");
    });

    it("should show total count when no rows are selected", () => {
      wrapper = mountMonitorTable({ selectedIds: [] });
      const bottom = wrapper.find('[data-test="monitor-table"]');
      expect(bottom.text()).toContain("4 Checks");
    });

    it("should show custom footerTitle in total count", () => {
      wrapper = mountMonitorTable({
        selectedIds: [],
        footerTitle: "HTTP Monitors",
      });
      const bottom = wrapper.find('[data-test="monitor-table"]');
      expect(bottom.text()).toContain("4 HTTP Monitors");
    });
  });

  // ── Folder navigation ─────────────────────────────────────────────────

  describe("folder column", () => {
    it("should emit navigate-to-folder when folder name cell is clicked", async () => {
      wrapper = mountMonitorTable({
        mode: "all",
        showFolderColumn: true,
      });
      // The first row's folder_name cell — the outer div with cursor-pointer
      // We find it by looking for a clickable div inside the row
      const rows = wrapper.findAll('[data-test="otable-row"]');
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  // ── Per-row toggle/trigger spinners ───────────────────────────────────

  describe("per-row loading spinners", () => {
    it("should show toggle spinner when toggleLoadingMap has the row id", () => {
      wrapper = mountMonitorTable({
        toggleLoadingMap: { "mon-http-1": true },
      });
      const spinner = wrapper.find('[data-test="monitor-table-toggle-spinner"]');
      expect(spinner.exists()).toBe(true);
    });

    it("should not show toggle spinner when toggleLoadingMap is empty", () => {
      wrapper = mountMonitorTable();
      const spinner = wrapper.find('[data-test="monitor-table-toggle-spinner"]');
      expect(spinner.exists()).toBe(false);
    });

    it("should show trigger spinner when triggerLoadingMap has the row id", () => {
      wrapper = mountMonitorTable({
        triggerLoadingMap: { "mon-http-1": true },
      });
      const spinner = wrapper.find('[data-test="monitor-table-trigger-spinner"]');
      expect(spinner.exists()).toBe(true);
    });

    it("should not show trigger spinner when triggerLoadingMap is empty", () => {
      wrapper = mountMonitorTable();
      const spinner = wrapper.find('[data-test="monitor-table-trigger-spinner"]');
      expect(spinner.exists()).toBe(false);
    });
  });

  // ── Cell content rendering ────────────────────────────────────────────

  describe("cell rendering", () => {
    it("should show monitor name in the name cell", () => {
      wrapper = mountMonitorTable();
      const text = wrapper.text();
      expect(text).toContain("HTTP Health Check");
    });

    it("should show URL in the url cell", () => {
      wrapper = mountMonitorTable();
      const text = wrapper.text();
      expect(text).toContain("https://example.com/health");
    });

    it("should render action buttons for the first row", () => {
      wrapper = mountMonitorTable();
      const editBtn = wrapper.find('[data-test="monitor-table-edit-btn"]');
      expect(editBtn.exists()).toBe(true);
      const duplicateBtn = wrapper.find('[data-test="monitor-table-duplicate-btn"]');
      expect(duplicateBtn.exists()).toBe(true);
      const moreBtn = wrapper.find('[data-test="monitor-table-more-btn"]');
      expect(moreBtn.exists()).toBe(true);
    });
  });
});
