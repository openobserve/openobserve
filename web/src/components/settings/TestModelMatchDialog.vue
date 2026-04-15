<template>
  <q-dialog v-model="internalValue" persistent>
    <q-card class="test-match-card" data-test="test-model-match-dialog">
      <!-- Header -->
      <div class="tmm-header">
         <div>
           <div class="tmm-title">Test Model Match</div>
           <div class="tmm-subtitle">Simulate how your ingestion data would match against pricing rules.</div>
         </div>
         <q-btn icon="close" flat round dense v-close-popup class="tmm-close-btn" />
      </div>

      <!-- Body (scrollable) -->
      <div class="tmm-body">

        <!-- ── Model Name Input (search-bar style) ── -->
        <div class="tmm-section">
          <label class="tmm-label">Model Name <span class="tmm-required">*</span></label>
          <div class="tmm-search-bar" :class="{ 'tmm-search-bar--focus': isModelInputFocused }">
            <q-icon name="smart_toy" size="20px" class="tmm-search-icon" />
            <input
              ref="modelInputRef"
              v-model="testModelName"
              class="tmm-search-input"
              placeholder="e.g. gpt-4o, claude-sonnet-4, gemini-2.5-pro"
              spellcheck="false"
              autocomplete="off"
              @focus="isModelInputFocused = true"
              @blur="isModelInputFocused = false"
              data-test="test-match-model-input"
            />
            <q-btn
              v-if="testModelName"
              icon="close"
              flat round dense size="sm"
              class="tmm-clear-btn"
              @click="clearAndFocus"
              data-test="test-match-clear-btn"
            />
          </div>
        </div>

        <!-- ── Usage Details (collapsible) ── -->
        <div class="tmm-section">
          <button
            class="tmm-collapse-trigger"
            @click="showUsageDetails = !showUsageDetails"
            data-test="test-match-usage-toggle"
          >
            <div class="tw:flex tw:items-center tw:gap-2">
              <q-icon
                name="expand_more"
                size="18px"
                class="tmm-collapse-icon"
                :class="{ 'tmm-collapse-icon--open': showUsageDetails }"
              />
              <span class="tmm-label tw:mb-0">Usage Details</span>
              <span class="tmm-optional-badge">optional</span>
            </div>
            <span class="tmm-usage-summary" v-if="!showUsageDetails && usageDetails.some(u => u.key)">
              {{ usageDetails.filter(u => u.key).map(u => `${u.key}: ${u.value}`).join(', ') }}
            </span>
          </button>

          <transition name="tmm-slide">
            <div v-show="showUsageDetails" class="tmm-usage-panel">
              <div class="tmm-usage-hint">
                Add token usage to test pricing tier conditions and calculate estimated cost.
              </div>

              <!-- Prefill templates -->
              <div class="tmm-templates">
                <span class="tmm-templates-label">Quick fill:</span>
                <button
                  v-for="tpl in templates"
                  :key="tpl.name"
                  class="tmm-template-chip"
                  :class="{ 'tmm-template-chip--active': isTemplateActive(tpl) }"
                  :style="{ '--tpl-color': tpl.color }"
                  @click="prefill(tpl)"
                >
                  <span class="tmm-template-dot"></span>
                  {{ tpl.name }}
                </button>
              </div>

              <!-- Usage key-value rows -->
              <div class="tmm-usage-table">
                <div class="tmm-usage-head">
                  <span>Usage Type</span>
                  <span>Token Count</span>
                  <span></span>
                </div>
                <transition-group name="tmm-row" tag="div">
                  <div v-for="(usage, idx) in usageDetails" :key="idx" class="tmm-usage-row">
                    <q-input
                      v-model="usage.key"
                      dense outlined
                      bg-color="white"
                      class="tmm-usage-input"
                      placeholder="e.g. input"
                      :data-test="`test-match-usage-key-${idx}`"
                    />
                    <q-input
                      v-model.number="usage.value"
                      type="number"
                      dense outlined
                      bg-color="white"
                      class="tmm-usage-input"
                      placeholder="0"
                      :data-test="`test-match-usage-val-${idx}`"
                    />
                    <q-btn
                      icon="delete_outline"
                      flat round dense size="sm"
                      color="negative"
                      @click="removeUsage(idx)"
                      :data-test="`test-match-usage-del-${idx}`"
                    />
                  </div>
                </transition-group>
                <button class="tmm-add-usage-btn" @click="addUsage" data-test="test-match-add-usage">
                  <q-icon name="add" size="16px" />
                  Add Usage Type
                </button>
              </div>
            </div>
          </transition>
        </div>

        <!-- ── Divider ── -->
        <div class="tmm-divider" v-if="testModelName"></div>

        <!-- ── Results Area ── -->
        <transition name="tmm-fade" mode="out-in">
          <!-- Empty state -->
          <div v-if="!testModelName" key="empty" class="tmm-empty-state" data-test="test-match-empty">
            <q-icon name="search" size="40px" class="tmm-empty-icon" />
            <div class="tmm-empty-text">Enter a model name above to test matching</div>
          </div>

          <!-- No Match -->
          <div v-else-if="!matchedModel" key="no-match" class="tmm-result-area" data-test="test-match-no-result">
            <div class="tmm-status-card tmm-status-card--error">
              <div class="tmm-status-icon-wrap tmm-status-icon-wrap--error">
                <q-icon name="error_outline" size="24px" />
              </div>
              <div>
                <div class="tmm-status-title">No Match Found</div>
                <div class="tmm-status-desc">
                  No model configuration matches "<strong>{{ testModelName }}</strong>" across {{ models.filter((m: any) => m.enabled !== false).length }} enabled rules.
                </div>
              </div>
            </div>

            <div class="tmm-suggestions">
              <div class="tmm-suggestions-title">Troubleshooting tips:</div>
              <ul class="tmm-suggestions-list">
                <li>Check the spelling of your model name</li>
                <li>Verify models with matching regex patterns exist and are <strong>enabled</strong></li>
                <li>Create a new model pricing rule from the main list</li>
              </ul>
            </div>
          </div>

          <!-- Match Found -->
          <div v-else key="match" class="tmm-result-area" data-test="test-match-result">

            <!-- Status card -->
            <div class="tmm-status-card tmm-status-card--success">
              <div class="tmm-status-icon-wrap tmm-status-icon-wrap--success">
                <q-icon name="check_circle" size="24px" />
              </div>
              <div class="tw:flex-1">
                <div class="tmm-status-title">Match Found</div>
                <div class="tmm-status-desc">
                  Evaluated against <code class="tmm-model-badge">{{ matchedModel.name }}</code>
                </div>
              </div>
            </div>

            <!-- Match Flow (priority visualization) -->
            <div class="tmm-flow">
              <div class="tmm-flow-title">Match Priority Flow</div>
              <div class="tmm-flow-steps">
                <template v-for="(step, sIdx) in matchFlowSteps" :key="step.key">
                  <div class="tmm-flow-arrow" v-if="sIdx > 0">
                    <q-icon name="arrow_forward" size="14px" color="grey-5" />
                  </div>
                  <div
                    class="tmm-flow-step"
                    :class="{
                      'tmm-flow-step--winner': step.key === winnerSource,
                      'tmm-flow-step--dimmed': step.key !== winnerSource
                    }"
                  >
                    <div class="tmm-flow-step-icon">
                      <q-icon :name="step.icon" size="16px" />
                    </div>
                    <span class="tmm-flow-step-label">{{ step.label }}</span>
                    <span class="tmm-flow-step-count">{{ step.count }}</span>
                    <q-icon
                      v-if="step.key === winnerSource"
                      name="check_circle"
                      size="14px"
                      class="tmm-flow-step-check"
                    />
                  </div>
                </template>
              </div>
            </div>

            <!-- Tier info + Cost breakdown -->
            <div class="tmm-cost-card">
              <div class="tmm-cost-header">
                <div>
                  <div class="tmm-cost-tier-name">{{ matchedTier.name || 'Default' }}</div>
                  <div class="tmm-cost-tier-desc" v-if="matchedTier.condition">
                    Condition: <code>{{ matchedTier.condition.usage_key }} {{ operatorSymbol(matchedTier.condition.operator) }} {{ matchedTier.condition.value }}</code>
                  </div>
                  <div class="tmm-cost-tier-desc" v-else>Default pricing tier (no conditions)</div>
                </div>
                <q-badge :color="sourceColor(matchedModel)" text-color="white" :label="sourceLabel(matchedModel)" class="tmm-source-badge" />
              </div>

              <!-- Cost table -->
              <div class="tmm-cost-table" v-if="costCalculations.length > 0">
                <div class="tmm-cost-table-head">
                  <span>Usage Type</span>
                  <span>Tokens</span>
                  <span>Rate (per 1M)</span>
                  <span class="tw:text-right">Cost</span>
                </div>
                <div v-for="calc in costCalculations" :key="calc.key" class="tmm-cost-table-row">
                  <span class="tmm-cost-usage-key">{{ calc.key }}</span>
                  <span class="tmm-cost-tokens">{{ formatNumber(calc.tokens) }}</span>
                  <span class="tmm-cost-rate">${{ formatRate(calc.rate) }}</span>
                  <span class="tmm-cost-value tw:text-right">${{ formatCost(calc.cost) }}</span>
                </div>
              </div>
              <div v-else class="tmm-cost-empty">
                <q-icon name="info_outline" size="16px" />
                No usage keys match the model's defined prices. Add usage details above to calculate cost.
              </div>

              <!-- Total -->
              <div class="tmm-cost-total" v-if="costCalculations.length > 0">
                <span>Total Estimated Cost</span>
                <span class="tmm-cost-total-value">${{ formatCost(totalCost) }}</span>
              </div>
            </div>

          </div>
        </transition>

      </div>

      <!-- Footer -->
      <div class="tmm-footer">
        <q-btn
          v-if="testModelName"
          label="Reset"
          flat no-caps
          icon="refresh"
          class="tmm-reset-btn"
          @click="resetForm"
          data-test="test-match-reset-btn"
        />
        <div class="tw:flex-1"></div>
        <q-btn label="Close" flat no-caps v-close-popup class="tmm-close-footer-btn" data-test="test-match-close-btn" />
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  models: { type: Array, default: () => [] },
});
const emit = defineEmits(['update:modelValue']);

