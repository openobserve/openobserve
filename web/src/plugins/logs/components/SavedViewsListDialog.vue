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
  <ODialog
    v-model:open="isOpen"
    size="lg"
    :title="t('search.savedViewsLabel')"
    data-test="saved-views-list-dialog"
  >
    <q-list data-test="logs-search-saved-view-list">
      <q-item style="padding: 0px 0px 0px 0px">
        <q-item-section
          class="column"
          no-hover
          :style="
            localSavedViews.length > 0
              ? 'width: 60%; border-right: 1px solid lightgray'
              : 'width: 100%'
          "
        >
          <q-table
            data-test="log-search-saved-view-list-fields-table"
            :visible-columns="['view_name']"
            :rows="searchObj.data.savedViews"
            :row-key="(row) => 'saved_view_' + row.view_id"
            :filter="searchObj.data.savedViewFilterFields"
            :filter-method="filterSavedViewFn"
            :pagination="{ rowsPerPage }"
            hide-header
            :wrap-cells="searchObj.meta.resultGrid.wrapCells"
            class="saved-view-table full-height"
            no-hover
            :rows-per-page-options="[]"
            :hide-bottom="searchObj.data.savedViews.length == 0"
          >
            <template #top>
              <div class="full-width">
                <q-input
                  data-test="log-search-saved-view-field-search-input"
                  v-model="searchObj.data.savedViewFilterFields"
                  borderless
                  dense
                  clearable
                  debounce="300"
                  class="tw:mx-2 tw:my-2"
                  :placeholder="t('search.searchSavedView')"
                >
                  <template #prepend>
                    <q-icon name="search" />
                  </template>
                </q-input>
              </div>
              <div
                v-if="searchObj.loadingSavedView == true"
                class="full-width q-pa-sm"
              >
                <div class="text-subtitle2 text-weight-bold">
                  <q-spinner-hourglass size="20px" />
                  {{ t("confirmDialog.loading") }}
                </div>
              </div>
            </template>
            <template v-slot:no-data>
              <div
                v-if="searchObj.loadingSavedView == false"
                class="text-center q-pa-sm tw:w-full"
              >
                <q-item-label>{{
                  t("search.savedViewsNotFound")
                }}</q-item-label>
              </div>
            </template>
            <template v-slot:body-cell-view_name="props">
              <q-td :props="props" class="field_list" no-hover>
                <q-item class="q-pa-xs saved-view-item" clickable>
                  <q-item-section
                    @click.stop="
                      applySavedView(props.row);
                      isOpen = false;
                    "
                    :title="props.row.view_name"
                  >
                    <q-item-label
                      class="ellipsis"
                      style="max-width: 140px"
                      >{{ props.row.view_name }}</q-item-label
                    >
                  </q-item-section>
                  <q-item-section
                    :data-test="`logs-search-bar-favorite-${props.row.view_name}-saved-view-btn`"
                    side
                    @click.stop="
                      handleFavoriteSavedView(
                        props.row,
                        favoriteViews.includes(props.row.view_id),
                      )
                    "
                  >
                    <OButton
                      :title="t('common.favourite')"
                      class="logs-saved-view-icon"
                      variant="ghost"
                      size="icon"
                    >
                      <q-icon
                        :name="
                          favoriteViews.includes(props.row.view_id)
                            ? 'favorite'
                            : 'favorite_border'
                        "
                        size="xs"
                      />
                    </OButton>
                  </q-item-section>
                  <q-item-section
                    :data-test="`logs-search-bar-update-${props.row.view_name}-saved-view-btn`"
                    side
                    @click.stop="handleUpdateSavedView(props.row)"
                  >
                    <OButton
                      :title="t('common.edit')"
                      class="logs-saved-view-icon"
                      variant="ghost"
                      size="icon"
                    >
                      <q-icon name="edit" size="xs" />
                    </OButton>
                  </q-item-section>
                  <q-item-section
                    :data-test="`logs-search-bar-delete-${props.row.view_name}-saved-view-btn`"
                    side
                    @click.stop="handleDeleteSavedView(props.row)"
                  >
                    <OButton
                      :title="t('common.delete')"
                      class="logs-saved-view-icon"
                      variant="ghost"
                      size="icon"
                    >
                      <q-icon name="delete" size="xs" />
                    </OButton>
                  </q-item-section>
                </q-item>
              </q-td>
            </template>
          </q-table>
        </q-item-section>

        <q-item-section
          class="column"
          style="width: 40%; margin-left: 0px"
          v-if="localSavedViews.length > 0"
        >
          <q-table
            data-test="log-search-saved-view-favorite-list-fields-table"
            :visible-columns="['view_name']"
            :rows="localSavedViews"
            :row-key="(row) => 'favorite_saved_view_' + row.view_name"
            hide-header
            :wrap-cells="searchObj.meta.resultGrid.wrapCells"
            class="saved-view-table full-height"
            :rows-per-page-options="[]"
            :hide-bottom="true"
          >
            <template #top-right>
              <q-item style="padding: 0px"
                ><q-item-label
                  header
                  class="q-pa-sm text-bold favorite-label"
                  >{{ t("search.favoriteViews") }}</q-item-label
                ></q-item
              >
              <q-separator horizontal inset></q-separator>
            </template>
            <template v-slot:body-cell-view_name="props">
              <q-td :props="props" class="field_list q-pa-xs">
                <q-item class="q-pa-xs saved-view-item" clickable>
                  <q-item-section
                    @click.stop="
                      applySavedView(props.row);
                      isOpen = false;
                    "
                  >
                    <q-item-label
                      class="ellipsis"
                      style="max-width: 90px"
                      >{{ props.row.view_name }}</q-item-label
                    >
                  </q-item-section>
                  <q-item-section
                    :data-test="`logs-search-bar-favorite-${props.row.view_name}-saved-view-btn`"
                    side
                    @click.stop="
                      handleFavoriteSavedView(
                        props.row,
                        favoriteViews.includes(props.row.view_id),
                      )
                    "
                  >
                    <q-icon
                      :name="
                        favoriteViews.includes(props.row.view_id)
                          ? 'favorite'
                          : 'favorite_border'
                      "
                      color="grey"
                      size="xs"
                    />
                  </q-item-section>
                  <q-item-section
                    :data-test="`logs-search-bar-update-${props.row.view_name}-favorite-saved-view-btn`"
                    side
                    @click.stop="handleUpdateSavedView(props.row)"
                  >
                    <OButton
                      :title="t('common.edit')"
                      class="logs-saved-view-icon"
                      variant="ghost"
                      size="icon"
                    >
                      <q-icon name="edit" size="xs" />
                    </OButton>
                  </q-item-section>
                  <q-item-section
                    :data-test="`logs-search-bar-delete-${props.row.view_name}-favorite-saved-view-btn`"
                    side
                    @click.stop="handleDeleteSavedView(props.row)"
                  >
                    <OButton
                      :title="t('common.delete')"
                      class="logs-saved-view-icon"
                      variant="ghost"
                      size="icon"
                    >
                      <q-icon name="delete" size="xs" />
                    </OButton>
                  </q-item-section>
                </q-item>
              </q-td>
            </template>
          </q-table>
        </q-item-section>
      </q-item>
    </q-list>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import useLogs from "@/composables/useLogs";

const { t } = useI18n();
const { searchObj } = useLogs();

const props = defineProps<{
  modelValue: boolean;
  localSavedViews: any[];
  favoriteViews: string[];
  rowsPerPage: number;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  "apply-saved-view": [row: any];
  "favorite-saved-view": [row: any, isFavorite: boolean];
  "update-saved-view": [row: any];
  "delete-saved-view": [row: any];
}>();

const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit("update:modelValue", val),
});

const filterSavedViewFn = (rows: any[], filter: string) => {
  if (!filter) return rows;
  const term = filter.toLowerCase();
  return rows.filter((row: any) =>
    row.view_name?.toLowerCase().includes(term)
  );
};

const applySavedView = (row: any) => {
  emit("apply-saved-view", row);
};

const handleFavoriteSavedView = (row: any, isFavorite: boolean) => {
  emit("favorite-saved-view", row, isFavorite);
};

const handleUpdateSavedView = (row: any) => {
  emit("update-saved-view", row);
};

const handleDeleteSavedView = (row: any) => {
  emit("delete-saved-view", row);
};
</script>
