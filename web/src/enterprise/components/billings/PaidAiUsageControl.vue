<!-- Copyright 2026 OpenObserve Inc. -->
<!-- The paid AI usage switch on the Plans page's AI credits card; renders only where billing allows paid usage. -->
<template>
  <div
    v-if="status?.billing_status === 'eligible'"
    class="flex flex-col gap-1"
    data-test="billing-paid-ai-usage"
  >
    <OSwitch
      :model-value="displayEnabled"
      :disabled="saving || !status.organization.can_manage"
      :label="t('paidUsage.switchLabel')"
      size="sm"
      data-test="billing-paid-ai-usage-toggle"
      @update:model-value="updateEnabled"
    />
    <div
      :class="needsAttention ? 'text-status-warning-text' : 'text-text-secondary'"
      class="text-compact"
      data-test="billing-paid-ai-usage-hint"
    >
      {{ hint }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import type { SwitchValue } from "@/lib/forms/Switch/OSwitch.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import paidOverage, { type PaidOverageStatus } from "@/services/paidOverage";
import { useI18nTyped } from "@/types/i18n";
import { usePaidOverageConsent } from "@/composables/usePaidOverageConsent";

const props = defineProps<{ mode: string }>();
// The card re-reads its mode badge and bar once consent changes.
const emit = defineEmits<{ change: [] }>();

const store = useStore();
const { t } = useI18nTyped();
const { promptForConsent } = usePaidOverageConsent();
const status = ref<PaidOverageStatus | null>(null);
const displayEnabled = ref(false);
const saving = ref(false);
const orgId = computed(() => store.state.selectedOrganization.identifier as string);

// Off while the free credits are already gone means AI is blocked right now.
const needsAttention = computed(() => !displayEnabled.value && props.mode === "consent_required");

const hint = computed(() => {
  const s = status.value!;
  if (!s.organization.can_manage) return t("paidUsage.adminsOnly");
  if (s.organization.enabled && !s.effective && s.payer) {
    return t("paidUsage.waitingForPayer", { payer: s.payer.org_id });
  }
  if (s.effective) {
    return s.payer ? t("paidUsage.payerBillingCycle") : t("paidUsage.organizationBillingCycle");
  }
  return needsAttention.value ? t("paidUsage.consentRequiredMessage") : t("paidUsage.offHint");
});

async function loadStatus() {
  if (!orgId.value) return;
  try {
    status.value = (await paidOverage.get(orgId.value)).data;
    displayEnabled.value = status.value.effective;
  } catch {
    // Unknown consent state: show no switch rather than a wrong one.
    status.value = null;
  }
}

async function updateEnabled(value: SwitchValue) {
  if (typeof value !== "boolean" || !status.value || saving.value) return;
  const previous = status.value.effective;
  displayEnabled.value = value;
  saving.value = true;
  try {
    if (value) {
      // The dialog writes the consent; a decline leaves it off.
      if (!(await promptForConsent(orgId.value, "ai_credits", status.value))) {
        displayEnabled.value = previous;
        return;
      }
    } else {
      await paidOverage.update(orgId.value, "ai_credits", false);
    }
    await loadStatus();
    emit("change");
  } catch {
    displayEnabled.value = previous;
    toast({ variant: "error", message: t("paidUsage.updateFailed") });
  } finally {
    saving.value = false;
  }
}

onMounted(loadStatus);
watch(orgId, loadStatus);
</script>
