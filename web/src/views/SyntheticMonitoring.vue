<template>
  <div class="flex flex-col h-full overflow-hidden relative">

    <!-- PAGE HEADER -->
    <div class="flex items-center justify-between px-5 py-3 border-b border-border-default shrink-0 bg-surface-base">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-primary-600 dark:bg-white/10 bg-black/5">
          <OIcon name="radar" size="md" />
        </div>
        <div>
          <div class="text-sm font-bold leading-tight">Synthetic Checks</div>
          <div class="text-xs text-text-secondary mt-px">Proactively monitor uptime, performance, and user journeys from global locations</div>
        </div>
      </div>
      <div class="flex items-center gap-2.5">
        <OButton v-if="false" variant="ghost" size="sm" :class="{ 'geo-hdr-btn--alert': geoIssues.length }" @click="showIssuesModal = true">
          <template #icon-left><OIcon :name="geoIssues.length ? 'error' : 'check-circle'" size="xs" /></template>
          Active Issues
          <span v-if="geoIssues.length" class="geo-hdr-badge">{{ geoIssues.length }}</span>
        </OButton>
        <OButton v-if="false" variant="ghost" size="sm" @click="showHeatmapModal = true">
          <template #icon-left><OIcon name="language" size="xs" /></template>
          Geo Map
        </OButton>
        <OButton size="sm" variant="primary" @click="openCreate">
          New Check
        </OButton>
      </div>
    </div>

    <!-- CONTENT AREA: sidebar + main -->
    <div class="flex flex-1 overflow-hidden">
      <!-- LEFT SIDEBAR: folder navigation -->
      <div class="w-[14.375rem] shrink-0 border-r border-border-default overflow-y-auto">
        <FolderList
          type="synthetics"
          data-test="synthetic-monitoring-folder-list"
          @update:activeFolderId="updateActiveFolderId"
        />
      </div>

      <!-- RIGHT MAIN: filter bar + table -->
      <div class="flex-1 flex flex-col overflow-hidden min-w-0">
        <!-- Tab switcher (only visible when multi-type tests are enabled) -->
        <div v-if="areMultiTypeTestEnabled" class="flex items-center gap-2 px-3 py-2 border-b border-border-default">
          <OToggleGroup
            :model-value="activeTab"
            @update:model-value="(v) => { activeTab = v as string }"
          >
            <OToggleGroupItem v-for="tab in tabs" :key="tab.key" :value="tab.key" size="sm">
              {{ tab.label }}
            </OToggleGroupItem>
          </OToggleGroup>
          <template v-if="activeTab === 'private'">
            <div class="flex-1" />
            <OButton variant="primary">
              <template #icon-left><OIcon name="add" size="sm" /></template>
              Add Location
            </OButton>
          </template>
        </div>

        <!-- ── CHECKS TABLE (All Checks / Browser Tests / API Tests) ── -->
        <MonitorTable
          v-if="activeTab === 'monitors' || activeTab === 'browser' || activeTab === 'api'"
          :mode="monitorTableMode"
          :data="activeTab === 'browser' ? browserMonitors : activeTab === 'api' ? apiMonitors : filteredMonitors"
          :loading="loading"
          :footer-title="activeTab === 'browser' ? 'Browser Tests' : activeTab === 'api' ? 'API Tests' : 'Checks'"
          :empty-message="activeTab === 'browser' ? 'No browser tests found.' : activeTab === 'api' ? 'No API tests found.' : 'No checks found. Adjust filters or create your first check.'"
          :selected-ids="selectedMonitorIds"
          :show-folder-column="searchAcrossFolders"
          data-test="synthetic-monitoring-monitors-table"
          :toggle-loading-map="toggleLoadingMap"
          :trigger-loading-map="triggerLoadingMap"
          :bulk-action-loading="bulkActionLoading"
          @row-click="openDetail"
          @edit="openEdit"
          @toggle-enabled="toggleEnabled"
          @duplicate="duplicateMonitor"
          @run="runMonitor"
          @delete="deleteMonitor"
          @update:selected-ids="selectedMonitorIds = $event"
          @delete-selected="openBulkDeleteConfirm"
          @move-selected="moveMultipleMonitors"
          @pause-selected="bulkPauseMonitors"
          @enable-selected="bulkEnableMonitors"
          @trigger-selected="bulkTriggerMonitors"
          @navigate-to-folder="(id) => { searchAcrossFolders = false; updateActiveFolderId(id) }"
          @empty-action="(actionId) => { if (actionId === 'create') openCreate() }"
        >
          <!-- Toolbar content rendered inside OTable's toolbar bar -->
          <template #toolbar>
            <div class="flex items-center gap-2 w-full">
              <!-- Status filter -- only on All Checks tab -->
              <template v-if="activeTab === 'monitors'">
                <OToggleGroup
                  :model-value="statusFilter"
                  @update:model-value="(v) => { statusFilter = v as string }"
                >
                  <OToggleGroupItem v-for="s in statusTabs" :key="s.filter" :value="s.filter" size="sm">
                    <span v-if="s.filter !== 'all'" class="w-1.5 h-1.5 rounded-full shrink-0" :class="dotClass(s.filter)" />
                    {{ s.label }} <span class="text-[0.6875rem] font-bold">{{ s.count }}</span>
                  </OToggleGroupItem>
                </OToggleGroup>
              </template>

              <!-- Search -->
              <div class="flex-1 min-w-0">
                <OInput
                  v-model="search"
                  :placeholder="searchAcrossFolders ? 'Search across all folders...' : activeTab === 'browser' ? 'Search browser tests...' : activeTab === 'api' ? 'Search API tests...' : 'Search this folder...'"
                  data-test="synthetic-monitoring-search-input"
                  class="w-full"
                >
                  <template #icon-right>
                    <OToggleGroup
                      :model-value="searchAcrossFolders ? 'all' : 'this'"
                      @update:model-value="(v) => { searchAcrossFolders = v === 'all' }"
                    >
                      <OToggleGroupItem value="this" size="xs" icon-left="folder-outline" data-test="synthetic-monitoring-search-this-folder-btn">
                        This folder
                      </OToggleGroupItem>
                      <OToggleGroupItem value="all" size="xs" icon-left="search" data-test="synthetic-monitoring-search-all-folders-btn">
                        All folders
                      </OToggleGroupItem>
                    </OToggleGroup>
                  </template>
                </OInput>
              </div>

              <!-- Type + Location dropdowns -- only on All Checks tab -->
              <template v-if="activeTab === 'monitors'">
                <OSelect
                  v-if="areMultiTypeTestEnabled"
                  v-model="typeFilter"
                  :options="typeOpts"
                  size="md"
                />
                <OSelect
                  v-if="areMultiTypeTestEnabled"
                  v-model="locationFilter"
                  :options="locationOpts"
                  size="md"
                />
              </template>
            </div>
          </template>

          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              class="w-8!"
              icon-left="refresh"
              :loading="loading"
              title="Refresh"
              data-test="synthetic-monitoring-refresh-btn"
              @click="loadMonitors()"
            />
          </template>
        </MonitorTable>

        <!-- ── PRIVATE LOCATIONS ── -->
        <PrivateLocations
          v-else-if="activeTab === 'private'"
          :locations="privateLocations"
          data-test="synthetic-monitoring-private-locations"
        />
      </div>
    </div>


    <!-- Map dot tooltip -->
    <Teleport to="body">
      <div v-if="mapTip.show && mapTip.stat"
        class="fixed z-[9999] px-3 py-2.5 bg-gray-800 text-gray-100 rounded-xl text-xs min-w-[10.625rem] pointer-events-auto shadow-lg"
        :style="{ left: mapTip.x + 'px', top: mapTip.y + 'px' }"
        @mouseenter="keepMapTip"
        @mouseleave="hideMapTip">
        <div class="flex items-center justify-between gap-2.5 mb-1.5">
          <span class="text-[0.6875rem] opacity-65 whitespace-nowrap">{{ mapTip.stat.flag }} {{ mapTip.stat.label }}</span>
          <span class="text-[0.6875rem] font-bold px-2 py-0.5 rounded whitespace-nowrap"
            :class="{
              'bg-status-success-bg/70 text-status-success-text': mapTip.stat.health === 'up',
              'bg-status-error-bg/70 text-status-error-text': mapTip.stat.health === 'down',
              'bg-status-warning-bg/70 text-status-warning-text': mapTip.stat.health === 'deg',
            }">
            {{ mapTip.stat.health === 'up' ? '✓ Healthy' : mapTip.stat.health === 'down' ? '✗ Outage' : '⚠ Degraded' }}
          </span>
        </div>
        <hr class="border-white/10 mb-2" />
        <div class="flex justify-between gap-4 mt-1 text-[0.6875rem]"><span>Uptime</span><span class="font-semibold">{{ mapTip.stat.uptime }}%</span></div>
        <div class="flex justify-between gap-4 mt-1 text-[0.6875rem]"><span>Checks</span><span class="font-semibold">{{ mapTip.stat.total }}</span></div>
        <div v-if="mapTip.stat.downCt" class="flex justify-between gap-4 mt-1 text-[0.6875rem]"><span>Down</span><span class="font-semibold text-status-error-text">{{ mapTip.stat.downCt }}</span></div>
        <div v-if="mapTip.stat.degCt" class="flex justify-between gap-4 mt-1 text-[0.6875rem]"><span>Degraded</span><span class="font-semibold text-status-warning-text">{{ mapTip.stat.degCt }}</span></div>
        <div class="flex justify-between gap-4 mt-1 text-[0.6875rem]"><span>City</span><span class="font-semibold">{{ mapTip.stat.city }}</span></div>
      </div>
    </Teleport>

    <!-- Full Heatmap Modal -->
    <ODialog v-model:open="showHeatmapModal" title="Global Health Heatmap" :width="94">
      <template #header-right>
        <div class="flex items-center gap-3 ml-2 flex-1">
          <span class="flex items-center gap-1.5 text-[0.6875rem] text-text-secondary"><span class="inline-block w-2 h-2 rounded-full shrink-0 bg-status-success-text" /><span>Healthy</span></span>
          <span class="flex items-center gap-1.5 text-[0.6875rem] text-text-secondary"><span class="inline-block w-2 h-2 rounded-full shrink-0 bg-status-warning-text" /><span>Degraded</span></span>
          <span class="flex items-center gap-1.5 text-[0.6875rem] text-text-secondary"><span class="inline-block w-2 h-2 rounded-full shrink-0 bg-status-error-text" /><span>Down</span></span>
        </div>
      </template>
      <div class="flex-none h-[clamp(22.5rem,46vw,33.75rem)] overflow-hidden p-0">
        <div ref="heatmapChartEl" class="w-full h-full"></div>
      </div>
    </ODialog>

    <!-- Active Issues Modal -->
    <ODialog v-model:open="showIssuesModal" size="sm">
      <template #header>
        <OIcon :name="geoIssues.length ? 'error' : 'check-circle'" size="sm" :class="geoIssues.length ? 'text-status-error-text' : 'text-status-success-text'"/>
        <span class="text-base font-semibold">Active Issues</span>
      </template>
      <div class="flex-1 overflow-y-auto">
        <!-- All clear -->
        <template v-if="!geoIssues.length">
          <div class="flex flex-col items-center justify-center py-12 px-6 text-center">
            <OIcon name="check-circle" size="lg" class="text-status-success-text"/>
            <div class="font-semibold mt-2">All regions healthy</div>
            <div class="text-xs text-text-secondary mt-1">No active issues detected across all monitoring locations.</div>
          </div>
        </template>
        <!-- Issue rows -->
        <template v-else>
          <div v-if="geoLocStats.filter(s=>s.health!=='up').length >= 2" class="flex items-center gap-2 mx-4 mt-3 px-3 py-2 bg-status-warning-bg text-status-warning-text rounded-lg text-xs">
            <OIcon name="warning-amber" size="sm"/> {{ geoLocStats.filter(s=>s.health!=='up').length }} regions simultaneously affected — possible CDN or upstream incident
          </div>
          <div class="px-4 pb-4 pt-2 flex flex-col gap-1.5">
            <div v-for="issue in geoIssues" :key="issue.key" class="flex items-center justify-between px-3.5 py-3 rounded-xl border border-border-default" :class="issue.level==='error'?'bg-status-error-bg/5 border-status-error-text/20':'bg-status-warning-bg/5 border-status-warning-text/20'">
              <div class="flex items-center gap-2.5">
                <span class="w-2.5 h-2.5 rounded-full shrink-0" :class="issue.level==='error'?'bg-status-error-text':'bg-status-warning-text'"/>
                <div>
                  <div class="text-[0.8125rem] font-semibold">{{ issue.stat.flag }} {{ issue.stat.label }}</div>
                  <div class="text-[0.6875rem] text-text-secondary mt-px">{{ issue.stat.city }}</div>
                </div>
              </div>
              <div class="flex flex-col items-end gap-0.5">
                <span class="text-[0.625rem] font-bold px-2 py-0.5 rounded-md whitespace-nowrap" :class="issue.level==='error'?'bg-status-error-bg text-status-error-text':'bg-status-warning-bg text-status-warning-text'">
                  {{ issue.level==='error' ? issue.stat.downCt + ' down' : issue.stat.degCt + ' degraded' }}
                </span>
                <div class="text-xs font-bold" :class="issue.level==='error'?'text-status-error-text':'text-status-warning-text'">{{ issue.stat.uptime }}% uptime</div>
                <div class="text-[0.625rem] text-text-secondary">{{ issue.stat.total }} checks</div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </ODialog>

    <!-- DRAWER -->
    <MonitorFormDrawer
      v-model:open="showDrawer"
      :edit-target="editTarget"
      :online-private-locations="onlinePrivateLocations"
      data-test="synthetic-monitoring-monitor-form-drawer"
      @save="() => {}"
    />

    <!-- Duplicate check dialog -->
    <ODialog
      v-model:open="showDuplicateDialog"
      size="sm"
      title="Duplicate Check"
      primary-button-label="Save"
      secondary-button-label="Cancel"
      :primary-button-disabled="isDuplicating || !duplicateName.trim()"
      data-test="synthetic-monitoring-duplicate-dialog"
      @click:primary="saveDuplicate"
      @click:secondary="showDuplicateDialog = false"
    >
      <div class="flex flex-col gap-3 py-1">
        <OInput
          v-model="duplicateName"
          label="Name"
          placeholder="Check name"
          data-test="synthetic-monitoring-duplicate-name-input"
        />
        <OInput
          v-model="duplicateFolder"
          label="Folder"
          placeholder="default"
          data-test="synthetic-monitoring-duplicate-folder-input"
        />
      </div>
    </ODialog>

    <!-- Bulk delete confirmation dialog -->
    <ODialog
      v-model:open="showBulkDeleteConfirm"
      size="sm"
      title="Delete Checks"
      primary-button-label="Delete"
      secondary-button-label="Cancel"
      primary-button-variant="destructive"
      data-test="synthetic-monitoring-bulk-delete-dialog"
      @click:primary="bulkDeleteMonitors"
      @click:secondary="showBulkDeleteConfirm = false"
    >
      <p class="py-2">
        Are you sure you want to delete {{ selectedMonitorIds.length }} monitor{{ selectedMonitorIds.length !== 1 ? 's' : '' }}? This action cannot be undone.
      </p>
    </ODialog>

    <!-- Move checks dialog -->
    <MoveAcrossFolders
      type="synthetics"
      :module-id="monitorsToMove"
      :active-folder-id="activeFolderId"
      :open="showMoveDialog"
      data-test="synthetic-monitoring-move-dialog"
      @updated="onMoveUpdated"
      @update:open="showMoveDialog = $event"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import * as echarts from "echarts";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import MonitorTable from "@/components/synthetic-monitoring/MonitorTable.vue";
