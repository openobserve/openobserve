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
  <div data-test="downtime-list-page" class="flex h-full flex-col">
    <OPageLayout
      bleed
      :title="t('alerts.downtimes.title')"
      icon="notifications-paused"
      :subtitle="t('alerts.downtimes.subtitle')"
    >
      <template v-if="!forbidden" #actions>
        <OButton
          variant="primary"
          size="sm"
          data-test="downtime-list-add-btn"
          @click="createDowntime"
        >
          {{ t("alerts.downtimes.newDowntime") }}
        </OButton>
      </template>

      <div class="flex min-h-0 flex-1 max-md:flex-col">
        <div
          class="w-rail max-md:border-border-default h-full shrink-0 max-md:h-auto max-md:w-full max-md:border-b"
        >
          <div class="h-full">
            <FolderList type="downtimes" @update:active-folder-id="onFolderChange" />
          </div>
        </div>

        <div class="h-full min-w-0 flex-1 max-md:h-auto max-md:min-h-0">
          <div class="bg-card-glass-bg flex h-full flex-col">
            <OTable
              v-model:selected-ids="selectedIds"
              class="min-h-0 flex-1"
              :frame="false"
              selection="multiple"
              data-test="downtime-list-table"
              :data="displayedRows"
              :columns="columns"
              show-index
              row-key="id"
              :loading="loading"
              :forbidden="forbidden"
              pagination="client"
              :page-size="20"
              :page-size-options="[20, 50, 100]"
              :show-global-filter="false"
              :enable-column-resize="true"
              :persist-columns="true"
              :column-visibility="defaultColumnVisibility"
              table-id="downtimes-list"
              :get-row-style="rowStyle"
              @row-click="openDetail"
            >
              <template #subheader>
                <div
                  class="px-page-edge border-table-row-divider border-b py-1.5"
                  data-test="downtime-list-summary"
                >
                  <OStatStrip
                    :items="summaryStats"
                    :loading="loading"
                    selectable
                    :selected-key="statFilter"
                    default-key="total"
                    @select="onStatSelect"
                  />
                </div>
              </template>

              <template #toolbar>
                <div
                  class="@container/downtime-toolbar flex min-w-0 flex-1 items-center gap-2 max-md:contents"
                >
                  <OToggleGroup
                    mobile-dropdown
                    :model-value="typeFilter"
                    data-test="downtime-list-type"
                    @update:model-value="onTypeChange"
                  >
                    <OToggleGroupItem
                      v-for="option in typeOptions"
                      :key="option.value"
                      :value="option.value"
                      size="sm"
                      :icon-left="option.icon"
                      :data-test="`downtime-list-type-${option.value}`"
                    >
                      <span class="@max-[38rem]/downtime-toolbar:hidden">{{ option.label }}</span>
                    </OToggleGroupItem>
                  </OToggleGroup>
                  <div class="min-w-0 flex-1 max-md:min-w-40">
                    <OInput
                      v-model="search"
                      :placeholder="
                        searchAcrossFolders
                          ? t('alerts.downtimes.searchAcross')
                          : t('alerts.downtimes.search')
                      "
                      clearable
                      class="w-full"
                      data-test="downtime-list-search"
                    >
                      <template #icon-left>
                        <OIcon name="search" size="sm" />
                      </template>
                      <template #icon-right>
                        <OToggleGroup
                          :model-value="searchAcrossFolders ? 'all' : 'this'"
                          class="me-1 self-center"
                          @update:model-value="(v) => (searchAcrossFolders = v === 'all')"
                        >
                          <OToggleGroupItem
                            value="this"
                            size="xs"
                            icon-left="folder-outline"
                            :title="t('alerts.downtimes.thisFolderTooltip')"
                            data-test="downtime-list-scope-this"
                          >
                            <span class="max-md:hidden @max-[34rem]/downtime-toolbar:hidden">{{
                              t("alerts.downtimes.thisFolder")
                            }}</span>
                          </OToggleGroupItem>
                          <OToggleGroupItem
                            value="all"
                            size="xs"
                            icon-left="search"
                            :title="t('alerts.downtimes.allFoldersTooltip')"
                            data-test="downtime-list-scope-all"
                          >
                            <span class="max-md:hidden @max-[34rem]/downtime-toolbar:hidden">{{
                              t("alerts.downtimes.allFolders")
                            }}</span>
                          </OToggleGroupItem>
                        </OToggleGroup>
                      </template>
                    </OInput>
                  </div>
                </div>
              </template>

              <template #toolbar-trailing>
                <ORefreshButton
                  layout="inline"
                  variant="outline"
                  :last-run-at="lastUpdatedAt"
                  :loading="fetching"
                  shortcut-id="downtimesRefresh"
                  data-test="downtime-list-refresh"
                  @click="refreshAll"
                />
              </template>

              <template #cell-name="{ row }">
                <div
                  class="flex min-w-0 items-center gap-2"
                  :data-test="`downtime-list-${row.id}-name`"
                >
                  <span
                    class="rounded-default bg-surface-subtle grid h-6 w-6 shrink-0 place-items-center"
                  >
                    <OIcon
                      :name="row.schedule.repeat === 'none' ? 'schedule' : 'repeat'"
                      size="sm"
                      class="text-text-secondary"
                    />
                    <OTooltip
                      :content="
                        row.schedule.repeat === 'none'
                          ? t('alerts.downtimes.oneTime')
                          : t('alerts.downtimes.recurring')
                      "
                    />
                  </span>
                  <span class="truncate">{{ row.name }}</span>
                  <span v-if="row.show_banner" class="inline-flex shrink-0">
                    <OIcon name="campaign" size="xs" class="text-text-secondary" />
                    <OTooltip :content="t('alerts.downtimes.bannerOn')" />
                  </span>
                </div>
              </template>

              <template #cell-status="{ row }">
                <OTag type="downtimeStatus" :value="row.status" />
              </template>

              <template #cell-targets="{ row }">
                <DowntimeTargetsCell
                  :condition="row.condition"
                  :targets="row.targets"
                  :folder-name="targetFolderName"
                  :data-test="`downtime-list-${row.id}-targets`"
                />
              </template>

              <template #cell-schedule="{ row }">
                <span class="text-text-body truncate text-xs">
                  {{ scheduleSentence(row.schedule, t) }}
                </span>
              </template>

              <template #cell-when="{ row }">
                <span v-if="whenOf(row)" class="inline-flex items-center gap-1 text-xs">
                  <span class="text-text-secondary">{{ whenOf(row)?.label }}</span>
                  <OTimeCell :value="whenOf(row)?.at" unit="us" :timezone="store.state.timezone" />
                </span>
                <span v-else class="text-text-muted">—</span>
              </template>

              <template #cell-matched="{ row }">
                <span class="text-text-body text-xs">{{ matchedText(row) }}</span>
              </template>

              <template #cell-folder_id="{ row }">
                <span class="truncate text-xs">{{ downtimeFolderName(row.folder_id) }}</span>
              </template>

              <template #cell-created_by="{ row }">
                <OUserCell :value="row.created_by" local-part />
              </template>

              <template #cell-actions="{ row }">
                <div class="flex items-center">
                  <OButton
                    v-if="row.status === 'active'"
                    class="max-md:hidden"
                    variant="ghost-destructive"
                    size="icon-sm"
                    icon-left="stop-circle"
                    :data-test="`downtime-list-${row.id}-end-now`"
                    @click.stop="endNow(row)"
                  >
                    <OTooltip side="bottom" :content="t('alerts.downtimes.actions.endNow')" />
                  </OButton>
                  <OButton
                    class="max-md:hidden"
                    variant="ghost"
                    size="icon-sm"
                    icon-left="edit"
                    :data-test="`downtime-list-${row.id}-edit`"
                    @click.stop="editDowntime(row)"
                  >
                    <OTooltip side="bottom" :content="t('alerts.downtimes.actions.edit')" />
                  </OButton>
                  <OButton
                    class="max-md:hidden"
                    variant="ghost"
                    size="icon-sm"
                    icon-left="content-copy"
                    :data-test="`downtime-list-${row.id}-duplicate`"
                    @click.stop="duplicateDowntime(row)"
                  >
                    <OTooltip side="bottom" :content="t('alerts.downtimes.actions.duplicate')" />
                  </OButton>
                  <ODropdown align="end">
                    <template #trigger>
                      <OButton
                        variant="ghost"
                        size="icon-sm"
                        icon-left="more-vert"
                        :aria-label="t('alerts.downtimes.actions.more')"
                        :data-test="`downtime-list-${row.id}-more`"
                        @click.stop
                      />
                    </template>
                    <ODropdownItem
                      v-if="row.status === 'active'"
                      class="md:hidden"
                      icon-left="stop-circle"
                      :data-test="`downtime-list-${row.id}-end-now-menu`"
                      @select="endNow(row)"
                    >
                      {{ t("alerts.downtimes.actions.endNow") }}
                    </ODropdownItem>
                    <ODropdownItem
                      class="md:hidden"
                      icon-left="edit"
                      :data-test="`downtime-list-${row.id}-edit-menu`"
                      @select="editDowntime(row)"
                    >
                      {{ t("alerts.downtimes.actions.edit") }}
                    </ODropdownItem>
                    <ODropdownItem
                      class="md:hidden"
                      icon-left="content-copy"
                      :data-test="`downtime-list-${row.id}-duplicate-menu`"
                      @select="duplicateDowntime(row)"
                    >
                      {{ t("alerts.downtimes.actions.duplicate") }}
                    </ODropdownItem>
                    <ODropdownSeparator class="md:hidden" />
                    <ODropdownItem
                      icon-left="drive-file-move"
                      :data-test="`downtime-list-${row.id}-move`"
                      @select="openMove([row.id], row.folder_id)"
                    >
                      {{ t("alerts.downtimes.actions.moveToFolder") }}
                    </ODropdownItem>
                    <ODropdownItem
                      v-if="row.status === 'scheduled'"
                      icon-left="cancel"
                      :data-test="`downtime-list-${row.id}-cancel`"
                      @select="askCancel([row.id])"
                    >
                      {{ t("alerts.downtimes.actions.cancel") }}
                    </ODropdownItem>
                    <template v-if="row.status === 'ended' || row.status === 'cancelled'">
                      <ODropdownSeparator />
                      <ODropdownItem
                        variant="destructive"
                        icon-left="delete"
                        :data-test="`downtime-list-${row.id}-delete`"
                        @select="askDelete(row.id)"
                      >
                        {{ t("alerts.downtimes.actions.delete") }}
                      </ODropdownItem>
                    </template>
                  </ODropdown>
                </div>
              </template>

              <template #empty>
                <div data-test="downtime-list-empty" class="h-full">
                  <OEmptyState
                    v-if="!loading"
                    size="hero"
                    preset="no-downtimes"
                    :filtered="isFiltered"
                    @action="onEmptyAction"
                  />
                </div>
              </template>

              <template #bottom>
                <div class="flex h-12 w-full items-center justify-between gap-2">
                  <div class="flex min-w-25 items-center text-xs">
                    <template v-if="selectedIds.length > 0">
                      {{
                        t("alerts.downtimes.selectedCount", {
                          count: selectedIds.length,
                          total: displayedRows.length,
                        })
                      }}
                    </template>
                    <span v-else class="max-md:hidden">
                      {{
                        t(
                          "alerts.downtimes.totalCount",
                          { count: displayedRows.length },
                          displayedRows.length,
                        )
                      }}
                    </span>
                  </div>
                  <div v-if="selectedIds.length > 0" class="flex items-center gap-2">
                    <OButton
                      variant="outline"
                      size="sm"
                      icon-left="drive-file-move"
                      data-test="downtime-list-bulk-move"
                      @click="openMove(selectedIds, activeFolderId)"
                    >
                      {{ t("alerts.downtimes.actions.moveToFolder") }}
                    </OButton>
                    <OButton
                      variant="outline-destructive"
                      size="sm"
                      icon-left="cancel"
                      :disabled="cancellableSelection.length === 0"
                      data-test="downtime-list-bulk-cancel"
                      @click="askCancel(cancellableSelection)"
                    >
                      {{ t("alerts.downtimes.actions.cancel") }}
                    </OButton>
                  </div>
                </div>
              </template>
            </OTable>
          </div>
        </div>
      </div>
    </OPageLayout>

    <MoveAcrossFolders
      v-model:open="moveOpen"
      :active-folder-id="moveFromFolder"
      :module-id="moveIds"
      type="downtimes"
      data-test="downtime-list-move-dialog"
      @updated="onMoved"
    />

    <ConfirmDialog
      v-model="cancelOpen"
      :title="t('alerts.downtimes.confirmCancel.title')"
      :message="
        pendingCancel.length > 1
          ? t(
              'alerts.downtimes.confirmCancel.bulkMessage',
              { count: pendingCancel.length },
              pendingCancel.length,
            )
          : t('alerts.downtimes.confirmCancel.message')
      "
      @update:ok="confirmCancel"
      @update:cancel="cancelOpen = false"
    />

    <ConfirmDialog
      v-model="deleteOpen"
      :title="t('alerts.downtimes.confirmDelete.title')"
      :message="t('alerts.downtimes.confirmDelete.message')"
      @update:ok="confirmDelete"
      @update:cancel="deleteOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import { queryClient } from "@/composables/query/queryClient";
