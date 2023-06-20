<template>
  <q-card class="column full-height no-wrap">
    <div style="background-color: #ffffff; width: 40vw" class="q-px-sm q-py-md">
      <q-card-section class="q-pb-sm q-px-sm q-pt-none">
        <div class="row items-center no-wrap">
          <div class="col">
            <div
              class="text-body1 text-bold text-dark"
              data-test="schema-title-text"
            >
              Add to Dashboard
            </div>
          </div>
          <div class="col-auto">
            <q-btn
              v-close-popup
              round
              flat
              :icon="'img:' + getImageURL('images/common/close_icon.svg')"
            />
          </div>
        </div>
      </q-card-section>
      <q-separator />
      <q-card-section>
        <q-toggle
          v-model="shouldCreateNewDashboard"
          label="Create new dashboard"
          outlined
          dense
        ></q-toggle>
      </q-card-section>
      <q-card-section>
        <q-form ref="addToDashboardForm" @submit="addPanelToDashboard">
          <template v-if="shouldCreateNewDashboard">
            <q-input
              v-model="newDashboardForm.name"
              label="Name"
              color="input-border"
              bg-color="input-bg"
              class="q-py-md showLabelOnTop"
              stack-label
              outlined
              filled
              dense
            ></q-input>
            <q-input
              v-model="newDashboardForm.description"
              label="Description"
              color="input-border"
              bg-color="input-bg"
              class="q-py-md showLabelOnTop"
              stack-label
              outlined
              filled
              dense
            ></q-input>
          </template>
          <template v-else>
            <q-select
              data-test="metrics-add-panel-to-dashboard"
              v-model="selectedDashboard"
              label="Select Dashboard"
              :options="filteredDashboards"
              input-debounce="300"
              behavior="menu"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop no-case"
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
          </template>
          <div class="q-mt-lg text-center">
            <q-btn
              v-close-popup
              data-test="schema-cancel-button"
              class="q-mb-md text-bold no-border"
              :label="t('metrics.cancel')"
              text-color="light-text"
              padding="sm md"
              color="accent"
              no-caps
            />
            <q-btn
              data-test="schema-update-settings-button"
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
import { getAllDashboards } from "@/utils/commons";
import { addPanel } from "@/utils/commons";
import { useQuasar } from "quasar";

export default defineComponent({
  name: "AddToDashboard",
  emits: ["save"],
  setup(props, { emit }) {
    const store = useStore();
    const q = useQuasar();
    const dashboardList: Ref<any[]> = ref([]);
    const filteredDashboards: Ref<any[]> = ref([]);
    const selectedDashboard: Ref<{ id: string | number } | null> = ref(null);
    const shouldCreateNewDashboard = ref(false);
    const newDashboardForm = ref({
      name: "",
      description: "",
    });
    const { t } = useI18n();

    onBeforeMount(() => {
      if (!store.state.allDashboardList?.length) {
        getAllDashboards(store).then(() => {
          updateDashboardOptions();
        });
      } else {
        updateDashboardOptions();
      }
    });

    const updateDashboardOptions = () => {
      dashboardList.value = [];
      filteredDashboards.value = [];
      store.state.allDashboardList.forEach((dashboard: any) => {
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
          panels: [],
        };

        dashboardService
          .create(store.state.selectedOrganization.identifier, baseObj)
          .then((newDashboard) => {
            getAllDashboards(store).then(() => {
              emit("save", newDashboard.data.dashboardId);
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
        emit("save", selectedDashboard.value?.id);
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
    };
  },
});
</script>

<style scoped></style>