import FolderList from "@/components/common/sidebar/FolderList.vue";
import MoveAcrossFolders from "@/components/common/sidebar/MoveAcrossFolders.vue";
import { mapResponseToBrowserCheck, buildCreateBrowserTestPayload } from '@/utils/synthetics/buildPayload'
import PrivateLocations, { type PrivateLocation } from '@/components/synthetic-monitoring/PrivateLocations.vue'
import MonitorFormDrawer from '@/components/synthetic-monitoring/MonitorFormDrawer.vue'
import syntheticsService from '@/services/synthetics'
import { getFoldersListByType } from '@/utils/commons'
import { toast } from '@/lib/feedback/Toast/useToast'


const router  = useRouter();
const route   = useRoute();
const store   = useStore();

// ── API types ──────────────────────────────────────────────────────────
interface ApiMonitorFrequency {
  type: string
  interval: number
  cron: string
}

interface ApiMonitor {
  id: string
  org_id: string
  folder_id: string
  name: string
  description: string
  tags: string[]
  type: string
  target: string
  frequency: ApiMonitorFrequency
  locations: string[]
  enabled: boolean
  status: string
  created_at: number
  updated_at: number
  last_triggered_at: number
  last_check_at: number | null
  last_response_ms: number | null
}

// ── Helpers ────────────────────────────────────────────────────────────
function formatFrequency(f: ApiMonitorFrequency): string {
  const n = f.interval
  switch (f.type) {
    case 'seconds': return `${n}s`
    case 'minutes': return `${n}m`
    case 'hours':   return `${n}h`
    case 'days':    return `${n}d`
    default:        return f.cron || `${n}${f.type[0]}`
  }
}

