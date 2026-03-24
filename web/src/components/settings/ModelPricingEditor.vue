<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <q-page class="q-pa-none tw:flex tw:flex-col" style="min-height: 0; height: 100%; overflow: hidden;">

    <!-- Header -->
    <div class="tw:flex tw:items-center tw:px-5 tw:h-[68px] tw:border-b-[1px] tw:gap-3 tw:flex-shrink-0">
      <div
        data-test="model-pricing-editor-back-btn"
        class="el-border tw:w-6 tw:h-6 flex items-center justify-center cursor-pointer el-border-radius q-mr-sm"
        title="Go Back"
        @click="goBack"
      >
        <q-icon name="arrow_back_ios_new" size="14px" />
      </div>
      <div class="tw:flex tw:flex-col tw:justify-center">
        <div class="q-table__title tw:font-[600] tw:leading-tight" data-test="model-pricing-editor-title">
          {{ isEdit ? "Edit Model Pricing" : "New Model Pricing" }}
        </div>
      </div>
    </div>

    <!-- Form Body -->
    <div class="tw:px-6 tw:py-6" style="flex: 1; min-height: 0; height: calc(100vh - 170px);  overflow-y: auto;">
      <div style="max-width: 760px;" class="tw:flex tw:flex-col tw:gap-6">

        <!-- ── Model Details Card ── -->
        <div class="form-card">
          <div class="form-card-header">
            <div>
              <div class="form-card-title">Model Details</div>
              <div class="form-card-subtitle">Name this rule and define which models it matches</div>
            </div>
          </div>
          <div class="form-card-body tw:flex tw:flex-row tw:gap-4">
            <div class="tw:flex-1">
              <q-input
                v-model="model.name"
                label="Model Name *"
                placeholder="e.g. GPT-4o"
                class="showLabelOnTop"
                stack-label
                dense
                borderless
                :rules="[(val: string) => !!val?.trim() || 'Model name is required']"
                reactive-rules
                lazy-rules
                data-test="model-pricing-name-input"
              />
            </div>
            <div class="tw:flex-1 tw:flex tw:items-end tw:gap-1">
              <q-input
                v-model="model.match_pattern"
                label="Match Pattern (Regex) *"
                placeholder="e.g. gpt-4.*"
                class="showLabelOnTop tw:flex-1"
                stack-label
                dense
                borderless
                :rules="[(val: string) => !!val?.trim() || 'Match pattern is required']"
                reactive-rules
                lazy-rules
                data-test="model-pricing-pattern-input"
              />
              <q-btn
                icon="lightbulb_outline"
                padding="xs"
                flat unelevated round dense size="sm"
                class="pattern-examples-btn"
                style="margin-bottom: 24px;"
                @click="showExamples = true"
              >
                <q-tooltip anchor="top right" self="bottom right" :offset="[0, 4]">
                  See pattern examples
                </q-tooltip>
              </q-btn>

              <!-- Pattern Examples Dialog -->
              <q-dialog v-model="showExamples">
                <q-card class="pattern-examples-card">
                  <q-card-section class="tw:flex tw:items-center tw:justify-between tw:pb-0">
                    <div>
                      <div class="tw:font-semibold tw:text-sm">Match Pattern Examples</div>
                      <div class="tw:text-xs tw:opacity-50 tw:mt-0.5">Common regex patterns used for popular models</div>
                    </div>
                    <q-btn icon="cancel" flat round dense size="sm" v-close-popup />
                  </q-card-section>
                  <q-card-section class="tw:pt-3">
                    <div class="examples-table">
                      <div class="examples-table-head">
                        <span>Model</span>
                        <span>Match Pattern</span>
                      </div>
                      <div v-for="ex in patternExamples" :key="ex.name" class="examples-table-row">
                        <span class="examples-model-name">{{ ex.name }}</span>
                        <code class="examples-pattern">{{ ex.match_pattern }}</code>
                        <q-btn
                          :icon="copiedPattern === ex.match_pattern ? 'check' : 'content_copy'"
                          flat round dense size="xs"
                          :color="copiedPattern === ex.match_pattern ? 'positive' : undefined"
                          class="examples-copy-btn"
                          @click="copyPattern(ex.match_pattern)"
                        >
                          <q-tooltip :offset="[0, 4]">{{ copiedPattern === ex.match_pattern ? 'Copied!' : 'Copy pattern' }}</q-tooltip>
                        </q-btn>
                      </div>
                    </div>
                  </q-card-section>
                </q-card>
              </q-dialog>
            </div>
          </div>
        </div>

        <!-- ── Pricing Tiers ── -->
        <div class="form-card">
          <div class="form-card-header">
            <div>
              <div class="form-card-title">Pricing Tiers</div>
              <div class="form-card-subtitle">The first tier is the default. Additional tiers apply when usage conditions are met.</div>
            </div>
          </div>

          <div class="form-card-body tw:flex tw:flex-col tw:gap-3">
            <div
              v-for="(tier, idx) in model.tiers"
              :key="(idx as number)"
              class="tier-card"
            >
              <!-- Tier Header -->
              <div class="tier-header">
                <div class="tw:flex tw:items-center tw:gap-2">
                  <span class="tier-name-label">Tier Name</span>
                  <q-input
                    v-model="tier.name"
                    placeholder="e.g. Default"
                    dense borderless
                  />
                </div>
                <div class="tw:flex tw:items-center tw:gap-2 tw:flex-shrink-0">
                  <q-btn
                    v-if="model.tiers.length > 1"
                    :icon="outlinedDelete"
                    padding="sm"
                    unelevated size="sm" flat
                    style="min-width: auto; border: 1px solid #F2452F; color: #F2452F;"
                    @click="removeTier(idx as number)"
                  />
                </div>
              </div>

              <!-- Tier Body -->
              <div class="tier-body">

                <!-- Condition row (non-default tiers only) -->
                <div v-if="(idx as number) > 0 && tier.condition" class="condition-block">
                  <div class="sub-label tw:mb-2">Apply this tier when</div>
                  <div class="tw:flex tw:gap-2 tw:items-start tw:flex-wrap">
                    <q-input
                      v-model="tier.condition.usage_key"
                      label="Usage Key"
                      dense borderless
                      class="tw:flex-1 tw:min-w-[130px]"
                      placeholder="e.g. input"
                    />
                    <q-select
                      v-model="tier.condition.operator"
                      :options="operators"
                      dense borderless options-dense
                      emit-value map-options
                      class="tw:w-[90px] tw:flex-shrink-0"
                      :display-value="operators.find((o: any) => o.value === tier.condition.operator)?.label || ''"
                    />
                    <q-input
                      v-model.number="tier.condition.value"
                      label="Threshold"
                      type="number"
                      dense borderless
                      class="tw:w-[140px] tw:flex-shrink-0"
                    />
                  </div>
                </div>

                <!-- Quick Setup -->
                <div class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
                  <span class="sub-label">Quick setup:</span>
                  <button
                    v-for="tpl in usageTemplates"
                    :key="tpl.name"
                    class="template-chip"
                    :class="{ 'template-chip--active': isTemplateActive(tier, tpl.keys) }"
                    :style="{ '--chip-dot-color': tpl.color }"
                    @click="applyTemplate(tier, tpl.keys)"
                  >
                    {{ tpl.name }}
                    <span
                      v-if="isTemplateActive(tier, tpl.keys)"
                      class="template-chip-close"
                      @click.stop="clearTemplate(tier, tpl.keys)"
                    >×</span>
                  </button>
                </div>

                <!-- Price Table -->
                <div>
                  <div class="price-table-label tw:mb-2">
                    Token prices
                    <span class="price-table-label-sub"> — $ per 1M tokens</span>
                  </div>

                  <div class="price-table">
                    <!-- Column headers (only when rows exist) -->
                    <div v-if="Object.keys(tier.prices).length" class="price-table-head">
                      <span>Usage Key</span>
                      <span>$ / 1M tokens</span>
                      <span></span>
                    </div>

                    <!-- Existing rows -->
                    <div
                      v-for="(price, pkey) in tier.prices"
                      :key="pkey"
                      class="price-row"
                    >
                      <q-input
                        :model-value="pkey"
                        placeholder="e.g. input"
                        dense borderless
                        @update:model-value="(val: any) => renamePrice(tier, pkey as string, val)"
                      />
                      <q-input
                        :model-value="toPerMillion(Number(price))"
                        type="number" :min="0" step="0.01"
                        placeholder="0.00"
                        dense borderless
                        @update:model-value="(val: any) => updatePrice(tier, pkey as string, fromPerMillion(Number(val)))"
                      >
                        <template #prepend><span class="price-dollar">$</span></template>
                      </q-input>
                      <q-btn
                        :icon="outlinedDelete"
                        padding="sm"
                        unelevated size="sm" flat
                        style="min-width: auto; border: 1px solid #F2452F; color: #F2452F;"
                        @click="deletePrice(tier, pkey as string)"
                      />
                    </div>

                    <!-- Empty state -->
                    <div v-if="!Object.keys(tier.prices).length" class="price-empty">
                      <div class="price-empty-title">No prices defined yet</div>
                      <div class="price-empty-sub">Use quick setup above or add a price below</div>
                    </div>

                    <!-- Add row -->
                    <div class="price-add-row" :class="{ 'price-add-row--no-top': !Object.keys(tier.prices).length }">
                      <q-input
                        v-model="addState[(idx as number)].key"
                        dense borderless
                        placeholder="Usage key (e.g. input)"
                      />
                      <q-input
                        v-model.number="addState[(idx as number)].value"
                        type="number" :min="0" step="0.01"
                        dense borderless
                        placeholder="0.00"
                      >
                        <template #prepend><span class="price-dollar">$</span></template>
                      </q-input>
                      <q-btn
                        icon="add"
                        padding="sm"
                        unelevated size="sm" flat
                        style="min-width: auto; border: 1px solid #5960B2; color: #5960B2;"
                        :disable="!addState[(idx as number)].key.trim()"
                        @click="addPrice(tier, idx)"
                      />
                    </div>
                  </div>
                </div>

              </div>
            </div>
            <q-btn
              class="o2-secondary-button tw:h-[28px] tw:self-start"
              no-caps flat size="sm"
              label="Add Tier"
              @click="addTier"
            />
          </div>
        </div>

      </div>
    </div>


    <!-- Footer -->
    <div class="page-footer">
      <q-btn
        class="o2-secondary-button tw:h-[36px]"
        label="Cancel" no-caps flat
        @click="goBack"
        data-test="model-pricing-editor-cancel-btn"
      />
      <q-btn
        class="o2-primary-button no-border tw:h-[36px]"
        no-caps flat
        label="Save"
        :loading="saving"
        @click="save"
        data-test="model-pricing-editor-save-btn"
      />
    </div>

  </q-page>