const internalValue = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

const testModelName = ref('');
const isModelInputFocused = ref(false);
const showUsageDetails = ref(false);
const modelInputRef = ref<HTMLInputElement | null>(null);

const usageDetails = ref([
  { key: 'input', value: 1000 },
  { key: 'output', value: 500 }
]);

const templates = [
  {
    name: 'OpenAI',
    color: '#10a37f',
    keys: ['input', 'output', 'cache_read_input_tokens']
  },
  {
    name: 'Anthropic',
    color: '#d97706',
    keys: ['input', 'output', 'cache_creation_input_tokens', 'cache_read_input_tokens']
  },
];

function isTemplateActive(tpl: typeof templates[0]) {
  const currentKeys = usageDetails.value.filter(u => u.key).map(u => u.key);
  return tpl.keys.every(k => currentKeys.includes(k)) && currentKeys.length === tpl.keys.length;
}

function prefill(tpl: typeof templates[0]) {
  usageDetails.value = tpl.keys.map(key => {
    const existing = usageDetails.value.find(u => u.key === key);
    return { key, value: existing?.value ?? (key === 'input' ? 1000 : key === 'output' ? 500 : 0) };
  });
}

function addUsage() {
  usageDetails.value.push({ key: '', value: 0 });
}
function removeUsage(idx: number) {
  usageDetails.value.splice(idx, 1);
}

