<!-- Copyright 2026 OpenObserve Inc.

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
  <ODialog
    :open="open"
    :title="isEditMode ? t('dashboard.editDrilldown') : t('dashboard.createDrilldown')"
    :primary-button-label="isEditMode ? t('dashboard.update') : t('common.add')"
    :secondary-button-label="t('confirmDialog.cancel')"
    size="md"
    form-id="drilldown-popup-form"
    data-test="dashboard-drilldown-popup"
    @update:open="(v) => { if (!v) $emit('close') }"
    @click:secondary="$emit('close')"
  >
    <template #header-right>
      <DrilldownUserGuide />
    </template>
    <OForm id="drilldown-popup-form" :form="form">
    <OFormInput
      name="name"
      :label="t('dashboard.nameOfVariable')"
      required
      data-test="dashboard-config-panel-drilldown-name"
    />
    <div style="margin-top: 0.75rem">
      <OFormToggleGroup name="type" :label="t('dashboard.goTo')">
        <OToggleGroupItem
          value="byDashboard"
          size="sm"
          icon-left="dashboard"
          data-test="dashboard-drilldown-by-dashboard-btn"
        >
          {{ t("menu.dashboard") }}
        </OToggleGroupItem>
        <OToggleGroupItem
          value="byUrl"
          size="sm"
          icon-left="link"
          data-test="dashboard-drilldown-by-url-btn"
        >
          {{ t("common.url") }}
        </OToggleGroupItem>
        <OToggleGroupItem
          value="logs"
          size="sm"
          icon-left="search"
          data-test="dashboard-drilldown-by-logs-btn"
        >
          {{ t("common.logs") }}
        </OToggleGroupItem>
      </OFormToggleGroup>
    </div>

    <div v-if="drilldownData.type === 'logs'" style="margin-top: 10px">
      <div>
        <OFormToggleGroup
          name="data.logsMode"
          :label="t('dashboard.selectLogsMode')"
        >
          <OToggleGroupItem value="auto" size="sm">{{ t("common.auto") }}</OToggleGroupItem>
          <OToggleGroupItem value="custom" size="sm">{{ t("common.custom") }}</OToggleGroupItem>
        </OFormToggleGroup>
      </div>
      <component
        :is="form.Field"
        name="data.logsQuery"
        v-if="drilldownData.data.logsMode === 'custom'"
      >
        <template #default="{ field }">
          <div style="margin-top: 10px">
            <label class="o-input-label text-sm font-semibold leading-tight">{{ t("dashboard.enterCustomQuery") }}</label>
            <query-editor
              data-test="scheduled-alert-sql-editor"
              ref="queryEditorRef"
              editor-id="alerts-query-editor"
              style="height: 80px"
              :debounceTime="300"
              :query="drilldownData.data.logsQuery"
              @update:query="updateQueryValue"
            />
            <span
              v-if="field.state.meta.errors.length > 0"
              class="text-xs text-input-error-text leading-none mt-1 block"
              role="alert"
              data-test="dashboard-drilldown-logs-query-error"
            >
              {{ firstFieldError(field.state.meta.errors) }}
            </span>
          </div>
        </template>
      </component>
    </div>
    <div v-if="drilldownData.type == 'byUrl'">
      <div style="margin-top: 10px; display: flex; flex-direction: column">
        <OFormTextarea
          name="data.url"
          :label="t('dashboard.enterUrl')"
          required
          data-test="dashboard-drilldown-url-textarea"
        />
      </div>
    </div>

    <div v-if="drilldownData.type == 'byDashboard'">
      <div style="margin-top: 10px">
        <div class="flex items-center my-[10px] w-full">
          <OFormSelect
            name="data.folder"
            :options="folderList"
            :label="t('dashboard.selectFolderDrilldown')"
            required
            class="w-full"
            :disabled="getFoldersListLoading.isLoading.value"
            data-test="dashboard-drilldown-folder-select"
          />
        </div>
        <div class="flex items-center my-[10px] w-full" v-if="drilldownData.data.folder">
          <OFormSelect
            name="data.dashboard"
            :options="dashboardList"
            :label="t('dashboard.selectDashboardDrilldown')"
            required
            class="w-full"
            :disabled="getDashboardListLoading.isLoading.value"
            data-test="dashboard-drilldown-dashboard-select"
          />
        </div>
        <div class="flex items-center my-[10px] w-full" v-if="drilldownData.data.dashboard">
          <OFormSelect
            name="data.tab"
            :options="tabList"
            :label="t('dashboard.selectTabDrilldown')"
            required
            class="w-full"
            :disabled="getTabListLoading.isLoading.value"
            data-test="dashboard-drilldown-tab-select"
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
            <span class="o-input-label text-sm font-semibold leading-tight">{{ t("dashboard.variables") }}</span>
            <OButton
              variant="primary"
              size="sm"
              @click="addVariableRow"
              data-test="dashboard-drilldown-add-variable"
              icon-left="add"
            >
              {{ t("common.add") }}
            </OButton>
          </div>
          <div
            v-for="(variable, index) in drilldownData.data.variables"
            :key="index"
          >
            <div
              style="display: flex; gap: 0.625rem; margin-bottom: 0.625rem; align-items: center"
              :key="JSON.stringify(variableNamesFn ?? {})"
            >
              <OFormCombobox
                :name="`data.variables[${index}].name`"
                :placeholder="t('dashboard.name')"
                search-regex="(.*)"
                :items="variableNamesFn"
              />
              <OFormCombobox
                :name="`data.variables[${index}].value`"
                :placeholder="t('panel.value')"
                search-regex="(.*)"
                :items="options.selectedValue"
              />

              <OIcon
                size="sm"
                name="close"
                style="cursor: pointer; flex-shrink: 0"
                @click="() => removeVariableRow(index)"
                :data-test="`dashboard-drilldown-variable-remove-${index}`"
              />
            </div>
          </div>
        </div>
      </div>
      <!-- radio button for new tab -->
      <div style="margin-top: 10px">
        <OFormSwitch
          name="data.passAllVariables"
          :label="t('dashboard.passAllCurrentVariables')"
          labelPosition="left"
          data-test="dashboard-drilldown-pass-all-variables"
          size="lg"
        />
      </div>
    </div>

    <!-- radio button for new tab -->
    <div style="margin-top: 10px">
      <OFormSwitch
        name="targetBlank"
        :label="t('dashboard.openInNewTab')"
        labelPosition="left"
        data-test="dashboard-drilldown-open-in-new-tab"
        size="lg"
      />
    </div>
    </OForm>

  </ODialog>
