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
      <template #title>
        <span class="inline-flex max-w-full min-w-0 items-center gap-2">
          <span class="truncate">{{ t("alerts.downtimes.title") }}</span>
          <BetaBadge class="shrink-0" />
        </span>
      </template>
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
                  <OBanner
                    v-if="truncatedNotice"
                    class="mt-1.5"
                    variant="info"
                    dense
                    :content="truncatedNotice"
                    data-test="downtime-list-truncated"
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
                  :max-chips="2"
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
                  <OTimeCell :value="whenOf(row)?.at" unit="us" :timezone="viewerZone" />
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
                <div class="flex items-center" :data-test="`downtime-list-${row.id}-actions`">
                  <span class="inline-flex size-8 max-md:hidden">
                    <ExtendDowntimeMenu
                      compact
                      :enabled="isExtendable(row)"
                      :data-test="`downtime-list-${row.id}-extend`"
                      @preset="(secs) => extendBy(row, secs)"
                      @until="openExtendUntil(row)"
                    />
                  </span>
                  <span class="inline-flex size-8 max-md:hidden">
                    <OButton
                      v-if="row.status === 'scheduled'"
                      variant="ghost-destructive"
                      size="icon-sm"
                      icon-left="cancel"
                      :data-test="`downtime-list-${row.id}-cancel`"
                      @click.stop="askCancel([row.id])"
                    >
                      <OTooltip side="bottom" :content="t('alerts.downtimes.actions.cancel')" />
                    </OButton>
                    <OButton
                      v-else
                      variant="ghost-destructive"
                      size="icon-sm"
                      icon-left="stop-circle"
                      :disabled="row.status !== 'active'"
                      :aria-label="t('alerts.downtimes.actions.endNow')"
                      :data-test="`downtime-list-${row.id}-end-now`"
                      @click.stop="askEndNow(row)"
                    >
                      <OTooltip
                        v-if="row.status === 'active'"
                        side="bottom"
                        :content="t('alerts.downtimes.actions.endNow')"
                      />
                    </OButton>
                  </span>
                  <span class="inline-flex size-8 max-md:hidden">
                    <OButton
                      v-if="isEditable(row)"
                      variant="ghost"
                      size="icon-sm"
                      icon-left="edit"
                      :data-test="`downtime-list-${row.id}-edit`"
                      @click.stop="editDowntime(row)"
                    >
                      <OTooltip side="bottom" :content="t('alerts.downtimes.actions.edit')" />
                    </OButton>
                  </span>
                  <span class="inline-flex size-8 max-md:hidden">
                    <OButton
                      variant="ghost"
                      size="icon-sm"
                      icon-left="content-copy"
                      :data-test="`downtime-list-${row.id}-duplicate`"
                      @click.stop="duplicateDowntime(row)"
                    >
                      <OTooltip side="bottom" :content="t('alerts.downtimes.actions.duplicate')" />
                    </OButton>
                  </span>
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
                    <MuteMenuItems
                      v-if="isExtendable(row)"
                      class="md:hidden"
                      labels="extend"
                      :data-test-prefix="`downtime-list-${row.id}-extend-menu`"
                      @preset="(secs) => extendBy(row, secs)"
                      @until="openExtendUntil(row)"
                    />
                    <ODropdownItem
                      v-if="row.status === 'active'"
                      class="md:hidden"
                      icon-left="stop-circle"
                      :data-test="`downtime-list-${row.id}-end-now-menu`"
                      @select="askEndNow(row)"
                    >
                      {{ t("alerts.downtimes.actions.endNow") }}
                    </ODropdownItem>
                    <ODropdownItem
                      v-if="row.status === 'scheduled'"
                      class="md:hidden"
                      icon-left="cancel"
                      :data-test="`downtime-list-${row.id}-cancel-menu`"
                      @select="askCancel([row.id])"
                    >
                      {{ t("alerts.downtimes.actions.cancel") }}
                    </ODropdownItem>
                    <ODropdownItem
                      v-if="isEditable(row)"
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
                    <template v-if="isFinished(row)">
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
                <div v-if="loadFailed" data-test="downtime-list-error" class="h-full">
                  <OEmptyState size="hero" preset="load-error" @action="refreshAll" />
                </div>
                <div v-else data-test="downtime-list-empty" class="h-full">
                  <OEmptyState
                    v-if="!loading"
                    size="hero"
                    preset="no-downtimes"
                    :filtered="isFiltered"
                    @action="onEmptyAction"
                  />
                </div>
              </template>

              <template #selection-actions>
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
      :ok-label="
        t(
          'alerts.downtimes.confirmCancel.confirm',
          { count: pendingCancel.length },
          pendingCancel.length,
        )
      "
      :cancel-label="
        t(
          'alerts.downtimes.confirmCancel.keep',
          { count: pendingCancel.length },
          pendingCancel.length,
        )
      "
      @update:ok="confirmCancel"
      @update:cancel="cancelOpen = false"
    />

    <ConfirmDialog
      v-model="endNowOpen"
      :title="t('alerts.downtimes.confirmEndNow.title')"
      :message="t('alerts.downtimes.confirmEndNow.message')"
      :ok-label="t('alerts.downtimes.confirmEndNow.ok')"
      :cancel-label="t('alerts.downtimes.confirmEndNow.keep')"
      ok-color="destructive"
      @update:ok="confirmEndNow"
      @update:cancel="endNowOpen = false"
    />

    <ExtendDowntimeDialog
      v-model:open="extendOpen"
      :downtime="extendTarget"
      data-test="downtime-list-extend-dialog"
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
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import { queryClient } from "@/composables/query/queryClient";
import { foldersQuery, optionalFoldersQuery } from "@/services/common.queries";
import { folderKeys } from "@/services/common.querykeys";
import { downtimeKeys } from "@/services/downtimes.querykeys";
import {
  cancelDowntimeMutation,
  deleteDowntimeMutation,
  downtimesListQuery,
} from "@/services/downtimes.queries";
import type { DowntimeCounts, DowntimeListItem, TargetModule } from "@/services/downtimes";
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
import BetaBadge from "@/components/common/BetaBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
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
import { useDefaultDowntimeFolder } from "@/composables/downtimes/useDefaultDowntimeFolder";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";
import { DEFAULT_DOWNTIME_FOLDER } from "@/utils/downtimes/folderDefault";
import MoveAcrossFolders from "@/components/common/sidebar/MoveAcrossFolders.vue";
import { useListBoundaryRefetch } from "@/composables/downtimes/useListBoundaryRefetch";
import DowntimeTargetsCell from "./DowntimeTargetsCell.vue";
import ExtendDowntimeDialog from "./ExtendDowntimeDialog.vue";
import ExtendDowntimeMenu from "./ExtendDowntimeMenu.vue";
import MuteMenuItems from "./MuteMenuItems.vue";
import { useExtendDowntime } from "@/composables/downtimes/useExtendDowntime";
import { isExtendable } from "@/utils/downtimes/extend";
import {
  isEditable,
  isFinished,
  sortDowntimeRows,
  statKeyOf,
  type StatKey,
} from "@/utils/downtimes/listOrder";

