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
  <OPageLayout
    class="relative"
    :subtitle="t('synthetics.pageSubtitle')"
    icon="radar"
    bleed
    tabs-below
  >
    <template #title>
      <span class="inline-flex items-center gap-2">
        {{ t("synthetics.pageTitle") }}
        <BetaBadge />
      </span>
    </template>
    <template #actions>
      <OButton
        v-if="activeSection === 'checks'"
        size="sm"
        variant="primary"
        data-test="synthetic-monitoring-new-check-btn"
        @click="showTypePicker = true"
      >
        {{ t("synthetics.newCheck.button") }}
      </OButton>
      <OButton
        v-else-if="activeSection === 'status-pages'"
        size="sm"
        variant="primary"
        data-test="status-pages-new-btn"
        icon-left="add"
        @click="showCreateStatusPage = true"
      >
        {{ t("statusPages.newPage") }}
      </OButton>
      <OButton
        v-else
        size="sm"
        variant="primary"
        data-test="synthetic-monitoring-setup-agent-btn"
        @click="openSetupDrawer()"
      >
        {{ t("synthetics.privateLocations.setupAgent") }}
      </OButton>
    </template>

    <template #header-tabs>
      <OTabs
        :model-value="activeSection"
        align="left"
        @change="activeSection = $event as SyntheticsSection"
      >
        <OTab name="checks">
          <OIcon name="radar" size="sm" />
          <span>{{ t("synthetics.tabs.checks") }}</span>
        </OTab>
        <OTab v-if="privateLocationsEnabled" name="private">
          <OIcon name="location-on" size="sm" />
          <span>{{ t("synthetics.tabs.private") }}</span>
        </OTab>
        <OTab name="status-pages">
          <OIcon name="monitor-heart" size="sm" />
          <span>{{ t("statusPages.tabTitle") }}</span>
        </OTab>
      </OTabs>
    </template>
    <!-- CONTENT AREA: sidebar + main -->
    <div class="flex flex-1 overflow-hidden">
      <!-- LEFT SIDEBAR: folder navigation (locations are org-level, no folders) -->
      <div v-if="activeSection === 'checks'" class="w-rail shrink-0 overflow-y-auto">
        <FolderList
          type="synthetics"
          data-test="synthetic-monitoring-folder-list"
          @update:activeFolderId="updateActiveFolderId"
        />
      </div>

      <!-- ── PRIVATE LOCATIONS TAB ── -->
      <PrivateLocations
        v-if="privateLocationsEnabled && activeSection === 'private'"
        :locations="privateLocations"
        :loading="locationsLoading"
        @refresh="loadPrivateLocations"
        @copy-setup="openSetupDrawer"
        @delete="confirmDeleteLocation"
      />

      <!-- RIGHT MAIN: filter bar + table -->
      <div v-if="activeSection === 'checks'" class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <!-- ── CHECKS TABLE ── -->
        <MonitorTable
          :mode="monitorTableMode"
          :data="filteredMonitors"
          :loading="loading"
          :timezone="store.state.timezone"
          :footer-title="footerTitle"
          :empty-message="emptyMessage"
          :selected-ids="selectedMonitorIds"
          :show-folder-column="searchAcrossFolders"
          :location-names="locationNames"
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
          @move="moveSingleMonitor"
          @update:selected-ids="selectedMonitorIds = $event"
          @delete-selected="openBulkDeleteConfirm"
          @move-selected="moveMultipleMonitors"
          @pause-selected="bulkPauseMonitors"
          @enable-selected="bulkEnableMonitors"
          @trigger-selected="bulkTriggerMonitors"
          @navigate-to-folder="
            (id) => {
              searchAcrossFolders = false;
              updateActiveFolderId(id);
            }
          "
          @empty-action="onEmptyAction"
        >
          <!-- Health strip: the status facet, attention-first (failing → degrading
               → passing → unknown), with Total last. It replaces the status dropdown
               that used to hide these same counts inside its option labels. -->
          <template #subheader>
            <div
              class="px-page-edge border-table-row-divider border-b py-1.5"
              data-test="synthetic-monitoring-summary"
            >
              <OStatStrip
                :items="summaryStats"
                :loading="loading"
                selectable
                :selected-key="statusFilter === 'all' ? null : statusFilter"
                @select="onStatSelect"
              />
            </div>
          </template>

          <!-- Toolbar content rendered inside OTable's toolbar bar -->
          <template #toolbar>
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <!-- Type tabs -->
              <OToggleGroup :model-value="activeTab" @update:model-value="onTabChange">
                <OToggleGroupItem
                  v-for="tab in typeTabs"
                  :key="tab.key"
                  :value="tab.key"
                  size="sm"
                  :icon-left="tab.icon"
                >
                  {{ tab.label }}
                </OToggleGroupItem>
              </OToggleGroup>

              <!-- Search -->
              <div class="min-w-0 flex-1">
                <OInput
                  v-model="search"
                  :placeholder="
                    searchAcrossFolders
                      ? t('synthetics.search.allFoldersPlaceholder')
                      : activeTab === 'browser'
                        ? t('synthetics.search.browserPlaceholder')
                        : t('synthetics.search.folderPlaceholder')
                  "
                  data-test="synthetic-monitoring-search-input"
                  class="w-full"
                >
                  <template #icon-right>
                    <OToggleGroup
                      :model-value="searchAcrossFolders ? 'all' : 'this'"
                      @update:model-value="
                        (v) => {
                          searchAcrossFolders = v === 'all';
                        }
                      "
                    >
                      <OToggleGroupItem
                        value="this"
                        size="xs"
                        icon-left="folder-outline"
                        data-test="synthetic-monitoring-search-this-folder-btn"
                      >
                        {{ t("synthetics.search.thisFolder") }}
                      </OToggleGroupItem>
                      <OToggleGroupItem
                        value="all"
                        size="xs"
                        icon-left="search"
                        data-test="synthetic-monitoring-search-all-folders-btn"
                      >
                        {{ t("synthetics.search.allFolders") }}
                      </OToggleGroupItem>
                    </OToggleGroup>
                  </template>
                </OInput>
              </div>

              <!-- Status is faceted by the summary strip below, not by a dropdown -
                   the counts belong on screen, not hidden inside option labels. -->
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

      <!-- ── STATUS PAGES TAB ── -->
      <StatusPagesList
        v-if="activeSection === 'status-pages'"
        :pages="statusPages"
        :loading="statusPagesLoading"
        :timezone="store.state.timezone"
        @refresh="loadStatusPages"
        @new-page="showCreateStatusPage = true"
        @edit="openStatusPageEdit"
        @delete="confirmDeleteStatusPage"
        @post-update="openPostUpdate"
        @view-updates="openNoticeHistory"
        @manage-domains="openDomains"
      />
    </div>

    <!-- Duplicate check dialog -->
    <ODialog
      v-model:open="showDuplicateDialog"
      persistent
      size="sm"
      :title="t('synthetics.dialog.duplicateTitle')"
      :primary-button-label="t('common.save')"
      :secondary-button-label="t('common.cancel')"
      :primary-button-disabled="isDuplicating || !duplicateName.trim() || !duplicateSource"
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
        <!-- Wrapper carries the data-test: SelectFolderDropDown has a fragment
             root, so attrs cannot fall through to it. Keyed on the source check
             so the dropdown re-seeds its selection from :active-folder-id for
             each row it is opened against. -->
        <div data-test="synthetic-monitoring-duplicate-folder-select">
          <SelectFolderDropDown
            :key="String(duplicateTarget?.id ?? '')"
            type="synthetics"
            :active-folder-id="duplicateFolder"
            @folder-selected="duplicateFolder = $event.value"
          />
        </div>
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
        {{ t("synthetics.dialog.bulkDeleteBody", { count: selectedMonitorIds.length }) }}
      </p>
    </ODialog>

    <!-- Agent setup drawer — private locations only, so enterprise only -->
    <AgentSetupDrawer
      v-if="privateLocationsEnabled"
      v-model:open="showSetupDrawer"
      :install="setupInstall"
      :location-name="setupLocationName"
      :location-id="setupLocationId"
      :token="setupData?.token"
      :org="setupData?.org"
      :o2-url="setupData?.o2_url"
      :script-url="setupData?.script_url"
    />

    <!-- Delete location confirmation -->
    <ODialog
      v-model:open="showDeleteLocation"
      size="sm"
      :title="t('synthetics.privateLocations.deleteTitle')"
      :primary-button-label="t('synthetics.table.delete')"
      :secondary-button-label="t('common.cancel')"
      primary-button-variant="destructive"
      data-test="synthetic-monitoring-delete-location-dialog"
      @click:primary="deleteLocation"
      @click:secondary="showDeleteLocation = false"
    >
      <p class="py-2">
        {{ t("synthetics.privateLocations.deleteBody", { name: locationToDelete?.label ?? "" }) }}
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
            {{ t("synthetics.newCheck.willBeCreatedIn") }} <strong>{{ activeFolderName }}</strong>
            {{ t("synthetics.newCheck.folder") }}
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

    <!-- Create status page -->
    <CreateStatusPageDialog
      v-model:open="showCreateStatusPage"
      :org-identifier="orgIdentifier"
      @created="onStatusPageCreated"
    />

    <!-- Post update -->
    <PostUpdateDialog
      v-if="postUpdatePage"
      v-model:open="showPostUpdate"
      :org-identifier="orgIdentifier"
      :page-id="postUpdatePage.id"
      :page-name="postUpdatePage.name"
      :components="postUpdateComponents"
      @posted="refreshPageHealth(postUpdatePage.id)"
    />

    <!-- Notice history -->
    <NoticeHistoryDialog
      v-if="noticeHistoryPage"
      v-model:open="showNoticeHistory"
      :org-identifier="orgIdentifier"
      :page-id="noticeHistoryPage.id"
      :page-name="noticeHistoryPage.name"
      @deleted="refreshPageHealth(noticeHistoryPage.id)"
    />

    <!-- Custom domains -->
    <DomainsDialog
      v-if="domainsPage"
      v-model:open="showDomains"
      :org-identifier="orgIdentifier"
      :page-id="domainsPage.id"
      :page-name="domainsPage.name"
    />

  </OPageLayout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OText from "@/lib/core/Typography/OText.vue";