function formatTimeAgo(microseconds: number): string {
  const diffMs = Date.now() - Math.floor(microseconds / 1000)
  const s = Math.floor(diffMs / 1000)
  if (s < 60)   return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60)   return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)   return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function mapMonitor(m: ApiMonitor) {
  return {
    id:           m.id,
    name:         m.name,
    description:  m.description,
    tags:         m.tags,
    url:          m.target,
    type:         m.type.toUpperCase(),
    interval:     formatFrequency(m.frequency),
    status:       m.status,
    responseTime: m.last_response_ms !== null ? `${m.last_response_ms}ms` : null,
    locations:    m.locations,
    lastCheck:    m.last_check_at !== null ? formatTimeAgo(m.last_check_at) : '—',
    enabled:      m.enabled,
    uptime:       null as number | null,
    history:      [] as unknown[],
    folderId:     m.folder_id,
  }
}

type DisplayMonitor = ReturnType<typeof mapMonitor>

function dotClass(status: string) {
  const lower = status.toLowerCase()
  return {
    'bg-status-success-text': lower === 'passed',
    'bg-status-warning-text': lower === 'warning',
    'bg-status-error-text': lower === 'failed',
    'bg-text-muted': lower === 'unknown',
  }
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

// ── Data loading ───────────────────────────────────────────────────────
// Start in loading state so the table shows the skeleton on first render
// instead of briefly flashing the empty state before the fetch completes.
const loading = ref(true)

const orgIdentifier = computed<string>(
  () => (store.state as any).selectedOrganization?.identifier ?? ''
)

async function loadMonitors(folderId?: string) {
  if (!orgIdentifier.value) return
  loading.value = true
  try {
    const targetFolder = folderId !== undefined ? folderId : (searchAcrossFolders.value ? undefined : activeFolderId.value)
    const res = await syntheticsService.listByFolderId(orgIdentifier.value, targetFolder)
    monitors.value = ((res.data as any).monitors ?? []).map(mapMonitor)
  } finally {
    loading.value = false
  }
}

async function initPage() {
  // Load folders first so the sidebar tablist renders with data.
  try {
    await getFoldersListByType(store, 'synthetics')
  } catch (err) {
    console.error('[synthetics] failed to load folders', err)
  }

  // Wait for the organisation identifier to be resolved before making API
  // calls.  On browser back-navigation the store may not be ready
  // synchronously, and loadMonitors silently returns when orgIdentifier is
  // empty — the table skeleton stays forever because loading is never
  // cleared.
  if (!orgIdentifier.value) {
    await new Promise<void>((resolve) => {
      const stop = watch(orgIdentifier, (val) => {
        if (val) {
          stop()
          resolve()
        }
      })
    })
  }

  await loadMonitors(activeFolderId.value)

  const editId = route.query.edit
  if (typeof editId === 'string' && editId) {
    const monitor = monitors.value.find((m) => String(m.id) === editId)
    if (monitor) openEdit(monitor)
  }
}

onMounted(() => {
  initPage()
})

const areMultiTypeTestEnabled = false;

const activeTab      = ref("monitors");
const monitorTableMode = computed(() => activeTab.value as 'monitors' | 'browser' | 'api');
const statusFilter   = ref("all");
const typeFilter     = ref("all");
const locationFilter = ref("all");
const search         = ref("");
const showDrawer     = ref(false);
const editTarget     = ref<any>(null);

// ── Folder state ───────────────────────────────────────────────────────
const activeFolderId      = ref<string>((route.query.folder as string) ?? 'default')
const searchAcrossFolders = ref(false)

const updateActiveFolderId = (folderId: string) => {
  activeFolderId.value = folderId
}

watch(activeFolderId, async (newFolderId) => {
  selectedMonitorIds.value = []
  if (searchAcrossFolders.value) {
    searchAcrossFolders.value = false
  }
  // Only push when the folder is not already in the URL to avoid a
  // redundant history entry during initial mount.
  if (route.query.folder !== newFolderId) {
    router.push({
      query: { ...route.query, folder: newFolderId },
    }).catch(() => {})
  }
  await loadMonitors(newFolderId)
})

watch(searchAcrossFolders, async (newVal) => {
  selectedMonitorIds.value = []
  if (newVal) {
    await loadMonitors(undefined)
  } else {
    await loadMonitors(activeFolderId.value)
  }
})

// ── Multi-select & bulk ops ────────────────────────────────────────────
const selectedMonitorIds  = ref<string[]>([])
const showMoveDialog      = ref(false)
const showBulkDeleteConfirm = ref(false)
const monitorsToMove      = ref<string[]>([])

const showDuplicateDialog = ref(false)
const duplicateTarget     = ref<any>(null)
const duplicateName       = ref('')
const duplicateFolder     = ref('default')
const isDuplicating       = ref(false)

const openBulkDeleteConfirm = () => {
  showBulkDeleteConfirm.value = true
}

const bulkDeleteMonitors = async () => {
  const org = orgIdentifier.value
  const dismiss = toast({ variant: 'loading', message: 'Deleting checks…', timeout: 0 })
  try {
    await syntheticsService.bulkDelete(org, { ids: selectedMonitorIds.value }, searchAcrossFolders.value ? undefined : activeFolderId.value)
    selectedMonitorIds.value = []
    dismiss()
    toast({ variant: 'success', message: 'Checks deleted successfully.' })
    await loadMonitors()
  } catch (err: any) {
    dismiss()
    toast({
      variant: 'error',
      message: err?.response?.data?.message || err?.response?.data?.error || 'Failed to delete checks.',
    })
    console.error('[synthetics] bulk delete failed', err)
  } finally {
    showBulkDeleteConfirm.value = false
  }
}

const moveMultipleMonitors = () => {
  monitorsToMove.value = [...selectedMonitorIds.value]
  showMoveDialog.value = true
}

const onMoveUpdated = async () => {
  selectedMonitorIds.value = []
  showMoveDialog.value = false
  await loadMonitors()
}

onUnmounted(() => {
  if (mapTipTimer) clearTimeout(mapTipTimer);
  heatmapChart?.dispose();
});

// ── Geo Checks ────────────────────────────────────────────────────────
const geoAllLocations = [
  { key:"US East",    label:"US East",    flag:"🇺🇸", city:"Virginia, USA"      },
  { key:"US West",    label:"US West",    flag:"🇺🇸", city:"Oregon, USA"        },
  { key:"EU West",    label:"EU West",    flag:"🇮🇪", city:"Dublin, Ireland"    },
  { key:"EU Central", label:"EU Central", flag:"🇩🇪", city:"Frankfurt, Germany" },
  { key:"AP SE",      label:"AP SE",      flag:"🇸🇬", city:"Singapore"          },
  { key:"AP NE",      label:"AP NE",      flag:"🇯🇵", city:"Tokyo, Japan"       },
];
const geoAllRows = computed(() => {
  return monitors.value
    .map((m, mi) => {
      const cells = geoAllLocations.map((loc, li) => {
        const configured = m.locations.includes(loc.key);
        if (!configured) return { loc: loc.key, status: "none" as const, ms: null };
        const seed = (mi * 11 + li * 17 + loc.key.charCodeAt(0)) % 97;
        let st: "up"|"down"|"deg";
        if (m.status === "down")          st = "down";
        else if (m.status === "degraded") st = seed % 4 === 0 ? "deg" : seed % 7 === 0 ? "down" : "up";
        else                              st = seed % 11 === 0 ? "deg" : "up";
        const ms = st === "down" ? null : 55 + seed * 4 + (st === "deg" ? 280 + seed * 2 : 0);
        return { loc: loc.key, status: st, ms };
      });
      return { monitor: m, cells };
    })
    .sort((a, b) => {
      const rank = (r: typeof a) => r.cells.some(c=>c.status==="down") ? 0 : r.cells.some(c=>c.status==="deg") ? 1 : 2;
      return rank(a) - rank(b);
    });
});
const geoLocStats = computed(() =>
  geoAllLocations.map((loc, li) => {
    const configured = geoAllRows.value.filter(r => r.cells[li].status !== "none");
    const downCt = configured.filter(r => r.cells[li].status === "down").length;
    const degCt  = configured.filter(r => r.cells[li].status === "deg").length;
    const upCt   = configured.filter(r => r.cells[li].status === "up").length;
    const total  = configured.length;
    const uptime = total ? +(((upCt + degCt * 0.5) / total) * 100).toFixed(1) : 100;
    const health: "up"|"down"|"deg" = downCt > 0 ? "down" : degCt > 0 ? "deg" : "up";
    return { ...loc, total, upCt, degCt, downCt, uptime, health };
  })
);

// ── Geo Map & Panels ───────────────────────────────────────────────────
const geoMapLonLat: Record<string, [number, number]> = {
  "US East":    [-77.0, 38.9],
  "US West":    [-122.4, 45.5],
  "EU West":    [-6.2, 53.3],
  "EU Central": [8.7, 50.1],
  "AP SE":      [103.8, 1.3],
  "AP NE":      [139.7, 35.7],
};

const showHeatmapModal = ref(false);
const heatmapChartEl = ref<HTMLElement | null>(null);
let heatmapChart: echarts.ECharts | null = null;
let worldGeoRegistered = false;

const getHeatmapOption = () => {
  // Read the theme so token colors are re-resolved when it flips.
  void store.state.theme;
  const landColor   = cssVar("--color-surface-subtle", "#e2e8f0");
  const borderCol   = cssVar("--color-border-default", "#cbd5e1");
  const oceanBg     = cssVar("--color-surface-base", "#f8fafc");
  const labelColor  = cssVar("--color-text-primary", "#334155");
  const upColor     = cssVar("--color-status-success-text", "#22c55e");
  const downColor   = cssVar("--color-status-error-text", "#ef4444");
  const degColor    = cssVar("--color-status-warning-text", "#f59e0b");
  const upShadow    = cssVar("--color-status-success-text", "rgba(34,197,94,0.5)");
  const downShadow  = cssVar("--color-status-error-text", "rgba(239,68,68,0.5)");
  const degShadow   = cssVar("--color-status-warning-text", "rgba(245,158,11,0.5)");
  const tooltipBg   = cssVar("--color-surface-overlay", "#ffffff");
  const tooltipBorder = cssVar("--color-border-default", "#e2e8f0");
  const labelBorderColor = cssVar("--color-surface-overlay", "#ffffff");
  return {
    backgroundColor: oceanBg,
    geo: {
      map: "world",
      roam: false,
      silent: true,
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      itemStyle: { areaColor: landColor, borderColor: borderCol, borderWidth: 0.5 },
      emphasis: { itemStyle: { areaColor: landColor }, label: { show: false } },
      select: { disabled: true },
    },
    tooltip: {
      trigger: "item",
      formatter: (params: any) => {
        if (!params.data) return "";
        const d = params.data;
        const col = d.health === "up" ? upColor : d.health === "down" ? downColor : degColor;
        const label = d.health === "up" ? "Healthy" : d.health === "down" ? "Outage" : "Degraded";
        return `<div style="font-size:12px;line-height:1.7"><b>${d.flag} ${d.name}</b><br/><span style="color:${col}">${label}</span><br/>Uptime: ${d.uptime}%<br/>Checks: ${d.total}</div>`;
      },
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: labelColor },
    },
    series: [{
      type: "effectScatter",
      coordinateSystem: "geo",
      rippleEffect: { brushType: "stroke", scale: 3.5, period: 2.5 },
      symbolSize: (val: any, params: any) => Math.max(12, Math.min(26, 10 + (params.data.total ?? 0) * 0.7)),
      data: geoLocStats.value.map(s => ({
        name: s.label,
        value: [geoMapLonLat[s.key][0], geoMapLonLat[s.key][1]],
        health: s.health,
        uptime: s.uptime,
        total: s.total,
        flag: s.flag,
      })),
      itemStyle: {
        color: (params: any) => params.data.health === "up" ? upColor : params.data.health === "down" ? downColor : degColor,
        borderColor: "rgba(255,255,255,0.8)",
        borderWidth: 2,
        shadowBlur: 12,
        shadowColor: (params: any) => params.data.health === "up" ? upShadow : params.data.health === "down" ? downShadow : degShadow,
      },
      label: {
        show: true,
        position: "bottom",
        distance: 8,
        formatter: (params: any) => `${params.data.flag} ${params.data.name}`,
        fontSize: 10,
        fontWeight: 600,
        color: labelColor,
        textBorderColor: labelBorderColor,
        textBorderWidth: 2,
      },
    }],
  };
};

