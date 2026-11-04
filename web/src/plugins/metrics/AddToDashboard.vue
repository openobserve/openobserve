<template>
  <ODialog
    :open="open && !dashboardsLocked"
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
      :schema="isMulti ? multiPanelSchema : addToDashboardSchema"
      :default-values="addToDashboardDefaults(defaultPanelTitle)"
      @submit="onSubmit"
    >
      <div class="add-dashboard-form-card-section flex flex-col gap-4">
        <OBanner
          v-if="notice"
          variant="info"
          dense
          :content="notice"
          data-test="add-to-dashboard-notice"
        />
        <!-- select folder or create new folder and select -->
        <SelectFolderDropdown
          :active-folder-id="rememberedTarget?.folderId ?? null"
          @folder-selected="updateActiveFolderId"
        />

        <!-- select folder or create new folder and select -->
        <SelectDashboardDropdown
          v-if="activeFolderId"
          :folder-id="activeFolderId"
          :preferred-dashboard-id="rememberedTarget?.dashboardId"
          @dashboard-selected="updateSelectedDashboard"
        />

        <!-- select tab or create new tab and select -->
        <SelectTabDropdown
          v-if="activeFolderId && selectedDashboard"
          :folder-id="activeFolderId"
          :dashboard-id="selectedDashboard"
          :preferred-tab-id="
            rememberedTarget?.dashboardId === selectedDashboard
              ? rememberedTarget?.tabId
              : undefined
          "
          @tab-selected="updateActiveTabId"
        />
        <div v-if="isMulti" class="flex flex-col gap-1" data-test="add-to-dashboard-panel-titles">
          <span class="text-compact text-input-label-text leading-tight font-medium">
            {{ t("metrics.addToDashboardPage.panelsToAdd") }}
          </span>
          <ul class="text-text-body flex flex-col gap-0.5 text-sm">
            <li
              v-for="(panel, index) in panels"
              :key="index"
              data-test="add-to-dashboard-panel-title"
            >
              <OTruncatedText>{{ panel.title }}</OTruncatedText>
            </li>
          </ul>
        </div>
        <OFormInput
          v-else
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
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { getFoldersList, getPanelId, addPanel } from "@/utils/commons";
import SelectFolderDropdown from "@/components/dashboards/SelectFolderDropdown.vue";
import SelectDashboardDropdown from "@/components/dashboards/SelectDashboardDropdown.vue";
import SelectTabDropdown from "@/components/dashboards/SelectTabDropdown.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { z } from "zod";
import { useRouter } from "vue-router";
import useNotifications from "@/composables/useNotifications";
import { toast } from "@/lib/feedback/Toast/useToast";
import analytics from "@/services/product_analytics";
import { useLicenseLock } from "@/composables/useFeatureLock";
import {
  makeAddToDashboardSchema,
  addToDashboardDefaults,
  type AddToDashboardForm,
} from "./AddToDashboard.schema";

interface DashboardTarget {
  folderId: string;
  dashboardId: string;
  tabId: string;
}

