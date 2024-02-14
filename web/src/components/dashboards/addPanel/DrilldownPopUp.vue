<!-- Copyright 2023 Zinc Labs Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<!-- eslint-disable vue/no-unused-components -->
<template>
  <div style="padding: 0px 10px; min-width: 30%" class="scroll o2-input">
    <div
      class="flex justify-between items-center q-pa-md"
      style="border-bottom: 2px solid gray; margin-bottom: 5px"
    >
      <div class="flex items-center q-table__title q-mr-md">
        <span data-test="dashboard-viewpanel-title"> Create Drilldown </span>
      </div>
      <div class="flex q-gutter-sm items-center">
        <q-btn
          no-caps
          @click="$emit('close')"
          padding="xs"
          class="q-ml-md"
          flat
          icon="close"
          data-test="dashboard-viewpanel-close-btn"
        />
      </div>
    </div>
    <q-input
      v-model="drilldownData.name"
      :label="t('dashboard.nameOfVariable') + '*'"
      color="input-border"
      bg-color="input-bg"
      class="q-py-md showLabelOnTop"
      stack-label
      outlined
      filled
      dense
      :rules="[(val) => !!val.trim() || t('dashboard.nameRequired')]"
      :lazy-rules="true"
    />
    <div
      style="display: flex; flex-direction: row; gap: 10px; align-items: center"
    >
      Go to:
      <q-btn-group class="">
        <q-btn
          :class="drilldownData.type == 'byDashboard' ? 'selected' : ''"
          size="sm"
          @click="
            () => {
              drilldownData.type = 'byDashboard';
            }
          "
          ><q-icon
            class="q-mr-xs"
            :name="outlinedDashboard"
            style="cursor: pointer; height: 25px"
          />Dashboard</q-btn
        >
        <q-btn
          :class="drilldownData.type === 'byUrl' ? 'selected' : ''"
          size="sm"
          @click="
            () => {
              drilldownData.type = 'byUrl';
            }
          "
          ><q-icon
            class="q-mr-xs"
            name="link"
            style="cursor: pointer; height: 25px; display: flex !important"
          />URL</q-btn
        >
      </q-btn-group>
    </div>

    <div v-if="drilldownData.type == 'byUrl'">
      <div style="margin-top: 10px; display: flex; flex-direction: column">
        Enter URL:
        <textarea
          style="min-width: 100%; max-width: 100%; resize: vertical"
          v-model="drilldownData.data.url"
          :class="store.state.theme == 'dark' ? 'dark-mode' : 'bg-white'"
        ></textarea>
        <div
          style="color: red; font-size: 12px"
          v-if="!isFormURLValid && drilldownData.data.url.trim()"
        >
          Invalid URL
        </div>
      </div>
    </div>

    <div v-if="drilldownData.type == 'byDashboard'">
      <div style="margin-top: 10px">
        <div class="dropdownDiv">
          <q-select
            v-model="drilldownData.data.folder"
            :options="folderList"
            emit-value
            label="Select Folder*:"
            color="input-border"
            bg-color="input-bg"
            class="q-py-sm showLabelOnTop no-case"
            stack-label
            outlined
            filled
            dense
            style="width: 100%"
          >
            <!-- template when on options -->
            <template v-slot:no-option>
              <q-item>
                <q-item-section class="text-italic text-grey">
                  No folders available
                </q-item-section>
              </q-item>
            </template>
          </q-select>
        </div>
        <div class="dropdownDiv" v-if="drilldownData.data.folder">
          <q-select
            v-model="drilldownData.data.dashboard"
            :options="dashboardList"
            emit-value
            label="Select Dashboard*:"
            color="input-border"
            bg-color="input-bg"
            class="q-py-sm showLabelOnTop no-case"
            stack-label
            outlined
            filled
            dense
            style="width: 100%"
          >
            <!-- template when on options -->
            <template v-slot:no-option>
              <q-item
                data-test="dashboard-drilldown-no-dashboard-available-option"
              >
                <q-item-section class="text-italic text-grey">
                  No dashboards available
                </q-item-section>
              </q-item>
            </template>
          </q-select>
        </div>
        <div class="dropdownDiv" v-if="drilldownData.data.dashboard">
          <q-select
            v-model="drilldownData.data.tab"
            :options="tabList"
            emit-value
            label="Select Tab*:"
            color="input-border"
            bg-color="input-bg"
            class="q-py-sm showLabelOnTop no-case"
            stack-label
            outlined
            filled
            dense
            style="width: 100%"
          >
            <!-- template when on options -->
            <template v-slot:no-option>
              <q-item data-test="dashboard-drilldown-no-tab-available-option">
                <q-item-section class="text-italic text-grey">
                  No tab Available
                </q-item-section>
              </q-item>
            </template>
          </q-select>
        </div>

        <!-- array of variables name and its values -->
        <div style="margin-top: 30px">
          <div
            style="
              display: flex;
              justify-content: space-between;
              margin-bottom: 10px;
              align-items: center;
            "
          >
            <div>Variables:</div>
            <q-btn
              icon="add"
              color="primary"
              size="sm"
              padding="sm"
              @click="
                () =>
                  drilldownData.data.variables.push({
                    name: '',
                    value: '',
                  })
              "
              >Add</q-btn
            >
          </div>
          <div
            v-for="(variable, index) in drilldownData.data.variables"
            :key="index"
          >
            <div style="display: flex; gap: 10px; margin-bottom: 10px">
              <q-input
                v-model="variable.name"
                placeholder="Name"
                stack-label
                outlined
                filled
                dense
              />
              <q-input
                v-model="variable.value"
                placeholder="Value"
                stack-label
                outlined
                filled
                dense
              />
              <q-icon
                class="q-mr-xs"
                size="20px"
                :name="outlinedDelete"
                style="cursor: pointer; height: 35px; display: flex !important"
                @click="() => drilldownData.data.variables.splice(index, 1)"
              />
            </div>
          </div>
        </div>
      </div>
      <!-- radio button for new tab -->
      <div style="margin-top: 10px">
        <q-toggle
          :label="`Pass all current variables: `"
          left-label
          v-model="drilldownData.data.passAllVariables"
        />
      </div>
    </div>

    <!-- radio button for new tab -->
    <div style="margin-top: 10px">
      <q-toggle
        :label="`Open in new tab: `"
        left-label
        v-model="drilldownData.targetBlank"
      />
    </div>

    <q-card-actions class="confirmActions">
      <q-btn
        unelevated
        no-caps
        class="q-mr-sm"
        @click="$emit('close')"
        data-test="cancel-button"
      >
        {{ t("confirmDialog.cancel") }}
      </q-btn>
      <q-btn
        unelevated
        no-caps
        class="no-border"
        color="primary"
        @click="saveDrilldown"
        style="min-width: 60px"
        data-test="confirm-button"
        :disable="isFormValid"
      >
        {{ t("confirmDialog.ok") }}
      </q-btn>
    </q-card-actions>
  </div>
