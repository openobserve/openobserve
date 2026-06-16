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
    <div class="tw:flex tw:flex-1 tw:overflow-hidden tw:min-h-0" style="height: 100%">
        <!-- ── Left: Inputs ── -->
        <div class="tw:w-[340px] tw:shrink-0 tw:overflow-y-auto tw:py-5 tw:pr-5 tw:pl-6 tw:flex tw:flex-col tw:gap-5">
          <!-- Model Name -->
          <div class="tw:flex tw:flex-col tw:gap-[6px]">
            <label class="tw:text-[13px] tw:font-semibold tw:text-(--color-text-primary)"
              >{{ t("modelPricing.modelNameInput") }}
              <span class="tw:text-[#ef4444]">*</span></label
            >
            <div class="tw:text-xs tw:opacity-50 tw:leading-normal tw:mb-0.5">
              {{ t("modelPricing.modelNameHint") }}
            </div>
            <OInput
              ref="modelInputRef"
              v-model="testModelName"
              placeholder="e.g. gpt-4-turbo"
              data-test="test-match-model-input"
            >
              <template #icon-left>
                <OIcon name="smart-toy" size="sm" class="tw:opacity-[0.35] tw:shrink-0" />
              </template>
              <template #icon-right>
                <OButton
                  v-if="testModelName"
                  variant="ghost"
                  size="icon"
                  class="tw:opacity-[0.35] tw:hover:opacity-70"
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
        <div class="tw:w-px tw:bg-(--o2-border-color) tw:shrink-0"></div>

        <!-- ── Right: Live Results ── -->
        <div class="tw:flex-1 tw:overflow-y-auto tw:py-5 tw:pl-5 tw:pr-6">
          <transition name="tmm-fade" mode="out-in">
            <!-- Empty state -->
            <div
              v-if="!testModelName"
              key="empty"
              class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:min-h-[200px] tw:gap-[10px]"
              data-test="test-match-empty"
            >
              <OIcon name="manage-search" size="xl" class="tw:opacity-[0.12]" />
              <div class="tw:text-[13px] tw:opacity-[0.35] tw:text-center">
                {{ t("modelPricing.enterModelName") }}
              </div>
            </div>

            <!-- Typed but not yet tested -->
            <div
              v-else-if="testResult === null"
              key="waiting"
              class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:min-h-[200px] tw:gap-[10px]"
              data-test="test-match-waiting"
            >
              <OIcon name="ads-click" size="xl" class="tw:opacity-[0.12]" />
              <div class="tw:text-[13px] tw:opacity-[0.35] tw:text-center">
                {{ t("modelPricing.clickToTest") }}
              </div>
            </div>

            <!-- No Match -->
            <div
              v-else-if="!testResult?.matched"
              key="no-match"
              class="tw:flex tw:flex-col tw:gap-3"
              data-test="test-match-no-result"
            >
              <div class="tmm-status-card--error tw:flex tw:items-center tw:gap-3 tw:py-3 tw:px-[14px] tw:rounded-lg tw:border tw:bg-[rgba(239,68,68,0.04)] tw:border-[rgba(239,68,68,0.15)]">
                <div class="tmm-status-icon-wrap--error tw:w-8 tw:h-8 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:bg-[rgba(239,68,68,0.1)] tw:text-[#dc2626]">
                  <OIcon name="error-outline" size="md" />
                </div>
                <div>
                  <div class="tmm-status-title tw:text-[13px] tw:font-bold">
                    {{ t("modelPricing.noMatchFound") }}
                  </div>
                  <div class="tw:text-xs tw:mt-0.5 tw:opacity-70">
                    {{
                      t("modelPricing.noMatchDesc", {
                        modelName: testModelName,
                      })
                    }}
                  </div>
                </div>
              </div>
              <div class="tw:py-3 tw:px-[14px] tw:rounded-lg tw:bg-[rgba(0,0,0,0.02)] tw:dark:bg-[rgba(255,255,255,0.02)] tw:border tw:border-(--o2-border-color)">
                <div class="tw:text-[11px] tw:font-semibold tw:opacity-55 tw:mb-[6px]">
                  {{ t("modelPricing.troubleshootingTitle") }}
                </div>
                <ul class="tw:m-0 tw:pl-4 tw:text-xs tw:leading-[1.9] tw:opacity-60">
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
              class="tw:flex tw:flex-col tw:gap-3"
              data-test="test-match-result"
            >
              <!-- Match status -->
              <div class="tmm-status-card--success tw:flex tw:items-center tw:gap-3 tw:py-3 tw:px-[14px] tw:rounded-lg tw:border tw:bg-[rgba(22,163,74,0.05)] tw:border-[rgba(22,163,74,0.2)]">
                <div class="tmm-status-icon-wrap--success tw:w-8 tw:h-8 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:bg-[rgba(22,163,74,0.12)] tw:text-[#16a34a]">
                  <OIcon name="check-circle" size="md" />
                </div>
                <div class="tw:flex-1 tw:min-w-0">
                  <div class="tmm-status-title tw:text-[13px] tw:font-bold">
                    {{ t("modelPricing.matchFound") }}
                  </div>
                  <div class="tw:text-xs tw:mt-0.5 tw:opacity-70 tw:truncate">
                    <code class="tw:inline tw:py-px tw:px-[6px] tw:rounded tw:text-xs tw:font-semibold tw:font-[SF_Mono,JetBrains_Mono,monospace] tw:bg-[rgba(22,163,74,0.08)] tw:border tw:border-[rgba(22,163,74,0.2)] tw:text-inherit">{{
                      testResult.matched.name
                    }}</code>
                  </div>
                </div>
                <OBadge
                  :variant="sourceColor(testResult.matched)"
                  class="tw:shrink-0 tw:text-[11px] tw:font-semibold tw:ml-auto"
                >
                  {{ sourceLabel(testResult.matched) }}
                </OBadge>
              </div>

              <!-- Priority flow -->
              <div class="tw:py-3 tw:px-[14px] tw:border tw:border-(--o2-border-color) tw:rounded-lg tw:bg-[rgba(0,0,0,0.015)] tw:dark:bg-[rgba(255,255,255,0.02)]">
                <div class="tw:text-[10px] tw:font-semibold tw:opacity-40 tw:mb-2">
                  {{ t("modelPricing.matchPriority") }}
                </div>
                <div class="tw:flex tw:items-center tw:gap-[6px] tw:flex-wrap">
                  <template
                    v-for="(step, sIdx) in matchFlowSteps"
                    :key="step.key"
                  >
                    <div class="tw:opacity-30" v-if="sIdx > 0">
                      <OIcon name="arrow-forward" size="xs" />
                    </div>
                    <div
                      class="tw:flex tw:items-center tw:gap-[5px] tw:py-[5px] tw:px-[10px] tw:rounded-md tw:border tw:border-(--o2-border-color) tw:text-[11px] tw:font-medium tw:bg-transparent"
                      :class="{
                        'tmm-flow-step--winner tw:border-[#16a34a] tw:bg-[rgba(22,163,74,0.06)] tw:font-bold': step.key === winnerSource,
                        'tw:opacity-40': step.key !== winnerSource,
                      }"
                    >
                      <OIcon
                        :name="step.icon"
                        size="sm"
                        class="tw:opacity-60"
                      />
                      <span>{{ step.label }}</span>
                      <OIcon
                        v-if="step.key === winnerSource"
                        name="check-circle"
                        size="xs"
                        class="tw:text-[#16a34a]"
                      />
                    </div>
                  </template>
                </div>
              </div>

              <!-- Tier + cost card -->
              <div class="tw:border tw:border-(--o2-border-color) tw:rounded-lg tw:overflow-hidden">
                <div class="tw:py-3 tw:px-[14px] tw:bg-[rgba(0,0,0,0.02)] tw:dark:bg-[rgba(255,255,255,0.03)] tw:border-b tw:border-(--o2-border-color)">
                  <div>
                    <div class="tw:text-[13px] tw:font-bold">
                      {{ testResult.tier || "Default" }}
                    </div>
                    <div
                      class="tw:text-[11px] tw:opacity-50 tw:mt-0.5"
                      v-if="matchedTierDef?.condition"
                    >
                      Condition:
                      <code class="tmm-cost-tier-desc-code tw:py-px tw:px-1 tw:rounded-[3px] tw:bg-[rgba(0,0,0,0.05)] tw:dark:bg-[rgba(255,255,255,0.08)] tw:text-[11px]"
                        >{{ matchedTierDef.condition.usage_key }}
                        {{ operatorSymbol(matchedTierDef.condition.operator) }}
                        {{ matchedTierDef.condition.value }}</code
                      >
                    </div>
                    <div class="tw:text-[11px] tw:opacity-50 tw:mt-0.5" v-else>
                      {{ t("modelPricing.defaultPricingTier") }}
                    </div>
                  </div>
                </div>

                <div class="tw:text-xs" v-if="pricingRows.length > 0">
                  <div class="tw:grid tw:gap-2 tw:py-[7px] tw:px-[14px] tw:border-b tw:border-(--o2-border-color) tw:bg-[rgba(0,0,0,0.015)] tw:dark:bg-[rgba(255,255,255,0.02)] tw:[grid-template-columns:1.5fr_1fr]">
                    <span class="tw:text-[10px] tw:font-semibold tw:opacity-40">{{ t("modelPricing.usageType") }}</span>
                    <span class="tw:text-[10px] tw:font-semibold tw:opacity-40 tw:text-right">{{
                      t("modelPricing.pricePerMTokens")
                    }}</span>
                  </div>
                  <div
                    v-for="row in pricingRows"
                    :key="row.key"
                    class="tmm-cost-table-row tw:grid tw:gap-2 tw:py-2 tw:px-[14px] tw:text-xs tw:border-b tw:border-[rgba(0,0,0,0.04)] tw:dark:border-[rgba(255,255,255,0.04)] tw:hover:bg-[rgba(0,0,0,0.015)] tw:dark:hover:bg-[rgba(255,255,255,0.02)] tw:[grid-template-columns:1.5fr_1fr]"
                  >
                    <span class="tw:font-semibold tw:font-[SF_Mono,JetBrains_Mono,monospace] tw:text-[11px]">{{ row.key }}</span>
                    <span class="tw:font-semibold tw:[font-variant-numeric:tabular-nums] tw:text-right"
                      >${{ formatRate(row.rate) }}</span
                    >
                  </div>
                </div>
                <div v-else class="tw:flex tw:items-center tw:gap-[7px] tw:p-[14px] tw:text-xs tw:opacity-40 tw:italic">
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
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
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