import { foldersQuery } from "@/services/common.queries";
import { folderKeys } from "@/services/common.querykeys";
import { downtimeKeys } from "@/services/downtimes.querykeys";
import {
  cancelDowntimeMutation,
  deleteDowntimeMutation,
  downtimesListQuery,
} from "@/services/downtimes.queries";
import type { DowntimeListItem, TargetModule } from "@/services/downtimes";
import { getFoldersListByType } from "@/utils/commons";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";
import { useToast } from "@/lib/feedback/Toast/useToast";
import { scheduleSentence } from "@/utils/downtimes/schedule";
import type { FolderNameFn } from "@/utils/downtimes/targetSummary";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import FolderList from "@/components/common/sidebar/FolderList.vue";
import MoveAcrossFolders from "@/components/common/sidebar/MoveAcrossFolders.vue";
import DowntimeTargetsCell from "./DowntimeTargetsCell.vue";

type TypeFilter = "all" | "once" | "recurring";
type StatKey = "active" | "scheduled" | "recurring" | "ended" | "cancelled";

const RAIL_COLORS: Record<DowntimeListItem["status"], string> = {
  active: "var(--color-warning-500)",
  scheduled: "var(--color-blue-500)",
  ended: "var(--color-grey-400)",
  cancelled: "var(--color-grey-300)",
};

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = useOrgId();
const { toast } = useToast();