function clearAndFocus() {
  testModelName.value = '';
  nextTick(() => modelInputRef.value?.focus());
}

function resetForm() {
  testModelName.value = '';
  usageDetails.value = [
    { key: 'input', value: 1000 },
    { key: 'output', value: 500 }
  ];
  showUsageDetails.value = false;
  nextTick(() => modelInputRef.value?.focus());
}

// Auto-focus on open
watch(internalValue, (val) => {
  if (val) {
    nextTick(() => {
      setTimeout(() => modelInputRef.value?.focus(), 100);
    });
  }
});

function stripInlineFlags(pattern: string): string {
  return pattern ? pattern.replace(/\(\?[imsxu]+\)/g, "") : "";
}

const matchedModel = computed(() => {
  if (!testModelName.value) return null;
  const nameToTest = testModelName.value;

  function srcPri(m: any) {
    if (!m.source || m.source === 'org') return 1;
    if (m.source === 'meta_org') return 2;
    return 3;
  }

  const enabledModels = [...props.models].filter((m: any) => m.enabled !== false);
  enabledModels.sort((a: any, b: any) => {
     const sA = srcPri(a);
     const sB = srcPri(b);
     if (sA !== sB) return sA - sB;
     const oA = a.sort_order ?? 0;
     const oB = b.sort_order ?? 0;
     if (oA !== oB) return oA - oB;
     return (a.name || '').localeCompare(b.name || '');
  });

  for (const model of enabledModels) {
    try {
      const regexStr = stripInlineFlags(model.match_pattern || '');
      const rgx = new RegExp(regexStr);
      if (rgx.test(nameToTest)) {
         return model;
      }
    } catch {
       // skip if invalid regex on js side
    }
  }
  return null;
});

