<!-- Copyright 2026 OpenObserve Inc. -->
<!-- The org's free AI credits, shown above the chat input once they run low or out. -->
<template>
  <div
    v-if="exhausted || low"
    class="rounded-default border-border-default bg-surface-subtle mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border px-3 py-2 text-xs"
    :data-test="exhausted ? 'o2-ai-credits-exhausted' : 'o2-ai-credits-low'"
  >
    <div class="min-w-0 flex-1">
      <template v-if="exhausted">
        <div class="text-status-error-text font-semibold">
          {{ t("aiAssistant.creditsExhausted") }}
        </div>
        <div class="text-text-secondary">
          {{
            usage!.requires_additional_credits
              ? t("billing.aiContractExhaustedMessage")
              : usage!.payer_org_id
                ? t("billing.aiPayerSubscribeMessage", { payer: usage!.payer_org_id })
                : t("billing.aiExhaustedMessage")
          }}
        </div>
      </template>
      <template v-else>
        <div class="text-status-warning-text font-semibold">
          {{
            t("aiAssistant.creditsLow", {
              remaining: usage!.credits_remaining,
              limit: usage!.credits_limit,
            })
          }}
        </div>
        <div class="text-text-secondary">
          {{
            t("aiAssistant.creditsCosts", {
              chat: usage!.costs.chat,
              incident: usage!.costs.incident,
            })
          }}
        </div>
      </template>
    </div>
    <OButton
      v-if="exhausted && !usage!.requires_additional_credits"
      variant="primary"
      size="xs"
      data-test="o2-ai-credits-plans"
      @click="openPlans"
    >
      {{ t("billing.plansLabel") }}
    </OButton>
    <OButton
      v-if="exhausted && usage!.requires_additional_credits"
      variant="primary"
      size="xs"
      data-test="o2-ai-credits-contact"
      @click="contactSales"
    >
      {{ t("billing.contactLabel") }}
    </OButton>
    <OButton
      v-if="!exhausted"
      variant="ghost"
      size="xs"
      data-test="o2-ai-credits-paid-usage"
      @click="openPaidUsage"
    >
      {{ t("paidUsage.managePaidUsage") }}
    </OButton>
    <OButton
      v-if="exhausted"
      variant="outline"
      size="xs"
      data-test="o2-ai-credits-recheck"
      @click="refresh"
    >
      {{ t("common.refresh") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import BillingService, { type AiUsage } from "@/services/billings";
import { useI18nTyped } from "@/types/i18n";
import { siteURL } from "@/constants/config";

const props = defineProps<{ busy: boolean }>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const usage = ref<AiUsage | null>(null);

const orgId = computed(() => store.state.selectedOrganization?.identifier);
const exhausted = computed(() => usage.value?.mode === "exhausted");
const low = computed(
  () =>
    usage.value?.mode === "free" &&
    usage.value.credits_remaining <= usage.value.credits_limit * 0.2,
);

async function refresh() {
  const org = orgId.value;
  if (!org) return;
  try {
    const { data } = await BillingService.get_ai_usage(org);
    // An org switch during the request must not show the old org's balance.
    if (org === orgId.value) usage.value = data;
  } catch {
    // Unknown balance: show nothing rather than a wrong number.
  }
}

function openPlans() {
  void router.push({ name: "plans", query: { org_identifier: orgId.value } });
}

// Opting in before the last credit is how an org avoids a mid-task consent prompt.
function openPaidUsage() {
  void router.push({ name: "plans", query: { org_identifier: orgId.value } });
}

function contactSales() {
  window.open(siteURL.contactSales, "_blank");
}

onMounted(refresh);
watch(orgId, () => {
  usage.value = null;
  void refresh();
});
// Every finished turn may have spent credits.
watch(
  () => props.busy,
  (busy) => !busy && refresh(),
);
</script>
