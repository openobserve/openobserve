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
    <div class="flex flex-1 overflow-hidden min-h-0" style="height: 100%">
        <!-- ── Left: Inputs ── -->
        <div class="w-[340px] shrink-0 overflow-y-auto py-5 pr-5 pl-6 flex flex-col gap-5">
          <!-- Model Name -->
          <div class="flex flex-col gap-[6px]">
            <label class="text-[13px] font-semibold text-(--color-text-primary)"
              >{{ t("modelPricing.modelNameInput") }}
              <span class="text-[#ef4444]">*</span></label
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
        <div class="w-px bg-(--o2-border-color) shrink-0"></div>

        <!-- ── Right: Live Results ── -->
        <div class="flex-1 overflow-y-auto py-5 pl-5 pr-6">
          <transition name="tmm-fade" mode="out-in">
            <!-- Empty state -->
            <div
              v-if="!testModelName"
              key="empty"
              class="flex flex-col items-center justify-center h-full min-h-[200px] gap-[10px]"
              data-test="test-match-empty"
            >
              <OIcon name="manage-search" size="xl" class="opacity-[0.12]" />
              <div class="text-[13px] opacity-[0.35] text-center">
                {{ t("modelPricing.enterModelName") }}
              </div>
            </div>

            <!-- Typed but not yet tested -->
            <div
              v-else-if="testResult === null"
              key="waiting"
              class="flex flex-col items-center justify-center h-full min-h-[200px] gap-[10px]"
              data-test="test-match-waiting"
            >
              <OIcon name="ads-click" size="xl" class="opacity-[0.12]" />
              <div class="text-[13px] opacity-[0.35] text-center">
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
              <div class="flex items-center gap-3 py-3 px-[14px] rounded-lg border bg-[rgba(239,68,68,0.04)] border-[rgba(239,68,68,0.15)] dark:bg-[rgba(239,68,68,0.08)] dark:border-[rgba(239,68,68,0.2)]">
                <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[rgba(239,68,68,0.1)] text-[#dc2626]">
                  <OIcon name="error-outline" size="md" />
                </div>
                <div>
                  <div class="text-[13px] font-bold text-[#b91c1c] dark:text-[#fca5a5]">
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
              <div class="py-3 px-[14px] rounded-lg bg-[rgba(0,0,0,0.02)] dark:bg-[rgba(255,255,255,0.02)] border border-(--o2-border-color)">
                <div class="text-[11px] font-semibold opacity-55 mb-[6px]">
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
              <div class="flex items-center gap-3 py-3 px-[14px] rounded-lg border bg-[rgba(22,163,74,0.05)] border-[rgba(22,163,74,0.2)] dark:bg-[rgba(22,163,74,0.08)] dark:border-[rgba(22,163,74,0.25)]">
                <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[rgba(22,163,74,0.12)] text-[#16a34a]">
                  <OIcon name="check-circle" size="md" />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-[13px] font-bold text-[#15803d] dark:text-[#4ade80]">
                    {{ t("modelPricing.matchFound") }}
                  </div>
                  <div class="text-xs mt-0.5 opacity-70 truncate">
                    <code class="inline py-px px-[6px] rounded text-xs font-semibold font-[SF_Mono,JetBrains_Mono,monospace] bg-[rgba(22,163,74,0.08)] border border-[rgba(22,163,74,0.2)] text-inherit">{{
                      testResult.matched.name
                    }}</code>
                  </div>
                </div>
                <OTag
                  type="modelSource"
                  :value="testResult.matched.source || 'org'"
                  class="shrink-0 text-[11px] font-semibold ml-auto"
                >
                  {{ sourceLabel(testResult.matched) }}
                </OTag>
              </div>

              <!-- Priority flow -->
              <div class="py-3 px-[14px] border border-(--o2-border-color) rounded-lg bg-[rgba(0,0,0,0.015)] dark:bg-[rgba(255,255,255,0.02)]">
                <div class="text-[10px] font-semibold opacity-40 mb-2">
                  {{ t("modelPricing.matchPriority") }}
                </div>
                <div class="flex items-center gap-[6px] flex-wrap">
                  <template
                    v-for="(step, sIdx) in matchFlowSteps"
                    :key="step.key"
                  >
                    <div class="opacity-30" v-if="sIdx > 0">
                      <OIcon name="arrow-forward" size="xs" />
                    </div>
                    <div
                      class="flex items-center gap-[5px] py-[5px] px-[10px] rounded-md border border-(--o2-border-color) text-[11px] font-medium bg-transparent"
                      :class="{
                        'border-[#16a34a] bg-[rgba(22,163,74,0.06)] font-bold dark:bg-[rgba(22,163,74,0.1)]': step.key === winnerSource,
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
                        class="text-[#16a34a]"
                      />
                    </div>
                  </template>
                </div>
              </div>

              <!-- Tier + cost card -->
              <div class="border border-(--o2-border-color) rounded-lg overflow-hidden">
                <div class="py-3 px-[14px] bg-[rgba(0,0,0,0.02)] dark:bg-[rgba(255,255,255,0.03)] border-b border-(--o2-border-color)">
                  <div>
                    <div class="text-[13px] font-bold">
                      {{ testResult.tier || t("settings.testModelMatchDialog.defaultTier") }}
                    </div>
                    <div
                      class="text-[11px] opacity-50 mt-0.5"
                      v-if="matchedTierDef?.condition"
                    >
                      {{ t("settings.testModelMatchDialog.condition") }}
                      <code class="tmm-cost-tier-desc-code py-px px-1 rounded-[3px] bg-[rgba(0,0,0,0.05)] dark:bg-[rgba(255,255,255,0.08)] text-[11px]"
                        >{{ matchedTierDef.condition.usage_key }}
                        {{ operatorSymbol(matchedTierDef.condition.operator) }}
                        {{ matchedTierDef.condition.value }}</code
                      >
                    </div>
                    <div class="text-[11px] opacity-50 mt-0.5" v-else>
                      {{ t("modelPricing.defaultPricingTier") }}
                    </div>
                  </div>
                </div>

                <div class="text-xs" v-if="pricingRows.length > 0">
                  <div class="grid gap-2 py-[7px] px-[14px] border-b border-(--o2-border-color) bg-[rgba(0,0,0,0.015)] dark:bg-[rgba(255,255,255,0.02)] [grid-template-columns:1.5fr_1fr]">
                    <span class="text-[10px] font-semibold opacity-40">{{ t("modelPricing.usageType") }}</span>
                    <span class="text-[10px] font-semibold opacity-40 text-right">{{
                      t("modelPricing.pricePerMTokens")
                    }}</span>
                  </div>
                  <div
                    v-for="row in pricingRows"
                    :key="row.key"
                    class="tmm-cost-table-row grid gap-2 py-2 px-[14px] text-xs border-b border-[rgba(0,0,0,0.04)] dark:border-[rgba(255,255,255,0.04)] hover:bg-[rgba(0,0,0,0.015)] dark:hover:bg-[rgba(255,255,255,0.02)] [grid-template-columns:1.5fr_1fr]"
                  >
                    <span class="font-semibold font-[SF_Mono,JetBrains_Mono,monospace] text-[11px]">{{ row.key }}</span>
                    <span class="font-semibold [font-variant-numeric:tabular-nums] text-right"
                      >${{ formatRate(row.rate) }}</span
                    >
                  </div>
                </div>
                <div v-else class="flex items-center gap-[7px] p-[14px] text-xs opacity-40 italic">
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

<style>
/* :last-child pseudo selector — kept in <style> per project rules */
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
