// Copyright 2026 OpenObserve Inc.
<template>
  <OTable
    v-model:selected-ids="localSelectedIds"
    :columns="columns"
    :data="data"
    :loading="loading"
    pagination="client"
    :page-size="20"
    :page-size-options="[10, 20, 25, 50]"
    row-key="id"
    selection="multiple"
    :show-global-filter="false"
    :persist-columns="true"
    table-id="synthetic-monitoring-table"
    :enable-column-resize="true"
    :footer-title="footerTitle"
    :empty-message="emptyMessage"
    :data-test="dataTest"
    :horizontal-scroll="true"
    show-index
    @row-click="(row: any) => emit('row-click', row)"
  >
    <!-- Toolbar slots (passthrough to parent) -->
    <template #toolbar>
      <slot name="toolbar" />
    </template>
    <template #toolbar-trailing>
      <slot name="toolbar-trailing" />
    </template>

    <!-- Status badge -->
    <template #cell-status="{ row }">
      <OBadge :variant="resolveBadge('serviceStatus', (row as any).status).variant" :dot="true" size="sm">
        {{ resolveBadge('serviceStatus', (row as any).status).label }}
      </OBadge>
    </template>

    <!-- Monitor name -->
    <template #cell-name="{ row }">
      <div class="flex items-center gap-1.5 min-w-0 overflow-hidden">
        <span class="truncate">{{ (row as any).name || '—' }}</span>
      </div>
      <OTooltip
        v-if="(row as any).name"
        :content="(row as any).name"
        content-class="max-w-[25rem] whitespace-normal break-words text-xs"
      />
    </template>

    <!-- URL / Endpoint -->
    <template #cell-url="{ row }">
      <span class="truncate">{{ (row as any).url || '—' }}</span>
    </template>

    <!-- HTTP Method badge (API mode) -->
    <template #cell-method="{ row }">
      <OBadge :variant="resolveBadge('httpMethod', (row as any).method).variant" size="sm">
        {{ String((row as any).method).toUpperCase() }}
      </OBadge>
    </template>

    <!-- Steps count (Browser mode) -->
    <template #cell-steps="{ row }">
      <span class="truncate">{{ (row as any).steps ? `${(row as any).steps} ${t('synthetics.table.stepsSuffix')}` : '—' }}</span>
    </template>

    <!-- Assertions count (API mode) -->
    <template #cell-assertions="{ row }">
      <span class="truncate">{{ (row as any).assertions ? `${(row as any).assertions} ${t('synthetics.table.checksSuffix')}` : '—' }}</span>
    </template>

    <!-- Folder name (cross-folder search mode) — click navigates sidebar to that folder -->
    <template #cell-folder_name="{ row }">
      <div
        class="cursor-pointer"
        @click.stop="emit('navigate-to-folder', (row as any).folderId)"
      >
        {{ (row as any).folder_name || '—' }}
      </div>
    </template>

    <!-- Type badge (monitors mode) -->
    <template #cell-type="{ row }">
      <OBadge :variant="resolveBadge('syntheticType', (row as any).type).variant" size="sm">
        {{ resolveBadge('syntheticType', (row as any).type).label }}
      </OBadge>
    </template>

    <!-- History sparkbars -->
    <template #cell-history="{ row }">
      <div class="spark">
        <span
          v-for="(tick, i) in (row as any).history"
          :key="i"
          class="spark-bar"
          :class="tick.status === 'up' ? 'bg-[var(--color-success-500)]' : tick.status === 'down' ? 'bg-[var(--color-error-500)]' : 'bg-[var(--color-warning-500)]'"
          @mouseenter="showSparkTip($event, tick)"
          @mouseleave="hideSparkTip"
        />
      </div>
    </template>

    <!-- Response time -->
    <template #cell-responseTime="{ row }">
      <span
        v-if="(row as any).responseTime"
        class="font-mono text-sm font-semibold"
        :class="parseFloat((row as any).responseTime) < 300 ? 'text-[var(--color-success-600)]' : parseFloat((row as any).responseTime) < 1000 ? 'text-[var(--color-warning-600)]' : 'text-[var(--color-error-600)]'"
      >{{ (row as any).responseTime }}</span>
      <span v-else class="text-sm">—</span>
    </template>

    <!-- Uptime with progress bar -->
    <template #cell-uptime="{ row }">
      <template v-if="(row as any).uptime !== null">
        <div class="flex items-center justify-end gap-2">
          <OProgressBar
            :value="(row as any).uptime / 100"
            :variant="(row as any).uptime >= 99 ? 'default' : (row as any).uptime >= 95 ? 'warning' : 'danger'"
            size="xs"
            class="flex-1"
          />
          <span
            :class="'font-mono text-sm font-semibold min-w-[2.75rem] text-right text-xs '
              + ((row as any).uptime >= 99 ? 'text-[var(--color-success-600)]' : (row as any).uptime >= 95 ? 'text-[var(--color-warning-600)]' : 'text-[var(--color-error-600)]')"
          >{{ (row as any).uptime }}%</span>
        </div>
      </template>
      <span v-else class="text-xs text-text-secondary">—</span>
    </template>

    <!-- Locations with tooltip (monitors mode) -->
    <template #cell-locations="{ row }">
      <div class="flex items-center gap-1 cursor-default" @mouseenter="showLoc($event, (row as any).locations)" @mouseleave="hideLoc">
        <span class="text-xs truncate max-w-[4.375rem]">{{ (row as any).locations[0] }}</span>
        <span v-if="(row as any).locations.length > 1" class="text-xs font-bold px-1 py-0.5 rounded bg-[var(--color-surface-subtle)] whitespace-nowrap shrink-0">+{{ (row as any).locations.length - 1 }}</span>
      </div>
    </template>

    <!-- Interval (monitors mode) -->
    <template #cell-interval="{ row }">
      <span class="truncate">{{ (row as any).interval || '—' }}</span>
    </template>

    <!-- Last check -->
    <template #cell-lastCheck="{ row }">
      <span class="truncate">{{ (row as any).lastCheck || '—' }}</span>
    </template>

    <!-- Row actions -->
    <template #cell-actions="{ row }">
      <div class="flex items-center gap-0.5" @click.stop>
        <!-- Enable/Pause toggle with per-row spinner -->
        <div
          v-if="props.toggleLoadingMap[(row as any).id]"
          class="flex items-center justify-center w-7 h-8"
          :data-test="`${dataTest}-toggle-spinner`"
        >
          <OSpinner size="xs" />
          <OTooltip side="bottom" :content="(row as any).enabled ? t('synthetics.table.pausing') : t('synthetics.table.enabling')" />
        </div>
        <OButton
          v-else
          :variant="(row as any).enabled ? 'ghost-destructive' : 'ghost'"
          size="icon-sm"
          :icon-left="(row as any).enabled ? 'pause' : 'play-arrow'"
          :data-test="`${dataTest}-${(row as any).enabled ? 'pause' : 'enable'}-btn`"
          @click.stop="emit('toggle-enabled', row)"
        >
          <OTooltip side="bottom" :content="(row as any).enabled ? t('synthetics.table.pause') : t('synthetics.table.enable')" />
        </OButton>

        <!-- Edit -->
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="edit"
          :data-test="`${dataTest}-edit-btn`"
          @click.stop="emit('edit', row)"
        >
          <OTooltip side="bottom" :content="t('synthetics.table.edit')" />
        </OButton>

        <!-- Duplicate -->
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="content-copy"
          :data-test="`${dataTest}-duplicate-btn`"
          @click.stop="emit('duplicate', row)"
        >
          <OTooltip side="bottom" :content="t('synthetics.table.duplicate')" />
        </OButton>

        <!-- More menu: Trigger + Delete -->
        <ODropdown>
          <template #trigger>
            <!-- Show spinner when trigger is in flight for this row -->
            <div
              v-if="props.triggerLoadingMap[(row as any).id]"
              class="flex items-center justify-center w-7 h-8"
              :data-test="`${dataTest}-trigger-spinner`"
            >
              <OSpinner size="xs" />
              <OTooltip side="bottom" :content="t('synthetics.table.triggering')" />
            </div>
            <OButton
              v-else
              variant="ghost"
              size="icon-sm"
              icon-left="more-vert"
              :data-test="`${dataTest}-more-btn`"
              @click.stop
            >
              <OTooltip side="bottom" :content="t('synthetics.table.more')" />
            </OButton>
          </template>

          <ODropdownItem
            :data-test="`${dataTest}-run-item`"
            :disabled="!!props.triggerLoadingMap[(row as any).id]"
            @select="emit('run', row)"
          >
            <template #icon-left>
              <OIcon name="sound-sampler" size="sm" />
            </template>
            {{ t('synthetics.table.trigger') }}
          </ODropdownItem>

          <ODropdownSeparator />

          <ODropdownItem
            variant="destructive"
            :data-test="`${dataTest}-delete-item`"
            @select="emit('delete', row)"
          >
            <template #icon-left>
              <OIcon name="delete" size="sm" />
            </template>
            {{ t('synthetics.table.delete') }}
          </ODropdownItem>
        </ODropdown>
      </div>
    </template>

    <!-- Empty state -->
    <template #empty>
      <OEmptyState
        size="hero"
        preset="no-synthetic-monitors"
        :description="t('synthetics.table.noResults')"
        :data-test="`${dataTest}-empty-state`"
        @action="(id: string) => emit('empty-action', id)"
      />
    </template>

    <!-- Footer with count + bulk action buttons -->
    <template #bottom>
      <div class="flex w-full justify-between items-center h-12 gap-1">
        <span class="text-xs text-secondary min-w-25">
          <template v-if="localSelectedIds.length > 0">{{ t('synthetics.table.selectedCount', { selected: localSelectedIds.length, total: data.length }) }}</template>
          <template v-else>{{ data.length }} {{ footerTitle }}</template>
        </span>
        <template v-if="localSelectedIds.length > 0">
          <OButton
            variant="outline"
            size="sm"
            icon-left="pause"
            :data-test="`${dataTest}-pause-selected-btn`"
            :disabled="!!props.bulkActionLoading"
            @click="emit('pause-selected')"
          >{{ t('synthetics.table.pause') }}</OButton>
          <OButton
            variant="outline"
            size="sm"
            icon-left="play-arrow"
            :data-test="`${dataTest}-enable-selected-btn`"
            :disabled="!!props.bulkActionLoading"
            @click="emit('enable-selected')"
          >{{ t('synthetics.table.enable') }}</OButton>
          <OButton
            variant="outline"
            size="sm"
            icon-left="sound-sampler"
            :data-test="`${dataTest}-trigger-selected-btn`"
            :disabled="!!props.bulkActionLoading"
            @click="emit('trigger-selected')"
          >{{ t('synthetics.table.trigger') }}</OButton>
          <OButton
            variant="outline"
            size="sm"
            icon-left="drive-file-move"
            :data-test="`${dataTest}-move-selected-btn`"
            @click="emit('move-selected')"
          >{{ t('synthetics.table.move') }}</OButton>
          <OButton
            variant="outline-destructive"
            size="sm"
            icon-left="delete"
            :data-test="`${dataTest}-delete-selected-btn`"
            @click="emit('delete-selected')"
          >{{ t('synthetics.table.delete') }}</OButton>
        </template>
      </div>
    </template>
  </OTable>

  <!-- Locations tooltip -->
  <Teleport to="body">
    <div v-if="locTip.show" class="loc-float-tip" :style="{ left: locTip.x + 'px', top: locTip.y + 'px' }">
      <div v-for="l in locTip.locs" :key="l" class="loc-float-item">
        <span class="loc-float-dot" />{{ l }}
      </div>
    </div>
  </Teleport>

  <!-- Spark bar detail tooltip -->
  <Teleport to="body">
    <div
      v-if="sparkTip.show && sparkTip.tick"
      class="spark-tooltip"
      :style="{ left: sparkTip.x + 'px', top: sparkTip.y + 'px' }"
      @mouseenter="keepSparkTip"
      @mouseleave="hideSparkTip"
    >
      <div class="stt-header">
        <span class="stt-time">{{ sparkTip.tick.hour }} – {{ sparkTip.tick.nextHour }}</span>
        <span class="stt-badge" :class="'stt-badge--' + sparkTip.tick.status">
          {{ sparkTip.tick.status === 'up' ? t('synthetics.table.statusUp') : sparkTip.tick.status === 'down' ? t('synthetics.table.statusDown') : t('synthetics.table.statusDegraded') }}
        </span>
      </div>
      <div class="stt-divider" />
      <div class="stt-checks">
        <div v-for="c in sparkTip.tick.checks" :key="c.loc" class="stt-check">
          <span class="stt-dot" :class="c.ok ? 'stt-dot--up' : 'stt-dot--down'" />
          <span class="stt-loc">{{ c.loc }}</span>
          <span class="stt-ms">{{ c.ms !== null ? c.ms + t('synthetics.table.ms') : t('synthetics.table.timeout') }}</span>
        </div>
      </div>
      <div v-if="sparkTip.tick.avgMs !== null" class="stt-avg">{{ t('synthetics.table.avg') }} · {{ sparkTip.tick.avgMs }}{{ t('synthetics.table.ms') }}</div>
      <div class="stt-arrow" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import OTable from '@/lib/core/Table/OTable.vue'