import MonitorTable from "@/components/synthetic-monitoring/MonitorTable.vue";
import PrivateLocations from "@/views/synthetics/PrivateLocations.vue";
import StatusPagesList from "@/views/synthetics/status-pages/StatusPagesList.vue";
import CreateStatusPageDialog from "@/views/synthetics/status-pages/CreateStatusPageDialog.vue";
import PostUpdateDialog from "@/views/synthetics/status-pages/PostUpdateDialog.vue";
import NoticeHistoryDialog from "@/views/synthetics/status-pages/NoticeHistoryDialog.vue";
import DomainsDialog from "@/views/synthetics/status-pages/DomainsDialog.vue";
import statusPagesService, {
  type StatusPageListItem,
  type PreviewResponse,
} from "@/services/status_pages";
import AgentSetupDrawer from "@/components/synthetic-monitoring/AgentSetupDrawer.vue";
import CheckTypePicker from "@/components/synthetics/CheckTypePicker.vue";
import FolderList from "@/components/common/sidebar/FolderList.vue";
import MoveAcrossFolders from "@/components/common/sidebar/MoveAcrossFolders.vue";
import SelectFolderDropDown from "@/components/common/sidebar/SelectFolderDropDown.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import {
  mapResponseToBrowserCheck,
  buildCreateBrowserTestPayload,
  mapResponseToProtocolCheck,
  buildCreateProtocolCheckPayload,
} from "@/utils/synthetics/buildPayload";
import {
  SYNTHETIC_CHECK_TYPES,
  type AgentSetup,
  type SyntheticCheckType,
  type SyntheticLocation,
} from "@/types/synthetics";
import { CHECK_TYPE_CARDS } from "@/constants/synthetics";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import syntheticsService from "@/services/synthetics";
import { locationDisplayLabel } from "@/utils/synthetics/format";
import {
  syntheticsCreateRoute,
  syntheticsEditRoute,
  syntheticsResultsRoute,
  statusPageEditRoute,
} from "@/utils/synthetics/routes";
import { getFoldersListByType } from "@/utils/commons";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";

