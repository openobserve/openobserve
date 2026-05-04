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
    v-model:open="isVisible"
    size="sm"
    :title="title"
    persistent
    :show-close="false"
  >
    <div data-test="custom-confirm-card">
      <p data-test="dialog-message" class="tw:text-sm tw:leading-relaxed">{{ message }}</p>
    </div>
    <template #footer>
      <div data-test="dialog-actions" class="tw:flex tw:justify-end tw:gap-2">
        <OButton
          data-test="custom-cancel-button"
          variant="outline"
          size="sm-action"
          @click="onCancel"
        >Cancel</OButton>
        <OButton
          data-test="custom-confirm-button"
          variant="primary"
          size="sm-action"
          @click="onConfirm"
        >Clear &amp; Continue</OButton>
      </div>
    </template>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from "vue";
import OButton from '@/lib/core/Button/OButton.vue';
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";

export default defineComponent({
  name: "CustomConfirmDialog",
  components: { OButton, ODialog },
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
    title: {
      type: String,
      default: "Confirm Action",
    },
    message: {
      type: String,
      default: "",
    },
  },
  emits: ["update:modelValue", "confirm", "cancel"],
  setup(props, { emit }) {
    const isVisible = ref(props.modelValue);

    watch(
      () => props.modelValue,
      (newVal) => {
        isVisible.value = newVal;
      }
    );

    watch(isVisible, (newVal) => {
      emit("update:modelValue", newVal);
    });

    const onCancel = () => {
      isVisible.value = false;
      emit("cancel");
    };

    const onConfirm = () => {
      isVisible.value = false;
      emit("confirm");
    };

    return {
      isVisible,
      onCancel,
      onConfirm,
    };
  },
});
</script>