const initHeatmapChart = async () => {
  await nextTick();
  if (!heatmapChartEl.value) return;
  if (!worldGeoRegistered) {
    const worldJson = await import("@/assets/dashboard/maps/map.json");
    echarts.registerMap("world", worldJson.default as any);
    worldGeoRegistered = true;
  }
  heatmapChart = echarts.init(heatmapChartEl.value);
  heatmapChart.setOption(getHeatmapOption());
  await nextTick();
  heatmapChart.resize();
};

watch(showHeatmapModal, (open) => {
  if (!open) {
    heatmapChart?.dispose();
    heatmapChart = null;
    return;
  }
  initHeatmapChart().catch((err) => {
    console.error('Failed to initialize heatmap chart:', err);
  });
});
const showIssuesModal  = ref(false);
const geoIssues = computed(() => {
  const list: { key: string; level: "error" | "warn"; stat: typeof geoLocStats.value[0] }[] = [];
  geoLocStats.value.forEach(s => {
    if (s.health === "down") list.push({ key: `${s.key}-down`, level: "error", stat: s });
    else if (s.health === "deg") list.push({ key: `${s.key}-deg`, level: "warn", stat: s });
  });
  return list;
});

const mapTip = ref({ show: false, x: 0, y: 0, stat: null as any });
let mapTipTimer: ReturnType<typeof setTimeout> | null = null;
const keepMapTip = () => { if (mapTipTimer) { clearTimeout(mapTipTimer); mapTipTimer = null; } };
const hideMapTip = () => { mapTipTimer = setTimeout(() => { mapTip.value.show = false; }, 100); };


