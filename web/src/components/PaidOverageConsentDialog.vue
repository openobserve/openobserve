<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <ODialog
    :open="showInDialog"
    size="sm"
    :title="t('paidUsage.consentTitle')"
    :primary-button-label="canEnable ? t('paidUsage.enablePaidUsage') : undefined"
    :secondary-button-label="t('common.cancel')"
    :primary-button-disabled="!acknowledgementChecked || !canEnable"
    :primary-button-loading="isSubmitting"
    :persistent="isSubmitting"
    :show-close="!isSubmitting"
    data-test="paid-overage-consent-dialog"
    @update:open="onOpenChange"
    @click:primary="accept"
    @click:secondary="decline"
  >
    <PaidOverageConsentBody />
  </ODialog>
</template>

<script setup lang="ts">
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import PaidOverageConsentBody from "@/components/PaidOverageConsentBody.vue";
import { useI18nTyped } from "@/types/i18n";
import { usePaidOverageConsent } from "@/composables/usePaidOverageConsent";

const { t } = useI18nTyped();
const { acknowledgementChecked, isSubmitting, canEnable, showInDialog, accept, decline } =
  usePaidOverageConsent();

function onOpenChange(open: boolean) {
  if (!open) decline();
}
</script>
