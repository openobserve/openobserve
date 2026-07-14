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
    @row-click="(row: any) => emit('row-click', row)"
  >
    <!-- Toolbar slots (passthrough to parent) -->
    <template #toolbar>
      <slot name="toolbar" />
    </template>
    <template #toolbar-trailing>
      <slot name="toolbar-trailing" />
    </template>

    <!-- Status dot -->
    <template #cell-status="{ row }">
      <span :class="dotCls((row as any).status)" />
    </template>

    <!-- Monitor name -->
    <template #cell-name="{ row }">
      <div class="text-sm font-semibold truncate">{{ (row as any).name }}</div>
    </template>

    <!-- URL / Endpoint -->
    <template #cell-url="{ row }">
      <div class="text-xs font-mono text-text-code truncate">{{ (row as any).url }}</div>
    </template>

    <!-- HTTP Method badge (API mode) -->
    <template #cell-method="{ row }">
      <span class="inline-flex items-center px-1.5 py-0.5 rounded-sm text-xs font-bold font-mono" :class="methodCls((row as any).method)">{{ (row as any).method }}</span>
    </template>

    <!-- Steps count (Browser mode) -->
    <template #cell-steps="{ row }">
      <span class="text-secondary">{{ (row as any).steps }} steps</span>
    </template>

    <!-- Assertions count (API mode) -->
    <template #cell-assertions="{ row }">
      <span class="text-secondary">{{ (row as any).assertions }} checks</span>
    </template>

    <!-- Folder name (cross-folder search mode) — click navigates sidebar to that folder -->
    <template #cell-folder_name="{ row }">
      <button
        class="text-xs text-text-link cursor-pointer bg-transparent border-0 p-0 hover:underline"
        @click.stop="emit('navigate-to-folder', (row as any).folderId)"
      >
        {{ (row as any).folder_name ?? '—' }}
      </button>
    </template>

    <!-- Type badge (monitors mode) -->
    <template #cell-type="{ row }">
      <OBadge :variant="typeBadgeVariant((row as any).type)" size="sm">{{ formatType((row as any).type) }}</OBadge>
    </template>

    <!-- History sparkbars -->
    <template #cell-history="{ row }">
      <div class="spark">
        <span
          v-for="(tick, i) in (row as any).history"
          :key="i"
          class="spark-bar"
          :class="tick.status === 'up' ? 'bg-success-500' : tick.status === 'down' ? 'bg-error-500' : 'bg-warning-500'"
          @mouseenter="showSparkTip($event, tick)"
          @mouseleave="hideSparkTip"
        />
      </div>
    </template>

    <!-- Response time -->
    <template #cell-responseTime="{ row }">
      <span :class="'font-mono text-sm font-semibold ' + rtCls((row as any).responseTime)">{{ (row as any).responseTime ?? '—' }}</span>
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
            :class="'font-mono text-sm font-semibold min-w-[44px] text-right text-xs '
              + ((row as any).uptime >= 99 ? 'text-success-600' : (row as any).uptime >= 95 ? 'text-amber-600' : 'text-error-600')"
          >{{ (row as any).uptime }}%</span>
        </div>
      </template>
      <span v-else class="text-xs text-text-secondary">—</span>
    </template>

    <!-- Locations with tooltip (monitors mode) -->
    <template #cell-locations="{ row }">
      <div class="flex items-center gap-1 cursor-default" @mouseenter="showLoc($event, (row as any).locations)" @mouseleave="hideLoc">
        <span class="text-xs truncate max-w-[70px]">{{ (row as any).locations[0] }}</span>
        <span v-if="(row as any).locations.length > 1" class="text-xs font-bold px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 whitespace-nowrap shrink-0">+{{ (row as any).locations.length - 1 }}</span>
      </div>
    </template>

    <!-- Interval (monitors mode) -->
    <template #cell-interval="{ row }">
      <span class="text-secondary">{{ (row as any).interval }}</span>
    </template>

    <!-- Last check -->
    <template #cell-lastCheck="{ row }">
      <span class="text-secondary">{{ (row as any).lastCheck }}</span>
    </template>

    <!-- Row actions -->
    <template #cell-actions="{ row }">
      <div class="flex items-center gap-0.5" @click.stop>
        <!-- Enable/Pause toggle with per-row spinner -->
        <div
          v-if="props.toggleLoadingMap[(row as any).id]"
          class="flex items-center justify-center w-7 h-8"
          :title="(row as any).enabled ? 'Pausing…' : 'Enabling…'"
          :data-test="`${dataTest}-toggle-spinner`"
        >
          <OSpinner size="xs" />
        </div>
        <OButton
          v-else
          :variant="(row as any).enabled ? 'ghost-destructive' : 'ghost'"
          size="icon-sm"
          :icon-left="(row as any).enabled ? 'pause' : 'play-arrow'"
          :title="(row as any).enabled ? 'Pause' : 'Enable'"
          :data-test="`${dataTest}-${(row as any).enabled ? 'pause' : 'enable'}-btn`"
          @click.stop="emit('toggle-enabled', row)"
        />

        <!-- Edit -->
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="edit"
          title="Edit"
          :data-test="`${dataTest}-edit-btn`"
          @click.stop="emit('edit', row)"
        />

        <!-- Duplicate -->
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="content-copy"
          title="Duplicate"
          :data-test="`${dataTest}-duplicate-btn`"
          @click.stop="emit('duplicate', row)"
        />

        <!-- More menu: Trigger + Delete -->
        <ODropdown>
          <template #trigger>
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="more-vert"
              title="More"
              :data-test="`${dataTest}-more-btn`"
              @click.stop
            />
          </template>

          <ODropdownItem :data-test="`${dataTest}-run-item`" @select="emit('run', row)">
            <template #icon-left>
              <OIcon name="sound-sampler" size="sm" />
            </template>
            Trigger
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
            Delete
          </ODropdownItem>
        </ODropdown>
      </div>
    </template>

    <!-- Footer with count + bulk action buttons -->
    <template #bottom>
      <div class="flex items-center gap-2 px-4 py-2">
        <span class="text-sm text-secondary">{{ data.length }} {{ footerTitle }}</span>
        <template v-if="localSelectedIds.length > 0">
          <OButton
            variant="outline"
            size="sm"
            :data-test="`${dataTest}-move-selected-btn`"
            @click="emit('move-selected')"
          >
            <OIcon name="drive-file-move" size="sm" />
            <span class="ml-1">Move</span>
          </OButton>
          <OButton
            variant="outline-destructive"
            size="sm"
            :data-test="`${dataTest}-delete-selected-btn`"
            @click="emit('delete-selected')"
          >
            <OIcon name="delete" size="sm" />
            <span class="ml-1">Delete</span>
          </OButton>
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
          {{ sparkTip.tick.status === 'up' ? '✓ Up' : sparkTip.tick.status === 'down' ? '✗ Down' : '⚠ Degraded' }}
        </span>
      </div>
      <div class="stt-divider" />
      <div class="stt-checks">
        <div v-for="c in sparkTip.tick.checks" :key="c.loc" class="stt-check">
          <span class="stt-dot" :class="c.ok ? 'stt-dot--up' : 'stt-dot--down'" />
          <span class="stt-loc">{{ c.loc }}</span>
          <span class="stt-ms">{{ c.ms !== null ? c.ms + 'ms' : 'Timeout' }}</span>
        </div>
      </div>
      <div v-if="sparkTip.tick.avgMs !== null" class="stt-avg">Avg · {{ sparkTip.tick.avgMs }}ms</div>
      <div class="stt-arrow" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import OTable from '@/lib/core/Table/OTable.vue'