// ── Row click → Monitor Results page ───────────────────────────────────
const openDetail = (monitor: any) => {
  router.push({
    name: 'synthetic-monitor-results',
    params: { id: String(monitor.id) },
    query: { name: monitor.name, folder: monitor.folder_name },
  });
};


const tabs = [
  { key:"monitors", label:"All Checks",     count:30   },
  { key:"browser",  label:"Browser Tests",    count:5    },
  { key:"api",      label:"API Tests",        count:6    },
  { key:"private",  label:"Private Locations",count:null },
];

const typeOpts = [
  { label:"All types", value:"all" },
  ...["HTTP","Browser","API","TCP","Ping","DNS"].map(v=>({ label:v, value:v })),
];
const locationOpts = [
  { label:"All locations", value:"all" },
  { label:"US East",      value:"US East" },{ label:"US West",    value:"US West" },
  { label:"EU West",      value:"EU West" },{ label:"EU Central", value:"EU Central" },{ label:"AP Southeast", value:"AP SE" },
];

const monitors = ref<DisplayMonitor[]>([])

// Enrich monitors with folder names from Vuex store
const enrichedMonitors = computed(() => {
  const folders: any[] = (store.state as any).organizationData?.foldersByType?.synthetics ?? []
  return monitors.value.map(m => ({
    ...m,
    folder_name: folders.find((f: any) => f.folderId === m.folderId)?.name ?? m.folderId ?? '—',
  }))
})