const router = useRouter();
const route = useRoute();
const store = useStore();
const { t } = useI18nTyped();
const { confirm } = useConfirmDialog();

// ── API types ──────────────────────────────────────────────────────────
type SyntheticsSection = "checks" | "private" | "status-pages";

interface ApiMonitorFrequency {
  type: string;
  interval: number;
  cron: string;
}

interface ApiMonitor {
  id: string;
  org_id: string;
  folder_id: string;
  name: string;
  description: I18nText;
  tags: string[];
  type: string;
  target: string;
  frequency: ApiMonitorFrequency;
  locations: string[];
  enabled: boolean;
  status: string;
  created_at: number;
  updated_at: number;
  last_triggered_at: number;
  last_check_at: number | null;
  last_response_ms: number | null;
}

// ── Helpers ────────────────────────────────────────────────────────────
function formatFrequency(f: ApiMonitorFrequency): string {
  const n = f.interval;
  switch (f.type) {
    case "seconds":
      return `${n}s`;
    case "minutes":
      return `${n}m`;
    case "hours":
      return `${n}h`;
    case "days":
      return `${n}d`;
    default:
      return f.cron || `${n}${f.type[0]}`;
  }
}

function formatTimeAgo(microseconds: number): string {
  const diffMs = Date.now() - Math.floor(microseconds / 1000);
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return t("synthetics.secondsAgo", { count: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t("synthetics.minutesAgo", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("synthetics.hoursAgo", { count: h });
  return t("synthetics.daysAgo", { count: Math.floor(h / 24) });
}

function mapMonitor(m: ApiMonitor) {
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    tags: m.tags,
    url: m.target,
    type: m.type.toUpperCase(),
    interval: formatFrequency(m.frequency),
    status: m.status,
    responseTime: m.last_response_ms !== null ? `${m.last_response_ms}ms` : null,
    locations: m.locations,
    lastCheck: m.last_check_at !== null ? formatTimeAgo(m.last_check_at) : "—",
    // Raw microsecond epoch — drives the relative Last Check cell.
    lastCheckAt: m.last_check_at,
    enabled: m.enabled,
    uptime: null as number | null,
    history: [] as unknown[],
    folderId: m.folder_id,
    lastTriggeredAt: m.last_triggered_at,
  };
}

type DisplayMonitor = ReturnType<typeof mapMonitor>;

// ── Data loading ───────────────────────────────────────────────────────
// Start in loading state so the table shows the skeleton on first render
// instead of briefly flashing the empty state before the fetch completes.
const loading = ref(true);

const orgIdentifier = computed<string>(
  () => (store.state as any).selectedOrganization?.identifier ?? "",
);

/** Resolves once orgIdentifier is populated — on browser back-navigation the
 *  store may not be hydrated synchronously yet. */
function waitForOrgIdentifier(): Promise<void> {
  if (orgIdentifier.value) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const stop = watch(orgIdentifier, (val) => {
      if (val) {
        stop();
        resolve();
      }
    });
  });
}

async function loadMonitors(folderId?: string) {
  if (!orgIdentifier.value) return;
  loading.value = true;
  try {
    const targetFolder =
      folderId !== undefined
        ? folderId
        : searchAcrossFolders.value
          ? undefined
          : activeFolderId.value;
    const res = await syntheticsService.listByFolderId(orgIdentifier.value, targetFolder);
    // The API field was renamed `monitors` -> `checks`. Both are read so a
    // bundle and a server on opposite sides of that rename still render.
    const rows = (res.data as any).checks ?? (res.data as any).monitors ?? [];
    monitors.value = rows.map(mapMonitor);
  } finally {
    loading.value = false;
  }
}

async function initPage() {
  // Load folders first so the sidebar tablist renders with data.
  try {
    await getFoldersListByType(store, "synthetics");
  } catch (err) {
    console.error("[synthetics] failed to load folders", err);
  }

  // Wait for the organisation identifier to be resolved before making API
  // calls — loadMonitors silently returns when orgIdentifier is empty, and
  // the table skeleton would stay forever because loading is never cleared.
  await waitForOrgIdentifier();

  await loadMonitors(activeFolderId.value);

  // Load locations after monitors — not critical for initial render.
  loadLocations();
}

onMounted(() => {
  initPage();
});

// Private locations are pools served by long-running agents deployed inside the
// customer's network, and that agent fleet is the one part of synthetics that
// is enterprise. Gated on its own /config flag rather than on
// `synthetics_enabled`, so an OSS build shows synthetics without offering a
// location kind it cannot serve.
const privateLocationsEnabled = computed(() =>
  Boolean(store.state.zoConfig?.synthetics_private_locations_enabled),
);

