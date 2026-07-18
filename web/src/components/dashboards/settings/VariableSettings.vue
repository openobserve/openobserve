<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->
<template>
  <div class="full-height">
    <div v-if="isAddVariable" class="flex flex-col full-height">
      <AddSettingVariable
        v-if="isAddVariable"
        @save="handleSaveVariable"
        :variableName="selectedVariable"
        @close="goBackToDashboardList"
        :dashboardVariablesList="dashboardVariablesList"
      />
    </div>
    <div v-else class="flex flex-col full-height">
      <DashboardHeader :title="t('dashboard.variableSettingsPage.variables')">
        <template #right>
          <div class="flex gap-2">
            <!-- show variables dependencies if variables exist -->
            <OButton
              v-if="dashboardVariablesList.length > 0"
              variant="outline"
              size="sm"
              @click="showVariablesDependenciesGraphPopUp = true"
              data-test="dashboard-variable-dependencies-btn"
              >{{ t('dashboard.showDependencies') }}</OButton
            >
            <OButton
              variant="primary"
              size="sm"
              @click="addVariables"
              data-test="dashboard-add-variable-btn"
              >{{ t("dashboard.newVariable") }}</OButton
            >
          </div>
        </template>
      </DashboardHeader>
      <div ref="tableWrapper" data-test="dashboard-variable-settings-drag">
        <OTable
          data-test="dashboard-variables-table"
          :data="dashboardVariablesList"
          :columns="columns"
          row-key="name"
          :frame="false"
          pagination="none"
          sorting="none"
          selection="none"
          :default-columns="false"
          :show-global-filter="false"
        >
          <template #empty>
            <NoData />
          </template>

          <template #cell-drag>
            <div
              class="variable-drag-handle flex items-center justify-center cursor-move"
              data-test="dashboard-variable-settings-drag-handle"
            >
              <OIcon name="drag-indicator" size="sm" />
            </div>
          </template>

          <template #cell-index="{ row }">
            {{ formatIndex(row) }}
          </template>

          <template #cell-name="{ row }">
            <div class="item-name">
              <span class="block overflow-hidden text-ellipsis whitespace-nowrap">
                {{ row.name }}
              </span>
              <OTooltip v-if="row.name.length > 30" :content="row.name" />
            </div>
          </template>

          <template #cell-type="{ row }">
            {{ getVariableTypeLabel(row.type) }}
          </template>

          <template #cell-selection="{ row }">
            {{
              row.multiSelect
                ? t("dashboard.isMultiSelect")
                : t("dashboard.isSingleSelect")
            }}
          </template>

          <template #cell-scope="{ row }">
            <div class="flex items-center">
              <OTag
                type="variableScope"
                value="global"
                data-test="dashboard-variable-scope-badge"
                v-if="getScopeType(row) === 'global'"
              />
              <OTag
                type="variableScope"
                value="tabs"
                data-test="dashboard-variable-scope-badge"
                v-else-if="getScopeType(row) === 'tabs'"
              >
                {{ t('dashboard.variableSettingsPage.tabsCount', { n: row.tabs?.length || 0 }) }}
              </OTag>
              <OTag
                type="variableScope"
                value="panels"
                data-test="dashboard-variable-scope-badge"
                v-else-if="getScopeType(row) === 'panels'"
              >
                {{ t('dashboard.variableSettingsPage.panelsCount', { n: row.panels?.length || 0 }) }}
              </OTag>

              <OTooltip
                v-if="getScopeType(row) === 'tabs' && row.tabs?.length"
              >
                <template #content>
                  <div>{{ t('dashboard.appliedToTabs') }}</div>
                  <div v-for="tabId in row.tabs" :key="tabId">{{ getTabName(tabId) }}</div>
                </template>
              </OTooltip>

              <OTooltip
                v-if="getScopeType(row) === 'panels' && row.panels?.length"
              >
                <template #content>
                  <div>{{ t('dashboard.appliedToPanels') }}</div>
                  <div v-for="panelId in row.panels" :key="panelId">{{ getPanelName(panelId) }}</div>
                </template>
              </OTooltip>
            </div>
          </template>

          <template #cell-actions="{ row }">
            <div class="flex justify-center gap-2">
              <OButton
                variant="ghost"
                size="icon"
                :title="t('dashboard.edit')"
                @click="editVariableFn(row.name)"
                :data-test="`dashboard-edit-variable-${row.name}`"
                icon-left="edit"
              >
              </OButton>
              <OButton
                variant="ghost"
                size="icon"
                :title="t('dashboard.delete')"
                @click.stop="showDeleteDialogFn({ row: { name: row.name } })"
                data-test="dashboard-delete-variable"
              >
                <template #icon-left><OIcon name="delete" size="sm" /></template>
              </OButton>
            </div>
          </template>
        </OTable>

        <ConfirmDialog
          :title="t('dashboard.deleteVariable')"
          :message="t('dashboard.deleteVariableMsg')"
          @update:ok="deleteVariableFn"
          @update:cancel="confirmDeleteDialog = false"
          v-model="confirmDeleteDialog"
        />
        <ODialog data-test="variable-settings-dependencies-graph-dialog" v-model:open="showVariablesDependenciesGraphPopUp" :width="60" :title="t('dashboard.variableSettingsPage.variablesDependencyGraph')">
          <div style="height: 60vh">
            <VariablesDependenciesGraph
              :variablesList="dashboardVariablesList"
              :class="store.state.theme == 'dark' ? 'dark-mode' : 'bg-white'"
              @closePopUp="
                () => (showVariablesDependenciesGraphPopUp = false)
              "
            />
          </div>
        </ODialog>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  onActivated,
  onBeforeUnmount,
  reactive,
  nextTick,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRoute } from "vue-router";