const browserMonitors = computed(() => enrichedMonitors.value.filter(m => m.type === 'BROWSER'))
const apiMonitors     = computed(() => enrichedMonitors.value.filter(m => m.type === 'API'))

const privateLocations = ref<PrivateLocation[]>([
  { id:1, name:"Corp HQ",        region:"New York, US",  status:"Online",  monitors:12, workers:2, checks:36, version:"1.4.2", lastSeen:"5s ago" },
  { id:2, name:"EU Data Center", region:"Frankfurt, DE", status:"Online",  monitors:8,  workers:3, checks:24, version:"1.4.2", lastSeen:"2s ago" },
  { id:3, name:"APAC Office",    region:"Singapore",     status:"Offline", monitors:4,  workers:1, checks:0,  version:"1.3.9", lastSeen:"2h ago" },
]);
const onlinePrivateLocations = computed(() => privateLocations.value.filter(l=>l.status==="Online"));

const statusTabs = computed(() => {
  const ms = enrichedMonitors.value
  const tabs = [
    { filter: 'all',      label: 'All',      count: ms.length },
    { filter: 'passed',   label: 'Passed',   count: ms.filter(m => m.status === 'passed').length },
    { filter: 'warning',  label: 'Warning',  count: ms.filter(m => m.status === 'warning').length },
    { filter: 'failed',   label: 'Failed',   count: ms.filter(m => m.status === 'failed').length },
  ]
  const unknownCount = ms.filter(m => m.status === 'unknown').length
  if (unknownCount > 0) {
    tabs.push({ filter: 'unknown', label: 'Unknown', count: unknownCount })
  }
  return tabs
})