const listQuery = useQuery(() =>
  Object.assign(downtimesListQuery(orgId.value), { enabled: !!orgId.value }),
);
const alertFoldersList = useQuery(() =>
  Object.assign(foldersQuery(orgId.value, "alerts"), { enabled: !!orgId.value }),
);
const syntheticFoldersList = useQuery(() =>
  Object.assign(foldersQuery(orgId.value, "synthetics"), { enabled: !!orgId.value }),
);
const downtimeFoldersList = useQuery(() =>
  Object.assign(foldersQuery(orgId.value, "downtimes"), { enabled: !!orgId.value }),
);

const allRows = computed<DowntimeListItem[]>(() => listQuery.data.value?.items ?? []);
const loading = listQuery.isPending;
const fetching = listQuery.isFetching;
const lastUpdatedAt = listQuery.dataUpdatedAt;
const forbidden = computed(() => {
  const e: any = listQuery.error.value;
  return e?.status === 403 || e?.response?.status === 403;
});

const cancelMutation = useMutation(() => cancelDowntimeMutation(orgId.value));
const deleteMutation = useMutation(() => deleteDowntimeMutation(orgId.value));

const folderNameIn = (folders: { folderId: string; name: string }[] | undefined, id: string) =>
  folders?.find((f) => f.folderId === id)?.name;

