// Copyright 2026 OpenObserve Inc.
<template>
  <OTable
    :columns="columns"
    :data="data"
    pagination="client"
    :page-size="20"
    :page-size-options="[10, 20, 25, 50]"
    row-key="id"
    :show-global-filter="false"
    :enable-column-resize="true"
    :footer-title="footerTitle"
    :empty-message="emptyMessage"
    :data-test="dataTest"
    @row-click="(row: any) => emit('row-click', row)"
  >
    <!-- Status dot -->
    <template #cell-status="{ row }">
      <span class="dot" :class="'dot--' + (row as any).status.toLowerCase()" />
    </template>

    <!-- Monitor name -->
    <template #cell-name="{ row }">
      <div class="mon-name">{{ (row as any).name }}</div>
    </template>

    <!-- URL / Endpoint -->
    <template #cell-url="{ row }">
      <div class="mon-url">{{ (row as any).url }}</div>
    </template>

    <!-- HTTP Method badge (API mode) -->
    <template #cell-method="{ row }">
      <span class="http-method" :class="'method--' + (row as any).method.toLowerCase()">{{ (row as any).method }}</span>
    </template>

    <!-- Steps count (Browser mode) -->
    <template #cell-steps="{ row }">
      <span class="tw:text-secondary">{{ (row as any).steps }} steps</span>
    </template>

    <!-- Assertions count (API mode) -->
    <template #cell-assertions="{ row }">
      <span class="tw:text-secondary">{{ (row as any).assertions }} checks</span>
    </template>

    <!-- Type badge (monitors mode) -->
    <template #cell-type="{ row }">
      <OBadge :variant="typeBadgeVariant((row as any).type)" size="sm">{{ (row as any).type }}</OBadge>
    </template>

    <!-- History sparkbars -->
    <template #cell-history="{ row }">
      <div class="spark">
        <span
          v-for="(tick, i) in (row as any).history"
          :key="i"
          class="spark-bar"
          :class="'spark--' + tick.status"
          @mouseenter="showSparkTip($event, tick)"
          @mouseleave="hideSparkTip"
        />
      </div>
    </template>

    <!-- Response time -->
    <template #cell-responseTime="{ row }">
      <span class="mono" :class="rtCls((row as any).responseTime)">{{ (row as any).responseTime ?? '—' }}</span>
    </template>

    <!-- Uptime with progress bar -->
    <template #cell-uptime="{ row }">
      <template v-if="(row as any).uptime !== null">
        <div class="uptime-row">
          <OProgressBar
            :value="(row as any).uptime / 100"
            :variant="(row as any).uptime >= 99 ? 'default' : (row as any).uptime >= 95 ? 'warning' : 'danger'"
            size="xs"
            class="tw:flex-1"
          />
          <span
            class="mono"
            :class="(row as any).uptime >= 99 ? 'c-g' : (row as any).uptime >= 95 ? 'c-a' : 'c-r'"
            style="min-width:44px;text-align:right;font-size:12px"
          >{{ (row as any).uptime }}%</span>
        </div>
      </template>
      <span v-else class="tw:text-secondary" style="font-size:13px">—</span>
    </template>

    <!-- Locations with tooltip (monitors mode) -->
    <template #cell-locations="{ row }">
      <div class="locs-cell" @mouseenter="showLoc($event, (row as any).locations)" @mouseleave="hideLoc">
        <span class="loc-first">{{ (row as any).locations[0] }}</span>
        <span v-if="(row as any).locations.length > 1" class="loc-badge">+{{ (row as any).locations.length - 1 }}</span>
      </div>
    </template>

    <!-- Interval (monitors mode) -->
    <template #cell-interval="{ row }">
      <span class="tw:text-secondary">{{ (row as any).interval }}</span>
    </template>

    <!-- Last check -->
    <template #cell-lastCheck="{ row }">
      <span class="tw:text-secondary">{{ (row as any).lastCheck }}</span>
    </template>

    <!-- Row actions -->
    <template #cell-actions="{ row }">
      <div class="tw:flex tw:items-center row-actions" @click.stop>
        <!-- Enable/Pause toggle with per-row spinner -->
        <div
          v-if="props.toggleLoadingMap[(row as any).id]"
          class="tw:flex tw:items-center tw:justify-center tw:w-7 tw:h-8"
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
  footerTitle?: string
  emptyMessage?: string
  dataTest?: string
  toggleLoadingMap?: Record<string, boolean>
}>(), {
  footerTitle: 'Monitors',
  emptyMessage: 'No results found.',
  dataTest: 'monitor-table',
  toggleLoadingMap: () => ({}),
})

