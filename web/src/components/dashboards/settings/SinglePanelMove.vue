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
          v-model="selectedLocation"
          :options="tabLocations"
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
            {{ t("confirmDialog.ok") }}
          </q-btn>
        </div>
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "SinglePanelMove",
  emits: ["update:ok", "update:cancel"],
  props: ["title", "message"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const action = ref("delete");
    const selectedLocation = ref(null);
    const tabLocations = ["Location A", "Location B", "Location C"];

    const onCancel = () => {
      emit("update:cancel");
    };

    const onConfirm = () => {
      emit("update:ok");
    };
    return {
      t,
      onCancel,
      onConfirm,
      action,
      selectedLocation,
      tabLocations,
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
