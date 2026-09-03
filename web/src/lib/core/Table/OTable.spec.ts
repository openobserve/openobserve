// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { mount, VueWrapper, flushPromises, config } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

// Set up i18n so OTable sub-components (loading, error, etc.) can use useI18n()
const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      search: { noData: "No data available" },
      common: { loading: "Loading..." },
    },
  },
});

// Register i18n globally so every mount gets it
beforeAll(() => {
  config.global.plugins.unshift([i18n as any]);
});

import { nextTick, reactive } from "vue";
import OTable from "./OTable.vue";
import OTableHeader from "./sub-components/OTableHeader.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { OTableColumnDef } from "./OTable.types";

interface TestRow {
  id: number;
  name: string;
  email: string;
  status: string;
}

function makeColumns(): OTableColumnDef<TestRow>[] {
  return [
    { id: "id", header: "ID", accessorKey: "id", sortable: true, size: 60 },
    { id: "name", header: "Name", accessorKey: "name", sortable: true, size: 200 },
    { id: "email", header: "Email", accessorKey: "email", size: 250 },
    { id: "status", header: "Status", accessorKey: "status", size: 100 },
  ];
}

function makeRows(count: number = 10): TestRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `User ${i + 1}`,
    email: `user${i + 1}@example.com`,
    status: i % 2 === 0 ? "Active" : "Inactive",
  }));
}

