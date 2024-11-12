<!-- Copyright 2023 OpenObserve Inc.

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
  <q-btn-group class="q-ml-xs no-outline q-pa-none no-border">
    <q-btn-dropdown
      data-test="logs-search-saved-views-btn"
      v-model="savedViewDropdownModel"
      size="12px"
      icon="save"
      icon-right="saved_search"
      :title="t('search.savedViewsLabel')"
      @click="fnSavedView"
      @show="loadSavedView"
      split
      class="no-outline saved-views-dropdown no-border"
    >
      <q-list
        :style="localSavedViews.length > 0 ? 'width: 500px' : 'width: 250px'"
        data-test="logs-search-saved-view-list"
      >
        <q-item style="padding: 0px 0px 0px 0px">
          <q-item-section
            class="column"
            style="width: 60%; border-right: 1px solid lightgray"
          >
            <q-table
              data-test="log-search-saved-view-list-fields-table"
              :visible-columns="['view_name']"
              :rows="searchObj.data.savedViews"
              :row-key="(row: any) => 'saved_view_' + row.view_id"
              :filter="searchObj.data.savedViewFilterFields"
              :filter-method="filterSavedViewFn"
              :pagination="{ rowsPerPage }"
              hide-header
              :wrap-cells="searchObj.meta.resultGrid.wrapCells"
              class="saved-view-table full-height"
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
                    filled
                    borderless
                    dense
                    clearable
                    debounce="1"
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
                  <div class="text-subtitle2 text-weight-bold float-left">
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
                <q-td :props="props" class="field_list">
                  <q-item
                    class="q-pa-sm saved-view-item"
                    clickable
                    v-close-popup
                  >
                    <q-item-section
                      @click.stop="applySavedView(props.row)"
                      v-close-popup
                      :title="props.row.view_name"
                    >
                      <q-item-label class="ellipsis" style="max-width: 165px">{{
                        props.row.view_name
                      }}</q-item-label>
                    </q-item-section>
                    <q-item-section
                      :data-test="`logs-search-bar-favorite-${props.row.view_name}-saved-view-btn`"
                      side
                      @click="handleUpdateSavedView(props.row, props.row.view_name)"
                    >
                      <q-icon
                        name="save"
                        color="grey"
                        size="xs"
                      />
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
                      :data-test="`logs-search-bar-delete-${props.row.view_name}-saved-view-btn`"
                      side
                      @click.stop="handleDeleteSavedView(props.row)"
                    >
                      <q-icon name="delete"
                        color="grey" size="xs" />

                    </q-item-section>
                  </q-item> </q-td
              ></template>
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
              :row-key="(row: any) => 'favorite_saved_view_' + row.view_name"
              hide-header
              hide-bottom
              :wrap-cells="searchObj.meta.resultGrid.wrapCells"
              class="saved-view-table full-height"
              id="savedViewFavoriteList"
              :rows-per-page-options="[0]"
            >
              <template #top-right>
                <q-item style="padding: 0px"
                  ><q-item-label header