const targetFolderName: FolderNameFn = (module: TargetModule, id: string) =>
  folderNameIn(
    module === "synthetics" ? syntheticFoldersList.data.value : alertFoldersList.data.value,
    id,
  );

const downtimeFolderName = (id: string) =>
  folderNameIn(downtimeFoldersList.data.value, id) ?? id;

// ── Filters ─────────────────────────────────────────────────────────────────
const activeFolderId = ref<string>((route.query.folder as string) || "default");
const search = ref("");
const searchAcrossFolders = ref(false);
const typeFilter = ref<TypeFilter>(
  (["once", "recurring"] as const).find((v) => v === route.query.repeat) ?? "all",
);
const statFilter = ref<StatKey | null>(
  (["active", "scheduled", "recurring", "ended", "cancelled"] as const).find(
    (v) => v === route.query.status,
  ) ?? null,
);
const selectedIds = ref<string[]>([]);

watch([typeFilter, statFilter], ([repeat, status]) => {
  router.replace({
    query: {
      ...route.query,
      repeat: repeat === "all" ? undefined : repeat,
      status: status ?? undefined,
    },
  });
});

const typeOptions = computed<{ value: TypeFilter; label: I18nText; icon: IconName }[]>(() => [
  { value: "all", label: t("alerts.downtimes.filterAll"), icon: "format-list-bulleted" },
  { value: "once", label: t("alerts.downtimes.filterOnce"), icon: "schedule" },
  { value: "recurring", label: t("alerts.downtimes.filterRecurring"), icon: "repeat" },
]);

