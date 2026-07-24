<template>
  <ODialog
    v-model:open="internalValue"
    persistent
    :width="50"
    data-test="test-model-match-dialog"
    :title="t('modelPricing.testMatchTitle')"
    :sub-title="t('modelPricing.testMatchSubtitle')"
    :secondary-button-label="t('modelPricing.close')"
    :primary-button-label="t('modelPricing.testMatch')"
    :primary-button-disabled="!testModelName"
    :primary-button-loading="testing"
    @click:secondary="internalValue = false"
    @click:primary="runTest"
  >

    <!-- Two-column body -->
    <div class="flex flex-1 overflow-hidden min-h-0 h-full">
        <!-- ── Left: Inputs ── -->
        <div class="w-85 shrink-0 overflow-y-auto py-5 pr-5 pl-6 flex flex-col gap-5">
          <!-- Model Name -->
          <div class="flex flex-col gap-1.5">
            <label class="text-compact font-semibold text-text-heading"
              >{{ t("modelPricing.modelNameInput") }}
              <span class="text-status-error-text">*</span></label
            >
            <div class="text-xs opacity-50 leading-normal mb-0.5">
              {{ t("modelPricing.modelNameHint") }}
            </div>
            <OInput
              ref="modelInputRef"
              v-model="testModelName"
              :placeholder="t('settings.testModelMatchDialog.modelNamePlaceholder')"
              data-test="test-match-model-input"
            >
              <template #icon-left>
                <OIcon name="smart-toy" size="sm" class="opacity-[0.35] shrink-0" />
              </template>
              <template #icon-right>
                <OButton
                  v-if="testModelName"
                  variant="ghost"
                  size="icon"
                  class="opacity-[0.35] hover:opacity-70"
                  @click="clearAndFocus"
                  data-test="test-match-clear-btn"
                >
                  <OIcon name="close" size="xs" />
                </OButton>
              </template>
            </OInput>
          </div>
        </div>

        <!-- ── Vertical divider ── -->
        <div class="w-px bg-card-glass-border shrink-0"></div>

        <!-- ── Right: Live Results ── -->
        <div class="flex-1 overflow-y-auto py-5 pl-5 pr-6">
          <transition name="tmm-fade" mode="out-in">
            <!-- Empty state -->
            <div
              v-if="!testModelName"
              key="empty"
              class="flex flex-col items-center justify-center h-full min-h-50 gap-2.5"
              data-test="test-match-empty"
            >
              <OIcon name="manage-search" size="xl" class="opacity-[0.12]" />
              <div class="text-compact opacity-[0.35] text-center">
                {{ t("modelPricing.enterModelName") }}
              </div>
            </div>

            <!-- Typed but not yet tested -->
            <div
              v-else-if="testResult === null"
              key="waiting"
              class="flex flex-col items-center justify-center h-full min-h-50 gap-2.5"
              data-test="test-match-waiting"
            >
              <OIcon name="ads-click" size="xl" class="opacity-[0.12]" />
              <div class="text-compact opacity-[0.35] text-center">
                {{ t("modelPricing.clickToTest") }}
              </div>
            </div>

            <!-- No Match -->
            <div
              v-else-if="!testResult?.matched"
              key="no-match"
              class="flex flex-col gap-3"
              data-test="test-match-no-result"
            >
              <div class="flex items-center gap-3 py-3 px-3.5 rounded-default border bg-banner-error-soft-bg border-banner-error-soft-border">
                <div class="w-8 h-8 rounded-default flex items-center justify-center shrink-0 bg-status-error-bg text-status-error-text">
                  <OIcon name="error-outline" size="md" />
                </div>
                <div>
                  <div class="text-compact font-bold text-status-error-text">
                    {{ t("modelPricing.noMatchFound") }}
                  </div>
                  <div class="text-xs mt-0.5 opacity-70">
                    {{
                      t("modelPricing.noMatchDesc", {
                        modelName: testModelName,
                      })
                    }}
                  </div>
                </div>
              </div>
              <div class="py-3 px-3.5 rounded-default bg-surface-panel border border-card-glass-border">
                <div class="text-2xs font-semibold opacity-55 mb-1.5">
                  {{ t("modelPricing.troubleshootingTitle") }}
                </div>
                <ul class="m-0 pl-4 text-xs leading-[1.9] opacity-60">
                  <li>{{ t("modelPricing.tip1") }}</li>
                  <li>{{ t("modelPricing.tip2") }}</li>
                  <li>{{ t("modelPricing.tip3") }}</li>
                </ul>
              </div>
            </div>

            <!-- Match Found -->
            <div
              v-else
              key="match"
              class="flex flex-col gap-3"
              data-test="test-match-result"
            >
              <!-- Match status -->
              <div class="flex items-center gap-3 py-3 px-3.5 rounded-default border bg-banner-success-bg border-banner-success-border">
                <div class="w-8 h-8 rounded-default flex items-center justify-center shrink-0 bg-status-success-bg text-status-success-text">
                  <OIcon name="check-circle" size="md" />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-compact font-bold text-status-success-text">
                    {{ t("modelPricing.matchFound") }}
                  </div>
                  <div class="text-xs mt-0.5 opacity-70 truncate">
                    <code class="inline py-px px-1.5 rounded-default text-xs font-semibold font-mono bg-banner-success-bg border border-banner-success-border text-inherit">{{
                      testResult.matched.name
                    }}</code>
                  </div>
                </div>
                <OTag
                  type="modelSource"
                  :value="testResult.matched.source || 'org'"
                  class="shrink-0 text-2xs font-semibold ml-auto"
                >
                  {{ sourceLabel(testResult.matched) }}
                </OTag>
              </div>

              <!-- Priority flow -->
              <div class="py-3 px-3.5 border border-card-glass-border rounded-default bg-surface-panel">
                <div class="text-3xs font-semibold opacity-40 mb-2">
                  {{ t("modelPricing.matchPriority") }}
                </div>
                <div class="flex items-center gap-1.5 flex-wrap">
                  <template
                    v-for="(step, sIdx) in matchFlowSteps"
                    :key="step.key"
                  >
                    <div class="opacity-30" v-if="sIdx > 0">
                      <OIcon name="arrow-forward" size="xs" />
                    </div>
                    <div
                      class="flex items-center gap-1.25 py-1.25 px-2.5 rounded-default border border-card-glass-border text-2xs font-medium bg-transparent"
                      :class="{
                        'border-status-positive bg-banner-success-bg font-bold': step.key === winnerSource,
                        'opacity-40': step.key !== winnerSource,
                      }"
                    >
                      <OIcon
                        :name="step.icon"
                        size="sm"
                        class="opacity-60"
                      />
                      <span>{{ step.label }}</span>
                      <OIcon
                        v-if="step.key === winnerSource"
                        name="check-circle"
                        size="xs"
                        class="text-status-success-text"
                      />
                    </div>
                  </template>
                </div>
              </div>

              <!-- Tier + cost card -->
              <div class="border border-card-glass-border rounded-default overflow-hidden">
                <div class="py-3 px-3.5 bg-surface-panel border-b border-card-glass-border">
                  <div>
                    <div class="text-compact font-bold">
                      {{ testResult.tier || t("settings.testModelMatchDialog.defaultTier") }}
                    </div>
                    <div
                      class="text-2xs opacity-50 mt-0.5"
                      v-if="matchedTierDef?.condition"
                    >
                      {{ t("settings.testModelMatchDialog.condition") }}
                      <code class="tmm-cost-tier-desc-code py-px px-1 rounded-default bg-surface-subtle text-2xs"
                        >{{ matchedTierDef.condition.usage_key }}
                        {{ operatorSymbol(matchedTierDef.condition.operator) }}
                        {{ matchedTierDef.condition.value }}</code
                      >
                    </div>
                    <div class="text-2xs opacity-50 mt-0.5" v-else>
                      {{ t("modelPricing.defaultPricingTier") }}
                    </div>
                  </div>
                </div>

                <div class="text-xs" v-if="pricingRows.length > 0">
                  <div class="grid gap-2 py-1.75 px-3.5 border-b border-card-glass-border bg-surface-panel grid-cols-[1.5fr_1fr]">
                    <span class="text-3xs font-semibold opacity-40">{{ t("modelPricing.usageType") }}</span>
                    <span class="text-3xs font-semibold opacity-40 text-right">{{
                      t("modelPricing.pricePerMTokens")
                    }}</span>
                  </div>
                  <div
                    v-for="row in pricingRows"
                    :key="row.key"
                    class="tmm-cost-table-row grid gap-2 py-2 px-3.5 text-xs border-b border-border-default last:border-b-0 hover:bg-hover-gray grid-cols-[1.5fr_1fr]"
                  >
                    <span class="font-semibold font-mono text-2xs">{{ row.key }}</span>
                    <span class="font-semibold tabular-nums text-right"
                      >{{ t('modelPricing.currencySymbol') }}{{ formatRate(row.rate) }}</span
                    >
                  </div>
                </div>
                <div v-else class="flex items-center gap-1.75 p-3.5 text-xs opacity-40 italic">
                  <OIcon name="info-outline" size="sm" />
                  {{ t("modelPricing.noPricingForTier") }}
                </div>
              </div>
            </div>
          </transition>
        </div>
      </div>

  </ODialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import modelPricingService from "@/services/model_pricing";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OInput from "@/lib/forms/Input/OInput.vue";

