<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <ODialog
    v-if="currentDialog"
    v-model:open="currentDialog.open"
    data-test="confirm-dialog-provider"
    size="sm"
    :title="currentDialog.title"
    :primary="{
      label: currentDialog.confirmLabel || defaultConfirmLabel,
      variant: isDanger ? 'danger' : 'primary',
    }"
    :secondary="{
      label: currentDialog.confirmOnly
        ? undefined
        : currentDialog.cancelLabel || defaultCancelLabel,
    }"
    :persistent="!!currentDialog.confirmOnly"
    @click:primary="handleConfirm"
    @click:secondary="handleCancel"
    @update:open="handleUpdateOpen"
  >
    <i18n-t v-if="currentDialog.messageKeypath" :keypath="currentDialog.messageKeypath" tag="div">
      <template #name>
        <span
          data-test="confirm-dialog-provider-name"
          class="text-text-heading font-semibold break-all"
          >{{ currentDialog.messageName }}</span
        >
      </template>
    </i18n-t>
    <div v-else-if="currentDialog.lines" class="flex flex-col gap-2">
      <div>{{ currentDialog.message }}</div>
      <ul :data-test="currentDialog.linesDataTest" class="flex list-disc flex-col gap-1.5 ps-5">
        <li v-for="line in currentDialog.lines" :key="line">{{ line }}</li>
      </ul>
    </div>
    <div v-else>{{ currentDialog.message }}</div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useI18nTyped } from "@/types/i18n";

const { currentDialog, handleConfirm, handleCancel, handleUpdateOpen } = useConfirmDialog();

const { t } = useI18nTyped();

const kind = computed(() => currentDialog.value?.kind ?? "confirm");
const isDanger = computed(() => kind.value !== "confirm");
const defaultConfirmLabel = computed(() => {
  if (kind.value === "discard") return t("components.dialog.discard");
  return isDanger.value ? t("common.delete") : t("common.confirm");
});
const defaultCancelLabel = computed(() =>
  kind.value === "discard" ? t("components.dialog.keepEditing") : t("common.cancel"),
);
</script>
