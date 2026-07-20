<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <ODialog
    v-if="currentDialog"
    v-model:open="currentDialog.open"
    data-test="confirm-dialog-provider"
    size="sm"
    :title="currentDialog.title"
    :primary-button-label="currentDialog.confirmLabel || 'OK'"
    :secondary-button-label="currentDialog.cancelLabel || 'Cancel'"
    :persistent="currentDialog.persistent ?? true"
    @click:primary="handleConfirm"
    @click:secondary="handleCancel"
    @update:open="handleUpdateOpen"
  >
    <div class="text-center">{{ currentDialog.message }}</div>
  </ODialog>
</template>

<script setup lang="ts">
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { useConfirmDialog } from "@/composables/useConfirmDialog";

const { currentDialog, handleConfirm, handleCancel, handleUpdateOpen } =
  useConfirmDialog();
</script>
