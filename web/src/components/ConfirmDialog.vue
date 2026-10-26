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
    :secondary-button-label="cancelLabelComputed"
    :primary-button-label="okLabelComputed"
    :primary-button-color="okColor"
    :primary-button-variant="okVariant"
    :initial-focus="focusCancel ? 'secondary' : 'primary'"
    :primary-button-disabled="!typedMatches"
    @click:secondary="onCancel"
    @click:primary="onConfirm"
  >
    <div data-test="dialog-box" class="text-left">
      <div class="para">{{ message }}</div>
      <div v-if="warningMessage && warningMessage.length > 0" class="mt-4 text-left">
        <OBanner variant="warning" icon="warning" :content="warningMessage" />
      </div>
      <div v-if="confirmText" class="mt-4">
        <OInput
          v-model="typed"
          :label="t('confirmDialog.typeToConfirm', { text: raw(confirmText) })"
          size="sm"
          autocomplete="off"
          :placeholder="raw(confirmText)"
          data-test="confirm-dialog-type-to-confirm"
          @keyup.enter="onConfirm"
        />
      </div>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, computed, ref, watch, type PropType } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import type { ButtonVariant } from "@/lib/core/Button/OButton.types";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OInput from "@/lib/forms/Input/OInput.vue";

export default defineComponent({
  name: "ConfirmDialog",
  components: { ODialog, OBanner, OInput },
  emits: ["update:ok", "update:cancel", "update:modelValue"],
  props: {
    title: { type: String as unknown as PropType<I18nText> },
    message: { type: String as unknown as PropType<I18nText> },
    warningMessage: { type: String as unknown as PropType<I18nText> },
    modelValue: { type: Boolean, default: false },
    // No `default: ""` — an empty-string default would need a cast to I18nText,
    // and `okLabelComputed` already falls back when the prop is absent.
    okLabel: { type: String as unknown as PropType<I18nText> },
    okColor: { type: String, default: "primary" },
    cancelLabel: { type: String as unknown as PropType<I18nText> },
    okVariant: { type: String as PropType<ButtonVariant>, default: "primary" },
    // A destructive confirm starts on Cancel so Enter cannot delete by accident.
    focusCancel: { type: Boolean, default: false },
    confirmText: { type: String },
  },
  setup(props, { emit }) {
    const { t } = useI18nTyped();

    const open = computed({
      get: () => props.modelValue ?? false,
      set: (v: boolean) => emit("update:modelValue", v),
    });

    const okLabelComputed = computed(() => {
      return props.okLabel || t("confirmDialog.ok");
    });

    const cancelLabelComputed = computed(() => props.cancelLabel || t("confirmDialog.cancel"));

    const typed = ref("");
    const typedMatches = computed(() => !props.confirmText || typed.value === props.confirmText);
    watch(
      () => props.modelValue,
      () => (typed.value = ""),
    );

    const onCancel = () => {
      open.value = false;
      emit("update:cancel");
    };

    const onConfirm = () => {
      if (!typedMatches.value) return;
      open.value = false;
      emit("update:ok");
    };

    return {
      t,
      raw,
      open,
      typed,
      typedMatches,
      okLabelComputed,
      cancelLabelComputed,
      onCancel,
      onConfirm,
    };
  },
});
</script>
