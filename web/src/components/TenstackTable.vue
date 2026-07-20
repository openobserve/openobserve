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
    class="my-sticky-virtscroll-table h-full flex flex-col rounded-none! overflow-hidden"
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
        'flex-1',
        'min-h-0',
        'overflow-auto',
        'relative',
        { 'virtual-scroll-active': useVirtualScroll },
      ]"
    >
      <table
        v-if="table"
        data-test="o2-table"
        :data-test-loading="loading ? 'true' : 'false'"
        :class="['w-full', 'table-auto']"
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
          class="pivot-thead sticky top-0 z-10"
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
              class="cursor-pointer px-2 text-center font-semibold align-middle whitespace-nowrap py-[5px] [border-right:1px_solid_var(--o2-pivot-header-border)] [border-bottom:1px_solid_var(--o2-pivot-header-border)] bg-(--o2-sticky-col-header-bg)"
              :style="getStickyColumnStyle(col) as any"
              @click="handlePivotSort(col.name)"
            >
              {{ col.label }}
              <OIcon
                :name="
                  pivotSortState.descending ? 'arrow-downward' : 'arrow-upward'
                "
                size="xs"
                class="ml-1 pivot-sort-icon"
                :class="{
                  'pivot-sort-active text-[var(--o2-primary-color)]': pivotSortState.sortBy === col.name,
                }"
              />
            </th>
            <!-- Pivot group / value headers -->
            <th
              v-for="(cell, cellIdx) in level.cells"
              :key="'c_' + levelIdx + '_' + cellIdx"
              :data-test="`o2-table-pivot-th-${levelIdx}-${cellIdx}`"
              :data-test-pivot-type="level.isLeaf ? 'value' : 'group'"
              :colspan="cell.colspan"
              :rowspan="cell.rowspan || 1"
              class="px-2"
              :class="[
                level.isLeaf
                  ? 'text-center font-medium text-[0.85em] align-middle py-[5px] [border-right:1px_solid_var(--o2-pivot-header-border)] [border-bottom:1px_solid_var(--o2-pivot-header-border)] bg-(--o2-sticky-col-header-bg)'
                  : 'text-center font-semibold align-middle whitespace-nowrap py-[5px] [border-right:1px_solid_var(--o2-pivot-header-border)] [border-bottom:1px_solid_var(--o2-pivot-header-border)] bg-(--o2-sticky-col-header-bg)',
                {
                  'pivot-section-border':
                    cell.hasBorder && !(stickyColTotals && cell._isTotalHeader),
                },
                { 'pivot-total-col font-semibold': stickyColTotals && cell._isTotalHeader },
                { 'cursor-pointer': cell._sortColumn },
              ]"
              :style="
                (stickyColTotals && cell._isTotalHeader
                  ? getStickyTotalHeaderForPivot(cell)
                  : {}) as any
              "
              @click="cell._sortColumn && handlePivotSort(cell._sortColumn)"
            >
              {{ cell.label }}
              <OIcon
                v-if="level.isLeaf && cell._sortColumn"
                :name="
                  pivotSortState.descending ? 'arrow-downward' : 'arrow-upward'
                "
                size="xs"
                class="ml-1 pivot-sort-icon"
                :class="{
                  'pivot-sort-active text-[var(--o2-primary-color)]':
                    pivotSortState.sortBy === cell._sortColumn,
                }"
              />
            </th>
          </tr>
        </thead>

        <!-- ── Standard TanStack headers (logs / non-pivot) ─────────────────── -->
        <thead
          v-else
          class="sticky top-0 z-10"
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
              useVirtualScroll ? 'flex items-center' : '',
              enableColumnReorder && table.getState().columnOrder.length
                ? 'cursor-move!'
                : '',
              // Header-row chrome via centralized token utilities (same tokens
              // OTable uses): background band + full-width underline on the row
              // so it spans past the last column.
              'bg-[var(--color-table-header-bg)] border-b border-[var(--color-grey-300)]',
            ]"
            :style="{
              width:
                defaultColumns && wrap
                  ? width - 12 + 'px'
                  : defaultColumns
                    ? tableRowSize + 'px'
                    : table.getTotalSize() + 'px',
              minWidth: '100%',
            }"
            tag="tr"
            @start="(event) => handleDragStart(event)"
            @end="() => handleDragEnd()"
          >
            <th
              v-for="header in headerGroup.headers"
              :key="header.id"
              :id="header.id"
              class="px-2 relative table-head text-ellipsis! group"
              :class="[
                (header.column.columnDef.meta as any)?.align === 'center'
                  ? 'text-center!'
                  : '',
                (header.column.columnDef.meta as any)?.align === 'right'
                  ? 'text-right!'
                  : '',
                (header.column.columnDef.meta as any)?.headerClass ?? '',
                {
                  'pivot-total-col font-semibold':
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
                class="h-full w-full flex items-center"
                :class="[
                  (header.column.columnDef.meta as any)?.align === 'center'
                    ? 'justify-center! text-center!'
                    : '',
                  (header.column.columnDef.meta as any)?.align === 'right'
                    ? 'justify-end! text-right!'
                    : '',
                ]"
              >
                <!-- Column separator / resize handle. Separator LINE renders on
                     EVERY column (even non-resizable) for continuous dividers;
                     drag + hover accent only when resizable. -->
                <div
                  @dblclick="
                    header.column.getCanResize() && header.column.resetSize()
                  "
                  @mousedown.self.prevent.stop="
                    header.column.getCanResize() &&
                      header.getResizeHandler()?.($event)
                  "
                  @touchstart.self.prevent.stop="
                    header.column.getCanResize() &&
                      header.getResizeHandler()?.($event)
                  "
                  :class="[
                    'absolute right-0 top-0 h-full w-2 flex items-center justify-end select-none touch-none z-10 group/resizer',
                    header.column.getCanResize() ? 'resizer cursor-col-resize' : '',
                  ]"
                >
                  <div
                    :class="[
                      'rounded-full transition-all duration-150',
                      header.column.getIsResizing()
                        ? 'w-0.5 h-full bg-[var(--color-table-resize-handle)]'
                        : 'w-px h-4 bg-[var(--color-border-default)] group-hover/resizer:w-0.5 group-hover/resizer:h-full group-hover/resizer:bg-[var(--color-table-resize-handle)]',
                    ]"
                  />
                </div>
                <div
                  v-if="!header.isPlaceholder"
                  :data-test="`o2-table-th-sort-${header.id}`"
                  :class="['text-left', 'cursor-pointer gap-1']"
                  @click="
                    handleHeaderSortClick(
                      $event,
                      header.column,
                      header.column.getToggleSortingHandler(),
                    )
                  "
                  class="overflow-hidden whitespace-nowrap text-ellipsis! text-[var(--color-table-header-text)] text-xs font-medium capitalize"
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
                    <OIcon
                      v-if="
                        (sortFieldMap?.[header.column.id] ??
                          header.column.id) === sortBy
                      "
                      :name="
                        sortOrder === 'asc' ? 'arrow-upward' : 'arrow-downward'
                      "
                      :data-test="`o2-table-sort-icon-${header.id}`"
                      data-test-sort-state="active"
                      :data-test-sort-direction="sortOrder"
                      size="sm"
                      class="text-[var(--o2-primary-color)]"
                    />
                    <OIcon
                      v-else
                      name="unfold-more"
                      :data-test="`o2-table-sort-icon-${header.id}`"
                      data-test-sort-state="inactive"
                      data-test-sort-direction="none"
                      size="sm"
                      class="opacity-40"
                    />
                  </template>
                </div>
                <!-- Slot for extra per-column header content (e.g. filter button) -->
                <slot name="header-cell" :column-id="header.column.id" />

                <!-- Built-in column filter button -->
                <template v-if="enableColumnFilter">
                  <ODropdown
                    side="bottom"
                    align="start"
                    :side-offset="4"
                    @update:open="(v: boolean) => { if (v) colFilterSearch[header.column.id] = '' }"
                  >
                    <template #trigger>
                      <OButton
                        variant="ghost"
                        size="icon-xs"
                        :data-test="`o2-table-column-filter-btn-${header.column.id}`"
                        class="ml-0.5 shrink-0 h-5! w-5! min-h-0! p-0!"
                        @click.stop
                      >
                        <OIcon
                          name="filter-list"
                          size="sm"
                          :class="isColFiltered(header.column.id) ? 'text-[var(--color-primary-600)]' : 'opacity-50'"
                        />
                      </OButton>
                    </template>

                    <!-- Filter panel -->
                    <div
                      class="py-1"
                      style="min-width: 200px; max-width: 300px"
                      :data-test="`o2-table-column-filter-panel-${header.column.id}`"
                      @click.stop
                    >
                      <!-- Search box — always visible at top -->
                      <div
                        class="px-2 pb-1"
                        style="border-bottom: 1px solid var(--color-table-row-divider)"
                      >
                        <OInput
                          v-model="colFilterSearch[header.column.id]"
                          size="sm"
                          clearable
                          :placeholder="t('common.search')"
                          @click.stop
                          @keydown.stop
                        >
                          <template #icon-left>
                            <OIcon name="search" size="xs" />
                          </template>
                        </OInput>
                      </div>

                      <!-- Scrollable checkbox list -->
                      <ul
                        role="listbox"
                        aria-multiselectable="true"
                        style="max-height: 240px; overflow-y: auto"
                      >
                        <li
                          v-for="rawVal in getFilteredUniqueValues(header.column.id)"
                          :key="String(rawVal)"
                          class="flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded hover:bg-[var(--color-surface-panel)] transition-colors"
                          @click.stop="toggleColFilterValue(header.column.id, rawVal)"
                        >
                          <OCheckbox
                            :model-value="getColFilterValues(header.column.id).includes(rawVal)"
                            size="sm"
                            @update:model-value="toggleColFilterValue(header.column.id, rawVal)"
                            @click.stop
                          />
                          <span class="text-sm select-none flex-1 truncate">
                            {{ getFilterDisplayValue(header.column.id, rawVal) }}
                          </span>
                        </li>
                        <li
                          v-if="getFilteredUniqueValues(header.column.id).length === 0"
                          class="px-3 py-1.5 text-xs opacity-60"
                        >
                          {{ t("common.noMatches") }}
                        </li>
                      </ul>

                      <!-- Clear filter — always visible at bottom -->
                      <div style="border-top: 1px solid var(--color-table-row-divider)">
                        <div
                          class="px-3 py-1.5 text-xs cursor-pointer opacity-70 hover:bg-[var(--color-surface-panel)]"
                          @click.stop="clearColFilter(header.column.id)"
                        >
                          {{ t("common.clearFilter") }}
                        </div>
                      </div>
                    </div>
                  </ODropdown>
                </template>
                <div
                  :data-test="`o2-table-add-data-from-column-${header.column.columnDef.header}`"
                  class="invisible group-hover:visible items-center absolute right-2 top-0 px-2 column-actions h-full flex bg-[var(--color-table-header-bg)]"
                  :class="
                    store.state.theme === 'dark' ? 'field_overlay_dark' : ''
                  "
                  v-if="
                    (header.column.columnDef.meta as any)?.closable ||
                    (header.column.columnDef.meta as any)?.showWrap
                  "
                >
                  <OIcon
                    v-if="(header.column.columnDef.meta as any).closable"
                    :data-test="`o2-table-th-remove-${header.column.columnDef.header}-btn`"
                    name="close"
                    class="m-0 mt-[0.125rem]! close-icon cursor-pointer"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-white'
                        : 'text-gray-700'
                    "
                    :title="t('common.close')"
                    size="sm"
                    @click.stop="closeColumn(header.column.columnDef)"
                   />
                </div>
              </div>
            </th>
          </vue-draggable>

          <!-- Loading row: only rendered when the parent supplies a custom
            #loading slot. With no slot, the shimmer skeleton <tbody> below
            takes over (initial fetch). -->
          <tr
            v-if="loading && tableRows.length === 0 && $slots.loading"
            class="w-full"
          >
            <td
              :colspan="columnOrder.length"
              class="font-bold bg-[var(--color-table-header-bg)] opacity-70"
            >
              <slot name="loading" />
            </td>
          </tr>
          <!-- Loading banner: shown above rows while a new page is fetching -->
          <tr v-if="loading && tableRows.length > 0 && $slots['loading-banner']" class="w-full">
            <td :colspan="columnOrder.length">
              <slot name="loading-banner" />
            </td>
          </tr>
          <tr v-if="!loading && errMsg != ''" class="w-full">
            <td
              :colspan="columnOrder.length"
              class="font-bold"
              style="opacity: 0.7"
            >
              <div class="text-sm font-medium text-weight-bold bg-amber-500">
                <OIcon size="sm" name="warning" class="mr-1" />
                {{ errMsg }}
              </div>
            </td>
          </tr>
          <tr data-test="o2-table-function-error" v-if="functionErrorMsg != ''">
            <td
              :colspan="columnOrder.length"
              class="font-bold"
              style="opacity: 0.6"
            >
              <div
                class="text-sm font-medium text-weight-bold pl-2"
                :class="
                  store.state.theme === 'dark'
                    ? 'bg-yellow-600'
                    : 'bg-amber-300'
                "
              >
                <OButton
                  variant="ghost"
                  size="icon-xs-sq"
                  class="mr-1"
                  data-test="table-row-expand-menu"
                  @click.capture.stop="expandFunctionError"
                >
                  <OIcon
                    :name="
                      isFunctionErrorOpen ? 'expand-more' : 'chevron-right'
                    "
                    size="sm"
                  /> </OButton
                ><b>
                  <OIcon name="warning" size="sm"></OIcon>
                  {{ t("search.functionErrorLabel") }}</b
                >
              </div>
            </td>
          </tr>
          <tr v-if="functionErrorMsg != '' && isFunctionErrorOpen">
            <td
              :colspan="columnOrder.length"
              style="opacity: 0.7"
              class="px-2"
              :class="
                store.state.theme === 'dark'
                  ? 'bg-yellow-600'
                  : 'bg-amber-300'
              "
            >
              <pre>{{ functionErrorMsg }}</pre>
            </td>
          </tr>
        </thead>

        <!-- Skeleton loading body — shimmer placeholder shown on initial fetch
          when the parent does not provide a custom #loading slot. Mirrors the
          logs TenstackTable pattern. -->
        <tbody
          v-if="loading && !$slots.loading"
          data-test="tenstack-table-skeleton-body"
          aria-busy="true"
          aria-label="Loading"
        >
          <!-- Rows use flex to align with the real virtual/data rows. -->
          <tr
            v-for="r in SKEL_ROW_COUNT"
            :key="`skel-${r}`"
            class="o2-skel-row flex items-center w-full opacity-0 h-[29px] bg-(--o2-log-table-row-bg) border-b border-(--o2-log-table-row-border) [animation:o2-skel-row-in_320ms_ease-out_forwards] motion-reduce:opacity-100 motion-reduce:animate-none"
            :style="{ animationDelay: `${(r - 1) * 40}ms` }"
          >
            <!-- No columns yet (first paint) — full-width shimmer bar -->
            <td
              v-if="!headers?.length"
              class="w-full px-4 overflow-hidden"
            >
              <span
                class="o2-skel-pill inline-block h-3 rounded-md"
                :style="{ width: `${skelCellWidth(r - 1, 0)}%` }"
                aria-hidden="true"
              />
            </td>
            <!-- Columns available — per-column aligned shimmer pills -->
            <template v-else>
              <td
                v-for="(header, c) in headers"
                :key="header.id"
                class="px-2 overflow-hidden"
                :class="c === 0 ? 'pl-4' : ''"
                :style="skelTdStyle(header, c)"
              >
                <span
                  class="o2-skel-pill inline-block h-3 rounded-md"
                  :style="{
                    width:
                      c === 0
                        ? `${SKEL_TIMESTAMP_PX}px`
                        : `${skelCellWidth(r - 1, c)}%`,
                  }"
                  aria-hidden="true"
                />
              </td>
            </template>
          </tr>
        </tbody>

        <!-- relative is only needed for virtual-scroll absolute rows (logs/traces).
          In dashboard mode (regular DOM rows) it must be absent so that
          position:sticky on <thead> works correctly. -->
        <tbody
          data-test="o2-table-body"
          ref="tableBodyRef"
          :class="{ 'relative': useVirtualScroll && !showPagination }"
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
              class="dashboard-data-row cursor-pointer hover:bg-[var(--color-table-row-hover-bg)]"
              :class="{ 'border-b border-[var(--color-table-row-divider)]': !usesSeparateBorders }"
              data-test="dashboard-data-row"
              tabindex="0"
              @click="handleDataRowClick(row.original, idx as number, $event)"
              @keydown="handleDataRowKeydown($event, row.original, idx as number)"
            >
              <td
                v-for="(cell, cellIndex) in row.getVisibleCells()"
                :key="cell.id"
                data-test="dashboard-data-row-cell"
                class="py-1 px-2 overflow-hidden relative table-cell group/copy"
                :class="[
                  (cell.column.columnDef.meta as any)?.align === 'center'
                    ? 'text-center!'
                    : '',
                  (cell.column.columnDef.meta as any)?.align === 'right'
                    ? 'text-right!'
                    : '',
                  (cell.column.columnDef.meta as any)?.cellClass ?? '',
                  {
                    'sticky-column bg-inherit': (cell.column.columnDef.meta as any)
                      ?.sticky,
                  },
                  {
                    'pivot-total-col font-semibold':
                      stickyColTotals &&
                      (cell.column.columnDef.meta as any)?._isTotalColumn,
                  },
                  // In separate-border mode (pivot or sticky columns),
                  // <tr> borders don't render — apply the row border on <td>.
                  { 'border-b': usesSeparateBorders },
                  isPivotMergeNoBorder(
                    row.original,
                    (cell.column.columnDef.meta as any)?._col,
                  )
                    ? 'pivot-no-border border-b-0!'
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
                    class="h-full w-full flex items-center"
                    :class="[
                      (cell.column.columnDef.meta as any)?.align === 'center'
                        ? 'justify-center!'
                        : '',
                      (cell.column.columnDef.meta as any)?.align === 'right'
                        ? 'justify-end!'
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
                      class="mr-1 opacity-0 transition-opacity duration-[150ms] inline-flex items-center leading-none group-hover/copy:opacity-100"
                      data-test="dashboard-table-cell-copy-btn"
                      :data-copied="isCellCopied(idx as number, cell.column.id) ? 'true' : undefined"
                    >
                      <OButton
                        variant="ghost"
                        size="icon-xs-sq"
                        class="h-[16px]! w-[16px]! min-h-0!"
                        @click.stop="
                          copyCellContent(
                            getCellDisplayValue(cell),
                            idx as number,
                            cell.column.id,
                          )
                        "
                      >
                        <OIcon
                          :name="
                            isCellCopied(idx as number, cell.column.id)
                              ? 'check'
                              : 'content-copy'
                          "
                          size="sm"
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
                      data-test="dashboard-table-cell-value"
                      :class="[
                        !props.wrap
                          ? 'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
                          : '',
                        props.wrap ? 'break-words' : '',
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
                      class="ml-1 opacity-0 transition-opacity duration-[150ms] inline-flex items-center leading-none group-hover/copy:opacity-100"
                      data-test="dashboard-table-cell-copy-btn"
                      :data-copied="isCellCopied(idx as number, cell.column.id) ? 'true' : undefined"
                    >
                      <OButton
                        variant="ghost"
                        size="icon-xs-sq"
                        class="h-[16px]! w-[16px]! min-h-0!"
                        @click.stop="
                          copyCellContent(
                            getCellDisplayValue(cell),
                            idx as number,
                            cell.column.id,
                          )
                        "
                      >
                        <OIcon
                          :name="
                            isCellCopied(idx as number, cell.column.id)
                              ? 'check'
                              : 'content-copy'
                          "
                          size="sm"
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
              class="absolute flex w-max items-center justify-start border-b border-b-[var(--color-table-row-divider)] cursor-pointer hover:bg-[var(--color-table-row-hover-bg)] transition-colors duration-150 ease-in-out"
              :class="[
                defaultColumns &&
                !wrap &&
                !(formattedRows[virtualRow.index]?.original as any)
                  ?.isExpandedRow
                  ? 'table-row'
                  : 'flex',
                (formattedRows[virtualRow.index]?.original as any)?.[
                  store.state.zoConfig.timestamp_column
                ] === highlightTimestamp &&
                !(formattedRows[virtualRow.index]?.original as any)
                  ?.isExpandedRow
                  ? 'bg-(--color-table-row-selected-bg)'
                  : '',
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
                class="absolute left-0 inset-y-0 w-1 z-10"
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
                class="w-full relative"
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
                  class="py-none px-2 items-center justify-start relative table-cell group/copy"
                  :class="[
                    ...tableCellClass,
                    { 'pl-2': cellIndex === 0 },
                    (cell.column.columnDef.meta as any)?.align === 'center'
                      ? 'justify-center! text-center!'
                      : '',
                    (cell.column.columnDef.meta as any)?.align === 'right'
                      ? 'justify-end! text-right!'
                      : '',
                    (cell.column.columnDef.meta as any)?.cellClass ?? '',
                    {
                      'sticky-column bg-inherit': (cell.column.columnDef.meta as any)
                        ?.sticky,
                    },
                    {
                      'pivot-total-col font-semibold':
                        stickyColTotals &&
                        (cell.column.columnDef.meta as any)?._isTotalColumn,
                    },
                    isPivotMergeNoBorder(
                      cell.row.original,
                      (cell.column.columnDef.meta as any)?._col,
                    )
                      ? 'pivot-no-border border-b-0!'
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
                    class="h-full w-full flex items-center"
                    :class="[
                      (cell.column.columnDef.meta as any)?.align === 'center'
                        ? 'justify-center! text-center!'
                        : '',
                      (cell.column.columnDef.meta as any)?.align === 'right'
                        ? 'justify-end! text-right!'
                        : '',
                    ]"
                  >
                    <OButton
                      v-if="enableRowExpand && cellIndex == 0"
                      variant="ghost"
                      size="icon-xs-sq"
                      class="mr-1"
                      data-test="table-row-expand-menu"
                      @click.capture.stop="handleExpandRow(virtualRow.index)"
                    >
                      <OIcon
                        :name="
                          expandedRowIndices.has(virtualRow.index)
                            ? 'expand-more'
                            : 'chevron-right'
                        "
                        size="sm"
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
                          class="mr-1 opacity-0 transition-opacity duration-[150ms] inline-flex items-center leading-none group-hover/copy:opacity-100"
                          data-test="dashboard-table-cell-copy-btn"
                          :data-copied="isCellCopied(virtualRow.index, cell.column.id) ? 'true' : undefined"
                        >
                          <OButton
                            variant="ghost"
                            size="icon-xs-sq"
                            class="h-[16px]! w-[16px]! min-h-0!"
                            @click.stop="
                              copyCellContent(
                                getCellDisplayValue(cell),
                                virtualRow.index,
                                cell.column.id,
                              )
                            "
                          >
                            <OIcon
                              :name="
                                isCellCopied(virtualRow.index, cell.column.id)
                                  ? 'check'
                                  : 'content-copy'
                              "
                              size="sm"
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
                          data-test="dashboard-table-cell-value"
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
                              ? 'overflow-hidden text-ellipsis whitespace-nowrap'
                              : '',
                            props.wrap ? 'break-words' : '',
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
                          class="absolute right-0 top-1/2 transform invisible -translate-y-1/2 -translate-x-1/2 ai-btn"
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
                          class="ml-1 opacity-0 transition-opacity duration-[150ms] inline-flex items-center leading-none group-hover/copy:opacity-100"
                          data-test="dashboard-table-cell-copy-btn"
                          :data-copied="isCellCopied(virtualRow.index, cell.column.id) ? 'true' : undefined"
                        >
                          <OButton
                            variant="ghost"
                            size="icon-xs-sq"
                            class="h-[16px]! w-[16px]! min-h-0!"
                            @click.stop="
                              copyCellContent(
                                getCellDisplayValue(cell),
                                virtualRow.index,
                                cell.column.id,
                              )
                            "
                          >
                            <OIcon
                              :name="
                                isCellCopied(virtualRow.index, cell.column.id)
                                  ? 'check'
                                  : 'content-copy'
                              "
                              size="sm"
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
          <tr v-if="!loading && tableRows.length === 0" class="w-full">
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
              class="px-2 bg-[#f5f5f5] sticky bottom-0"
              :class="[
                col.align === 'right'
                  ? 'text-right'
                  : col.align === 'center'
                    ? 'text-center'
                    : 'text-left',
                { 'sticky-column bg-inherit': col.sticky },
                { 'pivot-total-col font-semibold': stickyColTotals && col._isTotalColumn },
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
  reactive,
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
  type ColumnFiltersState,
  type Updater,
  useVueTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
} from "@tanstack/vue-table";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { VueDraggableNext as VueDraggable } from "vue-draggable-next";
import { debounce } from "lodash-es";
import { copyToClipboard } from "@/utils/clipboard";
import O2AIContextAddBtn from "@/components/common/O2AIContextAddBtn.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
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
  /** Returns CSS class(es) for a given row.
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
  /** Enable Excel-style column filter dropdowns. Default: false */
  enableColumnFilter: {
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

// ── Column filtering ──────────────────────────────────────────────────────────
const columnFiltersState = ref<ColumnFiltersState>([]);
const colFilterSearch = reactive<Record<string, string>>({});

const setColumnFilters = (updater: Updater<ColumnFiltersState>) => {
  columnFiltersState.value =
    typeof updater === "function"
      ? updater(columnFiltersState.value)
      : updater;
};

const uniqueValuesCache = shallowRef<Map<string, any[]>>(new Map());

const getUniqueValuesForColumn = (colId: string): any[] => {
  if (!props.enableColumnFilter) return [];
  const cache = uniqueValuesCache.value;
  if (cache.has(colId)) return cache.get(colId)!;
  const rows = tableRows.value || [];
  const seen = new Set<any>();
  for (const row of rows) {
    const val = (row as any)[colId];
    if (val !== null && val !== undefined && val !== "") seen.add(val);
  }
  const vals = Array.from(seen);
  vals.sort((a, b) => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b));
  });
  cache.set(colId, vals);
  return vals;
};