const winnerSource = computed(() => {
  if (!matchedModel.value) return null;
  return matchedModel.value.source || 'org';
});

const matchFlowSteps = computed(() => {
  const enabledModels = (props.models as any[]).filter((m: any) => m.enabled !== false);
  return [
    {
      key: 'org',
      label: 'Your Org',
      icon: 'person',
      count: enabledModels.filter((m: any) => (!m.source || m.source === 'org')).length
    },
    {
      key: 'meta_org',
      label: 'Meta Org',
      icon: 'corporate_fare',
      count: enabledModels.filter((m: any) => m.source === 'meta_org').length
    },
    {
      key: 'built_in',
      label: 'Built-in',
      icon: 'auto_awesome',
      count: enabledModels.filter((m: any) => m.source === 'built_in').length
    },
  ];
});

const matchedTier = computed(() => {
   if (!matchedModel.value || !matchedModel.value.tiers || matchedModel.value.tiers.length === 0) return { name: 'Default', prices: {} };
   const tiers = matchedModel.value.tiers;
   for (let i = 1; i < tiers.length; i++) {
      const tier = tiers[i];
      if (tier.condition) {
         const { usage_key, operator, value } = tier.condition;
         const provided = usageDetails.value.find(u => u.key === usage_key);
         if (provided) {
            const v = provided.value;
            const threshold = value;
            let satisfied = false;
            switch(operator) {
               case 'gt': satisfied = v > threshold; break;
               case 'gte': satisfied = v >= threshold; break;
               case 'lt': satisfied = v < threshold; break;
               case 'lte': satisfied = v <= threshold; break;
               case 'eq': satisfied = v === threshold; break;
               case 'neq': satisfied = v !== threshold; break;
            }
            if (satisfied) return tier;
         }
      }
   }
   return tiers[0];
});

const costCalculations = computed(() => {
   if (!matchedTier.value) return [];
   const prices = matchedTier.value.prices || {};
   const results: any[] = [];
   for (const usage of usageDetails.value) {
      if (usage.key && prices[usage.key] !== undefined) {
         const ratePerToken = prices[usage.key] || 0;
         const ratePerMillion = ratePerToken * 1_000_000;
         const cost = usage.value * ratePerToken;
         results.push({ key: usage.key, tokens: usage.value, rate: ratePerMillion, cost });
      }
   }
   return results;
});

const totalCost = computed(() => {
   return costCalculations.value.reduce((acc: number, curr: any) => acc + curr.cost, 0);
});

function operatorSymbol(op: string) {
  const map: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', neq: '≠' };
  return map[op] || op;
}

function sourceColor(model: any) {
  if (!model.source || model.source === 'org') return 'primary';
  if (model.source === 'meta_org') return 'secondary';
  return 'grey-8';
}
function sourceLabel(model: any) {
  if (!model.source || model.source === 'org') return 'Your Org';
  if (model.source === 'meta_org') return 'Meta Org';
  return 'Built-in';
}