const props = defineProps({
  modelValue: { type: Boolean, default: false },
});
const emit = defineEmits(["update:modelValue"]);

const { t } = useI18n();
const store = useStore();
const orgIdentifier = computed(
  () => store.state.selectedOrganization?.identifier || "",
);

const internalValue = computed({
  get: () => props.modelValue,
  set: (val) => emit("update:modelValue", val),
});

const testModelName = ref("");
const modelInputRef = ref<any>(null);

function clearAndFocus() {
  testModelName.value = "";
  nextTick(() => modelInputRef.value?.focus());
}

// Reset state and focus on open
watch(internalValue, (val) => {
  if (val) {
    testResult.value = null;
    testModelName.value = "";
    nextTick(() => {
      setTimeout(() => modelInputRef.value?.focus(), 100);
    });
  }
});

// ── Backend test API ──────────────────────────────────────────────────────────

const testResult = ref<any>(null);

async function callTestApi() {
  if (!testModelName.value) {
    testResult.value = null;
    return;
  }
  try {
    const res = await modelPricingService.test(orgIdentifier.value, {
      model_name: testModelName.value,
      usage: undefined,
      timestamp: null,
    });
    testResult.value = res.data;
  } catch {
    testResult.value = null;
  }
}

const testing = ref(false);

async function runTest() {
  if (!testModelName.value) return;
  testing.value = true;
  await callTestApi();
  testing.value = false;
}

