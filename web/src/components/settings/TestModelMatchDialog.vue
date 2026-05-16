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
    <div class="tmm-body" style="height: 100%">
        <!-- ── Left: Inputs ── -->
        <div class="tmm-inputs-panel">
          <!-- Model Name -->
          <div class="tmm-section">
            <label class="tmm-label"
              >{{ t("modelPricing.modelNameInput") }}
              <span class="tmm-required">*</span></label
            >
            <div class="tmm-label-hint">
              {{ t("modelPricing.modelNameHint") }}
            </div>
            <q-input
              ref="modelInputRef"
              v-model="testModelName"
              dense
              borderless
              placeholder="e.g. gpt-4-turbo"
              spellcheck="false"
              autocomplete="off"
              class="tmm-model-input"
              data-test="test-match-model-input"
            >
              <template #prepend>
                <OIcon name="smart-toy" size="sm" class="tmm-search-icon" />
              </template>
              <template #append>
                <OButton
                  v-if="testModelName"
                  variant="ghost"
                  size="icon"
                  class="tmm-clear-btn"
                  @click="clearAndFocus"
                  data-test="test-match-clear-btn"
                >
                  <OIcon name="close" size="xs" />
                </OButton>
              </template>
            </q-input>
          </div>
        </div>

        <!-- ── Vertical divider ── -->
        <div class="tmm-col-divider"></div>

        <!-- ── Right: Live Results ── -->
        <div class="tmm-results-panel">
          <transition name="tmm-fade" mode="out-in">
            <!-- Empty state -->
            <div
              v-if="!testModelName"
              key="empty"
              class="tmm-empty-state"
              data-test="test-match-empty"
            >
              <OIcon name="manage-search" size="40px" class="tmm-empty-icon" />
              <div class="tmm-empty-text">
                {{ t("modelPricing.enterModelName") }}
              </div>
            </div>

            <!-- Typed but not yet tested -->
            <div
              v-else-if="testResult === null"
              key="waiting"
              class="tmm-empty-state"
              data-test="test-match-waiting"
            >
              <OIcon name="ads-click" size="40px" class="tmm-empty-icon" />
              <div class="tmm-empty-text">
                {{ t("modelPricing.clickToTest") }}
              </div>
            </div>

            <!-- No Match -->
            <div
              v-else-if="!testResult?.matched"
              key="no-match"
              class="tmm-result-area"
              data-test="test-match-no-result"
            >
              <div class="tmm-status-card tmm-status-card--error">
                <div class="tmm-status-icon-wrap tmm-status-icon-wrap--error">
                  <OIcon name="error-outline" size="22px" />
                </div>
                <div>
                  <div class="tmm-status-title">
                    {{ t("modelPricing.noMatchFound") }}
                  </div>
                  <div class="tmm-status-desc">
                    {{
                      t("modelPricing.noMatchDesc", {
                        modelName: testModelName,
                      })
                    }}
                  </div>
                </div>
              </div>
              <div class="tmm-suggestions">
                <div class="tmm-suggestions-title">
                  {{ t("modelPricing.troubleshootingTitle") }}
                </div>
                <ul class="tmm-suggestions-list">
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
              class="tmm-result-area"
              data-test="test-match-result"
            >
              <!-- Match status -->
              <div class="tmm-status-card tmm-status-card--success">
                <div class="tmm-status-icon-wrap tmm-status-icon-wrap--success">
                  <OIcon name="check-circle" size="22px" />
                </div>
                <div class="tw:flex-1 tw:min-w-0">
                  <div class="tmm-status-title">
                    {{ t("modelPricing.matchFound") }}
                  </div>
                  <div class="tmm-status-desc tw:truncate">
                    <code class="tmm-model-badge">{{
                      testResult.matched.name
                    }}</code>
                  </div>
                </div>
                <q-badge
                  :color="sourceColor(testResult.matched)"
                  text-color="white"
                  :label="sourceLabel(testResult.matched)"
                  class="tmm-source-badge"
                />
              </div>

              <!-- Priority flow -->
              <div class="tmm-flow">
                <div class="tmm-flow-title">
                  {{ t("modelPricing.matchPriority") }}
                </div>
                <div class="tmm-flow-steps">
                  <template
                    v-for="(step, sIdx) in matchFlowSteps"
                    :key="step.key"
                  >
                    <div class="tmm-flow-arrow" v-if="sIdx > 0">
                      <OIcon name="arrow-forward" size="13px" />
                    </div>
                    <div
                      class="tmm-flow-step"
                      :class="{
                        'tmm-flow-step--winner': step.key === winnerSource,
                        'tmm-flow-step--dimmed': step.key !== winnerSource,
                      }"
                    >
                      <OIcon
                        :name="step.icon"
                        size="14px"
                        class="tmm-flow-step-icon"
                      />
                      <span class="tmm-flow-step-label">{{ step.label }}</span>
                      <OIcon
                        v-if="step.key === winnerSource"
                        name="check-circle"
                        size="13px"
                        class="tmm-flow-step-check"
                      />
                    </div>
                  </template>
                </div>
              </div>

              <!-- Tier + cost card -->
              <div class="tmm-cost-card">
                <div class="tmm-cost-header">
                  <div>
                    <div class="tmm-cost-tier-name">
                      {{ testResult.tier || "Default" }}
                    </div>
                    <div
                      class="tmm-cost-tier-desc"
                      v-if="matchedTierDef?.condition"
                    >
                      Condition:
                      <code
                        >{{ matchedTierDef.condition.usage_key }}
                        {{ operatorSymbol(matchedTierDef.condition.operator) }}
                        {{ matchedTierDef.condition.value }}</code
                      >
                    </div>
                    <div class="tmm-cost-tier-desc" v-else>
                      {{ t("modelPricing.defaultPricingTier") }}
                    </div>
                  </div>
                </div>

                <div class="tmm-cost-table" v-if="pricingRows.length > 0">
                  <div class="tmm-cost-table-head">
                    <span>{{ t("modelPricing.usageType") }}</span>
                    <span class="tw:text-right">{{
                      t("modelPricing.pricePerMTokens")
                    }}</span>
                  </div>
                  <div
                    v-for="row in pricingRows"
                    :key="row.key"
                    class="tmm-cost-table-row"
                  >
                    <span class="tmm-cost-usage-key">{{ row.key }}</span>
                    <span class="tmm-cost-value tw:text-right"
                      >${{ formatRate(row.rate) }}</span
                    >
                  </div>
                </div>
                <div v-else class="tmm-cost-empty">
                  <OIcon name="info-outline" size="15px" />
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
  { key: "meta_org", label: "global", icon: "corporate_fare" },
  { key: "built_in", label: "built-in", icon: "auto_awesome" },
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

