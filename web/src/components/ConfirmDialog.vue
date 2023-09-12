<!-- Copyright 2023 Zinc Labs Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <q-dialog>
    <q-card style="width: 240px" data-test="dialog-box">
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