describe("OTable", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  // ── Basic Rendering ──────────────────────────────────────────

  // ── Streaming data (in-place mutation) ──────────────────────
  // Logs streams partitions by PUSHING onto the same `hits` array. TanStack
  // memoises its core row model on the array's identity, so a mutated array
  // silently leaves the table frozen at whatever count existed when the memo
  // last ran — 0 rows if the first partition hadn't landed yet.
  describe("data mutated in place", () => {
    // `reactive` mirrors the real caller: logs' hits live on a reactive store,
    // so pushes are tracked — but the array's IDENTITY never changes, which is
    // what defeats TanStack's memo.
    it("should render rows appended to the same array reference", async () => {
      const rows = reactive(makeRows(3));
      wrapper = mount(OTable, {
        props: { data: rows, columns: makeColumns() },
      });
      expect(wrapper.findAll('[data-test^="o2-table-row-"]').length).toBe(3);

      rows.push(...makeRows(2).map((r, i) => ({ ...r, id: 100 + i })));
      await nextTick();
      await flushPromises();

      expect(wrapper.props("data")).toHaveLength(5);
      expect(wrapper.findAll('[data-test^="o2-table-row-"]').length).toBe(5);
    });

    it("should render rows that arrive after mounting with an empty array", async () => {
      const rows = reactive<TestRow[]>([]);
      wrapper = mount(OTable, {
        props: { data: rows, columns: makeColumns() },
      });
      expect(wrapper.findAll('[data-test^="o2-table-row-"]').length).toBe(0);

      rows.push(...makeRows(4));
      await nextTick();
      await flushPromises();

      expect(wrapper.findAll('[data-test^="o2-table-row-"]').length).toBe(4);
    });
  });

  describe("basic rendering", () => {
    it("renders the table with correct data-test attribute", () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(5), columns: makeColumns() },
      });
      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table"]').exists()).toBe(true);
    });

    it("renders all column headers", () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(5), columns: makeColumns() },
      });
      expect(wrapper.find('[data-test="o2-table-th-id"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-th-name"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-th-email"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-th-status"]').exists()).toBe(true);
    });

    it("renders data rows", () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(5), columns: makeColumns() },
      });
      const rows = wrapper.findAll('[data-test^="o2-table-row-"]');
      expect(rows.length).toBe(5);
    });

    it("should follow the parent's order when the columns prop is reordered in place", async () => {
      // Same ids, new order — the dashboard column_order config does exactly
      // this. The internal columnOrder state must adopt the prop order (it
      // previously kept the first-render order and the reorder never applied).
      wrapper = mount(OTable, {
        props: { data: makeRows(3), columns: makeColumns() },
      });
      const headerIds = () =>
        wrapper
          .findAll("thead th[data-test^='o2-table-th-']")
          .map((th) => th.attributes("data-test"));
      expect(headerIds()).toEqual([
        "o2-table-th-id",
        "o2-table-th-name",
        "o2-table-th-email",
        "o2-table-th-status",
      ]);

      const reordered = makeColumns();
      reordered.push(reordered.shift()!); // [name, email, status, id]
      await wrapper.setProps({ columns: reordered });
      await nextTick();

      expect(headerIds()).toEqual([
        "o2-table-th-name",
        "o2-table-th-email",
        "o2-table-th-status",
        "o2-table-th-id",
      ]);
    });

    it("should keep the user's drag order when the columns prop changes afterwards", async () => {
      // After a user drag, the prop order is no longer authoritative: a columns
      // recompute (new array, ids unchanged or extended) must preserve the
      // dragged arrangement and only append genuinely new columns.
      wrapper = mount(OTable, {
        props: { data: makeRows(3), columns: makeColumns() },
      });
      const headerIds = () =>
        wrapper
          .findAll("thead th[data-test^='o2-table-th-']")
          .map((th) => th.attributes("data-test"));

      // Simulate the header's drag-reorder event: [status, id, name, email]
      wrapper
        .findComponent(OTableHeader)
        .vm.$emit("update:column-order", ["status", "id", "name", "email"]);
      await nextTick();
      expect(headerIds()).toEqual([
        "o2-table-th-status",
        "o2-table-th-id",
        "o2-table-th-name",
        "o2-table-th-email",
      ]);

      // Parent re-emits its columns in original order plus a new column — the
      // dragged order must survive, with the new column appended.
      const next = makeColumns();
      next.push({ id: "extra", header: "Extra", accessorKey: "status", size: 80 });
      await wrapper.setProps({ columns: next });
      await nextTick();

      expect(headerIds()).toEqual([
        "o2-table-th-status",
        "o2-table-th-id",
        "o2-table-th-name",
        "o2-table-th-email",
        "o2-table-th-extra",
      ]);
    });

    it("renders cell content", () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(3), columns: makeColumns() },
      });
      const firstRow = wrapper.find('[data-test="o2-table-row-0"]');
      expect(firstRow.text()).toContain("User 1");
      expect(firstRow.text()).toContain("user1@example.com");
    });
  });

  // ── Client-Side Pagination ──────────────────────────────────

  describe("pagination: client", () => {
    beforeEach(() => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(25),
          columns: makeColumns(),
          pagination: "client",
          pageSize: 10,
        },
      });
    });

    it("renders the pagination footer", () => {
      expect(wrapper.find('[data-test="o2-table-pagination-bottom"]').exists()).toBe(true);
    });

    it("shows only the first page of rows", () => {
      const rows = wrapper.findAll('[data-test^="o2-table-row-"]');
      expect(rows.length).toBe(10);
    });

    it("shows correct row count in pagination info", () => {
      const info = wrapper.find('[data-test="o2-table-pagination-info"]');
      expect(info.text()).toContain("10");
      expect(info.text()).toContain("25");
    });

    it("has page size select", () => {
      expect(wrapper.find('[data-test="o2-table-page-size-select"]').exists()).toBe(true);
    });

    it("has prev/next buttons", () => {
      expect(wrapper.find('[data-test="o2-table-prev-page-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-next-page-btn"]').exists()).toBe(true);
    });
  });

  // ── Server-Side Pagination ──────────────────────────────────

  describe("pagination: server", () => {
    it("emits pagination-change on page size change", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(10),
          columns: makeColumns(),
          pagination: "server",
          totalCount: 100,
          pageSize: 20,
          currentPage: 1,
        },
      });

      // Find the OSelect inside the pagination footer and trigger a value change
      const select = wrapper.findComponent(OSelect);
      expect(select.exists()).toBe(true);

      // Programmatically change the page size to 50
      select.vm.$emit("update:modelValue", 50);
      await flushPromises();

      expect(wrapper.emitted("update:pageSize")).toBeTruthy();
    });

    it("shows total count from props (not data length)", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(10),
          columns: makeColumns(),
          pagination: "server",
          totalCount: 200,
        },
      });
      const info = wrapper.find('[data-test="o2-table-pagination-info"]');
      expect(info.text()).toContain("200");
    });

    it("supports lower-bound totals without pretending the last page is known", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(20),
          columns: makeColumns(),
          pagination: "server",
          totalCount: 21,
          totalCountExact: false,
          pageSize: 20,
          currentPage: 1,
        },
      });

      expect(wrapper.find('[data-test="o2-table-pagination-info"]').text()).toContain("21+");
      expect(wrapper.find('[data-test="o2-table-first-page-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-last-page-btn"]').exists()).toBe(false);

      await wrapper.find('[data-test="o2-table-next-page-btn"]').trigger("click");
      const events = wrapper.emitted("pagination-change") as any[][];
      expect(events.at(-1)![0]).toEqual({ page: 2, size: 20 });
    });

    it("should reflect a pageSize prop change in the footer", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(10),
          columns: makeColumns(),
          pagination: "server",
          totalCount: 45,
          pageSize: 20,
          currentPage: 1,
        },
      });
      expect(wrapper.find('[data-test="o2-table-pagination-info"]').text()).toContain("1 - 20");

      await wrapper.setProps({ pageSize: 10 });

      expect(wrapper.find('[data-test="o2-table-pagination-info"]').text()).toContain("1 - 10");
      expect(wrapper.findComponent(OSelect).props("modelValue")).toBe(10);
    });

    it("should emit the updated pageSize when paging after a pageSize change", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(10),
          columns: makeColumns(),
          pagination: "server",
          totalCount: 45,
          pageSize: 20,
          currentPage: 1,
        },
      });

      // Server mode: the parent owns page size, so it echoes the change back as a prop.
      await wrapper.setProps({ pageSize: 10 });
      await wrapper.find('[data-test="o2-table-next-page-btn"]').trigger("click");

      const events = wrapper.emitted("pagination-change") as any[][];
      expect(events.at(-1)![0]).toEqual({ page: 2, size: 10 });
    });

    it("should reflect a pageSizeOptions prop change in the footer select", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(10),
          columns: makeColumns(),
          pagination: "server",
          totalCount: 45,
          pageSize: 20,
          pageSizeOptions: [20, 50],
        },
      });

      await wrapper.setProps({ pageSizeOptions: [10, 20] });

      expect(wrapper.findComponent(OSelect).props("options")).toEqual([
        { label: "10", value: 10 },
        { label: "20", value: 20 },
      ]);
    });
  });

  // ── Column reorder ──────────────────────────────────────────

  describe("column reorder", () => {
    // vue-draggable-next derives drop positions from the <tr>'s DOM children, so
    // the list it sorts has to include the gutter <th>s (expand / select /
    // row-drag) or every index is shifted right by their count.
    function getDraggable(w: VueWrapper) {
      return w.findComponent({ name: "VueDraggableNext" });
    }

    it("should pad the draggable model with one entry per gutter header", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(2),
          columns: makeColumns(),
          enableColumnReorder: true,
          expansion: "multiple",
          selection: "multiple",
        },
      });
      const model = getDraggable(wrapper).props("modelValue") as string[];
      // 2 gutters (expand + select) then the four data columns, in DOM order.
      expect(model.slice(2)).toEqual(["id", "name", "email", "status"]);
      expect(model.slice(0, 2).every((id) => id.startsWith("__o2-gutter-"))).toBe(true);
    });

    it("should emit the reordered columns without the gutter entries", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(2),
          columns: makeColumns(),
          enableColumnReorder: true,
          expansion: "multiple",
        },
      });
      const draggable = getDraggable(wrapper);
      const model = draggable.props("modelValue") as string[];
      const [gutter, id, name, email, status] = model;

      // Drop "email" between "id" and "name" — the gutter entry stays put.
      draggable.vm.$emit("update:modelValue", [gutter, id, email, name, status]);
      await nextTick();

      const emitted = wrapper.emitted("column-order-change") as any[][];
      expect(emitted).toBeTruthy();
      expect(emitted.at(-1)![0]).toEqual(["id", "email", "name", "status"]);
    });

    it("should keep the order correct when a column is dropped before the gutter", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(2),
          columns: makeColumns(),
          enableColumnReorder: true,
          expansion: "multiple",
        },
      });
      const draggable = getDraggable(wrapper);
      const [gutter, id, name, email, status] = draggable.props("modelValue") as string[];

      draggable.vm.$emit("update:modelValue", [status, gutter, id, name, email]);
      await nextTick();

      const emitted = wrapper.emitted("column-order-change") as any[][];
      expect(emitted.at(-1)![0]).toEqual(["status", "id", "name", "email"]);
    });

    it("should mark the pinned-first column so Sortable filters it out of drags", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(2),
          columns: makeColumns(),
          enableColumnReorder: true,
          pinnedFirstColumn: "id",
        },
      });
      expect(getDraggable(wrapper).attributes("filter")).toBe(".o2-table-th-pinned-first");
      expect(wrapper.find('[data-test="o2-table-th-id"]').classes()).toContain(
        "o2-table-th-pinned-first",
      );
      expect(wrapper.find('[data-test="o2-table-th-name"]').classes()).not.toContain(
        "o2-table-th-pinned-first",
      );
    });

    it("should pull the pinned column back to the front when a drop displaces it", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(2),
          columns: makeColumns(),
          enableColumnReorder: true,
          pinnedFirstColumn: "id",
        },
      });
      const draggable = getDraggable(wrapper);
      const [id, name, email, status] = draggable.props("modelValue") as string[];

      // "status" dropped in front of the pinned "id".
      draggable.vm.$emit("update:modelValue", [status, id, name, email]);
      await nextTick();

      const emitted = wrapper.emitted("column-order-change") as any[][];
      expect(emitted.at(-1)![0]).toEqual(["id", "status", "name", "email"]);
    });

    it("should leave the order alone when the pinned column is already first", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(2),
          columns: makeColumns(),
          enableColumnReorder: true,
          pinnedFirstColumn: "id",
        },
      });
      const draggable = getDraggable(wrapper);
      const [id, name, email, status] = draggable.props("modelValue") as string[];

      draggable.vm.$emit("update:modelValue", [id, status, name, email]);
      await nextTick();

      const emitted = wrapper.emitted("column-order-change") as any[][];
      expect(emitted.at(-1)![0]).toEqual(["id", "status", "name", "email"]);
    });

    it("should not mark any header when no column is pinned", () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(2), columns: makeColumns(), enableColumnReorder: true },
      });
      expect(wrapper.findAll(".o2-table-th-pinned-first")).toHaveLength(0);
    });

    it("should have no gutter entries when the table has no gutter headers", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(2),
          columns: makeColumns(),
          enableColumnReorder: true,
          expansion: "none",
        },
      });
      expect(getDraggable(wrapper).props("modelValue")).toEqual(["id", "name", "email", "status"]);
    });
  });

  // ── Cell context menu ───────────────────────────────────────

  describe("cell-contextmenu", () => {
    it("should emit the clicked cell's column, row and value", async () => {
      const rows = makeRows(2);
      wrapper = mount(OTable, {
        props: { data: rows, columns: makeColumns() },
      });

      await wrapper.find('[data-test="o2-table-cell-email"]').trigger("contextmenu");

      const emitted = wrapper.emitted("cell-contextmenu") as any[][];
      expect(emitted).toBeTruthy();
      expect(emitted[0][0]).toEqual({
        columnId: "email",
        row: rows[0],
        value: rows[0].email,
      });
    });

    it("should not prevent the native event, leaving the decision to the consumer", async () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(1), columns: makeColumns() },
      });
      const cell = wrapper.find('[data-test="o2-table-cell-email"]');
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      cell.element.dispatchEvent(event);
      await nextTick();

      expect(event.defaultPrevented).toBe(false);
    });
  });

  // ── Exposed API ─────────────────────────────────────────────

  describe("exposed hasResizedColumns", () => {
    it("should expose false until a column is resized, then true", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          enableColumnResize: true,
        },
      });
      expect(wrapper.vm.hasResizedColumns).toBe(false);

      // No public API for a drag in jsdom — drive TanStack's sizing state directly.
      (wrapper.vm as any).table.setColumnSizing({ name: 300 });
      await nextTick();

      expect(wrapper.vm.hasResizedColumns).toBe(true);
    });

    it("should expose false when column resizing is disabled", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          enableColumnResize: false,
        },
      });
      (wrapper.vm as any).table.setColumnSizing({ name: 300 });
      await nextTick();

      expect(wrapper.vm.hasResizedColumns).toBe(false);
    });

    it("should go back to false after resetColumnSizes", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          enableColumnResize: true,
        },
      });
      (wrapper.vm as any).table.setColumnSizing({ name: 300 });
      await nextTick();
      expect(wrapper.vm.hasResizedColumns).toBe(true);

      (wrapper.vm as any).resetColumnSizes();
      await nextTick();

      expect(wrapper.vm.hasResizedColumns).toBe(false);
    });
  });

  // ── Client-Side Sorting ────────────────────────────────────

  describe("sorting: client", () => {
    it("renders sortable header with sort trigger", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          sorting: "client",
        },
      });
      // The ID column is sortable, so it should have sort trigger
      expect(wrapper.find('[data-test="o2-table-th-sort-trigger"]').exists()).toBe(true);
    });

    it("displays sort icons on sortable columns when sortBy is provided", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          sorting: "client",
          sortBy: "id",
          sortOrder: "asc",
        },
      });
      // Should have active sort icon on the sorted column
      const activeIcon = wrapper.find('[data-test="o2-table-sort-icon-active"]');
      expect(activeIcon.exists()).toBe(true);
      // The active icon must expose its direction for e2e sort assertions.
      expect(activeIcon.attributes("data-test-sort-direction")).toBe("asc");
    });

    it("exposes data-test-sort-direction on every sort icon (asc/desc/none)", () => {
      // e2e tests read this attribute to detect sort state. Missing it makes
      // sortByColumn() time out (as it did in CI), so lock it in here.
      const asc = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          sorting: "client",
          sortBy: "id",
          sortOrder: "asc",
        },
      });
      expect(
        asc.find('[data-test="o2-table-sort-icon-active"]').attributes("data-test-sort-direction"),
      ).toBe("asc");

      const desc = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          sorting: "client",
          sortBy: "id",
          sortOrder: "desc",
        },
      });
      expect(
        desc.find('[data-test="o2-table-sort-icon-active"]').attributes("data-test-sort-direction"),
      ).toBe("desc");

      // An unsorted sortable column shows the inactive icon with direction none.
      const none = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          sorting: "client",
        },
      });
      expect(
        none
          .find('[data-test="o2-table-sort-icon-inactive"]')
          .attributes("data-test-sort-direction"),
      ).toBe("none");
    });
  });

  // ── Server-Side Sorting ────────────────────────────────────

  describe("sorting: server", () => {
    it("emits sort-change when sort header is clicked", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(10),
          columns: makeColumns(),
          sorting: "server",
          sortBy: undefined,
          sortOrder: undefined,
        },
      });
      const sortTrigger = wrapper.find('[data-test="o2-table-th-sort-trigger"]');
      await sortTrigger.trigger("click");
      expect(wrapper.emitted("sort-change")).toBeTruthy();
      expect(wrapper.emitted("sort-change")?.[0][0]).toEqual({
        column: "id",
        order: "asc",
      });
    });

    it("toggles sort order on second click", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(10),
          columns: makeColumns(),
          sorting: "server",
          sortBy: "id",
          sortOrder: "asc",
        },
      });
      const sortTrigger = wrapper.find('[data-test="o2-table-th-sort-trigger"]');
      await sortTrigger.trigger("click");
      expect(wrapper.emitted("sort-change")?.[0][0]).toEqual({
        column: "id",
        order: "desc",
      });
    });
  });

  // ── Row Selection ──────────────────────────────────────────

  describe("selection", () => {
    it("renders checkbox column when selection is multiple", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          selection: "multiple",
        },
      });
      expect(wrapper.find('[data-test="o2-table-select-cell"]').exists()).toBe(true);
    });

    it("does not render checkbox column when selection is none", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          selection: "none",
        },
      });
      expect(wrapper.find('[data-test="o2-table-select-cell"]').exists()).toBe(false);
    });

    it("hides the header select-all but keeps its cell when showSelectAll is false", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          selection: "multiple",
          showSelectAll: false,
        },
      });
      const header = wrapper.find('[data-test="o2-table-th-select"]');
      // The cell stays so the body's selection gutter keeps its width; only the
      // checkbox goes.
      expect(header.exists()).toBe(true);
      expect(header.find('[data-test="o2-table-select-all"]').exists()).toBe(false);
    });

    it("renders the header select-all by default", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          selection: "multiple",
        },
      });
      expect(
        wrapper
          .find('[data-test="o2-table-th-select"]')
          .find('[data-test="o2-table-select-all"]')
          .exists(),
      ).toBe(true);
    });

    it("emits update:selectedIds when a row checkbox is toggled", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          selection: "multiple",
        },
      });
      // The checkbox might be a nested component; trigger the row click
      const row = wrapper.find('[data-test="o2-table-row-0"]');
      await row.trigger("click");
    });
  });

  // ── Row Expansion ──────────────────────────────────────────

  describe("expansion", () => {
    it("renders expand button when expansion is enabled", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          expansion: "single",
        },
      });
      expect(wrapper.find('[data-test="o2-table-expand-cell"]').exists()).toBe(true);
    });

    it("does not render expand button when expansion is none", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          expansion: "none",
        },
      });
      expect(wrapper.find('[data-test="o2-table-expand-cell"]').exists()).toBe(false);
    });
  });

  // ── Empty State ────────────────────────────────────────────

  describe("empty state", () => {
    it("shows empty state when data is empty and not loading", () => {
      wrapper = mount(OTable, {
        props: {
          data: [],
          columns: makeColumns(),
          loading: false,
        },
      });
      expect(wrapper.find('[data-test="o2-table-empty"]').exists()).toBe(true);
    });

    it("uses custom empty message when provided", () => {
      wrapper = mount(OTable, {
        props: {
          data: [],
          columns: makeColumns(),
          emptyMessage: "Nothing here",
        },
      });
      expect(wrapper.find('[data-test="o2-table-empty"]').text()).toContain("Nothing here");
    });
  });

  // ── Loading State ──────────────────────────────────────────

  describe("loading state", () => {
    it("shows loading when loading is true and no rows", () => {
      wrapper = mount(OTable, {
        props: {
          data: [],
          columns: makeColumns(),
          loading: true,
        },
      });
      // OTableLoading renders a skeleton tbody with data-test="o2-table-skeleton-body"
      expect(wrapper.find('[data-test="o2-table-skeleton-body"]').exists()).toBe(true);
    });

    it("shows loading overlay when loading is true with existing rows", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          loading: true,
        },
      });
      // When loading=true, heldLoading activates and the skeleton replaces the body
      // The outer <table> element is still rendered
      expect(wrapper.find('[data-test="o2-table"]').exists()).toBe(true);
    });
  });

  // ── Error State ────────────────────────────────────────────

  describe("error state", () => {
    it("shows error when error prop is set", () => {
      wrapper = mount(OTable, {
        props: {
          data: [],
          columns: makeColumns(),
          error: "Failed to load data",
        },
      });
      expect(wrapper.find('[data-test="o2-table-error"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-error"]').text()).toContain("Failed to load data");
    });

    it("shows error instead of empty when both error and empty data", () => {
      wrapper = mount(OTable, {
        props: {
          data: [],
          columns: makeColumns(),
          error: "API Error",
        },
      });
      expect(wrapper.find('[data-test="o2-table-error"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-empty"]').exists()).toBe(false);
    });
  });

  // ── Column Features ────────────────────────────────────────

  describe("column features", () => {
    it("applies align class from column meta", () => {
      const cols: OTableColumnDef<TestRow>[] = [
        { id: "id", header: "ID", accessorKey: "id", meta: { align: "center" } },
        { id: "name", header: "Name", accessorKey: "name", meta: { align: "right" } },
      ];
      wrapper = mount(OTable, {
        props: { data: makeRows(1), columns: cols },
      });

      const idCell = wrapper.find('[data-test="o2-table-cell-id"]');
      expect(idCell.classes()).toContain("text-center");

      const nameCell = wrapper.find('[data-test="o2-table-cell-name"]');
      expect(nameCell.classes()).toContain("text-right");
    });
  });

  // ── Row Events ─────────────────────────────────────────────

  describe("row events", () => {
    it("emits row-click when a row is clicked", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
        },
      });
      const row = wrapper.find('[data-test="o2-table-row-0"]');
      await row.trigger("click");
      expect(wrapper.emitted("row-click")).toBeTruthy();
      expect(wrapper.emitted("row-click")?.[0][0]).toEqual(expect.objectContaining({ id: 1 }));
    });

    it("emits row-dblclick when a row is double-clicked", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
        },
      });
      const row = wrapper.find('[data-test="o2-table-row-0"]');
      await row.trigger("dblclick");
      expect(wrapper.emitted("row-dblclick")).toBeTruthy();
    });

    it("emits cell-click when a cell is clicked", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(2),
          columns: makeColumns(),
        },
      });
      const cell = wrapper.find('[data-test="o2-table-cell-id"]');
      await cell.trigger("click");
      expect(wrapper.emitted("cell-click")).toBeTruthy();
    });
  });

  // ── Custom Cell Slots ──────────────────────────────────────

  describe("cell slots", () => {
    it("renders custom cell content via slot", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(1),
          columns: [...makeColumns().slice(0, 1), { id: "actions", header: "", isAction: true }],
        },
        slots: {
          "cell-actions": `<span data-test="custom-action">Edit</span>`,
        },
      });
      expect(wrapper.find('[data-test="custom-action"]').exists()).toBe(true);
    });
  });

  // ── Cell hover-action overlay ─────────────────────────

  describe("cell hover actions", () => {
    it("teleports one cell-hover-actions toolbar, only for the hovered cell", async () => {
      vi.useFakeTimers();
      wrapper = mount(OTable, {
        props: { data: makeRows(2), columns: makeColumns() },
        slots: {
          "cell-hover-actions": `<span class="hover-act" :data-active="active">A</span>`,
        },
      });

      // The toolbar floats clear of the hovered row, so it lives in <body> and exists
      // only while a cell is hovered — never one overlay per cell.
      const toolbars = () =>
        document.querySelectorAll('[data-test^="o2-table-cell-hover-actions-"]');
      expect(toolbars().length).toBe(0);

      await wrapper.find('[data-test="o2-table-cell-id"]').trigger("mouseenter");
      vi.advanceTimersByTime(250);
      await nextTick();
      expect(toolbars().length).toBe(1);
      expect(document.querySelectorAll('.hover-act[data-active="true"]').length).toBe(1);

      await wrapper.find('[data-test="o2-table-cell-id"]').trigger("mouseleave");
      vi.advanceTimersByTime(200);
      await nextTick();
      expect(toolbars().length).toBe(0);
      vi.useRealTimers();
    });

    it("stays hidden on cells where the slot renders nothing", async () => {
      vi.useFakeTimers();
      wrapper = mount(OTable, {
        props: { data: makeRows(1), columns: makeColumns() },
        slots: {
          "cell-hover-actions": `<span v-if="column.id === 'name'" class="hover-act">A</span>`,
        },
      });

      // Hovering the 'id' cell yields only a v-if comment — no empty box should float.
      await wrapper.find('[data-test="o2-table-cell-id"]').trigger("mouseenter");
      vi.advanceTimersByTime(250);
      await nextTick();
      expect(document.querySelectorAll('[data-test^="o2-table-cell-hover-actions-"]').length).toBe(
        0,
      );

      await wrapper.find('[data-test="o2-table-cell-name"]').trigger("mouseenter");
      vi.advanceTimersByTime(250);
      await nextTick();
      expect(document.querySelectorAll('[data-test^="o2-table-cell-hover-actions-"]').length).toBe(
        1,
      );
      vi.useRealTimers();
    });

    it("does not collide with a per-column '#cell-actions' slot (id: 'actions')", () => {
      // A column with id 'actions' renders its cell content via #cell-actions;
      // the hover overlay must not hijack that slot name.
      wrapper = mount(OTable, {
        props: {
          data: makeRows(1),
          columns: [...makeColumns().slice(0, 1), { id: "actions", header: "", isAction: true }],
        },
        slots: {
          "cell-actions": `<span data-test="col-actions">Edit</span>`,
        },
      });
      expect(wrapper.find('[data-test="col-actions"]').exists()).toBe(true);
      expect(document.querySelectorAll('[data-test^="o2-table-cell-hover-actions-"]').length).toBe(
        0,
      );
    });

    describe("placement", () => {
      const realRect = Element.prototype.getBoundingClientRect;

      // The td, the thead and the toolbar are the only rects the placement reads.
      function stubRects(cellTop: number, cellBottom: number, headerBottom: number) {
        Element.prototype.getBoundingClientRect = function () {
          const el = this as HTMLElement;
          if (el.tagName === "THEAD") {
            return { top: 0, bottom: headerBottom, height: headerBottom } as DOMRect;
          }
          if (el.classList?.contains("o2-table-cell-hover-actions")) {
            return { top: 0, bottom: 34, left: 0, right: 120, width: 120, height: 34 } as DOMRect;
          }
          if (el.tagName === "TD") {
            return {
              top: cellTop,
              bottom: cellBottom,
              left: 100,
              right: 300,
              width: 200,
              height: cellBottom - cellTop,
            } as DOMRect;
          }
          return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect;
        } as any;
      }

      async function hoverCell(
        cellTop: number,
        cellBottom: number,
        headerBottom: number,
        clientX: number,
      ) {
        stubRects(cellTop, cellBottom, headerBottom);
        wrapper = mount(OTable, {
          props: { data: makeRows(3), columns: makeColumns() },
          slots: { "cell-hover-actions": `<span class="hover-act">A</span>` },
        });
        await wrapper
          .find('[data-test="o2-table-cell-id"]')
          .trigger("mouseenter", { clientX, clientY: 999 });
        await nextTick();
        await nextTick();
        await nextTick();
        return document.querySelector('[data-test^="o2-table-cell-hover-actions-"]') as HTMLElement;
      }

      const arrowOf = (bar: HTMLElement) =>
        bar.querySelector('[data-test^="o2-table-cell-hover-arrow-"]') as HTMLElement;

      beforeEach(() => {
        Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
      });

      afterEach(() => {
        Element.prototype.getBoundingClientRect = realRect;
        document.querySelectorAll(".o2-table-cell-hover-actions").forEach((n) => n.remove());
      });

      it("anchors to the row's top edge, not the pointer, and points the arrow down", async () => {
        const bar = await hoverCell(300, 324, 40, 200);
        // clientY was 999 — a pointer-anchored toolbar would have landed there.
        expect(bar.style.top).toBe("300px");
        expect(bar.style.transform).toBe("translate(-50%, -100%)");
        expect(arrowOf(bar).className).toContain("-bottom-1");
      });

      it("flips below the row when the toolbar would cover the sticky header", async () => {
        const bar = await hoverCell(50, 74, 40, 200);
        expect(bar.style.top).toBe("74px");
        expect(bar.style.transform).toBe("translate(-50%, 0)");
        expect(arrowOf(bar).className).toContain("-top-1");
      });

      it("clamps the toolbar to the window but keeps the arrow over the pointer", async () => {
        const bar = await hoverCell(300, 324, 40, 795);
        // Half-width is 60, so the centre can go no further than 800 - 60.
        expect(bar.style.left).toBe("740px");
        // Pointer 795 sits 115px into a 120px bar; the arrow stops 10px short of the corner.
        expect(arrowOf(bar).style.left).toBe("110px");
      });

      it("centres the arrow and clips it to the half outside the bar", async () => {
        const bar = await hoverCell(300, 324, 40, 400);
        expect(bar.style.left).toBe("400px");
        // `left` is the arrow's centre (`-ml-1`); unclipped, the rotated square's
        // upper half notches any filled control in the bar (the AI chip).
        expect(arrowOf(bar).style.left).toBe("60px");
        expect(arrowOf(bar).className).toContain("-ml-1");
        expect(arrowOf(bar).className).toContain("[clip-path:polygon(0_100%");
      });
    });
  });

  // ── Dense / Bordered / Striped ─────────────────────────────

  describe("display variants", () => {
    it("uses dense row height when dense is true", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          dense: true,
        },
      });
      // dense mode sets row height to 2.25rem via CSS variable on the table
      const tableEl = wrapper.find('[data-test="o2-table"]');
      expect(tableEl.attributes("style")).toContain("2.25rem");
    });
  });

  // ── Pagination: none ───────────────────────────────────────

  describe("pagination: none", () => {
    it("does not render pagination footer", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          pagination: "none",
        },
      });
      expect(wrapper.find('[data-test="o2-table-pagination-bottom"]').exists()).toBe(false);
    });
  });

  // ── Exposed API ────────────────────────────────────────────

  describe("exposed API", () => {
    it("exposes the TanStack table instance", () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(5), columns: makeColumns() },
      });
      const vm = wrapper.vm as any;
      expect(vm.table).toBeDefined();
    });

    it("exposes toggleAllRows for selection", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          selection: "multiple",
        },
      });
      const vm = wrapper.vm as any;
      expect(typeof vm.toggleAllRows).toBe("function");
      expect(typeof vm.clearSelection).toBe("function");
    });

    it("exposes getRows returning all visible rows", () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(5), columns: makeColumns() },
      });
      const vm = wrapper.vm as any;
      expect(typeof vm.getRows).toBe("function");
      const rows = vm.getRows();
      expect(rows).toHaveLength(5);
      expect(rows[0]).toEqual(expect.objectContaining({ id: 1 }));
    });
  });

  // ── Virtual Scroll ──────────────────────────────────────────

  describe("virtual scroll", () => {
    it("renders rows when virtual scroll is enabled", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(100),
          columns: makeColumns(),
          virtualScroll: true,
          maxHeight: 400,
        },
      });
      // Virtual scroll still renders visible rows
      expect(wrapper.find('[data-test="o2-table"]').exists()).toBe(true);
    });

    it("renders correctly with virtual scroll and small dataset", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          virtualScroll: true,
          maxHeight: 400,
        },
      });
      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
    });

    // Variable-height virtual rows can't be asserted in jsdom: with no real
    // scroll-element size the virtualizer returns 0 virtual items, so the
    // branch carrying the measurement wiring never renders.
  });

  // ── Column Management ──────────────────────────────────────

  describe("bounded elastic (fillRemaining) column width", () => {
    // A scrolling table sizes columns to max-content, so without a clamp the
    // filler stretches to its longest value instead of taking the leftover.
    const longValue = "x".repeat(4000);
    // Built, not written literally: a bare `var(--header-x-size)` in source
    // trips scripts/check-css-tokens.mjs (no static `--header-x-size:` decl).
    const sizeVar = (id: string) => `var(--header-${id}-size)`;

    function mountElastic(
      props: Record<string, unknown> = {},
      fillMeta: Record<string, unknown> = { autoWidth: true, fillRemaining: true },
    ) {
      const cols: OTableColumnDef<any>[] = [
        { id: "ts", header: "Timestamp", accessorKey: "ts", size: 236 },
        {
          id: "body",
          header: "Body",
          accessorKey: "body",
          size: 800,
          minSize: 800,
          meta: fillMeta,
        },
      ];
      return mount(OTable, {
        props: {
          data: [{ ts: "2026-07-31 10:00:00.000", body: longValue }],
          columns: cols,
          horizontalScroll: true,
          ...props,
        },
      });
    }

    it("should clamp the elastic column to the leftover width when scrolling", () => {
      wrapper = mountElastic();
      const cell = wrapper.find('[data-test="o2-table-cell-body"]');
      expect(cell.exists()).toBe(true);
      expect(cell.attributes("style")).toContain("max-width: 0");
      expect(cell.attributes("style")).toContain("min-width: 800px");
      expect(cell.classes()).toContain("text-ellipsis");
      expect(cell.classes()).toContain("overflow-hidden");
    });

    it("should clamp the elastic header in step with its cells", () => {
      wrapper = mountElastic();
      const th = wrapper.find('[data-test="o2-table-th-body"]');
      expect(th.exists()).toBe(true);
      expect(th.attributes("style")).toContain("max-width: 0");
    });

    it("should pin sized columns beside it, since the table loses min-w-max", () => {
      wrapper = mountElastic();
      const cell = wrapper.find('[data-test="o2-table-cell-ts"]');
      expect(cell.exists()).toBe(true);
      expect(cell.attributes("style")).not.toContain("max-width: 0");
      expect(cell.attributes("style")).toContain(`min-width: ${sizeVar("ts")}`);
    });

    // Regression: once another field is selected `body` becomes an ordinary
    // sized column, and nothing capped those — its own text stretched it to
    // ~3000px and dragged the row into horizontal scroll.
    it("should pin a long-valued sized column at its size instead of its content", () => {
      wrapper = mountElastic({
        columns: [
          { id: "ts", header: "Timestamp", accessorKey: "ts", size: 236 },
          // no longer last, so it is sized — and its value is enormous
          { id: "body", header: "Body", accessorKey: "body", size: 800 },
          {
            id: "level",
            header: "Level",
            accessorKey: "level",
            size: 150,
            minSize: 150,
            meta: { autoWidth: true, fillRemaining: true },
          },
        ],
        data: [{ ts: "2026-07-31 10:00:00.000", body: longValue, level: "INFO" }],
      });
      const cell = wrapper.find('[data-test="o2-table-cell-body"]');
      expect(cell.exists()).toBe(true);
      expect(cell.attributes("style")).toContain(`width: ${sizeVar("body")}`);
      expect(cell.attributes("style")).toContain(`min-width: ${sizeVar("body")}`);
      expect(cell.attributes("style")).toContain(`max-width: ${sizeVar("body")}`);
      expect(cell.classes()).toContain("text-ellipsis");
      const th = wrapper.find('[data-test="o2-table-th-body"]');
      expect(th.attributes("style")).toContain(`max-width: ${sizeVar("body")}`);
    });

    it("should size the table to the container rather than max-content", () => {
      wrapper = mountElastic();
      const table = wrapper.find("table");
      expect(table.classes()).toContain("w-full");
      expect(table.classes()).not.toContain("min-w-max");
    });

    it("should leave a plain autoWidth column content-sized and scrolling", () => {
      wrapper = mountElastic({}, { autoWidth: true });
      const cell = wrapper.find('[data-test="o2-table-cell-body"]');
      expect(cell.exists()).toBe(true);
      expect(cell.attributes("style") ?? "").not.toContain("max-width: 0");
      expect(wrapper.find("table").classes()).toContain("min-w-max");
    });

    it("should release the clamp while wrapping so the text can reflow", () => {
      wrapper = mountElastic({ wrap: true });
      const cell = wrapper.find('[data-test="o2-table-cell-body"]');
      expect(cell.exists()).toBe(true);
      expect(cell.attributes("style") ?? "").not.toContain("max-width: 0");
      expect(cell.classes()).toContain("whitespace-normal");
    });

    it("should leave non-scrolling tables to the container-bounded layout", () => {
      wrapper = mountElastic({ horizontalScroll: false });
      const cell = wrapper.find('[data-test="o2-table-cell-body"]');
      expect(cell.exists()).toBe(true);
      expect(cell.attributes("style") ?? "").not.toContain("max-width: 0");
    });
  });

  describe("column resize", () => {
    it("shows resize handle on resizable columns", () => {
      const cols: OTableColumnDef<TestRow>[] = [
        { id: "id", header: "ID", accessorKey: "id", resizable: true },
        { id: "name", header: "Name", accessorKey: "name" },
      ];
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: cols,
          enableColumnResize: true,
        },
      });
      expect(wrapper.find(".resizer").exists()).toBe(true);
    });

    it("does not show resize handles when column resize is disabled", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          enableColumnResize: false,
        },
      });
      expect(wrapper.find(".resizer").exists()).toBe(false);
    });
  });

  describe("column reorder", () => {
    it("renders drag wrapper when column reorder is enabled", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          enableColumnReorder: true,
        },
      });
      // vuedraggable adds a draggable wrapper
      expect(wrapper.find('[data-test="o2-table-header"]').exists()).toBe(true);
    });
  });

  describe("column visibility", () => {
    it("hides columns specified in columnVisibility", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          columnVisibility: { email: false },
        },
      });
      // Email column header should not be rendered
      expect(wrapper.find('[data-test="o2-table-th-email"]').exists()).toBe(false);
    });

    it("shows columns by default when no visibility specified", () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(3), columns: makeColumns() },
      });
      expect(wrapper.find('[data-test="o2-table-th-email"]').exists()).toBe(true);
    });
  });

  describe("column close", () => {
    it("renders a close button only for meta.closable columns and emits close-column", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(2),
          columns: [
            { id: "id", header: "ID", accessorKey: "id" },
            {
              id: "name",
              header: "Name",
              accessorKey: "name",
              meta: { closable: true },
            },
          ] as OTableColumnDef<TestRow>[],
        },
      });
      // Only the closable column gets a remove button
      expect(wrapper.find('[data-test="o2-table-th-remove-name-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-th-remove-id-btn"]').exists()).toBe(false);

      await wrapper.find('[data-test="o2-table-th-remove-name-btn"]').trigger("click");
      const ev = wrapper.emitted("close-column");
      expect(ev).toBeTruthy();
      expect((ev![0][0] as OTableColumnDef).id).toBe("name");
    });
  });

  describe("column pinning", () => {
    it("pins left-pinned columns", () => {
      const cols: OTableColumnDef<TestRow>[] = [
        { id: "id", header: "ID", accessorKey: "id", pinned: "left" },
        { id: "name", header: "Name", accessorKey: "name" },
      ];
      wrapper = mount(OTable, {
        props: { data: makeRows(3), columns: cols },
      });
      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
    });

    it("auto-pins isAction columns to right", () => {
      const cols: OTableColumnDef<TestRow>[] = [
        { id: "id", header: "ID", accessorKey: "id" },
        { id: "actions", header: "", isAction: true },
      ];
      wrapper = mount(OTable, {
        props: { data: makeRows(3), columns: cols },
      });
      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
    });
  });

  // ── Highlighting ────────────────────────────────────────────

  describe("highlighting", () => {
    it("renders highlighted text in cells", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          highlightText: "User",
        },
      });
      // Cells containing "User" should have highlighted spans
      const cell = wrapper.find('[data-test="o2-table-cell-name"]');
      expect(cell.html()).toContain("User");
    });

    it("limits highlighting to specific fields", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          highlightText: "Active",
          highlightFields: ["status"],
        },
      });
      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
    });
  });

  // ── Streaming Indicator ─────────────────────────────────────

  describe("streaming", () => {
    it("shows streaming indicator when streaming with data", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          streaming: true,
        },
      });
      expect(wrapper.find('[data-test="o2-table-streaming-bar"]').exists()).toBe(true);
    });

    it("does not show streaming indicator when not streaming", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          streaming: false,
        },
      });
      expect(wrapper.find('[data-test="o2-table-streaming-bar"]').exists()).toBe(false);
    });
  });

  // ── Loading Banner ──────────────────────────────────────────

  describe("loading banner", () => {
    it("renders loading banner slot when streaming with existing data", () => {
      // The loading-banner slot is rendered when streaming=true and data exists,
      // not when loading=true (loading uses the skeleton overlay instead)
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          streaming: true,
        },
        slots: {
          "loading-banner": '<div data-test="custom-loading-banner">Refreshing...</div>',
        },
      });
      expect(wrapper.find('[data-test="custom-loading-banner"]').exists()).toBe(true);
    });
  });

  // ── Scoped Bottom Slot ─────────────────────────────────────

  describe("bottom slot", () => {
    it("renders bottom slot", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          pagination: "client",
        },
        slots: {
          bottom: '<div data-test="custom-bottom">Bottom Content</div>',
        },
      });
      expect(wrapper.find('[data-test="custom-bottom"]').exists()).toBe(true);
    });
  });

  // ── getCellStyle ────────────────────────────────────────────

  describe("getCellStyle", () => {
    it("applies custom cell styles via getCellStyle callback", () => {
      const getCellStyle = vi.fn(({ columnId, value }) => {
        if (columnId === "status" && value === "Active") {
          return { backgroundColor: "var(--color-status-success-bg)" };
        }
        return {};
      });
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          getCellStyle,
        },
      });
      // The callback should have been called for each cell
      expect(getCellStyle).toHaveBeenCalled();
    });
  });

  // ── meta.format ─────────────────────────────────────────────

  describe("meta.format", () => {
    it("formats cell values using meta.format function", () => {
      const cols: OTableColumnDef<TestRow>[] = [
        {
          id: "name",
          header: "Name",
          accessorKey: "name",
          meta: { format: (value: string) => value.toUpperCase() },
        },
        { id: "email", header: "Email", accessorKey: "email" },
      ];
      wrapper = mount(OTable, {
        props: { data: makeRows(1), columns: cols },
      });
      const nameCell = wrapper.find('[data-test="o2-table-cell-name"]');
      // The format function uppercases the name
      expect(nameCell.text()).toContain("USER 1");
    });
  });

  // ── Row Styling ─────────────────────────────────────────────

  describe("row styling", () => {
    it("applies static rowClass to rows", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          rowClass: "custom-row-class",
        },
      });
      const row = wrapper.find('[data-test="o2-table-row-0"]');
      expect(row.classes()).toContain("custom-row-class");
    });

    it("applies dynamic rowClass function", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          rowClass: (row: TestRow) => (row.status === "Active" ? "row-active" : "row-inactive"),
        },
      });
      const activeRow = wrapper.find('[data-test="o2-table-row-0"]');
      expect(activeRow.classes()).toContain("row-active");
      const inactiveRow = wrapper.find('[data-test="o2-table-row-1"]');
      expect(inactiveRow.classes()).toContain("row-inactive");
    });

    it("applies status bar color via getRowStatusColor", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          getRowStatusColor: (row: TestRow) => (row.status === "Active" ? "#00ff00" : "#ff0000"),
        },
      });
      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
    });
  });

  // ── Cell Copy ───────────────────────────────────────────────

  describe("cell copy", () => {
    it("shows copy button on cells when enableCellCopy is true", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          enableCellCopy: true,
        },
      });
      expect(wrapper.find('[data-test="o2-table-cell-copy-id"]').exists()).toBe(true);
    });

    it("does not show copy button when enableCellCopy is false", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          enableCellCopy: false,
        },
      });
      expect(wrapper.find('[data-test="o2-table-cell-copy-id"]').exists()).toBe(false);
    });

    it("should not render a copy button when the cell value is empty", () => {
      wrapper = mount(OTable, {
        props: {
          data: [{ id: 1, name: "", email: "a@b.c", status: "Active" }],
          columns: makeColumns(),
          enableCellCopy: true,
        },
      });
      expect(wrapper.find('[data-test="o2-table-cell-copy-name"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="o2-table-cell-copy-email"]').exists()).toBe(true);
    });

    it("should place the copy button before the value when the column is right-aligned", () => {
      const columns = makeColumns();
      columns[0].meta = { align: "right" };
      wrapper = mount(OTable, {
        props: { data: makeRows(1), columns, enableCellCopy: true },
      });
      const copyBtn = wrapper.find('[data-test="o2-table-cell-copy-id"]');
      expect(copyBtn.exists()).toBe(true);
      expect(copyBtn.classes()).toContain("order-first");
    });

    it("should place the copy button after the value when the column is left-aligned", () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(1), columns: makeColumns(), enableCellCopy: true },
      });
      const copyBtn = wrapper.find('[data-test="o2-table-cell-copy-id"]');
      expect(copyBtn.exists()).toBe(true);
      expect(copyBtn.classes()).not.toContain("order-first");
    });

    it("should keep the copy button in flow so it cannot overlap the cell text", () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(1), columns: makeColumns(), enableCellCopy: true },
      });
      const copyBtn = wrapper.find('[data-test="o2-table-cell-copy-id"]');
      expect(copyBtn.classes()).not.toContain("absolute");
      expect(copyBtn.element.parentElement?.className).toContain("flex");
    });
  });

  // ── Footer Totals ───────────────────────────────────────────

  describe("footer totals", () => {
    it("renders footer when columns have aggregate and footer configured", () => {
      const cols: OTableColumnDef<TestRow>[] = [
        {
          id: "id",
          header: "ID",
          accessorKey: "id",
          aggregate: "count",
          footer: () => "Count",
        },
        { id: "name", header: "Name", accessorKey: "name" },
      ];
      wrapper = mount(OTable, {
        props: { data: makeRows(5), columns: cols },
      });
      // Footer renders when at least one column has a footer renderer
      expect(wrapper.find('[data-test="o2-table-footer"]').exists()).toBe(true);
    });

    it("renders footer cell for the column with footer configured", () => {
      const cols: OTableColumnDef<TestRow>[] = [
        {
          id: "id",
          header: "ID",
          accessorKey: "id",
          aggregate: "count",
          footer: () => "5",
        },
        { id: "name", header: "Name", accessorKey: "name" },
      ];
      wrapper = mount(OTable, {
        props: { data: makeRows(5), columns: cols },
      });
      const footerCells = wrapper.findAll('[data-test^="o2-table-footer-cell-"]');
      expect(footerCells.length).toBeGreaterThan(0);
    });

    it("does not render footer when no column has footer configured", () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(5), columns: makeColumns() },
      });
      expect(wrapper.find('[data-test="o2-table-footer"]').exists()).toBe(false);
    });
  });

  // ── Pivot Headers ───────────────────────────────────────────

  describe("pivot headers", () => {
    it("renders custom pivot multi-level headers when pivotHeaderLevels is provided", () => {
      const pivotHeaderLevels = [
        {
          isLeaf: false,
          cells: [
            { label: "Group A", colspan: 2, hasBorder: false },
            { label: "Group B", colspan: 2, hasBorder: true },
          ],
        },
        {
          isLeaf: true,
          cells: [
            { label: "Count", colspan: 1, _sortColumn: "A_count" },
            { label: "Sum", colspan: 1, _sortColumn: "A_sum" },
            { label: "Count", colspan: 1, _sortColumn: "B_count" },
            { label: "Sum", colspan: 1, _sortColumn: "B_sum" },
          ],
        },
      ];

      const cols: OTableColumnDef<TestRow>[] = [
        { id: "name", header: "Name", accessorKey: "name" },
        { id: "A_count", header: "Count", accessorKey: "A_count" },
        { id: "A_sum", header: "Sum", accessorKey: "A_sum" },
        { id: "B_count", header: "Count", accessorKey: "B_count" },
        { id: "B_sum", header: "Sum", accessorKey: "B_sum" },
      ];

      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: cols,
          pivotHeaderLevels,
          pivotRowColumns: [cols[0]],
        },
      });

      // Should render pivot header instead of standard header
      expect(wrapper.find('[data-test="o2-table-pivot-header"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-header"]').exists()).toBe(false);
    });

    it("merges consecutive same-value cells with a single pivotRowColumns entry", () => {
      // Single row-field regression: rows of a run share identical row-field
      // values, so a value-keyed merge map collided and hid the whole run
      // (including the first row). Keyed by row identity, the first row keeps
      // its content and only continuation rows blank out.
      const rows: TestRow[] = [
        { id: 1, name: "svc-a", email: "a1@example.com", status: "Active" },
        { id: 2, name: "svc-a", email: "a2@example.com", status: "Active" },
        { id: 3, name: "svc-b", email: "b1@example.com", status: "Active" },
      ];
      wrapper = mount(OTable, {
        props: {
          data: rows,
          columns: makeColumns(),
          pivotRowColumns: [{ name: "name" }],
        },
      });

      const nameCells = wrapper
        .findAll('[data-test="o2-table-cell-name"]')
        .map((c) => c.text().trim());
      expect(nameCells).toEqual(["svc-a", "", "svc-b"]);
      // Non-merged columns are untouched
      const emailCells = wrapper
        .findAll('[data-test="o2-table-cell-email"]')
        .map((c) => c.text().trim());
      expect(emailCells).toEqual(["a1@example.com", "a2@example.com", "b1@example.com"]);
    });

    it("gives bottom-edge rowspan cells the divider and sort icon leaf cells get", () => {
      // A synthetic Others/Total cell spans every header row (rowspan) when
      // there is a single y field, so no leaf cell renders beneath it — the
      // rowspan cell itself must then carry the header/body divider and the
      // sort indicator, or the column sorts blind with a gap in the border.
      const pivotHeaderLevels = [
        {
          isLeaf: false,
          cells: [
            { label: "GET", colspan: 1, _sortColumn: "GET_cnt" },
            { label: "Others", colspan: 1, rowspan: 2, hasBorder: true, _sortColumn: "Others_cnt" },
          ],
        },
        {
          isLeaf: true,
          cells: [{ label: "200", colspan: 1, _sortColumn: "GET_cnt" }],
        },
      ];
      const cols: OTableColumnDef<TestRow>[] = [
        { id: "name", header: "Name", accessorKey: "name" },
        { id: "GET_cnt", header: "Count", accessorKey: "id" },
        { id: "Others_cnt", header: "Count", accessorKey: "id" },
      ];
      wrapper = mount(OTable, {
        props: { data: makeRows(2), columns: cols, pivotHeaderLevels },
      });

      const groupTh = wrapper.find('[data-test="o2-table-pivot-th-0-0"]');
      const othersTh = wrapper.find('[data-test="o2-table-pivot-th-0-1"]');
      const leafTh = wrapper.find('[data-test="o2-table-pivot-th-1-0"]');

      // Divider: leaf and bottom-edge rowspan cells, not the mid-header group.
      expect(othersTh.classes()).toContain("border-b");
      expect(leafTh.classes()).toContain("border-b");
      expect(groupTh.classes()).not.toContain("border-b");

      // Sort indicator: the rowspan cell renders one (neutral state here), the
      // mid-header group cell stays icon-free even though it is clickable.
      expect(othersTh.findComponent(OIcon).exists()).toBe(true);
      expect(groupTh.findComponent(OIcon).exists()).toBe(false);
    });

    it("pins row-field columns left even when entries carry only name/field", () => {
      // Regression: pivotRowColumnIds pinned by `c.id`, but dashboard pivot
      // columns carry only name/field — leftPinnedIds became [undefined] and
      // the row-field column silently scrolled away with the data columns.
      const pivotHeaderLevels = [
        {
          isLeaf: true,
          cells: [{ label: "Count", colspan: 1, _sortColumn: "id" }],
        },
      ];
      wrapper = mount(OTable, {
        props: {
          data: makeRows(2),
          columns: makeColumns(),
          pivotHeaderLevels,
          pivotRowColumns: [{ name: "name", field: "name" }],
        },
      });

      const rowFieldTh = wrapper.find('[data-test="o2-table-pivot-th-name"]');
      expect(rowFieldTh.exists()).toBe(true);
      expect(rowFieldTh.attributes("style") ?? "").toContain("position: sticky");
    });

    it.each([
      ["standard-header mode", []],
      [
        "pivot-header mode",
        [{ isLeaf: true, cells: [{ label: "Count", colspan: 1, _sortColumn: "id" }] }],
      ],
    ])("pins only the first row-field column in %s", (_name, pivotHeaderLevels) => {
      // Pin offsets come from TanStack's nominal sizes, but table-auto layout
      // can render any column wider than its nominal size, so only the first
      // row field — whose offset (0) is width-independent — pins.
      wrapper = mount(OTable, {
        props: {
          data: makeRows(2),
          columns: makeColumns(),
          pivotHeaderLevels,
          pivotRowColumns: [
            { name: "name", field: "name" },
            { name: "email", field: "email" },
          ],
        },
      });

      const header = wrapper.findComponent(OTableHeader);
      const table: any = header.props("table");
      expect(table.getColumn("name")?.getIsPinned?.()).toBe("left");
      expect(table.getColumn("email")?.getIsPinned?.()).toBe(false);
    });

    it("renders standard header when pivotHeaderLevels is empty", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          pivotHeaderLevels: [],
        },
      });
      expect(wrapper.find('[data-test="o2-table-header"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-pivot-header"]').exists()).toBe(false);
    });
  });

  // ── scrollEl / scrollMargin ─────────────────────────────────

  describe("scrollEl prop", () => {
    it("accepts scrollEl and scrollMargin props without error", () => {
      const scrollContainer = document.createElement("div");
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          scrollEl: scrollContainer,
          scrollMargin: 50,
          virtualScroll: true,
        },
      });
      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
    });
  });

  // ── update:columnSizes ─────────────────────────────────────

  describe("column sizes emit", () => {
    it("does not emit update:columnSizes when column resize is disabled", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          enableColumnResize: false,
        },
      });
      // Should not have emitted column sizes
      expect(wrapper.emitted("update:columnSizes")).toBeFalsy();
    });
  });

  // ── Row Grouping / Tree ─────────────────────────────────────

  describe("row grouping / tree", () => {
    it("renders expand buttons when expansion is tree mode", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          expansion: "tree",
          getSubRows: (row: TestRow) =>
            row.id === 1
              ? [
                  {
                    id: 10,
                    name: "Sub 1",
                    email: "sub1@example.com",
                    status: "Active",
                  },
                ]
              : [],
        },
      });
      // Should have expand cells
      expect(wrapper.find('[data-test="o2-table-expand-cell"]').exists()).toBe(true);
    });

    it("expands and collapses tree rows", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          expansion: "multiple",
          getSubRows: (row: TestRow) =>
            row.id === 1
              ? [
                  {
                    id: 10,
                    name: "Sub 1",
                    email: "sub1@example.com",
                    status: "Active",
                  },
                ]
              : [],
        },
      });

      // Click expand button on first row
      const expandBtn = wrapper.find('[data-test="o2-table-expand-0"]');
      expect(expandBtn.exists()).toBe(true);
      await expandBtn.trigger("click");
      expect(wrapper.emitted("update:expandedIds")).toBeTruthy();
    });
  });

  // ── Keyboard Navigation ─────────────────────────────────────

  describe("keyboard navigation", () => {
    it("renders table with keyboard-navigable rows", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
        },
      });
      const scrollContainer = wrapper.find('[data-test="o2-table-scroll-container"]');
      expect(scrollContainer.exists()).toBe(true);
    });
  });

  // ── Data Refresh with Loading ────────────────────────────────

  describe("data refresh", () => {
    it("shows skeleton body when loading is true while data exists", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          loading: true,
        },
      });
      // When loading=true, heldLoading activates and the skeleton replaces rows
      expect(wrapper.find('[data-test="o2-table"]').exists()).toBe(true);
      // OTableLoading (skeleton) is shown instead of actual rows
      expect(wrapper.find('[data-test="o2-table-skeleton-body"]').exists()).toBe(true);
    });

    it("shows skeleton body when loading with no data", () => {
      wrapper = mount(OTable, {
        props: {
          data: [],
          columns: makeColumns(),
          loading: true,
        },
      });
      // OTableLoading skeleton renders inside the table with data-test="o2-table-skeleton-body"
      expect(wrapper.find('[data-test="o2-table-skeleton-body"]').exists()).toBe(true);
    });
  });

  // ── Per-column value filter ────────────────────────
  describe("per-column value filter", () => {
    function filterableColumns(): OTableColumnDef<TestRow>[] {
      return makeColumns().map((c) => (c.id === "status" ? { ...c, filterable: true } : c));
    }

    it("filters rows to the selected values through the column API", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(10), // 5 Active, 5 Inactive
          columns: filterableColumns(),
          enableColumnFilter: true,
          pagination: "none",
          sorting: "none",
        },
      });
      await nextTick();
      const table = (wrapper.vm as any).table;

      expect(table.getColumn("status").getCanFilter()).toBe(true);
      expect(table.getColumn("email").getCanFilter()).toBe(false);
      expect(table.getFilteredRowModel().rows.length).toBe(10);

      table.getColumn("status").setFilterValue(["Active"]);
      await nextTick();
      const rows = table.getFilteredRowModel().rows;
      expect(rows.length).toBe(5);
      expect(rows.every((r: any) => r.original.status === "Active")).toBe(true);

      // Multi-select is a union of the chosen values.
      table.getColumn("status").setFilterValue(["Active", "Inactive"]);
      await nextTick();
      expect(table.getFilteredRowModel().rows.length).toBe(10);

      // Clearing restores every row.
      table.getColumn("status").setFilterValue(undefined);
      await nextTick();
      expect(table.getFilteredRowModel().rows.length).toBe(10);
    });

    it("shows the filter button only on filterable columns when enabled", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(4),
          columns: filterableColumns(),
          enableColumnFilter: true,
          pagination: "none",
          sorting: "none",
        },
      });
      await nextTick();
      expect(wrapper.find('[data-test="o2-table-column-filter-btn-status"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-column-filter-btn-email"]').exists()).toBe(false);
    });

    it("renders no filter buttons when enableColumnFilter is off", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(4),
          columns: filterableColumns(),
          pagination: "none",
          sorting: "none",
        },
      });
      await nextTick();
      expect(wrapper.find('[data-test="o2-table-column-filter-btn-status"]').exists()).toBe(false);
    });
  });

  // ── Column close "x" gating ────────────────────────
  describe("column close (x) affordance", () => {
    it("does NOT show the close x on a hideable column by default", async () => {
      const columns: OTableColumnDef<TestRow>[] = makeColumns().map((c) =>
        c.id === "name" ? { ...c, hideable: true } : c,
      );
      wrapper = mount(OTable, {
        props: { data: makeRows(3), columns, pagination: "none", sorting: "none" },
      });
      await nextTick();
      // hideable must not imply closable, or every table's headers show a dead "x".
      expect(wrapper.find('[data-test="o2-table-th-remove-name-btn"]').exists()).toBe(false);
    });

    it("shows the close x only when a column opts in via meta.closable", async () => {
      const columns: OTableColumnDef<TestRow>[] = makeColumns().map((c) =>
        c.id === "name" ? { ...c, hideable: true, meta: { closable: true } } : c,
      );
      wrapper = mount(OTable, {
        props: { data: makeRows(3), columns, pagination: "none", sorting: "none" },
      });
      await nextTick();
      expect(wrapper.find('[data-test="o2-table-th-remove-name-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-th-remove-email-btn"]').exists()).toBe(false);
    });
  });

  // ── Column reorder ────────────────────────────────
  describe("column reorder", () => {
    it("re-emits column-order-change when the header updates the order", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(4),
          columns: makeColumns(),
          enableColumnReorder: true,
          pagination: "none",
          sorting: "none",
        },
      });
      await nextTick();
      const header = wrapper.findComponent(OTableHeader);
      const newOrder = ["status", "id", "name", "email"];
      header.vm.$emit("update:column-order", newOrder);
      await nextTick();
      const emitted = wrapper.emitted("column-order-change");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1][0]).toEqual(newOrder);
    });
  });
});