function sourceColor(model: any) {
  if (!model.source || model.source === "org") return "primary";
  if (model.source === "meta_org") return "secondary";
  return "grey-8";
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

<style lang="scss" scoped>
/* ── Header ─────────────────────────────────────────── */
.tmm-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.tmm-title {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.tmm-subtitle {
  font-size: 13px;
  opacity: 0.5;
  margin-top: 3px;
}

.tmm-close-btn {
  margin-top: -4px;
  margin-right: -8px;
  opacity: 0.45;
  transition: opacity 0.15s;
  &:hover {
    opacity: 1;
  }
}

/* ── Two-column body ────────────────────────────────── */
.tmm-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  min-height: 0;
}

.tmm-inputs-panel {
  width: 340px;
  flex-shrink: 0;
  overflow-y: auto;
  padding: 20px 20px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.tmm-col-divider {
  width: 1px;
  background: var(--o2-border-color);
  flex-shrink: 0;
}

.tmm-results-panel {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px 20px 20px;
}

/* ── Section ────────────────────────────────────────── */
.tmm-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tmm-section-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tmm-label {
  font-size: 13px;
  font-weight: 600;
}

.tmm-required {
  color: #ef4444;
}

.tmm-label-hint {
  font-size: 12px;
  opacity: 0.5;
  line-height: 1.5;
  margin-bottom: 2px;
}

.tmm-optional-badge {
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.45);

  .body--dark & {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.45);
  }
}

/* ── Search Bar ─────────────────────────────────────── */
.tmm-search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 40px;
  border-radius: 8px;
  border: 1.5px solid var(--o2-border-color);
  background: transparent;
  transition: all 0.15s ease;

  &:hover {
    border-color: rgba(89, 96, 178, 0.35);
  }

  &--focus {
    border-color: #5960b2;
    box-shadow: 0 0 0 3px rgba(89, 96, 178, 0.12);

    .body--dark & {
      box-shadow: 0 0 0 3px rgba(89, 96, 178, 0.2);
    }
  }
}

