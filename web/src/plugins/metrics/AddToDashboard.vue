<template>
  <ODrawer
    :open="open"
    :width="40"
    :title="t('dashboard.addDashboard')"
    secondary-button-label="Cancel"
    :primary-button-label="t('metrics.add')"
    :primary-button-loading="onSubmit.isLoading.value"
    :primary-button-disabled="!panelTitle.trim()"
    data-test="add-to-dashboard-dialog"
    @update:open="$emit('update:open', $event)"
    @click:secondary="$emit('update:open', false)"
    @click:primary="onSubmit.execute()"
  >
    <q-form ref="addToDashboardForm" @submit.stop="onSubmit.execute" class="add-dashboard-form-card-section tw:flex tw:flex-col tw:gap-4 q-px-md q-py-sm">
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
        class="showLabelOnTop"
        stack-label
        hide-bottom-space
        borderless
        dense
        :rules="[(val: any) => !!val.trim() || 'Panel Title required']"
        :lazy-rules="true"
        data-test="metrics-new-dashboard-panel-title"
      />
    </q-form>
  </ODrawer>
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
import ODrawer from '@/lib/overlay/Drawer/ODrawer.vue';
import { useRouter } from "vue-router";
import { useLoading } from "@/composables/useLoading";
import useNotifications from "@/composables/useNotifications";

export default defineComponent({
  name: "AddToDashboard",
  components: {
    SelectFolderDropdown,
    SelectDashboardDropdown,
    SelectTabDropdown,
    ODrawer,
  },
  props: {
    open: {
      type: Boolean,
      default: false,
    },
    dashboardPanelData: {
      type: Object,
      required: true,
    },
  },
  emits: ["save", "update:open"],
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

    const {
      showErrorNotification,
      showConfictErrorNotificationWithRefreshBtn,
    } = useNotifications();

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
      panelTitle: string,
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
          tabId,
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
      } catch (error: any) {
        if (error?.response?.status === 409) {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ??
              error?.message ??
              "Error while adding panel",
          );
        } else {
          showErrorNotification(error?.message ?? "Error while adding panel");
        }
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
          panelTitle.value,
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
      activeTabId,
      updateSelectedDashboard,
    };
  },
});
</script>

<style lang="scss">
.add-dashboard-form-card-section {
  .add-folder-btn {
    margin-top: 36px !important;
  }
}
</style>
