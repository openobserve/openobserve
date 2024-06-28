<template>
  <q-card class="column full-height no-wrap">
    <div style="width: 40vw" class="q-px-sm q-py-md">
      <q-card-section class="q-pb-sm q-px-sm q-pt-none">
        <div class="row items-center no-wrap">
          <div class="col">
            <div class="text-body1 text-bold" data-test="schema-title-text">
              {{ t("dashboard.addDashboard") }}
            </div>
          </div>
          <div class="col-auto">
            <q-btn
              v-close-popup="true"
              data-test="metrics-schema-cancel"
              round
              flat
              icon="cancel"
            />
          </div>
        </div>
      </q-card-section>
      <q-separator />
      <q-card-section>
        <q-toggle
          v-model="shouldCreateNewDashboard"
          :label="t('dashboard.newDashboard')"
          outlined
          dense
          data-test="new-dashboard-toggle"
        ></q-toggle>
      </q-card-section>
      <q-card-section>
        <q-form ref="addToDashboardForm" @submit="addPanelToDashboard">
          <template v-if="shouldCreateNewDashboard">
            <!-- select folder or create new folder and select -->
            <select-folder-dropdown @folder-selected="updateActiveFolderId" />
            <q-input
              v-model.trim="newDashboardForm.name"
              :label="t('dashboard.dashboardName') + '*'"
              color="input-border"
              bg-color="input-bg"
              class="q-py-md q-pl-md showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              :rules="[(val) => !!val.trim() || 'Dashboard name required']"
              :lazy-rules="true"
              data-test="metrics-new-dashboard-name"
            ></q-input>
            <span>&nbsp;</span>
            <q-input
              v-model.trim="newDashboardForm.description"
              :label="t('dashboard.dashboardDesc')"
              color="input-border"
              bg-color="input-bg"
              class="q-py-md q-pl-md showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              data-test="metrics-new-dashboard-description"
            ></q-input>
            <q-input
              v-model.trim="panelTitle"
              :label="t('dashboard.panelTitle') + '*'"
              color="input-border"
              bg-color="input-bg"
              class="q-py-md q-pl-md showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              :rules="[(val) => !!val.trim() || 'Panel title required']"
              :lazy-rules="true"
              data-test="metrics-new-dashboard-panel-title"
            />
            <span>&nbsp;</span>
          </template>
          <template v-else>
            <!-- select folder or create new folder and select -->
            <select-folder-dropdown @folder-selected="updateActiveFolderId" />
            <q-select
              data-test="metrics-add-panel-to-dashboard"
              v-model="selectedDashboard"
              :label="t('dashboard.selectDashboard')"
              :options="filteredDashboards"
              input-debounce="300"
              behavior="menu"
              color="input-border"
              bg-color="input-bg"
              class="q-pl-md no-case"
              stack-label
              outlined
              filled
              dense
              borderless
              use-input
              hide-selected
              fill-input
              @filter="filterDashboards"
            >
              <template #no-option>
                <q-item>
                  <q-item-section> {{ t("search.noResult") }}</q-item-section>
                </q-item>
              </template>
            </q-select>
            <q-input
              v-model.trim="panelTitle"
              :label="t('dashboard.panelTitle') + '*'"
              color="input-border"
              bg-color="input-bg"
              class="q-py-md q-pl-md showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              :rules="[(val) => !!val.trim() || 'Panel Title required']"
              :lazy-rules="true"
              data-test="metrics-new-dashboard-panel-title"
            />
            <span>&nbsp;</span>
          </template>
          <div class="q-mt-lg text-center">
            <q-btn
              v-close-popup="true"
              data-test="metrics-schema-cancel-button"
              class="q-mb-md text-bold"
              :label="t('metrics.cancel')"
              text-color="light-text"
              padding="sm md"
              no-caps
            />
            <q-btn
              data-test="metrics-schema-update-settings-button"
              :label="t('metrics.add')"
              class="q-mb-md text-bold no-border q-ml-md"
              color="secondary"
              padding="sm xl"
              type="submit"
              no-caps
            />
          </div>
        </q-form>
      </q-card-section>
    </div>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, onBeforeMount, ref, toRaw, type Ref } from "vue";
import dashboardService from "@/services/dashboards";
import { useStore } from "vuex";
import { getImageURL } from "@/utils/zincutils";
import { useI18n } from "vue-i18n";
import {
  getAllDashboards,
  getAllDashboardsByFolderId,
  getFoldersList,
} from "@/utils/commons";
import { addPanel } from "@/utils/commons";
import { useQuasar } from "quasar";
import type store from "@/test/unit/helpers/store";
import { useRoute } from "vue-router";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import SelectFolderDropdown from "@/components/dashboards/SelectFolderDropdown.vue";

