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
  <div>
    <div v-if="isAddVariable" class="tw:flex tw:flex-col full-height">
      <AddSettingVariable
        v-if="isAddVariable"
        @save="handleSaveVariable"
        :variableName="selectedVariable"
        @close="goBackToDashboardList"
        :dashboardVariablesList="dashboardVariablesList"
      />
    </div>
    <div v-else class="tw:flex tw:flex-col full-height">
      <DashboardHeader title="Variables">
        <template #right>
          <div class="tw:flex tw:gap-2">
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
      <div>
        <div class="tw:grid tw:py-2 tw:font-bold tw:border-b tw:border-b-(--o2-border-color) tw:bg-(--o2-table-header-bg)" style="grid-template-columns: 48px 80px minmax(200px, 1fr) 150px 100px 100px 120px" data-test="dashboard-variables-list-header">
          <div class="tw:pl-4"></div>
          <div>#</div>
          <div>{{ t("dashboard.name") }}</div>
          <div>{{ t("dashboard.type") }}</div>
          <div>{{ t("dashboard.selectType") }}</div>
          <div>Scope</div>
          <div class="tw:ml-4 tw:pl-4">
            {{ t("dashboard.actions") }}
          </div>
        </div>

        <draggable
          v-model="dashboardVariablesList"
          :options="dragOptions"
          @end="handleDragEnd"
          @mousedown.stop="() => {}"
          data-test="dashboard-variable-settings-drag"
        >
          <div
            v-for="(variable, index) in dashboardVariablesList"
            :key="variable.name"
            class="draggable-row tw:grid tw:items-center tw:rounded tw:border-b tw:border-b-(--o2-border-color) tw:hover:bg-[var(--color-interactive-hover-bg)]"
            style="grid-template-columns: 48px minmax(0, 1fr)"
            data-test="dashboard-variable-settings-draggable-row"
          >
            <div class="tw:flex tw:items-center tw:justify-center tw:h-full tw:cursor-move tw:box-border">
              <OIcon
                name="drag-indicator" size="sm"
                class="'tw:mr-1"
                data-test="dashboard-variable-settings-drag-handle"
              />
            </div>
            <div class="tw:grid tw:items-center" style="grid-template-columns: 80px minmax(200px, 1fr) 150px 100px 100px 120px">
              <div>
                {{ index < 9 ? `0${index + 1}` : index + 1 }}
              </div>
              <div class="item-name">
                <span class="tw:block tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                  {{ variable.name }}
                </span>
                <OTooltip
                  v-if="variable.name.length > 30"
                  :content="variable.name"
                />
              </div>
              <div>
                {{ getVariableTypeLabel(variable.type) }}
              </div>
              <div>
                {{
                  variable.multiSelect
                    ? t("dashboard.isMultiSelect")
                    : t("dashboard.isSingleSelect")
                }}
              </div>
              <div>
                <div class="tw:flex tw:items-center">
                  <OBadge
                    variant="primary-soft"
                    class="tw:ring-1 tw:ring-inset tw:ring-current"
                    v-if="getScopeType(variable) === 'global'"
                  >
                    Global
                  </OBadge>
                  <OBadge
                    variant="primary-outline"
                    v-else-if="getScopeType(variable) === 'tabs'"
                  >
                    {{ variable.tabs?.length || 0 }} Tabs
                  </OBadge>
                  <OBadge
                    variant="primary-outline"
                    v-else-if="getScopeType(variable) === 'panels'"
                  >
                    {{ variable.panels?.length || 0 }} Panels
                  </OBadge>

                  <OTooltip
                    v-if="getScopeType(variable) === 'tabs' && variable.tabs?.length"
                  >
                    <template #content>
                      <div>{{ t('dashboard.appliedToTabs') }}</div>
                      <div v-for="tabId in variable.tabs" :key="tabId">{{ getTabName(tabId) }}</div>
                    </template>
                  </OTooltip>

                  <OTooltip
                    v-if="getScopeType(variable) === 'panels' && variable.panels?.length"
                  >
                    <template #content>
                      <div>{{ t('dashboard.appliedToPanels') }}</div>
                      <div v-for="panelId in variable.panels" :key="panelId">{{ getPanelName(panelId) }}</div>
                    </template>
                  </OTooltip>
                </div>
              </div>
              <div class="tw:flex tw:justify-end tw:gap-2">
                <OButton
                  variant="ghost"
                  size="icon"
                  :title="t('dashboard.edit')"
                  @click="editVariableFn(variable.name)"
                  :data-test="`dashboard-edit-variable-${variable.name}`"
                  icon-left="edit"
                >
                </OButton>
                <OButton
                  variant="ghost"
                  size="icon"
                  :title="t('dashboard.delete')"
                  @click.stop="
                    showDeleteDialogFn({ row: { name: variable.name } })
                  "
                  data-test="dashboard-delete-variable"
                >
                  <template #icon-left
                    ><OIcon name="delete" size="sm"
                  /></template>
                </OButton>
              </div>
            </div>
          </div>
        </draggable>

        <ConfirmDialog
          :title="t('dashboard.deleteVariable')"
          :message="t('dashboard.deleteVariableMsg')"
          @update:ok="deleteVariableFn"
          @update:cancel="confirmDeleteDialog = false"
          v-model="confirmDeleteDialog"
        />
        <ODialog data-test="variable-settings-dependencies-graph-dialog" v-model:open="showVariablesDependenciesGraphPopUp" :width="60" title="Variables Dependency Graph">
          <div style="height: 60vh">
            <VariablesDependenciesGraph
              :variablesList="dashboardVariablesList"
              :class="store.state.theme == 'dark' ? 'dark-mode' : 'tw:bg-white'"
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
import { VueDraggableNext } from "vue-draggable-next";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";

export default defineComponent({
  name: "VariableSettings",
  components: {
    draggable: VueDraggableNext as any,
    AddSettingVariable,
    NoData,
    ConfirmDialog,
    DashboardHeader,
    VariablesDependenciesGraph,
    OButton,
    OIcon,
    ODialog,
    OBadge,
    OTooltip,
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

    const dragOptions = ref({
      animation: 200,
    });

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
      return tab ? tab.name : "Deleted Tab";
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
      return "Deleted Panel";
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

        showPositiveNotification("Dashboard updated successfully.", {
          timeout: 2000,
        });

        emit("save");
      } catch (error: any) {
        if (error?.response?.status === 409) {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ??
              error?.message ??
              "Variable reorder failed",
          );
        } else {
          showErrorNotification(error?.message ?? "Variable reorder failed");
        }
        await getDashboardData();
      }
    };

    onMounted(async () => {
      await getDashboardData();
    });

    onActivated(async () => {
      await getDashboardData();
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

        showPositiveNotification("Variable deleted successfully", {
          timeout: 2000,
        });
      } catch (error: any) {
        if (error?.response?.status === 409) {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ??
              error?.message ??
              "Variable deletion failed",
          );
        } else {
          showErrorNotification(error?.message ?? "Variable deletion failed", {
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
    };
    const goBackToDashboardList = () => {
      isAddVariable.value = false;
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
      dragOptions,
      handleDragEnd,
      getVariableTypeLabel,
      getScopeType,
      getTabName,
      getPanelName,
    };
  },
});
</script>