.tmm-search-icon {
  opacity: 0.35;
  flex-shrink: 0;
}

.tmm-search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  font-family: "SF Mono", "JetBrains Mono", monospace;
  color: inherit;

  &::placeholder {
    color: rgba(0, 0, 0, 0.25);
    font-family: inherit;
  }
  .body--dark &::placeholder {
    color: rgba(255, 255, 255, 0.25);
  }
}

.tmm-clear-btn {
  opacity: 0.35;
  &:hover {
    opacity: 0.7;
  }
}

/* ── Templates ──────────────────────────────────────── */
.tmm-templates {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 2px;
}

.tmm-templates-label {
  font-size: 11px;
  font-weight: 500;
  opacity: 0.5;
}

.tmm-template-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border: 1px solid var(--o2-border-color);
  border-radius: 6px;
  background: transparent;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  color: inherit;

  &:hover {
    border-color: var(--tpl-color);
  }
  &--active {
    border-color: var(--tpl-color);
    font-weight: 600;
  }
}

.tmm-template-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tpl-color);
}

/* ── Usage Table ────────────────────────────────────── */
.tmm-usage-table {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 4px;
}

.tmm-usage-head {
  display: grid;
  grid-template-columns: 1fr 1fr 32px;
  gap: 6px;
  padding: 0 2px;

  span {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0;
    opacity: 0.4;
  }
}

.tmm-usage-row {
  display: grid;
  grid-template-columns: 1fr 1fr 32px;
  gap: 6px;
  margin-bottom: 6px;
  align-items: center;
}

.tmm-usage-input {
  :deep(.q-field__control) {
    border-radius: 6px;
    height: 32px;
  }
}

.tmm-add-usage-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: #5960b2;
  align-self: flex-start;
  border-radius: 4px;
  transition: background 0.15s;
  margin-top: 2px;

  &:hover {
    background: rgba(89, 96, 178, 0.08);
  }
}

/* ── Empty State ────────────────────────────────────── */
.tmm-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 200px;
  gap: 10px;
}

.tmm-empty-icon {
  opacity: 0.12;
}

.tmm-empty-text {
  font-size: 13px;
  opacity: 0.35;
  text-align: center;
}

/* ── Result Area ────────────────────────────────────── */
.tmm-result-area {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── Status Card ────────────────────────────────────── */
.tmm-status-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 8px;
}

.tmm-status-card--success {
  background: rgba(22, 163, 74, 0.05);
  border: 1px solid rgba(22, 163, 74, 0.2);
  .body--dark & {
    background: rgba(22, 163, 74, 0.08);
    border-color: rgba(22, 163, 74, 0.25);
  }
}

.tmm-status-card--error {
  background: rgba(239, 68, 68, 0.04);
  border: 1px solid rgba(239, 68, 68, 0.15);
  .body--dark & {
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.2);
  }
}

.tmm-status-icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tmm-status-icon-wrap--success {
  background: rgba(22, 163, 74, 0.12);
  color: #16a34a;
}
.tmm-status-icon-wrap--error {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
}

.tmm-status-title {
  font-size: 13px;
  font-weight: 700;
}

.tmm-status-card--success .tmm-status-title {
  color: #15803d;
  .body--dark & {
    color: #4ade80;
  }
}
.tmm-status-card--error .tmm-status-title {
  color: #b91c1c;
  .body--dark & {
    color: #fca5a5;
  }
}

.tmm-status-desc {
  font-size: 12px;
  margin-top: 2px;
  opacity: 0.7;
}

.tmm-model-badge {
  display: inline;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  font-family: "SF Mono", "JetBrains Mono", monospace;
  background: rgba(22, 163, 74, 0.08);
  border: 1px solid rgba(22, 163, 74, 0.2);
  color: inherit;
}

.tmm-source-badge {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  margin-left: auto;
}

/* ── Suggestions ────────────────────────────────────── */
.tmm-suggestions {
  padding: 12px 14px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.02);
  border: 1px solid var(--o2-border-color);
  .body--dark & {
    background: rgba(255, 255, 255, 0.02);
  }
}

.tmm-suggestions-title {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.55;
  margin-bottom: 6px;
}

