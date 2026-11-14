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
    :size="shown.warningMessage?.length || isTyped ? 'md' : 'sm'"
    :title="titleComputed"
    :primary="{
      label: okLabelComputed,
      variant: isDanger ? 'danger' : 'primary',
      disabled: !typedMatches,
    }"
    :secondary="{ label: cancelLabelComputed }"
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
      <div v-else-if="shown.message" class="para">{{ shown.message }}</div>
      <div v-if="shown.warningMessage && shown.warningMessage.length > 0" class="mt-4 text-left">
        <OInlineNotice tone="warn" :message="shown.warningMessage" />
      </div>
      <div v-if="isTyped" class="mt-4">
        <OInput
          v-model="typed"
          :label="t('confirmDialog.typeToConfirm', { text: raw(shown.confirmText) })"
          autocomplete="off"
          :placeholder="raw(shown.confirmText)"
          data-test="confirm-dialog-type-to-confirm"
          @keyup.enter="onConfirm"
        />
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch, watchEffect } from "vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import type { ConfirmKind } from "@/composables/useConfirmDialog";

defineOptions({ name: "ConfirmDialog" });

const props = withDefaults(
  defineProps<{
    /** confirm · destructive (names the object, red verb) · typeToConfirm (irreversible bulk) · discard (unsaved edits). */
    kind?: ConfirmKind;
    title?: I18nText;
    message?: I18nText;
    /** Takes precedence over `message`; the key must contain a {name} placeholder for the object. */
    messageKeypath?: I18nKey;
    messageName?: string;
    warningMessage?: I18nText;
    modelValue?: boolean;
    /** The verb on the primary button; a destructive confirm defaults to "Delete" (B3, V8). */
    okLabel?: I18nText;
    cancelLabel?: I18nText;
    /** The phrase a typeToConfirm dialog asks the user to type. */
    confirmText?: string;
  }>(),
  { kind: "confirm", modelValue: false },
);

const emit = defineEmits<{
  "update:ok": [];
  "update:cancel": [];
  "update:modelValue": [value: boolean];
}>();

const { t } = useI18nTyped();

const open = computed({
  get: () => props.modelValue ?? false,
  set: (v: boolean) => emit("update:modelValue", v),
});

const snapshot = () => ({
  kind: props.kind,
  title: props.title,
  message: props.message,
  messageKeypath: props.messageKeypath,
  messageName: props.messageName,
  warningMessage: props.warningMessage,
  okLabel: props.okLabel,
  cancelLabel: props.cancelLabel,
  confirmText: props.confirmText,
});
// Callers clear their state on OK/Cancel in the same tick, so the fade-out must keep the last open values.
const shown = shallowRef(snapshot());
watchEffect(() => {
  const next = snapshot();
  if (props.modelValue) shown.value = next;
});

const isTyped = computed(() => shown.value.kind === "typeToConfirm" && !!shown.value.confirmText);
const isDanger = computed(() => shown.value.kind !== "confirm");

const titleComputed = computed(() =>
  shown.value.kind === "discard"
    ? (shown.value.title ?? t("components.dialog.discardChanges"))
    : shown.value.title,
);

const okLabelComputed = computed<I18nText>(() => {
  if (shown.value.okLabel) return shown.value.okLabel;
  if (shown.value.kind === "discard") return t("components.dialog.discard");
  return isDanger.value ? t("common.delete") : t("common.confirm");
});

const cancelLabelComputed = computed<I18nText>(() => {
  if (shown.value.cancelLabel) return shown.value.cancelLabel;
  return shown.value.kind === "discard"
    ? t("components.dialog.keepEditing")
    : t("confirmDialog.cancel");
});

const typed = ref("");
const typedMatches = computed(() => !isTyped.value || typed.value === shown.value.confirmText);
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
</script>
