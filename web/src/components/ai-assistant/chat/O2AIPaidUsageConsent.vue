<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Paid-usage consent rendered in place of the chat input, like O2AIConfirmDialog. -->
<template>
  <div
    class="rounded-default bg-surface-base border-border-default mb-2 flex w-full flex-col gap-3.5 border-2 px-4 pt-4 pb-3.5 shadow-sm"
    data-test="o2-ai-paid-usage-consent"
  >
    <div>
      <div class="text-text-heading text-sm font-semibold">
        {{ t("paidUsage.consentTitle") }}
      </div>
      <div class="text-text-secondary mt-0.5 text-xs">{{ t("paidUsage.consentSubtitle") }}</div>
    </div>

    <PaidOverageConsentBody />

    <div class="border-border-default flex justify-end gap-2 border-t pt-3.5">
      <OButton
        variant="outline"
        size="sm"
        :disabled="isSubmitting"
        data-test="o2-ai-paid-usage-consent-cancel"
        @click="decline"
      >
        {{ t("common.cancel") }}
      </OButton>
      <OButton
        v-if="canEnable"
        variant="primary"
        size="sm"
        :disabled="!acknowledgementChecked"
        :loading="isSubmitting"
        data-test="o2-ai-paid-usage-consent-enable"
        @click="accept"
      >
        {{ t("paidUsage.enablePaidUsage") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import PaidOverageConsentBody from "@/components/PaidOverageConsentBody.vue";
import { useI18nTyped } from "@/types/i18n";
import { usePaidOverageConsent } from "@/composables/usePaidOverageConsent";

const { t } = useI18nTyped();
const { acknowledgementChecked, isSubmitting, canEnable, accept, decline } =
  usePaidOverageConsent();
</script>