type TypeFilter = "all" | "once" | "recurring";

const RAIL_COLORS: Record<DowntimeListItem["status"], string> = {
  active: "var(--color-warning-500)",
  scheduled: "var(--color-blue-500)",
  ended: "var(--color-grey-400)",
  ended_early: "var(--color-grey-400)",
  cancelled: "var(--color-grey-300)",
};

const { t } = useI18nTyped();
const store = useStore();
const viewerZone = useViewerTimezone();
const route = useRoute();
const router = useRouter();
const orgId = useOrgId();
const { toast } = useToast();

const listQuery = useQuery(() =>
  Object.assign(downtimesListQuery(orgId.value), { enabled: !!orgId.value }),
);
const alertFoldersList = useQuery(() =>
  Object.assign(optionalFoldersQuery(orgId.value, "alerts"), { enabled: !!orgId.value }),
);
const syntheticFoldersList = useQuery(() =>
  Object.assign(optionalFoldersQuery(orgId.value, "synthetics"), { enabled: !!orgId.value }),
);
const downtimeFoldersList = useQuery(() =>
  Object.assign(foldersQuery(orgId.value, "downtimes"), { enabled: !!orgId.value }),
);

const allRows = computed<DowntimeListItem[]>(() => listQuery.data.value?.items ?? []);
// The org holds more rows than one page carried, so the client counts would be short.
const truncated = computed(() => listQuery.data.value?.truncated === true);
const loading = listQuery.isPending;
const fetching = listQuery.isFetching;
const lastUpdatedAt = listQuery.dataUpdatedAt;
const forbidden = computed(() => {
  const e: any = listQuery.error.value;
  return e?.status === 403 || e?.response?.status === 403;
});