const onTypeChange = (value: unknown) => {
  typeFilter.value = (value as TypeFilter) || "all";
};

const onFolderChange = (folderId: string) => {
  activeFolderId.value = folderId;
  selectedIds.value = [];
};

const searchText = (row: DowntimeListItem) =>
  [row.name, row.created_by, JSON.stringify(row.condition ?? "")].join(" ").toLowerCase();

const folderRows = computed(() => {
  const term = search.value.trim().toLowerCase();
  const scoped =
    searchAcrossFolders.value && term
      ? allRows.value
      : allRows.value.filter((r) => (r.folder_id || "default") === activeFolderId.value);
  const byType = scoped.filter((r) =>
    typeFilter.value === "all"
      ? true
      : typeFilter.value === "once"
        ? r.schedule.repeat === "none"
        : r.schedule.repeat !== "none",
  );
  return term ? byType.filter((r) => searchText(r).includes(term)) : byType;
});

const displayedRows = computed(() => {
  const f = statFilter.value;
  if (!f) return folderRows.value;
  if (f === "recurring") return folderRows.value.filter((r) => r.schedule.repeat !== "none");
  return folderRows.value.filter((r) => r.status === f);
});

const isFiltered = computed(
  () => !!search.value.trim() || typeFilter.value !== "all" || statFilter.value !== null,
);

// ── Summary strip ───────────────────────────────────────────────────────────
const summaryStats = computed<StatItem[]>(() => {
  const rows = folderRows.value;
  const hasData = rows.length > 0;
  const count = (pred: (r: DowntimeListItem) => boolean) =>
    hasData ? rows.filter(pred).length : "—";
  const share = hasData ? rows.length : undefined;
  return [
    {
      key: "active",
      label: t("alerts.downtimes.stats.active"),
      value: count((r) => r.status === "active"),
      icon: "notifications-paused",
      tone: "warning",
      max: share,
      dataTest: "downtime-summary-active",
    },
    {
      key: "scheduled",
      label: t("alerts.downtimes.stats.scheduled"),
      value: count((r) => r.status === "scheduled"),
      icon: "schedule",
      tone: "blue",
      max: share,
      dataTest: "downtime-summary-scheduled",
    },
    {
      key: "recurring",
      label: t("alerts.downtimes.stats.recurring"),
      value: count((r) => r.schedule.repeat !== "none"),
      icon: "repeat",
      tone: "neutral",
      max: share,
      dataTest: "downtime-summary-recurring",
    },
    {
      key: "ended",
      label: t("alerts.downtimes.stats.ended"),
      value: count((r) => r.status === "ended"),
      icon: "check-circle",
      tone: "neutral",
      max: share,
      dataTest: "downtime-summary-ended",
    },
    {
      key: "cancelled",
      label: t("alerts.downtimes.stats.cancelled"),
      value: count((r) => r.status === "cancelled"),
      icon: "cancel",
      tone: "neutral",
      max: share,
      dataTest: "downtime-summary-cancelled",
    },
    {
      key: "total",
      label: t("alerts.downtimes.stats.total"),
      value: hasData ? rows.length : "—",
      icon: "format-list-bulleted",
      tone: "primary",
      dataTest: "downtime-summary-total",
    },
  ];
});

