<!-- Copyright 2026 OpenObserve Inc. -->
<!-- The consent prompt's content, shared by the global dialog and the inline chat card. -->
<template>
  <div v-if="orgName" class="flex min-w-0 flex-col gap-3">
    <p
      v-if="variant !== 'compact'"
      class="text-text-body text-sm break-words"
      data-test="assistant-consent-card-consequence"
    >
      {{ consequence }}
    </p>
    <OPopover v-else :aria-label="t('assistant.consent.aboutPaidUsage')">
      <template #trigger>
        <OButton
          variant="ghost-primary"
          size="sm"
          class="self-start max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-consent-card-about"
        >
          {{ t("assistant.consent.aboutPaidUsage") }}
        </OButton>
      </template>
      <p
        class="text-text-body max-w-80 p-3 text-sm break-words"
        data-test="assistant-consent-card-consequence"
      >
        {{ consequence }}
      </p>
    </OPopover>
    <OButton
      v-if="billingHref"
      variant="ghost-primary"
      size="sm"
      as="a"
      :href="billingHref"
      target="_blank"
      rel="noopener noreferrer"
      :aria-label="t('assistant.consent.manageInBillingName')"
      class="self-start max-md:min-h-11 pointer-coarse:min-h-11"
      data-test="assistant-consent-card-view-billing"
      @click="emit('open-billing')"
    >
      {{ t("assistant.consent.manageInBilling") }}
    </OButton>
    <!-- A click on the tick mark would reach the wrapping label too and toggle twice; the box itself takes it -->
    <OCheckbox
      v-if="canEnable"
      v-model="acknowledged"
      :label="t('assistant.consent.ack', { org: orgName })"
      class="max-md:min-h-11 pointer-coarse:min-h-11 [&_[role=checkbox]_*]:pointer-events-none"
      data-test="assistant-consent-card-checkbox"
    />
    <OBanner
      v-else
      variant="info"
      dense
      role="presentation"
      :content="
        payerName && planType === 'payer'
          ? t('assistant.consent.memberOnlyPayer', { payer: payerName })
          : t('assistant.consent.memberOnly', { org: orgName })
      "
      data-test="assistant-consent-card-member"
    >
      <template v-if="$slots['member-actions']" #actions><slot name="member-actions" /></template>
    </OBanner>
  </div>
  <div v-else-if="activeRequest" class="flex flex-col gap-3">
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
      v-if="!requestCanEnable"
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
      v-if="requestCanEnable"
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
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { useI18nTyped } from "@/types/i18n";
import { usePaidOverageConsent } from "@/composables/usePaidOverageConsent";

const props = withDefaults(
  defineProps<{
    orgName?: string;
    /** The identifier Billing opens on; the name when not given. */
    orgId?: string;
    payerName?: string;
    planType?: "direct" | "payer";
    /** The org that must enable is one the user manages. */
    canEnable?: boolean;
    variant?: "dialog" | "card" | "compact";
  }>(),
  {
    orgName: "",
    orgId: "",
    payerName: "",
    planType: "direct",
    canEnable: false,
    variant: "dialog",
  },
);

const emit = defineEmits<{ (e: "open-billing"): void }>();

const acknowledged = defineModel<boolean>("acknowledged", { default: false });

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const {
  activeRequest,
  acknowledgementChecked,
  errorMessage,
  canEnable: requestCanEnable,
  decline,
} = usePaidOverageConsent();
const translatedError = computed(() => (errorMessage.value ? t(errorMessage.value as never) : ""));

const consequence = computed(() =>
  props.planType === "payer" && props.payerName
    ? t("assistant.consent.consequencePayer", { org: props.orgName, payer: props.payerName })
    : t("assistant.consent.consequenceDirect", { org: props.orgName }),
);

// A new tab, so opening Billing never declines the card; a build without Billing offers no link.
const billingHref = computed(() => {
  if (!props.orgName) return null;
  try {
    const org = props.orgId || props.orgName;
    return router.resolve({ name: "plans", query: { org_identifier: org } }).href;
  } catch {
    return null;
  }
});

// Leaving the prompt writes nothing, so the next paid attempt prompts again.
function openBilling() {
  decline();
  void router.push({
    name: "plans",
    query: { org_identifier: store.state.selectedOrganization.identifier },
  });
}
</script>