/** Return unique values filtered by the per-column search string. */
const getFilteredUniqueValues = (colId: string): any[] => {
  const all = getUniqueValuesForColumn(colId);
  const q = (colFilterSearch[colId] ?? "").trim().toLowerCase();
  if (!q) return all;
  return all.filter((v) =>
    getFilterDisplayValue(colId, v).toLowerCase().includes(q),
  );
};

/** Return the formatted display label for a raw cell value in the filter dropdown. */
const getFilterDisplayValue = (colId: string, rawVal: any): string => {
  const col = table?.getColumn(colId);
  const fmt = (col?.columnDef?.meta as any)?.format;
  if (fmt) {
    const formatted = fmt(rawVal);
    return formatted != null ? String(formatted) : String(rawVal ?? "");
  }
  return String(rawVal ?? "");
};

const isColFiltered = (colId: string): boolean =>
  columnFiltersState.value.some(
    (f) => f.id === colId && (f.value as any[])?.length > 0,
  );

const getColFilterValues = (colId: string): any[] =>
  (columnFiltersState.value.find((f) => f.id === colId)?.value as any[]) ?? [];

const toggleColFilterValue = (colId: string, rawVal: any) => {
  const current = getColFilterValues(colId);
  const idx = current.indexOf(rawVal);
  const next = idx === -1 ? [...current, rawVal] : current.filter((_, i) => i !== idx);
  if (next.length === 0) {
    columnFiltersState.value = columnFiltersState.value.filter((f) => f.id !== colId);
  } else {
    const exists = columnFiltersState.value.some((f) => f.id === colId);
    columnFiltersState.value = exists
      ? columnFiltersState.value.map((f) => (f.id === colId ? { id: colId, value: next } : f))
      : [...columnFiltersState.value, { id: colId, value: next }];
  }
};

