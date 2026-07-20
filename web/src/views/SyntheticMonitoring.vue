<template>
  <div class="flex flex-col h-full overflow-hidden relative">

    <!-- PAGE HEADER -->
    <AppPageHeader
      :title="t('synthetics.pageTitle')"
      :subtitle="t('synthetics.pageSubtitle')"
      class="px-4 border-b border-border-default"
      icon="radar"
    >
      <template #actions>
        <OButton
          size="sm"
          variant="primary"
          data-test="synthetic-monitoring-new-check-btn"
          @click="showTypePicker = true"
        >
          {{ t('synthetics.newCheck.button') }}
        </OButton>
      </template>
    </AppPageHeader>

    <!-- CONTENT AREA: sidebar + main -->
    <div class="flex flex-1 overflow-hidden">
      <!-- LEFT SIDEBAR: folder navigation -->
      <div class="w-[14.375rem] shrink-0 overflow-y-auto">
        <FolderList
          type="synthetics"
          data-test="synthetic-monitoring-folder-list"
          @update:activeFolderId="updateActiveFolderId"
        />
      </div>

      <!-- RIGHT MAIN: filter bar + table -->
      <div class="flex-1 flex flex-col overflow-hidden min-w-0">

        <!-- ── CHECKS TABLE ── -->
        <MonitorTable
          :mode="monitorTableMode"
          :data="filteredMonitors"
          :loading="loading"
          :footer-title="footerTitle"
          :empty-message="emptyMessage"
          :selected-ids="selectedMonitorIds"
          :show-folder-column="searchAcrossFolders"
          data-test="synthetic-monitoring-monitors-table"
          :toggle-loading-map="toggleLoadingMap"
          :trigger-loading-map="triggerLoadingMap"
          :bulk-action-loading="bulkActionLoading"
          :has-filters="hasActiveFilters"
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
          @empty-action="onEmptyAction"
        >
          <!-- Toolbar content rendered inside OTable's toolbar bar -->
          <template #toolbar>
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <!-- Type tabs -->
              <OToggleGroup
                :model-value="activeTab"
                @update:model-value="(v) => { activeTab = v as string; typeFilter = v === 'all' ? 'all' : (v as string).toUpperCase() }"
              >
                <OToggleGroupItem v-for="tab in typeTabs" :key="tab.key" :value="tab.key" size="sm" :icon-left="tab.icon">
                  {{ tab.label }}
                </OToggleGroupItem>
              </OToggleGroup>

              <!-- Search -->
              <div class="flex-1 min-w-0">
                <OInput
                  v-model="search"
                  :placeholder="searchAcrossFolders ? t('synthetics.search.allFoldersPlaceholder') : activeTab === 'browser' ? t('synthetics.search.browserPlaceholder') : t('synthetics.search.folderPlaceholder')"
                  data-test="synthetic-monitoring-search-input"
                  class="w-full"
                >
                  <template #icon-right>
                    <OToggleGroup
                      :model-value="searchAcrossFolders ? 'all' : 'this'"
                      @update:model-value="(v) => { searchAcrossFolders = v === 'all' }"
                    >
                      <OToggleGroupItem value="this" size="xs" icon-left="folder-outline" data-test="synthetic-monitoring-search-this-folder-btn">
                        {{ t('synthetics.search.thisFolder') }}
                      </OToggleGroupItem>
                      <OToggleGroupItem value="all" size="xs" icon-left="search" data-test="synthetic-monitoring-search-all-folders-btn">
                        {{ t('synthetics.search.allFolders') }}
                      </OToggleGroupItem>
                    </OToggleGroup>
                  </template>
                </OInput>
              </div>

              <!-- Status filter -->
              <OSelect
                v-model="statusFilter"
                :options="statusOpts"
                size="md"
                class="w-35!"
              />
            </div>
          </template>

          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              class="w-8!"
              icon-left="refresh"
              :loading="loading"
              :title="t('common.refresh')"
              data-test="synthetic-monitoring-refresh-btn"
              @click="loadMonitors()"
            />
          </template>
        </MonitorTable>


      </div>
    </div>



    <!-- Duplicate check dialog -->
    <ODialog
      v-model:open="showDuplicateDialog"
      size="sm"
      :title="t('synthetics.dialog.duplicateTitle')"
      :primary-button-label="t('common.save')"
      :secondary-button-label="t('common.cancel')"
      :primary-button-disabled="isDuplicating || !duplicateName.trim()"
      data-test="synthetic-monitoring-duplicate-dialog"
      @click:primary="saveDuplicate"
      @click:secondary="showDuplicateDialog = false"
    >
      <div class="flex flex-col gap-3 py-1">
        <OInput
          v-model="duplicateName"
          :label="t('synthetics.checkDetails.name')"
          :placeholder="t('synthetics.checkDetails.namePlaceholder')"
          data-test="synthetic-monitoring-duplicate-name-input"
        />
        <OInput
          v-model="duplicateFolder"
          :label="t('synthetics.checkDetails.folder')"
          :placeholder="t('synthetics.checkDetails.folderPlaceholder')"
          data-test="synthetic-monitoring-duplicate-folder-input"
        />
      </div>
    </ODialog>

    <!-- Bulk delete confirmation dialog -->
    <ODialog
      v-model:open="showBulkDeleteConfirm"
      size="sm"
      :title="t('synthetics.dialog.bulkDeleteTitle')"
      :primary-button-label="t('synthetics.table.delete')"
      :secondary-button-label="t('common.cancel')"
      primary-button-variant="destructive"
      data-test="synthetic-monitoring-bulk-delete-dialog"
      @click:primary="bulkDeleteMonitors"
      @click:secondary="showBulkDeleteConfirm = false"
    >
      <p class="py-2">
        {{ t('synthetics.dialog.bulkDeleteBody', { count: selectedMonitorIds.length }) }}
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

    <!-- Check type picker modal -->
    <ODialog
      v-model:open="showTypePicker"
      :title="t('synthetics.newCheck.modalTitle')"
      size="sm"
      data-test="synthetic-monitoring-check-type-picker-dialog"
    >
      <div class="flex flex-col gap-4">
        <div class="flex items-center gap-1.5 pl-3">
          <OIcon name="folder-outline" size="sm" class="text-text-secondary" />
          <OText variant="meta">
            {{ t('synthetics.newCheck.willBeCreatedIn') }} <strong>{{ activeFolderName }}</strong> {{ t('synthetics.newCheck.folder') }}
          </OText>
        </div>
        <CheckTypePicker
          variant="modal"
          layout="row"
          data-test="synthetic-monitoring-check-type-picker-modal"
          @select="onTypeSelected"
        />
      </div>
    </ODialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OText from "@/lib/core/Typography/OText.vue";