export default defineComponent({
  name: "AddToDashboard",
  components: {
    SelectFolderDropdown,
    SelectDashboardDropdown,
    SelectTabDropdown,
    ODialog,
    OForm,
    OFormInput,
    OBanner,
    OTruncatedText,
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
    /** A note shown above the form, such as what a copied panel keeps. */
    notice: {
      type: String as unknown as PropType<I18nText>,
      default: undefined,
    },
    /** A caller that already knows what the panel shows names it, so the user need not. */
    defaultPanelTitle: {
      type: String,
      default: "",
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
    const { t } = useI18nTyped();
    const { locked: dashboardsLocked } = useLicenseLock("dashboards");
    const addToDashboardSchema = makeAddToDashboardSchema(t);
    // Each panel brings its own title, so the hidden title field must not block submit.
    const multiPanelSchema = z.object({ panelTitle: z.string() });
    const isMulti = computed(() => props.panels.length > 0);

    const rememberedTargetKey = () =>
      `addToDashboard.lastTarget.${store.state.selectedOrganization?.identifier ?? ""}.${
        store.state.userInfo?.email ?? ""
      }`;
    const rememberedTarget = ref<DashboardTarget | null>(null);

    const readRememberedTarget = (): DashboardTarget | null => {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(rememberedTargetKey()) ?? "null");
        return parsed && typeof parsed.folderId === "string" ? parsed : null;
      } catch {
        return null;
      }
    };

    const writeRememberedTarget = (target: DashboardTarget) => {
      try {
        window.localStorage.setItem(rememberedTargetKey(), JSON.stringify(target));
      } catch {
        // A full or blocked localStorage only loses the preselection next time.
      }
    };

    // Panel indexes already written to savedTarget, so a retry adds only the rest.
    const savedPanelIndexes = new Set<number>();
    let savedTarget = "";

    const { showErrorNotification, showConfictErrorNotificationWithRefreshBtn } =
      useNotifications();

    // Fetch folders only when the drawer opens (matches old dialog behaviour where the
    // component mounted only on first open). Avoids an eager API call on page load.
    // On close, reset the non-form dropdown state (folder/dashboard/tab). The
    // form-owned `panelTitle` needs no manual reset — ODialog unmounts the body
    // on close and re-seeds via `:default-values` on reopen.
    watch(
      () => props.open,
      async (isOpen) => {
        if (isOpen && !dashboardsLocked.value) {
          rememberedTarget.value = readRememberedTarget();
          await getFoldersList(store);
          const folderId = rememberedTarget.value?.folderId;
          if (store.state.organizationData.folders.some((f: any) => f.folderId === folderId)) {
            activeFolderId.value = folderId as string;
          }
        } else {
          activeFolderId.value = "default";
          selectedDashboard.value = null;
          activeTabId.value = null;
          savedPanelIndexes.clear();
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

      const multi = isMulti.value;
      const target = `${dashboardId}/${tabId}`;
      if (target !== savedTarget) {
        savedPanelIndexes.clear();
        savedTarget = target;
      }
      // Counted per write: a later panel failing does not undo the ones already saved.
      let written = 0;
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
          for (const [index, panelData] of props.panels.entries()) {
            if (savedPanelIndexes.has(index)) continue;
            panelData.id = getPanelId();
            if (!panelData.title) panelData.title = panelTitle;
            await addPanel(store, dashboardId, panelData, folderId, tabId);
            savedPanelIndexes.add(index);
            written++;
          }
          // The page is kept alive, so a later Add from the same dialog must write every panel.
          savedPanelIndexes.clear();
        } else {
          dashboardPanelData.value.data.id = getPanelId();
          // panel name will come from add to dashboard component
          dashboardPanelData.value.data.title = panelTitle;
          // to create panel dashboard id, paneldata and folderId is required
          await addPanel(store, dashboardId, dashboardPanelData.value.data, folderId, tabId);
          written++;
        }
        writeRememberedTarget({ folderId, dashboardId, tabId });
        toast({
          message: multi
            ? t("metrics.addToDashboardPage.panelsAdded")
            : t("metrics.addToDashboardPage.panelAdded"),
          variant: "success",
        });
        // A kept-alive caller page would show the dialog still open on return.
        emit("update:open", false);
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
            t,
          );
        } else {
          showErrorNotification(error?.message ?? t("metrics.addToDashboardPage.errorAddingPanel"));
        }
      } finally {
        if (written > 0) analytics.track("panel_added_to_dashboard", { panel_count: written });
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
      // built schema MUST be exposed or `:schema` resolves to undefined
      // (which silently disables validation).
      addToDashboardSchema,
      multiPanelSchema,
      isMulti,
      rememberedTarget,
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
      dashboardsLocked,
    };
  },
});
</script>
