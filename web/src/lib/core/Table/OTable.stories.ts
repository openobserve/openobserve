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

import type { Meta, StoryObj } from '@storybook/vue3-vite';
import OTable from '@/lib/core/Table/OTable.vue';

const meta: Meta<typeof OTable> = {
  title: 'Core/Table/OTable',
  component: OTable,
  tags: ['autodocs'],
  args: {
    pagination: "client",
    pageSize: 20,
    sorting: "client",
    globalFilterPlaceholder: "Search...",
    showGlobalFilter: true,
    filterMode: "client",
    footerTitle: "",
    selection: "none",
    rowKey: "id",
    expansion: "none",
    virtualScroll: false,
    virtualScrollItemSize: 48,
    enableColumnResize: false,
    enableColumnReorder: false,
    enableColumnPin: false,
    persistColumns: false,
    fillHeight: true,
    loading: false,
    streaming: false,
    dense: true,
    bordered: true,
    frame: false,
    striped: false,
    stickyHeader: true,
    showHeader: true,
    wrap: false,
    enableRowReorder: false,
    defaultColumns: true,
  },
  argTypes: {
    data: { control: false, description: 'Row data array (for client-side pagination/sorting)' },
    columns: { control: false, description: 'Column definitions' },
    pagination: { control: { type: 'select' }, options: ["client","server","none"] },
    pageSize: { control: 'number', description: 'Default page size (client-side) or current page size (server-side)' },
    pageSizeOptions: { control: false, description: 'Available page size options' },
    currentPage: { control: 'number', description: 'Current page index (1-based, for server-side v-model)' },
    totalCount: { control: 'number', description: 'Total record count (required for server-side pagination)' },
    keepPageOnDataChange: { control: 'boolean', description: 'When true, the page index is NOT reset when the data array changes (e.g. on row expand/collapse). Defaults to false.' },
    sorting: { control: { type: 'select' }, options: ["client","server","none"] },
    sortBy: { control: 'text', description: 'Active sort column id (server-side)' },
    sortOrder: { control: { type: 'select' }, options: ["asc","desc"], description: 'Active sort direction (server-side)' },
    sortFieldMap: { control: false, description: 'Maps TanStack column id → backend field name for server-side sort' },
    globalFilter: { control: 'text', description: 'Global search/filter text' },
    globalFilterPlaceholder: { control: 'text', description: 'Placeholder for global filter input' },
    showGlobalFilter: { control: 'boolean', description: 'Show built-in global filter search bar (default: true)' },
    filterMode: { control: { type: 'select' }, options: ["client","server"] },
    footerTitle: { control: 'text', description: 'Label shown bold in the footer as "N footerTitle" (e.g. "2 Dashboards")' },
    selection: { control: { type: 'select' }, options: ["none","single","multiple"] },
    selectedIds: { control: false, description: 'Selected row ids (v-model)' },
    isRowSelectable: { control: false, description: 'Per-row predicate: return false to disable that row\'s selection checkbox (renders with cursor: not-allowed and ignores toggles). E.g. block bulk selection of the root user in IAM.' },
    rowKey: { control: 'text', description: 'Field used as unique row identifier' },
    expansion: { control: { type: 'select' }, options: ["none","single","multiple","tree"] },
    expandedIds: { control: false, description: 'Expanded row ids (v-model)' },
    getRowExpansionEnabled: { control: false, description: 'Per-row predicate: return false to hide the expand button for that row' },
    expandOnRowClick: { control: 'boolean', description: 'When true or a per-row predicate, clicking a row also toggles expansion' },
    getSubRows: { control: false, description: 'For tree/grouping: returns sub-rows of a given row' },
    tree: { control: 'boolean', description: 'Enables tree mode. When true, OTable flattens parents + their children (when expanded) into the visible row list, renders an inline chevron in the tree column, and optionally renders a warning row between a parent and its children. State is managed internally; use :expanded-ids to control it.' },
    getChildren: { control: false, description: 'Children accessor for tree mode (defaults to row.children).' },
    getRowWarning: { control: false, description: 'Per-parent predicate — when true and the parent is expanded, OTable renders the #tree-warning slot row before its children.' },
    treeColumnId: { control: 'text', description: 'Id of the column that should host the inline chevron + indent. Defaults to the first non-action column.' },
    virtualScroll: { control: 'boolean' },
    virtualScrollItemSize: { control: 'number', description: 'Fixed row height for virtual scroll calculations (default 48)' },
    maxHeight: { control: 'text', description: 'Container max height; falls back to parent height when not set' },
    showIndex: { control: 'boolean', description: 'Auto-render a fixed-width row-index ("#") column as the first data column. OTable injects the column, fixes its width (TABLE_INDEX_COL_SIZE), and numbers rows by their position (accounting for the page offset under inject a "#" value into row data. Ignored if the caller already provides a column wit' },
    enableColumnResize: { control: 'boolean' },
    enableColumnReorder: { control: 'boolean' },
    enableColumnPin: { control: 'boolean' },
    columnVisibility: { control: false, description: 'Initial column visibility' },
    persistColumns: { control: 'boolean', description: 'Persist column widths and visibility to localStorage. Requires tableId to be set. When both are present, column sizes and visibility survive page reloads. Off by default.' },
    fillHeight: { control: 'boolean', description: 'When false, table shrinks to fit its content instead of filling the container height (default: true)' },
    loading: { control: 'boolean' },
    streaming: { control: 'boolean', description: 'Data is arriving incrementally (SSE/WebSocket). Shows a pulsing indicator.' },
    error: { control: 'text' },
    emptyMessage: { control: 'text', description: 'Text shown when data is empty and not loading' },
    dense: { control: 'boolean' },
    bordered: { control: 'boolean' },
    frame: { control: 'boolean', description: 'Draws the outer frame (border) around the whole table region. Default true. Set false when the table is embedded inside an already-bordered container (e.g. a page card) so it renders flush without a double border.' },
    striped: { control: 'boolean' },
    stickyHeader: { control: 'boolean' },
    showHeader: { control: 'boolean' },
    wrap: { control: 'boolean', description: 'Wrap cell content' },
    horizontalScroll: { control: 'boolean', description: 'When true, cells render their natural width and the table scrolls horizontally if the total content overflows the container. Switches the inner table from table-fixed to table-auto and removes the default overflow-hidden + text-ellipsis clipping on non-wrapped cells. Pair with wrap=false for long, u' },
    width: { control: 'text', description: 'Fixed table width (CSS value)' },
    highlightText: { control: 'text', description: 'Keyword(s) to highlight in cells' },
    highlightFields: { control: false, description: 'Which column ids to apply highlighting to (default: all)' },
    enableRowReorder: { control: 'boolean', description: 'Enable drag-and-drop row reordering. Renders a drag handle (grip icon) as the first column. Uses vue-draggable-next under the hood.' },
    disableRowReorder: { control: false, description: 'Per-row predicate: return false to disable dragging for that row. Defaults to all rows draggable when enableRowReorder is true.' },
    rowClass: { control: false, description: 'Static class or dynamic function for row <tr>' },
    getRowStyle: { control: false, description: 'Dynamic inline style for row' },
    getRowStatusColor: { control: false, description: 'Returns a CSS color for the status bar (4px left border) per row' },
    getCellStyle: { control: false, description: 'Returns inline styles for individual cells' },
    enableCellCopy: { control: 'boolean', description: 'Show hover-visible copy button on each cell' },
    rowHeight: { control: 'number', description: 'Fixed row height in px (for virtual scroll accuracy)' },
    scrollEl: { control: false, description: 'External scroll element (for shared scroll containers)' },
    scrollMargin: { control: 'number', description: 'Margin for scroll detection (default 0)' },
    pivotHeaderLevels: { control: false, description: 'Pivot header levels (multi-level headers)' },
    pivotRowColumns: { control: false, description: 'Pivot row field columns (for sticky headers)' },
    stickyRowTotals: { control: 'boolean', description: 'Show sticky row totals' },
    stickyColTotals: { control: 'boolean', description: 'Show sticky column totals' },
    defaultColumns: { control: 'boolean', description: 'Default column definitions applied to all columns' },
    tableId: { control: 'text', description: 'Unique id for the table instance (useful for multi-table pages)' },
  },
};

export default meta;
type Story = StoryObj<typeof OTable>;

export const Playground: Story = {
  render: (args) => ({
    components: { OTable },
    setup() {
      const sampleColumns = [{ id: 'stream', header: 'Stream', accessorKey: 'stream' }, { id: 'type', header: 'Type', accessorKey: 'type' }, { id: 'records', header: 'Records', accessorKey: 'records' }];
      const sampleData = [{ stream: 'default', type: 'logs', records: 128934 }, { stream: 'k8s_events', type: 'logs', records: 48210 }, { stream: 'http_requests', type: 'metrics', records: 982003 }, { stream: 'traces', type: 'traces', records: 20114 }];
      return { args, sampleColumns, sampleData };
    },
    template: `<div class="w-full"><OTable v-bind="args" :columns="sampleColumns" :data="sampleData">{{ args.default }}</OTable></div>`,
  }),
};
