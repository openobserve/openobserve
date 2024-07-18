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
        <q-form ref="addToDashboardForm" @submit="onSubmit.execute">
          <!-- select folder or create new folder and select -->
          <select-folder-dropdown @folder-selected="updateActiveFolderId" />

          <!-- select folder or create new folder and select -->
          <select-dashboard-dropdown
            v-if="activeFolderId"
            :folder-id="activeFolderId"
            @dashboard-selected="updateSelectedDashboard"
          />

          <!-- select tab or create new tab and select -->
          <select-tab-dropdown
            v-if="activeFolderId && selectedDashboard"
            :folder-id="activeFolderId"
            :dashboard-id="selectedDashboard"
            @tab-selected="updateActiveTabId"
          />
          <q-input
            v-model.trim="panelTitle"
            :label="t('dashboard.panelTitle') + '*'"
            color="input-border"
            bg-color="input-bg"
            class="q-mb-xs showLabelOnTop"
            stack-label
            outlined
            filled
            dense
            :rules="[(val) => !!val.trim() || 'Panel Title required']"
            :lazy-rules="true"
            data-test="metrics-new-dashboard-panel-title"
          />
          <span>&nbsp;</span>
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
              :loading="onSubmit.isLoading.value"
            />
          </div>
        </q-form>
      </q-card-section>
    </div>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, onBeforeMount, ref, toRaw, type Ref } from "vue";
import { useStore } from "vuex";
import { getImageURL } from "@/utils/zincutils";
import { useI18n } from "vue-i18n";
import { getFoldersList, getPanelId } from "@/utils/commons";
import { addPanel } from "@/utils/commons";
import { useQuasar } from "quasar";
import SelectFolderDropdown from "@/components/dashboards/SelectFolderDropdown.vue";
import SelectDashboardDropdown from "@/components/dashboards/SelectDashboardDropdown.vue";
import SelectTabDropdown from "@/components/dashboards/SelectTabDropdown.vue";
import { useRouter } from "vue-router";
import { useLoading } from "@/composables/useLoading";

export default defineComponent({
  name: "AddToDashboard",
  components: {
    SelectFolderDropdown,
    SelectDashboardDropdown,
    SelectTabDropdown,
  },
  props: {
    dashboardPanelData: {
      type: Object,
      required: true,
    },
  },
  emits: ["save"],
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();
    const q = useQuasar();
    const filteredDashboards: Ref<any[]> = ref([]);
    const selectedDashboard: any = ref(null);

    const activeFolderId = ref("default");
    const activeTabId: any = ref(null);
    const { t } = useI18n();
    const panelTitle = ref("");

    onBeforeMount(async () => {
      // get folders list
      await getFoldersList(store);
      // updateDashboardOptions();
    });

    const updateActiveFolderId = (selectedFolder: any) => {
      activeFolderId.value = selectedFolder.value;
    };

    const updateSelectedDashboard = (newSelectedDashboard: any) => {
      selectedDashboard.value = newSelectedDashboard?.value ?? null;
    };

    const updateActiveTabId = (selectedTab: any) => {
      activeTabId.value = selectedTab?.value ?? null;
    };

    const addPanelToDashboard = async (
      dashboardId: string,
      folderId: string,
      tabId: string,
      panelTitle: string
    ) => {
      let dismiss = function () {};

      try {
        dismiss = q.notify({
          message: "Please wait while we add the panel to the dashboard",
          type: "ongoing",
          position: "bottom",
        });
        props.dashboardPanelData.data.id = getPanelId();
        // panel name will come from add to dashboard component
        props.dashboardPanelData.data.title = panelTitle;
        // to create panel dashboard id, paneldata and folderId is required
        await addPanel(
          store,
          dashboardId,
          props.dashboardPanelData.data,
          folderId,
          tabId
        );
        q.notify({
          message: "Panel added to dashboard",
          type: "positive",
          position: "bottom",
          timeout: 3000,
        });
        router.push({
          name: "viewDashboard",
          query: { dashboard: dashboardId, folder: folderId, tab: tabId },
        });
      } catch (err: any) {
        q.notify({
          message: "Error while adding panel",
          type: "negative",
          position: "bottom",
          timeout: 2000,
        });
      } finally {
        dismiss();
        emit("save");
      }
    };

    const onSubmit = useLoading(async () => {
      // if selected dashoboard is null
      if (selectedDashboard.value == null) {
        q.notify({
          message: "Please select a dashboard",
          type: "negative",
          position: "bottom",
          timeout: 2000,
        });
      } else if (activeTabId.value == null) {
        q.notify({
          message: "Please select a tab",
          type: "negative",
          position: "bottom",
          timeout: 2000,
        });
      } else {
        await addPanelToDashboard(
          selectedDashboard.value,
          activeFolderId.value,
          activeTabId.value,
          panelTitle.value
        );
      }
    });

    return {
      t,
      getImageURL,
      selectedDashboard,
      filteredDashboards,
      onSubmit,
      store,
      SelectFolderDropdown,
      updateActiveFolderId,
      panelTitle,
      updateActiveTabId,
      activeFolderId,
      updateSelectedDashboard,
    };
  },
});
</script>

<style scoped></style>
