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
  <ODialog
    v-model:open="open"
    data-test="confirm-dialog"
    :size="warningMessage?.length ? 'md' : 'sm'"
    :title="title"
    :secondary-button-label="t('confirmDialog.cancel')"
    :primary-button-label="t('confirmDialog.ok')"
    @click:secondary="onCancel"
    @click:primary="onConfirm"
  >
    <div data-test="dialog-box" class="tw:text-left">
      <div class="para">{{ message }}</div>
      <div v-if="warningMessage && warningMessage.length > 0" class="tw:mt-4 tw:text-left">
        <OBanner variant="warning" icon="warning" :content="warningMessage" />
      </div>
    </div>
  </ODialog>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, computed } from "vue";
import { useI18n } from "vue-i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";

export default defineComponent({
  name: "ConfirmDialog",
  components: { ODialog, OBanner },
  emits: ["update:ok", "update:cancel", "update:modelValue"],
  props: {
    title: { type: String },
    message: { type: String },
    warningMessage: { type: String },
    modelValue: { type: Boolean, default: false },
  },
  setup(props, { emit }) {
    const { t } = useI18n();

    const open = computed({
      get: () => props.modelValue ?? false,
      set: (v: boolean) => emit("update:modelValue", v),
    });

    const onCancel = () => {
      open.value = false;
      emit("update:cancel");
    };

    const onConfirm = () => {
      open.value = false;
      emit("update:ok");
    };

    return {
      t,
      open,
      onCancel,
      onConfirm,
    };
  },
});
</script>