import type { OTableColumnDef } from '@/lib/core/Table/OTable.types'
import OButton from '@/lib/core/Button/OButton.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OBadge from '@/lib/core/Badge/OBadge.vue'
import OProgressBar from '@/lib/data/ProgressBar/OProgressBar.vue'
import OSpinner from '@/lib/feedback/Spinner/OSpinner.vue'
import ODropdown from '@/lib/overlay/Dropdown/ODropdown.vue'
import ODropdownItem from '@/lib/overlay/Dropdown/ODropdownItem.vue'
import ODropdownSeparator from '@/lib/overlay/Dropdown/ODropdownSeparator.vue'

type Mode = 'monitors' | 'browser' | 'api'

const props = withDefaults(defineProps<{
  mode: Mode
  data: any[]
  loading?: boolean
  footerTitle?: string
  emptyMessage?: string
  dataTest?: string
  toggleLoadingMap?: Record<string, boolean>
  selectedIds?: string[]
  showFolderColumn?: boolean
}>(), {
  loading: false,
  footerTitle: 'Checks',
  emptyMessage: 'No results found.',
  dataTest: 'monitor-table',
  toggleLoadingMap: () => ({}),
  selectedIds: () => [],
  showFolderColumn: false,
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
  'navigate-to-folder': [folderId: string]
}>()

const localSelectedIds = computed({
  get: () => props.selectedIds ?? [],
  set: (val: string[]) => emit('update:selectedIds', val),
})

// ── Column definitions per mode ─────────────────────────────────────

const STATUS_COL: OTableColumnDef = {
  id: 'status', header: '', accessorKey: 'status',
  size: 36, minSize: 36, sortable: false,
  meta: { align: 'center', cellClass: 'px-0' },
}
const NAME_COL: OTableColumnDef = {
  id: 'name', header: 'Check', accessorKey: 'name',
  size: 200, minSize: 120, sortable: true, hideable: true,
  meta: { isName: true, flex: true },
}
const TEST_NAME_COL: OTableColumnDef = {
  id: 'name', header: 'Test name', accessorKey: 'name',
  size: 200, minSize: 120, sortable: true, hideable: true,
  meta: { isName: true, flex: true },
}
const URL_COL: OTableColumnDef = {
  id: 'url', header: 'URL', accessorKey: 'url',
  size: 220, minSize: 140, sortable: false, hideable: true,
}
const ENDPOINT_COL: OTableColumnDef = {
  id: 'url', header: 'Endpoint', accessorKey: 'url',
  size: 240, minSize: 140, sortable: false, hideable: true,
}
const TYPE_COL: OTableColumnDef = {
  id: 'type', header: 'Type', accessorKey: 'type',
  size: 88, minSize: 72, sortable: true, hideable: true,
}
const HISTORY_COL: OTableColumnDef = {
  id: 'history', header: 'Status · Last 24h', accessorKey: 'history',
  size: 180, minSize: 140, sortable: false, hideable: true,
}
const RESPONSE_TIME_COL: OTableColumnDef = {
  id: 'responseTime', header: 'Response', accessorKey: 'responseTime',
  size: 90, minSize: 72, sortable: true, meta: { align: 'right' }, hideable: true,
}
const PAGE_LOAD_COL: OTableColumnDef = {
  id: 'responseTime', header: 'Page load', accessorKey: 'responseTime',
  size: 110, minSize: 80, sortable: true, meta: { align: 'right' }, hideable: true,
}
const P50_COL: OTableColumnDef = {
  id: 'responseTime', header: 'P50', accessorKey: 'responseTime',
  size: 80, minSize: 64, sortable: true, meta: { align: 'right' }, hideable: true,
}
const UPTIME_COL: OTableColumnDef = {
  id: 'uptime', header: 'Uptime 7d', accessorKey: 'uptime',
  size: 130, minSize: 100, sortable: true, meta: { align: 'right' }, hideable: true,
}
const LOCATIONS_COL: OTableColumnDef = {
  id: 'locations', header: 'Locations', accessorKey: 'locations',
  size: 120, minSize: 90, sortable: false, hideable: true,
}
const INTERVAL_COL: OTableColumnDef = {
  id: 'interval', header: 'Interval', accessorKey: 'interval',
  size: 72, minSize: 60, sortable: false, hideable: true,
}
const LAST_CHECK_COL: OTableColumnDef = {
  id: 'lastCheck', header: 'Last check', accessorKey: 'lastCheck',
  size: 90, minSize: 72, sortable: false, hideable: true,
}
const LAST_RUN_COL: OTableColumnDef = {
  id: 'lastCheck', header: 'Last check', accessorKey: 'lastCheck',
  size: 100, minSize: 72, sortable: false, hideable: true,
}
const STEPS_COL: OTableColumnDef = {
  id: 'steps', header: 'Steps', accessorKey: 'steps',
  size: 72, minSize: 60, sortable: false, hideable: true,
}
const METHOD_COL: OTableColumnDef = {
  id: 'method', header: 'Method', accessorKey: 'method',
  size: 64, minSize: 56, sortable: false, hideable: true,
}
const ASSERTIONS_COL: OTableColumnDef = {
  id: 'assertions', header: 'Assertions', accessorKey: 'assertions',
  size: 90, minSize: 72, sortable: false, hideable: true,
}
const ACTIONS_COL: OTableColumnDef = {
  id: 'actions', header: '', accessorKey: 'id',
  size: 160, minSize: 160, sortable: false, isAction: true,
}
const FOLDER_COL: OTableColumnDef = {
  id: 'folder_name', header: 'Folder', accessorKey: 'folder_name',
  size: 120, minSize: 90, sortable: true, hideable: true,
}

const columns = computed<OTableColumnDef[]>(() => {
  let cols: OTableColumnDef[]
  console.log(props.mode);
  if (props.mode === 'browser') {
    cols = [STATUS_COL, TEST_NAME_COL, URL_COL, STEPS_COL, HISTORY_COL, PAGE_LOAD_COL, UPTIME_COL, LAST_RUN_COL, ACTIONS_COL]
  } else if (props.mode === 'api') {
    cols = [STATUS_COL, TEST_NAME_COL, METHOD_COL, ENDPOINT_COL, ASSERTIONS_COL, HISTORY_COL, P50_COL, UPTIME_COL, LAST_RUN_COL, ACTIONS_COL]
  } else {
    cols = [STATUS_COL, NAME_COL, URL_COL, TYPE_COL, RESPONSE_TIME_COL, LOCATIONS_COL, INTERVAL_COL, LAST_CHECK_COL, ACTIONS_COL]
  }
  if (props.showFolderColumn) {
    const nameIdx = cols.findIndex(c => c.id === 'name')
    cols.splice(nameIdx + 1, 0, FOLDER_COL)
  }
  return cols
})

// ── Utilities ────────────────────────────────────────────────────────

const rtCls = (rt: string | null) => {
  if (!rt) return 'text-error-600'
  const v = parseFloat(rt)
  return v < 300 ? 'text-success-600' : v < 1000 ? 'text-amber-600' : 'text-error-600'
}

const dotCls = (status: string): string => {
  const map: Record<string, string> = {
    up: 'size-[9px] rounded-full shrink-0 bg-success-500 shadow-[0_0_0_3px_var(--color-success-500)/0.15]',
    degraded: 'size-[9px] rounded-full shrink-0 bg-warning-500 shadow-[0_0_0_3px_var(--color-warning-500)/0.15]',
    down: 'size-[9px] rounded-full shrink-0 bg-error-500 shadow-[0_0_0_3px_var(--color-error-500)/0.15]',
    unknown: 'size-[9px] rounded-full shrink-0 bg-neutral-400 shadow-[0_0_0_3px_var(--color-neutral-400)/0.15]',
  }
  return map[status.toLowerCase()] ?? map.unknown
}

const methodCls = (method: string): string => {
  const map: Record<string, string> = {
    get: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
    post: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
    put: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
    delete: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  }
  return map[method.toLowerCase()] ?? 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
}

const typeBadgeVariant = (type: string): string => {
  const map: Record<string, string> = {
    HTTP: 'blue-soft', BROWSER: 'purple-soft', API: 'success-soft',
    TCP: 'orange-soft', PING: 'default-soft', DNS: 'amber-soft',
  }
  return map[type.toUpperCase()] ?? 'default-soft'
}

const formatType = (type: string): string => {
  return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()
}

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

<style scoped>
/* Sparkbar — container, bar shape, hover/dim interaction (kept: :has() can't be expressed in Tailwind) */
.spark { display:flex; align-items:flex-end; gap:2px; height:20px; }
.spark-bar {
  width:7px; height:18px; border-radius:2px; flex-shrink:0; cursor:pointer;
  transition:height .1s, opacity .1s, filter .1s;
}
.spark-bar:hover { height:20px; filter:brightness(1.25); }
.spark:has(.spark-bar:hover) .spark-bar:not(:hover) { opacity:.45; }

/* Locations tooltip */
.loc-float-tip  { position:fixed; z-index:9999; background:#1e293b; color:#f1f5f9; border-radius:8px; padding:9px 13px; box-shadow:0 8px 24px rgba(0,0,0,.28); min-width:150px; pointer-events:none; }
.loc-float-item { display:flex; align-items:center; gap:7px; font-size:12px; padding:3px 0; border-bottom:1px solid rgba(255,255,255,.07); }
.loc-float-item:last-child { border-bottom:none; }
.loc-float-dot  { width:6px; height:6px; border-radius:50%; background:#22c55e; flex-shrink:0; }

/* Spark tooltip */
.spark-tooltip {
  position:fixed; z-index:10000;
  background:#1e293b; color:#f1f5f9;
  border-radius:9px; padding:10px 13px;
  box-shadow:0 10px 32px rgba(0,0,0,.4);
  min-width:210px; max-width:280px;
  pointer-events:auto;
  transform:translateX(-50%) translateY(-100%);
  font-size:12px;
}
.stt-header { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:7px; }
.stt-time   { font-size:11px; opacity:.65; white-space:nowrap; }
.stt-badge  { font-size:11px; font-weight:700; padding:2px 8px; border-radius:4px; white-space:nowrap; }
.stt-badge--up   { background:rgba(34,197,94,.2);  color:#4ade80; }
.stt-badge--down { background:rgba(239,68,68,.2);  color:#f87171; }
.stt-badge--deg  { background:rgba(245,158,11,.2); color:#fbbf24; }
.stt-divider { height:1px; background:rgba(255,255,255,.08); margin-bottom:8px; }
.stt-checks  { display:flex; flex-direction:column; gap:5px; margin-bottom:8px; }
.stt-check   { display:flex; align-items:center; gap:7px; }
.stt-dot     { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
.stt-dot--up   { background:#22c55e; box-shadow:0 0 5px rgba(34,197,94,.5); }
.stt-dot--down { background:#ef4444; box-shadow:0 0 5px rgba(239,68,68,.5); }
.stt-loc     { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stt-ms      { font-size:11px; color:rgba(241,245,249,.55); white-space:nowrap; font-family:monospace; }
.stt-avg     { font-size:11px; color:rgba(241,245,249,.5); border-top:1px solid rgba(255,255,255,.08); padding-top:6px; font-family:monospace; }
.stt-arrow   {
  position:absolute; bottom:-7px; left:50%; transform:translateX(-50%);
  width:0; height:0;
  border-left:7px solid transparent;
  border-right:7px solid transparent;
  border-top:7px solid #1e293b;
}
</style>