const clearColFilter = (colId: string) => {
  columnFiltersState.value = columnFiltersState.value.filter((f) => f.id !== colId);
};

/** Replace characters invalid in CSS custom property names (e.g. dots) with underscores. */
const sanitizeCssId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_");

const store = useStore();
const { isFTSColumn } = useTextHighlighter();
const { processedResults, processHitsInChunks } = useLogsHighlighter();

// ── Dashboard: sticky columns composable ─────────────────────────────────────
// useStickyColumns reads props.columns (legacy column format when useVirtualScroll=false).
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
// Invalidate unique-values filter cache whenever rows are replaced
watch(tableRows, () => { uniqueValuesCache.value = new Map(); });

// ── Dashboard: convert legacy column defs → TanStack ColumnDef[] ─────────────
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
        _col: col, // reference to original source column for style helpers
        sortable: col.sortable, // mirrors the source column flag — drives sort icon visibility
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
// the old table's :virtual-scroll behaviour).
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
    "background-color": "var(--color-table-header-bg)",
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
    "background-color": "var(--o2-sticky-col-header-bg)",
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
  copyToClipboard(String(value), { silent: true }).then(() => {
    const key = `${rowIndex}_${colName}`;
    copiedCells.value.set(key, true);
    setTimeout(() => copiedCells.value.delete(key), 3000);
  });
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
    get columnFilters() {
      return columnFiltersState.value;
    },
  },
  onSortingChange: setSorting,
  onColumnFiltersChange: setColumnFilters,
  // Disable TanStack client sort for pivot (rows are pre-sorted manually)
  // and for dashboard mode (TableRenderer handles sorting externally).
  get enableSorting() {
    return !isPivotMode.value && props.useVirtualScroll;
  },
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  defaultColumn: {
    minSize: 60,
    maxSize: 800,
    // Multi-value include filter: row value must be one of the selected values.
    filterFn: (row: any, columnId: string, filterValue: any[]) => {
      if (!filterValue || filterValue.length === 0) return true;
      return filterValue.includes(row.getValue(columnId));
    },
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

// Reset column filters when the column set changes (dashboard re-query).
watch(
  () => props.columns,
  () => {
    if (columnFiltersState.value.length > 0) columnFiltersState.value = [];
  },
);

const hasDefaultSourceColumn = computed(
  () => props.defaultColumns && columnOrder.value.includes("source"),
);

const tableCellClass = ref<string[]>([]);

watch(
  () => [hasDefaultSourceColumn.value, props.wrap],
  () => {
    tableCellClass.value = [
      hasDefaultSourceColumn.value && !props.wrap
        ? "table-cell"
        : "block height-stretch",
      !props.wrap
        ? "overflow-hidden text-ellipsis whitespace-nowrap"
        : "",
      props.wrap ? "break-all" : "",
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

// ── Skeleton loading helpers — mirrors the logs TenstackTable shimmer pattern ──
const SKEL_ROW_COUNT = 30;
const SKEL_BASE_WIDTHS = [55, 70, 60, 45, 65, 50, 75, 40, 58, 68, 48, 62];
const SKEL_JITTER = [0, 6, -4, 3, -2, 5, -3, 2, -5, 4, -1, 6];
// First column (timestamp): pill sized to "2026-06-02 12:09:00.349"
// (23 chars × 7.2 px/char in monospace 12 px).
const SKEL_TIMESTAMP_PX = Math.round("2026-06-02 12:09:00.349".length * 7.2);
const skelCellWidth = (r: number, c: number): number => {
  const base = SKEL_BASE_WIDTHS[c % SKEL_BASE_WIDTHS.length] ?? 60;
  const jit = SKEL_JITTER[(r + c) % SKEL_JITTER.length] ?? 0;
  return Math.max(25, Math.min(85, base + jit));
};
// Mirror the exact width/flex logic of the real cells so skeleton columns align.
// Source column (width:'auto' in real rows) → flex:1 to fill remaining space.
// All other columns: fixed width from the CSS variable (same as real rows).
const skelTdStyle = (header: any, c: number): Record<string, string> => {
  const colId = header.column.id;
  const isStretchSource = colId === "source" && !header.column.getCanResize();
  if (isStretchSource) return { flex: "1 1 0", minWidth: "0" };
  const w = `calc(var(--col-${sanitizeCssId(colId)}-size) * 1px)`;
  return { width: w, minWidth: w, flexShrink: "0" };
};

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

    // Clear cached height for collapsed "row"
    delete expandedRowHeights.value[index + 1];

    // Remove the expanded row from tableRows
    tableRows.value.splice(index + 1, 1);
    isCollapseOperation = true;

    // Update all expanded indices that come after this collapsed "row"
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

    // Insert the expanded "row"
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

// Keyboard access for clickable data rows: Enter/Space activate, arrows move focus.
const handleDataRowKeydown = (event: KeyboardEvent, row: any, index: number) => {
  if (event.target !== event.currentTarget) return;
  const current = event.currentTarget as HTMLElement;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    handleDataRowClick(row, index);
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const next = event.key === "ArrowDown" ? "nextElementSibling" : "previousElementSibling";
    let sibling = current[next] as HTMLElement | null;
    while (sibling && !sibling.matches("tr[tabindex]")) {
      sibling = sibling[next] as HTMLElement | null;
    }
    sibling?.focus();
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
    //here we will get the original value of the "row"
    //and we need to filter the row if props.columns have any filtered cols that user applied
    //the format of the props.columns is like this:
    //if user have not applied any filter then the props.columns will be like this:
    //it contains _timestamp column and source column
    //else we get _timestamp column and other filter columns so if user have applied any filter then we need to filter the row based on the filter columns
    const row = JSON.parse(value);
    //lets filter based on props.columns so lets ignore _timestamp column as it is always present and now we want to check if source is present we can directly send the "row"
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
<style>
@keyframes o2-skel-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

@keyframes o2-skel-row-in {
  from {
    opacity: 0;
    transform: translateY(2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ── Loading skeleton pill (uses OTable skeleton tokens from lib/styles/tokens) ── */
.o2-skel-pill {
  background: linear-gradient(
    90deg,
    var(--color-skeleton-base)     0%,
    var(--color-skeleton-highlight) 50%,
    var(--color-skeleton-base)     100%
  );
  background-size: 200% 100%;
  animation: o2-skel-shimmer 1.5s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .o2-skel-row  { opacity: 1; animation: none; }
  .o2-skel-pill { animation: none; }
}
</style>
