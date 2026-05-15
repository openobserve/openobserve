<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <!-- Outer wrapper: full panel height, flex-column so pagination sits below the scroll area -->
  <div
    class="my-sticky-virtscroll-table tw:h-full tw:flex tw:flex-col tw:rounded-none!"
    :data-sticky-id="tableId"
    :class="{ 'pivot-sticky-totals': stickyRowTotals, 'wrap-enabled': wrap }"
    :style="store.state.printMode ? { position: 'static' } : {}"
  >
    <!-- Scroll container: grows to fill available height -->
    <div
      ref="parentRef"
      :class="[
        'container',
        'table-container',
        'tw:flex-1',
        'tw:min-h-0',
        'tw:overflow-auto',
        'tw:relative',
        { 'virtual-scroll-active': useVirtualScroll },
      ]"
    >
      <table
        v-if="table"
        data-test="o2-table"
        :class="['tw:w-full', 'tw:table-auto']"
        :style="{
          minWidth: '100%',
          ...columnSizeVars,
          minHeight: showPagination ? undefined : totalSize + 'px',
          width: !useVirtualScroll
            ? '100%'
            : !defaultColumns
              ? table.getCenterTotalSize() + 'px'
              : wrap
                ? width
                  ? width - 12 + 'px'
                  : '100%'
                : '100%',
          // Use border-collapse:separate for pivot tables AND tables with
          // sticky columns so borders stick with position:sticky headers
          // (collapse mode paints adjacent cells on top of sticky shadows).
          borderCollapse: usesSeparateBorders ? 'separate' : undefined,
          borderSpacing: usesSeparateBorders ? '0' : undefined,
        }"
      >
        <!-- ── Pivot multi-level headers (dashboard only) ───────────────────── -->
        <thead
          v-if="pivotHeaderLevels.length > 0"
          class="pivot-thead tw:sticky tw:top-0 tw:z-10"
        >
          <tr
            v-for="(level, levelIdx) in pivotHeaderLevels as any[]"
            :key="'hl_' + levelIdx"
            style="max-height: 28px; height: 28px"
          >
            <!-- Row-field headers: first <tr> only, rowspan all levels -->
            <th
              v-if="levelIdx === 0"
              v-for="col in pivotRowColumns"
              :key="'rh_' + col.name"
              :rowspan="pivotHeaderLevels.length"
              class="pivot-group-header tw:cursor-pointer tw:px-2 tw:text-left"
              :style="getStickyColumnStyle(col) as any"
              @click="handlePivotSort(col.name)"
            >
              {{ col.label }}
              <q-icon
                :name="
                  pivotSortState.descending ? 'arrow_downward' : 'arrow_upward'
                "
                size="12px"
                class="q-ml-xs pivot-sort-icon"
                :class="{
                  'pivot-sort-active': pivotSortState.sortBy === col.name,
                }"
              />
            </th>
            <!-- Pivot group / value headers -->
            <th
              v-for="(cell, cellIdx) in level.cells"
              :key="'c_' + levelIdx + '_' + cellIdx"
              :colspan="cell.colspan"
              :rowspan="cell.rowspan || 1"
              class="tw:px-2"
              :class="[
                level.isLeaf
                  ? 'pivot-value-header'
                  : 'pivot-group-header tw:text-center',
                {
                  'pivot-section-border':
                    cell.hasBorder && !(stickyColTotals && cell._isTotalHeader),
                },
                { 'pivot-total-col': stickyColTotals && cell._isTotalHeader },
                { 'tw:cursor-pointer': cell._sortColumn },
              ]"
              :style="
                (stickyColTotals && cell._isTotalHeader
                  ? getStickyTotalHeaderForPivot(cell)
                  : {}) as any
              "
              @click="cell._sortColumn && handlePivotSort(cell._sortColumn)"
            >
              {{ cell.label }}
              <q-icon
                v-if="level.isLeaf && cell._sortColumn"
                :name="
                  pivotSortState.descending ? 'arrow_downward' : 'arrow_upward'
                "
                size="12px"
                class="q-ml-xs pivot-sort-icon"
                :class="{
                  'pivot-sort-active':
                    pivotSortState.sortBy === cell._sortColumn,
                }"
              />
            </th>
          </tr>
        </thead>

        <!-- ── Standard TanStack headers (logs / non-pivot) ─────────────────── -->
        <thead
          v-else
          class="tw:sticky tw:top-0 tw:z-10"
          style="max-height: 44px; height: 22px"
          v-for="headerGroup in table.getHeaderGroups()"
          :key="headerGroup.id"
        >
          <vue-draggable
            v-model="columnOrder"
            :element="'table'"
            :animation="200"
            :sort="
              enableColumnReorder && (!isResizingHeader || !defaultColumns)
            "
            handle=".table-head"
            :class="[
              // Flex only for virtual-scroll mode (logs/traces) for drag-reorder + alignment
              // Non-virtual (dashboard) uses table-layout:auto — no flex so browser auto-sizes columns
              useVirtualScroll ? 'tw:flex items-center' : '',
              enableColumnReorder && table.getState().columnOrder.length
                ? 'tw:cursor-move!'
                : '',
            ]"
            :style="{
              width:
                defaultColumns && wrap
                  ? width - 12 + 'px'
                  : defaultColumns
                    ? tableRowSize + 'px'
                    : table.getTotalSize() + 'px',
              minWidth: '100%',
              background: store.state.theme === 'dark' ? '#565656' : '#E0E0E0',
            }"
            tag="tr"
            @start="(event) => handleDragStart(event)"
            @end="() => handleDragEnd()"
          >
            <th
              v-for="header in headerGroup.headers"
              :key="header.id"
              :id="header.id"
              class="tw:px-2 tw:relative table-head tw:text-ellipsis!"
              :class="[
                (header.column.columnDef.meta as any)?.align === 'center'
                  ? 'tw:text-center!'
                  : '',
                (header.column.columnDef.meta as any)?.align === 'right'
                  ? 'tw:text-right!'
                  : '',
                (header.column.columnDef.meta as any)?.headerClass ?? '',
                {
                  'pivot-total-col':
                    stickyColTotals &&
                    (header.column.columnDef.meta as any)?._isTotalColumn,
                },
              ]"
              :style="{
                width: `calc(var(--header-${sanitizeCssId(header?.id)}-size) * 1px)`,
                height: rowHeight != null ? rowHeight + 'px' : undefined,
              }"
              :data-test="`o2-table-th-${header.id}`"
            >
              <div
                class="tw:h-full tw:w-full tw:flex tw:items-center"
                :class="[
                  (header.column.columnDef.meta as any)?.align === 'center'
                    ? 'tw:justify-center! tw:text-center!'
                    : '',
                  (header.column.columnDef.meta as any)?.align === 'right'
                    ? 'tw:justify-end! tw:text-right!'
                    : '',
                ]"
              >
                <div
                  v-if="header.column.getCanResize()"
                  @dblclick="header.column.resetSize()"
                  @mousedown.self.prevent.stop="
                    header.getResizeHandler()?.($event)
                  "
                  @touchstart.self.prevent.stop="
                    header.getResizeHandler()?.($event)
                  "
                  :class="[
                    'resizer',
                    'tw:hover:bg-[var(--o2-border-color)]',
                    header.column.getIsResizing() ? 'isResizing' : '',
                  ]"
                  class="tw:right-0 tw:bg-transparent"
                />
                <div
                  v-if="!header.isPlaceholder"
                  :data-test="`o2-table-th-sort-${header.id}`"
                  :class="['text-left', 'cursor-pointer tw:gap-1']"
                  @click="
                    handleHeaderSortClick(
                      $event,
                      header.column,
                      header.column.getToggleSortingHandler(),
                    )
                  "
                  class="tw:overflow-hidden tw:whitespace-nowrap tw:text-ellipsis! tw:tracking-[0.06rem] tw:text-[var(--o2-text-2)] tw:text-[0.85rem]"
                >
                  <FlexRender
                    :render="header.column.columnDef.header"
                    :props="header.getContext()"
                  />
                  <!-- Server-side sort icons (shown when sortBy prop is provided) -->
                  <template
                    v-if="
                      sortBy !== undefined &&
                      (header.column.columnDef.meta as any)?.sortable
                    "
                  >
                    <q-icon
                      v-if="
                        (sortFieldMap?.[header.column.id] ??
                          header.column.id) === sortBy
                      "
                      :name="
                        sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'
                      "
                      data-test="tenstack-table-sort-icon-active"
                      size="0.85rem"
                      class="tw:text-[var(--o2-primary-color)]"
                    />
                    <q-icon
                      v-else
                      name="unfold_more"
                      data-test="tenstack-table-sort-icon-inactive"
                      size="0.85rem"
                      class="tw:opacity-40"
                    />
                  </template>
                </div>
                <div
                  :data-test="`o2-table-add-data-from-column-${header.column.columnDef.header}`"
                  class="tw:invisible tw:items-center tw:absolute tw:right-2 tw:top-0 tw:px-2 column-actions tw:h-full tw:flex"
                  :class="
                    store.state.theme === 'dark' ? 'field_overlay_dark' : ''
                  "
                  v-if="
                    (header.column.columnDef.meta as any)?.closable ||
                    (header.column.columnDef.meta as any)?.showWrap
                  "
                >
                  <q-icon
                    v-if="(header.column.columnDef.meta as any).closable"
                    :data-test="`o2-table-th-remove-${header.column.columnDef.header}-btn`"
                    name="cancel"
                    class="q-ma-none close-icon cursor-pointer"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-white'
                        : 'text-grey-7'
                    "
                    :title="t('common.close')"
                    size="18px"
                    @click="closeColumn(header.column.columnDef)"
                  >
                  </q-icon>
                </div>
              </div>
            </th>
          </vue-draggable>

          <!-- Loading row: shown when there are no rows yet (initial fetch) -->
          <tr v-if="loading && tableRows.length === 0" class="tw:w-full">
            <td
              :colspan="columnOrder.length"
              class="text-bold"
              :style="{
                background:
                  store.state.theme === 'dark' ? '#565656' : '#E0E0E0',
                opacity: 0.7,
              }"
            >
              <slot name="loading">
                <div
                  class="text-subtitle2 text-weight-bold tw:flex tw:items-center"
                >
                  <q-spinner-hourglass size="20px" />
                  {{ t("confirmDialog.loading") }}
                </div>
              </slot>
            </td>
          </tr>
          <!-- Loading banner: shown above rows while a new page is fetching -->
          <tr v-if="loading && tableRows.length > 0" class="tw:w-full">
            <td :colspan="columnOrder.length">
              <slot name="loading-banner" />
            </td>
          </tr>
          <tr v-if="!loading && errMsg != ''" class="tw:w-full">
            <td
              :colspan="columnOrder.length"
              class="text-bold"
              style="opacity: 0.7"
            >
              <div class="text-subtitle2 text-weight-bold bg-warning">
                <q-icon size="xs" name="warning" class="q-mr-xs" />
                {{ errMsg }}
              </div>
            </td>
          </tr>
          <tr data-test="o2-table-function-error" v-if="functionErrorMsg != ''">
            <td
              :colspan="columnOrder.length"
              class="text-bold"
              style="opacity: 0.6"
            >
              <div
                class="text-subtitle2 text-weight-bold q-pl-sm"
                :class="
                  store.state.theme === 'dark'
                    ? 'tw:bg-yellow-600'
                    : 'tw:bg-amber-300'
                "
              >
                <OButton
                  variant="ghost"
                  size="icon-xs-sq"
                  class="q-mr-xs"
                  data-test="table-row-expand-menu"
                  @click.capture.stop="expandFunctionError"
                >
                  <q-icon
                    :name="
                      isFunctionErrorOpen ? 'expand_more' : 'chevron_right'
                    "
                    size="14px"
                  /> </OButton
                ><b>
                  <q-icon name="warning" size="15px"></q-icon>
                  {{ t("search.functionErrorLabel") }}</b
                >
              </div>
            </td>
          </tr>
          <tr v-if="functionErrorMsg != '' && isFunctionErrorOpen">
            <td
              :colspan="columnOrder.length"
              style="opacity: 0.7"
              class="q-px-sm"
              :class="
                store.state.theme === 'dark'
                  ? 'tw:bg-yellow-600'
                  : 'tw:bg-amber-300'
              "
            >
              <pre>{{ functionErrorMsg }}</pre>
            </td>
          </tr>
        </thead>
        <!-- tw:relative is only needed for virtual-scroll absolute rows (logs/traces).
          In dashboard mode (regular DOM rows) it must be absent so that
          position:sticky on <thead> works correctly. -->
        <tbody
          data-test="o2-table-body"
          ref="tableBodyRef"
          :class="{ 'tw:relative': useVirtualScroll && !showPagination }"
        >
          <!-- ── Dashboard: regular DOM rows (no virtual scroll) ──────────────── -->
          <!-- Used when `data` prop is present (dashboard mode) OR pagination is
            enabled. Virtual scroll (below) is only for logs/traces. -->
          <template v-if="showPagination || !useVirtualScroll">
            <!-- Top spacer for dashboard virtual scroll -->
            <tr
              v-if="dashVirtualEnabled && dashVirtualPaddingTop > 0"
              aria-hidden="true"
            >
              <td
                :colspan="columnOrder.length"
                :style="{
                  height: dashVirtualPaddingTop + 'px',
                  padding: 0,
                  border: 'none',
                }"
              />
            </tr>
            <tr
              v-for="{ row, idx } in renderedDashboardRows"
              :key="row.id"
              :data-index="idx"
              :ref="(node: any) => measureDashboardRow(node)"
              class="dashboard-data-row tw:cursor-pointer hover:tw:bg-[var(--o2-hover-gray)]"
              :class="{ 'tw:border-b': !usesSeparateBorders }"
              data-test="dashboard-data-row"
              @click="handleDataRowClick(row.original, idx as number, $event)"
            >
              <td
                v-for="(cell, cellIndex) in row.getVisibleCells()"
                :key="cell.id"
                class="tw:py-1 tw:px-2 tw:overflow-hidden tw:relative table-cell copy-cell-td"
                :class="[
                  (cell.column.columnDef.meta as any)?.align === 'center'
                    ? 'tw:text-center!'
                    : '',
                  (cell.column.columnDef.meta as any)?.align === 'right'
                    ? 'tw:text-right!'
                    : '',
                  (cell.column.columnDef.meta as any)?.cellClass ?? '',
                  {
                    'sticky-column': (cell.column.columnDef.meta as any)
                      ?.sticky,
                  },
                  {
                    'pivot-total-col':
                      stickyColTotals &&
                      (cell.column.columnDef.meta as any)?._isTotalColumn,
                  },
                  // In separate-border mode (pivot or sticky columns),
                  // <tr> borders don't render — apply the row border on <td>.
                  { 'tw:border-b': usesSeparateBorders },
                  isPivotMergeNoBorder(
                    row.original,
                    (cell.column.columnDef.meta as any)?._col,
                  )
                    ? 'pivot-no-border'
                    : '',
                ]"
                :style="[
                  {
                    width: `calc(var(--col-${sanitizeCssId(cell.column.columnDef.id)}-size) * 1px)`,
                    height: rowHeight ? rowHeight + 'px' : undefined,
                  },
                  props.getCellStyle?.(cell),
                  getStickyColumnStyle(
                    (cell.column.columnDef.meta as any)?._col,
                  ) as any,
                  getStickyTotalColumnStyle(
                    (cell.column.columnDef.meta as any)?._col,
                  ) as any,
                ]"
              >
                <template
                  v-if="
                    !isPivotMergeHidden(
                      row.original,
                      (cell.column.columnDef.meta as any)?._col,
                    )
                  "
                >
                  <div
                    class="tw:h-full tw:w-full tw:flex tw:items-center"
                    :class="[
                      (cell.column.columnDef.meta as any)?.align === 'center'
                        ? 'tw:justify-center!'
                        : '',
                      (cell.column.columnDef.meta as any)?.align === 'right'
                        ? 'tw:justify-end!'
                        : '',
                    ]"
                  >
                    <!-- Copy button LEFT (right-aligned) -->
                    <span
                      v-if="
                        enableCellCopy &&
                        (cell.column.columnDef.meta as any)?.align ===
                          'right' &&
                        shouldShowCopyButton(cell.getValue())
                      "
                      class="copy-btn q-mr-xs"
                    >
                      <OButton
                        variant="ghost"
                        size="icon-xs-sq"
                        @click.stop="
                          copyCellContent(
                            getCellDisplayValue(cell),
                            idx as number,
                            cell.column.id,
                          )
                        "
                      >
                        <q-icon
                          :name="
                            isCellCopied(idx as number, cell.column.id)
                              ? 'check'
                              : 'content_copy'
                          "
                          size="14px"
                        />
                      </OButton>
                    </span>
                    <!-- JSON field inline renderer -->
                    <JsonFieldRenderer
                      v-if="
                        (cell.column.columnDef.meta as any)?.showFieldAsJson
                      "
                      :value="cell.getValue()"
                    />
                    <!-- Default value with format fn -->
                    <span
                      v-else
                      :class="[
                        !props.wrap
                          ? 'tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap'
                          : '',
                        props.wrap ? 'tw:break-words' : '',
                      ]"
                    >
                      {{ getCellDisplayValue(cell) }}
                    </span>
                    <!-- Copy button RIGHT (left/center-aligned) -->
                    <span
                      v-if="
                        enableCellCopy &&
                        (cell.column.columnDef.meta as any)?.align !==
                          'right' &&
                        shouldShowCopyButton(cell.getValue())
                      "
                      class="copy-btn q-ml-xs"
                    >
                      <OButton
                        variant="ghost"
                        size="icon-xs-sq"
                        @click.stop="
                          copyCellContent(
                            getCellDisplayValue(cell),
                            idx as number,
                            cell.column.id,
                          )
                        "
                      >
                        <q-icon
                          :name="
                            isCellCopied(idx as number, cell.column.id)
                              ? 'check'
                              : 'content_copy'
                          "
                          size="14px"
                        />
                      </OButton>
                    </span>
                  </div>
                </template>
              </td>
            </tr>
            <!-- Bottom spacer for dashboard virtual scroll -->
            <tr
              v-if="dashVirtualEnabled && dashVirtualPaddingBottom > 0"
              aria-hidden="true"
            >
              <td
                :colspan="columnOrder.length"
                :style="{
                  height: dashVirtualPaddingBottom + 'px',
                  padding: 0,
                  border: 'none',
                }"
              />
            </tr>
          </template>

          <!-- ── Virtual scroll rows (logs / traces only — no `data` prop) ────── -->
          <template
            v-if="!showPagination && useVirtualScroll"
            v-for="virtualRow in virtualRows"
            :key="virtualRow.index"
          >
            <tr
              :data-test="`o2-table-detail-${
                (formattedRows[virtualRow.index]?.original as any)?.[
                  store.state.zoConfig.timestamp_column || '_timestamp'
                ]
              }`"
              :style="{
                transform: `translateY(${virtualRow.start + (isFirefox ? baseOffset : 0)}px)`,
                minWidth: '100%',
              }"
              :data-index="virtualRow.index"
              :data-expanded="
                formattedRows?.[virtualRow.index]?.original?.isExpandedRow
              "
              :ref="(node: any) => node && rowVirtualizer.measureElement(node)"
              class="tw:absolute tw:flex tw:w-max tw:items-center tw:justify-start tw:border-b tw:border-b-[var(--o2-tag-grey-1)] tw:cursor-pointer hover:tw:bg-[var(--o2-hover-gray)]"
              :class="[
                defaultColumns &&
                !wrap &&
                !(formattedRows[virtualRow.index]?.original as any)
                  ?.isExpandedRow
                  ? 'tw:table-row'
                  : 'tw:flex',
                (formattedRows[virtualRow.index]?.original as any)?.[
                  store.state.zoConfig.timestamp_column
                ] === highlightTimestamp &&
                !(formattedRows[virtualRow.index]?.original as any)
                  ?.isExpandedRow
                  ? store.state.theme === 'dark'
                    ? 'tw:bg-zinc-700'
                    : 'tw:bg-zinc-300'
                  : '',
                'table-row-hover',
                !(formattedRows[virtualRow.index]?.original as any)
                  ?.isExpandedRow
                  ? rowClass?.(formattedRows[virtualRow.index]?.original as any)
                  : undefined,
              ]"
              @click="
                !(formattedRows[virtualRow.index]?.original as any)
                  ?.isExpandedRow &&
                handleDataRowClick(
                  formattedRows[virtualRow.index]?.original,
                  virtualRow.index,
                  $event,
                )
              "
            >
              <!-- Status color line for entire row -->
              <div
                v-if="
                  enableStatusBar &&
                  !(formattedRows[virtualRow.index]?.original as any)
                    ?.isExpandedRow
                "
                class="tw:absolute tw:left-0 tw:inset-y-0 tw:w-1 tw:z-10"
                :style="{
                  backgroundColor: getRowStatusColor(
                    formattedRows[virtualRow.index]?.original,
                  ),
                }"
              />
              <td
                v-if="
                  enableRowExpand &&
                  (formattedRows[virtualRow.index]?.original as any)
                    ?.isExpandedRow
                "
                :colspan="columnOrder.length"
                :data-test="`o2-table-expanded-row-${virtualRow.index}`"
                class="tw:w-full tw:relative"
              >
                <slot
                  name="expanded-row"
                  :row="formattedRows[virtualRow.index - 1]?.original"
                  :index="calculateActualIndex(virtualRow.index - 1)"
                  :hide-field-options="hideExpandFieldOptions"
                />
              </td>
              <template v-else>
                <td
                  v-for="(cell, cellIndex) in formattedRows[
                    virtualRow.index
                  ].getVisibleCells()"
                  :key="cell.id"
                  :data-test="
                    'o2-table-column-' +
                    virtualRow.index +
                    '-' +
                    cell.column.columnDef.id
                  "
                  class="tw:py-none tw:px-2 tw:items-center tw:justify-start tw:relative table-cell copy-cell-td"
                  :class="[
                    ...tableCellClass,
                    { 'tw:pl-2': cellIndex === 0 },
                    (cell.column.columnDef.meta as any)?.align === 'center'
                      ? 'tw:justify-center! tw:text-center!'
                      : '',
                    (cell.column.columnDef.meta as any)?.align === 'right'
                      ? 'tw:justify-end! tw:text-right!'
                      : '',
                    (cell.column.columnDef.meta as any)?.cellClass ?? '',
                    {
                      'sticky-column': (cell.column.columnDef.meta as any)
                        ?.sticky,
                    },
                    {
                      'pivot-total-col':
                        stickyColTotals &&
                        (cell.column.columnDef.meta as any)?._isTotalColumn,
                    },
                    isPivotMergeNoBorder(
                      cell.row.original,
                      (cell.column.columnDef.meta as any)?._col,
                    )
                      ? 'pivot-no-border'
                      : '',
                  ]"
                  :style="[
                    {
                      width:
                        cell.column.columnDef.id !== 'source' ||
                        cell.column.columnDef.enableResizing
                          ? `calc(var(--col-${sanitizeCssId(cell.column.columnDef.id)}-size) * 1px)`
                          : wrap
                            ? width - 260 - 12 + 'px'
                            : 'auto',
                      height: wrap
                        ? 'stretch'
                        : rowHeight != null
                          ? (rowHeight ?? 28) + 'px'
                          : undefined,
                    },
                    props.getCellStyle?.(cell),
                    getStickyColumnStyle(
                      (cell.column.columnDef.meta as any)?._col,
                    ) as any,
                    getStickyTotalColumnStyle(
                      (cell.column.columnDef.meta as any)?._col,
                    ) as any,
                  ]"
                  @mouseover="handleCellMouseOver(cell)"
                  @mouseleave="handleCellMouseLeave()"
                >
                  <div
                    class="tw:h-full tw:w-full tw:flex tw:items-center"
                    :class="[
                      (cell.column.columnDef.meta as any)?.align === 'center'
                        ? 'tw:justify-center! tw:text-center!'
                        : '',
                      (cell.column.columnDef.meta as any)?.align === 'right'
                        ? 'tw:justify-end! tw:text-right!'
                        : '',
                    ]"
                  >
                    <OButton
                      v-if="enableRowExpand && cellIndex == 0"
                      variant="ghost"
                      size="icon-xs-sq"
                      class="q-mr-xs"
                      data-test="table-row-expand-menu"
                      @click.capture.stop="handleExpandRow(virtualRow.index)"
                    >
                      <q-icon
                        :name="
                          expandedRowIndices.has(virtualRow.index)
                            ? 'expand_more'
                            : 'chevron_right'
                        "
                        size="14px"
                      />
                    </OButton>
                    <slot
                      name="cell-actions"
                      :row="cell.row.original"
                      :column="cell.column"
                      :active="
                        activeCellActionId === `${cell.id}_${cell.column.id}`
                      "
                    />
                    <!-- If column.meta.slot is set, delegate to the named cell slot -->
                    <slot
                      v-if="(cell.column.columnDef.meta as any)?.slot"
                      :name="`cell-${cell.column.id}`"
                      :item="cell.row.original"
                      :cell="cell"
                    />
                    <!-- Otherwise render the default cell content inline -->
                    <template v-else>
                      <!-- Pivot merge: skip content for hidden (merged) cells -->
                      <template
                        v-if="
                          !isPivotMergeHidden(
                            cell.row.original,
                            (cell.column.columnDef.meta as any)?._col,
                          )
                        "
                      >
                        <!-- Dashboard: copy button LEFT (right-aligned columns) -->
                        <span
                          v-if="
                            enableCellCopy &&
                            (cell.column.columnDef.meta as any)?.align ===
                              'right' &&
                            shouldShowCopyButton(cell.getValue())
                          "
                          class="copy-btn q-mr-xs"
                        >
                          <OButton
                            variant="ghost"
                            size="icon-xs-sq"
                            @click.stop="
                              copyCellContent(
                                getCellDisplayValue(cell),
                                virtualRow.index,
                                cell.column.id,
                              )
                            "
                          >
                            <q-icon
                              :name="
                                isCellCopied(virtualRow.index, cell.column.id)
                                  ? 'check'
                                  : 'content_copy'
                              "
                              size="14px"
                            />
                          </OButton>
                        </span>
                        <!-- Dashboard: JSON field inline renderer -->
                        <JsonFieldRenderer
                          v-if="
                            (cell.column.columnDef.meta as any)?.showFieldAsJson
                          "
                          :value="cell.getValue()"
                        />
                        <!-- Logs: FTS-highlighted text -->
                        <span
                          v-else-if="
                            processedResults[
                              `${cell.column.id}_${calculateActualIndex(virtualRow.index)}`
                            ]
                          "
                          :key="`${cell.column.id}_${calculateActualIndex(virtualRow.index)}`"
                          :class="store.state.theme === 'dark' ? 'dark' : ''"
                          v-html="
                            processedResults[
                              `${cell.column.id}_${calculateActualIndex(virtualRow.index)}`
                            ]
                          "
                        />
                        <!-- Default value (dashboard: format fn; logs: renderValue) -->
                        <span
                          :style="{
                            width:
                              cell.column.columnDef.id !== 'source' ||
                              cell.column.columnDef.enableResizing
                                ? `calc((var(--col-${sanitizeCssId(cell.column.columnDef.id)}-size) * 1px) - 0.5rem)`
                                : wrap
                                  ? width - 260 - 12 + 'px'
                                  : 'auto',
                          }"
                          :class="[
                            !props.wrap
                              ? 'tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap'
                              : '',
                            props.wrap ? 'tw:break-words' : '',
                          ]"
                          v-else
                        >
                          {{ getCellDisplayValue(cell) }}
                        </span>
                        <!-- Logs: AI context button -->
                        <O2AIContextAddBtn
                          v-if="
                            enableAiContextButton &&
                            cell.column.columnDef.id ===
                              store.state.zoConfig.timestamp_column
                          "
                          class="tw:absolute tw:right-0 tw:top-1/2 tw:transform tw:invisible tw:-translate-y-1/2 tw:-translate-x-1/2 ai-btn"
                          @send-to-ai-chat="
                            sendToAiChat(
                              JSON.stringify(cell.row.original),
                              true,
                            )
                          "
                        />
                        <!-- Dashboard: copy button RIGHT (left/center-aligned) -->
                        <span
                          v-if="
                            enableCellCopy &&
                            (cell.column.columnDef.meta as any)?.align !==
                              'right' &&
                            shouldShowCopyButton(cell.getValue())
                          "
                          class="copy-btn q-ml-xs"
                        >
                          <OButton
                            variant="ghost"
                            size="icon-xs-sq"
                            @click.stop="
                              copyCellContent(
                                getCellDisplayValue(cell),
                                virtualRow.index,
                                cell.column.id,
                              )
                            "
                          >
                            <q-icon
                              :name="
                                isCellCopied(virtualRow.index, cell.column.id)
                                  ? 'check'
                                  : 'content_copy'
                              "
                              size="14px"
                            />
                          </OButton>
                        </span>
                      </template>
                    </template>
                  </div>
                </td>
              </template>
            </tr>
          </template>
          <!-- Empty slot: shown when rows is empty and not loading -->
          <tr v-if="!loading && tableRows.length === 0" class="tw:w-full">
            <td :colspan="columnOrder.length">
              <slot name="empty" />
            </td>
          </tr>
        </tbody>

        <!-- ── Dashboard: sticky grand-total row ──────────────────────────────── -->
        <tfoot
          v-if="stickyTotalRow"
          style="
            position: sticky;
            bottom: 0;
            z-index: 10;
            box-shadow: 0 -2px 4px rgba(0, 0, 0, 0.1);
          "
        >
          <tr class="pivot-total-row pivot-sticky-total-row">
            <td
              v-for="col in (columns as any[]) || []"
              :key="'ft_' + col.name"
              class="tw:px-2"
              :class="[
                col.align === 'right'
                  ? 'tw:text-right'
                  : col.align === 'center'
                    ? 'tw:text-center'
                    : 'tw:text-left',
                { 'sticky-column': col.sticky },
                { 'pivot-total-col': stickyColTotals && col._isTotalColumn },
              ]"
              :style="
                [
                  getStickyTotalColumnStyle(col),
                  getStickyColumnStyle(col),
                ] as any
              "
            >
              {{
                stickyTotalRow[col.field] === undefined ||
                stickyTotalRow[col.field] === null
                  ? ""
                  : col.format
                    ? col.format(stickyTotalRow[col.field], stickyTotalRow)
                    : stickyTotalRow[col.field]
              }}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
    <!-- end scroll container -->

    <!-- ── Bottom slot: pagination footer or custom footer ──── -->
    <!-- Lives OUTSIDE the scroll container so it's always visible -->
    <template v-if="$slots.bottom">
      <slot
        name="bottom"
        :setRowsPerPage="
          (val: number) => {
            localRowsPerPage = val;
            currentPage = 1;
          }
        "
        :paginationOptions="paginationOptions"
        :totalRows="tableRows.length"
        :pagination="{ rowsPerPage: localRowsPerPage, page: currentPage }"
        :pagesNumber="pagesNumber"
        :isFirstPage="currentPage === 1"
        :isLastPage="currentPage >= pagesNumber"
        :firstPage="() => (currentPage = 1)"
        :prevPage="() => (currentPage = Math.max(1, currentPage - 1))"
        :nextPage="
          () => {
            currentPage = Math.min(pagesNumber, currentPage + 1);
          }
        "
        :lastPage="
          () => {
            currentPage = pagesNumber;
          }
        "
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  shallowRef,
  computed,
  watch,
  nextTick,
  onMounted,
  onBeforeUnmount,
  ComputedRef,
} from "vue";
import type { PropType } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import {
  FlexRender,
  type ColumnDef,
  type SortingState,
  useVueTable,
  getCoreRowModel,
  getSortedRowModel,
} from "@tanstack/vue-table";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { VueDraggableNext as VueDraggable } from "vue-draggable-next";
import { debounce, copyToClipboard } from "quasar";
import O2AIContextAddBtn from "@/components/common/O2AIContextAddBtn.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { extractStatusFromLog } from "@/utils/logs/statusParser";
import { useTextHighlighter } from "@/composables/useTextHighlighter";
import { useLogsHighlighter } from "@/composables/useLogsHighlighter";
// ── Dashboard additions ──────────────────────────────────────────────────────
import { useStickyColumns } from "@/composables/useStickyColumns";
import {
  TABLE_ROWS_PER_PAGE_DEFAULT_VALUE,
  PIVOT_TABLE_TOTAL_COLUMN_WIDTH,
  PIVOT_TABLE_ROW_KEY_SEPARATOR,
} from "@/utils/dashboard/constants";
import JsonFieldRenderer from "@/components/dashboards/panels/JsonFieldRenderer.vue";

export interface StreamField {
  name: string;
  isSchemaField: boolean;
}

const props = defineProps({
  rows: {
    type: Array,
    default: () => [],
  },
  columns: {
    type: Array,
    default: () => [],
  },
  wrap: {
    type: Boolean,
    default: false,
  },
  width: {
    type: Number,
    default: 56,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  errMsg: {
    type: String,
    default: "",
  },
  functionErrorMsg: {
    type: String,
    default: "",
  },
  expandedRows: {
    type: Array,
    default: () => [],
  },
  highlightTimestamp: {
    type: Number,
    default: -1,
  },
  defaultColumns: {
    type: Boolean,
    default: () => true,
  },
  highlightQuery: {
    type: String,
    default: "",
    required: false,
  },
  selectedStreamFtsKeys: {
    type: Array as PropType<StreamField[]>,
    default: () => [],
  },
  hideExpandFieldOptions: {
    type: Boolean,
    default: false,
  },
  // ── Generic / traces props ───────────────────────────────────────────────
  /** Active sort backend field name (server-side sort mode). When provided,
   *  sortable column headers emit 'sort-change' instead of sorting client-side. */
  sortBy: {
    type: String as PropType<string | undefined>,
    default: undefined,
  },
  /** Active sort direction for server-side sort mode. */
  sortOrder: {
    type: String as PropType<"asc" | "desc" | undefined>,
    default: undefined,
  },
  /** Maps column id → backend field name for server-side sort.
   *  E.g. { timestamp: 'start_time', duration: 'duration' } */
  sortFieldMap: {
    type: Object as PropType<Record<string, string> | undefined>,
    default: undefined,
  },
  /** Returns Quasar/Tailwind class(es) for a given row.
   *  Use 'oz-table__row--error' to trigger the red left-border error variant. */
  rowClass: {
    type: Function as PropType<
      (row: any) => string | string[] | Record<string, boolean> | undefined
    >,
    default: undefined,
  },
  /** Fixed row height in px used by the virtualizer.
   *  When set, all rows use this fixed height and dynamic measurement is disabled. */
  rowHeight: {
    type: Number as PropType<number>,
    default: 22,
  },
  // ── Feature flags (all default true → current logs behavior unchanged) ──
  /** Show VueDraggable column reorder in header. Default: true */
  enableColumnReorder: {
    type: Boolean,
    default: true,
  },
  /** Show expand chevron and inline JSON row expansion. Default: true */
  enableRowExpand: {
    type: Boolean,
    default: true,
  },
  /** Run FTS text highlighting (processHitsInChunks). Default: true */
  enableTextHighlight: {
    type: Boolean,
    default: true,
  },
  /** Show left-side status color bar on each row. Default: true */
  enableStatusBar: {
    type: Boolean,
    default: true,
  },
  enableAiContextButton: {
    type: Boolean,
    default: true,
  },
  // ── Dashboard / TableRenderer parity props ───────────────────────────────
  /** When false, uses regular DOM rows (no virtual scroll). Set to false for dashboard/small-data tables.
   *  Default: true (virtual scroll mode for logs/traces). */
  useVirtualScroll: {
    type: Boolean,
    default: true,
  },
  /** Pivot multi-level header config produced by the dashboard pivot transformer. */
  pivotHeaderLevels: {
    type: Array,
    default: () => [],
  },
  /** Grand-total row pinned to the bottom of the table (dashboard pivot). */
  stickyTotalRow: {
    type: Object as PropType<any | null>,
    default: null,
  },
  /** Pin the grand-total row to the bottom of the scroll area. */
  stickyRowTotals: {
    type: Boolean,
    default: false,
  },
  /** Pin total columns to the right edge of the table. */
  stickyColTotals: {
    type: Boolean,
    default: false,
  },
  /** Optional function to compute inline style string for a cell.
   *  Use this to add cell background coloring from the parent.
   *  Returns empty string by default (no coloring). */
  getCellStyle: {
    type: Function as PropType<(cell: any) => string>,
    default: undefined,
  },
  /** Show per-cell copy-to-clipboard button on hover. Default: false */
  enableCellCopy: {
    type: Boolean,
    default: false,
  },
  /** Enable paginated mode (turns off virtual scroll). Default: false */
  showPagination: {
    type: Boolean,
    default: false,
  },
  /** Rows per page when `showPagination` is true. */
  rowsPerPage: {
    type: Number,
    default: TABLE_ROWS_PER_PAGE_DEFAULT_VALUE,
  },
});

const { t } = useI18n();

const emits = defineEmits([
  "closeColumn",
  "click:dataRow",
  "update:columnSizes",
  "update:columnOrder",
  "expandRow",
  "sendToAiChat",
  "sort-change",
]);

const sorting = ref<SortingState>([]);

/** Replace characters invalid in CSS custom property names (e.g. dots) with underscores. */
const sanitizeCssId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_");

const store = useStore();
const { isFTSColumn } = useTextHighlighter();
const { processedResults, processHitsInChunks } = useLogsHighlighter();

// ── Dashboard: sticky columns composable ─────────────────────────────────────
// useStickyColumns reads props.columns (Quasar-format when useVirtualScroll=false).
const { getStickyColumnStyle, tableId } = useStickyColumns(props, store);
const getSortingHandler = (e: Event, fn: any) => {
  return fn(e);
};

/** Handles header click. In server-side sort mode (sortBy prop provided),
 *  emits 'sort-change'. Otherwise falls back to TanStack client-side sort. */
const handleHeaderSortClick = (e: Event, column: any, toggleFn: any) => {
  if (props.sortBy !== undefined && column.columnDef.meta?.sortable) {
    const field = props.sortFieldMap?.[column.id] ?? column.id;
    const newOrder =
      field === props.sortBy
        ? props.sortOrder === "desc"
          ? "asc"
          : "desc"
        : "desc";
    emits("sort-change", field, newOrder);
  } else {
    getSortingHandler(e, toggleFn);
  }
};

const setSorting = (sortingUpdater: any) => {
  const newSortVal = sortingUpdater(sorting.value);

  sorting.value = newSortVal;
};

const tableBodyRef = ref<any>(null);

const columnResizeMode = "onChange";

const tableRowSize = ref(0);

const columnOrder = ref<any>([]);

const tableRows = shallowRef<any[]>([...(props.rows ?? [])]);

// ── Dashboard: convert Quasar column defs → TanStack ColumnDef[] ─────────────
const dashboardColumns = computed<ColumnDef<unknown, any>[] | null>(() => {
  if (props.useVirtualScroll || !props.columns) return null;
  return (props.columns as any[])
    .filter((col: any) => col.name != null && String(col.name) !== "")
    .map((col: any) => ({
      // Use col.field as the unique TanStack ID instead of col.name (display label).
      // Multiple dashboard columns can share the same label (e.g. both named "Timestamp"),
      // but each has a distinct field key (e.g. "x_axis_1" vs "y_axis_1").
      // TanStack stores columns in a Map keyed by id; duplicate ids cause the last column
      // to overwrite earlier ones, so row.getValue(id) returns the wrong accessor for every
      // cell sharing that id — the format function then receives the wrong raw value.
      id: String(col.field ?? col.name),
      header: String(col.label ?? col.name),
      ...(typeof col.field === "function"
        ? { accessorFn: col.field }
        : { accessorKey: String(col.field ?? col.name) }),
      meta: {
        align: col.align,
        format: col.format,
        sticky: col.sticky,
        colorMode: col.colorMode,
        showFieldAsJson: col.showFieldAsJson,
        _isRowField: col._isRowField,
        _isTotalColumn: col._isTotalColumn,
        _totalColRightIndex: col._totalColRightIndex,
        _col: col, // reference to original Quasar column for style helpers
        sortable: col.sortable, // mirrors Quasar column flag — drives sort icon visibility
      },
    }));
});

// ── Dashboard: pivot helpers ─────────────────────────────────────────────────
const pivotHeaderLevels = computed(() => props.pivotHeaderLevels || []);
const pivotRowColumns = computed(() =>
  ((props.columns as any[]) || []).filter((c: any) => c._isRowField),
);
const stickyRowTotals = computed(() => !!props.stickyRowTotals);
const stickyColTotals = computed(() => !!props.stickyColTotals);
const stickyTotalRow = computed(() => props.stickyTotalRow || null);
const isPivotMode = computed(() => pivotHeaderLevels.value.length > 0);
// Any table with left-sticky columns needs border-collapse:separate so that
// adjacent cells don't paint over the sticky cell's box-shadow.
const hasStickyColumns = computed(() =>
  ((props.columns as any[]) || []).some((c: any) => c.sticky),
);
const usesSeparateBorders = computed(
  () => isPivotMode.value || hasStickyColumns.value,
);

// Dashboard virtual scroll: enabled when not using logs virtual scroll and not paginated.
// Uses spacer rows + @tanstack/vue-virtual to render only visible rows (matching
// the old Quasar QTable :virtual-scroll behaviour).
// Disabled when `wrap` is true — wrapped rows have highly variable heights
// (29-81px) that cause large total-height jumps during scroll, which manifests
// as visible flicker. Rendering all rows in DOM is acceptable for dashboard
// panels (typically ≤1000 rows).
const dashVirtualEnabled = computed(
  () => !props.useVirtualScroll && !props.showPagination && !props.wrap,
);

// Pivot sort state (managed manually — TanStack sort is disabled for pivot).
const pivotSortState = ref<{ sortBy: string; descending: boolean }>({
  sortBy: "",
  descending: false,
});
const handlePivotSort = (field: string) => {
  if (pivotSortState.value.sortBy === field) {
    pivotSortState.value = {
      ...pivotSortState.value,
      descending: !pivotSortState.value.descending,
    };
  } else {
    pivotSortState.value = { sortBy: field, descending: false };
  }
};

// Re-sort pivot rows whenever sort state changes.
// Use serialized watch source to avoid deep comparison overhead.
watch(
  () => `${pivotSortState.value.sortBy}_${pivotSortState.value.descending}`,
  () => {
    if (!isPivotMode.value) return;
    const rows = ((props.rows as any[]) || []).filter(
      (r: any) => !r.__isTotalRow,
    );
    const { sortBy, descending } = pivotSortState.value;
    if (!sortBy) {
      tableRows.value = [...rows];
      return;
    }
    const col = ((props.columns as any[]) || []).find(
      (c: any) => c.name === sortBy,
    );
    tableRows.value = [...rows].sort((a: any, b: any) => {
      const va = a[sortBy];
      const vb = b[sortBy];
      let result: number;
      if (col?.sort) result = col.sort(va, vb, a, b);
      else if (typeof va === "number" && typeof vb === "number")
        result = va - vb;
      else result = String(va ?? "").localeCompare(String(vb ?? ""));
      return descending ? -result : result;
    });
  },
);

// ── Dashboard: pivot merge map ───────────────────────────────────────────────
const pivotMergeMap = computed(() => {
  const map = new Map<
    string,
    Record<string, { hideContent: boolean; hideBorder: boolean }>
  >();
  const rowCols = pivotRowColumns.value;
  if (rowCols.length === 0) return map;
  const rows = tableRows.value.filter((r: any) => !r.__isTotalRow);
  if (rows.length === 0) return map;

  const getRowKey = (row: any) =>
    rowCols
      .map((c: any) => String(row[c.name] ?? ""))
      .join(PIVOT_TABLE_ROW_KEY_SEPARATOR);

  for (let colIdx = 0; colIdx < rowCols.length; colIdx++) {
    const col = rowCols[colIdx];
    let groupStart = 0;
    for (let i = 0; i <= rows.length; i++) {
      let sameGroup = i < rows.length;
      if (sameGroup) {
        for (let p = 0; p <= colIdx; p++) {
          if (rows[i][rowCols[p].name] !== rows[groupStart][rowCols[p].name]) {
            sameGroup = false;
            break;
          }
        }
      }
      if (!sameGroup) {
        const size = i - groupStart;
        if (size > 1) {
          for (let r = groupStart; r < i; r++) {
            const key = getRowKey(rows[r]);
            if (!map.has(key)) map.set(key, {});
            map.get(key)![col.name] = {
              hideContent: r !== groupStart,
              hideBorder: r < i - 1,
            };
          }
        }
        groupStart = i;
      }
    }
  }
  return map;
});

const pivotRowKey = (row: any) =>
  pivotRowColumns.value
    .map((c: any) => String(row[c.name] ?? ""))
    .join(PIVOT_TABLE_ROW_KEY_SEPARATOR);

const isPivotMergeHidden = (row: any, col: any): boolean => {
  if (!col?._isRowField) return false;
  return (
    pivotMergeMap.value.get(pivotRowKey(row))?.[col.name]?.hideContent === true
  );
};
const isPivotMergeNoBorder = (row: any, col: any): boolean => {
  if (!col?._isRowField) return false;
  return (
    pivotMergeMap.value.get(pivotRowKey(row))?.[col.name]?.hideBorder === true
  );
};

// ── Dashboard: sticky total columns ─────────────────────────────────────────
const getStickyTotalColumnStyle = (col: any) => {
  if (!stickyColTotals.value || !col?._isTotalColumn) return {};
  const rightOffset =
    (col._totalColRightIndex ?? 0) * PIVOT_TABLE_TOTAL_COLUMN_WIDTH;
  const style = {
    position: "sticky",
    right: `${rightOffset}px`,
    "z-index": 2,
    width: `${PIVOT_TABLE_TOTAL_COLUMN_WIDTH}px`,
    "min-width": `${PIVOT_TABLE_TOTAL_COLUMN_WIDTH}px`,
    "max-width": `${PIVOT_TABLE_TOTAL_COLUMN_WIDTH}px`,
    "background-color": store.state.theme === "dark" ? "#565656" : "#E0E0E0",
    "box-shadow": "-4px 0 8px rgba(0, 0, 0, 0.15)",
    "white-space": "normal",
    "word-break": "break-word",
  };
  return style;
};

const getStickyTotalHeaderForPivot = (cell: any) => {
  if (!stickyColTotals.value) return {};
  const rightOffset =
    (cell._totalColRightIndex ?? 0) * PIVOT_TABLE_TOTAL_COLUMN_WIDTH;
  const width = cell.colspan
    ? cell.colspan * PIVOT_TABLE_TOTAL_COLUMN_WIDTH
    : PIVOT_TABLE_TOTAL_COLUMN_WIDTH;
  const style = {
    position: "sticky",
    right: `${rightOffset}px`,
    top: 0,
    "z-index": 11,
    width: `${width}px`,
    "min-width": `${width}px`,
    "max-width": `${width}px`,
    // Opaque background so scrolled body content doesn't bleed through
    "background-color": "inherit",
    "box-shadow": "-4px 0 8px rgba(0, 0, 0, 0.15)",
    "white-space": "normal",
    "word-break": "break-word",
    // Remove border so shadow aligns with body total column
    border: "none",
  };
  return style;
};

const getCellDisplayValue = (cell: any): any => {
  const value = cell.getValue();
  const format = (cell.column.columnDef.meta as any)?.format;
  // If a format function is defined (dashboard mode), always call it — this allows
  // no_value_replacement to be applied even when the raw cell value is null/undefined.
  if (value === "undefined" || value === null || value === undefined) {
    return format ? format(null, cell.row.original) : "";
  }
  return format ? format(value, cell.row.original) : value;
};

// ── Dashboard: cell copy ─────────────────────────────────────────────────────
const copiedCells = ref(new Map<string, boolean>());

const isCellCopied = (rowIndex: number, colName: string) =>
  copiedCells.value.has(`${rowIndex}_${colName}`);

const shouldShowCopyButton = (value: any) => {
  if (value === null || value === undefined || value === "undefined")
    return false;
  return String(value).trim() !== "";
};

const copyCellContent = (value: any, rowIndex: number, colName: string) => {
  if (value === null || value === undefined) return;
  copyToClipboard(String(value))
    .then(() => {
      const key = `${rowIndex}_${colName}`;
      copiedCells.value.set(key, true);
      setTimeout(() => copiedCells.value.delete(key), 3000);
    })
    .catch(() => {});
};

// ── Dashboard: pagination ────────────────────────────────────────────────────
const currentPage = ref(1);
const localRowsPerPage = ref(
  props.showPagination
    ? props.rowsPerPage || TABLE_ROWS_PER_PAGE_DEFAULT_VALUE
    : 0,
);

watch(
  () => [props.showPagination, props.rowsPerPage] as const,
  ([newShow, newRpp]) => {
    localRowsPerPage.value = newShow
      ? newRpp || TABLE_ROWS_PER_PAGE_DEFAULT_VALUE
      : 0;
    currentPage.value = 1;
  },
);

const paginationOptions = computed(() => {
  if (!props.showPagination) return [0];
  const base = [10, 20, 50, 100, 250, 500, 1000];
  const configured = props.rowsPerPage || TABLE_ROWS_PER_PAGE_DEFAULT_VALUE;
  const set = new Set(base);
  if (configured > 0) set.add(configured);
  const sorted = Array.from(set).sort((a, b) => a - b);
  sorted.push(0);
  return sorted;
});

const pagesNumber = computed(() =>
  localRowsPerPage.value === 0
    ? 1
    : Math.ceil(tableRows.value.length / localRowsPerPage.value) || 1,
);

// pagedRows is defined after formattedRows below — see declaration near virtualizer.

const selectedStreamFtsKeys: ComputedRef<StreamField[]> = computed(() => {
  return props.selectedStreamFtsKeys || [];
});

const isFunctionErrorOpen = ref(false);

const activeCellActionId = ref("");

const highlightQuery = computed(() => {
  return props.highlightQuery;
});

const getRowStatusColor = (rowData: any) => {
  const statusInfo = extractStatusFromLog(rowData);
  return statusInfo.color;
};

watch(
  () => props.columns,
  async (newVal) => {
    columnOrder.value = newVal.map((column: any) => column.id ?? column.name);

    await nextTick();

    if (
      props.enableTextHighlight &&
      props.columns?.length &&
      props.rows?.length
    ) {
      processHitsInChunks(
        props.rows,
        props.columns,
        true,
        props.highlightQuery,
        100,
        selectedStreamFtsKeys.value as unknown as string[],
      );
    }

    // updateTableWidth is only needed for logs/traces auto-sizing
    if (props.defaultColumns && props.useVirtualScroll) updateTableWidth();
  },
  {
    immediate: true,
  },
);

watch(
  () => props.rows,
  async (newVal) => {
    if (!newVal) return;

    // Filter out total rows (dashboard pivot); no-op for logs/traces
    const rows = (newVal as any[]).filter((r: any) => !r.__isTotalRow);

    // Apply pivot sort when active, otherwise just assign.
    // For pivot mode we need a copy to sort in-place; for dashboard mode
    // the parent (TableRenderer) already provides a fresh sorted array,
    // so we can assign directly to avoid an unnecessary O(n) copy.
    const { sortBy, descending } = pivotSortState.value;
    if (isPivotMode.value && sortBy) {
      const col = ((props.columns as any[]) || []).find(
        (c: any) => c.name === sortBy || c.id === sortBy,
      );
      tableRows.value = [...rows].sort((a: any, b: any) => {
        const va = a[sortBy];
        const vb = b[sortBy];
        let result: number;
        if (col?.sort) result = col.sort(va, vb, a, b);
        else if (typeof va === "number" && typeof vb === "number")
          result = va - vb;
        else result = String(va ?? "").localeCompare(String(vb ?? ""));
        return descending ? -result : result;
      });
    } else if (props.useVirtualScroll) {
      // Logs/traces: copy so expand-row splices don't mutate parent data
      tableRows.value = [...rows];
    } else {
      // Dashboard: parent already provides a fresh reference
      tableRows.value = rows as any[];
    }

    await nextTick();

    if (
      props.enableTextHighlight &&
      props.columns?.length &&
      props.rows?.length
    ) {
      processHitsInChunks(
        props.rows,
        props.columns,
        false,
        props.highlightQuery,
        100,
        selectedStreamFtsKeys.value as unknown as string[],
      );
    }

    expandedRowIndices.value.clear();
    // Clear height cache when rows change
    expandedRowHeights.value = {};
    // Clear actual index cache when rows change
    actualIndexCache.value.clear();
    setExpandedRows();

    await nextTick();
    // updateTableWidth is only needed for logs/traces auto-sizing (defaultColumns + virtual scroll)
    if (props.defaultColumns && props.useVirtualScroll) updateTableWidth();
  },
);

let table: any = useVueTable({
  get data() {
    return tableRows.value || [];
  },
  get columns() {
    // Dashboard: use converted TanStack columns; Logs: use columns prop as-is.
    return (dashboardColumns.value ?? props.columns) as ColumnDef<
      unknown,
      any
    >[];
  },
  state: {
    get sorting() {
      return sorting.value;
    },
    get columnOrder() {
      return columnOrder.value;
    },
  },
  onSortingChange: setSorting,
  // Disable TanStack client sort for pivot (rows are pre-sorted manually)
  // and for dashboard mode (TableRenderer handles sorting externally).
  get enableSorting() {
    return !isPivotMode.value && props.useVirtualScroll;
  },
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  defaultColumn: {
    minSize: 60,
    maxSize: 800,
  },
  columnResizeMode,
  enableColumnResizing: true,
});

const columnSizeVars = computed(() => {
  const headers = table?.getFlatHeaders();
  const colSizes: { [key: string]: number } = {};
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]!;
    colSizes[`--header-${sanitizeCssId(header.id)}-size`] = header.getSize();
    colSizes[`--col-${sanitizeCssId(header.column.id)}-size`] =
      header.column.getSize();
  }
  return colSizes;
});

/** Maps sanitized column id → original column id for all current columns. */
const columnIdMap = computed(() => {
  const map: Record<string, string> = {};
  const headers = table?.getFlatHeaders() ?? [];
  for (const header of headers) {
    map[sanitizeCssId(header.column.id)] = header.column.id;
  }
  return map;
});

watch(columnSizeVars, (newColSizes) => {
  debouncedUpdate(newColSizes, columnIdMap.value);
});

onMounted(() => {
  setExpandedRows();
});

onBeforeUnmount(() => {
  tableRows.value.length = 0;
  tableRows.value = [];
  tableBodyRef.value = null;
  parentRef.value = null;
  table = null;
});

const hasDefaultSourceColumn = computed(
  () => props.defaultColumns && columnOrder.value.includes("source"),
);

const tableCellClass = ref<string[]>([]);

watch(
  () => [hasDefaultSourceColumn.value, props.wrap],
  () => {
    tableCellClass.value = [
      hasDefaultSourceColumn.value && !props.wrap
        ? "tw:table-cell"
        : "tw:block height-stretch",
      !props.wrap
        ? "tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap"
        : "",
      props.wrap ? "tw:break-words" : "",
    ];
  },
  {
    immediate: true,
  },
);

const updateTableWidth = async () => {
  tableRowSize.value = tableBodyRef?.value?.children[0]?.scrollWidth;

  setTimeout(() => {
    let max = 0;
    let width = max;
    for (let i = 0; i < tableRows.value.length; i++) {
      width = tableBodyRef?.value?.children[i]?.scrollWidth;
      if (width > max) max = width;
    }
    tableRowSize.value = max;
  }, 0);
};

const debouncedUpdate = debounce((newColSizes, idMap) => {
  emits("update:columnSizes", newColSizes, idMap);
}, 500);

const formattedRows = computed(() => {
  return table?.getRowModel().rows;
});

/** Stable primitive count for the virtualizer.
 *  Vue skips downstream notifications when a computed returns the same
 *  primitive value — so `rowVirtualizerOptions` won't re-evaluate (and
 *  `_willUpdate` / ResizeObserver won't re-fire) when `formattedRows`
 *  gets a new array reference with the same length. */
const rowCount = computed(() => formattedRows.value?.length ?? 0);

/** Rows for current page (dashboard).
 *  When pagination is enabled, slices by page. Otherwise returns all rows —
 *  dashboard virtual scroll handles limiting rendered DOM nodes. */
const pagedRows = computed(() => {
  const all = formattedRows.value ?? [];
  if (props.showPagination && localRowsPerPage.value > 0) {
    const start = (currentPage.value - 1) * localRowsPerPage.value;
    return all.slice(start, start + localRowsPerPage.value);
  }
  return all;
});

const isResizingHeader = ref(false);

const headerGroups = computed(() => table?.getHeaderGroups()[0]);

const headers = computed(() => headerGroups.value.headers);

watch(
  () => headers.value,
  (newVal) => {
    isResizingHeader.value = newVal.some((header: any) =>
      header.column.getIsResizing(),
    );
  },
  {
    deep: true,
  },
);

const parentRef = ref<HTMLElement | null>(null);

const isFirefox = computed(() => {
  return (
    typeof document !== "undefined" &&
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("-moz-appearance", "none")
  );
});

const baseOffset = isFirefox.value ? 20 : 0;

// Cache for expanded row heights
const expandedRowHeights = ref<{ [key: number]: number }>({});

/** Custom observeElementRect that avoids layout-thrashing during Vue's synchronous flush.
 *  The default TanStack Virtual implementation calls `offsetWidth`/`offsetHeight`
 *  synchronously during init, which forces a full layout recalculation for each of
 *  the 21 dashboard table virtualizers (792ms forced reflow).  Using ResizeObserver
 *  only batches all measurements into a single async callback after mount. */
const deferredObserveElementRect = (
  instance: any,
  cb: (rect: { width: number; height: number }) => void,
) => {
  const element = instance.scrollElement;
  if (!element) return;

  // Use the actual element dimensions for the initial estimate so the
  // virtualizer renders the correct number of rows on first paint.
  // Falling back to 800×300 only if layout hasn't been resolved yet.
  const initialRect = element.getBoundingClientRect();
  cb({
    width: Math.round(initialRect.width) || 800,
    height: Math.round(initialRect.height) || 300,
  });

  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (entry?.borderBoxSize?.[0]) {
      const box = entry.borderBoxSize[0];
      cb({
        width: Math.round(box.inlineSize),
        height: Math.round(box.blockSize),
      });
    } else if (entry) {
      cb({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      });
    }
  });
  observer.observe(element, { box: "border-box" });
  return () => observer.unobserve(element);
};

const rowVirtualizerOptions = computed(() => {
  const isDashVirtual = dashVirtualEnabled.value;
  // All non-logs tables (paginated + non-paginated dashboard panels)
  const isNonLogs = !props.useVirtualScroll;
  return {
    count: rowCount.value,
    getScrollElement: () => parentRef.value,
    estimateSize: (index: number) => {
      // Dashboard virtual scroll: always use 28px regardless of rowHeight prop.
      // The rowHeight prop (default 22) is the *cell content* height and does not
      // account for padding (py-1 = 8px) + border (1px), so using it here would
      // cause a ~6px-per-row underestimate and a visible layout jump after measurement.
      if (isDashVirtual) return 28;
      if (props.rowHeight) return props.rowHeight;
      // Logs/traces: check for expanded rows
      const isExpandedRow = formattedRows.value[index]?.original?.isExpandedRow;
      return isExpandedRow ? expandedRowHeights.value[index] || 300 : 28;
    },
    // Dashboard: moderate overscan keeps rows buffered above/below viewport.
    // Logs/traces: high overscan for smooth fast-scroll.
    overscan: isDashVirtual ? 20 : 100,
    measureElement:
      // When rowHeight is provided, skip dynamic measurement entirely
      props.rowHeight && !isDashVirtual
        ? undefined
        : typeof window !== "undefined" && !isFirefox.value
          ? (element: any) => {
              const index = parseInt(element.dataset.index);
              if (isNaN(index)) return props.rowHeight ?? 28;
              // Dashboard: always measure so variable-height rows
              // (wrapping text, etc.) are accounted for.
              if (isDashVirtual) {
                return element.getBoundingClientRect().height;
              }
              // Logs/traces: only measure expanded or wrapped rows
              const isExpandedRow =
                formattedRows.value[index]?.original?.isExpandedRow;
              if (isExpandedRow || props.wrap) {
                const height = element.getBoundingClientRect().height;
                expandedRowHeights.value[index] = height;
                return height;
              }
              return props.rowHeight ?? 28; // Default height for collapsed rows
            }
          : undefined,
    // All dashboard tables: avoid layout-thrashing from sync getRect calls during Vue flush
    ...(isNonLogs ? { observeElementRect: deferredObserveElementRect } : {}),
    // All dashboard tables: skip unnecessary scrollTo(0) during init
    ...(isNonLogs
      ? {
          scrollToFn: (
            offset: number,
            opts: { adjustments?: number; behavior?: ScrollBehavior },
            instance: any,
          ) => {
            // Only scroll when the target offset is non-zero (user-initiated).
            // The virtualizer calls scrollTo(0) during _willUpdate init, which
            // forces a synchronous layout reflow — skip it entirely for freshly
            // mounted panels where scrollTop is already 0.
            const toOffset = offset + (opts.adjustments ?? 0);
            if (toOffset === 0) return;
            instance.scrollElement?.scrollTo({
              [instance.options.horizontal ? "left" : "top"]: toOffset,
              behavior: opts.behavior,
            });
          },
        }
      : {}),
  };
});

const rowVirtualizer = useVirtualizer(rowVirtualizerOptions);

/** Defers measureElement outside Vue's synchronous render flush to prevent
 *  recursive reactive update warnings. Called via :ref on dashboard rows. */
const measureDashboardRow = (node: any) => {
  if (node && dashVirtualEnabled.value) {
    queueMicrotask(() => rowVirtualizer.value.measureElement(node));
  }
};

const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems());

const totalSize = computed(
  () => rowVirtualizer.value.getTotalSize() + (props.rowHeight ?? 0),
);

// ── Dashboard virtual scroll: spacer row heights ─────────────────────────────
const dashVirtualPaddingTop = computed(() => {
  if (!dashVirtualEnabled.value) return 0;
  const items = virtualRows.value;
  return items.length > 0 ? items[0].start : 0;
});

const dashVirtualPaddingBottom = computed(() => {
  if (!dashVirtualEnabled.value) return 0;
  const items = virtualRows.value;
  if (items.length === 0) return 0;
  return rowVirtualizer.value.getTotalSize() - items[items.length - 1].end;
});

/** Unified row iterator for dashboard mode (both paginated and virtual scroll).
 *  Each item has `row` (TanStack Row) and `idx` (row index in the full dataset). */
const renderedDashboardRows = computed(() => {
  if (dashVirtualEnabled.value) {
    const items = virtualRows.value;
    const rows = formattedRows.value ?? [];
    return items
      .map((vi: any) => ({ row: rows[vi.index], idx: vi.index }))
      .filter((r: any) => r.row);
  }
  // Paginated mode: use TanStack's global row index so page 2+ emits correct position
  return (pagedRows.value ?? []).map((row: any) => ({
    row,
    idx: row.index,
  }));
});

const setExpandedRows = () => {
  props.expandedRows.forEach((index: any) => {
    const virtualIndex = calculateVirtualIndex(index);
    if (index < props.rows.length) {
      expandRow(virtualIndex as number);
    }
  });
  // Clear the actual index cache since expanded rows are changing
  actualIndexCache.value.clear();
};

const closeColumn = (data: any) => {
  emits("closeColumn", data);
};

const handleDragStart = (event: any) => {
  if (
    columnOrder.value[event.oldIndex] === store.state.zoConfig.timestamp_column
  ) {
    isResizingHeader.value = true;
  } else {
    isResizingHeader.value = false;
  }
};

const handleDragEnd = () => {
  emits("update:columnOrder", columnOrder.value, props.columns);
};

const expandedRowIndices = ref<Set<number>>(new Set());

const handleExpandRow = (index: number) => {
  // Calculate actual index BEFORE expanding (using current state)
  const actualIndex = calculateActualIndex(index);

  // Emit the event with the calculated actual index
  emits("expandRow", actualIndex);

  // Now expand the row (this modifies expandedRowIndices)
  expandRow(index);

  // Clear the actual index cache since expanded rows have changed
  actualIndexCache.value.clear();
};

const expandRow = async (index: number) => {
  let isCollapseOperation = false;

  if (expandedRowIndices.value.has(index)) {
    // COLLAPSE OPERATION
    expandedRowIndices.value.delete(index);

    // Clear cached height for collapsed row
    delete expandedRowHeights.value[index + 1];

    // Remove the expanded row from tableRows
    tableRows.value.splice(index + 1, 1);
    isCollapseOperation = true;

    // Update all expanded indices that come after this collapsed row
    const updatedIndices = new Set<number>();
    expandedRowIndices.value.forEach((i) => {
      updatedIndices.add(i > index ? i - 1 : i);
    });
    expandedRowIndices.value = updatedIndices;
  } else {
    // EXPAND OPERATION
    // First, update all expanded indices that come at or after this position
    const updatedIndices = new Set<number>();
    expandedRowIndices.value.forEach((i) => {
      updatedIndices.add(i >= index ? i + 1 : i);
    });

    // Add the new expanded index
    updatedIndices.add(index);
    expandedRowIndices.value = updatedIndices;

    // Insert the expanded row
    tableRows.value.splice(index + 1, 0, {
      isExpandedRow: true,
      ...(props.rows[index] as {}),
    });
  }

  tableRows.value = [...tableRows.value];

  await nextTick();

  if (isCollapseOperation) {
    expandedRowIndices.value.forEach((expandedIndex) => {
      if (expandedIndex !== -1) {
        formattedRows.value[expandedIndex].toggleExpanded();
      }
    });
  } else {
    // For expand operation, measure height after DOM update
    await nextTick();

    // Force the virtualizer to recalculate all sizes
    if (rowVirtualizer.value) {
      // Find the actual expanded row element
      const expandedElement = document.querySelector(
        `[data-index="${index + 1}"]`,
      );
      if (expandedElement && rowVirtualizer.value.measureElement) {
        rowVirtualizer.value.measureElement(expandedElement);
      }

      // Trigger a full recalculation
      // rowVirtualizer.value.measure();
    }
  }
};

// Cache for calculated actual indices - maps virtual index to actual index
// Cache is cleared whenever expandedRowIndices changes (expand/collapse operations)
const actualIndexCache = ref<Map<number, number>>(new Map());

/**
 * Converts a virtual index (including expanded rows) to an actual index (in original data).
 * Uses caching to avoid redundant calculations, especially during render and hover events.
 *
 * @param virtualIndex - Index in the displayed table (includes expanded rows)
 * @returns Actual index in the original data array (without expanded rows)
 */
const calculateActualIndex = (virtualIndex: number): number => {
  // Check cache first for O(1) lookup
  if (actualIndexCache.value.has(virtualIndex)) {
    return actualIndexCache.value.get(virtualIndex)!;
  }

  // Calculate actual index from virtual index
  // For each expanded row before this virtual index, subtract 1
  let actualIndex = virtualIndex;
  expandedRowIndices.value.forEach((expandedIndex) => {
    if (expandedIndex !== -1 && expandedIndex < virtualIndex) {
      actualIndex -= 1;
    }
  });

  // Store in cache for future lookups
  actualIndexCache.value.set(virtualIndex, actualIndex);
  return actualIndex;
};

const calculateVirtualIndex = (index: number): number => {
  let virtualIndex = index;
  expandedRowIndices.value.forEach((expandedIndex) => {
    if (expandedIndex !== -1 && expandedIndex < virtualIndex) {
      virtualIndex += 1;
    }
  });
  return virtualIndex;
};

const handleDataRowClick = (row: any, index: number, event?: MouseEvent) => {
  const actualIndex = calculateActualIndex(index);

  if (actualIndex !== -1) {
    emits("click:dataRow", row, actualIndex, event);
  }
};

const expandFunctionError = () => {
  isFunctionErrorOpen.value = !isFunctionErrorOpen.value;
};
// Specific function that updates the active cell action ID
const updateActiveCell = (cell?: { id: string; column: { id: string } }) => {
  if (!cell) {
    activeCellActionId.value = "";
  } else {
    activeCellActionId.value = `${cell.id}_${cell.column.id}`;
  }
};

// Debounced version of the function
const debounceCellAction = debounce(updateActiveCell, 1500);

// Event handlers for mouse over and mouse leave
const handleCellMouseOver = (cell: { id: string; column: { id: string } }) => {
  debounceCellAction(cell);
};

const handleCellMouseLeave = () => {
  activeCellActionId.value = "";
};

const sendToAiChat = (
  value: any,
  isEntireRow: boolean = false,
  append: boolean = true,
) => {
  if (isEntireRow) {
    //here we will get the original value of the row
    //and we need to filter the row if props.columns have any filtered cols that user applied
    //the format of the props.columns is like this:
    //if user have not applied any filter then the props.columns will be like this:
    //it contains _timestamp column and source column
    //else we get _timestamp column and other filter columns so if user have applied any filter then we need to filter the row based on the filter columns
    const row = JSON.parse(value);
    //lets filter based on props.columns so lets ignore _timestamp column as it is always present and now we want to check if source is present we can directly send the row
    //otherwise we need to filter the row based on the columns that user have applied
    if (checkIfSourceColumnPresent(props.columns)) {
      emits("sendToAiChat", JSON.stringify(row), append);
    } else {
      //we need to filter the row based on the columns that user have applied
      const filteredRow = filterRowBasedOnColumns(row, props.columns);
      emits("sendToAiChat", JSON.stringify(filteredRow), append);
    }
  } else {
    emits("sendToAiChat", value, append);
  }
};

const checkIfSourceColumnPresent = (columns: any) => {
  //we need to check if source column is present in the columns
  //if present then we need to return true else false
  return columns.some((column: any) => column.id === "source");
};

const filterRowBasedOnColumns = (row: any, columns: any) => {
  //we need to filter the row based on the columns that user have applied
  //here we need to filter row not columns based on the columns that user have applied
  const columnsToFilter = columns.filter(
    (column: any) => column.id !== "source",
  );
  return columnsToFilter.reduce((acc: any, column: any) => {
    acc[column.id] = row[column.id];
    return acc;
  }, {});
};

defineExpose({
  parentRef,
  virtualRows,
  sendToAiChat,
  store,
  selectedStreamFtsKeys,
  processedResults,
  /** Returns the current sorted/filtered rows as plain objects (for export, etc.) */
  getRows: () => table?.getRowModel().rows.map((r: any) => r.original) ?? [],
});
</script>
<style>
@import "@/assets/styles/log-highlighting.css";
</style>
<style scoped lang="scss">
@import "@/styles/logs/tenstack-table.scss";

// Outer wrapper for the table (used for sticky-column CSS scoping via data-sticky-id)
.my-sticky-virtscroll-table {
  overflow: hidden;
}

// Add explicit hover styles for log rows
.table-row-hover {
  transition: background-color 0.15s ease-in-out;

  &:hover {
    background-color: var(--o2-hover-gray) !important;
  }
}

// ── Dashboard / pivot table styles ──────────────────────────────────────────

// Pivot multi-level header cells - sticky with border and shadow
.pivot-group-header {
  text-align: center;
  font-weight: 600;
  vertical-align: middle;
  white-space: nowrap;
  padding-top: 5px;
  padding-bottom: 5px;
  border-right: 1px solid rgba(0, 0, 0, 0.15);
  border-bottom: 1px solid rgba(0, 0, 0, 0.15);
}

.pivot-value-header {
  text-align: center;
  font-weight: 500;
  font-size: 0.85em;
  vertical-align: middle;
  padding-top: 5px;
  padding-bottom: 5px;
  border-right: 1px solid rgba(0, 0, 0, 0.15);
}

// Column separator between pivot sections
.pivot-section-border {
  border-left: 2px solid rgba(0, 0, 0, 0.2) !important;
}

// Right-sticky total column body cells
.pivot-total-col {
  font-weight: 600;
}

// Cells hidden by pivot row merging (duplicates suppressed)
.pivot-no-border {
  border-bottom: none !important;
}

// Left-sticky columns
.sticky-column {
  background-color: inherit;
}

// Sticky total row at bottom
.pivot-sticky-total-row {
  font-weight: bold;
  position: sticky;
  bottom: 0;
  z-index: 9;
  box-shadow: 0 -2px 4px rgba(0, 0, 0, 0.1);

  td {
    background-color: var(--q-color-grey-2, #f5f5f5);
    position: sticky;
    bottom: 0;
  }
}

// Sort icon shown in pivot header clicks
.pivot-sort-icon {
  vertical-align: middle;
  opacity: 0;
  transition: opacity 0.2s;

  &.pivot-sort-active {
    opacity: 1 !important;
    color: var(--q-primary);
  }
}

// Copy button — only visible on cell hover
.copy-cell-td {
  .copy-btn {
    opacity: 0;
    transition: opacity 0.15s;
  }

  &:hover .copy-btn {
    opacity: 1;
  }
}
</style>