const onStatSelect = (key: string) => {
  statFilter.value = key === "total" || statFilter.value === key ? null : (key as StatKey);
};

const onEmptyAction = (id?: string) => {
  if (id === "clear-filters") {
    search.value = "";
    typeFilter.value = "all";
    statFilter.value = null;
    return;
  }
  createDowntime();
};

// ── Columns ─────────────────────────────────────────────────────────────────
const columns = computed<OTableColumnDef<DowntimeListItem>[]>(() => [
  {
    id: "name",
    accessorKey: "name",
    header: t("alerts.downtimes.columns.name"),
    sortable: true,
    size: 260,
    minSize: 200,
    meta: { isName: true, flex: true },
  },
  {
    id: "status",
    accessorKey: "status",
    header: t("alerts.downtimes.columns.status"),
    cell: " ",
    sortable: true,
    size: 120,
  },
  {
    id: "targets",
    header: t("alerts.downtimes.columns.targets"),
    cell: " ",
    hideable: true,
    size: 320,
  },
  {
    id: "schedule",
    header: t("alerts.downtimes.columns.schedule"),
    cell: " ",
    hideable: true,
    size: 280,
  },
  {
    id: "when",
    accessorFn: (row) => whenOf(row)?.at ?? Number.MAX_SAFE_INTEGER,
    header: t("alerts.downtimes.columns.when"),
    cell: " ",
    sortable: true,
    hideable: true,
    size: 150,
  },
  {
    id: "matched",
    header: t("alerts.downtimes.columns.matched"),
    cell: " ",
    hideable: true,
    size: 200,
  },
  {
    id: "folder_id",
    accessorKey: "folder_id",
    header: t("alerts.downtimes.columns.folder"),
    cell: " ",
    hideable: true,
    size: COL.folder,
  },
  {
    id: "created_by",
    accessorKey: "created_by",
    header: t("alerts.downtimes.columns.createdBy"),
    cell: " ",
    sortable: true,
    hideable: true,
    size: COL.owner,
  },
  { id: "actions", header: "", isAction: true, size: 150, pinned: "right" },
]);

const defaultColumnVisibility = { folder_id: false, created_by: false };

const rowStyle = (row: DowntimeListItem): Record<string, string> => ({
  boxShadow: `var(--shadow-rail-geom) ${RAIL_COLORS[row.status] ?? RAIL_COLORS.ended}`,
});

const whenOf = (row: DowntimeListItem): { label: I18nText; at: number } | null => {
  if (row.status === "active" && row.current_window) {
    return { label: t("alerts.downtimes.endsLabel"), at: row.current_window.end };
  }
  if (row.status === "scheduled" && row.next_window) {
    return { label: t("alerts.downtimes.nextLabel"), at: row.next_window.start };
  }
  return null;
};

const matchedText = (row: DowntimeListItem): string => {
  const modules = new Set(row.targets.map((tg) => tg.module));
  const parts: string[] = [];
  const add = (module: TargetModule, key: string, count: number) => {
    if (modules.has(module)) parts.push(t(key, { count }, count));
  };
  add("alerts", "alerts.downtimes.matched.alerts", row.matched_alerts);
  add("anomaly_detections", "alerts.downtimes.matched.anomalies", row.matched_anomalies);
  add("synthetics", "alerts.downtimes.matched.synthetics", row.matched_synthetics);
  add("slos", "alerts.downtimes.matched.slos", row.matched_slos);
  return parts.join(", ");
};

