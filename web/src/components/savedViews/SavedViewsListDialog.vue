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

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, raw } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";

export interface SavedViewRow {
  view_id: string;
  view_name: string;
  [key: string]: unknown;
}

type Pane = "all" | "favorites";

interface DialogTestIds {
  root: string;
  list: string;
  search: string;
  loading: string;
  empty: string;
  table: (pane: Pane) => string;
  apply: (pane: Pane, row: SavedViewRow) => string;
  favorite: (pane: Pane, row: SavedViewRow) => string;
  update: (pane: Pane, row: SavedViewRow) => string;
  remove: (pane: Pane, row: SavedViewRow) => string;
  more: (pane: Pane, row: SavedViewRow) => string;
}

const props = withDefaults(
  defineProps<{
    open: boolean;
    views: SavedViewRow[];
    favoriteIds: string[];
    favoriteViews: SavedViewRow[];
    loading?: boolean;
    module: "logs" | "traces";
  }>(),
  { loading: false },
);

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "apply", row: SavedViewRow): void;
  (e: "update", row: SavedViewRow): void;
  (e: "delete", row: SavedViewRow): void;
  (e: "toggle-favorite", row: SavedViewRow, isFavorite: boolean): void;
}>();

const search = defineModel<string>("search", { default: "" });

const { t } = useI18nTyped();

// Logs values are pinned by the e2e page objects (tests/ui-testing/pages/logsPages/logsPage.js).
const LOGS_TEST_IDS: DialogTestIds = {
  root: "saved-views-list-dialog",
  list: "logs-search-saved-view-list",
  search: "log-search-saved-view-field-search-input",
  loading: "logs-search-saved-view-list-loading",
  empty: "logs-search-saved-view-list-empty",
  table: (pane) =>
    pane === "all"
      ? "log-search-saved-view-list-fields-table"
      : "log-search-saved-view-favorite-list-fields-table",
  apply: (pane, row) =>
    pane === "all"
      ? `logs-search-bar-apply-${row.view_name}-saved-view-btn`
      : `logs-search-bar-dialog-favorite-saved-view-row-${row.view_name}`,
  favorite: (_pane, row) => `logs-search-bar-favorite-${row.view_id}-saved-view-btn`,
  update: (pane, row) =>
    `logs-search-bar-update-${row.view_id}-${pane === "all" ? "" : "favorite-"}saved-view-btn`,
  remove: (pane, row) =>
    `logs-search-bar-delete-${row.view_id}-${pane === "all" ? "" : "favorite-"}saved-view-btn`,
  more: (pane) =>
    pane === "all"
      ? "logs-search-bar-saved-view-row-more-actions"
      : "logs-search-bar-favorite-saved-view-row-more-actions",
};

const tracesPrefix = (pane: Pane) =>
  pane === "all" ? "traces-saved-views-dialog" : "traces-saved-views-dialog-favorites";

const TRACES_TEST_IDS: DialogTestIds = {
  root: "traces-saved-views-dialog",
  list: "traces-saved-views-dialog-list",
  search: "traces-saved-views-dialog-search",
  loading: "traces-saved-views-dialog-loading",
  empty: "traces-saved-views-dialog-empty",
  table: (pane) => `${tracesPrefix(pane)}-table`,
  apply: (pane, row) => `${tracesPrefix(pane)}-apply-${row.view_id}`,
  favorite: (pane, row) => `${tracesPrefix(pane)}-favorite-${row.view_id}`,
  update: (pane, row) => `${tracesPrefix(pane)}-update-${row.view_id}`,
  remove: (pane, row) => `${tracesPrefix(pane)}-delete-${row.view_id}`,
  more: (pane, row) => `${tracesPrefix(pane)}-more-actions-${row.view_id}`,
};

// No `isAction`: it pins the column right, and a pinned column draws a sticky shadow over the row.
const columns = [
  {
    id: "view_name",
    header: raw(""),
    accessorKey: "view_name",
    sortable: false,
    meta: { align: "left" as const },
  },
  {
    id: "actions",
    header: raw(""),
    sortable: false,
    size: 30,
    meta: { align: "right" as const, actionCount: 3 },
  },
];

const HOVER_REVEAL =
  "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 max-md:opacity-100";

const ids = computed(() => (props.module === "logs" ? LOGS_TEST_IDS : TRACES_TEST_IDS));

const filteredViews = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return props.views;
  return props.views.filter((view) => String(view.view_name).toLowerCase().includes(term));
});

const panes = computed(() => {
  const hasFavorites = props.favoriteViews.length > 0;
  const all = {
    key: "all" as Pane,
    rows: filteredViews.value,
    class: hasFavorites ? "border-card-glass-border w-3/5 border-e" : "w-full",
  };
  if (!hasFavorites) return [all];
  return [all, { key: "favorites" as Pane, rows: props.favoriteViews, class: "w-2/5 ps-3" }];
});

