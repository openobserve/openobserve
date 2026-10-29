<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <ODialog
    v-if="currentDialog"
    v-model:open="currentDialog.open"
    data-test="confirm-dialog-provider"
    size="sm"
    :title="currentDialog.title"
    :primary-button-label="currentDialog.confirmLabel || t('common.ok')"
    :secondary-button-label="
      currentDialog.confirmOnly ? undefined : currentDialog.cancelLabel || t('common.cancel')
    "
    :persistent="currentDialog.confirmOnly || (currentDialog.persistent ?? true)"
    :show-close="!currentDialog.confirmOnly"
    :primary-button-variant="currentDialog.confirmVariant ?? 'primary'"
    :initial-focus="currentDialog.focusCancel ? 'secondary' : 'primary'"
    @click:primary="handleConfirm"
    @click:secondary="handleCancel"
    @update:open="handleUpdateOpen"
  >
    <i18n-t
      v-if="currentDialog.messageKeypath"
      :keypath="currentDialog.messageKeypath"
      tag="div"
      class="text-center"
    >
      <template #name>
        <span
          data-test="confirm-dialog-provider-name"
          class="text-text-heading font-semibold break-all"
          >{{ currentDialog.messageName }}</span
        >
      </template>
    </i18n-t>
    <div v-else class="text-center">{{ currentDialog.message }}</div>
  </ODialog>
</template>

<script setup lang="ts">
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useI18nTyped } from "@/types/i18n";

const { currentDialog, handleConfirm, handleCancel, handleUpdateOpen } = useConfirmDialog();

const { t } = useI18nTyped();
</script>