// Defaults to 'checks', but honors ?section=private / ?section=status-pages so
// links back from a detail surface land on the tab the user actually came from
// instead of always resetting to Checks. A ?section for a tab this build does not
// render falls back to Checks rather than landing on a tab that is not shown.
const initialSection = ((): SyntheticsSection => {
  const s = route.query.section;
  if (s === "private" && privateLocationsEnabled.value) return "private";
  if (s === "status-pages") return "status-pages";
  return "checks";
})();
const activeSection = ref<SyntheticsSection>(initialSection);
// Private Locations data is never fetched on initial render (only on manual
// refresh or after a delete) — load it the first time the tab is actually
// opened, so switching to it isn't silently empty.
let privateLocationsLoaded = false;
let statusPagesLoadedOnce = false;
watch(
  activeSection,
  async (val) => {
    if (val === "private" && !privateLocationsLoaded) {
      privateLocationsLoaded = true;
      // On browser back-navigation the org identifier may not be hydrated yet
      // at this point — wait for it, otherwise the fetch fires against an
      // empty org and the tab is stuck showing 0 rows forever.
      await waitForOrgIdentifier();
      loadPrivateLocations();
    }
    if (val === "status-pages" && !statusPagesLoadedOnce) {
      statusPagesLoadedOnce = true;
      await waitForOrgIdentifier();
      loadStatusPages();
    }
  },
  { immediate: true },
);
const activeTab = ref("all");
const monitorTableMode = computed(() => (activeTab.value === "browser" ? "browser" : "all"));
const statusFilter = ref("all");
const typeFilter = ref("all");
const locationFilter = ref("all");
const search = ref("");
const showTypePicker = ref(false);

// ── Folder state ───────────────────────────────────────────────────────
const activeFolderId = ref<string>((route.query.folder as string) ?? "default");
const searchAcrossFolders = ref(false);

const updateActiveFolderId = (folderId: string) => {
  activeFolderId.value = folderId;
};

const activeFolderName = computed(() => {
  const folders: any[] = (store.state as any).organizationData?.foldersByType?.synthetics ?? [];
  const folder = folders.find((f: any) => f.folderId === activeFolderId.value);
  return folder?.name ?? "Default";
});

watch(activeFolderId, async (newFolderId) => {
  selectedMonitorIds.value = [];
  duplicateFolder.value = newFolderId;
  if (searchAcrossFolders.value) {
    searchAcrossFolders.value = false;
  }
  // Only push when the folder is not already in the URL to avoid a
  // redundant history entry during initial mount.
  if (route.query.folder !== newFolderId) {
    router
      .push({
        query: { ...route.query, folder: newFolderId },
      })
      .catch(() => {});
  }
  await loadMonitors(newFolderId);
});

watch(searchAcrossFolders, async (newVal) => {
  selectedMonitorIds.value = [];
  if (newVal) {
    await loadMonitors(undefined);
  } else {
    await loadMonitors(activeFolderId.value);
  }
});

// ── Multi-select & bulk ops ────────────────────────────────────────────
const selectedMonitorIds = ref<string[]>([]);
const showMoveDialog = ref(false);
const showBulkDeleteConfirm = ref(false);
const monitorsToMove = ref<string[]>([]);

const showDuplicateDialog = ref(false);
const duplicateTarget = ref<any>(null);
const duplicateName = ref("");
const duplicateFolder = ref(activeFolderId.value);
// Full check fetched when the dialog opens — the duplicate is built from this,
// so submitting stays instant and a failed fetch surfaces before the form is filled.
const duplicateSource = ref<any>(null);
// "browser" | "http" | "tcp" | "tls" | "ssh" — picks the mapper/payload builder.
const duplicateSourceType = ref<string>("browser");
const isDuplicating = ref(false);

const openBulkDeleteConfirm = () => {
  showBulkDeleteConfirm.value = true;
};

const bulkDeleteMonitors = async () => {
  const org = orgIdentifier.value;
  bulkActionLoading.value = true;
  const dismiss = toast({
    variant: "loading",
    message: t("synthetics.toast.bulkDeleteToast"),
    timeout: 0,
  });
  try {
    await syntheticsService.bulkDelete(
      org,
      { ids: selectedMonitorIds.value },
      searchAcrossFolders.value ? undefined : activeFolderId.value,
    );
    selectedMonitorIds.value = [];
    dismiss();
    toast({ variant: "success", message: t("synthetics.toast.bulkDeleteSuccess") });
    await loadMonitors();
  } catch (err: any) {
    dismiss();
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t("synthetics.toast.bulkDeleteFailed"),
    });
    console.error("[synthetics] bulk delete failed", err);
  } finally {
    showBulkDeleteConfirm.value = false;
    bulkActionLoading.value = false;
  }
};

const moveMultipleMonitors = () => {
  monitorsToMove.value = [...selectedMonitorIds.value];
  showMoveDialog.value = true;
};

const moveSingleMonitor = (row: any) => {
  monitorsToMove.value = [String(row.id)];
  showMoveDialog.value = true;
};

const onMoveUpdated = async () => {
  selectedMonitorIds.value = [];
  showMoveDialog.value = false;
  await loadMonitors();
};

// ── Row click → Monitor Results page ───────────────────────────────────
const openDetail = (monitor: any) => {
  // `folderId`, not `folder_name` — the server gates RBAC on the folder ID, and
  // the display name degrades to "—" before the folder list has loaded.
  router.push(
    syntheticsResultsRoute(
      { orgIdentifier: orgIdentifier.value, folderId: monitor.folderId ?? activeFolderId.value },
      String(monitor.id),
      { name: monitor.name, lastTriggeredAt: monitor.lastTriggeredAt },
    ),
  );
};

const typeTabs = computed(() => [
  { key: "all", label: t("synthetics.tabs.all"), icon: "format-list-bulleted" },
  ...SYNTHETIC_CHECK_TYPES.map((ct) => ({
    key: ct,
    label: t(`synthetics.tabs.${ct}`),
    icon: CHECK_TYPE_CARDS.find((c) => c.type === ct)?.icon,
  })),
]);

