<template>
  <q-dialog>
    <q-card style="width: 600px" data-test="dialog-box">
      <q-card-section class="confirmBody">
        <div class="head">Delete Tab</div>
        <div class="para">
          This action cannot be undone. Are you sure you want to delete this
          tab?
        </div>
      </q-card-section>

      <!-- only show if there are panels in the tab -->
      <div
        v-if="dashboardData.tabs.find((tab: any) => tab.tabId === tabId)?.panels?.length"
        style="padding: 10px"
      >
        <div class="radio-group">
          <q-radio v-model="action" val="delete">
            Delete all the panels of this tab
          </q-radio>
          <div style="display: flex; flex-direction: row">
            <q-radio v-model="action" val="move">
              Move panels to another tab
            </q-radio>
            <div v-if="action === 'move'" class="select-container">
              <q-select
                dense
                filled
                v-model="selectedTabToMovePanels"
                :options="moveTabOptions"
              />
            </div>
          </div>
        </div>
      </div>

      <q-card-actions class="confirmActions">
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
            {{ t("confirmDialog.ok") }}
          </q-btn>
        </div>
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { watch } from "vue";
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "TabsDeletePopUp",
  emits: ["update:ok", "update:cancel"],
  props: ["tabId", "dashboardData"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const action = ref("delete");
    const selectedTabToMovePanels = ref({ label: "Default", value: "default" });
    const moveTabOptions = ref([]);

    watch(
      () => props.dashboardData,
      () => {
        // update move tab options
        const newMoveTabOptions: any = [];
        props?.dashboardData?.tabs?.forEach((tab: any) => {
          // if tab is to be deleted, do not include it in the options
          if (tab.tabId != props.tabId) {
            newMoveTabOptions.push({
              label: tab.name,
              value: tab.tabId,
            });
          }
        });

        moveTabOptions.value = newMoveTabOptions;
      }
    );

    const onCancel = () => {
      emit("update:cancel");
    };

    const onConfirm = () => {
      // if action is delete, then emit without passing the selectedTabToMovePanels as args
      // else pass the selectedTabToMovePanels
      if (action.value === "delete") {
        emit("update:ok");
      }
      emit("update:ok", selectedTabToMovePanels.value.value);
    };
    return {
      t,
      onCancel,
      onConfirm,
      action,
      selectedTabToMovePanels,
      moveTabOptions,
    };
  },
});
</script>

<style lang="scss" scoped>
.q-radio {
  margin-bottom: 10px;
}

.radio-group {
  display: flex;
  flex-direction: column;
}

.select-container {
  margin-left: 20px;
  min-width: 200px;
  max-width: 300px;
  margin-bottom: 10px;
}
</style>
