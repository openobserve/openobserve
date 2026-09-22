<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <ODialog
    :open="!!activeRequest"
    size="sm"
    :title="t('paidUsage.consentTitle')"
    :sub-title="t('paidUsage.consentSubtitle')"
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
    <div v-if="activeRequest" class="flex flex-col gap-4">
      <div class="border-border-default bg-surface-subtle rounded-default border p-3">
        <div class="text-text-heading text-sm font-semibold">
          {{ t("paidUsage.aiCredits") }}
        </div>
        <p class="text-text-secondary mt-1 text-sm">
          {{ t("paidUsage.freeCreditsDepleted") }}
        </p>
      </div>

      <p class="text-text-body text-sm" data-test="paid-overage-billing-cycle-copy">
        {{
          activeRequest.status.payer
            ? t("paidUsage.payerBillingCycle")
            : t("paidUsage.organizationBillingCycle")
        }}
        <!-- No rate is shown: this flow has no stable display price. -->
        <OButton
          variant="ghost-primary"
          size="sm"
          data-test="paid-overage-view-billing"
          @click="openBilling"
        >
          {{ t("paidUsage.viewBilling") }}
        </OButton>
      </p>

      <div v-if="activeRequest.status.payer" class="text-text-secondary text-sm">
        {{
          t("paidUsage.memberAndPayerRequired", {
            organization: activeRequest.status.organization.org_id,
            payer: activeRequest.status.payer.org_id,
          })
        }}
      </div>

      <div
        v-if="!canEnable"
        class="border-warning-300 bg-warning-50 text-warning-900 rounded-default border p-3 text-sm"
        data-test="paid-overage-contact-admin"
      >
        {{
          activeRequest.status.payer && !activeRequest.status.payer.can_manage
            ? t("paidUsage.contactPayerAdmin", { payer: activeRequest.status.payer.org_id })
            : t("paidUsage.contactOrganizationAdmin")
        }}
      </div>

      <OCheckbox
        v-if="canEnable"
        v-model="acknowledgementChecked"
        :label="t('paidUsage.authorizationCheckbox')"
        data-test="paid-overage-authorization-checkbox"
      />

      <div v-if="errorMessage" class="text-status-error-text text-sm" role="alert">
        {{ translatedError }}
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import { useI18nTyped } from "@/types/i18n";
import { usePaidOverageConsent } from "@/composables/usePaidOverageConsent";

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const {
  activeRequest,
  acknowledgementChecked,
  isSubmitting,
  errorMessage,
  canEnable,
  accept,
  decline,
} = usePaidOverageConsent();
const translatedError = computed(() => (errorMessage.value ? t(errorMessage.value as never) : ""));

function onOpenChange(open: boolean) {
  if (!open) decline();
}

// Leaving the dialog writes nothing, so the next paid attempt prompts again.
function openBilling() {
  decline();
  void router.push({
    name: "plans",
    query: { org_identifier: store.state.selectedOrganization.identifier },
  });
}
</script>