const onTabChange = (v: unknown) => {
  const tab = v as string;
  activeTab.value = tab;
  typeFilter.value = tab === "all" ? "all" : tab.toUpperCase();
};

// ── Private locations tab ──────────────────────────────────────────────
const privateLocations = ref<SyntheticLocation[]>([]);
const locationsLoading = ref(false);
const showSetupDrawer = ref(false);
const setupInstall = ref<string | null>(null);
const setupLocationName = ref<string | null>(null);
const setupLocationId = ref<string | null>(null);
const setupData = ref<AgentSetup | null>(null);
const showDeleteLocation = ref(false);
const locationToDelete = ref<SyntheticLocation | null>(null);

async function loadPrivateLocations() {
  locationsLoading.value = true;
  try {
    const res = await syntheticsService.getLocations(orgIdentifier.value);
    const all: SyntheticLocation[] = (res.data as any).locations ?? [];
    privateLocations.value = all.filter((l) => l.kind === "private");
  } catch (err) {
    console.error("[synthetics] failed to load private locations", err);
  } finally {
    locationsLoading.value = false;
  }
}

/** Opens the setup drawer. Without a row: the org-level composer (agent
 *  declares its location via AGENT_LOCATION — the row auto-appears on first
 *  register). With a row: pinned to that location via --location-id. */
async function openSetupDrawer(row?: SyntheticLocation) {
  setupInstall.value = null;
  setupLocationName.value = row?.label ?? null;
  setupLocationId.value = row?.id ?? null;
  showSetupDrawer.value = true;
  try {
    const res = await syntheticsService.getAgentSetup(orgIdentifier.value);
    setupData.value = (res.data ?? null) as AgentSetup | null;
    setupInstall.value = (res.data as any)?.install ?? null;
  } catch (err) {
    console.error("[synthetics] failed to load agent setup", err);
  }
}

const confirmDeleteLocation = (row: SyntheticLocation) => {
  locationToDelete.value = row;
  showDeleteLocation.value = true;
};

async function deleteLocation() {
  if (!locationToDelete.value) return;
  try {
    await syntheticsService.deleteLocation(orgIdentifier.value, locationToDelete.value.id);
    toast({ variant: "success", message: t("synthetics.privateLocations.toast.deleted") });
    await loadPrivateLocations();
  } catch (err: any) {
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t("synthetics.privateLocations.toast.deleteFailed"),
    });
  } finally {
    showDeleteLocation.value = false;
    locationToDelete.value = null;
  }
}

// ── Status pages tab ───────────────────────────────────────────────────
const statusPages = ref<StatusPageListItem[]>([]);
const statusPagesLoading = ref(false);
const showCreateStatusPage = ref(false);

async function loadStatusPages() {
  if (!orgIdentifier.value) return;
  statusPagesLoading.value = true;
  try {
    const res = await statusPagesService.list(orgIdentifier.value);
    statusPages.value = (res.data as any).pages ?? [];
  } catch (err) {
    console.error("[status-pages] failed to load", err);
  } finally {
    statusPagesLoading.value = false;
  }
}

// Patches one row's Health chip from a fresh, on-demand compute — the same
// path `preview` uses, not the rebuilder's cached snapshot. The list's
// `health` column otherwise only catches up on the rebuilder's own cadence
// (up to ZO_STATUS_PAGE_REBUILD_INTERVAL, default 60s), which reads as "my
// delete/post didn't do anything" to whoever just acted. Called right after
// a notice mutation (so the actor sees the true state immediately) and when
// a page's notices are loaded (so opening its history syncs a stale row).
async function refreshPageHealth(pageId: string) {
  if (!orgIdentifier.value) return;
  try {
    const res = await statusPagesService.preview(orgIdentifier.value, pageId);
    const overall = (res.data as PreviewResponse).current?.overall;
    if (!overall) return;
    const page = statusPages.value.find((p) => p.id === pageId);
    if (page && page.health !== overall) page.health = overall;
  } catch (err) {
    // Best-effort: the row just keeps showing its last-known (possibly
    // stale) health rather than blocking on this.
    console.error(`[status-pages] failed to refresh health for ${pageId}`, err);
  }
}

const openStatusPageEdit = (page: StatusPageListItem) => {
  router.push(statusPageEditRoute({ orgIdentifier: orgIdentifier.value }, page.id));
};

const onStatusPageCreated = async (page: StatusPageListItem) => {
  // Drop straight into the full-page editor on the freshly created page.
  openStatusPageEdit(page);
};

const showPostUpdate = ref(false);
const postUpdatePage = ref<StatusPageListItem | null>(null);
const postUpdateComponents = ref<{ id: string; name: string }[]>([]);

const openPostUpdate = async (page: StatusPageListItem) => {
  postUpdatePage.value = page;
  postUpdateComponents.value = [];
  showPostUpdate.value = true;
  try {
    const res = await statusPagesService.get(orgIdentifier.value, page.id);
    postUpdateComponents.value = ((res.data as any).components ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
    }));
  } catch (err) {
    console.error("[status-pages] failed to load components for post-update", err);
  }
};

const showNoticeHistory = ref(false);
const noticeHistoryPage = ref<StatusPageListItem | null>(null);

const openNoticeHistory = (page: StatusPageListItem) => {
  noticeHistoryPage.value = page;
  showNoticeHistory.value = true;
  refreshPageHealth(page.id);
};

const showDomains = ref(false);
const domainsPage = ref<StatusPageListItem | null>(null);

const openDomains = (page: StatusPageListItem) => {
  domainsPage.value = page;
  showDomains.value = true;
};