function formatCost(cost: number) {
   if (cost === 0) return "0.0000";
   if (cost < 0.0001) return cost.toExponential(4);
   return cost.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.00');
}

function formatRate(rate: number) {
  if (rate === 0) return "0.00";
  if (rate < 0.01) return rate.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return rate.toFixed(2);
}

function formatNumber(n: number) {
  return n.toLocaleString();
}
</script>

<style lang="scss" scoped>

/* ── Card Shell ─────────────────────────────────────── */
.test-match-card {
  width: 640px;
  max-width: 95vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  overflow: hidden;
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.15),
    0 0 0 1px rgba(0, 0, 0, 0.05);

  .body--dark & {
    box-shadow:
      0 25px 50px -12px rgba(0, 0, 0, 0.5),
      0 0 0 1px rgba(255, 255, 255, 0.08);
  }
}

/* ── Header ─────────────────────────────────────────── */
.tmm-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--o2-border-color);
  background: linear-gradient(135deg, rgba(89, 96, 178, 0.04) 0%, rgba(89, 96, 178, 0.01) 100%);

  .body--dark & {
    background: linear-gradient(135deg, rgba(89, 96, 178, 0.08) 0%, transparent 100%);
  }
}

.tmm-title {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.tmm-subtitle {
  font-size: 13px;
  opacity: 0.55;
  margin-top: 2px;
}

.tmm-close-btn {
  margin-top: -4px;
  margin-right: -8px;
  opacity: 0.5;
  transition: opacity 0.15s;
  &:hover { opacity: 1; }
}

/* ── Body ───────────────────────────────────────────── */
.tmm-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tmm-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tmm-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--o2-text-color, inherit);
}

.tmm-required {
  color: #ef4444;
}

/* ── Search Bar ─────────────────────────────────────── */
.tmm-search-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  height: 46px;
  border-radius: 10px;
  border: 1.5px solid var(--o2-border-color);
  background: rgba(0, 0, 0, 0.015);
  transition: all 0.2s ease;

  .body--dark & {
    background: rgba(255, 255, 255, 0.03);
  }

  &:hover {
    border-color: rgba(89, 96, 178, 0.3);
  }

  &--focus {
    border-color: #5960b2;
    box-shadow: 0 0 0 3px rgba(89, 96, 178, 0.12);
    background: white;

    .body--dark & {
      background: rgba(255, 255, 255, 0.06);
      box-shadow: 0 0 0 3px rgba(89, 96, 178, 0.2);
    }
  }
}

.tmm-search-icon {
  opacity: 0.4;
  flex-shrink: 0;
}

.tmm-search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 15px;
  font-weight: 500;
  font-family: 'SF Mono', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  color: inherit;
  letter-spacing: -0.01em;

  &::placeholder {
    color: rgba(0, 0, 0, 0.25);
    font-family: inherit;
    font-weight: 400;
  }

  .body--dark &::placeholder {
    color: rgba(255, 255, 255, 0.25);
  }
}

.tmm-clear-btn {
  opacity: 0.4;
  &:hover { opacity: 0.8; }
}

/* ── Collapsible Trigger ────────────────────────────── */
.tmm-collapse-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 0;
  border: none;
  background: none;
  cursor: pointer;
  color: inherit;
  font-size: 13px;
  gap: 8px;
}

.tmm-collapse-icon {
  transition: transform 0.25s ease;
  opacity: 0.5;
  transform: rotate(-90deg);

  &--open {
    transform: rotate(0deg);
  }
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

.tmm-usage-summary {
  font-size: 11px;
  font-family: 'SF Mono', 'JetBrains Mono', monospace;
  opacity: 0.45;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  max-width: 300px;
}

/* ── Usage Panel ────────────────────────────────────── */
.tmm-usage-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--o2-border-color);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.015);

  .body--dark & {
    background: rgba(255, 255, 255, 0.02);
  }
}

.tmm-usage-hint {
  font-size: 12px;
  opacity: 0.5;
  line-height: 1.4;
}