</template>

<script lang="ts">
import { defineAsyncComponent, inject, nextTick, reactive, ref } from "vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import { watch } from "vue";
import { useStore } from "vuex";
import { useRoute } from "vue-router";
import { computed } from "vue";
import {
  getAllDashboardsByFolderId,
  getDashboard,
  getFoldersList,
} from "../../../utils/commons";
import { onMounted, onUnmounted } from "vue";
import useDashboardPanelData from "../../../composables/dashboard/useDashboardPanel";
import DrilldownUserGuide from "@/components/dashboards/addPanel/DrilldownUserGuide.vue";
import OFormCombobox from "@/lib/forms/Combobox/OFormCombobox.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import { useLoading } from "@/composables/useLoading";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import {
  makeDrilldownPopUpSchema,
  type DrilldownPopUpForm,
} from "./DrilldownPopUp.schema";
const QueryEditor = defineAsyncComponent(
  () => import("@/components/CodeQueryEditor.vue"),
);

export default defineComponent({
  name: "DrilldownPopUp",
  components: {
    ODialog,
    OForm,
    OFormInput,
    OFormTextarea,
    OFormSelect,
    OFormSwitch,
    OFormToggleGroup,
    OToggleGroupItem,
    DrilldownUserGuide,
    OFormCombobox,
    QueryEditor,
    OButton,
    OIcon,
  },
  props: {
    open: {
      type: Boolean,
      default: false,
    },
    isEditMode: {
      type: Boolean,
      default: false,
    },
    drilldownDataIndex: {
      type: Number,
      default: -1,
    },
    variablesData: {
      type: Object,
      default: () => {
        return {};
      },
    },
  },
  emits: ["close"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const route = useRoute();
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

    // Inject variablesManager to access all dashboard variables
    const variablesManager = inject<any>("variablesManager", null);

    // Get current dashboard data to access tabs
    const currentDashboardData = inject<any>("currentDashboardData", null);

    const getDefaultDrilldownData = () => ({
      name: "",
      type: "byDashboard",
      targetBlank: false,
      findBy: "name",
      data: {
        logsMode: "auto",
        logsQuery: "",
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

    // Source of the form's seed values: the record in edit mode, blank defaults
    // otherwise. Used both for the working mirror (drilldownData) and the OForm
    // `:default-values`, so they always start in sync.
    const getRecordData = () =>
      props?.isEditMode
        ? JSON.parse(
            JSON.stringify(
              dashboardPanelData.data.config.drilldown[
                props?.drilldownDataIndex
              ],
            ),
          )
        : getDefaultDrilldownData();

    // ── OForm wiring (rule ②/③: form is the SOLE source, no mirror) ───────────
    // Every scalar control is `name=`-only (no v-model). `data.variables[]` is a
    // FORM-OWNED field-array (indexed OFormCombobox names). `type`/`logsMode` are
    // OFormToggleGroup (name=-owned); only `logsQuery` (Monaco) is a non-OForm*
    // widget bridged into the schema via setFieldValue. This component OWNS
    // <OForm>, so it creates the form with useOForm and reads it reactively via
    // form.useStore to drive the v-if (type/logsMode/folder/dashboard), the
    // cascades, and the async loaders — ONE source of truth, no mirror (rule ③).
    const drilldownPopUpSchema = makeDrilldownPopUpSchema(t);
    const form = useOForm<DrilldownPopUpForm>({
      defaultValues: getRecordData(),
      schema: drilldownPopUpSchema,
      // forward to the onSubmit defined below (avoids a TDZ ref at setup time)
      onSubmit: (value) => onSubmit(value),
    });

    // Bridge the Monaco logsQuery + cascade resets + array-row mutations into the
    // single form.
    const setFormField = (name: string, val: unknown) => {
      form.setFieldValue(name, val);
    };
    const addVariableRow = () =>
      form.pushFieldValue("data.variables", { name: "", value: "" });
    const removeVariableRow = (index: number) =>
      form.removeFieldValue("data.variables", index);

    // Reactive READ of the form values (rule ③: form.useStore, NOT a local copy)
    // — drives the v-if (type/logsMode/folder/dashboard), the cascades, and the
    // async loaders.
    const drilldownData = form.useStore((s: any) => s.values);
    const dashboardList: any = ref([]);
    const tabList: any = ref([]);

    const getFoldersListLoading = useLoading(async () => {
      await getFoldersList(store);
    });

    const getDashboardListLoading = useLoading(async () => {
      await getDashboardList();
    });

    const getTabListLoading = useLoading(async () => {
      await getTabList();
    });

    onMounted(async () => {
      // if no folders in organization, get folders
      if (
        !store.state.organizationData.folders ||
        (Array.isArray(store.state.organizationData.folders) &&
          store.state.organizationData.folders.length === 0)
      ) {
        // get folders(will be api call)
        await getFoldersListLoading.execute();
      }

      // get dashboard list
      // get tab list
      await getDashboardListLoading.execute();
      await getTabListLoading.execute();

      // get variables list
      await getvariableNames();
    });

    // on folder change, reset dashboard and tab values (cross-field setFieldValue)
    watch(
      () => drilldownData.value?.data?.folder,
      async (newVal, oldVal) => {
        await getDashboardListLoading.execute();
        if (newVal !== oldVal) {
          // take first value from new options list
          setFormField("data.dashboard", dashboardList?.value[0]?.value ?? "");
          setFormField("data.tab", tabList?.value[0]?.value ?? "");
        }
      },
    );

    // on dashboard change, reset tab value (cross-field setFieldValue)
    watch(
      () => drilldownData.value?.data?.dashboard,
      async (newVal, oldVal) => {
        await getTabListLoading.execute();
        if (newVal !== oldVal) {
          // take first value from new options list
          setFormField("data.tab", tabList?.value[0]?.value ?? "");
        }
      },
    );

    const folderList = computed(() => {
      // if no folders in organization, return []
      if (!store.state.organizationData.folders) {
        return [];
      }
      // make list of options from folders list
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
      // by using folder name, find folder data
      const folderData = store.state.organizationData.folders?.find(
        (folder: any) => folder.name === drilldownData.value.data.folder,
      );

      // if no folder with same forder name found, return
      if (!folderData) {
        dashboardList.value = [];
        return;
      }

      // get all dashboards from folder
      const allDashboardList = await getAllDashboardsByFolderId(
        store,
        folderData?.folderId,
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
      // by using folder name, find folder data
      const folderData = store.state.organizationData.folders?.find(
        (folder: any) => folder.name === drilldownData.value.data.folder,
      );

      // if no folder with same forder name found, return
      if (!folderData) {
        dashboardList.value = [];
        return;
      }
      // want dashboardId from dashboard name
      // by using dashboard name, find dashboard data
      // get all dashboards from folder
      const allDashboardList = await getAllDashboardsByFolderId(
        store,
        folderData?.folderId,
      );

      // get dashboardId from allDashboardList by dashboard name
      const dashboardId = allDashboardList?.find(
        (dashboard: any) =>
          dashboard.title === drilldownData.value.data.dashboard,
      )?.dashboardId;

      if (!dashboardId) {
        tabList.value = [];
        return;
      }

      // get dashboard data
      // by using dashboard name, find dashboard data
      const dashboardData = await getDashboard(
        store,
        dashboardId,
        folderData?.folderId,
      );

      // if no dashboard with same dashboard name found, return
      if (!dashboardData) {
        tabList.value = [];
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

    // @submit fires only after the Zod schema passes (name required +
    // type-conditional url/logsQuery/folder/dashboard/tab rules). The validated
    // `value` is the sole source of truth (rule ②) — it carries every field,
    // including the form-owned `data.variables[]` rows.
    const onSubmit = async (value: DrilldownPopUpForm) => {
      const record = JSON.parse(JSON.stringify(value));
      // if editmode then made changes
      // else add new drilldown
      if (props?.isEditMode) {
        dashboardPanelData.data.config.drilldown[props?.drilldownDataIndex] =
          record;
      } else {
        dashboardPanelData.data.config.drilldown.push(record);
      }
      emit("close");
    };

    const options: any = reactive({
      selectedValue: [],
      selectedName: [],
    });

    //want label for dropdown in input and value for its input value
    const selectedValue = computed(() => {
      let selectedValues: any = [];

      // Get only visible variables (global, current tab, current panel) from variablesManager
      // If manager is not available, fall back to props.variablesData
      let allVariables: any[] = [];

      if (variablesManager && variablesManager.variablesData) {
        // Get the current panel ID and tab ID
        const currentPanelId = dashboardPanelData.data.id;
        // Get current tab ID from route query or first tab in dashboard
        const currentTabId =
          (route.query.tab as string) ||
          currentDashboardData?.data?.tabs?.[0]?.tabId ||
          "";

        // Use getAllVisibleVariables to get only global + current tab + current panel variables
        if (variablesManager.getAllVisibleVariables) {
          allVariables = variablesManager.getAllVisibleVariables(
            currentTabId,
            currentPanelId,
          );
        } else {
          // Fallback: manually merge global + current tab + current panel
          const globalVars = variablesManager.variablesData.global || [];
          const tabVars =
            (currentTabId &&
              variablesManager.variablesData.tabs?.[currentTabId]) ||
            [];
          const panelVars =
            (currentPanelId &&
              variablesManager.variablesData.panels?.[currentPanelId]) ||
            [];

          allVariables = [...globalVars, ...tabVars, ...panelVars];
        }
      } else {
        // Fallback to props.variablesData
        allVariables = props?.variablesData?.values || [];
      }

      const variableListName =
        allVariables
          ?.filter((variable: any) => variable.type !== "dynamic_filters")
          ?.map((variable: any) => ({
            label: variable.name,
            value: "${" + variable.name + "}",
          })) ?? [];

      if (dashboardPanelData.data.type === "sankey") {
        selectedValues = [
          { label: "Edge Source", value: "${edge.__source}" },
          { label: "Edge Target", value: "${edge.__target}" },
          { label: "Edge Value", value: "${edge.__value}" },
          { label: "Node Name", value: "${node.__name}" },
          { label: "Node Value", value: "${node.__value}" },
          ...variableListName,
        ];
      } else if (dashboardPanelData.data.type === "table") {
        dashboardPanelData.data.queries.forEach((query: any) => {
          const panelFields = [
            ...query.fields.x,
            ...query.fields.y,
            ...query.fields.z,
            ...variableListName,
          ];
          panelFields.forEach((field) => {
            const displayName = field.label || field.alias;
            selectedValues.push({
              label: displayName,
              value: '${row.field["' + displayName + '"]}',
            });
          });
        });
      } else if (
        ["pie", "donut", "gauge"].includes(dashboardPanelData.data.type)
      ) {
        selectedValues = [
          { label: "Series Name", value: "${series.__name}" },
          { label: "Series Value", value: "${series.__value}" },
          ...variableListName,
        ];
      } else if (dashboardPanelData.data.type === "metric") {
        selectedValues = [
          { label: "Series Value", value: "${series.__value}" },
          ...variableListName,
        ];
      } else {
        selectedValues = [
          { label: "Series Name", value: "${series.__name}" },
          { label: "Series Value", value: "${series.__value}" },
          { label: "Axis Value", value: "${series.__axisValue}" },
          ...variableListName,
        ];
      }
      return selectedValues;
    });

    // Assign selectedValue to options object
    options.selectedValue = selectedValue;

    const variableNamesFn = ref([]);

    const getvariableNames = async () => {
      if (
        drilldownData.value.data.folder &&
        drilldownData.value.data.dashboard
      ) {
        const folder = store.state.organizationData.folders.find(
          (folder: any) => folder.name === drilldownData.value.data.folder,
        );

        const allDashboardData = await getAllDashboardsByFolderId(
          store,
          folder.folderId,
        );

        const dashboardId = allDashboardData?.find(
          (dashboard: any) =>
            dashboard.title === drilldownData.value.data.dashboard,
        )?.dashboardId;

        if (!dashboardId) {
          variableNamesFn.value = [];
          return;
        }
        const dashboardData = await getDashboard(
          store,
          dashboardId,
          folder?.folderId,
        );

        if (dashboardData) {
          const optionsList = dashboardData.variables.list.map(
            (variable: any) => ({
              label: variable.name,
              value: variable.name,
            }),
          );
          variableNamesFn.value = optionsList;
        } else {
          variableNamesFn.value = [];
        }
      }
    };

    watch(drilldownData, async (newData) => {
      if (newData.data.folder && newData.data.dashboard) {
        await getvariableNames();
      } else {
        variableNamesFn.value = [];
      }
    }, { deep: true });

    watch(
      () => props.open,
      async (isOpen) => {
        if (!isOpen) {
          // This component is NOT v-if'd (parent only toggles `:open`), so the
          // useOForm form is created once and PERSISTS across opens. Reset it on
          // CLOSE to clear submit-state + errors — otherwise a failed submit's
          // errors linger when the dialog is reopened (the on-open reset alone
          // races with the dialog body remounting and doesn't refresh the
          // already-rendered errors). Resetting on close has no remount race.
          form.reset(getRecordData());
          return;
        }

        // Re-baseline the OForm to the freshly-seeded record on each open.
        // `:default-values` is read once at mount; the overlay may keep the body
        // mounted, so reset here (clears submit-state → no post-open "required"
        // flash). The read-only projection picks the values back up.
        await nextTick();
        form.reset(getRecordData());

        // NOTE: dependent lists are loaded in onMounted + refreshed by the
        // folder / dashboard / drilldownData watches — do NOT re-fetch them here.
        // Refreshing on every open reset the selected org when navigating away
        // (#12932), so that on-open refresh was removed.
      },
    );

    // bare Monaco editor → bridge into the form for superRefine
    const updateQueryValue = (value: string) => {
      setFormField("data.logsQuery", value);
    };

    return {
      t,
      form,
      firstFieldError,
      dashboardPanelData,
      drilldownData,
      "delete": "delete",
      store,
      folderList,
      dashboardList,
      tabList,
      options,
      variableNamesFn,
      updateQueryValue,
      addVariableRow,
      removeVariableRow,
      getFoldersListLoading,
      getDashboardListLoading,
      getTabListLoading,
    };
  },
});
</script>