const confirmDeleteStatusPage = async (page: StatusPageListItem) => {
  const ok = await confirm({
    title: t("statusPages.dialog.deleteTitle"),
    message: t("statusPages.dialog.deleteBody", { name: page.name }),
  });
  if (!ok) return;
  const dismiss = toast({
    variant: "loading",
    message: t("statusPages.toast.deleting"),
    timeout: 0,
  });
  try {
    await statusPagesService.delete(orgIdentifier.value, page.id);
    statusPages.value = statusPages.value.filter((p) => p.id !== page.id);
    dismiss();
    toast({ variant: "success", message: t("statusPages.toast.deleted") });
  } catch (err: any) {
    dismiss();
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t("statusPages.toast.deleteFailed"),
    });
    console.error("[status-pages] delete failed", err);
  }
};

const locationOpts = ref<{ label: I18nText; value: string }[]>([
  { label: t("synthetics.filters.allLocations"), value: "all" },
]);
// id -> "Name (region)" — checks store locations as ids (KSUID for private,
// "aws-us-east-1" for public); the table/tooltip need the human label.
const locationNames = ref<Record<string, string>>({});

async function loadLocations() {
  try {
    const res = await syntheticsService.getLocations(orgIdentifier.value);
    const locations: { id: string; label: string; region: string; provider: string }[] =
      (res.data as any).locations ?? [];
    locationOpts.value = [
      { label: t("synthetics.filters.allLocations"), value: "all" },
      ...locations.map((loc) => ({
        label: raw(locationDisplayLabel(loc.label, loc.region)),
        value: loc.id,
      })),
    ];
    locationNames.value = Object.fromEntries(
      locations.map((loc) => [loc.id, locationDisplayLabel(loc.label, loc.region)]),
    );
  } catch (err) {
    console.error("[synthetics] failed to load locations", err);
  }
}

const monitors = ref<DisplayMonitor[]>([]);

// Enrich monitors with folder names from Vuex store
const enrichedMonitors = computed(() => {
  const folders: any[] = (store.state as any).organizationData?.foldersByType?.synthetics ?? [];
  return monitors.value.map((m) => ({
    ...m,
    folder_name: folders.find((f: any) => f.folderId === m.folderId)?.name ?? m.folderId ?? "—",
  }));
});

// Monitors filtered by type, search, and location — used for status counts
// so they reflect the currently visible subset. Status is excluded so selecting
// "Failed" doesn't zero out all other status counts.
const filteredStatusMonitors = computed(() =>
  enrichedMonitors.value.filter(
    (m) =>
      (typeFilter.value === "all" || m.type === typeFilter.value) &&
      (locationFilter.value === "all" || m.locations.includes(locationFilter.value)) &&
      (!search.value ||
        m.name.toLowerCase().includes(search.value.toLowerCase()) ||
        m.url.toLowerCase().includes(search.value.toLowerCase())),
  ),
);

// Attention-first order, matching every other strip in the app. Counts come from
// `filteredStatusMonitors` (everything except the status facet itself), so the
// tiles keep their totals while a status is selected.
const summaryStats = computed<StatItem[]>(() => {
  const ms = filteredStatusMonitors.value;
  const total = ms.length;
  const count = (status: string) => ms.filter((m) => m.status === status).length;
  const v = (n: number): string | number => (total > 0 ? n : "—");
  const share = total > 0 ? total : undefined;
  const tiles: StatItem[] = [
    {
      key: "failed",
      label: t("synthetics.filters.failed"),
      value: v(count("failed")),
      icon: "error-outline",
      tone: "error",
      max: share,
      dataTest: "synthetics-summary-failed",
    },
    {
      key: "warning",
      label: t("synthetics.filters.warning"),
      value: v(count("warning")),
      icon: "warning-amber",
      tone: "warning",
      max: share,
      dataTest: "synthetics-summary-warning",
    },
    {
      key: "passed",
      label: t("synthetics.filters.passed"),
      value: v(count("passed")),
      icon: "check-circle",
      tone: "success",
      max: share,
      dataTest: "synthetics-summary-passed",
    },
  ];
  // "Unknown" only means something once a monitor has never reported.
  if (count("unknown") > 0) {
    tiles.push({
      key: "unknown",
      label: t("synthetics.labels.unknown"),
      value: v(count("unknown")),
      icon: "help-outline",
      tone: "neutral",
      max: share,
      dataTest: "synthetics-summary-unknown",
    });
  }
  tiles.push({
    key: "all",
    // "All", not "All Statuses": the tile sits in a row of statuses, so the noun is
    // already established, and its job is simply "clear the facet".
    label: t("synthetics.filters.all"),
    value: v(total),
    icon: "monitor-heart",
    tone: "primary",
    dataTest: "synthetics-summary-total",
  });
  return tiles;
});

// Selecting the active tile clears back to "all", like every other strip.
const onStatSelect = (key: string) => {
  statusFilter.value = key === "all" || statusFilter.value === key ? "all" : key;
};

const filteredMonitors = computed(() =>
  enrichedMonitors.value.filter(
    (m) =>
      (statusFilter.value === "all" || m.status === statusFilter.value) &&
      (typeFilter.value === "all" || m.type === typeFilter.value) &&
      (locationFilter.value === "all" || m.locations.includes(locationFilter.value)) &&
      (!search.value ||
        m.name.toLowerCase().includes(search.value.toLowerCase()) ||
        m.url.toLowerCase().includes(search.value.toLowerCase())),
  ),
);

const hasActiveFilters = computed(
  () =>
    statusFilter.value !== "all" || locationFilter.value !== "all" || search.value.trim() !== "",
);

const clearFilters = () => {
  search.value = "";
  statusFilter.value = "all";
  locationFilter.value = "all";
};

const footerTitle = computed(() =>
  activeTab.value === "browser"
    ? t("synthetics.footer.browserTests")
    : t("synthetics.footer.checks"),
);

const emptyMessage = computed(() =>
  activeTab.value === "browser" ? t("synthetics.empty.browserTests") : t("synthetics.empty.checks"),
);