</template>

<script lang="ts" setup>
import { ref, computed, onBeforeMount } from "vue";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import { useQuasar } from "quasar";
import modelPricingService from "@/services/model_pricing";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";

const store = useStore();
const router = useRouter();
const route = useRoute();
const q = useQuasar();

const saving = ref(false);
const addState = ref<Array<{ key: string; value: number }>>([{ key: "", value: 0 }]);
const showExamples = ref(false);
const copiedPattern = ref<string | null>(null);

function copyPattern(pattern: string) {
  navigator.clipboard.writeText(pattern);
  copiedPattern.value = pattern;
  setTimeout(() => { copiedPattern.value = null; }, 1500);
}

const patternExamples = [
  { name: "GPT-4o",           match_pattern: "(?i)gpt-4o(?:-\\d{4}[-\\d]*)?$" },
  { name: "o3",               match_pattern: "(?i)(?:^|[-/])o3(?:$|[-/])" },
  { name: "Claude 3.5 Sonnet",match_pattern: "(?i)claude-3-5-sonnet" },
  { name: "Gemini 2.5 Pro",   match_pattern: "(?i)gemini-2\\.5-pro" },
  { name: "GPT-4o Mini",      match_pattern: "(?i)gpt-4o-mini" },
];

const orgIdentifier = computed(
  () => store.state.selectedOrganization?.identifier || ""
);