class="q-pa-sm text-bold favorite-label"
                    >Favorite Views</q-item-label
                  ></q-item
                >
                <q-separator horizontal inset></q-separator>
              </template>
              <template v-slot:body-cell-view_name="props">
                <q-td :props="props" class="field_list q-pa-xs">
                  <q-item
                    class="q-pa-sm saved-view-item"
                    clickable
                    v-close-popup
                  >
                    <q-item-section
                      @click.stop="applySavedView(props.row)"
                      v-close-popup
                    >
                      <q-item-label class="ellipsis" style="max-width: 185px">{{
                        props.row.view_name
                      }}</q-item-label>
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
                  </q-item> </q-td
              ></template>
            </q-table>
          </q-item-section>
        </q-item>
      </q-list>
    </q-btn-dropdown>
  </q-btn-group>

  <q-dialog v-model="store.state.savedViewDialog">
    <q-card style="width: 63%; max-width: 80vw">
      <q-card-section class="row q-px-md q-py-xs">
        <div class="text-h6 col">{{ t("search.savedViewsLabel") }}</div>
        <q-btn
          icon="close"
          class="float-right q-pa-none"
          round
          size="md"
          flat
          dense
          v-close-popup
        />
      </q-card-section>

      <div  class="field-container">
        <div class="oo-field q-pl-md q-pr-md q-pt-md">
          <label for="create_saved_view_name" class="q-mr-sm">{{
            t("search.savedViewName")
          }}</label>
          <q-input
            id="create_saved_view_name"
            ref="savedViewNameRef"
            data-test="add-alert-name-input"
            v-model="savedViewName"
            color="input-border"
            stack-label
            outlined
            filled
            dense
            
            class="col q-mr-sm create-saved-view-input"
            :rules="[
              (val: string) => !!val.trim() || 'This field is required',
              (val: string) =>
                /^[-A-Za-z0-9 /@/_]+$/.test(val) ||
                'Input must be alphanumeric',
            ]"
            placeholder="Search or Enter a new view name..."
            tabindex="0"
            @on:updated:model-value="filterSavedView"
          />
          <q-btn
            data-test="saved-view-dialog-save-btn"
            v-if="!saveViewLoader"
            unelevated
            no-caps
            :label="t('confirmDialog.create')"
            color="secondary"
            class="q-mr-sm text-bold"
            @click="handleSavedView('create')"
          />
          <q-btn
            data-test="saved-view-dialog-cancel-btn"
            no-caps
            outline
            :label="t('confirmDialog.cancel')"
            color="red"
            class="text-bold btn-cancel"
            v-close-popup
            
          />
         

        </div>
      </div>

      <div class="q-ma-md">
        <div class="row">
          <label for="create_saved_view_name" class="q-mr-sm col">{{
            t("search.existingSavedViews")
          }}</label>
        </div>
        <div style="max-height: 190px; overflow-y: auto; height: 190px">
          <div
            class="row q-mt-xs"
            v-if="filteredSavedViews.length > 0"
            :key="`${currentPage}_${filteredSavedViews.length}`"
          >
            <div
              class="col-3 q-pt-sm"
              v-for="item in paginatedFilteredSavedViews"
              :key="`none-${item.view_id}`"
            >
              <q-radio
                size="xs"
                data-test="saved-view-name-select-${{item.view_id}}"
                dense
                v-model="savedViewSelectedName"
                :val="item"
                :label="truncatedText(item.view_name)"
                :title="item.view_name"
              />
              <div class="q-ml-xs" style="display:inline-block; top: 5px; position: relative;" >
                <q-item-section
                  :data-test="`logs-search-bar-dialog-favorite-${item.view_name}-saved-view-btn`"
                  side
                  @click.stop="
                    handleFavoriteSavedView(
                      item,
                      favoriteViews.includes(item.view_id),
                    )
                  "
                  class="cursor-pointer"
                >
                  <q-icon
                    :name="
                      favoriteViews.includes(item.view_id)
                        ? 'favorite'
                        : 'favorite_border'
                    "
                    color="grey"
                    size="xs"
                  />
                </q-item-section>
              </div>
            </div>
          </div>
          <div v-else class="text-center q-pa-md full-width">
            <q-icon name="saved_search"
              size="100px" style="color: #dedede" />
            <br />
            {{ t("search.noSavedViews") }}
          </div>
        </div>
      </div>

      <q-card-actions class=" text-teal">
        <div class="col q-ml-sm text-left">
          <q-pagination
            v-if="filteredSavedViews.length"
            v-model="currentPage"
            :max="Math.ceil(filteredSavedViews.length / rowsPerPageInModel)"
            max-pages="1"
            direction-links
            boundary-links
            icon-first="skip_previous"
            icon-last="skip_next"
            icon-prev="fast_rewind"
            icon-next="fast_forward"
            :rows-per-page="rowsPerPageInModel"
          ></q-pagination>
        </div>
        <div   class=" text-right">
          <q-btn
            :disable="searchObj.data.savedViews.length == 0 || paginatedFilteredSavedViews.length == 0"
            data-test="saved-view-dialog-save-btn"
            v-if="!saveViewLoader"
            unelevated
            no-caps
            :label="t('confirmDialog.update')"
            color="secondary"
              style="padding: 0px 14px !important;"
            @click="handleSavedView('update')"
            class="text-bold"
          />
          <q-btn
            :disable="searchObj.data.savedViews.length == 0 || paginatedFilteredSavedViews.length == 0"
            data-test="saved-view-dialog-cancel-btn"
            unelevated
            no-caps
            outline
            class="q-mr-sm text-bold q-ml-sm btn-cancel"
            style="padding: 0px 16px !important;"
            :label="t('confirmDialog.cancel')"
            color="red"
            v-close-popup
           
          />
        </div>
      </q-card-actions>
    </q-card>
  </q-dialog>

  <q-dialog
    ref="confirmSavedViewDialog"
    v-model="confirmSavedViewDialogVisible"
  >
    <q-card>
      <q-card-section>
        {{ confirmMessageSavedView }}
      </q-card-section>

      <q-card-actions align="right">
        <q-btn
          data-test="logs-search-bar-confirm-dialog-cancel-btn"
          :label="t('confirmDialog.cancel')"
          class="btn-cancel"
          color="primary"
          @click="cancelConfirmDialog"
        />
        <q-btn
          data-test="logs-search-bar-confirm-dialog-ok-btn"
          :label="t('confirmDialog.ok')"
          color="positive"
          @click="confirmDialogOK"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>

  <ConfirmDialog
    title="Delete Saved View"
    message="Are you sure you want to delete saved view?"
    @update:ok="confirmDeleteSavedViews"
    @update:cancel="confirmDelete = false"
    v-model="confirmDelete"
  />
  <ConfirmDialog
    title="Update Saved View"
    message="Are you sure you want to Update saved view?"
    @update:ok="confirmUpdateSavedView"
    @update:cancel="confirmUpdate = false"
    v-model="confirmUpdate"
  />