import { getImageURL } from "../../../utils/zincutils";
import {
  getDashboard,
  deleteVariable,
  updateDashboard,
} from "../../../utils/commons";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import AddSettingVariable from "./AddSettingVariable.vue";
import DashboardHeader from "./common/DashboardHeader.vue";
import NoData from "../../shared/grid/NoData.vue";
import ConfirmDialog from "../../ConfirmDialog.vue";
import VariablesDependenciesGraph from "./VariablesDependenciesGraph.vue";
import useNotifications from "@/composables/useNotifications";
import Sortable from "sortablejs";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import {
  COL,
  TABLE_INDEX_COL_SIZE,
} from "@/lib/core/Table/OTable.types";

export default defineComponent({
  name: "VariableSettings",
  components: {
    AddSettingVariable,
    NoData,
    ConfirmDialog,
    DashboardHeader,
    VariablesDependenciesGraph,
    OButton,
    OIcon,
    ODialog,
    OTag,
    OTooltip,
    OTable,
  },
  emits: ["save"],
  setup(props, { emit }) {
    const store: any = useStore();
    const { t } = useI18n();
    const route = useRoute();
    const isAddVariable = ref(false);

    const dashboardVariableData: any = reactive({
      data: {},
    });

    // Wrapper around the global OTable; used to reach its rendered <tbody>
    // so SortableJS can provide row drag-and-drop (OTable has no native
    // row reorder — we layer it on without modifying OTable).
    const tableWrapper = ref<HTMLElement | null>(null);
    let sortableInstance: Sortable | null = null;

    const columns: OTableColumnDef[] = [
      {
        id: "drag",
        header: "",
        size: 32,
        minSize: 32,
        maxSize: 32,
        meta: { align: "center" },
      },
      {
        id: "index",
        header: "#",
        size: TABLE_INDEX_COL_SIZE,
        meta: { align: "left" },
      },
      {
        id: "name",
        header: t("dashboard.name"),
        accessorKey: "name",
        size: COL.name,
        meta: { align: "left", isName: true },
      },
      {
        id: "type",
        header: t("dashboard.type"),
        size: COL.type,
        meta: { align: "left" },
      },
      {
        id: "selection",
        header: t("dashboard.selectType"),
        size: COL.status,
        meta: { align: "left" },
      },
      {
        id: "scope",
        header: t("dashboard.variableSettingsPage.scope"),
        size: COL.status,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("dashboard.actions"),
        isAction: true,
        size: 120,
        meta: { align: "center", actionCount: 2 },
      },
    ];

    // Zero-padded position label ("01", "02", …) matching the previous design.
    const formatIndex = (variable: any) => {
      const index = dashboardVariablesList.value.indexOf(variable);
      return index < 9 ? `0${index + 1}` : `${index + 1}`;
    };

    const {
      showPositiveNotification,
      showErrorNotification,
      showConfictErrorNotificationWithRefreshBtn,
    } = useNotifications();
    // list of all variables, which will be same as the dashboard variables list
    const dashboardVariablesList: any = ref([]);
    const selectedVariable = ref(null);
    const confirmDeleteDialog = ref<boolean>(false);
    const selectedDelete: any = ref(null);
    const variableTypes = [
      {
        label: t("dashboard.queryValues"),
        value: "query_values",
      },
      {
        label: t("dashboard.constant"),
        value: "constant",
      },
      {
        label: t("dashboard.textbox"),
        value: "textbox",
      },
      {
        label: t("dashboard.custom"),
        value: "custom",
      },
    ];

    // show variables dependencies graph pop up
    const showVariablesDependenciesGraphPopUp = ref(false);

    const getVariableTypeLabel = (type: string) => {
      return variableTypes.find((vType) => vType.value === type)?.label || type;
    };

    // Function to determine the scope type of a variable
    const getScopeType = (variable: any) => {
      if (variable.panels && variable.panels.length > 0) {
        return "panels";
      } else if (variable.tabs && variable.tabs.length > 0) {
        return "tabs";
      } else {
        return "global";
      }
    };

    // Function to get tab name by ID
    const getTabName = (tabId: string) => {
      const tab = dashboardVariableData.data.tabs?.find(
        (t: any) => t.tabId === tabId,
      );
      return tab ? tab.name : t("dashboard.variableSettingsPage.deletedTab");
    };

    // Function to get panel name by ID
    const getPanelName = (panelId: string) => {
      // Look through all tabs to find the panel
      for (const tab of dashboardVariableData.data.tabs || []) {
        const panel = tab.panels?.find((p: any) => p.id === panelId);
        if (panel) {
          return `${tab.name} > ${panel.title || panel.id}`;
        }
      }
      return t("dashboard.variableSettingsPage.deletedPanel");
    };

    const handleDragEnd = async () => {
      try {
        dashboardVariableData.data.variables = {
          list: dashboardVariablesList.value,
        };

        await updateDashboard(
          store,
          store.state.selectedOrganization.identifier,
          dashboardVariableData.data.dashboardId,
          dashboardVariableData.data,
          route.query.folder ?? "default",
        );

        showPositiveNotification(t("dashboard.variableSettingsPage.dashboardUpdatedSuccessfully"), {
          timeout: 2000,
        });

        emit("save");
      } catch (error: any) {
        if (error?.response?.status === 409) {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ??
              error?.message ??
              t("dashboard.variableSettingsPage.variableReorderFailed"),
          );
        } else {
          showErrorNotification(error?.message ?? t("dashboard.variableSettingsPage.variableReorderFailed"));
        }
        await getDashboardData();
      }
    };

    // Attach SortableJS to OTable's rendered <tbody> so rows can be dragged
    // to reorder. Re-runnable: tears down any prior instance first.
    const initSortable = async () => {
      await nextTick();
      const tbody = tableWrapper.value?.querySelector(
        'tbody[data-test="o2-table-body"]',
      ) as HTMLElement | null;
      if (!tbody) return;

      sortableInstance?.destroy();
      sortableInstance = Sortable.create(tbody, {
        animation: 200,
        handle: ".variable-drag-handle",
        onEnd: (evt: Sortable.SortableEvent) => {
          const { oldIndex, newIndex } = evt;
          if (
            oldIndex == null ||
            newIndex == null ||
            oldIndex === newIndex
          ) {
            return;
          }

          // Revert Sortable's DOM mutation so Vue stays the single source of
          // truth, then reorder the reactive data and let Vue re-render.
          const parent = evt.from;
          if (newIndex > oldIndex) {
            parent.insertBefore(evt.item, parent.children[oldIndex]);
          } else {
            parent.insertBefore(
              evt.item,
              parent.children[oldIndex + 1] ?? null,
            );
          }

          const list = [...dashboardVariablesList.value];
          const [moved] = list.splice(oldIndex, 1);
          list.splice(newIndex, 0, moved);
          dashboardVariablesList.value = list;

          handleDragEnd();
        },
      });
    };

    onMounted(async () => {
      await getDashboardData();
      await initSortable();
    });

    onActivated(async () => {
      await getDashboardData();
      await initSortable();
    });

    onBeforeUnmount(() => {
      sortableInstance?.destroy();
      sortableInstance = null;
    });

    const getDashboardData = async () => {
      dashboardVariableData.data = await getDashboard(
        store,
        route.query.dashboard,
        route.query.folder ?? "default",
      );

      dashboardVariablesList.value =
        dashboardVariableData.data?.variables?.list ?? [];
    };

    const addVariables = () => {
      selectedVariable.value = null;
      isAddVariable.value = true;
    };

    const showDeleteDialogFn = (props: any) => {
      selectedDelete.value = props.row;
      confirmDeleteDialog.value = true;
    };

    const deleteVariableFn = async () => {
      try {
        if (selectedDelete.value) {
          const variableName = selectedDelete?.value?.name;

          await deleteVariable(
            store,
            route.query.dashboard,
            variableName,
            route.query.folder ?? "default",
          );

          await getDashboardData();
          emit("save");
        }

        showPositiveNotification(t("dashboard.variableSettingsPage.variableDeletedSuccessfully"), {
          timeout: 2000,
        });
      } catch (error: any) {
        if (error?.response?.status === 409) {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ??
              error?.message ??
              t("dashboard.variableSettingsPage.variableDeletionFailed"),
          );
        } else {
          showErrorNotification(error?.message ?? t("dashboard.variableSettingsPage.variableDeletionFailed"), {
            timeout: 2000,
          });
        }
      }
    };
    const handleSaveVariable = async () => {
      // Refresh the dashboard data to get the latest variables list
      await getDashboardData();
      // Emit save event to parent (ViewDashboard) to trigger dashboard reload
      emit("save");
      // Wait for next tick before switching views to ensure data is updated
      await nextTick();
      // Go back to listing page after save so user can see the updated variable list
      // The settings dialog remains open (controlled by parent component)
      isAddVariable.value = false;
      // Wait for the listing view to render
      await nextTick();
      // OTable remounted with a fresh <tbody>; re-attach row dragging.
      await initSortable();
    };
    const goBackToDashboardList = async () => {
      isAddVariable.value = false;
      await initSortable();
    };
    const editVariableFn = async (name: any) => {
      selectedVariable.value = name;

      isAddVariable.value = true;
    };

    return {
      t,
      store,
      getDashboardData,
      addVariables,
      dashboardVariablesList,
      isAddVariable,
      showDeleteDialogFn,
      confirmDeleteDialog,
      deleteVariableFn,
      goBackToDashboardList,
      editVariableFn,
      selectedVariable,
      handleSaveVariable,
      showVariablesDependenciesGraphPopUp,
      getVariableTypeLabel,
      getScopeType,
      getTabName,
      getPanelName,
      tableWrapper,
      columns,
      formatIndex,
      handleDragEnd,
    };
  },
});
</script>