// A failed load must not read as "no downtimes yet" with a Create button.
const loadFailed = computed(() => listQuery.isError.value && !forbidden.value);

useListBoundaryRefetch(
  () => listQuery.data.value?.items,
  () => listQuery.dataUpdatedAt.value,
  () => listQuery.refetch(),
);

const cancelMutation = useMutation(() => cancelDowntimeMutation(orgId.value));
const deleteMutation = useMutation(() => deleteDowntimeMutation(orgId.value));

const folderNameIn = (folders: { folderId: string; name: string }[] | undefined, id: string) =>
  folders?.find((f) => f.folderId === id)?.name;

const targetFolderName: FolderNameFn = (module: TargetModule, id: string) =>
  folderNameIn(
    module === "synthetics"
      ? syntheticFoldersList.data.value?.folders
      : alertFoldersList.data.value?.folders,
    id,
  );

const downtimeFolderName = (id: string) => folderNameIn(downtimeFoldersList.data.value, id) ?? id;

// ── Filters ─────────────────────────────────────────────────────────────────
// Without a folder in the URL the page lands on the first folder the user may use, then keeps
// the choice in the URL; FolderList's own fallback to "default" is ignored until then.
const folderDefault = useDefaultDowntimeFolder({ rememberLast: false });
const landed = ref(!!route.query.folder);
// With no permitted folder the page keeps landing on "default", as before the list answered.
const landingFolder = () => folderDefault.folderId.value ?? DEFAULT_DOWNTIME_FOLDER;
const activeFolderId = ref<string>((route.query.folder as string) || landingFolder());

const showFolder = (folderId: string) => {
  activeFolderId.value = folderId;
  if (route.query.folder !== folderId) {
    void router.replace({ query: { ...route.query, folder: folderId } });
  }
};

watch(
  folderDefault.ready,
  (ready) => {
    if (!ready || landed.value) return;
    landed.value = true;
    showFolder(landingFolder());
  },
  { immediate: true },
);
const search = ref("");
const searchAcrossFolders = ref(route.query.scope === "all");
const typeFilter = ref<TypeFilter>(
  (["once", "recurring"] as const).find((v) => v === route.query.repeat) ?? "all",
);
const statFilter = ref<StatKey | null>(statKeyOf(route.query.status));
const selectedIds = ref<string[]>([]);

// The banner link can land here while the page is open, so each URL value drives its filter on change.
watch(
  () => route.query.status,
  (status) => {
    const fromUrl = statKeyOf(status);
    if (fromUrl) statFilter.value = fromUrl;
  },
);
watch(
  () => route.query.scope,
  (scope) => {
    searchAcrossFolders.value = scope === "all";
  },
);

watch(searchAcrossFolders, (across) => {
  if ((route.query.scope === "all") === across) return;
  void router.replace({ query: { ...route.query, scope: across ? "all" : undefined } });
});

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
  if (!landed.value) return;
  showFolder(folderId);
  selectedIds.value = [];
};

const searchText = (row: DowntimeListItem) =>
  [row.name, row.created_by, JSON.stringify(row.condition ?? "")].join(" ").toLowerCase();

const folderRows = computed(() => {
  const term = search.value.trim().toLowerCase();
  // The org banner links here with every folder and a status filter, and no search term.
  const scoped =
    searchAcrossFolders.value && (term || statFilter.value)
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
  const rows = !f
    ? folderRows.value
    : f === "recurring"
      ? folderRows.value.filter((r) => r.schedule.repeat !== "none")
      : folderRows.value.filter((r) => r.status === f);
  return sortDowntimeRows(rows);
});

