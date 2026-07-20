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
  <ODialog data-test="custom-chart-confirm-dialog"
    v-model:open="open"
    :size="warningMessage?.length ? 'md' : 'sm'"
    :title="title"
    :secondary-button-label="t('confirmDialog.cancel')"
    :primary-button-label="t('confirmDialog.ok')"
    @click:secondary="onCancel"
    @click:primary="onConfirm"
  >
    <div data-test="dialog-box">
      <div class="para text-center">{{ message }}</div>
      <div v-if="warningMessage && warningMessage.length > 0" class="mt-4">
        <OBanner variant="warning" icon="warning" :content="warningMessage" />
      </div>
      <div v-if="hasQuery" class="mt-4">
        <OCheckbox
          v-model="replaceQuery"
          :label="t('dashboard.customChartConfirmDialog.alsoReplaceQuery')"
          data-test="replace-query-checkbox"
        />
        <div
          class="text-xs mt-1 ml-7 text-gray-500 dark:text-gray-400"
        >
          {{ t('dashboard.customChartConfirmDialog.exampleQueryInserted') }}
        </div>
      </div>
    </div>
  </ODialog>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";

export default defineComponent({
  name: "CustomChartConfirmDialog",
  components: { ODialog, OCheckbox, OBanner },
  emits: ["update:ok", "update:cancel", "update:modelValue"],
  props: {
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    warningMessage: {
      type: String,
      default: "",
    },
    currentQuery: {
      type: String,
      default: "",
    },
    modelValue: {
      type: Boolean,
      default: false,
    },
  },
  setup(props, { emit }) {
    const { t } = useI18n();

    const open = computed({
      get: () => props.modelValue ?? false,
      set: (v: boolean) => emit("update:modelValue", v),
    });

    // If no query exists, default to true (auto-checked); otherwise false
    const hasQuery = computed(() => props.currentQuery?.trim().length > 0);
    const replaceQuery = ref(!hasQuery.value);

    const onCancel = () => {
      open.value = false;
      emit("update:cancel");
    };

    const onConfirm = () => {
      open.value = false;
      emit("update:ok", { replaceQuery: replaceQuery.value });
    };
    return {
      t,
      open,
      replaceQuery,
      hasQuery,
      onCancel,
      onConfirm,
    };
  },
});
</script>