.tmm-suggestions-list {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
  line-height: 1.9;
  opacity: 0.6;
}

/* ── Match Flow ─────────────────────────────────────── */
.tmm-flow {
  padding: 12px 14px;
  border: 1px solid var(--o2-border-color);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.015);
  .body--dark & {
    background: rgba(255, 255, 255, 0.02);
  }
}

.tmm-flow-title {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0;
  opacity: 0.4;
  margin-bottom: 8px;
}

.tmm-flow-steps {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.tmm-flow-step {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--o2-border-color);
  font-size: 11px;
  font-weight: 500;
  background: transparent;
}

.tmm-flow-step--winner {
  border-color: #16a34a;
  background: rgba(22, 163, 74, 0.06);
  font-weight: 700;
  .body--dark & {
    background: rgba(22, 163, 74, 0.1);
  }
}

.tmm-flow-step--dimmed {
  opacity: 0.4;
}
.tmm-flow-step-icon {
  opacity: 0.6;
}
.tmm-flow-step-check {
  color: #16a34a;
}
.tmm-flow-arrow {
  opacity: 0.3;
}

/* ── Cost Card ──────────────────────────────────────── */
.tmm-cost-card {
  border: 1px solid var(--o2-border-color);
  border-radius: 8px;
  overflow: hidden;
}

.tmm-cost-header {
  padding: 12px 14px;
  background: rgba(0, 0, 0, 0.02);
  border-bottom: 1px solid var(--o2-border-color);
  .body--dark & {
    background: rgba(255, 255, 255, 0.03);
  }
}

.tmm-cost-tier-name {
  font-size: 13px;
  font-weight: 700;
}

.tmm-cost-tier-desc {
  font-size: 11px;
  opacity: 0.5;
  margin-top: 2px;

  code {
    padding: 1px 4px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.05);
    font-size: 11px;
    .body--dark & {
      background: rgba(255, 255, 255, 0.08);
    }
  }
}

/* ── Cost Table ─────────────────────────────────────── */
.tmm-cost-table-head {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 8px;
  padding: 7px 14px;
  border-bottom: 1px solid var(--o2-border-color);
  background: rgba(0, 0, 0, 0.015);
  .body--dark & {
    background: rgba(255, 255, 255, 0.02);
  }

  span {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0;
    opacity: 0.4;
  }
}

.tmm-cost-table-row {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 8px;
  padding: 8px 14px;
  font-size: 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  .body--dark & {
    border-bottom-color: rgba(255, 255, 255, 0.04);
  }
  &:last-child {
    border-bottom: none;
  }
  &:hover {
    background: rgba(0, 0, 0, 0.015);
    .body--dark & {
      background: rgba(255, 255, 255, 0.02);
    }
  }
}

.tmm-cost-usage-key {
  font-weight: 600;
  font-family: "SF Mono", "JetBrains Mono", monospace;
  font-size: 11px;
}

.tmm-cost-tokens {
  font-variant-numeric: tabular-nums;
  opacity: 0.65;
}
.tmm-cost-rate {
  font-variant-numeric: tabular-nums;
  opacity: 0.5;
  font-size: 11px;
}
.tmm-cost-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.tmm-cost-empty {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 14px;
  font-size: 12px;
  opacity: 0.4;
  font-style: italic;
}

/* ── Total row ──────────────────────────────────────── */
.tmm-cost-total {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-top: 1px solid var(--o2-border-color);
  background: rgba(0, 0, 0, 0.02);
  font-size: 13px;
  font-weight: 700;
  .body--dark & {
    background: rgba(255, 255, 255, 0.03);
  }
}

.tmm-cost-total-value {
  font-size: 17px;
  font-weight: 800;
  color: #16a34a;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  .body--dark & {
    color: #4ade80;
  }
}

/* ── Footer ─────────────────────────────────────────── */
.tmm-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tmm-reset-btn {
  font-size: 12px;
  opacity: 0.55;
  &:hover {
    opacity: 1;
  }
}

.tmm-close-footer-btn {
  font-weight: 600;
  font-size: 13px;
}

/* ── Animations ─────────────────────────────────────── */
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

.tmm-row-enter-active {
  transition: all 0.18s ease;
}
.tmm-row-leave-active {
  transition: all 0.12s ease;
}
.tmm-row-enter-from,
.tmm-row-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}
</style>