.tmm-templates {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tmm-templates-label {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.45;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.tmm-template-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid var(--o2-border-color);
  border-radius: 6px;
  background: white;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  color: inherit;

  .body--dark & {
    background: rgba(255, 255, 255, 0.04);
  }

  &:hover {
    border-color: var(--tpl-color);
    background: rgba(0, 0, 0, 0.02);
  }

  &--active {
    border-color: var(--tpl-color);
    background: rgba(0, 0, 0, 0.02);
    font-weight: 600;
  }
}

.tmm-template-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--tpl-color);
}

/* ── Usage Table ────────────────────────────────────── */
.tmm-usage-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tmm-usage-head {
  display: grid;
  grid-template-columns: 1fr 1fr 32px;
  gap: 8px;
  padding: 0 4px;

  span {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.45;
  }
}

.tmm-usage-row {
  display: grid;
  grid-template-columns: 1fr 1fr 32px;
  gap: 8px;
  align-items: center;
}

.tmm-usage-input {
  :deep(.q-field__control) {
    border-radius: 6px;
    height: 34px;
  }
}

.tmm-add-usage-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: #5960b2;
  align-self: flex-start;
  border-radius: 4px;
  transition: background 0.15s;

  &:hover {
    background: rgba(89, 96, 178, 0.08);
  }
}

/* ── Divider ────────────────────────────────────────── */
.tmm-divider {
  height: 1px;
  background: var(--o2-border-color);
  margin: 4px 0;
}

/* ── Empty State ────────────────────────────────────── */
.tmm-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  gap: 12px;
}

.tmm-empty-icon {
  opacity: 0.15;
}

.tmm-empty-text {
  font-size: 14px;
  opacity: 0.4;
  text-align: center;
}

/* ── Result Area ────────────────────────────────────── */
.tmm-result-area {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ── Status Card ────────────────────────────────────── */
.tmm-status-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px;
  border-radius: 10px;
  animation: tmm-slide-up 0.3s ease;
}

@keyframes tmm-slide-up {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
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
  width: 36px;
  height: 36px;
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
  font-size: 15px;
  font-weight: 700;
  line-height: 1.3;
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
  font-size: 13px;
  margin-top: 3px;
  opacity: 0.75;
  line-height: 1.5;
}

.tmm-model-badge {
  display: inline;
  padding: 2px 8px;
  border-radius: 5px;
  font-size: 13px;
  font-weight: 600;
  font-family: 'SF Mono', 'JetBrains Mono', 'Fira Code', monospace;
  background: rgba(22, 163, 74, 0.08);
  border: 1px solid rgba(22, 163, 74, 0.2);
  color: inherit;

  .body--dark & {
    background: rgba(22, 163, 74, 0.12);
    border-color: rgba(22, 163, 74, 0.25);
  }
}

/* ── Suggestions ────────────────────────────────────── */
.tmm-suggestions {
  padding: 14px 16px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.02);
  border: 1px solid var(--o2-border-color);

  .body--dark & {
    background: rgba(255, 255, 255, 0.02);
  }
}

.tmm-suggestions-title {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.6;
  margin-bottom: 8px;
}

.tmm-suggestions-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.8;
  opacity: 0.65;
}

/* ── Match Flow ─────────────────────────────────────── */
.tmm-flow {
  padding: 14px 16px;
  border: 1px solid var(--o2-border-color);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.015);
  animation: tmm-slide-up 0.3s ease 0.05s both;

  .body--dark & {
    background: rgba(255, 255, 255, 0.02);
  }
}

.tmm-flow-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.4;
  margin-bottom: 10px;
}

.tmm-flow-steps {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tmm-flow-step {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--o2-border-color);
  font-size: 12px;
  font-weight: 500;
  transition: all 0.2s ease;
  position: relative;
  background: white;

  .body--dark & {
    background: rgba(255, 255, 255, 0.04);
  }
}

.tmm-flow-step--winner {
  border-color: #16a34a;
  background: rgba(22, 163, 74, 0.06);
  font-weight: 700;
  box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.1);

  .body--dark & {
    background: rgba(22, 163, 74, 0.1);
    box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.15);
  }
}

