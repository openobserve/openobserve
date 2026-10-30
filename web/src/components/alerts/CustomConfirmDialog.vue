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
    data-test="custom-confirm-dialog"
    v-model:open="isVisible"
    size="sm"
    :title="resolvedTitle"
    persistent
    :show-close="false"
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="t('confirmDialog.clearAndContinue')"
    @click:secondary="onCancel"
    @click:primary="onConfirm"
  >
    <div data-test="custom-confirm-card">
      <p data-test="dialog-message" class="text-sm leading-relaxed">{{ message }}</p>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch, type PropType } from "vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { raw, type I18nText, useI18nTyped } from "@/types/i18n";

export default defineComponent({
  name: "CustomConfirmDialog",
  components: { ODialog },
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
    title: {
      type: String as unknown as PropType<I18nText>,
      // Resolved in setup, not here: a literal default would ship untranslated,
      // and t() at module scope would freeze the copy at page-load locale.
      default: undefined,
    },
    message: {
      type: String as unknown as PropType<I18nText>,
      default: raw(""),
    },
  },
  emits: ["update:modelValue", "confirm", "cancel"],
  setup(props, { emit }) {
    const { t } = useI18nTyped();
    const isVisible = ref(props.modelValue);

    watch(
      () => props.modelValue,
      (newVal) => {
        isVisible.value = newVal;
      },
    );

    watch(isVisible, (newVal) => {
      emit("update:modelValue", newVal);
    });

    const onCancel = () => {
      isVisible.value = false;
      emit("cancel");
    };

    const resolvedTitle = computed(() => props.title ?? t("common.confirmAction"));

    const onConfirm = () => {
      isVisible.value = false;
      emit("confirm");
    };

    return {
      raw,
      resolvedTitle,
      isVisible,
      onCancel,
      onConfirm,
      t,
    };
  },
});
</script>