// ── Selected monitors (resolved from IDs) ────────────────────────────────
const selectedMonitors = computed(() =>
  enrichedMonitors.value.filter((m) => selectedMonitorIds.value.includes(String(m.id))),
);

// ── Bulk actions ─────────────────────────────────────────────────────────

async function bulkPauseMonitors() {
  const toPause = selectedMonitors.value.filter((m) => m.enabled);
  if (toPause.length === 0) {
    toast({ variant: "error", message: t("synthetics.table.noEnabledToPause") });
    return;
  }
  bulkActionLoading.value = true;
  const dismiss = toast({
    variant: "loading",
    message: t("synthetics.table.bulkPauseToast", { count: toPause.length }),
    timeout: 0,
  });
  const results = await Promise.allSettled(
    toPause.map((m) =>
      syntheticsService.enable(orgIdentifier.value, String(m.id), { enabled: false }, m.folderId),
    ),
  );
  dismiss();
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    toast({
      variant: "warning",
      message: t("synthetics.table.bulkPartialSuccess", {
        success: toPause.length - failed,
        fail: failed,
      }),
    });
  } else {
    toast({
      variant: "success",
      message: t("synthetics.table.bulkPauseSuccess", { count: toPause.length }),
    });
  }
  bulkActionLoading.value = false;
  selectedMonitorIds.value = [];
  await loadMonitors();
}

async function bulkEnableMonitors() {
  const toEnable = selectedMonitors.value.filter((m) => !m.enabled);
  if (toEnable.length === 0) {
    toast({ variant: "error", message: t("synthetics.table.noDisabledToEnable") });
    return;
  }
  bulkActionLoading.value = true;
  const dismiss = toast({
    variant: "loading",
    message: t("synthetics.table.bulkEnableToast", { count: toEnable.length }),
    timeout: 0,
  });
  const results = await Promise.allSettled(
    toEnable.map((m) =>
      syntheticsService.enable(orgIdentifier.value, String(m.id), { enabled: true }, m.folderId),
    ),
  );
  dismiss();
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    toast({
      variant: "warning",
      message: t("synthetics.table.bulkPartialSuccess", {
        success: toEnable.length - failed,
        fail: failed,
      }),
    });
  } else {
    toast({
      variant: "success",
      message: t("synthetics.table.bulkEnableSuccess", { count: toEnable.length }),
    });
  }
  bulkActionLoading.value = false;
  selectedMonitorIds.value = [];
  await loadMonitors();
}

async function bulkTriggerMonitors() {
  const toTrigger = selectedMonitors.value.filter((m) => m.enabled);
  if (toTrigger.length === 0) {
    toast({ variant: "error", message: t("synthetics.table.noEnabledToTrigger") });
    return;
  }
  bulkActionLoading.value = true;
  const dismiss = toast({
    variant: "loading",
    message: t("synthetics.table.bulkTriggerToast", { count: toTrigger.length }),
    timeout: 0,
  });
  const results = await Promise.allSettled(
    toTrigger.map((m) => syntheticsService.run(orgIdentifier.value, String(m.id), {}, m.folderId)),
  );
  dismiss();
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    toast({
      variant: "warning",
      message: t("synthetics.table.bulkPartialSuccess", {
        success: toTrigger.length - failed,
        fail: failed,
      }),
    });
  } else {
    toast({
      variant: "success",
      message: t("synthetics.table.bulkTriggerSuccess", { count: toTrigger.length }),
    });
  }
  bulkActionLoading.value = false;
  selectedMonitorIds.value = [];
}

const onEmptyAction = (actionId: string) => {
  if (actionId === "clear-filters") clearFilters();
  else {
    // preset action IDs are "create-{type}" (e.g. "create-browser", "create-http")
    const type = actionId.startsWith("create-")
      ? (actionId.replace("create-", "") as SyntheticCheckType)
      : "browser";
    openCreate(type);
  }
};

const openCreate = (type: SyntheticCheckType = "browser") =>
  router.push(
    syntheticsCreateRoute(
      { orgIdentifier: orgIdentifier.value, folderId: activeFolderId.value },
      type,
    ),
  );

const onTypeSelected = (type: SyntheticCheckType) => {
  showTypePicker.value = false;
  openCreate(type);
};

const openEdit = (m: any) => {
  // The monitor's own folder, not the active tab: with "search across folders"
  // on, the two differ and the RBAC gate needs the folder the check lives in.
  router.push(
    syntheticsEditRoute(
      { orgIdentifier: orgIdentifier.value, folderId: m.folderId ?? activeFolderId.value },
      String(m.id),
    ),
  );
};

const toggleLoadingMap = ref<Record<string, boolean>>({});
const triggerLoadingMap = ref<Record<string, boolean>>({});
const bulkActionLoading = ref(false);

async function toggleEnabled(m: any) {
  const org = orgIdentifier.value;
  const newEnabled = !m.enabled;
  const id = String(m.id);
  toggleLoadingMap.value[id] = true;
  const dismiss = toast({
    variant: "loading",
    message: newEnabled
      ? t("synthetics.toast.enablingSingle")
      : t("synthetics.toast.pausingSingle"),
    timeout: 0,
  });
  try {
    await syntheticsService.enable(org, id, { enabled: newEnabled }, m.folderId);
    const found = monitors.value.find((mon) => String(mon.id) === id);
    if (found) found.enabled = newEnabled;
    dismiss();
    toast({
      variant: "success",
      message: newEnabled
        ? t("synthetics.toast.monitorEnabled")
        : t("synthetics.toast.monitorPaused"),
    });
  } catch (err: any) {
    dismiss();
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t("synthetics.toast.updateFailed"),
    });
    console.error("[synthetics] toggle enable failed", err);
  } finally {
    toggleLoadingMap.value[id] = false;
  }
}