const isEdit = computed(() => !!route.query.id && route.query.duplicate !== "true");

const model = ref<any>(createEmptyModel());

function createEmptyModel() {
  return {
    id: null,
    name: "",
    match_pattern: "",
    enabled: true,
    tiers: [newTier("Default")],
  };
}

function newTier(name: string, condition: any = null) {
  return { name, condition, prices: {} as Record<string, number> };
}

function resetAddState(tierCount: number) {
  addState.value = Array.from({ length: tierCount }, () => ({ key: "", value: 0 }));
}

const usageTemplates = [
  {
    name: "OpenAI",
    color: "#10a37f",
    keys: ["input", "output", "cache_read_input_tokens", "output_reasoning_tokens"],
  },
  {
    name: "Anthropic",
    color: "#d97706",
    keys: ["input", "output", "cache_read_input_tokens", "cache_creation_input_tokens"],
  },
];

const operators = [
  { label: ">", value: "gt" },
  { label: ">=", value: "gte" },
  { label: "<", value: "lt" },
  { label: "<=", value: "lte" },
  { label: "=", value: "eq" },
  { label: "!=", value: "neq" },
];

function addTier() {
  model.value.tiers.push(
    newTier("Conditional Tier", { usage_key: "input", operator: "gt", value: 200000 })
  );
  addState.value.push({ key: "", value: 0 });
}