const isFiltered = computed(
  () => !!search.value.trim() || typeFilter.value !== "all" || statFilter.value !== null,
);

// ── Summary strip ───────────────────────────────────────────────────────────
// The tiles count `folderRows`, which holds every listed row unfiltered only on the banner's all-folders status link.
const orgWideTiles = computed(
  () =>
    searchAcrossFolders.value &&
    statFilter.value !== null &&
    !search.value.trim() &&
    typeFilter.value === "all",
);

// The server counts the whole org, so a cut list takes them only where the tiles cover the whole org too.
const serverCounts = computed(() =>
  truncated.value && orgWideTiles.value ? listQuery.data.value : undefined,
);

const truncatedNotice = computed<I18nText | null>(() => {
  const data = listQuery.data.value;
  return truncated.value && data
    ? t("alerts.downtimes.truncated", { shown: data.items.length, total: data.total })
    : null;
});

const summaryStats = computed<StatItem[]>(() => {
  const rows = folderRows.value;
  const server = serverCounts.value;
  const hasData = rows.length > 0 || !!server;
  const count = (key: keyof DowntimeCounts, pred: (r: DowntimeListItem) => boolean) =>
    server ? (server.counts?.[key] ?? 0) : hasData ? rows.filter(pred).length : "—";
  const total = server ? server.total : rows.length;
  const share = hasData ? total : undefined;
  return [
    {
      key: "active",
      label: t("alerts.downtimes.stats.active"),
      value: count("active", (r) => r.status === "active"),
      icon: "notifications-paused",
      tone: "warning",
      max: share,
      dataTest: "downtime-summary-active",
    },
    {
      key: "scheduled",
      label: t("alerts.downtimes.stats.scheduled"),
      value: count("scheduled", (r) => r.status === "scheduled"),
      icon: "schedule",
      tone: "blue",
      max: share,
      dataTest: "downtime-summary-scheduled",
    },
    {
      key: "recurring",
      label: t("alerts.downtimes.stats.recurring"),
      value: count("recurring", (r) => r.schedule.repeat !== "none"),
      icon: "repeat",
      tone: "neutral",
      max: share,
      dataTest: "downtime-summary-recurring",
    },
    {
      key: "ended",
      label: t("alerts.downtimes.stats.ended"),
      value: count("ended", (r) => r.status === "ended"),
      icon: "check-circle",
      tone: "neutral",
      max: share,
      dataTest: "downtime-summary-ended",
    },
    {
      key: "ended_early",
      label: t("alerts.downtimes.stats.endedEarly"),
      value: count("ended_early", (r) => r.status === "ended_early"),
      icon: "stop-circle",
      tone: "neutral",
      max: share,
      dataTest: "downtime-summary-ended-early",
    },
    {
      key: "cancelled",
      label: t("alerts.downtimes.stats.cancelled"),
      value: count("cancelled", (r) => r.status === "cancelled"),
      icon: "cancel",
      tone: "neutral",
      max: share,
      dataTest: "downtime-summary-cancelled",
    },
    {
      key: "total",
      label: t("alerts.downtimes.stats.total"),
      value: hasData ? total : "—",
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
    size: 240,
    maxSize: 320,
  },
  {
    id: "schedule",
    header: t("alerts.downtimes.columns.schedule"),
    cell: " ",
    hideable: true,
    size: 220,
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
    size: 160,
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
  { id: "actions", header: raw(""), isAction: true, size: 184, pinned: "right" },
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

const endNowOpen = ref(false);
const pendingEndNow = ref("");

const askEndNow = (row: DowntimeListItem) => {
  pendingEndNow.value = row.id;
  endNowOpen.value = true;
};

const confirmEndNow = async () => {
  endNowOpen.value = false;
  await cancelIds([pendingEndNow.value]);
};

const { extendBy } = useExtendDowntime();
const extendOpen = ref(false);
const extendTarget = ref<DowntimeListItem | null>(null);

const openExtendUntil = (row: DowntimeListItem) => {
  extendTarget.value = row;
  extendOpen.value = true;
};

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
