<template>
  <div class="column full-height">
    <DashboardHeader :title="t('dashboard.tabSettingsTitle')"
      ><template #right>
        <q-btn
          class="text-bold no-border q-ml-md"
          no-caps
          no-outline
          rounded
          color="secondary"
          :label="t(`dashboard.newTab`)"
          @click="addNewItem"
        /> </template
    ></DashboardHeader>
    <div class="flex justify-between draggable-row q-py-md text-bold">
      <div class="q-ml-xl">{{ t("dashboard.name") }}</div>
      <div class="q-mr-lg">{{ t("dashboard.actions") }}</div>
    </div>
    <div>
      <draggable
        v-model="currentDashboardData.data.tabs"
        :options="dragOptions"
        @end="handleDragEnd"
      >
        <div
          v-for="(tab, index) in currentDashboardData.data.tabs"
          :key="index"
          class="draggable-row"
        >
          <div class="draggable-handle">
            <q-icon name="drag_indicator" color="grey-13" class="'q-mr-xs" />
          </div>
          <div class="draggable-content">
            <span v-if="tab.tabId !== editTabId">{{ tab.name }}</span>
            <div v-else class="flex">
              <input
                v-if="tab.tabId !== 'default'"
                v-model="editTabObj.data.name"
                class="edit-input"
              />
              <q-btn
                v-if="tab.tabId !== 'default'"
                icon="cancel"
                class="q-ml-xs"
                padding="sm"
                unelevated
                size="sm"
                round
                flat
                :title="t('dashboard.cancel')"
                @click="cancelEdit"
              ></q-btn>
              <q-btn
                v-if="tab.tabId !== 'default'"
                icon="check"
                class="q-ml-xs"
                padding="sm"
                unelevated
                size="sm"
                round
                flat
                :title="t('dashboard.save')"
                @click="saveEdit"
              ></q-btn>
            </div>
            <span class="q-ml-lg">
              <q-btn
                v-if="tab.tabId !== 'default'"
                icon="edit"
                class="q-ml-xs"
                padding="sm"
                unelevated
                size="sm"
                round
                flat
                :title="t('dashboard.edit')"
                @click="editItem(tab.tabId)"
              ></q-btn>
              <q-btn
                v-if="tab.tabId !== 'default'"
                :icon="outlinedDelete"
                :title="t('dashboard.delete')"
                class="q-ml-xs"
                padding="sm"
                unelevated
                size="sm"
                round
                flat
                @click="deleteItem(tab.tabId)"
              ></q-btn>
            </span>
          </div>
        </div>
      </draggable>
    </div>

    <!-- add tab dialog -->
    <q-dialog v-model="showAddTabDialog" position="right" full-height maximized>
      <AddTab
        :edit-mode="isTabEditMode"
        :tabId="selectedTabIdToEdit"
        :dashboardData="currentDashboardData.data"
        @refresh="refreshRequired"
      />
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { VueDraggableNext } from "vue-draggable-next";
import { useI18n } from "vue-i18n";
import DashboardHeader from "./common/DashboardHeader.vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { editTab, getDashboard } from "@/utils/commons";
import { useRoute } from "vue-router";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";
import { reactive } from "vue";
import { onMounted } from "vue";
import AddTab from "@/components/dashboards/tabs/AddTab.vue";

export default defineComponent({
  name: "TabsSettings",
  components: {
    draggable: VueDraggableNext,
    DashboardHeader,
    AddTab,
  },
  emits: ["refresh"],
  setup(props, { emit }) {
    const store = useStore();
    const $q = useQuasar();
    const route = useRoute();

    const showAddTabDialog = ref(false);
    const isTabEditMode = ref(false);
    const selectedTabIdToEdit = ref("");

    const currentDashboardData: any = reactive({
      data: {},
    });

    const getDashboardData = async () => {
      currentDashboardData.data = await getDashboard(
        store,
        route.query.dashboard,
        route.query.folder ?? "default"
      );
    };

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
      //   await updateDashboard(
      //     store,
      //     store.state.selectedOrganization.identifier,
      //     props.dashboardData.dashboardId,
      //     props.dashboardData,
      //     route.query.folder ?? "default"
      //   );

      $q.notify({
        type: "positive",
        message: "Dashboard updated successfully.",
        timeout: 2000,
      });
    };

    const editItem = (tabId: any) => {
      editTabId.value = tabId;
      editTabObj.data = currentDashboardData.data.tabs.find(
        (tab: any) => tab.tabId === tabId
      );
    };

    const saveEdit = async () => {
      if (editTabId.value) {
        // only allowed to edit name
        await editTab(
          store,
          currentDashboardData.data.dashboardId,
          route.query.folder ?? "default",
          editTabObj.data.tabId,
          editTabObj.data
        );

        // emit refresh to rerender
        emit("refresh");

        $q.notify({
          type: "positive",
          message: "Tab updated",
          timeout: 2000,
        });

        //add save name function here
        editTabId.value = null;
        editTabObj.data = {};
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

    const deleteItem = (tabId: any) => {
      // console.log("Delete item:", index);
    };

    const refreshRequired = async () => {
      emit("refresh");
      await getDashboardData();
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
      handleDragEnd,
      outlinedDelete,
      addNewItem,
      showAddTabDialog,
      isTabEditMode,
      selectedTabIdToEdit,
      currentDashboardData,
      refreshRequired,
    };
  },
});
</script>

<style lang="scss" scoped>
.draggable-row {
  display: flex;
  border-bottom: 1px solid #cccccc70;
  margin-bottom: 8px;
  cursor: move;
}

.draggable-handle {
  flex: 0 0 30px;
  padding: 8px;
  box-sizing: border-box;
}

.draggable-content {
  flex: 1;
  display: flex;
  justify-content: space-between;
  padding: 8px;
  box-sizing: border-box;
}

.edit-input {
  border: 1px solid $primary;
  border-radius: 4px;
  padding: 4px;
  outline: none;
  transition: border-color 0.3s;
  width: 100%;
}

.edit-input:focus {
  border-color: $secondary;
}
</style>