const emit = defineEmits<{
  'row-click': [row: any]
  'edit': [row: any]
  'toggle-enabled': [row: any]
  'duplicate': [row: any]
  'run': [row: any]
  'delete': [row: any]
}>()

// ── Column definitions per mode ─────────────────────────────────────

const STATUS_COL: OTableColumnDef = {
  id: 'status', header: '', accessorKey: 'status',
  size: 36, minSize: 36, sortable: false,
  meta: { align: 'center', cellClass: 'tw:px-0' },
}
const NAME_COL: OTableColumnDef = {
  id: 'name', header: 'Monitor', accessorKey: 'name',
  size: 200, minSize: 120, sortable: true,
  meta: { isName: true, flex: true },
}
const TEST_NAME_COL: OTableColumnDef = {
  id: 'name', header: 'Test name', accessorKey: 'name',
  size: 200, minSize: 120, sortable: true,
  meta: { isName: true, flex: true },
}
const URL_COL: OTableColumnDef = {
  id: 'url', header: 'URL', accessorKey: 'url',
  size: 220, minSize: 140, sortable: false,
}
const ENDPOINT_COL: OTableColumnDef = {
  id: 'url', header: 'Endpoint', accessorKey: 'url',
  size: 240, minSize: 140, sortable: false,
}
const TYPE_COL: OTableColumnDef = {
  id: 'type', header: 'Type', accessorKey: 'type',
  size: 88, minSize: 72, sortable: true,
}
const HISTORY_COL: OTableColumnDef = {
  id: 'history', header: 'Status · Last 24h', accessorKey: 'history',
  size: 180, minSize: 140, sortable: false,
}
const RESPONSE_TIME_COL: OTableColumnDef = {
  id: 'responseTime', header: 'Response', accessorKey: 'responseTime',
  size: 90, minSize: 72, sortable: true, meta: { align: 'right' },
}
const PAGE_LOAD_COL: OTableColumnDef = {
  id: 'responseTime', header: 'Page load', accessorKey: 'responseTime',
  size: 110, minSize: 80, sortable: true, meta: { align: 'right' },
}
const P50_COL: OTableColumnDef = {
  id: 'responseTime', header: 'P50', accessorKey: 'responseTime',
  size: 80, minSize: 64, sortable: true, meta: { align: 'right' },
}
const UPTIME_COL: OTableColumnDef = {
  id: 'uptime', header: 'Uptime 7d', accessorKey: 'uptime',
  size: 130, minSize: 100, sortable: true, meta: { align: 'right' },
}
const LOCATIONS_COL: OTableColumnDef = {
  id: 'locations', header: 'Locations', accessorKey: 'locations',
  size: 120, minSize: 90, sortable: false,
}
const INTERVAL_COL: OTableColumnDef = {
  id: 'interval', header: 'Interval', accessorKey: 'interval',
  size: 72, minSize: 60, sortable: false,
}
const LAST_CHECK_COL: OTableColumnDef = {
  id: 'lastCheck', header: 'Last check', accessorKey: 'lastCheck',
  size: 90, minSize: 72, sortable: false,
}
const LAST_RUN_COL: OTableColumnDef = {
  id: 'lastCheck', header: 'Last run', accessorKey: 'lastCheck',
  size: 100, minSize: 72, sortable: false,
}
const STEPS_COL: OTableColumnDef = {
  id: 'steps', header: 'Steps', accessorKey: 'steps',
  size: 72, minSize: 60, sortable: false,
}
const METHOD_COL: OTableColumnDef = {
  id: 'method', header: 'Method', accessorKey: 'method',
  size: 64, minSize: 56, sortable: false,
}
const ASSERTIONS_COL: OTableColumnDef = {
  id: 'assertions', header: 'Assertions', accessorKey: 'assertions',
  size: 90, minSize: 72, sortable: false,
}
const ACTIONS_COL: OTableColumnDef = {
  id: 'actions', header: '', accessorKey: 'id',
  size: 160, minSize: 160, sortable: false, isAction: true,
}