export default defineComponent({
  name: "AddToDashboard",
  components: {
    SelectFolderDropdown,
  },
  emits: ["save"],
  setup(props, { emit }) {
    const store = useStore();
    const route: any = useRoute();
    const q = useQuasar();
    const dashboardList: Ref<any[]> = ref([]);
    const filteredDashboards: Ref<any[]> = ref([]);
    const selectedDashboard: Ref<{ id: string | number } | null> = ref(null);
    const shouldCreateNewDashboard = ref(false);
    const newDashboardForm = ref({
      name: "",
      description: "",
    });
    const activeFolderId = ref("default");
    const { t } = useI18n();
    const panelTitle = ref("");

    onBeforeMount(async () => {
      // if (!store.state.organizationData.allDashboardList[route.query.folder ?? "default"] ||
      //     store.state.organizationData.allDashboardList[route.query.folder ?? "default"].length == 0) {
      // getAllDashboards(store, route.query.folder).then(() => {
      //       updateDashboardOptions();
      //   });
      // } else {
      //   updateDashboardOptions();
      // }

      // get folders list
      await getFoldersList(store);
      // updateDashboardOptions();
    });

    const updateActiveFolderId = (selectedFolder: any) => {
      activeFolderId.value = selectedFolder.value;
      // also, set selecteddashboard to null. because list will be updated
      selectedDashboard.value = null;
      // only update if old dashboard is used
      !shouldCreateNewDashboard.value && updateDashboardOptions();
    };

    const updateDashboardOptions = async () => {
      // get all dashboard list folderId
      await getAllDashboardsByFolderId(store, activeFolderId.value);
      dashboardList.value = [];
      filteredDashboards.value = [];
      store.state.organizationData.allDashboardList[
        activeFolderId.value
      ].forEach((dashboard: any) => {
        dashboardList.value.push({
          id: dashboard.dashboardId,
          label: dashboard.title,
          value: dashboard.title,
        });
      });
      filteredDashboards.value = [...dashboardList.value];
    };

    const filterDashboards = (val: string, update: any) => {
      update(() => {
        filteredDashboards.value = dashboardList.value;
        const needle = val.toLowerCase();
        filteredDashboards.value = filteredDashboards.value.filter(
          (v: any) => v.label.toLowerCase().indexOf(needle) > -1
        );
      });
    };

    const addPanelToDashboard = () => {
      let dismiss = function () {};
      if (shouldCreateNewDashboard.value) {
        dismiss = q.notify({
          message: "Creating a new dashboard",
          type: "ongoing",
          position: "bottom",
        });
        const baseObj = {
          title: newDashboardForm.value.name,
          // NOTE: the dashboard ID is generated at the server side,
          // in "Create a dashboard" request handler. The server
          // doesn't care what value we put here as long as it's
          // a string.
          dashboardId: "",
          description: newDashboardForm.value.description,
          role: "",
          owner: store.state.userInfo.name,
          created: new Date().toISOString(),
          tabs: [
            {
              panels: [],
              name: "Default",
              tabId: "default",
            },
          ],
          version: 3,
        };

        // create dashboard
        dashboardService
          .create(
            store.state.selectedOrganization.identifier,
            baseObj,
            activeFolderId.value
          )
          .then((newDashboard) => {
            // migrate the schema
            const data = convertDashboardSchemaVersion(
              newDashboard.data["v" + newDashboard.data.version]
            );
            // get all dashboards of active folder
            getAllDashboards(store, activeFolderId.value).then(() => {
              emit(
                "save",
                data.dashboardId,
                activeFolderId.value,
                panelTitle.value
              );
            });
          })
          .catch(() =>
            q.notify({
              message: "Error while adding panel",
              type: "negative",
              position: "bottom",
              timeout: 2000,
            })
          )
          .finally(() => {
            dismiss();
          });
      } else {
        // if selected dashoboard is null
        if (selectedDashboard.value == null) {
          q.notify({
            message: "Please select a dashboard",
            type: "negative",
            position: "bottom",
            timeout: 2000,
          });
        } else {
          emit(
            "save",
            selectedDashboard.value?.id,
            activeFolderId.value,
            panelTitle.value
          );
        }
      }
    };
    return {
      t,
      getImageURL,
      dashboardList,
      selectedDashboard,
      filterDashboards,
      filteredDashboards,
      shouldCreateNewDashboard,
      newDashboardForm,
      addPanelToDashboard,
      store,
      SelectFolderDropdown,
      updateActiveFolderId,
      panelTitle,
    };
  },
});
</script>

<style scoped></style>