</template>

<script lang="ts">
import { ref } from "vue";
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import {
  outlinedDashboard,
  outlinedDelete,
} from "@quasar/extras/material-icons-outlined";
import { watch } from "vue";
import { useStore } from "vuex";
import { computed } from "vue";
import {
  getAllDashboardsByFolderId,
  getFoldersList,
} from "../../../utils/commons";
import { onMounted } from "vue";
import useDashboardPanelData from "../../../composables/useDashboardPanel";

export default defineComponent({
  name: "DrilldownPopUp",
  components: {},
  props: {
    isEditMode: {
      type: Boolean,
      default: false,
    },
    drilldownDataIndex: {
      type: Number,
      default: -1,
    },
  },
  emits: ["close"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const { dashboardPanelData } = useDashboardPanelData();
    const getDefaultDrilldownData = () => ({
      name: "",
      type: "byDashboard",
      targetBlank: false,
      findBy: "name",
      data: {
        url: "",
        folder: "",
        dashboard: "",
        tab: "",
        passAllVariables: true,
        variables: [
          {
            name: "",
            value: "",
          },
        ],
      },
    });
    const drilldownData = ref(
      props.isEditMode
        ? JSON.parse(
            JSON.stringify(
              dashboardPanelData.data.config.drilldown[props.drilldownDataIndex]
            )
          )
        : getDefaultDrilldownData()
    );
    const dashboardList: any = ref([]);
    const tabList: any = ref([]);

    onMounted(async () => {
      if (
        !store.state.organizationData.folders ||
        (Array.isArray(store.state.organizationData.folders) &&
          store.state.organizationData.folders.length === 0)
      ) {
        await getFoldersList(store);
      }

      await getDashboardList();
      await getTabList();
    });

    // on folder change, reset dashboard and tab values
    watch(
      () => drilldownData.value.data.folder,
      async (newVal, oldVal) => {
        await getDashboardList();
        if (newVal !== oldVal) {
          // take first value from new options list
          drilldownData.value.data.dashboard =
            dashboardList?.value[0]?.value ?? "";
          drilldownData.value.data.tab = tabList?.value[0]?.value ?? "";
        }
      }
    );

    // on dashboard change, reset tab value
    watch(
      () => drilldownData.value.data.dashboard,
      async (newVal, oldVal) => {
        await getTabList();
        if (newVal !== oldVal) {
          // take first value from new options list
          drilldownData.value.data.tab = tabList?.value[0]?.value ?? "";
        }
      }
    );

    const folderList = computed(() => {
      if (!store.state.organizationData.folders) {
        return [];
      }

      return (
        store.state.organizationData.folders?.map((folder: any) => {
          return {
            label: folder.name,
            value: folder.name,
          };
        }) ?? []
      );
    });

    const getDashboardList = async () => {
      // get folder data
      const folderData = store.state.organizationData.folders?.find(
        (folder: any) => folder.name === drilldownData.value.data.folder
      );

      if (!folderData) {
        dashboardList.value = [];
        return;
      }

      // get all dashboards from folder
      const allDashboardList = await getAllDashboardsByFolderId(
        store,
        folderData?.folderId
      );

      // make list of dashboards
      dashboardList.value =
        allDashboardList?.map((dashboard: any) => {
          return {
            label: dashboard.title,
            value: dashboard.title,
          };
        }) ?? [];
    };

    const getTabList = async () => {
      // get folder data
      const folderData = store.state.organizationData.folders?.find(
        (folder: any) => folder.name === drilldownData.value.data.folder
      );

      if (!folderData) {
        dashboardList.value = [];
        return;
      }

      const allDashboardList = await getAllDashboardsByFolderId(
        store,
        folderData?.folderId
      );

      // get dashboard data
      const dashboardData = allDashboardList?.find(
        (dashboard: any) =>
          dashboard.title === drilldownData.value.data.dashboard
      );

      if (!dashboardData) {
        dashboardList.value = [];
        return;
      }

      // make list of tabs
      tabList.value =
        dashboardData?.tabs?.map((tab: any) => {
          return {
            label: tab.name,
            value: tab.name,
          };
        }) ?? [];
    };

    const isFormURLValid = computed(() => {
      const urlRegex = /^(http|https|ftp|file|mailto|telnet|data|ws|wss):\/\//;
      return urlRegex.test(drilldownData.value.data.url.trim());
    });

    const isFormValid = computed(() => {
      // if name is empty
      if (!drilldownData.value.name.trim()) {
        return true;
      }

      // if action is not selected
      if (!drilldownData.value.type) {
        return true;
      }

      // if action is by url
      if (drilldownData.value.type == "byUrl") {
        if (drilldownData.value.data.url.trim()) {
          // check if url is valid with protocol
          return !isFormURLValid.value;
        }
      } else {
        if (
          drilldownData.value.data.folder &&
          drilldownData.value.data.dashboard &&
          drilldownData.value.data.tab
        ) {
          return false;
        }
      }
      return true;
    });

    const saveDrilldown = () => {
      // if editmode then made changes
      // else add new drilldown
      if (props.isEditMode) {
        dashboardPanelData.data.config.drilldown[props.drilldownDataIndex] =
          drilldownData.value;
      } else {
        dashboardPanelData.data.config.drilldown.push(drilldownData.value);
      }
      emit("close");
    };

    return {
      t,
      outlinedDashboard,
      dashboardPanelData,
      drilldownData,
      outlinedDelete,
      store,
      folderList,
      dashboardList,
      tabList,
      isFormValid,
      saveDrilldown,
      isFormURLValid,
    };
  },
});
</script>

<style lang="scss" scoped>
.dropdownDiv {
  display: flex;
  align-items: center;
  margin: 10px 0px;
  width: 100%;
}

.dropdownLabel {
  width: 150px;
}

.dropdown {
  min-width: 100%;
}

:deep(.no-case .q-field__native > :first-child) {
  text-transform: none !important;
}
</style>