.tmm-flow-step--dimmed {
  opacity: 0.45;
}

.tmm-flow-step-icon {
  opacity: 0.6;
}

.tmm-flow-step-count {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.06);
  font-weight: 600;
  opacity: 0.6;

  .body--dark & {
    background: rgba(255, 255, 255, 0.08);
  }
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
  border-radius: 10px;
  overflow: hidden;
  animation: tmm-slide-up 0.3s ease 0.1s both;
}

.tmm-cost-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 14px 16px;
  background: rgba(0, 0, 0, 0.02);
  border-bottom: 1px solid var(--o2-border-color);

  .body--dark & {
    background: rgba(255, 255, 255, 0.03);
  }
}

.tmm-cost-tier-name {
  font-size: 14px;
  font-weight: 700;
}

.tmm-cost-tier-desc {
  font-size: 12px;
  opacity: 0.5;
  margin-top: 2px;

  code {
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.05);
    font-size: 11px;
    font-weight: 500;

    .body--dark & {
      background: rgba(255, 255, 255, 0.08);
    }
  }
}

.tmm-source-badge {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 5px;
}

/* ── Cost Table ─────────────────────────────────────── */
.tmm-cost-table {
  padding: 0;
}

.tmm-cost-table-head {
  display: grid;
  grid-template-columns: 1.5fr 1fr 1fr 1fr;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--o2-border-color);
  background: rgba(0, 0, 0, 0.015);

  .body--dark & {
    background: rgba(255, 255, 255, 0.02);
  }

  span {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.4;
  }
}

.tmm-cost-table-row {
  display: grid;
  grid-template-columns: 1.5fr 1fr 1fr 1fr;
  gap: 8px;
  padding: 10px 16px;
  font-size: 13px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  transition: background 0.1s;

  .body--dark & {
    border-bottom-color: rgba(255, 255, 255, 0.04);
  }

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: rgba(0, 0, 0, 0.015);
    .body--dark & { background: rgba(255, 255, 255, 0.02); }
  }
}

.tmm-cost-usage-key {
  font-weight: 600;
  font-family: 'SF Mono', 'JetBrains Mono', monospace;
  font-size: 12px;
}

.tmm-cost-tokens {
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}

.tmm-cost-rate {
  font-variant-numeric: tabular-nums;
  opacity: 0.55;
  font-size: 12px;
}

.tmm-cost-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.tmm-cost-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  font-size: 13px;
  opacity: 0.45;
  font-style: italic;
}

/* ── Total row ──────────────────────────────────────── */
.tmm-cost-total {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-top: 2px solid var(--o2-border-color);
  background: rgba(0, 0, 0, 0.02);
  font-size: 14px;
  font-weight: 700;

  .body--dark & {
    background: rgba(255, 255, 255, 0.03);
  }
}

.tmm-cost-total-value {
  font-size: 18px;
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
  padding: 12px 20px;
  border-top: 1px solid var(--o2-border-color);
  gap: 8px;
}

.tmm-reset-btn {
  color: rgba(0, 0, 0, 0.5);
  font-weight: 500;
  font-size: 13px;

  .body--dark & {
    color: rgba(255, 255, 255, 0.5);
  }
}

.tmm-close-footer-btn {
  font-weight: 600;
  font-size: 13px;
}

/* ── Animations ─────────────────────────────────────── */

/* Slide transition for collapsible content */
.tmm-slide-enter-active,
.tmm-slide-leave-active {
  transition: all 0.25s ease;
  max-height: 500px;
  overflow: hidden;
}
.tmm-slide-enter-from,
.tmm-slide-leave-to {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
  margin-top: 0;
}

/* Fade transition for result states */
.tmm-fade-enter-active,
.tmm-fade-leave-active {
  transition: all 0.2s ease;
}
.tmm-fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.tmm-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* Row animation for usage details */
.tmm-row-enter-active {
  transition: all 0.2s ease;
}
.tmm-row-leave-active {
  transition: all 0.15s ease;
}
.tmm-row-enter-from,
.tmm-row-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

</style>
