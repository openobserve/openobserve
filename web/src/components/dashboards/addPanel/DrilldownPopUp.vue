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
      Action*:
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
          size="20px"
          :name="outlinedDashboard"
          style="cursor: pointer; height: 25px"
        />Go to Dashboard</q-btn
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
          size="20px"
          name="link"
          style="cursor: pointer; height: 25px; display: flex !important"
        />Go to URL</q-btn
      >
    </div>

    <div v-if="drilldownData.type == 'byUrl'">
      <div style="margin-top: 10px; display: flex; flex-direction: column">
        Enter URL:
        <textarea
          style="min-width: 100%; max-width: 100%"
          v-model="drilldownData.data.url"
        ></textarea>
      </div>
    </div>

    <div v-if="drilldownData.type == 'byDashboard'">
      <div style="margin-top: 10px">
        <div class="dropdownDiv">
          <div class="dropdownLabel">Select Folder*:</div>
          <q-select
            v-model="drilldownData.data.folder"
            :options="folderList"
            class="dropdown"
            emit-value
          />
        </div>
        <div class="dropdownDiv" v-if="drilldownData.data.folder">
          <div class="dropdownLabel">Select Dashboard*:</div>
          <q-select
            v-model="drilldownData.data.dashboard"
            :options="dashboardList"
            class="dropdown"
            emit-value
          />
        </div>
        <div class="dropdownDiv" v-if="drilldownData.data.dashboard">
          <div class="dropdownLabel">Select Tab*:</div>
          <q-select
            v-model="drilldownData.data.tab"
            :options="tabList"
            class="dropdown"
            emit-value
          />
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
            <div>Query Params:</div>
            <q-btn
              icon="add"
              color="primary"
              size="sm"
              padding="sm"
              @click="
                () =>
                  drilldownData.data.queryParams.push({ name: '', value: '' })
              "
              >Add Query</q-btn
            >
          </div>
          <div
            v-for="(variable, index) in drilldownData.data.queryParams"
            :key="index"
          >
            <div style="display: flex; gap: 10px; margin-bottom: 10px">
              <q-input v-model="variable.name" placeholder="Name" />
              <q-input v-model="variable.value" placeholder="Value" />
              <q-icon
                class="q-mr-xs"
                size="20px"
                :name="outlinedDelete"
                style="cursor: pointer; height: 35px; display: flex !important"
                @click="() => drilldownData.data.queryParams.splice(index, 1)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- radio button for new tab -->
    <div style="margin-top: 10px">
      <q-toggle
        :label="`New Tab: `"
        left-label
        v-model="drilldownData.targetBlank"
      />
    </div>

    <q-card-actions class="confirmActions">
      <q-btn
        v-close-popup
        unelevated
        no-caps
        class="q-mr-sm"
        @click="$emit('close')"
        data-test="cancel-button"
      >
        {{ t("confirmDialog.cancel") }}
      </q-btn>
      <q-btn
        v-close-popup
        unelevated
        no-caps
        class="no-border"
        color="primary"
        @click="() => {}"
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

export default defineComponent({
  name: "DrilldownPopUp",
  components: {},
  props: {},
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const dashboardList = ref([]);
    const tabList = ref([]);
    const drilldownData: any = ref({
      name: "",
      type: "",
      targetBlank: false,
      data: {
        url: "",
        folder: "",
        dashboard: "",
        tab: "",
        queryParams: [
          {
            label: "",
            value: "",
          },
        ],
      },
    });

    onMounted(async () => {
      if (store.state.organizationData.folders) {
        await getFoldersList(store);
      }
    });

    // on folder change, reset dashboard and tab values
    watch(
      () => drilldownData.value.data.folder,
      (newVal, oldVal) => {
        if (newVal !== oldVal) {
          drilldownData.value.data.dashboard = "";
          drilldownData.value.data.tab = "";
        }
      }
    );

    // on dashboard change, reset tab value
    watch(
      () => drilldownData.value.data.dashboard,
      (newVal, oldVal) => {
        if (newVal !== oldVal) {
          drilldownData.value.data.tab = "";
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
      () => drilldownData.value.data.folder,
      async () => {
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
      }
    );

    watch(
      () => drilldownData.value.data.dashboard,
      async () => {
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
      }
    );

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
          return false;
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

    return {
      t,
      drilldownData,
      outlinedDashboard,
      outlinedDelete,
      store,
      folderList,
      dashboardList,
      tabList,
      isFormValid,
    };
  },
});
</script>

<style lang="scss" scoped>
.dropdownDiv {
  display: flex;
  align-items: center;
  margin: 10px 0px;
}

.dropdownLabel {
  width: 120px;
}

.dropdown {
  min-width: 250px;
}
</style>