const filteredMonitors = computed(() =>
  enrichedMonitors.value.filter(m =>
    (statusFilter.value === 'all' || m.status === statusFilter.value) &&
    (typeFilter.value === 'all'   || m.type === typeFilter.value) &&
    (locationFilter.value === 'all' || m.locations.includes(locationFilter.value)) &&
    (!search.value || m.name.toLowerCase().includes(search.value.toLowerCase()) || m.url.toLowerCase().includes(search.value.toLowerCase()))
  )
)

// ── Selected monitors (resolved from IDs) ────────────────────────────────
const selectedMonitors = computed(() =>
  enrichedMonitors.value.filter(m => selectedMonitorIds.value.includes(String(m.id)))
)

// ── Bulk actions ─────────────────────────────────────────────────────────

async function bulkPauseMonitors() {
  const toPause = selectedMonitors.value.filter(m => m.enabled)
  if (toPause.length === 0) {
    toast({ variant: 'error', message: 'No enabled checks selected to pause.' })
    return
  }
  bulkActionLoading.value = true
  const dismiss = toast({ variant: 'loading', message: `Pausing ${toPause.length} check(s)…`, timeout: 0 })
  const results = await Promise.allSettled(
    toPause.map(m => syntheticsService.enable(orgIdentifier.value, String(m.id), { enabled: false }))
  )
  dismiss()
  const failed = results.filter(r => r.status === 'rejected').length
  if (failed > 0) {
    toast({ variant: 'warning', message: `${toPause.length - failed} succeeded, ${failed} failed.` })
  } else {
    toast({ variant: 'success', message: `Paused ${toPause.length} check(s).` })
  }
  bulkActionLoading.value = false
  selectedMonitorIds.value = []
  await loadMonitors()
}

async function bulkEnableMonitors() {
  const toEnable = selectedMonitors.value.filter(m => !m.enabled)
  if (toEnable.length === 0) {
    toast({ variant: 'error', message: 'No disabled checks selected to enable.' })
    return
  }
  bulkActionLoading.value = true
  const dismiss = toast({ variant: 'loading', message: `Enabling ${toEnable.length} check(s)…`, timeout: 0 })
  const results = await Promise.allSettled(
    toEnable.map(m => syntheticsService.enable(orgIdentifier.value, String(m.id), { enabled: true }))
  )
  dismiss()
  const failed = results.filter(r => r.status === 'rejected').length
  if (failed > 0) {
    toast({ variant: 'warning', message: `${toEnable.length - failed} succeeded, ${failed} failed.` })
  } else {
    toast({ variant: 'success', message: `Enabled ${toEnable.length} check(s).` })
  }
  bulkActionLoading.value = false
  selectedMonitorIds.value = []
  await loadMonitors()
}

