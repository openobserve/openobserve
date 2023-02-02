<template>
  <q-dialog v-model="confirmDelete">
    <q-card style="width: 240px">
      <q-card-section class="confirmBody">
        <div class="head">{{ title }}</div>
        <div class="para">{{ message }}</div>
      </q-card-section>

      <q-card-actions class="confirmActions">
        <q-btn
          v-close-popup
          unelevated
          no-caps
          class="q-mr-sm"
          @click="onCancel"
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
        >
          {{ t("confirmDialog.ok") }}
        </q-btn>
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "ConfirmDialog",
  emits: ["update:ok", "update:cancel"],
  props: ["title", "message"],
  setup(props, { emit }) {
    const { t } = useI18n();

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
    };
  },
});
</script>
