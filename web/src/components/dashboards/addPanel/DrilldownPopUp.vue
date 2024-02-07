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
    </div>

    <div v-if="drilldownData.type == 'byUrl'">
      <div style="margin-top: 10px; display: flex; flex-direction: column">
        Enter URL:
        <textarea
          style="min-width: 100%; max-width: 100%; resize: vertical"
          v-model="drilldownData.data.url"
          :class="store.state.theme == 'dark' ? 'dark-mode' : 'bg-white'"
        ></textarea>
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
            class="q-py-sm showLabelOnTop"
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
            </template></q-select
          >
        </div>
        <div class="dropdownDiv" v-if="drilldownData.data.folder">
          <q-select
            v-model="drilldownData.data.dashboard"
            :options="dashboardList"
            emit-value
            label="Select Dashboard*:"
            color="input-border"
            bg-color="input-bg"
            class="q-py-sm showLabelOnTop"
            stack-label
            outlined
            filled
            dense
            style="width: 100%"
          >
            <!-- template when on options -->
            <template v-slot:no-option>
              <q-item data-test="dashboard-tab-move-select-no-option">
                <q-item-section class="text-italic text-grey">
                  No dashboards available
                </q-item-section>
              </q-item>
            </template></q-select
          >
        </div>
        <div class="dropdownDiv" v-if="drilldownData.data.dashboard">
          <q-select
            v-model="drilldownData.data.tab"
            :options="tabList"
            emit-value
            label="Select Tab*:"
            color="input-border"
            bg-color="input-bg"
            class="q-py-sm showLabelOnTop"
            stack-label
            outlined
            filled
            dense
            style="width: 100%"
          >
            <!-- template when on options -->
            <template v-slot:no-option>
              <q-item data-test="dashboard-tab-move-select-no-option">
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
        v-close-popup="true"
        unelevated
        no-caps
        class="q-mr-sm"
        @click="$emit('close')"
        data-test="cancel-button"
      >
        {{ t("confirmDialog.cancel") }}
      </q-btn>
      <q-btn
        v-close-popup="true"
        unelevated
        no-caps
        class="no-border"
        color="primary"
        @click="saveDrilldown.execute()"
        :loading="saveDrilldown.isLoading.value"
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
import { useLoading } from "@/composables/useLoading";

export default defineComponent({
  name: "DrilldownPopUp",
  components: {},
  props: {
    drilldownData: {
      type: Object,
      required: true,
    },
  },
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const dashboardList = ref([]);
    const tabList = ref([]);

    onMounted(async () => {
      if (store.state.organizationData.folders) {
        await getFoldersList(store);
      }
    });

    // on folder change, reset dashboard and tab values
    watch(
      () => props.drilldownData.data.folder,
      (newVal, oldVal) => {
        if (newVal !== oldVal) {
          props.drilldownData.data.dashboard = "";
          props.drilldownData.data.tab = "";
        }
      }
    );

    // on dashboard change, reset tab value
    watch(
      () => props.drilldownData.data.dashboard,
      (newVal, oldVal) => {
        if (newVal !== oldVal) {
          props.drilldownData.data.tab = "";
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

    watch(
      () => props.drilldownData.data.folder,
      async () => {
        // get folder data
        const folderData = store.state.organizationData.folders?.find(
          (folder: any) => folder.name === props.drilldownData.data.folder
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
      }
    );

    watch(
      () => props.drilldownData.data.dashboard,
      async () => {
        // get folder data
        const folderData = store.state.organizationData.folders?.find(
          (folder: any) => folder.name === props.drilldownData.data.folder
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
            dashboard.title === props.drilldownData.data.dashboard
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
      }
    );

    const isFormValid = computed(() => {
      // if name is empty
      if (!props.drilldownData.name.trim()) {
        return true;
      }

      // if action is not selected
      if (!props.drilldownData.type) {
        return true;
      }

      // if action is by url
      if (props.drilldownData.type == "byUrl") {
        if (props.drilldownData.data.url.trim()) {
          return false;
        }
      } else {
        if (
          props.drilldownData.data.folder &&
          props.drilldownData.data.dashboard &&
          props.drilldownData.data.tab
        ) {
          return false;
        }
      }
      return true;
    });

    const saveDrilldown = useLoading(async () => {
      emit("save", props.drilldownData);
    });

    return {
      t,
      outlinedDashboard,
      outlinedDelete,
      store,
      folderList,
      dashboardList,
      tabList,
      isFormValid,
      saveDrilldown,
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
</style>
