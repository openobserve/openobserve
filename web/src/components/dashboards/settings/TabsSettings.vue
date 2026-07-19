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
  <div class="flex flex-col h-full" data-test="dashboard-tab-settings">
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
    <div ref="tableWrapper" data-test="dashboard-tab-settings-drag">
      <OTable
        data-test="dashboard-tabs-table"
        :data="currentDashboardData.data.tabs ?? []"
        :columns="columns"
        row-key="tabId"
        :frame="false"
        pagination="none"
        sorting="none"
        selection="none"
        :default-columns="false"
        :show-global-filter="false"
      >
        <template #cell-drag>
          <div
            class="tab-drag-handle flex items-center justify-center cursor-move"
            data-test="dashboard-tab-settings-drag-handle"
          >
            <OIcon name="drag-indicator" size="sm" />
          </div>
        </template>

        <template #cell-name="{ row }">
          <span
            v-if="row.tabId !== editTabId"
            class="block overflow-hidden text-ellipsis whitespace-nowrap"
            data-test="dashboard-tab-settings-tab-name"
            :data-test-tab-name="row.name"
            >{{ row.name }}</span
          >
          <div v-else class="flex items-center gap-1">
            <input
              v-model="editTabObj.data.name"
              class="flex-1 border border-theme-accent rounded-default p-1 outline-none min-w-0 focus:border-section-accent-secondary bg-input-bg"
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
        </template>

        <template #cell-actions="{ row }">
          <div class="flex justify-center gap-1">
            <OButton
              variant="ghost"
              size="icon"
              :disabled="row.tabId === editTabId"
              :title="t('dashboard.edit')"
              @click.stop="editItem(row.tabId)"
              data-test="dashboard-tab-settings-tab-edit-btn"
              icon-left="edit"
            >
            </OButton>
            <OButton
              v-if="currentDashboardData.data.tabs.length !== 1"
              variant="ghost"
              size="icon"
              :title="t('dashboard.delete')"
              @click.stop="deleteItem(row.tabId)"
              data-test="dashboard-tab-settings-tab-delete-btn"
            >
              <template #icon-left><OIcon name="delete" size="sm" /></template>
            </OButton>
          </div>
        </template>
      </OTable>
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
import Sortable from "sortablejs";
import { useI18n } from "vue-i18n";
import DashboardHeader from "./common/DashboardHeader.vue";
import { useStore } from "vuex";
import {
  deleteTab,
  editTab,
  getDashboard,
  updateDashboard,
} from "@/utils/commons";
import { useRoute } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import { reactive } from "vue";
import { onMounted, onActivated, onBeforeUnmount } from "vue";
import AddTab from "@/components/dashboards/tabs/AddTab.vue";
import TabsDeletePopUp from "./TabsDeletePopUp.vue";
import useNotifications from "@/composables/useNotifications";

export default defineComponent({
  name: "TabsSettings",
  components: {
    DashboardHeader,
    AddTab,
    TabsDeletePopUp,
    OButton,
    OIcon,
    OTable,
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
        handle: ".tab-drag-handle",
        onEnd: (evt: Sortable.SortableEvent) => {
          const { oldIndex, newIndex } = evt;
          if (oldIndex == null || newIndex == null || oldIndex === newIndex) {
            return;
          }

          // Revert Sortable's DOM mutation so Vue stays the single source of
          // truth, then reorder the reactive data and let Vue re-render.
          const parent = evt.from;
          if (newIndex > oldIndex) {
            parent.insertBefore(evt.item, parent.children[oldIndex]);
          } else {
            parent.insertBefore(evt.item, parent.children[oldIndex + 1] ?? null);
          }

          const list = [...currentDashboardData.data.tabs];
          const [moved] = list.splice(oldIndex, 1);
          list.splice(newIndex, 0, moved);
          currentDashboardData.data.tabs = list;

          handleDragEnd();
        },
      });
    };

    onMounted(async () => {
      await getDashboardData();
      await initSortable();
    });

    onActivated(async () => {
      await initSortable();
    });

    onBeforeUnmount(() => {
      sortableInstance?.destroy();
      sortableInstance = null;
    });

    const { t } = useI18n();

    // Wrapper around the global OTable; used to reach its rendered <tbody>
    // so SortableJS can provide row drag-and-drop (OTable has no native row
    // reorder — we layer it on without modifying OTable).
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
        id: "name",
        header: t("dashboard.name"),
        accessorKey: "name",
        size: COL.name,
        meta: { align: "left", isName: true, autoWidth: true },
      },
      {
        id: "actions",
        header: t("dashboard.actions"),
        isAction: true,
        size: 120,
        meta: { align: "center", actionCount: 2 },
      },
    ];

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

        emit("refresh");

        showPositiveNotification(t("dashboard.tabsSettings.dashboardUpdated"));
      } catch (error: any) {
        if (error?.response?.status === 409) {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ??
              error?.message ??
              t("dashboard.tabsSettings.tabReorderFailed"),
          );
        } else {
          showErrorNotification(
            error?.message ?? t("dashboard.tabsSettings.tabReorderFailed"),
          );
        }
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

          emit("refresh");
          await getDashboardData();

          showPositiveNotification(t("dashboard.tabsSettings.tabUpdated"));
          // reset edit mode
          editTabId.value = null;
          editTabObj.data = {};
        }
      } catch (error: any) {
        if (error?.response?.status === 409) {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ??
              error?.message ??
              t("dashboard.tabsSettings.tabUpdationFailed"),
          );
        } else {
          showErrorNotification(
            error?.message ?? t("dashboard.tabsSettings.tabUpdationFailed"),
          );
        }

        emit("refresh");
        await getDashboardData();
      }
    };

    const cancelEdit = () => {
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

        emit("refresh");

        tabIdToBeDeleted.value = null;
        deletePopupVisible.value = false;

        showPositiveNotification(t("dashboard.tabsSettings.tabDeleted"));
      } catch (error: any) {
        if (error?.response?.status === 409) {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ??
              error?.message ??
              t("dashboard.tabsSettings.tabDeletionFailed"),
          );
        } else {
          showErrorNotification(
            error?.message ?? t("dashboard.tabsSettings.tabDeletionFailed"),
            {
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
      t,
      columns,
      tableWrapper,
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