const columns = computed<OTableColumnDef[]>(() => {
  if (props.mode === 'browser') {
    return [STATUS_COL, TEST_NAME_COL, URL_COL, STEPS_COL, HISTORY_COL, PAGE_LOAD_COL, UPTIME_COL, LAST_RUN_COL, ACTIONS_COL]
  }
  if (props.mode === 'api') {
    return [STATUS_COL, TEST_NAME_COL, METHOD_COL, ENDPOINT_COL, ASSERTIONS_COL, HISTORY_COL, P50_COL, UPTIME_COL, LAST_RUN_COL, ACTIONS_COL]
  }
  return [STATUS_COL, NAME_COL, URL_COL, TYPE_COL, HISTORY_COL, RESPONSE_TIME_COL, UPTIME_COL, LOCATIONS_COL, INTERVAL_COL, LAST_CHECK_COL, ACTIONS_COL]
})

// ── Utilities ────────────────────────────────────────────────────────

const rtCls = (rt: string | null) => {
  if (!rt) return 'c-r'
  const v = parseFloat(rt)
  return v < 300 ? 'c-g' : v < 1000 ? 'c-a' : 'c-r'
}

const typeBadgeVariant = (type: string): string => {
  const map: Record<string, string> = {
    HTTP: 'blue-soft', BROWSER: 'purple-soft', API: 'success-soft',
    TCP: 'orange-soft', PING: 'default-soft', DNS: 'amber-soft',
  }
  return map[type.toUpperCase()] ?? 'default-soft'
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
.dot         { display:inline-block; border-radius:50%; flex-shrink:0; }
.dot--up       { width:9px; height:9px; background:#22c55e; box-shadow:0 0 0 3px rgba(34,197,94,.15); }
.dot--degraded { width:9px; height:9px; background:#f59e0b; box-shadow:0 0 0 3px rgba(245,158,11,.15); }
.dot--down     { width:9px; height:9px; background:#ef4444; box-shadow:0 0 0 3px rgba(239,68,68,.15); }
.dot--unknown  { width:9px; height:9px; background:#94a3b8; box-shadow:0 0 0 3px rgba(148,163,184,.15); }

.mon-name { font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mon-url  { font-size:11px; font-family:monospace; color:var(--o2-tab-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

.http-method    { display:inline-block; padding:2px 7px; border-radius:4px; font-size:11px; font-weight:700; font-family:monospace; }
.method--get    { background:#dbeafe; color:#1d4ed8; }
.method--post   { background:#d1fae5; color:#065f46; }
.method--put    { background:#ffedd5; color:#c2410c; }
.method--delete { background:#fee2e2; color:#991b1b; }
.body--dark .method--get    { background:#172554; color:#93c5fd; }
.body--dark .method--post   { background:#052e16; color:#6ee7b7; }
.body--dark .method--put    { background:#431407; color:#fdba74; }
.body--dark .method--delete { background:#450a0a; color:#fca5a5; }

.spark { display:flex; align-items:flex-end; gap:2px; height:20px; }
.spark-bar {
  width:7px; height:18px; border-radius:2px; flex-shrink:0; cursor:pointer;
  transition:height .1s, opacity .1s, filter .1s;
}
.spark-bar:hover { height:20px; filter:brightness(1.25); }
.spark:has(.spark-bar:hover) .spark-bar:not(:hover) { opacity:.45; }
.spark--up   { background:#22c55e; }
.spark--down { background:#ef4444; }
.spark--deg  { background:#f59e0b; }

.uptime-row { display:flex; align-items:center; justify-content:flex-end; gap:8px; }

.locs-cell  { display:flex; align-items:center; gap:5px; cursor:default; }
.loc-first  { font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:70px; }
.loc-badge  { font-size:11px; font-weight:700; padding:1px 5px; background:rgba(128,128,128,.18); border-radius:4px; white-space:nowrap; flex-shrink:0; }

.row-actions { display:flex; align-items:center; gap:2px; }

.mono { font-family:monospace; font-size:13px; font-weight:600; }
.c-g  { color:#16a34a; }
.c-a  { color:#d97706; }
.c-r  { color:#dc2626; }

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