watch(testModelName, (val) => {
  if (!val) testResult.value = null;
});

// ── Derived display values ────────────────────────────────────────────────────

const PRICE_KEY_ORDER = ["input", "output"];
function sortedPriceEntries(
  prices: Record<string, number>,
): [string, number][] {
  return Object.entries(prices).sort(([a], [b]) => {
    const ai = PRICE_KEY_ORDER.indexOf(a);
    const bi = PRICE_KEY_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

const winnerSource = computed(() => testResult.value?.matched?.source || null);

const matchFlowSteps = computed(() => [
  { key: "org", label: t("settings.testModelMatchDialog.stepYourOrg"), icon: "person" },
  { key: "meta_org", label: t("settings.testModelMatchDialog.stepGlobal"), icon: "corporate-fare" },
  { key: "built_in", label: t("settings.testModelMatchDialog.stepBuiltIn"), icon: "auto-awesome" },
]);

const matchedTierDef = computed(() => {
  const result = testResult.value;
  if (!result?.matched) return null;
  const tiers: any[] = result.matched.tiers || [];
  return (
    tiers.find((t: any) => (t.name || "Default") === result.tier) ||
    tiers[0] ||
    null
  );
});

const pricingRows = computed(() => {
  if (!testResult.value?.matched) return [];
  const tierPrices = matchedTierDef.value?.prices || {};
  return sortedPriceEntries(tierPrices).map(([key, pricePerToken]) => ({
    key,
    rate: pricePerToken * 1_000_000,
  }));
});

function operatorSymbol(op: string) {
  const map: Record<string, string> = {
    gt: ">",
    gte: "≥",
    lt: "<",
    lte: "≤",
    eq: "=",
    neq: "≠",
  };
  return map[op] || op;
}

function sourceLabel(model: any) {
  if (!model.source || model.source === "org")
    return t("settings.testModelMatchDialog.sourceYourOrg");
  if (model.source === "meta_org")
    return t("settings.testModelMatchDialog.sourceGlobal");
  return t("settings.testModelMatchDialog.sourceBuiltIn");
}

function formatRate(rate: number) {
  if (rate === 0) return "0.00";
  if (rate < 0.01) return rate.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return rate.toFixed(2);
}
</script>

<style scoped>
/* keep(complex-state): the enter/leave classes Vue applies for
   <Transition name="tmm-fade"> — Vue adds them itself, mid-transition, so no
   template utility can express them. Scoped is correct: every transitioned
   element is this component's own template child. */
.tmm-fade-enter-active,
.tmm-fade-leave-active {
  transition: all 0.18s ease;
}

.tmm-fade-enter-from {
  opacity: 0;
  transform: translateY(0.3125rem);
}

.tmm-fade-leave-to {
  opacity: 0;
}
</style>