function removeTier(idx: number) {
  model.value.tiers.splice(idx, 1);
  addState.value.splice(idx, 1);
}

function updatePrice(tier: any, key: string, value: number) {
  tier.prices[key] = value;
}

function deletePrice(tier: any, key: string) {
  delete tier.prices[key];
  tier.prices = { ...tier.prices };
}

function renamePrice(tier: any, oldKey: string, newKey: string) {
  if (!newKey || newKey === oldKey) return;
  const val = tier.prices[oldKey];
  delete tier.prices[oldKey];
  tier.prices[newKey] = val;
  tier.prices = { ...tier.prices };
}

function isTemplateActive(tier: any, templateKeys: string[]): boolean {
  const priceKeys = Object.keys(tier.prices || {});
  if (priceKeys.length !== templateKeys.length) return false;
  return templateKeys.every((k) => priceKeys.includes(k));
}

function applyTemplate(tier: any, keys: string[]) {
  const next: Record<string, number> = {};
  for (const key of keys) {
    next[key] = tier.prices[key] ?? 0;
  }
  tier.prices = next;
}

function clearTemplate(tier: any, keys: string[]) {
  const next = { ...tier.prices };
  for (const key of keys) {
    delete next[key];
  }
  tier.prices = next;
}

function toPerMillion(perToken: number): number {
  return perToken ? +(perToken * 1_000_000).toPrecision(10) : 0;
}

function fromPerMillion(perMillion: number): number {
  return perMillion > 0 ? perMillion / 1_000_000 : 0;
}

function addPrice(tier: any, idx: number | string) {
  const i = Number(idx);
  const key = (addState.value[i]?.key || "").trim();
  if (!key) return;
  tier.prices = { ...tier.prices, [key]: fromPerMillion(addState.value[i].value || 0) };
  addState.value[i] = { key: "", value: 0 };
}

function goBack() {
  router.push({
    name: "modelPricing",
    query: { org_identifier: orgIdentifier.value },
  });
}

async function save() {
  const m = model.value;
  if (!m.name.trim()) {
    q.notify({ type: "warning", message: "Model name is required" });
    return;
  }
  if (!m.match_pattern.trim()) {
    q.notify({ type: "warning", message: "Match pattern is required" });
    return;
  }
  if (m.tiers.length > 0) {
    m.tiers[0].condition = null;
  }

  saving.value = true;
  try {
    if (m.id) {
      await modelPricingService.update(orgIdentifier.value, m.id, m);
    } else {
      await modelPricingService.create(orgIdentifier.value, m);
    }
    q.notify({ type: "positive", message: "Model pricing saved" });
    goBack();
  } catch (e: any) {
    const msg = e.response?.data?.message || e.message;
    q.notify({ type: "negative", message: "Failed to save: " + msg });
  } finally {
    saving.value = false;
  }
}

onBeforeMount(async () => {
  const id = route.query.id as string | undefined;
  const isDuplicate = route.query.duplicate === "true";
  if (id) {
    try {
      const res = await modelPricingService.list(orgIdentifier.value);
      const found = (res.data || []).find((m: any) => m.id === id);
      if (found) {
        model.value = JSON.parse(JSON.stringify(found));
        if (isDuplicate) {
          model.value.id = null;
          model.value.org_id = orgIdentifier.value;
          model.value.name = model.value.name + " (Copy)";
          // Clear source so create endpoint assigns the correct one
          delete model.value.source;
        }
        for (let i = 1; i < model.value.tiers.length; i++) {
          if (!model.value.tiers[i].condition) {
            model.value.tiers[i].condition = { usage_key: "input", operator: "gt", value: 0 };
          }
        }
      }
    } catch (e: any) {
      q.notify({ type: "negative", message: "Failed to load model: " + e.message });
    }
  }
  resetAddState(model.value.tiers.length);
});
</script>

<style lang="scss" scoped>

/* ── Sticky footer ─────────────────────────────────── */
.page-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 24px;
  height: 50px;
  flex-shrink: 0;
  border-top: 1px solid var(--o2-border-color);
}

/* ── Form card (Model Details) ─────────────────────── */
.form-card {
  border: 1px solid var(--o2-border-color);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.form-card-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: rgba(0, 0, 0, 0.025);
  border-bottom: 1px solid var(--o2-border-color);
}

.form-card-title {
  font-size: 13px;
  font-weight: 600;
}

.form-card-subtitle {
  font-size: 11px;
  opacity: 0.6;
  margin-top: 1px;
}

.form-card-body {
  padding: 10px 16px 8px;
}