const matchFlowSteps = [
  { key: "org", label: "your org", icon: "person" },
  { key: "meta_org", label: "global", icon: "corporate-fare" },
  { key: "built_in", label: "built-in", icon: "auto-awesome" },
];

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

function sourceColor(model: any): BadgeVariant {
  if (!model.source || model.source === "org") return "primary";
  if (model.source === "meta_org") return "default-outline";
  return "default";
}
function sourceLabel(model: any) {
  if (!model.source || model.source === "org") return "Your Org";
  if (model.source === "meta_org") return "Global";
  return "Built-in";
}

function formatRate(rate: number) {
  if (rate === 0) return "0.00";
  if (rate < 0.01) return rate.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return rate.toFixed(2);
}
</script>

<style>
/* ── Status card dark mode variants ── */
.body--dark .tmm-status-card--success {
  background: rgba(22, 163, 74, 0.08);
  border-color: rgba(22, 163, 74, 0.25);
}

.body--dark .tmm-status-card--error {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.2);
}

/* ── Status title color by card variant (child selector) ── */
.tmm-status-card--success .tmm-status-title {
  color: #15803d;
}

.body--dark .tmm-status-card--success .tmm-status-title {
  color: #4ade80;
}

.tmm-status-card--error .tmm-status-title {
  color: #b91c1c;
}

.body--dark .tmm-status-card--error .tmm-status-title {
  color: #fca5a5;
}

/* ── Winner flow step dark mode ── */
.body--dark .tmm-flow-step--winner {
  background: rgba(22, 163, 74, 0.1);
}

/* ── Last cost table row ── */
.tmm-cost-table-row:last-child {
  border-bottom: none;
}

/* ── Transition animations ── */
.tmm-fade-enter-active,
.tmm-fade-leave-active {
  transition: all 0.18s ease;
}

.tmm-fade-enter-from {
  opacity: 0;
  transform: translateY(5px);
}

.tmm-fade-leave-to {
  opacity: 0;
}
</style>
