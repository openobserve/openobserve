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
    :size="shown.warningMessage?.length ? 'md' : 'sm'"
    :title="shown.title"
    :secondary-button-label="cancelLabelComputed"
    :primary-button-label="okLabelComputed"
    :primary-button-color="shown.okColor"
    :primary-button-variant="shown.okVariant"
    :initial-focus="shown.focusCancel ? 'secondary' : 'primary'"
    :primary-button-disabled="!typedMatches"
    @click:secondary="onCancel"
    @click:primary="onConfirm"
  >
    <div data-test="dialog-box" class="text-left">
      <i18n-t v-if="shown.messageKeypath" :keypath="shown.messageKeypath" tag="div" class="para">
        <template #name>
          <span data-test="confirm-dialog-name" class="text-text-heading font-semibold break-all">{{
            shown.messageName
          }}</span>
        </template>
      </i18n-t>
      <div v-else class="para">{{ shown.message }}</div>
      <div v-if="shown.warningMessage && shown.warningMessage.length > 0" class="mt-4 text-left">
        <OBanner variant="warning" icon="warning" :content="shown.warningMessage" />
      </div>
      <div v-if="shown.confirmText" class="mt-4">
        <OInput
          v-model="typed"
          :label="t('confirmDialog.typeToConfirm', { text: raw(shown.confirmText) })"
          size="sm"
          autocomplete="off"
          :placeholder="raw(shown.confirmText)"
          data-test="confirm-dialog-type-to-confirm"
          @keyup.enter="onConfirm"
        />
      </div>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, computed, ref, shallowRef, watch, watchEffect, type PropType } from "vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
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
    // Takes precedence over `message`; the key must contain a {name} placeholder.
    messageKeypath: { type: String as PropType<I18nKey> },
    messageName: { type: String },
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

    const snapshot = () => ({
      title: props.title,
      message: props.message,
      messageKeypath: props.messageKeypath,
      messageName: props.messageName,
      warningMessage: props.warningMessage,
      okLabel: props.okLabel,
      okColor: props.okColor,
      cancelLabel: props.cancelLabel,
      okVariant: props.okVariant,
      focusCancel: props.focusCancel,
      confirmText: props.confirmText,
    });
    // Callers clear their state on OK/Cancel in the same tick, so the fade-out must keep the last open values.
    const shown = shallowRef(snapshot());
    watchEffect(() => {
      const next = snapshot();
      if (props.modelValue) shown.value = next;
    });

    const okLabelComputed = computed(() => {
      return shown.value.okLabel || t("confirmDialog.ok");
    });

    const cancelLabelComputed = computed(
      () => shown.value.cancelLabel || t("confirmDialog.cancel"),
    );

    const typed = ref("");
    const typedMatches = computed(
      () => !shown.value.confirmText || typed.value === shown.value.confirmText,
    );
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
      shown,
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
