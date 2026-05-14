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
  <OButtonGroup
    class="q-ml-xs q-pa-none element-box-shadow tw:border tw:border-button-outline-border"
  >
    <!-- Save current view -->
    <OButton
      data-test="logs-search-saved-views-btn"
      variant="ghost"
      size="icon-toolbar"
      @click="emit('save-view')"
    >
      <q-icon name="save" size="16px" />
      <q-tooltip>{{ t("search.savedViewsLabel") }}</q-tooltip>
    </OButton>
    <!-- List saved views dropdown -->
    <ODropdown
      :open="savedViewDropdownModel"
      @update:open="
        (v) => {
          savedViewDropdownModel = v;
          if (v) emit('load-saved-views');
        }
      "
      side="bottom"
      align="start"
    >
      <template #trigger>
        <OButton
          data-test="logs-search-saved-views-expand-btn"
          variant="ghost"
          size="icon-toolbar"
        >
          <q-icon name="saved_search" size="16px" />
          <q-icon name="arrow_drop_down" size="18px" class="tw:-ms-1" />
          <q-tooltip>{{ t("search.listSavedViews") }}</q-tooltip>
        </OButton>
      </template>
      <div
        :style="
          localSavedViews.length > 0
            ? 'width: 500px; max-height: 400px; overflow-y: auto'
            : 'width: 250px; max-height: 400px; overflow-y: auto'
        "
      >
        <q-list data-test="logs-search-saved-view-list">
          <q-item style="padding: 0px 0px 0px 0px">
            <q-item-section
              class="column"
              no-hover
              style="width: 60%; border-right: 1px solid lightgray"
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
                id="savedViewList"
                :rows-per-page-options="[]"
                :hide-bottom="
                  searchObj.data.savedViews.length <= rowsPerPage ||
                  searchObj.data.savedViews.length == 0
                "
              >
                <template #top-right>
                  <div class="full-width">
                    <q-input
                      data-test="log-search-saved-view-field-search-input"
                      v-model="searchObj.data.savedViewFilterFields"
                      data-cy="index-field-search-input"
                      borderless
                      dense
                      clearable
                      debounce="1"
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
                    class="full-width float-left"
                  >
                    <div
                      class="text-subtitle2 text-weight-bold float-left"
                    >
                      <q-spinner-hourglass size="20px" />
                      {{ t("confirmDialog.loading") }}
                    </div>
                  </div>
                  <q-tr>
                    <q-td
                      v-if="
                        searchObj.data.savedViews.length == 0 &&
                        searchObj.loadingSavedView == false
                      "
                    >
                      <q-item-label class="q-pl-sm q-pt-sm">{{
                        t("search.savedViewsNotFound")
                      }}</q-item-label>
                    </q-td>
                  </q-tr>
                </template>
                <template v-slot:body-cell-view_name="props">
                  <q-td :props="props" class="field_list" no-hover>
                    <q-item
                      class="q-pa-xs saved-view-item"
                      clickable
                      v-close-popup
                    >
                      <q-item-section
                        @click.stop="emit('apply-saved-view', props.row)"
                        v-close-popup
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
                          emit(
                            'favorite-saved-view',
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
                        @click.stop="emit('update-saved-view', props.row)"
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
                        @click.stop="emit('delete-saved-view', props.row)"
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
                hide-bottom
                :wrap-cells="searchObj.meta.resultGrid.wrapCells"
                class="saved-view-table full-height"
                id="savedViewFavoriteList"
                :rows-per-page-options="[0]"
              >
                <template #top-right>
                  <q-item style="padding: 0px">
                    <q-item-label
                      header
                      class="q-pa-sm text-bold favorite-label"
                      >{{ t("search.favoriteViews") }}</q-item-label
                    >
                  </q-item>
                  <q-separator horizontal inset></q-separator>
                </template>
                <template v-slot:body-cell-view_name="props">
                  <q-td :props="props" class="field_list q-pa-xs">
                    <q-item
                      class="q-pa-xs saved-view-item"
                      clickable
                      v-close-popup
                    >
                      <q-item-section
                        @click.stop="emit('apply-saved-view', props.row)"
                        v-close-popup
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
                          emit(
                            'favorite-saved-view',
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
                        @click.stop="emit('update-saved-view', props.row)"
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
                        @click.stop="emit('delete-saved-view', props.row)"
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
      </div>
    </ODropdown>
  </OButtonGroup>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import useLogs from "@/composables/useLogs";

const { t } = useI18n();
const { searchObj } = useLogs();

defineProps<{
  localSavedViews: any[];
  favoriteViews: string[];
  rowsPerPage: number;
}>();

const emit = defineEmits<{
  "save-view": [];
  "load-saved-views": [];
  "apply-saved-view": [row: any];
  "favorite-saved-view": [row: any, isFavorite: boolean];
  "update-saved-view": [row: any];
  "delete-saved-view": [row: any];
}>();

const savedViewDropdownModel = ref(false);

const filterSavedViewFn = (rows: any[], filter: string) => {
  if (!filter) return rows;
  const term = filter.toLowerCase();
  return rows.filter((row: any) =>
    row.view_name?.toLowerCase().includes(term)
  );
};
</script>
