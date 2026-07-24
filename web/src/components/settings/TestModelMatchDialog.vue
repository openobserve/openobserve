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
    <div class="flex h-full min-h-0 flex-1 overflow-hidden">
      <!-- ── Left: Inputs ── -->
      <div class="flex w-85 shrink-0 flex-col gap-5 overflow-y-auto py-5 pr-5 pl-6">
        <!-- Model Name -->
        <div class="flex flex-col gap-1.5">
          <label class="text-compact text-text-heading font-semibold"
            >{{ t("modelPricing.modelNameInput") }}
            <span class="text-status-error-text">*</span></label
          >
          <div class="mb-0.5 text-xs leading-normal opacity-50">
            {{ t("modelPricing.modelNameHint") }}
          </div>
          <OInput
            ref="modelInputRef"
            v-model="testModelName"
            :placeholder="t('settings.testModelMatchDialog.modelNamePlaceholder')"
            data-test="test-match-model-input"
          >
            <template #icon-left>
              <OIcon name="smart-toy" size="sm" class="shrink-0 opacity-[0.35]" />
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
      <div class="bg-card-glass-border w-px shrink-0"></div>

      <!-- ── Right: Live Results ── -->
      <div class="flex-1 overflow-y-auto py-5 pr-6 pl-5">
        <transition name="tmm-fade" mode="out-in">
          <!-- Empty state -->
          <div
            v-if="!testModelName"
            key="empty"
            class="flex h-full min-h-50 flex-col items-center justify-center gap-2.5"
            data-test="test-match-empty"
          >
            <OIcon name="manage-search" size="xl" class="opacity-[0.12]" />
            <div class="text-compact text-center opacity-[0.35]">
              {{ t("modelPricing.enterModelName") }}
            </div>
          </div>

          <!-- Typed but not yet tested -->
          <div
            v-else-if="testResult === null"
            key="waiting"
            class="flex h-full min-h-50 flex-col items-center justify-center gap-2.5"
            data-test="test-match-waiting"
          >
            <OIcon name="ads-click" size="xl" class="opacity-[0.12]" />
            <div class="text-compact text-center opacity-[0.35]">
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
            <div
              class="rounded-default bg-banner-error-soft-bg border-banner-error-soft-border flex items-center gap-3 border px-3.5 py-3"
            >
              <div
                class="rounded-default bg-status-error-bg text-status-error-text flex h-8 w-8 shrink-0 items-center justify-center"
              >
                <OIcon name="error-outline" size="md" />
              </div>
              <div>
                <div class="text-compact text-status-error-text font-bold">
                  {{ t("modelPricing.noMatchFound") }}
                </div>
                <div class="mt-0.5 text-xs opacity-70">
                  {{
                    t("modelPricing.noMatchDesc", {
                      modelName: testModelName,
                    })
                  }}
                </div>
              </div>
            </div>
            <div
              class="rounded-default bg-surface-panel border-card-glass-border border px-3.5 py-3"
            >
              <div class="text-2xs mb-1.5 font-semibold opacity-55">
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
          <div v-else key="match" class="flex flex-col gap-3" data-test="test-match-result">
            <!-- Match status -->
            <div
              class="rounded-default bg-banner-success-bg border-banner-success-border flex items-center gap-3 border px-3.5 py-3"
            >
              <div
                class="rounded-default bg-status-success-bg text-status-success-text flex h-8 w-8 shrink-0 items-center justify-center"
              >
                <OIcon name="check-circle" size="md" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-compact text-status-success-text font-bold">
                  {{ t("modelPricing.matchFound") }}
                </div>
                <div class="mt-0.5 truncate text-xs opacity-70">
                  <code
                    class="rounded-default bg-banner-success-bg border-banner-success-border inline border px-1.5 py-px font-mono text-xs font-semibold text-inherit"
                    >{{ testResult.matched.name }}</code
                  >
                </div>
              </div>
              <OTag
                type="modelSource"
                :value="testResult.matched.source || 'org'"
                class="text-2xs ml-auto shrink-0 font-semibold"
              >
                {{ sourceLabel(testResult.matched) }}
              </OTag>
            </div>

            <!-- Priority flow -->
            <div
              class="border-card-glass-border rounded-default bg-surface-panel border px-3.5 py-3"
            >
              <div class="text-3xs mb-2 font-semibold opacity-40">
                {{ t("modelPricing.matchPriority") }}
              </div>
              <div class="flex flex-wrap items-center gap-1.5">
                <template v-for="(step, sIdx) in matchFlowSteps" :key="step.key">
                  <div class="opacity-30" v-if="sIdx > 0">
                    <OIcon name="arrow-forward" size="xs" />
                  </div>
                  <div
                    class="rounded-default border-card-glass-border text-2xs flex items-center gap-1.25 border bg-transparent px-2.5 py-1.25 font-medium"
                    :class="{
                      'border-status-positive bg-banner-success-bg font-bold':
                        step.key === winnerSource,
                      'opacity-40': step.key !== winnerSource,
                    }"
                  >
                    <OIcon :name="step.icon" size="sm" class="opacity-60" />
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
            <div class="border-card-glass-border rounded-default overflow-hidden border">
              <div class="bg-surface-panel border-card-glass-border border-b px-3.5 py-3">
                <div>
                  <div class="text-compact font-bold">
                    {{ testResult.tier || t("settings.testModelMatchDialog.defaultTier") }}
                  </div>
                  <div class="text-2xs mt-0.5 opacity-50" v-if="matchedTierDef?.condition">
                    {{ t("settings.testModelMatchDialog.condition") }}
                    <code
                      class="tmm-cost-tier-desc-code rounded-default bg-surface-subtle text-2xs px-1 py-px"
                      >{{ matchedTierDef.condition.usage_key }}
                      {{ operatorSymbol(matchedTierDef.condition.operator) }}
                      {{ matchedTierDef.condition.value }}</code
                    >
                  </div>
                  <div class="text-2xs mt-0.5 opacity-50" v-else>
                    {{ t("modelPricing.defaultPricingTier") }}
                  </div>
                </div>
              </div>

              <div class="text-xs" v-if="pricingRows.length > 0">
                <div
                  class="border-card-glass-border bg-surface-panel grid grid-cols-[1.5fr_1fr] gap-2 border-b px-3.5 py-1.75"
                >
                  <span class="text-3xs font-semibold opacity-40">{{
                    t("modelPricing.usageType")
                  }}</span>
                  <span class="text-3xs text-right font-semibold opacity-40">{{
                    t("modelPricing.pricePerMTokens")
                  }}</span>
                </div>
                <div
                  v-for="row in pricingRows"
                  :key="row.key"
                  class="tmm-cost-table-row border-border-default hover:bg-hover-gray grid grid-cols-[1.5fr_1fr] gap-2 border-b px-3.5 py-2 text-xs last:border-b-0"
                >
                  <span class="text-2xs font-mono font-semibold">{{ row.key }}</span>
                  <span class="text-right font-semibold tabular-nums"
                    >${{ formatRate(row.rate) }}</span
                  >
                </div>
              </div>
              <div v-else class="flex items-center gap-1.75 p-3.5 text-xs italic opacity-40">
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
const orgIdentifier = computed(() => store.state.selectedOrganization?.identifier || "");

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
function sortedPriceEntries(prices: Record<string, number>): [string, number][] {
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
  return tiers.find((t: any) => (t.name || "Default") === result.tier) || tiers[0] || null;
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
  if (model.source === "meta_org") return t("settings.testModelMatchDialog.sourceGlobal");
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