/**
 * A duplicate is a brand-new check, so it cannot inherit the original's start
 * timestamp: mapFrequencyToSchedule reports every saved check as "Schedule
 * Later" with the date/time it originally started, and the API rejects a start
 * in the past ("start must not be in the past"). Keep a start that is still in
 * the future — duplicating a check scheduled for next week should stay
 * scheduled — and otherwise fall back to "Schedule Now".
 */
function rebaseScheduleStart(schedule: any, start?: number) {
  // `start` is microseconds on the wire.
  if (typeof start === "number" && start / 1000 > Date.now()) return { ...schedule };
  const { startDate: _startDate, startTime: _startTime, ...rest } = schedule ?? {};
  return { ...rest, startType: "now" as const };
}

async function duplicateMonitor(m: any) {
  duplicateTarget.value = m;
  duplicateName.value = t("synthetics.labels.copyOf", { name: m.name });
  // The row's own folder, falling back to the folder being browsed. These are
  // the same value unless "search across folders" is on, in which case the copy
  // should land beside its original rather than jump to the active folder.
  duplicateFolder.value = m.folderId || activeFolderId.value || "default";
  duplicateSource.value = null;
  showDuplicateDialog.value = true;
  try {
    const res = await syntheticsService.get(
      orgIdentifier.value,
      String(m.id),
      m.folderId ?? activeFolderId.value,
    );
    const data = res.data as Record<string, unknown>;
    // Browser and protocol (http/tcp/tls/ssh) checks have separate mappers and
    // payload builders — the browser builder hardcodes type: "browser", so
    // running a protocol check through it would silently convert it.
    duplicateSourceType.value = String(data.type ?? "browser").toLowerCase();
    duplicateSource.value =
      duplicateSourceType.value === "browser"
        ? mapResponseToBrowserCheck(data)
        : mapResponseToProtocolCheck(data);
  } catch (err: any) {
    showDuplicateDialog.value = false;
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t("synthetics.toast.duplicateFailed"),
    });
    console.error("[synthetics] failed to load check for duplication", err);
  }
}

async function saveDuplicate() {
  if (!duplicateSource.value || !duplicateName.value.trim()) {
    toast({ variant: "error", message: t("synthetics.toast.duplicateFailed") });
    return;
  }
  isDuplicating.value = true;
  const dismiss = toast({
    variant: "loading",
    message: t("synthetics.toast.duplicating"),
    timeout: 0,
  });
  const targetFolder = duplicateFolder.value;
  try {
    const check = {
      ...duplicateSource.value,
      name: duplicateName.value,
      folder: targetFolder,
      schedule: rebaseScheduleStart(duplicateSource.value.schedule, duplicateSource.value.start),
    };
    delete (check as any).id;
    const payload =
      duplicateSourceType.value === "browser"
        ? buildCreateBrowserTestPayload(check)
        : buildCreateProtocolCheckPayload(check);
    await syntheticsService.create(orgIdentifier.value, payload, targetFolder);
    dismiss();
    toast({ variant: "success", message: t("synthetics.toast.duplicateSuccess") });
    showDuplicateDialog.value = false;
    // Follow the copy into its folder. Assigning activeFolderId triggers its
    // watcher, which reloads — so only call loadMonitors on the other branch.
    if (!searchAcrossFolders.value && targetFolder !== activeFolderId.value) {
      activeFolderId.value = targetFolder;
    } else {
      await loadMonitors();
    }
  } catch (err: any) {
    dismiss();
    // 403s are already surfaced by the http interceptor.
    if (err?.response?.status === 403) {
      showDuplicateDialog.value = false;
      return;
    }
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t("synthetics.toast.duplicateFailed"),
    });
    console.error("[synthetics] duplicate failed", err);
  } finally {
    isDuplicating.value = false;
  }
}

async function runMonitor(m: any) {
  const org = orgIdentifier.value;
  const id = String(m.id);
  const name = m.name || t("synthetics.labels.unknown");

  // Prevent duplicate triggers while already running
  if (triggerLoadingMap.value[id]) return;

  // Check if monitor is disabled/paused
  if (!m.enabled) {
    toast({
      variant: "error",
      message: t("synthetics.toast.triggerDisabled", { name }),
    });
    return;
  }

  triggerLoadingMap.value[id] = true;
  const dismiss = toast({
    variant: "loading",
    message: t("synthetics.toast.triggeringSingle", { name }),
    timeout: 0,
  });
  try {
    await syntheticsService.run(org, id, {}, m.folderId);
    dismiss();
    toast({ variant: "success", message: t("synthetics.toast.triggerSuccessSingle", { name }) });
  } catch (err: any) {
    dismiss();
    toast({
      variant: "error",
      message: err?.response?.data?.message || t("synthetics.toast.triggerFailedSingle", { name }),
    });
    console.error("[synthetics] run failed", err);
  } finally {
    triggerLoadingMap.value[id] = false;
  }
}

async function deleteMonitor(m: any) {
  const ok = await confirm({
    title: t("synthetics.dialog.deleteSingleTitle"),
    message: t("synthetics.dialog.deleteSingleBody", { name: m.name }),
  });
  if (!ok) return;

  const org = orgIdentifier.value;
  const dismiss = toast({
    variant: "loading",
    message: t("synthetics.toast.deletingSingle"),
    timeout: 0,
  });
  try {
    await syntheticsService.delete(org, String(m.id), activeFolderId.value);
    monitors.value = monitors.value.filter((mon) => String(mon.id) !== String(m.id));
    dismiss();
    toast({ variant: "success", message: t("synthetics.toast.deleteSuccessSingle") });
  } catch (err: any) {
    dismiss();
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t("synthetics.toast.deleteFailedSingle"),
    });
    console.error("[synthetics] delete failed", err);
  }
}
</script>
