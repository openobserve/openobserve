<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <OPageLayout
    :title="t('paidUsage.settingsTitle')"
    :subtitle="t('paidUsage.settingsDescription')"
    icon="paid"
    bleed
    data-test="paid-usage-settings"
  >
    <div class="px-page-edge py-4">
      <div v-if="loading" class="flex justify-center py-8">
        <OSpinner size="md" />
      </div>

      <div v-else-if="loadError" class="text-status-error-text py-6 text-sm" role="alert">
        {{ t("paidUsage.loadFailed") }}
      </div>

      <div
        v-else-if="status"
        class="border-border-default bg-surface-base rounded-default max-w-3xl border p-5"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-text-heading text-base font-semibold">
              {{ t("paidUsage.aiCredits") }}
            </div>
            <div class="text-text-secondary mt-1 text-sm">
              {{ t("paidUsage.aiCreditsDescription") }}
            </div>
          </div>
          <OSwitch
            :model-value="displayEnabled"
            :disabled="
              saving || !status.organization.can_manage || status.billing_status !== 'eligible'
            "
            :label="t('paidUsage.allowPaidUsage')"
            data-test="paid-usage-ai-credits-toggle"
            @update:model-value="updateEnabled"
          />
        </div>

        <div class="mt-5 grid gap-3 sm:grid-cols-2">
          <div class="bg-surface-subtle rounded-default p-3">
            <div class="text-text-muted text-xs">{{ t("paidUsage.freeUsage") }}</div>
            <div class="text-text-body mt-1 text-sm font-semibold">
              {{ aiUsage ? `${aiUsage.credits_used} / ${aiUsage.credits_limit}` : "—" }}
            </div>
          </div>
          <div class="bg-surface-subtle rounded-default p-3">
            <div class="text-text-muted text-xs">{{ t("paidUsage.billingEligibility") }}</div>
            <div class="text-text-body mt-1 text-sm font-semibold">
              {{ billingStatusLabel }}
            </div>
          </div>
          <div class="bg-surface-subtle rounded-default p-3">
            <div class="text-text-muted text-xs">{{ t("paidUsage.organizationState") }}</div>
            <div class="text-text-body mt-1 text-sm font-semibold">
              {{ status.organization.org_id }} —
              {{
                status.organization.enabled
                  ? t("components.badge.booleanState.enabled")
                  : t("components.badge.booleanState.disabled")
              }}
            </div>
          </div>
          <div class="bg-surface-subtle rounded-default p-3">
            <div class="text-text-muted text-xs">{{ t("paidUsage.effectiveState") }}</div>
            <div class="text-text-body mt-1 text-sm font-semibold">
              {{
                status.effective
                  ? t("components.badge.booleanState.enabled")
                  : t("components.badge.booleanState.disabled")
              }}
            </div>
          </div>
          <div v-if="status.payer" class="bg-surface-subtle rounded-default p-3 sm:col-span-2">
            <div class="text-text-muted text-xs">{{ t("paidUsage.payerState") }}</div>
            <div class="text-text-body mt-1 text-sm font-semibold">
              {{ status.payer.org_id }} —
              {{
                status.payer.enabled
                  ? t("components.badge.booleanState.enabled")
                  : t("components.badge.booleanState.disabled")
              }}
            </div>
          </div>
        </div>

        <p
          v-if="status.effective"
          class="text-text-secondary mt-4 text-sm"
          data-test="paid-usage-settings-billing-cycle-copy"
        >
          {{
            status.payer
              ? t("paidUsage.payerBillingCycle")
              : t("paidUsage.organizationBillingCycle")
          }}
        </p>
        <p v-if="!status.organization.can_manage" class="text-text-muted mt-4 text-sm">
          {{ t("paidUsage.readOnlyAdmin") }}
        </p>
      </div>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import type { SwitchValue } from "@/lib/forms/Switch/OSwitch.types";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import paidOverage, { type PaidOverageStatus } from "@/services/paidOverage";
import billings from "@/services/billings";
import type { AiUsage } from "@/services/billings";
import { usePaidOverageConsent } from "@/composables/usePaidOverageConsent";

const store = useStore();
const { t } = useI18nTyped();
const { promptForConsent } = usePaidOverageConsent();
const status = ref<PaidOverageStatus | null>(null);
const aiUsage = ref<AiUsage | null>(null);
const displayEnabled = ref(false);
const loading = ref(false);
const saving = ref(false);
const loadError = ref(false);
const orgId = computed(() => store.state.selectedOrganization.identifier as string);

const billingStatusLabel = computed(() => {
  if (!status.value) return "";
  return t(`paidUsage.billingStatus.${status.value.billing_status}` as never);
});

async function loadStatus() {
  if (!orgId.value) return;
  loading.value = true;
  loadError.value = false;
  try {
    const [consentResponse, usageResponse] = await Promise.all([
      paidOverage.get(orgId.value),
      billings.get_ai_usage(orgId.value),
    ]);
    status.value = consentResponse.data;
    displayEnabled.value = status.value.effective;
    aiUsage.value = usageResponse.data;
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

async function updateEnabled(value: SwitchValue) {
  if (typeof value !== "boolean") return;
  const enabled = value;
  if (!status.value || saving.value || !status.value.organization.can_manage) return;
  const previous = status.value.effective;
  displayEnabled.value = enabled;
  saving.value = true;
  try {
    if (enabled) {
      const accepted = await promptForConsent(orgId.value, "ai_credits", status.value);
      if (!accepted) {
        displayEnabled.value = previous;
        return;
      }
    } else {
      await paidOverage.update(orgId.value, "ai_credits", false);
    }
    await loadStatus();
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
