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
import { computed, ref, watch } from "vue";
import { useI18nTyped, raw } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

interface TracesSavedView {
  view_id: string;
  view_name: string;
}

const props = defineProps<{
  open: boolean;
  views: TracesSavedView[];
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "apply", view: TracesSavedView): void;
  (e: "update", view: TracesSavedView): void;
  (e: "delete", view: TracesSavedView): void;
}>();

const { t } = useI18nTyped();

const search = ref("");

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
    isAction: true,
    sortable: false,
    size: 30,
    meta: { align: "right" as const },
  },
];

const filteredViews = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return props.views;
  return props.views.filter((view) => view.view_name.toLowerCase().includes(term));
});

const applyView = (view: TracesSavedView) => {
  emit("apply", view);
  emit("update:open", false);
};

watch(
  () => props.open,
  (open) => {
    if (open) search.value = "";
  },
);
</script>

<template>
  <ODialog
    :open="props.open"
    size="lg"
    :title="t('search.savedViewsLabel')"
    data-test="traces-saved-views-dialog"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex max-h-120 min-h-70 flex-col">
      <OTable
        data-test="traces-saved-views-dialog-table"
        :data="filteredViews"
        :columns="columns"
        row-key="view_id"
        :show-header="false"
        :show-global-filter="false"
        :page-size="10"
        :page-size-options="[10, 20, 50]"
        class="h-full! max-h-full"
      >
        <template #top>
          <div class="box-border w-full min-w-0 p-2">
            <OSearchInput
              v-model="search"
              data-test="traces-saved-views-dialog-search"
              class="w-full"
              :placeholder="t('search.searchSavedView')"
            />
          </div>
        </template>
        <template #cell-view_name="{ row, value }">
          <div
            class="w-full min-w-0 cursor-pointer truncate text-sm"
            :title="value"
            :data-test="`traces-saved-views-dialog-apply-${row.view_id}`"
            @click.stop="applyView(row)"
          >
            {{ value }}
          </div>
        </template>
        <template #cell-actions="{ row }">
          <div class="flex items-center gap-0.5">
            <OButton
              variant="ghost-neutral"
              size="icon-sm"
              :title="t('search.updateSavedViewWithCurrent')"
              :data-test="`traces-saved-views-dialog-update-${row.view_id}`"
              @click.stop="emit('update', row)"
            >
              <OIcon name="edit" size="xs" />
            </OButton>
            <OButton
              variant="ghost-neutral"
              size="icon-sm"
              :title="t('search.deleteSavedView')"
              :data-test="`traces-saved-views-dialog-delete-${row.view_id}`"
              @click.stop="emit('delete', row)"
            >
              <OIcon name="delete" size="xs" />
            </OButton>
          </div>
        </template>
        <template #empty>
          <div class="w-full p-2 text-center" data-test="traces-saved-views-dialog-empty">
            {{ t("search.savedViewsNotFound") }}
          </div>
        </template>
      </OTable>
    </div>
  </ODialog>
</template>