// ── Navigation ──────────────────────────────────────────────────────────────
const orgQuery = () => ({ org_identifier: orgId.value });

const createDowntime = () =>
  router.push({ name: "addDowntime", query: { ...orgQuery(), folder_id: activeFolderId.value } });

const rowQuery = (row: DowntimeListItem) => ({ ...orgQuery(), folder: row.folder_id });

const editDowntime = (row: DowntimeListItem) =>
  router.push({ name: "editDowntime", params: { id: row.id }, query: rowQuery(row) });

const duplicateDowntime = (row: DowntimeListItem) =>
  router.push({ name: "addDowntime", query: { ...rowQuery(row), duplicate: row.id } });

const openDetail = (row: DowntimeListItem) =>
  router.push({ name: "downtimeDetail", params: { id: row.id }, query: rowQuery(row) });

const folderOf = (id: string) => allRows.value.find((r) => r.id === id)?.folder_id;

// ── Writes ──────────────────────────────────────────────────────────────────
const cancelOpen = ref(false);
const pendingCancel = ref<string[]>([]);
const deleteOpen = ref(false);
const pendingDelete = ref("");

const cancellableSelection = computed(() =>
  allRows.value
    .filter((r) => selectedIds.value.includes(r.id))
    .filter((r) => r.status === "active" || r.status === "scheduled")
    .map((r) => r.id),
);

const cancelIds = async (ids: string[]) => {
  try {
    for (const id of ids) await cancelMutation.mutateAsync({ id, folder: folderOf(id) });
    toast({
      variant: "success",
      message:
        ids.length > 1
          ? t("toastMessages.downtimes.cancelledMany", { count: ids.length }, ids.length)
          : t("toastMessages.downtimes.cancelled"),
    });
    selectedIds.value = [];
  } catch {
    toast({ variant: "error", message: t("toastMessages.downtimes.cancelFailed") });
  }
};

const endNow = (row: DowntimeListItem) => cancelIds([row.id]);

const askCancel = (ids: string[]) => {
  pendingCancel.value = [...ids];
  cancelOpen.value = true;
};

const confirmCancel = async () => {
  cancelOpen.value = false;
  await cancelIds(pendingCancel.value);
};

const askDelete = (id: string) => {
  pendingDelete.value = id;
  deleteOpen.value = true;
};

const confirmDelete = async () => {
  deleteOpen.value = false;
  try {
    await deleteMutation.mutateAsync({
      id: pendingDelete.value,
      folder: folderOf(pendingDelete.value),
    });
    toast({ variant: "success", message: t("toastMessages.downtimes.deleted") });
  } catch {
    toast({ variant: "error", message: t("toastMessages.downtimes.deleteFailed") });
  }
};

const moveOpen = ref(false);
const moveIds = ref<string[]>([]);
const moveFromFolder = ref("default");

const openMove = (ids: string[], fromFolder: string) => {
  moveIds.value = [...ids];
  moveFromFolder.value = fromFolder || "default";
  moveOpen.value = true;
};

const onMoved = () => {
  moveOpen.value = false;
  selectedIds.value = [];
  // The move dialog writes through the shared folders transport, not a mutation.
  void queryClient.invalidateQueries({ queryKey: downtimeKeys.all(orgId.value) });
};

// ── Refresh ─────────────────────────────────────────────────────────────────
const refreshAll = async () => {
  const org = orgId.value;
  await queryClient.invalidateQueries({
    queryKey: folderKeys.list(org, "downtimes"),
    exact: true,
    refetchType: "none",
  });
  void getFoldersListByType(store, "downtimes");
  void listQuery.refetch();
  void alertFoldersList.refetch();
  void syntheticFoldersList.refetch();
};

useShortcuts([
  {
    id: "downtimesCreate",
    handler: () => {
      if (!isInputFocused() && !forbidden.value) createDowntime();
    },
  },
  {
    id: "downtimesRefresh",
    handler: () => {
      if (!isInputFocused()) void refreshAll();
    },
  },
  {
    id: "downtimesFocusSearch",
    handler: () => focusSearchInput("downtime-list-search"),
  },
]);
</script>
