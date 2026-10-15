<!-- Copyright 2026 OpenObserve Inc. -->
<!-- The consent prompt's content, shared by the global dialog and the inline chat card. -->
<template>
  <div v-if="activeRequest" class="flex flex-col gap-3">
    <!-- No figure is shown: the rate comes from the plan or contract, not a catalog price. -->
    <p class="text-text-body text-sm" data-test="paid-overage-billing-cycle-copy">
      {{
        activeRequest.status.payer
          ? t("paidUsage.consentBillingPayer", { payer: activeRequest.status.payer.org_id })
          : t("paidUsage.consentBilling")
      }}
    </p>

    <p class="text-text-secondary text-xs" data-test="paid-overage-scope-copy">
      {{ t("paidUsage.consentScope") }}
      <OButton
        variant="ghost-primary"
        size="xs"
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
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import { useI18nTyped } from "@/types/i18n";
import { usePaidOverageConsent } from "@/composables/usePaidOverageConsent";

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const { activeRequest, acknowledgementChecked, errorMessage, canEnable, decline } =
  usePaidOverageConsent();
const translatedError = computed(() => (errorMessage.value ? t(errorMessage.value as never) : ""));

// Leaving the prompt writes nothing, so the next paid attempt prompts again.
function openBilling() {
  decline();
  void router.push({
    name: "plans",
    query: { org_identifier: store.state.selectedOrganization.identifier },
  });
}
</script>
