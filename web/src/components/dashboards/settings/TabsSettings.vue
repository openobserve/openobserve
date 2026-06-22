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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->

<template>
  <div class="tw:flex tw:flex-col tw:h-full" data-test="dashboard-tab-settings">
    <DashboardHeader :title="t('dashboard.tabSettingsTitle')">
      <template #right>
        <OButton
          variant="primary"
          size="sm"
          @click.stop="addNewItem"
          data-test="dashboard-tab-settings-add-tab"
          >{{ t("dashboard.newTab") }}</OButton
        >
      </template>
    </DashboardHeader>
    <div class="tw:flex tw:justify-between tw:font-bold tw:py-2 tw:px-4 tw:border-b tw:border-b-(--o2-border-color) tw:bg-(--o2-table-header-bg)">
      <div class="tw:grid tw:w-full tw:items-center" style="grid-template-columns: 40px minmax(0, 1fr) 80px">
        <div></div>
        <div class="tw:pl-2" data-test="dashboard-tab-settings-name">
          {{ t("dashboard.name") }}
        </div>
        <div class="tw:justify-self-end" data-test="dashboard-tab-settings-actions">
          {{ t("dashboard.actions") }}
        </div>
      </div>
    </div>
    <div>
      <draggable
        v-model="currentDashboardData.data.tabs"
        :options="dragOptions"
        @end.stop="handleDragEnd"
        @mousedown.stop="() => {}"
        data-test="dashboard-tab-settings-drag"
      >
        <div
          v-for="(tab, index) in currentDashboardData.data.tabs"
          :key="index"
          class="tw:grid tw:items-center tw:border-b tw:border-b-(--o2-border-color) tw:min-h-10 tw:hover:bg-[var(--color-interactive-hover-bg)]"
          style="grid-template-columns: 40px minmax(0, 1fr)"
          data-test="dashboard-tab-settings-draggable-row"
          :data-test-tab-name="tab.name"
        >
          <div class="tw:flex tw:items-center tw:justify-center tw:h-full tw:cursor-move">
            <OIcon
              name="drag-indicator" size="sm"
              class="tw:mr-1"
              data-test="dashboard-tab-settings-drag-handle"
            />
          </div>
          <div class="tw:grid tw:items-center tw:pr-2" style="grid-template-columns: minmax(0, 1fr) 80px">
            <span
              v-if="tab.tabId !== editTabId"
              class="tw:p-2 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap"
              data-test="dashboard-tab-settings-tab-name"
              >{{ tab.name }}</span
            >
            <div v-else class="tw:flex tw:items-center tw:py-1 tw:px-2 tw:gap-1">
              <input
                :class="store.state.theme === 'dark' ? 'tw:bg-gray-800' : ''"
                v-model="editTabObj.data.name"
                class="tw:flex-1 tw:border tw:border-(--q-primary) tw:rounded tw:p-1 tw:outline-none tw:min-w-0 tw:focus:border-(--q-secondary)"
                data-test="dashboard-tab-settings-tab-name-edit"
              />
              <OButton
                variant="ghost"
                size="icon"
                :title="t('dashboard.save')"
                @click.stop="saveEdit"
                :disabled="!editTabObj.data.name.trim()"
                data-test="dashboard-tab-settings-tab-name-edit-save"
                icon-left="check"
              >
              </OButton>
              <OButton
                variant="ghost"
                size="icon"
                :title="t('dashboard.cancel')"
                @click.stop="cancelEdit"
                data-test="dashboard-tab-settings-tab-name-edit-cancel"
                icon-left="close"
              >
              </OButton>
            </div>
            <div class="tw:flex tw:justify-end tw:gap-1">
              <OButton
                variant="ghost"
                size="icon"
                :disabled="tab.tabId === editTabId"
                :title="t('dashboard.edit')"
                @click.stop="editItem(tab.tabId)"
                data-test="dashboard-tab-settings-tab-edit-btn"
                icon-left="edit"
              >
              </OButton>
              <OButton
                v-if="currentDashboardData.data.tabs.length !== 1"
                variant="ghost"
                size="icon"
                :title="t('dashboard.delete')"
                @click.stop="deleteItem(tab.tabId)"
                data-test="dashboard-tab-settings-tab-delete-btn"
              >
                <template #icon-left
                  ><OIcon name="delete" size="sm"
                /></template>
              </OButton>
            </div>
          </div>
        </div>
      </draggable>
    </div>

    <AddTab
      v-model:open="showAddTabDialog"
      :edit-mode="isTabEditMode"
      :tabId="selectedTabIdToEdit"
      :dashboard-id="currentDashboardData.data.dashboardId"
      data-test="dashboard-tab-settings-add-tab-dialog"
      @refresh="refreshRequired"
    />
    <!-- delete tab dialog -->
    <TabsDeletePopUp
      v-model="deletePopupVisible"
      :key="tabIdToBeDeleted"
      @update:cancel="deletePopupVisible = false"
      @update:ok="confirmDelete"
      :tabId="tabIdToBeDeleted"
      :dashboardData="currentDashboardData.data"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, nextTick, ref } from "vue";