.regex-hint-trigger {
  cursor: default;
  opacity: 0.4;

  &:hover {
    opacity: 0.75;
  }
}


/* ── Tier card ──────────────────────────────────────── */
.tier-card {
  border: 1px solid var(--o2-border-color);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}

.tier-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.025);
  border-bottom: 1px solid var(--o2-border-color);
}

.tier-name-label {
  font-size: 12px;
  font-weight: 500;
  opacity: 0.5;
  white-space: nowrap;
  flex-shrink: 0;
}

.tier-name-input {
  width: auto;
  min-width: 80px;
  max-width: 260px;

  :deep(.q-field__control) {
    padding: 0;
    min-height: 30px;
    height: 30px;
    align-items: center;
  }
  :deep(.q-field__label) { display: none; }
  :deep(.q-field__native) {
    padding-top: 0;
    padding-bottom: 0;
    min-height: unset;
    line-height: 30px;
  }
  :deep(input) {
    font-weight: 600;
    font-size: 14px;
  }
}

.tier-body {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── Sub labels inside tier body ───────────────────── */
.sub-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  opacity: 0.65;
}

/* ── Condition block ───────────────────────────────── */
.condition-block {
  padding: 12px 14px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.02);
  border: 1px solid var(--o2-border-color);
}


.tier-status-badge {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(34, 197, 94, 0.1);
  color: #16a34a;
  border: 1px solid rgba(34, 197, 94, 0.25);
  white-space: nowrap;
}

.template-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;

  &::before {
    content: '';
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--chip-dot-color, currentColor);
    flex-shrink: 0;
  }
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  border: 1px solid var(--o2-border-color);
  background: transparent;
  color: inherit;
  outline: none;
  user-select: none;

  &:hover:not(&--active) {
    border-color: var(--q-primary);
    color: var(--q-primary);
    background: color-mix(in srgb, var(--q-primary) 8%, transparent);
  }

  &--active {
    background: var(--q-primary);
    border-color: var(--q-primary);
    color: white;

    &:hover {
      background: color-mix(in srgb, var(--q-primary) 85%, black 15%);
      border-color: color-mix(in srgb, var(--q-primary) 85%, black 15%);
    }
  }
}

.template-chip-close {
  font-size: 14px;
  line-height: 1;
  opacity: 0.75;
  margin-left: 2px;

  &:hover {
    opacity: 1;
  }
}

/* ── Price table ───────────────────────────────────── */
.price-table {
  overflow: hidden;
}

.price-table-head {
  display: grid;
  grid-template-columns: 1fr 160px auto;
  gap: 8px;
  padding: 6px 12px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.45;
}

.price-row {
  display: grid;
  grid-template-columns: 1fr 160px auto;
  gap: 8px;
  align-items: center;
  padding: 2px 12px;
}

.price-dollar {
  font-size: 12px;
  padding-bottom: 2px;
}

.price-table-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.price-table-label-sub {
  font-weight: 400;
  opacity: 0.55;
  letter-spacing: normal;
}

.price-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
  gap: 3px;
}

.price-empty-title {
  font-size: 12px;
  font-weight: 500;
}

.price-empty-sub {
  font-size: 11px;
  opacity: 0.55;
}

.price-add-row {
  display: grid;
  grid-template-columns: 1fr 160px auto;
  gap: 8px;
  align-items: center;
  padding: 4px 12px;

}

/* ── Pattern examples button & dialog ─────────────── */
.pattern-examples-btn {
  opacity: 0.5;
  color: var(--q-primary);
  &:hover { opacity: 1; }
}

.pattern-examples-card {
  min-width: 480px;
  max-width: 560px;
}

.examples-table {
  border: 1px solid var(--o2-border-color);
  border-radius: 8px;
  overflow: hidden;
}

.examples-table-head {
  display: grid;
  grid-template-columns: 180px 1fr auto;
  gap: 12px;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.03);
  border-bottom: 1px solid var(--o2-border-color);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.45;
}

.examples-table-row {
  display: grid;
  grid-template-columns: 180px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--o2-border-color);
  font-size: 12px;

  &:last-child { border-bottom: none; }
}

.examples-model-name {
  font-weight: 500;
}

.examples-copy-btn {
  opacity: 0.4;
  &:hover { opacity: 1; }
}

.examples-pattern {
  font-family: monospace;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.04);
  padding: 2px 6px;
  border-radius: 4px;
  word-break: break-all;
}

/* ── showLabelOnTop input border override ───────────── */
:deep(.q-field--labeled.showLabelOnTop) {
  .q-field__control {
    border: 1px solid var(--o2-border-color) !important;
  }
}
</style>