import MonitorTable from "@/components/synthetic-monitoring/MonitorTable.vue";
import CheckTypePicker from "@/components/synthetics/CheckTypePicker.vue";
import FolderList from "@/components/common/sidebar/FolderList.vue";
import MoveAcrossFolders from "@/components/common/sidebar/MoveAcrossFolders.vue";
import { mapResponseToBrowserCheck, buildCreateBrowserTestPayload } from '@/utils/synthetics/buildPayload'
import { SYNTHETIC_CHECK_TYPES, type SyntheticCheckType } from '@/types/synthetics'
import { CHECK_TYPE_CARDS } from '@/constants/synthetics'
import { useI18n } from 'vue-i18n'
import syntheticsService from '@/services/synthetics'
import { getFoldersListByType } from '@/utils/commons'
import { toast } from '@/lib/feedback/Toast/useToast'


const router  = useRouter();
const route   = useRoute();
const store   = useStore();
const { t }   = useI18n();

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
    lastTriggeredAt: m.last_triggered_at,
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

  // Load locations after monitors — not critical for initial render.
  loadLocations()

  const editId = route.query.edit
  if (typeof editId === 'string' && editId) {
    const monitor = monitors.value.find((m) => String(m.id) === editId)
    if (monitor) openEdit(monitor)
  }
}

onMounted(() => {
  initPage()
})

const activeTab      = ref("all");
const monitorTableMode = computed(() => activeTab.value === 'browser' ? 'browser' : 'all');
const statusFilter   = ref("all");
const typeFilter     = ref("all");
const locationFilter = ref("all");
const search         = ref("");
const showTypePicker = ref(false);

