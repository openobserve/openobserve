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
  <ODialog data-test="custom-confirm-dialog"
    v-model:open="isVisible"
    size="sm"
    :title="title"
    persistent
    :show-close="false"
    secondary-button-label="Cancel"
    primary-button-label="Clear & Continue"
    @click:secondary="onCancel"
    @click:primary="onConfirm"
  >
    <div data-test="custom-confirm-card">
      <p data-test="dialog-message" class="tw:text-sm tw:leading-relaxed">{{ message }}</p>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from "vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";

export default defineComponent({
  name: "CustomConfirmDialog",
  components: { ODialog },
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
