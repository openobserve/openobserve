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
  <ODrawer
    v-model:open="open"
    :size="isMobile ? 'full' : 'md'"
    :title="t('metrics.history.title')"
    bleed
    data-test="metrics-history-drawer"
  >
    <template #trigger>
      <OButton
        variant="outline"
        size="icon-toolbar"
        icon-left="history"
        :aria-label="t('metrics.history.title')"
        data-test="metrics-history-btn"
      >
        <OTooltip :content="t('metrics.history.title')" />
      </OButton>
    </template>

    <div class="flex h-full min-h-0 flex-col">
      <div class="border-border-default flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <OSearchInput
          v-model="search"
          size="sm"
          clearable
          :debounce="300"
          :placeholder="t('metrics.history.searchPlaceholder')"
          class="min-w-0 flex-1"
          data-test="metrics-history-search"
        />
        <OSwitch
          v-model="starredOnly"
          size="sm"
          :label="t('metrics.history.starredOnly')"
          data-test="metrics-history-starred-only"
        />
      </div>
      <div class="min-h-0 flex-1">
        <OTable
          :data="rows"
          :columns="columns"
          row-key="id"
          :loading="history.isPending.value && open"
          :frame="false"
          :default-columns="false"
          :show-global-filter="false"
          pagination="none"
          sorting="none"
          wrap
          data-test="metrics-history-table"
          @row-click="onLoad"
        >
          <template #cell-query="{ row }">
            <span class="text-text-body font-mono text-xs break-all">{{ row.query }}</span>
          </template>
          <template #cell-created_at="{ row }">
            <OTimeCell :value="row.created_at" unit="us" mode="relative" />
          </template>
          <template #cell-actions="{ row }">
            <div class="flex items-center gap-1">
              <OButton
                variant="ghost"
                size="icon-sm"
                class="max-md:hidden"
                :icon-left="row.starred ? 'star' : 'star-outline'"
                :aria-label="row.starred ? t('metrics.history.unstar') : t('metrics.history.star')"
                :data-test="`metrics-history-star-${row.id}`"
                @click.stop="toggleStar(row)"
              >
                <OTooltip
                  :content="row.starred ? t('metrics.history.unstar') : t('metrics.history.star')"
                />
              </OButton>
              <OButton
                variant="ghost-destructive"
                size="icon-sm"
                class="max-md:hidden"
                icon-left="delete"
                :aria-label="t('common.delete')"
                :data-test="`metrics-history-delete-${row.id}`"
                @click.stop="deleteEntry.mutate(row.id)"
              >
                <OTooltip :content="t('common.delete')" />
              </OButton>
              <ODropdown side="bottom" align="end">
                <template #trigger>
                  <OButton
                    variant="ghost"
                    size="icon-xs-sq"
                    icon-left="more-vert"
                    class="md:hidden"
                    :aria-label="t('common.more')"
                    :data-test="`metrics-history-more-${row.id}`"
                    @click.stop
                  />
                </template>
                <ODropdownItem
                  :icon-left="row.starred ? 'star' : 'star-outline'"
                  :data-test="`metrics-history-star-${row.id}-menu`"
                  @select="toggleStar(row)"
                >
                  <span>{{
                    row.starred ? t("metrics.history.unstar") : t("metrics.history.star")
                  }}</span>
                </ODropdownItem>
                <ODropdownItem
                  variant="destructive"
                  icon-left="delete"
                  :data-test="`metrics-history-delete-${row.id}-menu`"
                  @select="deleteEntry.mutate(row.id)"
                >
                  <span>{{ t("common.delete") }}</span>
                </ODropdownItem>
              </ODropdown>
            </div>
          </template>
          <template #empty>
            <OEmptyState
              size="inline"
              icon="history"
              :title="filtered ? t('metrics.history.noMatch') : t('metrics.history.empty')"
              data-test="metrics-history-empty"
            />
          </template>
        </OTable>
      </div>
      <div
        v-if="history.hasNextPage.value"
        class="border-border-default flex shrink-0 justify-center border-t p-3"
      >
        <OButton
          variant="outline"
          size="sm"
          :loading="history.isFetchingNextPage.value"
          data-test="metrics-history-load-more"
          @click="history.fetchNextPage()"
        >
          {{ t("metrics.history.loadMore") }}
        </OButton>
      </div>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useInfiniteQuery, useMutation } from "@tanstack/vue-query";
import { useI18nTyped } from "@/types/i18n";
import useBreakpoint from "@/composables/useBreakpoint";
import { useOrgId } from "@/composables/query/useOrgId";
import {
  deleteQueryHistoryMutation,
  queryHistoryQuery,
  starQueryHistoryMutation,
} from "@/services/query_history.queries";
import type { QueryHistoryEntry } from "@/services/query_history";
import { historyEntryToLoad } from "@/utils/metrics/queryHistory";
import type { SelectedDate } from "@/utils/dashboard/urlTimeParams";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";

const emit = defineEmits<{
  load: [entry: { metricsData: string; timeRange: SelectedDate }];
}>();

const { t } = useI18nTyped();
const { isMobile } = useBreakpoint();
const orgId = useOrgId();

const open = ref(false);
const search = ref("");
const starredOnly = ref(false);

const history = useInfiniteQuery(() =>
  Object.assign(queryHistoryQuery(orgId.value, starredOnly.value, search.value.trim()), {
    enabled: open.value && !!orgId.value,
  }),
);
const filtered = computed(() => !!search.value.trim() || starredOnly.value);
// The server returns newest first; the table keeps that order.
const rows = computed(() => history.data.value?.pages.flat() ?? []);

const starEntry = useMutation(() => starQueryHistoryMutation(orgId.value));
const deleteEntry = useMutation(() => deleteQueryHistoryMutation(orgId.value));

const toggleStar = (row: QueryHistoryEntry) =>
  starEntry.mutate({ id: row.id, starred: !row.starred });

const columns = computed<OTableColumnDef<QueryHistoryEntry>[]>(() => [
  {
    id: "query",
    header: t("metrics.history.query"),
    accessorKey: "query",
    meta: { autoWidth: true, fillRemaining: true },
  },
  { id: "created_at", header: t("metrics.history.ranAt"), accessorKey: "created_at", size: 112 },
  { id: "actions", header: t("common.actions"), isAction: true, size: 80 },
]);

const onLoad = (row: QueryHistoryEntry) => {
  const entry = historyEntryToLoad(row.context);
  if (!entry) return;
  emit("load", entry);
  open.value = false;
};
</script>