import type { OTableColumnDef } from '@/lib/core/Table/OTable.types'
import { COL } from '@/lib/core/Table/OTable.types'
import OButton from '@/lib/core/Button/OButton.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OBadge from '@/lib/core/Badge/OBadge.vue'
import OProgressBar from '@/lib/data/ProgressBar/OProgressBar.vue'
import OSpinner from '@/lib/feedback/Spinner/OSpinner.vue'
import ODropdown from '@/lib/overlay/Dropdown/ODropdown.vue'
import ODropdownItem from '@/lib/overlay/Dropdown/ODropdownItem.vue'
import ODropdownSeparator from '@/lib/overlay/Dropdown/ODropdownSeparator.vue'
import OTooltip from '@/lib/overlay/Tooltip/OTooltip.vue'
import OEmptyState from '@/lib/core/EmptyState/OEmptyState.vue'
import { resolveBadge } from '@/lib/core/Badge/badgeGroups'

type Mode = 'all' | 'browser'

const props = withDefaults(defineProps<{
  mode: Mode
  data: any[]
  loading?: boolean
  footerTitle?: string
  emptyMessage?: string
  dataTest?: string
  toggleLoadingMap?: Record<string, boolean>
  triggerLoadingMap?: Record<string, boolean>
  selectedIds?: string[]
  showFolderColumn?: boolean
  bulkActionLoading?: boolean
}>(), {
  loading: false,
  footerTitle: 'Checks',
  emptyMessage: 'No results found.',
  dataTest: 'monitor-table',
  toggleLoadingMap: () => ({}),
  triggerLoadingMap: () => ({}),
  selectedIds: () => [],
  showFolderColumn: false,
  bulkActionLoading: false,
})

