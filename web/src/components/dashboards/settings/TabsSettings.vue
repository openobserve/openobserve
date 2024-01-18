<template>
  <div class="column full-height">
    <DashboardHeader :title="t('dashboard.tabSettingsTitle')" />
    <div>
      <draggable v-model="list" :options="dragOptions" @end="handleDragEnd">
        <div v-for="(item, index) in list" :key="index" class="draggable-row">
          <div class="draggable-handle">
            <span>{{ index + 1 }}</span>
          </div>
          <div class="draggable-content">
            <span>{{ item.name }}</span>
            <span>
              <button @click="editItem(index)">Edit</button>
              <button @click="deleteItem(index)">Delete</button>
            </span>
          </div>
        </div>
      </draggable>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { VueDraggableNext } from "vue-draggable-next";
import { useI18n } from "vue-i18n";
import DashboardHeader from "./common/DashboardHeader.vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { updateDashboard } from "@/utils/commons";
import { useRoute } from "vue-router";

export default defineComponent({
  name: "TabsSettings",
  components: {
    draggable: VueDraggableNext,
    DashboardHeader,
  },
  setup(props) {
    const store = useStore();
    const $q = useQuasar();
    const route = useRoute();
    const list = ref([
      { name: "Item 1" },
      { name: "Item 2" },
      { name: "Item 3" },
      { name: "Item 4" },
    ]);

    const { t } = useI18n();
    const dragOptions = ref({
      animation: 200,
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
        timeout: 5000,
      });
    };

    const editItem = (index: number) => {
      console.log("Edit item:", index);
    };

    const deleteItem = (index: number) => {
      console.log("Delete item:", index);
    };

    return {
      list,
      dragOptions,
      t,
      editItem,
      deleteItem,
      handleDragEnd,
    };
  },
});
</script>

<style scoped>
.draggable-row {
  display: flex;
  border: 1px solid #ccc;
  margin-bottom: 8px;
  cursor: move;
}

.draggable-handle {
  flex: 0 0 30px;
  padding: 8px;
  border-right: 1px solid #ccc;
  box-sizing: border-box;
}

.draggable-content {
  flex: 1;
  display: flex;
  justify-content: space-between;
  padding: 8px;
  box-sizing: border-box;
}

.draggable-content span {
  flex-grow: 1;
  text-align: left;
}

.draggable-content button {
  margin-left: 8px;
}
</style>
