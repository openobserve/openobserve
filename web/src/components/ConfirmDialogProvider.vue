<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <ODialog
    v-if="currentDialog"
    v-model:open="currentDialog.open"
    data-test="confirm-dialog-provider"
    size="sm"
    :title="currentDialog.title"
    :primary-button-label="currentDialog.confirmLabel || t('common.ok')"
    :secondary-button-label="currentDialog.cancelLabel || t('common.cancel')"
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
import { useI18n } from "vue-i18n";

const { currentDialog, handleConfirm, handleCancel, handleUpdateOpen } = useConfirmDialog();

const { t } = useI18n();
</script>