const emit = defineEmits<{
  'row-click': [row: any]
  'edit': [row: any]
  'toggle-enabled': [row: any]
  'duplicate': [row: any]
  'run': [row: any]
  'delete': [row: any]
  'update:selectedIds': [ids: string[]]
  'delete-selected': []
  'move-selected': []
  'pause-selected': []
  'enable-selected': []
  'trigger-selected': []
  'navigate-to-folder': [folderId: string]
  'empty-action': [actionId: string]
}>()

const { t } = useI18n()

const localSelectedIds = computed({
  get: () => props.selectedIds ?? [],
  set: (val: string[]) => emit('update:selectedIds', val),
})

// ── Column definitions per mode ─────────────────────────────────────

const STATUS_COL: OTableColumnDef = {
  id: 'status', header: t('synthetics.table.status'), accessorKey: 'status',
  size: COL.status, minSize: 72, sortable: true,
  meta: { align: 'left' },
}
const NAME_COL: OTableColumnDef = {
  id: 'name', header: t('synthetics.table.check'), accessorKey: 'name',
  size: COL.name, minSize: 120, sortable: true, hideable: true,
  meta: { isName: true, flex: true },
}
const TEST_NAME_COL: OTableColumnDef = {
  id: 'name', header: t('synthetics.table.testName'), accessorKey: 'name',
  size: COL.name, minSize: 120, sortable: true, hideable: true,
  meta: { isName: true, flex: true },
}
const URL_COL: OTableColumnDef = {
  id: 'url', header: t('synthetics.table.url'), accessorKey: 'url',
  size: COL.url, minSize: 140, sortable: false, hideable: true,
}
const ENDPOINT_COL: OTableColumnDef = {
  id: 'url', header: t('synthetics.table.endpoint'), accessorKey: 'url',
  size: COL.url, minSize: 140, sortable: false, hideable: true,
}
const TYPE_COL: OTableColumnDef = {
  id: 'type', header: t('synthetics.table.type'), accessorKey: 'type',
  size: COL.type, minSize: 72, sortable: true, hideable: true,
}
const HISTORY_COL: OTableColumnDef = {
  id: 'history', header: t('synthetics.table.history'), accessorKey: 'history',
  size: COL.history, minSize: 140, sortable: false, hideable: true,
}
const RESPONSE_TIME_COL: OTableColumnDef = {
  id: 'responseTime', header: t('synthetics.table.response'), accessorKey: 'responseTime',
  size: COL.responseTime, minSize: 72, sortable: true, meta: { align: 'right' }, hideable: true,
}
const PAGE_LOAD_COL: OTableColumnDef = {
  id: 'responseTime', header: t('synthetics.table.pageLoad'), accessorKey: 'responseTime',
  size: COL.responseTime, minSize: 80, sortable: true, meta: { align: 'right' }, hideable: true,
}
const P50_COL: OTableColumnDef = {
  id: 'responseTime', header: t('synthetics.table.p50'), accessorKey: 'responseTime',
  size: COL.responseTime, minSize: 64, sortable: true, meta: { align: 'right' }, hideable: true,
}
const UPTIME_COL: OTableColumnDef = {
  id: 'uptime', header: t('synthetics.table.uptime'), accessorKey: 'uptime',
  size: COL.uptime, minSize: 100, sortable: true, meta: { align: 'right' }, hideable: true,
}
const LOCATIONS_COL: OTableColumnDef = {
  id: 'locations', header: t('synthetics.table.locations'), accessorKey: 'locations',
  size: COL.locations, minSize: 90, sortable: false, hideable: true,
}
const INTERVAL_COL: OTableColumnDef = {
  id: 'interval', header: t('synthetics.table.interval'), accessorKey: 'interval',
  size: COL.interval, minSize: 60, sortable: false, hideable: true,
}
const LAST_CHECK_COL: OTableColumnDef = {
  id: 'lastCheck', header: t('synthetics.table.lastCheck'), accessorKey: 'lastCheck',
  size: COL.lastCheck, minSize: 72, sortable: false, hideable: true,
}
const LAST_RUN_COL: OTableColumnDef = {
  id: 'lastCheck', header: t('synthetics.table.lastCheck'), accessorKey: 'lastCheck',
  size: COL.lastCheck, minSize: 72, sortable: false, hideable: true,
}
const STEPS_COL: OTableColumnDef = {
  id: 'steps', header: t('synthetics.table.steps'), accessorKey: 'steps',
  size: COL.steps, minSize: 60, sortable: false, hideable: true,
}
const METHOD_COL: OTableColumnDef = {
  id: 'method', header: t('synthetics.table.method'), accessorKey: 'method',
  size: COL.method, minSize: 56, sortable: false, hideable: true,
}
const ASSERTIONS_COL: OTableColumnDef = {
  id: 'assertions', header: t('synthetics.table.assertions'), accessorKey: 'assertions',
  size: COL.assertions, minSize: 72, sortable: false, hideable: true,
}
const ACTIONS_COL: OTableColumnDef = {
  id: 'actions', header: '', accessorKey: 'id',
  size: 160, minSize: 160, sortable: false, isAction: true,
}
const FOLDER_COL: OTableColumnDef = {
  id: 'folder_name', header: t('synthetics.table.folder'), accessorKey: 'folder_name',
  size: COL.folder, minSize: 90, sortable: true, hideable: true,
}