</template>

<script setup lang="ts">
import { Ref, ref, toRaw, computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";
import useLogs from "@/composables/useLogs";
import savedviewsService from "@/services/saved_views";
import ConfirmDialog from "@/components/ConfirmDialog.vue";

import { mergeDeep, useLocalSavedView } from "@/utils/zincutils";
let {
  searchObj,
  updatedLocalLogFilterField,
  getSavedViews,
  getQueryData,
  getStreams,
  updateUrlQueryParams,
  resetStreamData,
  loadStreamLists,
  extractFields,
} = useLogs();

const emits = defineEmits([
  "on:populate-function-implementation",
  "on:populate-date-time",
  "on:refresh-interval-change",
]);

const { t } = useI18n();
const $q = useQuasar();
const store = useStore();
const savedViewDropdownModel = ref(false);
const confirmDelete = ref(false);
const confirmUpdate = ref(false);
const deleteViewID = ref("");
const savedViewName = ref("");
const savedViewSelectedName: any = ref({});
const confirmSavedViewDialogVisible: Ref<boolean> = ref(false);

const saveViewLoader = ref(false);
const favoriteViews : any = ref([]);

const localSavedViews: any = ref([]);
const savedViews : any = ref(useLocalSavedView());
const dateTimeRef = ref(null);
const rowsPerPage = ref(10);
const currentPage = ref(1);
const rowsPerPageInModel = ref(24);
const savedViewNameRef = ref(null);
const paginatedFilteredSavedViews = computed(() => {
  const start = (currentPage.value - 1) * rowsPerPageInModel.value;
  const end = currentPage.value * rowsPerPageInModel.value;
  return filteredSavedViews.value.slice(start, end);
});
const filteredSavedViews = computed(() => {
  if (savedViewName.value == "") {
    return searchObj.data.savedViews;
  }

  return searchObj.data.savedViews.filter((item: any) => {
    return item.view_name
      .toLowerCase()
      .includes(savedViewName.value.toLowerCase());
  });
});

let confirmCallback: any = null;
const confirmMessageSavedView: string = t("search.savedViewUpdateConfirmMsg");

const truncatedText = computed(() => {
  return (text: string) => {
    if (text.length > 25) {
      return text.substring(0, 25) + "...";
    }
    return text;
  };
});

if (savedViews.value != null ) {
  let favoriteValues: any = [];
  Object.values(savedViews.value).forEach((view: any) => {
    if (view.org_id === store.state.selectedOrganization.identifier) {
      favoriteViews.value.push(view.view_id);
      favoriteValues.push(view);
    }
  });

  localSavedViews.value.push(...favoriteValues);
}

const loadSavedView = () => {
  if (searchObj.data.savedViews.length == 0) {
    getSavedViews();
  }
};

const fnSavedView = () => {
  if (searchObj.data.stream.selectedStream.length == 0) {
    $q.notify({
      type: "negative",
      message: "No stream available to save view.",
    });
    return;
  }
  loadSavedView();
  store.dispatch("setSavedViewDialog", true);
  savedViewName.value = "";
  saveViewLoader.value = false;
  savedViewSelectedName.value = "";
  savedViewDropdownModel.value = false;
  const element = document.getElementById("create_saved_view_name");
  if (element) {
    element.focus(); // Or any other operation you want
  }
};

const deleteSavedViews = async () => {
  try {
    savedviewsService
      .delete(store.state.selectedOrganization.identifier, deleteViewID.value)
      .then((res) => {
        if (res.status == 200) {
          $q.notify({
            message: `View deleted successfully.`,
            color: "positive",
            position: "bottom",
            timeout: 1000,
          });
          getSavedViews();
        } else {
          $q.notify({
            message: `Error while deleting saved view. ${res.data.error_detail}`,
            color: "negative",
            position: "bottom",
            timeout: 1000,
          });
        }
      })
      .catch((err) => {
        $q.notify({
          message: `Error while deleting saved view.`,
          color: "negative",
          position: "bottom",
          timeout: 1000,
        });
        console.log(err);
      });
  } catch (e: any) {
    console.log("Error while getting saved views", e);
  }
};

const handleSavedView = (action = "create") => {
  if (action == "create") {
    if (
      savedViewName.value == "" ||
      /^[A-Za-z0-9 \-\_]+$/.test(savedViewName.value) == false
    ) {
      $q.notify({
        message: `Please provide valid view name.`,
        color: "negative",
        position: "bottom",
        timeout: 1000,
      });
    } else {
      saveViewLoader.value = true;
      createSavedViews(savedViewName.value);
    }
  } else {
    if (savedViewSelectedName.value?.view_id) {
      saveViewLoader.value = false;
      showSavedViewConfirmDialog(() => {
        saveViewLoader.value = true;
        updateSavedViews(
          savedViewSelectedName.value?.view_id,
          savedViewSelectedName.value?.view_name,
        );
      });
    } else {
      $q.notify({
        message: `Please select saved view to update.`,
        color: "negative",
        position: "bottom",
        timeout: 1000,
      });
    }
  }
};

const createSavedViews = (viewName: string) => {
  try {
    if (viewName.trim() == "") {
      $q.notify({
        message: `Please provide valid view name.`,
        color: "negative",
        position: "bottom",
        timeout: 1000,
      });
      saveViewLoader.value = false;
      return;
    }

    const viewObj: any = {
      data: getSearchObj(),
      view_name: viewName,
    };

    savedviewsService
      .post(store.state.selectedOrganization.identifier, viewObj)
      .then((res) => {
        if (res.status == 200) {
          store.dispatch("setSavedViewDialog", false);
          if (searchObj.data.hasOwnProperty("savedViews") == false) {
            searchObj.data.savedViews = [];
          }
          searchObj.data.savedViews.push({
            org_id: res.data.org_id,
            payload: viewObj.data,
            view_id: res.data.view_id,
            view_name: viewName,
          });
          $q.notify({
            message: `View created successfully.`,
            color: "positive",
            position: "bottom",
            timeout: 1000,
          });
          getSavedViews();
          savedViewName.value = "";
          saveViewLoader.value = false;
        } else {
          saveViewLoader.value = false;
          $q.notify({
            message: `Error while creating saved view. ${res.data.error_detail}`,
            color: "negative",
            position: "bottom",
            timeout: 1000,
          });
        }
      })
      .catch((err) => {
        saveViewLoader.value = false;
        $q.notify({
          message: `Error while creating saved view.`,
          color: "negative",
          position: "bottom",
          timeout: 1000,
        });
        console.log(err);
      });
  } catch (e: any) {
    savedViewName.value = "";
    saveViewLoader.value = false;
    $q.notify({
      message: `Error while saving view: ${e}`,
      color: "negative",
      position: "bottom",
      timeout: 1000,
    });
    console.log("Error while saving view", e);
  }
};

const updateSavedViews = (viewID: string, viewName: string) => {
  try {
    const viewObj: any = {
      data: getSearchObj(),
      view_name: viewName,
    };

    savedviewsService
      .put(store.state.selectedOrganization.identifier, viewID, viewObj)
      .then((res) => {
        if (res.status == 200) {
          store.dispatch("setSavedViewDialog", false);
          //update the payload and view_name in savedViews object based on id
          searchObj.data.savedViews.forEach(
            (item: { view_id: string }, index: string | number) => {
              if (item.view_id == viewID) {
                searchObj.data.savedViews[index].payload = viewObj.data;
                searchObj.data.savedViews[index].view_name = viewName;
              }
            },
          );

          $q.notify({
            message: `View updated successfully.`,
            color: "positive",
            position: "bottom",
            timeout: 1000,
          });
          savedViewSelectedName.value = {};
          saveViewLoader.value = false;
          confirmSavedViewDialogVisible.value = false;
        } else {
          saveViewLoader.value = false;
          $q.notify({
            message: `Error while updating saved view. ${res.data.error_detail}`,
            color: "negative",
            position: "bottom",
            timeout: 1000,
          });
        }
      })
      .catch((err) => {
        saveViewLoader.value = false;
        $q.notify({
          message: `Error while updating saved view.`,
          color: "negative",
          position: "bottom",
          timeout: 1000,
        });
        console.log(err);
      });
  } catch (e: any) {
    savedViewSelectedName.value = {};
    saveViewLoader.value = false;
    $q.notify({
      message: `Error while saving view: ${e}`,
      color: "negative",
      position: "bottom",
      timeout: 1000,
    });
    console.log("Error while saving view", e);
  }
};

const getSearchObj = () => {
  try {
    delete (searchObj.meta as any).scrollInfo;

    //this needs to be under no-check and in future we need to add a setValue in uselogs to handle this
     

      //  if(searchObj.hasOwnProperty("value")){
      //     searchObj.value = undefined;
      //  }

  

      let savedSearchObj = toRaw(searchObj);
    savedSearchObj = JSON.parse(JSON.stringify(savedSearchObj));

    delete savedSearchObj.data.queryResults;
    delete savedSearchObj.data.histogram;
    delete savedSearchObj.data.sortedQueryResults;
    delete (savedSearchObj.data.stream as any).streamLists;
    delete savedSearchObj.data.stream.functions;
    delete savedSearchObj.data.streamResults;
    delete savedSearchObj.data.savedViews;
    delete savedSearchObj.data.transforms;

    //this needs to be under no-check and in future we need to add a timeZone property in uselogs to handle this

   //@ts-ignore

    savedSearchObj.data.timezone = store.state.timezone;

    return savedSearchObj;
    // return b64EncodeUnicode(JSON.stringify(savedSearchObj));
  } catch (e) {
    console.log("Error while encoding search obj", e);
  }
};

const applySavedView = (item: { view_id: string; view_name: any }) => {
  searchObj.shouldIgnoreWatcher = true;
  searchObj.meta.sqlMode = false;
  savedviewsService
    .getViewDetail(store.state.selectedOrganization.identifier, item.view_id)
    .then(async (res) => {
      if (res.status == 200) {
        store.dispatch("setSavedViewFlag", true);
        const extractedObj = res.data.data;

        // Resetting columns as its not required in searchObj
        // As we reassign columns from selectedFields and search results
        extractedObj.data.resultGrid.columns = [];

        // As in saved view, we observed field getting duplicated in selectedFields
        // So, we are removing duplicates before applying saved view
        if (extractedObj.data.stream.selectedFields?.length) {
          extractedObj.data.stream.selectedFields = [
            ...new Set(extractedObj.data.stream.selectedFields),
          ];
        }

        if (extractedObj.data?.timezone) {
          store.dispatch("setTimezone", extractedObj.data.timezone);
        }

        if (!extractedObj.data.stream.hasOwnProperty("streamType")) {
          extractedObj.data.stream.streamType = "logs";
        }

        delete searchObj.data.queryResults.aggs;

        if (
          searchObj.data.stream.streamType ==
          extractedObj.data.stream.streamType
        ) {
          // if (
          //   extractedObj.data.stream.selectedStream.value !=
          //   searchObj.data.stream.selectedStream.value
          // ) {
          //   extractedObj.data.stream.streamLists =
          //     searchObj.data.stream.streamLists;
          // }
          // ----- Here we are explicitly handling stream change for multistream -----
          let selectedStreams = [];
          const streamValues = searchObj.data.stream.streamLists.map(
            (item:any) => item.value,
          );
          if (typeof extractedObj.data.stream.selectedStream == "object") {
            if (
              extractedObj.data.stream.selectedStream.hasOwnProperty("value")
            ) {
              selectedStreams.push(
                extractedObj.data.stream.selectedStream.value,
              );
            } else {
              selectedStreams.push(...extractedObj.data.stream.selectedStream);
            }
          } else {
            selectedStreams.push(extractedObj.data.stream.selectedStream);
          }
          const streamNotExist : any = selectedStreams.filter(
            (stream_str) => !streamValues.includes(stream_str),
          );
          if (streamNotExist.length > 0) {
            let errMsg = t("search.streamNotExist").replace(
              "[STREAM_NAME]",
              streamNotExist,
            );
            throw new Error(errMsg);
            return;
          }
          // extractedObj.data.stream.selectedStream = [];
          // extractedObj.data.stream.selectedStream = selectedStreams;
          delete extractedObj.data.stream.streamLists;
          delete extractedObj.data.stream.selectedStream;
          delete searchObj.data.stream.selectedStream;
          delete (searchObj.meta as any).regions;
          if (extractedObj.meta.hasOwnProperty("regions")) {
            searchObj.meta["regions"] = extractedObj.meta.regions;
          } else {
            searchObj.meta["regions"] = [];
          }
          delete searchObj.data.queryResults.aggs;
          delete (searchObj.data.stream as any).interestingFieldList;
          searchObj.data.stream.selectedStream = [];
          extractedObj.data.transforms = searchObj.data.transforms;
          extractedObj.data.stream.functions = searchObj.data.stream.functions;
          extractedObj.data.histogram = {
            xData: [],
            yData: [],
            chartParams: {},
          };
          extractedObj.data.savedViews = searchObj.data.savedViews;
          extractedObj.data.queryResults = [];
          extractedObj.meta.scrollInfo = {};
          //this needs to be under no-check
          searchObj = mergeDeep(searchObj, extractedObj);
          searchObj.shouldIgnoreWatcher = true;
          // await nextTick();
          if (extractedObj.data.tempFunctionContent != "") {
            emits(
              "on:populate-function-implementation",
              {
                name: "",
                function: extractedObj.data.tempFunctionContent,
              },
              false,
            );
            // populateFunctionImplementation(
            //   {
            //     name: "",
            //     function: searchObj.data.tempFunctionContent,
            //   },
            //   false,
            // );
            searchObj.data.tempFunctionContent =
              extractedObj.data.tempFunctionContent;
            searchObj.meta.functionEditorPlaceholderFlag = false;
          } else {
            emits(
              "on:populate-function-implementation",
              {
                name: "",
                function: "",
              },
              false,
            );
            // populateFunctionImplementation(
            //   {
            //     name: "",
            //     function: "",
            //   },
            //   false,
            // );
            searchObj.data.tempFunctionContent = "";
            searchObj.meta.functionEditorPlaceholderFlag = true;
          }
          emits("on:populate-date-time");
          if (searchObj.meta.refreshInterval != 0) {
            emits("on:refresh-interval-change");
          } else {
            clearInterval(store.state.refreshIntervalID);
          }
          searchObj.data.stream.selectedStream.push(...selectedStreams);
          await updatedLocalLogFilterField();
          await getStreams("logs", true);
        } else {
          // ----- Here we are explicitly handling stream change -----
          resetStreamData();
          searchObj.data.stream.streamType =
            extractedObj.data.stream.streamType;

          delete (searchObj.meta as any).regions;
          if (extractedObj.meta.hasOwnProperty("regions")) {
            searchObj.meta["regions"] = extractedObj.meta.regions;
          } else {
            searchObj.meta["regions"] = [];
          }
          // Here copying selected stream object, as in loadStreamLists() we are setting selected stream object to empty object
          // After loading stream list, we are setting selected stream object to copied object
          // const selectedStream = cloneDeep(
          //   extractedObj.data.stream.selectedStream
          // );
          let selectedStreams = [];
          if (typeof extractedObj.data.stream.selectedStream == "object") {
            if (
              extractedObj.data.stream.selectedStream.hasOwnProperty("value")
            ) {
              selectedStreams.push(
                extractedObj.data.stream.selectedStream.value,
              );
            } else {
              selectedStreams.push(...extractedObj.data.stream.selectedStream);
            }
          } else {
            selectedStreams.push(extractedObj.data.stream.selectedStream);
          }

          extractedObj.data.transforms = searchObj.data.transforms;
          extractedObj.data.histogram = {
            xData: [],
            yData: [],
            chartParams: {},
          };
          extractedObj.data.savedViews = searchObj.data.savedViews;
          extractedObj.data.queryResults = [];
          extractedObj.meta.scrollInfo = {};
          delete searchObj.data.queryResults.aggs;
           //this needs to be under no-check
          searchObj = mergeDeep(searchObj, extractedObj);
          searchObj.data.streamResults = {};

          const streamData = await getStreams(
            searchObj.data.stream.streamType,
            true,
          );
          searchObj.data.streamResults = streamData;
          await loadStreamLists();
          searchObj.data.stream.selectedStream = [selectedStreams];

          const streamValues = searchObj.data.stream.streamLists.map(
            (item : any) => item.value,
          );
          const streamNotExist : any = selectedStreams.filter(
            (stream_str) => !streamValues.includes(stream_str),
          );
          if (streamNotExist.length > 0) {
            let errMsg = t("search.streamNotExist").replace(
              "[STREAM_NAME]",
              streamNotExist,
            );
            throw new Error(errMsg);
            return;
          }
          // await nextTick();
          if (extractedObj.data.tempFunctionContent != "") {
            emits(
              "on:populate-function-implementation",
              {
                name: "",
                function: extractedObj.data.tempFunctionContent,
              },
              false,
            );
            searchObj.data.tempFunctionContent =
              extractedObj.data.tempFunctionContent;
            searchObj.meta.functionEditorPlaceholderFlag = false;
          } else {
            emits(
              "on:populate-function-implementation",
              {
                name: "",
                function: "",
              },
              false,
            );
            searchObj.data.tempFunctionContent = "";
            searchObj.meta.functionEditorPlaceholderFlag = true;
          }
          emits("on:populate-date-time");
          if (searchObj.meta.refreshInterval != 0) {
            emits("on:refresh-interval-change");
          } else {
            clearInterval(store.state.refreshIntervalID);
          }
          await updatedLocalLogFilterField();
        }
        $q.notify({
          message: `${item.view_name} view applied successfully.`,
          color: "positive",
          position: "bottom",
          timeout: 1000,
        });
        setTimeout(async () => {
          try {
            searchObj.loading = true;
            searchObj.meta.refreshHistogram = true;
            await extractFields();
            await getQueryData();
            store.dispatch("setSavedViewFlag", false);
            updateUrlQueryParams();
            searchObj.shouldIgnoreWatcher = false;
          } catch (e) {
            searchObj.shouldIgnoreWatcher = false;
            console.log(e);
          }
        }, 1000);

        if (
          extractedObj.data.resultGrid.colOrder &&
          extractedObj.data.resultGrid.colOrder.hasOwnProperty(
            searchObj.data.stream.selectedStream,
          )
        ) {
          searchObj.data.stream.selectedFields =
            extractedObj.data.resultGrid.colOrder[
              searchObj.data.stream.selectedStream
            ];
        } else {
          searchObj.data.stream.selectedFields =
            extractedObj.data.stream.selectedFields;
        }

        if (
          extractedObj.data.resultGrid.colSizes &&
          extractedObj.data.resultGrid.colSizes.hasOwnProperty(
            searchObj.data.stream.selectedStream,
          )
        ) {
          searchObj.data.resultGrid.colSizes[
            searchObj.data.stream.selectedStream
          ] =
            extractedObj.data.resultGrid.colSizes[
              searchObj.data.stream.selectedStream
            ];
        }
      } else {
        searchObj.shouldIgnoreWatcher = false;
        store.dispatch("setSavedViewFlag", false);
        $q.notify({
          message:  `Error while applying saved view.`,
          color: "negative",
          position: "bottom",
          timeout: 3000,
        });
      }
    })
    .catch((err) => {
      searchObj.shouldIgnoreWatcher = false;
      store.dispatch("setSavedViewFlag", false);
      $q.notify({
        message: err.message ||  `Error while applying saved view.`,
        color: "negative",
        position: "bottom",
        timeout: 1000,
      });
      console.log(err);
    });
};

const handleDeleteSavedView = (item: any) => {
  savedViewDropdownModel.value = false;
  deleteViewID.value = item.view_id;
  confirmDelete.value = true;
};

const handleUpdateSavedView = (item: any, viewName: any) => {
  savedViewSelectedName.value = item;
  savedViewName.value = viewName;
  confirmUpdate.value = true;
};

const confirmUpdateSavedView = () => {
  updateSavedViews(savedViewSelectedName.value.view_id, savedViewName.value);
};
const confirmDeleteSavedViews = () => {
  deleteSavedViews();
};

const handleFavoriteSavedView = (row: any, flag: boolean) => {
  let localSavedView: any = {};
  let savedViews :any = useLocalSavedView();

  if (savedViews.value != null) {
    localSavedView = savedViews.value;
  }

  Object.keys(localSavedView).forEach((item, key) => {
    if (item == row.view_id) {
      if (flag) {
        delete localSavedView[item];
        useLocalSavedView(localSavedView);
        const index = favoriteViews.value.indexOf(row.view_id);
        if (index > -1) {
          favoriteViews.value.splice(index, 1);
        }

        let favoriteViewsList = localSavedViews.value;
        if (favoriteViewsList.length > 0) {
          favoriteViewsList = favoriteViewsList.filter(
            (item: { view_id: any }) => item.view_id != row.view_id,
          );
          // for (const [key, item] of favoriteViewsList.entries()) {
          //   console.log(item, key);
          //   if (item.view_id == row.view_id) {
          //     delete favoriteViewsList[key];
          //   }
          // }
          console.log(favoriteViewsList);
          localSavedViews.value = favoriteViewsList;
        }
      }
    }
  });

  if (!flag) {
    if (favoriteViews.value.length >= 10) {
      $q.notify({
        message: "You can only save 10 views.",
        color: "info",
        position: "bottom",
        timeout: 2000,
      });
      return;
    }
    localSavedView[row.view_id] = JSON.parse(JSON.stringify(row));
    favoriteViews.value.push(row.view_id);
    localSavedViews.value.push(row);

    useLocalSavedView(localSavedView);
    $q.notify({
      message: "View added to favorites.",
      color: "positive",
      position: "bottom",
      timeout: 2000,
    });
  } else {
    $q.notify({
      message: "View removed from favorites.",
      color: "positive",
      position: "bottom",
      timeout: 2000,
    });
  }
};

const filterSavedView = (rows : any, terms:any) => {
  console.log(rows, terms);
  var filtered = [];
  if (terms != "") {
    terms = terms.toLowerCase();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i]["view_name"].toLowerCase().includes(terms)) {
        filtered.push(rows[i]);
      }
    }
  }
  return filtered;
};

const filterSavedViewFn = (rows: any, terms: any) => {
  var filtered = [];
  if (terms != "") {
    terms = terms.toLowerCase();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i]["view_name"].toLowerCase().includes(terms)) {
        filtered.push(rows[i]);
      }
    }
  }
  return filtered;
};

const showSavedViewConfirmDialog = (callback: () => void) => {
  confirmSavedViewDialogVisible.value = true;
  confirmCallback = callback;
};

const cancelConfirmDialog = () => {
  confirmSavedViewDialogVisible.value = false;
  confirmCallback = null;
};

const confirmDialogOK = () => {
  if (confirmCallback) {
    confirmCallback();
  }
  confirmCallback = null;
};
</script>

<style lang="scss" scoped>
.field-container {

  .oo-field {
    display: flex;
    align-items: baseline;

    .q-field__bottom {
      padding: 5px 1px !important;
    }

    .q-field__inner {
     
      border-radius: 5px !important;
    }


    .q-field--dense .q-field__control,
    .q-field--dense .q-field__marginal {
      height: 33px !important;
    }
  }
}

.btn-cancel:before {

  border: 2px solid rgb(242, 10, 10) !important;
}



</style>