import { VueDraggableNext } from "vue-draggable-next";
import { useI18n } from "vue-i18n";
import DashboardHeader from "./common/DashboardHeader.vue";
import { useStore } from "vuex";
import { deleteTab, editTab, getDashboard } from "@/utils/commons";
import { useRoute } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { reactive } from "vue";
import { onMounted } from "vue";
import AddTab from "@/components/dashboards/tabs/AddTab.vue";
import TabsDeletePopUp from "./TabsDeletePopUp.vue";
import useNotifications from "@/composables/useNotifications";

export default defineComponent({
  name: "TabsSettings",
  components: {
    draggable: VueDraggableNext as any,
    DashboardHeader,
    AddTab,
    TabsDeletePopUp,
    OButton,
    OIcon,
  },
  setup(props, { emit }) {
    const store = useStore();
    const route = useRoute();

    const showAddTabDialog = ref(false);
    const isTabEditMode = ref(false);
    const selectedTabIdToEdit: any = ref("");

    const deletePopupVisible = ref(false);
    const tabIdToBeDeleted: any = ref(null);

    const currentDashboardData: any = reactive({
      data: {},
    });

    const getDashboardData = async () => {
      currentDashboardData.data = await getDashboard(
        store,
        route.query.dashboard,
        route.query.folder ?? "default",
      );
    };
    const {
      showPositiveNotification,
      showErrorNotification,
      showConfictErrorNotificationWithRefreshBtn,
    } = useNotifications();
    onMounted(async () => {
      await getDashboardData();
    });

    const { t } = useI18n();
    const dragOptions = ref({
      animation: 200,
    });

    const editTabId = ref(null);
    const editTabObj: any = reactive({
      data: {},
    });

    const handleDragEnd = async () => {
      try {
        await updateDashboard(
          store,
          store.state.selectedOrganization.identifier,
          currentDashboardData.data.dashboardId,
          currentDashboardData.data,
          route.query.folder ?? "default",
        );

        // emit refresh to rerender
        emit("refresh");

        showPositiveNotification("Dashboard updated successfully.");
      } catch (error: any) {
        if (error?.response?.status === 409) {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ??
              error?.message ??
              "Tab reorder failed",
          );
        } else {
          showErrorNotification(error?.message ?? "Tab reorder failed");
        }
        // emit refresh to rerender
        emit("refresh");
        await getDashboardData();
      }
    };

    const editItem = (tabId: any) => {
      editTabId.value = tabId;
      editTabObj.data = JSON.parse(
        JSON.stringify(
          currentDashboardData.data.tabs.find(
            (tab: any) => tab.tabId === tabId,
          ),
        ),
      );
    };

    const saveEdit = async () => {
      try {
        if (editTabId.value) {
          // only allowed to edit name
          await editTab(
            store,
            currentDashboardData.data.dashboardId,
            route.query.folder ?? "default",
            editTabObj.data.tabId,
            editTabObj.data,
          );

          // emit refresh to rerender
          emit("refresh");
          await getDashboardData();

          showPositiveNotification("Tab updated successfully");
          // reset edit mode
          editTabId.value = null;
          editTabObj.data = {};
        }
      } catch (error: any) {
        if (error?.response?.status === 409) {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ??
              error?.message ??
              "Tab updation failed",
          );
        } else {
          showErrorNotification(error?.message ?? "Tab updation failed");
        }

        // emit refresh to rerender
        emit("refresh");
        await getDashboardData();
      }
    };

    const cancelEdit = () => {
      // reset edit mode
      editTabId.value = null;
      editTabObj.data = {};
    };

    const addNewItem = () => {
      isTabEditMode.value = false;
      showAddTabDialog.value = true;
    };

    const deleteItem = async (tabId: any) => {
      tabIdToBeDeleted.value = tabId;
      await nextTick();
      // call cancelEdit to reset edit mode
      cancelEdit();
      deletePopupVisible.value = true;
    };

    const confirmDelete = async (moveTabId: any) => {
      try {
        await deleteTab(
          store,
          route.query.dashboard,
          route.query.folder,
          tabIdToBeDeleted.value,
          moveTabId,
        );
        await getDashboardData();

        // emit event
        emit("refresh");

        tabIdToBeDeleted.value = null;
        deletePopupVisible.value = false;

        showPositiveNotification("Tab deleted successfully");
      } catch (error: any) {
        if (error?.response?.status === 409) {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ??
              error?.message ??
              "Tab deletion failed",
          );
        } else {
          showErrorNotification(error?.message ?? "Tab deletion failed", {
            timeout: 2000,
          });
        }
      }
    };

    const refreshRequired = async () => {
      await getDashboardData();
      emit("refresh");
      showAddTabDialog.value = false;
      isTabEditMode.value = false;
    };

    return {
      dragOptions,
      t,
      editTabId,
      editTabObj,
      editItem,
      saveEdit,
      cancelEdit,
      deleteItem,
      confirmDelete,
      deletePopupVisible,
      tabIdToBeDeleted,
      handleDragEnd,
      addNewItem,
      showAddTabDialog,
      isTabEditMode,
      selectedTabIdToEdit,
      currentDashboardData,
      refreshRequired,
      store,
    };
  },
});
</script>
