<template>
  <q-dialog>
    <q-card style="width: 300px" data-test="dialog-box">
      <q-card-section class="confirmBody">
        <div class="head">{{ title }}</div>
        <div class="para">{{ message }}</div>
      </q-card-section>

      <q-card-actions class="confirmActions">
        <q-select
          dense
          filled
          label="Select Tab"
          v-model="selectedMoveTabId"
          :options="moveTabOptions"
          class="select-container"
        />

        <div class="button-container">
          <q-btn
            v-close-popup
            unelevated
            no-caps
            class="q-mr-sm"
            @click="onCancel"
            data-test="cancel-button"
          >
            {{ t("confirmDialog.cancel") }}
          </q-btn>
          <q-btn
            v-close-popup
            unelevated
            no-caps
            class="no-border"
            color="primary"
            @click="onConfirm"
            data-test="confirm-button"
          >
            Move
          </q-btn>
        </div>
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { getDashboard } from "@/utils/commons";
import { reactive } from "vue";
import { onMounted } from "vue";
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { useStore } from "vuex";

export default defineComponent({
  name: "SinglePanelMove",
  emits: ["update:ok", "update:cancel"],
  props: ["title", "message"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const route = useRoute();
    const action = ref("delete");
    const selectedMoveTabId: any = ref(null);

    const moveTabOptions = ref([]);

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

      // update move tab options
      const newMoveTabOptions: any = [];
      currentDashboardData.data.tabs?.forEach((tab: any) => {
        // if tab is to be deleted, do not include it in the options
        if (tab.tabId != route.query.tab) {
          newMoveTabOptions.push({
            label: tab.name,
            value: tab.tabId,
          });
        }
      });

      moveTabOptions.value = newMoveTabOptions;
    });

    const onCancel = () => {
      emit("update:cancel");
    };

    const onConfirm = () => {
      emit("update:ok", selectedMoveTabId.value.value);
    };
    return {
      t,
      onCancel,
      onConfirm,
      action,
      selectedMoveTabId,
      moveTabOptions,
    };
  },
});
</script>

<style lang="scss" scoped>
.select-container {
  width: 100%;
  margin-bottom: 10px;
}
</style>