async function bulkTriggerMonitors() {
  const toTrigger = selectedMonitors.value.filter(m => m.enabled)
  if (toTrigger.length === 0) {
    toast({ variant: 'error', message: 'No enabled checks selected to trigger.' })
    return
  }
  bulkActionLoading.value = true
  const dismiss = toast({ variant: 'loading', message: `Triggering ${toTrigger.length} check(s)…`, timeout: 0 })
  const results = await Promise.allSettled(
    toTrigger.map(m => syntheticsService.run(orgIdentifier.value, String(m.id), {}))
  )
  dismiss()
  const failed = results.filter(r => r.status === 'rejected').length
  if (failed > 0) {
    toast({ variant: 'warning', message: `${toTrigger.length - failed} succeeded, ${failed} failed.` })
  } else {
    toast({ variant: 'success', message: `Triggered ${toTrigger.length} check(s).` })
  }
  bulkActionLoading.value = false
  selectedMonitorIds.value = []
}

const openCreate = () =>
  router.push({ name: 'synthetic-new', query: { folder: activeFolderId.value } })
const openEdit = (m: any) => {
  router.push({
    name: 'synthetic-new',
    query: { edit: String(m.id), folder: activeFolderId.value },
  })
}

const toggleLoadingMap = ref<Record<string, boolean>>({})
const triggerLoadingMap = ref<Record<string, boolean>>({})
const bulkActionLoading = ref(false)

async function toggleEnabled(m: any) {
  const org = orgIdentifier.value
  const newEnabled = !m.enabled
  const id = String(m.id)
  toggleLoadingMap.value[id] = true
  const dismiss = toast({ variant: 'loading', message: newEnabled ? 'Enabling monitor…' : 'Pausing monitor…', timeout: 0 })
  try {
    await syntheticsService.enable(org, id, { enabled: newEnabled })
    const found = monitors.value.find((mon) => String(mon.id) === id)
    if (found) found.enabled = newEnabled
    dismiss()
    toast({ variant: 'success', message: newEnabled ? 'Monitor enabled.' : 'Monitor paused.' })
  } catch (err: any) {
    dismiss()
    toast({
      variant: 'error',
      message: err?.response?.data?.message || err?.response?.data?.error || 'Failed to update monitor.',
    })
    console.error('[synthetics] toggle enable failed', err)
  } finally {
    toggleLoadingMap.value[id] = false
  }
}

function duplicateMonitor(m: any) {
  duplicateTarget.value = m
  duplicateName.value = `Copy of ${m.name}`
  duplicateFolder.value = m.folder || 'default'
  showDuplicateDialog.value = true
}

async function saveDuplicate() {
  if (!duplicateTarget.value) return
  isDuplicating.value = true
  const dismiss = toast({ variant: 'loading', message: 'Duplicating monitor…', timeout: 0 })
  try {
    const org = orgIdentifier.value
    const res = await syntheticsService.get(org, String(duplicateTarget.value.id))
    const check = mapResponseToBrowserCheck(res.data as Record<string, unknown>)
    check.name = duplicateName.value
    check.folder = duplicateFolder.value
    delete (check as any).id
    const payload = buildCreateBrowserTestPayload(check)
    await syntheticsService.create(org, payload)
    dismiss()
    toast({ variant: 'success', message: 'Monitor duplicated successfully.' })
    showDuplicateDialog.value = false
    await loadMonitors()
  } catch (err: any) {
    dismiss()
    toast({
      variant: 'error',
      message: err?.response?.data?.message || err?.response?.data?.error || 'Failed to duplicate monitor.',
    })
    console.error('[synthetics] duplicate failed', err)
  } finally {
    isDuplicating.value = false
  }
}

async function runMonitor(m: any) {
  const org = orgIdentifier.value
  const id = String(m.id)
  const name = m.name || 'Unknown'

  // Prevent duplicate triggers while already running
  if (triggerLoadingMap.value[id]) return

  // Check if monitor is disabled/paused
  if (!m.enabled) {
    toast({
      variant: 'error',
      message: `Cannot trigger "${name}" — monitor is paused. Enable it first.`,
    })
    return
  }

  triggerLoadingMap.value[id] = true
  const dismiss = toast({ variant: 'loading', message: `Triggering "${name}"…`, timeout: 0 })
  try {
    await syntheticsService.run(org, id, {})
    dismiss()
    toast({ variant: 'success', message: `Run triggered for "${name}".` })
  } catch (err: any) {
    dismiss()
    toast({
      variant: 'error',
      message: err?.response?.data?.message || `Failed to trigger "${name}".`,
    })
    console.error('[synthetics] run failed', err)
  } finally {
    triggerLoadingMap.value[id] = false
  }
}

async function deleteMonitor(m: any) {
  const org = orgIdentifier.value
  const dismiss = toast({ variant: 'loading', message: 'Deleting monitor…', timeout: 0 })
  try {
    await syntheticsService.delete(org, String(m.id), activeFolderId.value)
    monitors.value = monitors.value.filter((mon) => String(mon.id) !== String(m.id))
    dismiss()
    toast({ variant: 'success', message: 'Monitor deleted.' })
  } catch (err: any) {
    dismiss()
    toast({
      variant: 'error',
      message: err?.response?.data?.message || err?.response?.data?.error || 'Failed to delete monitor.',
    })
    console.error('[synthetics] delete failed', err)
  }
}
</script>