const columns = computed<OTableColumnDef[]>(() => {
  let cols: OTableColumnDef[]
  if (props.mode === 'browser') {
    cols = [TEST_NAME_COL, URL_COL, STEPS_COL, HISTORY_COL, PAGE_LOAD_COL, UPTIME_COL, LAST_RUN_COL, STATUS_COL, ACTIONS_COL]
  } else {
    cols = [NAME_COL, URL_COL, TYPE_COL, STATUS_COL, RESPONSE_TIME_COL, LOCATIONS_COL, INTERVAL_COL, LAST_CHECK_COL, ACTIONS_COL]
  }
  if (props.showFolderColumn) {
    const nameIdx = cols.findIndex(c => c.id === 'name')
    cols.splice(nameIdx + 1, 0, FOLDER_COL)
  }
  return cols
})

// ── Locations tooltip ─────────────────────────────────────────────────

const locTip = ref({ show: false, x: 0, y: 0, locs: [] as string[] })
let locHideTimer: ReturnType<typeof setTimeout> | null = null

const showLoc = (e: MouseEvent, locs: string[]) => {
  if (locHideTimer) { clearTimeout(locHideTimer); locHideTimer = null }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  locTip.value = { show: true, x: rect.left, y: rect.bottom + 6, locs }
}
const hideLoc = () => {
  locHideTimer = setTimeout(() => { locTip.value.show = false }, 120)
}

// ── Spark tooltip ─────────────────────────────────────────────────────

interface HistoryTick {
  hour: string
  nextHour: string
  status: 'up' | 'down' | 'deg'
  avgMs: number | null
  checks: { loc: string; ok: boolean; ms: number | null }[]
}

const sparkTip = ref({ show: false, x: 0, y: 0, tick: null as HistoryTick | null })
let sparkHideTimer: ReturnType<typeof setTimeout> | null = null

const showSparkTip = (e: MouseEvent, tick: HistoryTick) => {
  if (sparkHideTimer) { clearTimeout(sparkHideTimer); sparkHideTimer = null }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  sparkTip.value = { show: true, x: rect.left + rect.width / 2, y: rect.top - 10, tick }
}
const hideSparkTip = () => {
  sparkHideTimer = setTimeout(() => { sparkTip.value.show = false }, 80)
}
const keepSparkTip = () => {
  if (sparkHideTimer) { clearTimeout(sparkHideTimer); sparkHideTimer = null }
}

onUnmounted(() => {
  if (locHideTimer) clearTimeout(locHideTimer)
  if (sparkHideTimer) clearTimeout(sparkHideTimer)
})


</script>