// ── Folder state ───────────────────────────────────────────────────────
const activeFolderId      = ref<string>((route.query.folder as string) ?? 'default')
const searchAcrossFolders = ref(false)

const updateActiveFolderId = (folderId: string) => {
  activeFolderId.value = folderId
}

const activeFolderName = computed(() => {
  const folders: any[] = (store.state as any).organizationData?.foldersByType?.synthetics ?? []
  const folder = folders.find((f: any) => f.folderId === activeFolderId.value)
  return folder?.name ?? 'Default'
})

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
  const dismiss = toast({ variant: 'loading', message: t('synthetics.toast.bulkDeleteToast'), timeout: 0 })
  try {
    await syntheticsService.bulkDelete(org, { ids: selectedMonitorIds.value }, searchAcrossFolders.value ? undefined : activeFolderId.value)
    selectedMonitorIds.value = []
    dismiss()
    toast({ variant: 'success', message: t('synthetics.toast.bulkDeleteSuccess') })
    await loadMonitors()
  } catch (err: any) {
    dismiss()
    toast({
      variant: 'error',
      message: err?.response?.data?.message || err?.response?.data?.error || t('synthetics.toast.bulkDeleteFailed'),
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


// ── Row click → Monitor Results page ───────────────────────────────────
const openDetail = (monitor: any) => {
  const query: Record<string, string> = { name: monitor.name, folder: monitor.folder_name }
  if (monitor.lastTriggeredAt > 0) query.last_triggered_at = String(monitor.lastTriggeredAt)
  router.push({
    name: 'synthetic-monitor-results',
    params: { id: String(monitor.id) },
    query,
  });
};

const typeTabs = computed(() => [
  { key: 'all', label: t('synthetics.tabs.all'), icon: 'format-list-bulleted' },
  ...SYNTHETIC_CHECK_TYPES.map(ct => ({
    key: ct,
    label: t(`synthetics.tabs.${ct}`),
    icon: CHECK_TYPE_CARDS.find(c => c.type === ct)?.icon,
  })),
]);

const locationOpts = ref<{ label: string; value: string }[]>([{ label: t('synthetics.filters.allLocations'), value: 'all' }]);

async function loadLocations() {
  try {
    const res = await syntheticsService.getLocations(orgIdentifier.value);
    const locations: { id: string; name: string; region: string; provider: string }[] =
      (res.data as any).locations ?? [];
    locationOpts.value = [
      { label: t('synthetics.filters.allLocations'), value: 'all' },
      ...locations.map((loc) => ({ label: `${loc.name} (${loc.region})`, value: loc.name })),
    ];
  } catch (err) {
    console.error('[synthetics] failed to load locations', err);
  }
}

const monitors = ref<DisplayMonitor[]>([])

// Enrich monitors with folder names from Vuex store
const enrichedMonitors = computed(() => {
  const folders: any[] = (store.state as any).organizationData?.foldersByType?.synthetics ?? []
  return monitors.value.map(m => ({
    ...m,
    folder_name: folders.find((f: any) => f.folderId === m.folderId)?.name ?? m.folderId ?? '—',
  }))
})

const statusTabs = computed(() => {
  const ms = enrichedMonitors.value
  const tabs = [
    { filter: 'all',      label: t('synthetics.filters.allStatuses'),      count: ms.length },
    { filter: 'passed',   label: t('synthetics.filters.passed'),   count: ms.filter(m => m.status === 'passed').length },
    { filter: 'failed',   label: t('synthetics.filters.failed'),   count: ms.filter(m => m.status === 'failed').length },
  ]
  const unknownCount = ms.filter(m => m.status === 'unknown').length
  if (unknownCount > 0) {
    tabs.push({ filter: 'unknown', label: t('synthetics.labels.unknown'), count: unknownCount })
  }
  return tabs
})

const statusOpts = computed(() =>
  statusTabs.value.map(s => ({
    label: `${s.label} (${s.count})`,
    value: s.filter,
  }))
)

const filteredMonitors = computed(() =>
  enrichedMonitors.value.filter(m =>
    (statusFilter.value === 'all' || m.status === statusFilter.value) &&
    (typeFilter.value === 'all'   || m.type === typeFilter.value) &&
    (locationFilter.value === 'all' || m.locations.includes(locationFilter.value)) &&
    (!search.value || m.name.toLowerCase().includes(search.value.toLowerCase()) || m.url.toLowerCase().includes(search.value.toLowerCase()))
  )
)

const hasActiveFilters = computed(
  () => statusFilter.value !== 'all'
    || locationFilter.value !== 'all'
    || search.value.trim() !== ''
)

const clearFilters = () => {
  search.value = ''
  statusFilter.value = 'all'
  locationFilter.value = 'all'
}

const footerTitle = computed(() =>
  activeTab.value === 'browser' ? t('synthetics.footer.browserTests') : t('synthetics.footer.checks')
)

const emptyMessage = computed(() =>
  activeTab.value === 'browser' ? t('synthetics.empty.browserTests') : t('synthetics.empty.checks')
)

// ── Selected monitors (resolved from IDs) ────────────────────────────────
const selectedMonitors = computed(() =>
  enrichedMonitors.value.filter(m => selectedMonitorIds.value.includes(String(m.id)))
)

// ── Bulk actions ─────────────────────────────────────────────────────────

async function bulkPauseMonitors() {
  const toPause = selectedMonitors.value.filter(m => m.enabled)
  if (toPause.length === 0) {
    toast({ variant: 'error', message: t('synthetics.table.noEnabledToPause') })
    return
  }
  bulkActionLoading.value = true
  const dismiss = toast({ variant: 'loading', message: t('synthetics.table.bulkPauseToast', { count: toPause.length }), timeout: 0 })
  const results = await Promise.allSettled(
    toPause.map(m => syntheticsService.enable(orgIdentifier.value, String(m.id), { enabled: false }))
  )
  dismiss()
  const failed = results.filter(r => r.status === 'rejected').length
  if (failed > 0) {
    toast({ variant: 'warning', message: t('synthetics.table.bulkPartialSuccess', { success: toPause.length - failed, fail: failed }) })
  } else {
    toast({ variant: 'success', message: t('synthetics.table.bulkPauseSuccess', { count: toPause.length }) })
  }
  bulkActionLoading.value = false
  selectedMonitorIds.value = []
  await loadMonitors()
}

async function bulkEnableMonitors() {
  const toEnable = selectedMonitors.value.filter(m => !m.enabled)
  if (toEnable.length === 0) {
    toast({ variant: 'error', message: t('synthetics.table.noDisabledToEnable') })
    return
  }
  bulkActionLoading.value = true
  const dismiss = toast({ variant: 'loading', message: t('synthetics.table.bulkEnableToast', { count: toEnable.length }), timeout: 0 })
  const results = await Promise.allSettled(
    toEnable.map(m => syntheticsService.enable(orgIdentifier.value, String(m.id), { enabled: true }))
  )
  dismiss()
  const failed = results.filter(r => r.status === 'rejected').length
  if (failed > 0) {
    toast({ variant: 'warning', message: t('synthetics.table.bulkPartialSuccess', { success: toEnable.length - failed, fail: failed }) })
  } else {
    toast({ variant: 'success', message: t('synthetics.table.bulkEnableSuccess', { count: toEnable.length }) })
  }
  bulkActionLoading.value = false
  selectedMonitorIds.value = []
  await loadMonitors()
}

async function bulkTriggerMonitors() {
  const toTrigger = selectedMonitors.value.filter(m => m.enabled)
  if (toTrigger.length === 0) {
    toast({ variant: 'error', message: t('synthetics.table.noEnabledToTrigger') })
    return
  }
  bulkActionLoading.value = true
  const dismiss = toast({ variant: 'loading', message: t('synthetics.table.bulkTriggerToast', { count: toTrigger.length }), timeout: 0 })
  const results = await Promise.allSettled(
    toTrigger.map(m => syntheticsService.run(orgIdentifier.value, String(m.id), {}))
  )
  dismiss()
  const failed = results.filter(r => r.status === 'rejected').length
  if (failed > 0) {
    toast({ variant: 'warning', message: t('synthetics.table.bulkPartialSuccess', { success: toTrigger.length - failed, fail: failed }) })
  } else {
    toast({ variant: 'success', message: t('synthetics.table.bulkTriggerSuccess', { count: toTrigger.length }) })
  }
  bulkActionLoading.value = false
  selectedMonitorIds.value = []
}

const onEmptyAction = (actionId: string) => {
  if (actionId === 'clear-filters') clearFilters()
  else {
    // preset action IDs are "create-{type}" (e.g. "create-browser", "create-http")
    const type = actionId.startsWith('create-') ? actionId.replace('create-', '') as SyntheticCheckType : 'browser'
    openCreate(type)
  }
}

const openCreate = (type: SyntheticCheckType = 'browser') =>
  router.push({ name: 'synthetic-new', query: { folder: activeFolderId.value, type } })

const onTypeSelected = (type: SyntheticCheckType) => {
  showTypePicker.value = false
  openCreate(type)
}

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
  const dismiss = toast({ variant: 'loading', message: newEnabled ? t('synthetics.toast.enablingSingle') : t('synthetics.toast.pausingSingle'), timeout: 0 })
  try {
    await syntheticsService.enable(org, id, { enabled: newEnabled })
    const found = monitors.value.find((mon) => String(mon.id) === id)
    if (found) found.enabled = newEnabled
    dismiss()
    toast({ variant: 'success', message: newEnabled ? t('synthetics.toast.monitorEnabled') : t('synthetics.toast.monitorPaused') })
  } catch (err: any) {
    dismiss()
    toast({
      variant: 'error',
      message: err?.response?.data?.message || err?.response?.data?.error || t('synthetics.toast.updateFailed'),
    })
    console.error('[synthetics] toggle enable failed', err)
  } finally {
    toggleLoadingMap.value[id] = false
  }
}

function duplicateMonitor(m: any) {
  duplicateTarget.value = m
  duplicateName.value = t('synthetics.labels.copyOf', { name: m.name })
  duplicateFolder.value = m.folder || 'default'
  showDuplicateDialog.value = true
}

async function saveDuplicate() {
  if (!duplicateTarget.value) return
  isDuplicating.value = true
  const dismiss = toast({ variant: 'loading', message: t('synthetics.toast.duplicating'), timeout: 0 })
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
    toast({ variant: 'success', message: t('synthetics.toast.duplicateSuccess') })
    showDuplicateDialog.value = false
    await loadMonitors()
  } catch (err: any) {
    dismiss()
    toast({
      variant: 'error',
      message: err?.response?.data?.message || err?.response?.data?.error || t('synthetics.toast.duplicateFailed'),
    })
    console.error('[synthetics] duplicate failed', err)
  } finally {
    isDuplicating.value = false
  }
}

async function runMonitor(m: any) {
  const org = orgIdentifier.value
  const id = String(m.id)
  const name = m.name || t('synthetics.labels.unknown')

  // Prevent duplicate triggers while already running
  if (triggerLoadingMap.value[id]) return

  // Check if monitor is disabled/paused
  if (!m.enabled) {
    toast({
      variant: 'error',
      message: t('synthetics.toast.triggerDisabled', { name }),
    })
    return
  }

  triggerLoadingMap.value[id] = true
  const dismiss = toast({ variant: 'loading', message: t('synthetics.toast.triggeringSingle', { name }), timeout: 0 })
  try {
    await syntheticsService.run(org, id, {})
    dismiss()
    toast({ variant: 'success', message: t('synthetics.toast.triggerSuccessSingle', { name }) })
  } catch (err: any) {
    dismiss()
    toast({
      variant: 'error',
      message: err?.response?.data?.message || t('synthetics.toast.triggerFailedSingle', { name }),
    })
    console.error('[synthetics] run failed', err)
  } finally {
    triggerLoadingMap.value[id] = false
  }
}

async function deleteMonitor(m: any) {
  const org = orgIdentifier.value
  const dismiss = toast({ variant: 'loading', message: t('synthetics.toast.deletingSingle'), timeout: 0 })
  try {
    await syntheticsService.delete(org, String(m.id), activeFolderId.value)
    monitors.value = monitors.value.filter((mon) => String(mon.id) !== String(m.id))
    dismiss()
    toast({ variant: 'success', message: t('synthetics.toast.deleteSuccessSingle') })
  } catch (err: any) {
    dismiss()
    toast({
      variant: 'error',
      message: err?.response?.data?.message || err?.response?.data?.error || t('synthetics.toast.deleteFailedSingle'),
    })
    console.error('[synthetics] delete failed', err)
  }
}
</script>
