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
  <div class="tw:rounded-md q-pa-none tw:flex tw:flex-col"
    style="min-height: 0; height: 100%; overflow: hidden"
  >
    <!-- Header -->
    <div
      class="tw:flex tw:items-center tw:px-3 tw:h-[68px] tw:border-b-[1px] tw:gap-3 tw:flex-shrink-0"
    >
      <div
        data-test="model-pricing-editor-back-btn"
        class="el-border tw:w-6 tw:h-6 flex items-center justify-center cursor-pointer el-border-radius"
        :title="t('modelPricing.goBack')"
        @click="goBack"
      >
        <OIcon name="arrow-back-ios-new" size="xs" />
      </div>
      <div class="tw:flex tw:flex-col tw:justify-center">
        <div
          class="q-table__title tw:font-[600] tw:leading-tight"
          data-test="model-pricing-editor-title"
        >
          {{
            isEdit ? t("modelPricing.editTitle") : t("modelPricing.newTitle")
          }}
        </div>
      </div>
    </div>

    <!-- Form Body -->
    <div
      class="tw:px-3 tw:py-3"
      style="
        flex: 1;
        min-height: 0;
        height: calc(100vh - 170px);
        overflow-y: auto;
      "
    >
      <div style="max-width: 760px" class="tw:flex tw:flex-col tw:gap-6">
        <!-- ── Model Details Card ── -->
        <div class="form-card">
          <div class="form-card-header">
            <div>
              <div class="form-card-title">
                {{ t("modelPricing.modelDetails") }}
              </div>
              <div class="form-card-subtitle">
                {{ t("modelPricing.modelDetailsDesc") }}
              </div>
            </div>
          </div>
          <div class="form-card-body tw:flex tw:flex-row tw:gap-4">
            <div class="tw:flex-1">
              <div class="tw:flex tw:items-center tw:gap-1 tw:mb-1 field-label">
                {{ t("modelPricing.modelNameField") }}
                <OIcon
                  name="info"
                  size="xs"
                  class="q-ml-xs cursor-pointer"
                  :class="
                    store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
                  "
                >
                  <q-tooltip
                    anchor="center right"
                    self="center left"
                    max-width="300px"
                  >
                    <span style="font-size: 13px">{{
                      t("modelPricing.modelNameTooltip")
                    }}</span>
                  </q-tooltip>
                </OIcon>
              </div>
              <q-input
                v-model="model.name"
                :placeholder="t('modelPricing.modelNamePlaceholder')"
                class="showLabelOnTop"
                dense
                borderless
                :error="nameTouched && !!nameError"
                :error-message="nameError"
                @blur="nameTouched = true"
                @update:model-value="nameTouched = true"
                data-test="model-pricing-name-input"
              />
            </div>
            <div class="tw:flex-1 tw:flex tw:items-start tw:gap-1">
              <div class="tw:flex-1">
                <div
                  class="tw:flex tw:items-center tw:gap-1 tw:mb-1 field-label"
                >
                  {{ t("modelPricing.matchPatternField") }}
                  <OIcon
                    name="info"
                    size="xs"
                    class="q-ml-xs cursor-pointer"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-grey-5'
                        : 'text-grey-7'
                    "
                  >
                    <q-tooltip
                      anchor="center right"
                      self="center left"
                      max-width="300px"
                    >
                      <span style="font-size: 13px">{{
                        t("modelPricing.matchPatternTooltip")
                      }}</span>
                    </q-tooltip>
                  </OIcon>
                </div>
                <q-input
                  v-model="model.match_pattern"
                  :placeholder="t('modelPricing.matchPatternPlaceholder')"
                  class="showLabelOnTop"
                  dense
                  borderless
                  :error="patternTouched && !!regexError"
                  :error-message="regexError"
                  @blur="patternTouched = true"
                  @update:model-value="patternTouched = true"
                  data-test="model-pricing-pattern-input"
                />
              </div>
              <OButton
                variant="ghost"
                size="icon-xs-sq"
                class="pattern-examples-btn tw:mt-7"
                @click="showExamples = true"
              >
                <OIcon name="lightbulb-outline" size="xs" />
                <q-tooltip
                  anchor="top right"
                  self="bottom right"
                  :offset="[0, 4]"
                >
                  {{ t("modelPricing.patternExamplesBtn") }}
                </q-tooltip>
              </OButton>

              <!-- Pattern Examples Dialog -->
              <ODialog data-test="model-pricing-editor-examples-dialog" v-model:open="showExamples" size="sm"
                :title="t('modelPricing.patternExamplesTitle')"
                :sub-title="t('modelPricing.patternExamplesDesc')"
              >
                <div class="examples-table">
                  <div class="examples-table-head">
                    <span>{{
                      t("modelPricing.patternExamplesModelCol")
                    }}</span>
                    <span>{{
                      t("modelPricing.patternExamplesPatternCol")
                    }}</span>
                  </div>
                  <div
                    v-for="ex in patternExamples"
                    :key="ex.name"
                    class="examples-table-row"
                  >
                    <span class="examples-model-name">{{ ex.name }}</span>
                    <code class="examples-pattern">{{
                      ex.match_pattern
                    }}</code>
                    <OButton
                      variant="ghost"
                      size="icon-xs-sq"
                      class="examples-copy-btn"
                      @click="copyPattern(ex.match_pattern)"
                    >
                      <OIcon
                        :name="copiedPattern === ex.match-pattern ? 'check' : 'content-copy'"
                        size="12px"
                        :class="copiedPattern === ex.match_pattern ? 'text-positive' : ''"
                      />
                      <q-tooltip :offset="[0, 4]">{{
                        copiedPattern === ex.match_pattern
                          ? t("modelPricing.copied")
                          : t("modelPricing.copyPattern")
                      }}</q-tooltip>
                    </OButton>
                  </div>
                </div>
              </ODialog>
            </div>
          </div>
        </div>

        <!-- ── Pricing Tiers ── -->
        <div class="form-card">
          <div class="form-card-header">
            <div>
              <div class="form-card-title">
                {{ t("modelPricing.pricingTiers") }}
              </div>
              <div class="form-card-subtitle">
                {{ t("modelPricing.pricingTiersDesc") }}
              </div>
            </div>
          </div>

          <div class="form-card-body tw:flex tw:flex-col tw:gap-3">
            <div
              v-for="(tier, idx) in model.tiers"
              :key="idx as number"
              class="tier-card"
            >
              <!-- Tier Header -->
              <div class="tier-header">
                <div class="tw:flex tw:items-center tw:gap-2">
                  <span class="tier-name-label">{{
                    t("modelPricing.tierName")
                  }}</span>
                  <q-input
                    v-model="tier.name"
                    :placeholder="t('modelPricing.tierNamePlaceholder')"
                    dense
                    borderless
                  />
                </div>
                <div class="tw:flex tw:items-center tw:gap-2 tw:flex-shrink-0">
                  <OButton
                    v-if="model.tiers.length > 1"
                    variant="outline-destructive"
                    size="icon"
                    @click="removeTier(idx as number)"
                  >
                    <OIcon name="delete" size="sm" />
                  </OButton>
                </div>
              </div>

              <!-- Tier Body -->
              <div class="tier-body">
                <!-- Condition row (non-default tiers only) -->
                <div
                  v-if="(idx as number) > 0 && tier.condition"
                  class="condition-block"
                >
                  <div class="sub-label tw:mb-2">
                    {{ t("modelPricing.applyTierWhen") }}
                  </div>
                  <div class="tw:flex tw:gap-2 tw:items-start tw:flex-wrap">
                    <q-input
                      v-model="tier.condition.usage_key"
                      :label="t('modelPricing.usageKeyCol')"
                      dense
                      borderless
                      class="tw:flex-1 tw:min-w-[130px]"
                      :placeholder="t('modelPricing.usageKeyPlaceholder')"
                    />
                    <q-select
                      v-model="tier.condition.operator"
                      :options="operators"
                      dense
                      borderless
                      options-dense
                      emit-value
                      map-options
                      class="tw:w-[90px] tw:flex-shrink-0"
                      :display-value="
                        operators.find(
                          (o: any) => o.value === tier.condition.operator,
                        )?.label || ''
                      "
                    />
                    <q-input
                      v-model.number="tier.condition.value"
                      :label="t('modelPricing.threshold')"
                      type="number"
                      dense
                      borderless
                      class="tw:w-[140px] tw:flex-shrink-0"
                    />
                  </div>
                </div>

                <!-- Quick Setup -->
                <div class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
                  <span class="sub-label">{{
                    t("modelPricing.quickSetup")
                  }}</span>
                  <OButton
                    v-for="tpl in usageTemplates"
                    :key="tpl.name"
                    variant="pricing-chip"
                    :active="isTemplateActive(tier, tpl.keys)"
                    @click="applyTemplate(tier, tpl.keys)"
                  >
                    <template #icon-left>
                      <span class="pricing-chip-dot" :style="{ background: tpl.color }" />
                    </template>
                    {{ tpl.name }}
                    <span
                      v-if="isTemplateActive(tier, tpl.keys)"
                      class="template-chip-close"
                      @click.stop="clearTemplate(tier, tpl.keys)"
                      >×</span
                    >
                  </OButton>
                </div>

                <!-- Price Table -->
                <div>
                  <div class="price-table-label tw:mb-2">
                    {{ t("modelPricing.tokenPrices") }}
                    <span class="price-table-label-sub">
                      {{ t("modelPricing.tokenPricesUnit") }}</span
                    >
                  </div>

                  <div class="price-table">
                    <!-- Column headers (only when rows exist) -->
                    <div
                      v-if="Object.keys(tier.prices).length"
                      class="price-table-head"
                    >
                      <span>{{ t("modelPricing.usageKeyCol") }}</span>
                      <span>{{ t("modelPricing.pricePerMillionHeader") }}</span>
                      <span></span>
                    </div>

                    <!-- Existing rows — use stable numeric index as :key so
                         renaming a key doesn't destroy/recreate the DOM node -->
                    <div
                      v-for="(entry, entryIdx) in priceEntries(tier)"
                      :key="entry.stableId"
                      class="price-row"
                    >
                      <q-input
                        :model-value="entry.key"
                        :placeholder="t('modelPricing.usageKeyPlaceholder')"
                        dense
                        borderless
                        @update:model-value="
                          (val: any) => renamePriceByIndex(tier, entryIdx, val)
                        "
                      />
                      <q-input
                        :model-value="toPerMillion(entry.value)"
                        type="number"
                        :min="0"
                        step="0.01"
                        :placeholder="t('modelPricing.pricePlaceholder')"
                        dense
                        borderless
                        @update:model-value="
                          (val: any) =>
                            updatePrice(
                              tier,
                              entry.key,
                              fromPerMillion(Number(val)),
                            )
                        "
                      >
                        <template #prepend
                          ><span class="price-dollar">$</span></template
                        >
                      </q-input>
                      <OButton
                        variant="outline-destructive"
                        size="icon"
                        @click="deletePrice(tier, entry.key)"
                      >
                        <OIcon name="delete" size="sm" />
                      </OButton>
                    </div>

                    <!-- Empty state -->
                    <div
                      v-if="!Object.keys(tier.prices).length"
                      class="price-empty"
                    >
                      <div class="price-empty-title">
                        {{ t("modelPricing.noPricesDefined") }}
                      </div>
                      <div class="price-empty-sub">
                        {{ t("modelPricing.noPricesDesc") }}
                      </div>
                    </div>

                    <!-- Add row -->
                    <div
                      class="price-add-row"
                      :class="{
                        'price-add-row--no-top': !Object.keys(tier.prices)
                          .length,
                      }"
                    >
                      <q-input
                        v-model="addState[idx as number].key"
                        dense
                        borderless
                        :placeholder="t('modelPricing.addUsageKeyPlaceholder')"
                      />
                      <q-input
                        v-model.number="addState[idx as number].value"
                        type="number"
                        :min="0"
                        step="0.01"
                        dense
                        borderless
                        :placeholder="t('modelPricing.pricePlaceholder')"
                      >
                        <template #prepend
                          ><span class="price-dollar">$</span></template
                        >
                      </q-input>
                      <OButton
                        variant="outline"
                        size="icon"
                        :disabled="!addState[idx as number].key.trim()"
                        @click="addPrice(tier, idx)"
                      >
                        <OIcon name="add" size="xs" />
                      </OButton>
                    </div>
                  </div>

                  <!-- Price Preview Table -->
                  <div
                    v-if="previewEntries(tier, idx as number).length"
                    class="tw:mt-5 tw:border tw:rounded"
                    style="
                      background: rgba(0, 0, 0, 0.015);
                      border-color: var(--o2-border-color);
                    "
                  >
                    <div
                      class="tw:px-4 tw:py-2 tw:text-xs text-grey-8 tw:font-semibold tw:border-b"
                      style="border-color: var(--o2-border-color)"
                    >
                      {{ t("modelPricing.pricePreview") }}
                    </div>
                    <table
                      class="tw:w-full tw:text-xs"
                      style="border-collapse: collapse"
                    >
                      <thead>
                        <tr
                          class="tw:text-left text-grey-7 tw:border-b"
                          style="border-color: var(--o2-border-color)"
                        >
                          <th class="tw:px-4 tw:py-2 tw:font-medium">
                            {{ t("modelPricing.usageType") }}
                          </th>
                          <th class="tw:px-4 tw:py-2 tw:font-medium">
                            {{ t("modelPricing.perThousand") }}
                          </th>
                          <th class="tw:px-4 tw:py-2 tw:font-medium">
                            {{ t("modelPricing.perMillion") }}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="entry in previewEntries(tier, idx as number)"
                          :key="entry.stableId"
                          class="tw:border-b last:tw:border-none"
                          :class="{
                            'preview-row-pending': entry.stableId === -1,
                          }"
                          style="border-color: var(--o2-border-color)"
                        >
                          <td
                            class="tw:px-4 tw:py-2 text-grey-9 tw:font-medium"
                          >
                            {{ entry.key }}
                          </td>
                          <td class="tw:px-4 tw:py-2 text-grey-9">
                            ${{ formatPreviewCost(entry.value, 1000) }}
                          </td>
                          <td class="tw:px-4 tw:py-2 text-grey-9">
                            ${{ formatPreviewCost(entry.value, 1000000) }}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
            <OButton
              variant="outline"
              size="sm-action"
              class="tw:self-start"
              @click="addTier"
            >
              {{ t("modelPricing.addTier") }}
            </OButton>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="page-footer">
      <OButton
        variant="outline"
        size="sm-action"
        @click="goBack"
        data-test="model-pricing-editor-cancel-btn"
      >
        {{ t("modelPricing.cancel") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm-action"
        :loading="saving"
        :disabled="!!nameError || !!regexError"
        @click="save"
        data-test="model-pricing-editor-save-btn"
      >
        {{ t("modelPricing.save") }}
      </OButton>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onBeforeMount } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import { useQuasar } from "quasar";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import modelPricingService from "@/services/model_pricing";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const { t } = useI18n();
const store = useStore();
const router = useRouter();
const route = useRoute();
const q = useQuasar();

const saving = ref(false);
const existingModels = ref<any[]>([]);
const nameTouched = ref(false);
const patternTouched = ref(false);
const addState = ref<Array<{ key: string; value: number }>>([
  { key: "", value: 0 },
]);
const showExamples = ref(false);
const copiedPattern = ref<string | null>(null);

function copyPattern(pattern: string) {
  navigator.clipboard.writeText(pattern);
  copiedPattern.value = pattern;
  setTimeout(() => {
    copiedPattern.value = null;
  }, 1500);
}

const patternExamples = [
  { name: "GPT-4o", match_pattern: "gpt-4o" },
  { name: "o3", match_pattern: "o3" },
  { name: "Claude Sonnet 4.6", match_pattern: "claude-sonnet-4-6" },
  { name: "Gemini 2.5 Pro", match_pattern: "gemini-2.5-pro" },
  { name: "GPT-4o Mini", match_pattern: "gpt-4o-mini" },
];

const orgIdentifier = computed(
  () => store.state.selectedOrganization?.identifier || "",
);

/** Real-time name validation. */
const nameError = computed(() => {
  const name = model.value.name;
  if (!name || !name.trim()) return t("modelPricing.nameRequired");
  if (name.length > 256) return t("modelPricing.nameTooLong");
  return "";
});

/**
 * Strip Rust/PCRE inline flag groups that JavaScript RegExp doesn't understand.
 * Handles: (?i), (?m), (?s), (?x), (?u), and combinations like (?ims).
 * Does NOT strip flag-scoped groups like (?i:...) — those are left as non-capturing groups.
 */
function stripInlineFlags(pattern: string): string {
  // (?FLAGS) where FLAGS is one or more of i, m, s, x, u — standalone (not followed by ':')
  return pattern.replace(/\(\?[imsxu]+\)/g, "");
}

/** Real-time regex validation — shows error as the user types. */
const regexError = computed(() => {
  const pattern = model.value.match_pattern;
  if (!pattern || !pattern.trim()) return t("modelPricing.patternRequired");
  if (pattern.length > 512) return t("modelPricing.patternTooLong");
  try {
    // Strip Rust-specific inline flags before testing with JS RegExp.
    // The backend (Rust regex crate) is the authority; this is a best-effort client check.
    new RegExp(stripInlineFlags(pattern));
    return "";
  } catch (e: any) {
    return t("modelPricing.invalidRegex", { error: e.message });
  }
});

const isEdit = computed(
  () => !!route.query.id && route.query.duplicate !== "true",
);

const model = ref<any>(createEmptyModel());

function createEmptyModel() {
  return {
    id: null,
    name: "",
    match_pattern: "",
    enabled: true,
    tiers: [newTier(t("modelPricing.tierDefaultName"))],
  };
}

function newTier(name: string, condition: any = null) {
  return { name, condition, prices: {} as Record<string, number> };
}

function resetAddState(tierCount: number) {
  addState.value = Array.from({ length: tierCount }, () => ({
    key: "",
    value: 0,
  }));
}

const usageTemplates = [
  {
    name: "OpenAI",
    color: "#10a37f",
    keys: [
      "input",
      "output",
      "cache_read_input_tokens",
      "output_reasoning_tokens",
    ],
  },
  {
    name: "Anthropic",
    color: "#d97706",
    keys: [
      "input",
      "output",
      "cache_read_input_tokens",
      "cache_creation_input_tokens",
    ],
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
    newTier(t("modelPricing.tierConditionalName"), {
      usage_key: "input",
      operator: "gt",
      value: 200000,
    }),
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

/** Stable ID counter for price entries — survives key renames without resetting. */
let nextStableId = 0;
const stableIdMap = new WeakMap<any, Map<number, number>>();

/** Convert tier.prices object to an array with stable IDs for v-for :key.
 *  Each entry gets a numeric stableId that persists across key renames. */
function priceEntries(
  tier: any,
): Array<{ key: string; value: number; stableId: number }> {
  if (!stableIdMap.has(tier)) stableIdMap.set(tier, new Map());
  const idMap = stableIdMap.get(tier)!;
  return Object.entries(tier.prices || {}).map(([k, v], idx) => {
    if (!idMap.has(idx)) idMap.set(idx, nextStableId++);
    return { key: k, value: Number(v), stableId: idMap.get(idx)! };
  });
}

/** Rename a price entry by its array index — keeps the DOM node alive. */
function renamePriceByIndex(tier: any, index: number, newKey: string) {
  const entries = Object.entries(tier.prices);
  if (index < 0 || index >= entries.length) return;
  const [oldKey, val] = entries[index];
  if (newKey === oldKey) return;
  const keyError = validateUsageKey(newKey);
  if (keyError) {
    notifyWarn(keyError);
    return;
  }
  // Rebuild the object preserving insertion order with the new key at the same position
  const rebuilt: Record<string, number> = {};
  for (let i = 0; i < entries.length; i++) {
    if (i === index) {
      rebuilt[newKey] = val as number;
    } else {
      rebuilt[entries[i][0]] = entries[i][1] as number;
    }
  }
  tier.prices = rebuilt;
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

/** Entries for the live preview = committed prices + any pending add-row entry. */
function previewEntries(tier: any, idx: number) {
  const committed = priceEntries(tier);
  const pending = addState.value[idx];
  if (pending?.key.trim()) {
    const pendingValue = fromPerMillion(pending.value || 0);
    // Don't duplicate if the key already exists
    if (!committed.find((e) => e.key === pending.key.trim())) {
      committed.push({
        key: pending.key.trim(),
        value: pendingValue,
        stableId: -1,
      });
    }
  }
  return committed;
}

function formatPreviewCost(costPerUnit: number, multiplier: number) {
  if (!costPerUnit) return "0";
  const c = costPerUnit * multiplier;
  if (c === 0) return "0";
  if (c < 0.00001) return c.toExponential(2);
  let str = c.toFixed(8);
  str = str.replace(/0+$/, "").replace(/\.$/, "");
  return str;
}

function validateUsageKey(key: string): string | null {
  if (/^\d+$/.test(key)) return t("modelPricing.usageKeyPureInteger");
  if (/\s/.test(key)) return t("modelPricing.usageKeyContainsSpaces");
  return null;
}

function addPrice(tier: any, idx: number | string): boolean {
  const i = Number(idx);
  const key = (addState.value[i]?.key || "").trim();
  if (!key) return true;
  const keyError = validateUsageKey(key);
  if (keyError) {
    notifyWarn(keyError);
    return false;
  }
  tier.prices = {
    ...tier.prices,
    [key]: fromPerMillion(addState.value[i].value || 0),
  };
  addState.value[i] = { key: "", value: 0 };
  return true;
}

function goBack() {
  router.push({
    name: "modelPricing",
    query: { org_identifier: orgIdentifier.value },
  });
}

function notifyWarn(message: string) {
  q.notify({ type: "negative", message, position: "bottom", timeout: 4000 });
}

/** Show error notification only for non-403 errors.
 *  403 errors are already handled by the global HTTP interceptor (persistent top banner). */
function notifyError(prefix: string, e: any) {
  if (e?.response?.status === 403) return;
  const msg =
    e?.response?.data?.message || e?.message || t("modelPricing.errUnknown");
  q.notify({
    type: "negative",
    message: `${prefix}: ${msg}`,
    position: "bottom",
    timeout: 5000,
  });
}

async function save() {
  const m = model.value;

  // Auto-commit any pending add-row values before validation.
  // Users often type a price and hit Save without clicking "+".
  for (let i = 0; i < m.tiers.length; i++) {
    const pending = addState.value[i];
    if (pending && pending.value > 0 && !pending.key.trim()) {
      notifyWarn(
        t("modelPricing.tierPriceMissingKey", { name: m.tiers[i].name }),
      );
      return;
    }
    if (pending && pending.key.trim()) {
      if (!addPrice(m.tiers[i], i)) return;
    }
  }

  // Validate condition usage_key on non-default tiers — must not be a pure integer
  for (let i = 1; i < m.tiers.length; i++) {
    const c = m.tiers[i].condition;
    if (!c) continue;
    const key = (c.usage_key || "").trim();
    if (key && /^\d+$/.test(key)) {
      notifyWarn(
        t("modelPricing.tierUsageKeyPlainNumber", {
          name: m.tiers[i].name || `#${i + 1}`,
        }),
      );
      return;
    }
  }

  // Name and pattern have inline errors — just mark fields as touched so errors show,
  // no duplicate snackbar needed.
  if (nameError.value || regexError.value) {
    nameTouched.value = true;
    patternTouched.value = true;
    return;
  }

  // Require at least one price in the default tier (no inline field for this)
  const defaultTier = m.tiers?.[0];
  if (defaultTier) {
    const priceValues = Object.values(defaultTier.prices || {}) as number[];
    if (priceValues.length === 0 || priceValues.every((v: number) => v === 0)) {
      notifyWarn(t("modelPricing.addDefaultPrice"));
      return;
    }
  }
  if (m.tiers.length > 0) {
    m.tiers[0].condition = null;
  }

  // Warn if another enabled org entry has the same pattern and higher priority
  // (same valid_from context — it will shadow this entry at runtime).
  const patternConflicts = existingModels.value.filter((other: any) => {
    if (other.id && other.id === m.id) return false; // skip self (edit mode)
    if (other.match_pattern !== m.match_pattern) return false;
    const otherVf = other.valid_from ?? 0;
    const thisVf = m.valid_from ?? 0;
    if (otherVf !== thisVf) return false; // different time windows — not a conflict
    // Check if 'other' would win over 'this'
    const otherSo = other.sort_order ?? 0;
    const thisSo = m.sort_order ?? 0;
    if (otherSo !== thisSo) return otherSo < thisSo;
    return other.name.localeCompare(m.name) < 0;
  });

  saving.value = true;
  try {
    if (m.id) {
      await modelPricingService.update(orgIdentifier.value, m.id, m);
    } else {
      await modelPricingService.create(orgIdentifier.value, m);
    }
    if (patternConflicts.length > 0) {
      const winner = patternConflicts[0].name;
      q.notify({
        type: "warning",
        message: t("modelPricing.saveShadowedWarning", { winner }),
        position: "bottom",
        timeout: 8000,
      });
    } else {
      q.notify({
        type: "positive",
        message: t("modelPricing.modelPricingSaved"),
        position: "bottom",
        timeout: 3000,
      });
    }
    goBack();
  } catch (e: any) {
    notifyError(t("modelPricing.errSave"), e);
  } finally {
    saving.value = false;
  }
}

onBeforeMount(async () => {
  const id = route.query.id as string | undefined;
  const isDuplicate = route.query.duplicate === "true";

  // Load all existing org models for duplicate-pattern detection on save
  try {
    const listRes = await modelPricingService.list(orgIdentifier.value);
    existingModels.value = (listRes.data || []).filter(
      (m: any) =>
        (m.source === "org" || !m.source) &&
        m.org_id === orgIdentifier.value &&
        m.enabled !== false,
    );
  } catch {
    /* non-critical */
  }
  if (id) {
    try {
      const res = await modelPricingService.get(orgIdentifier.value, id);
      const found = res.data;
      if (found) {
        model.value = JSON.parse(JSON.stringify(found));
        nameTouched.value = true;
        patternTouched.value = true; // existing model — show validation immediately
        if (isDuplicate) {
          model.value.id = null;
          model.value.org_id = orgIdentifier.value;
          model.value.name = model.value.name + " (Copy)";
          // Clear source so create endpoint assigns the correct one
          delete model.value.source;
        }
        for (let i = 1; i < model.value.tiers.length; i++) {
          if (!model.value.tiers[i].condition) {
            model.value.tiers[i].condition = {
              usage_key: "input",
              operator: "gt",
              value: 0,
            };
          }
        }
      }
    } catch (e: any) {
      notifyError(t("modelPricing.errLoadModel"), e);
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
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);

  .body--dark & {
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }
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
  border-radius: 10px 10px 0 0;

  .body--dark & {
    background: rgba(255, 255, 255, 0.04);
  }
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

  .body--dark & {
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
}

.tier-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.025);
  border-bottom: 1px solid var(--o2-border-color);

  .body--dark & {
    background: rgba(255, 255, 255, 0.04);
  }
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
  :deep(.q-field__label) {
    display: none;
  }
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

  .body--dark & {
    background: rgba(255, 255, 255, 0.03);
  }
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

.pricing-chip-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
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
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
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
  &:hover {
    opacity: 1;
  }
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

  .body--dark & {
    background: rgba(255, 255, 255, 0.05);
  }
}

.examples-table-row {
  display: grid;
  grid-template-columns: 180px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--o2-border-color);
  font-size: 12px;

  &:last-child {
    border-bottom: none;
  }
}

.examples-model-name {
  font-weight: 500;
}

.examples-copy-btn {
  opacity: 0.4;
  &:hover {
    opacity: 1;
  }
}

.examples-pattern {
  font-family: monospace;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.04);
  padding: 2px 6px;
  border-radius: 4px;
  word-break: break-all;

  .body--dark & {
    background: rgba(255, 255, 255, 0.08);
  }
}

/* ── Pending preview row (typed but not yet committed) ── */
.preview-row-pending {
  opacity: 0.5;
  font-style: italic;
}

/* ── Field label ────────────────────────────────────── */
.field-label {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.75;
  height: 20px;
}

/* ── showLabelOnTop input border override ───────────── */
:deep(.q-field--labeled.showLabelOnTop) {
  .q-field__control {
    border: 1px solid var(--o2-border-color) !important;
  }
}
</style>