const isFavorite = (pane: Pane, row: SavedViewRow) =>
  pane === "favorites" || props.favoriteIds.includes(row.view_id);

const applyView = (row: SavedViewRow) => {
  emit("apply", row);
  emit("update:open", false);
};
</script>

<template>
  <ODialog
    :open="props.open"
    size="lg"
    :title="t('search.savedViewsLabel')"
    :data-test="ids.root"
    @update:open="emit('update:open', $event)"
  >
    <div :data-test="ids.list" class="flex">
      <div
        v-for="pane in panes"
        :key="pane.key"
        class="flex max-h-120 min-h-70 flex-col"
        :class="pane.class"
      >
        <OTable
          :data-test="ids.table(pane.key)"
          :data="pane.rows"
          :columns="columns"
          row-key="view_id"
          compact
          :show-header="false"
          :show-global-filter="false"
          :pagination-bordered="false"
          :pagination="pane.key === 'all' ? 'client' : 'none'"
          :page-size="10"
          :page-size-options="[10, 20, 50]"
          class="min-h-0 flex-1"
        >
          <template #top>
            <template v-if="pane.key === 'all'">
              <div class="box-border w-full min-w-0 p-2">
                <OSearchInput
                  v-model="search"
                  :data-test="ids.search"
                  clearable
                  :debounce="300"
                  class="w-full"
                  :placeholder="t('search.searchSavedView')"
                />
              </div>
              <div
                v-if="props.loading"
                :data-test="ids.loading"
                class="flex w-full items-center gap-2 p-2 text-sm font-medium"
              >
                <OSpinner size="xs" />
                {{ t("confirmDialog.loading") }}
              </div>
            </template>
            <template v-else>
              <div class="text-text-secondary p-2 text-xs leading-6 font-bold tracking-wide">
                {{ t("search.favoriteViews") }}
              </div>
              <OSeparator class="my-1" />
            </template>
          </template>
          <template #cell-view_name="{ row, value }">
            <div
              class="w-full min-w-0 cursor-pointer truncate text-sm"
              :title="value"
              :data-test="ids.apply(pane.key, row)"
              @click.stop="applyView(row)"
            >
              {{ value }}
            </div>
          </template>
          <template #cell-actions="{ row }">
            <div class="flex items-center gap-0.5">
              <OButton
                :title="t('common.favourite')"
                variant="ghost-neutral"
                size="icon-sm"
                :class="HOVER_REVEAL"
                :data-test="ids.favorite(pane.key, row)"
                @click.stop="emit('toggle-favorite', row, isFavorite(pane.key, row))"
              >
                <OIcon
                  :name="isFavorite(pane.key, row) ? 'star' : 'star-outline'"
                  size="xs"
                  :class="isFavorite(pane.key, row) ? 'text-favorite' : ''"
                />
              </OButton>
              <OButton
                :title="t('common.edit')"
                variant="ghost-neutral"
                size="icon-sm"
                :class="[HOVER_REVEAL, 'max-md:hidden']"
                :data-test="ids.update(pane.key, row)"
                @click.stop="emit('update', row)"
              >
                <OIcon name="edit" size="xs" />
              </OButton>
              <OButton
                :title="t('common.delete')"
                variant="ghost-neutral"
                size="icon-sm"
                :class="[HOVER_REVEAL, 'max-md:hidden']"
                :data-test="ids.remove(pane.key, row)"
                @click.stop="emit('delete', row)"
              >
                <OIcon name="delete" size="xs" />
              </OButton>
              <ODropdown side="bottom" align="end">
                <template #trigger>
                  <OButton
                    icon-left="more-vert"
                    variant="ghost"
                    size="icon-xs-sq"
                    class="md:hidden"
                    :data-test="ids.more(pane.key, row)"
                    @click.stop
                  />
                </template>
                <ODropdownItem
                  icon-left="edit"
                  class="md:hidden"
                  :data-test="`${ids.update(pane.key, row)}-menu`"
                  @select="emit('update', row)"
                >
                  <span>{{ t("common.edit") }}</span>
                </ODropdownItem>
                <ODropdownItem
                  icon-left="delete"
                  variant="destructive"
                  class="md:hidden"
                  :data-test="`${ids.remove(pane.key, row)}-menu`"
                  @select="emit('delete', row)"
                >
                  <span>{{ t("common.delete") }}</span>
                </ODropdownItem>
              </ODropdown>
            </div>
          </template>
          <template #empty>
            <OEmptyState
              v-if="!props.loading"
              size="inline"
              :title="t('search.savedViewsNotFound')"
              :data-test="ids.empty"
            />
          </template>
        </OTable>
      </div>
    </div>
  </ODialog>
</template>
