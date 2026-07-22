<template>
  <ODialog
    :open="open"
    size="md"
    :title="t('dashboard.addDashboard')"
    :secondary-button-label="t('metrics.addToDashboardPage.cancel')"
    :primary-button-label="t('metrics.add')"
    form-id="add-to-dashboard-form"
    data-test="add-to-dashboard-dialog"
    @update:open="$emit('update:open', $event)"
    @click:secondary="$emit('update:open', false)"
  >
    <OForm
      id="add-to-dashboard-form"
      :schema="addToDashboardSchema"
      :default-values="addToDashboardDefaults()"
      @submit="onSubmit"
    >
      <div class="add-dashboard-form-card-section flex flex-col gap-4">
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
        <OFormInput
          name="panelTitle"
          :label="t('dashboard.panelTitle')"
          required
          data-test="metrics-new-dashboard-panel-title"
        />
      </div>
    </OForm>
  </ODialog>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch, type Ref, type PropType } from "vue";
import { useStore } from "vuex";
import { getImageURL } from "@/utils/zincutils";
import { useI18n } from "vue-i18n";
import { getFoldersList, getPanelId } from "@/utils/commons";
import { addPanel } from "@/utils/commons";
import SelectFolderDropdown from "@/components/dashboards/SelectFolderDropdown.vue";
import SelectDashboardDropdown from "@/components/dashboards/SelectDashboardDropdown.vue";
import SelectTabDropdown from "@/components/dashboards/SelectTabDropdown.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { useRouter } from "vue-router";
import useNotifications from "@/composables/useNotifications";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  addToDashboardSchema,
  addToDashboardDefaults,
  type AddToDashboardForm,
} from "./AddToDashboard.schema";

export default defineComponent({
  name: "AddToDashboard",
  components: {
    SelectFolderDropdown,
    SelectDashboardDropdown,
    SelectTabDropdown,
    ODialog,
    OForm,
    OFormInput,
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
    /**
     * Multi-panel mode (metrics "Convert to dashboard"): an array of panel-schema
     * `data` objects to add as SEPARATE panels in one go. When empty (the
     * default), the component keeps its original single-panel behaviour driven by
     * `dashboardPanelData` — so its existing consumers are untouched.
     */
    panels: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
  },
  emits: ["save", "update:open"],
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();

    // Alias to the SAME shared reactive panel-state object the parent passed
    // one-way (:dashboard-panel-data, no v-model). Mutating dashboardPanelData
    // .value.data.* keeps that reference, so in-place writes propagate exactly
    // as before — satisfies vue/no-mutating-props with no behavior change.
    const dashboardPanelData = computed(() => props.dashboardPanelData);
    const filteredDashboards: Ref<any[]> = ref([]);
    const selectedDashboard: any = ref(null);

    const activeFolderId = ref("default");
    const activeTabId: any = ref(null);
    const { t } = useI18n();

    const { showErrorNotification, showConfictErrorNotificationWithRefreshBtn } =
      useNotifications();

    // Fetch folders only when the drawer opens (matches old dialog behaviour where the
    // component mounted only on first open). Avoids an eager API call on page load.
    // On close, reset the non-form dropdown state (folder/dashboard/tab). The
    // form-owned `panelTitle` needs no manual reset — ODialog unmounts the body
    // on close and re-seeds via `:default-values="addToDashboardDefaults()"` on reopen.
    watch(
      () => props.open,
      async (isOpen) => {
        if (isOpen) {
          await getFoldersList(store);
        } else {
          activeFolderId.value = "default";
          selectedDashboard.value = null;
          activeTabId.value = null;
        }
      },
      { immediate: true },
    );

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

      const multi = props.panels && props.panels.length > 0;
      try {
        dismiss = toast({
          message: multi
            ? t("metrics.addToDashboardPage.addingPanels")
            : t("metrics.addToDashboardPage.addingPanel"),
          variant: "loading",
          timeout: 0,
        });

        if (multi) {
          // Convert-to-dashboard: add each metric as its own panel. addPanel
          // auto-positions each one (side-by-side, then wrapping), so N calls
          // lay out an N-panel grid. Each needs a fresh panel id; the title comes
          // from the panel data (per-metric), falling back to the form title.
          for (const panelData of props.panels) {
            panelData.id = getPanelId();
            if (!panelData.title) panelData.title = panelTitle;
            await addPanel(store, dashboardId, panelData, folderId, tabId);
          }
        } else {
          dashboardPanelData.value.data.id = getPanelId();
          // panel name will come from add to dashboard component
          dashboardPanelData.value.data.title = panelTitle;
          // to create panel dashboard id, paneldata and folderId is required
          await addPanel(store, dashboardId, dashboardPanelData.value.data, folderId, tabId);
        }
        toast({
          message: multi
            ? t("metrics.addToDashboardPage.panelsAdded")
            : t("metrics.addToDashboardPage.panelAdded"),
          variant: "success",
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
              t("metrics.addToDashboardPage.errorAddingPanel"),
          );
        } else {
          showErrorNotification(error?.message ?? t("metrics.addToDashboardPage.errorAddingPanel"));
        }
      } finally {
        dismiss();
        emit("save");
      }
    };

    // Plain async fn — OForm awaits it (auto Save spinner + double-submit guard).
    // The validated `value` payload is the source of truth for `panelTitle`;
    // selectedDashboard / activeTabId come from the (non-form) dropdowns.
    const onSubmit = async (value: AddToDashboardForm) => {
      // if selected dashoboard is null
      if (selectedDashboard.value == null) {
        toast({
          message: t("metrics.addToDashboardPage.selectDashboard"),
          variant: "error",
        });
      } else if (activeTabId.value == null) {
        toast({
          message: t("metrics.addToDashboardPage.selectTab"),
          variant: "error",
        });
      } else {
        await addPanelToDashboard(
          selectedDashboard.value,
          activeFolderId.value,
          activeTabId.value,
          value.panelTitle,
        );
      }
    };

    return {
      t,
      getImageURL,
      // Options-API setup(): template only sees what's returned here, so the
      // Zod schema import MUST be exposed or `:schema` resolves to undefined
      // (which silently disables validation).
      addToDashboardSchema,
      addToDashboardDefaults,
      selectedDashboard,
      filteredDashboards,
      onSubmit,
      store,
      SelectFolderDropdown,
      updateActiveFolderId,
      updateActiveTabId,
      activeFolderId,
      activeTabId,
      updateSelectedDashboard,
    };
  },
});
</script>
