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
  <div
    class="rounded-md p-0 flex flex-col"
    style="min-height: 0; height: 100%; overflow: hidden"
  >
    <!-- Header -->
    <AppPageHeader
      :back="{
        label: t('modelPricing.header'),
        onClick: goBack,
        dataTest: 'model-pricing-editor-back-btn',
      }"
      :title="headerTitle"
      class="shrink-0 px-4 border-b border-border-default"
    >
      <template #title>
        <span data-test="model-pricing-editor-title">{{ headerTitle }}</span>
      </template>
    </AppPageHeader>

    <!-- Form Body -->
    <OForm
      :form="form"
      v-slot="{ isSubmitting }"
      class="flex flex-col"
      style="flex: 1; min-height: 0;"
    >
    <div
      class="px-3 py-3"
      style="
        flex: 1;
        min-height: 0;
        height: calc(100vh - 170px);
        overflow-y: auto;
      "
    >
      <div style="max-width: 760px" class="flex flex-col gap-6">
        <!-- ── Model Details Card ── -->
        <div class="border border-(--o2-border-color) rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
          <div class="flex flex-row items-center justify-between gap-3 py-[10px] px-4 bg-[rgba(0,0,0,0.025)] border-b border-(--o2-border-color) rounded-t-[10px] dark:bg-[rgba(255,255,255,0.04)]">
            <div>
              <div class="form-card-title text-[13px] font-semibold">
                {{ t("modelPricing.modelDetails") }}
              </div>
              <div class="form-card-subtitle text-[11px] opacity-60 mt-px">
                {{ t("modelPricing.modelDetailsDesc") }}
              </div>
            </div>
          </div>
          <div class="form-card-body flex flex-row gap-4 px-4 pt-[10px] pb-2">
            <div class="flex-1">
              <div class="flex items-center gap-1 mb-1 field-label text-xs font-semibold opacity-75 h-5">
                {{ t("modelPricing.modelNameField") }}
                <OButton variant="ghost" size="icon-xs-sq" class="ml-1" data-test="model-pricing-name-info-btn">
                  <OIcon
                    name="info"
                    size="xs"
                    :class="
                      store.state.theme === 'dark' ? 'text-gray-400' : 'text-gray-400'
                    "
                  />
                  <OTooltip
                    side="right"
                    max-width="300px"
                    :content="t('modelPricing.modelNameTooltip')"
                  />
                </OButton>
              </div>
              <OFormInput
                name="name"
                :placeholder="t('modelPricing.modelNamePlaceholder')"
                data-test="model-pricing-name-input"
              />
            </div>
            <div class="flex-1 flex items-start gap-1">
              <div class="flex-1">
                <div
                  class="flex items-center gap-1 mb-1 field-label text-xs font-semibold opacity-75 h-5"
                >
                  {{ t("modelPricing.matchPatternField") }}
                  <OButton variant="ghost" size="icon-xs-sq" class="ml-1" data-test="model-pricing-pattern-info-btn">
                    <OIcon
                      name="info"
                      size="xs"
                      :class="
                        store.state.theme === 'dark'
                          ? 'text-gray-400'
                          : 'text-gray-400'
                      "
                    />
                    <OTooltip
                      side="right"
                      max-width="300px"
                      :content="t('modelPricing.matchPatternTooltip')"
                    />
                  </OButton>
                </div>
                <OFormInput
                  name="match_pattern"
                  :placeholder="t('modelPricing.matchPatternPlaceholder')"
                  data-test="model-pricing-pattern-input"
                />
              </div>
              <OButton
                variant="ghost"
                size="icon-xs-sq"
                class="opacity-50 text-(--q-primary) hover:opacity-100"
                data-test="model-pricing-pattern-examples-btn"
                @click="showExamples = true"
              >
                <OIcon name="lightbulb-outline" size="xs" />
                <OTooltip
                  side="top"
                  align="end"
                  :side-offset="4"
                  :content="t('modelPricing.patternExamplesBtn')"
                />
              </OButton>
            </div>
          </div>
        </div>

        <!-- Pattern Examples Dialog -->
        <ODialog
          data-test="model-pricing-editor-examples-dialog"
          v-model:open="showExamples"
          size="sm"
          :title="t('modelPricing.patternExamplesTitle')"
          :sub-title="t('modelPricing.patternExamplesDesc')"
        >
          <div class="examples-table border border-(--o2-border-color) rounded-lg overflow-hidden">
            <div class="grid grid-cols-[180px_1fr_auto] gap-3 py-[6px] px-3 bg-[rgba(0,0,0,0.03)] border-b border-(--o2-border-color) text-[10px] font-bold uppercase tracking-[0.06em] opacity-45 dark:bg-[rgba(255,255,255,0.05)]">
              <span>{{ t("modelPricing.patternExamplesModelCol") }}</span>
              <span>{{ t("modelPricing.patternExamplesPatternCol") }}</span>
            </div>
            <div
              v-for="ex in patternExamples"
              :key="ex.name"
              class="examples-table-row grid grid-cols-[180px_1fr_auto] gap-3 items-center py-2 px-3 border-b border-(--o2-border-color) text-xs"
            >
              <span class="examples-model-name font-medium">{{ ex.name }}</span>
              <code class="font-mono text-[11px] bg-[rgba(0,0,0,0.04)] py-px px-[6px] rounded break-all dark:bg-[rgba(255,255,255,0.08)]">{{ ex.match_pattern }}</code>
              <OButton
                variant="ghost"
                size="icon-xs-sq"
                class="opacity-40 hover:opacity-100"
                :data-test="`model-pricing-example-copy-btn-${ex.name}`"
                @click="copyPattern(ex.match_pattern)"
              >
                <OIcon
                  :name="
                    copiedPattern === ex.match_pattern
                      ? 'check'
                      : 'content-copy'
                  "
                  size="xs"
                  :class="
                    copiedPattern === ex.match_pattern
                      ? 'text-green-500'
                      : ''
                  "
                />
                <OTooltip
                  :side-offset="4"
                  :content="
                    copiedPattern === ex.match_pattern
                      ? t('modelPricing.copied')
                      : t('modelPricing.copyPattern')
                  "
                />
              </OButton>
            </div>
          </div>
        </ODialog>

        <!-- ── Pricing Tiers ── -->
        <div class="border border-(--o2-border-color) rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
          <div class="flex flex-row items-center justify-between gap-3 py-[10px] px-4 bg-[rgba(0,0,0,0.025)] border-b border-(--o2-border-color) rounded-t-[10px] dark:bg-[rgba(255,255,255,0.04)]">
            <div>
              <div class="form-card-title text-[13px] font-semibold">
                {{ t("modelPricing.pricingTiers") }}
              </div>
              <div class="form-card-subtitle text-[11px] opacity-60 mt-px">
                {{ t("modelPricing.pricingTiersDesc") }}
              </div>
            </div>
          </div>

          <div class="form-card-body flex flex-col gap-3 px-4 pt-[10px] pb-2">
            <div
              v-for="(tier, idx) in formTiers"
              :key="idx"
              class="border border-(--o2-border-color) rounded-[10px] overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.05)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]"
            >
              <!-- Tier Header -->
              <div class="flex items-center justify-between gap-2 py-2 px-4 bg-[rgba(0,0,0,0.025)] border-b border-(--o2-border-color) dark:bg-[rgba(255,255,255,0.04)]">
                <div class="flex items-center gap-2">
                  <span class="tier-name-label text-xs font-medium opacity-50 whitespace-nowrap shrink-0">{{
                    t("modelPricing.tierName")
                  }}</span>
                  <OFormInput
                    :name="`tiers[${idx}].name`"
                    :placeholder="t('modelPricing.tierNamePlaceholder')"
                    :data-test="`model-pricing-tier-name-input-${idx}`"
                  />
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  <OButton
                    v-if="formTiers.length > 1"
                    variant="outline-destructive"
                    size="icon"
                    type="button"
                    :data-test="`model-pricing-tier-remove-btn-${idx}`"
                    @click="removeTier(idx)"
                  >
                    <OIcon name="delete" size="sm" />
                  </OButton>
                </div>
              </div>

              <!-- Tier Body -->
              <div class="tier-body p-3 px-4 flex flex-col gap-3">
                <!-- Condition row (non-default tiers only) -->
                <div
                  v-if="idx > 0 && tier.condition"
                  class="py-3 px-[14px] rounded-lg bg-[rgba(0,0,0,0.02)] border border-(--o2-border-color) dark:bg-[rgba(255,255,255,0.03)]"
                >
                  <div class="sub-label mb-2 text-[11px] font-semibold tracking-[0.06em] opacity-65">
                    {{ t("modelPricing.applyTierWhen") }}
                  </div>
                  <div class="flex gap-2 items-end flex-nowrap">
                    <div class="flex-1 min-w-[130px]">
                      <OFormInput
                        :name="`tiers[${idx}].condition.usage_key`"
                        :label="t('modelPricing.usageKeyCol')"
                        :placeholder="t('modelPricing.usageKeyPlaceholder')"
                        :data-test="`model-pricing-tier-condition-key-input-${idx}`"
                      />
                    </div>
                    <div class="w-[90px] flex-shrink-0">
                      <OFormSelect
                        :name="`tiers[${idx}].condition.operator`"
                        :options="operators"
                        label-key="label"
                        value-key="value"
                        :data-test="`model-pricing-tier-condition-operator-select-${idx}`"
                      />
                    </div>
                    <div class="w-[140px] flex-shrink-0">
                      <OFormInput
                        :name="`tiers[${idx}].condition.value`"
                        :label="t('modelPricing.threshold')"
                        type="number"
                        :data-test="`model-pricing-tier-condition-value-input-${idx}`"
                      />
                    </div>
                  </div>
                </div>

                <!-- Quick Setup -->
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="sub-label text-[11px] font-semibold tracking-[0.06em] opacity-65">{{
                    t("modelPricing.quickSetup")
                  }}</span>
                  <OButton
                    v-for="tpl in usageTemplates"
                    :key="tpl.name"
                    variant="pricing-chip"
                    type="button"
                    :active="isTemplateActive(idx, tpl.keys)"
                    class="!rounded-[1.25rem] !h-auto !py-[0.3125rem] !px-[0.875rem] !text-xs !font-medium !gap-[0.375rem]"
                    :data-test="`model-pricing-tier-template-btn-${idx}-${tpl.name.toLowerCase()}`"
                    @click="applyTemplate(idx, tpl.keys)"
                  >
                    <template #icon-left>
                      <span
                        class="pricing-chip-dot w-[7px] h-[7px] rounded-full shrink-0 inline-block"
                        :style="{ background: tpl.color }"
                      />
                    </template>
                    {{ tpl.name }}
                    <span
                      v-if="isTemplateActive(idx, tpl.keys)"
                      class="text-sm leading-none opacity-75 ml-0.5 hover:opacity-100"
                      @click.stop="clearTemplate(idx, tpl.keys)"
                      >×</span
                    >
                  </OButton>
                </div>

                <!-- Price Table -->
                <div>
                  <div class="price-table-label mb-2 text-[11px] font-semibold tracking-[0.03em]">
                    {{ t("modelPricing.tokenPrices") }}
                    <span class="price-table-label-sub font-normal opacity-55 tracking-normal">
                      {{ t("modelPricing.tokenPricesUnit") }}</span
                    >
                  </div>

                  <div class="price-table overflow-hidden">
                    <!-- Column headers (only when rows exist) -->
                    <div
                      v-if="tier.prices.length"
                      class="price-table-head grid grid-cols-[1fr_160px_auto] gap-2 py-[6px] px-3 text-[11px] font-semibold tracking-[0.01em] opacity-45"
                    >
                      <span>{{ t("modelPricing.usageKeyCol") }}</span>
                      <span>{{ t("modelPricing.pricePerMillionHeader") }}</span>
                      <span></span>
                    </div>

                    <!-- Existing rows — form-owned (tiers[i].prices[j]); value
                         is held PER-MILLION so it binds directly. -->
                    <!-- Key by INDEX (matching the index-based field names): a
                         stable-id key makes Vue reuse+reorder row components on a
                         middle delete, but each field's `form.Field` binds to its
                         `name` at creation and does NOT re-bind when the name
                         shifts — so reused rows would show stale (shifted) values.
                         Index keys keep each position's name fixed. (Same pattern
                         as CreateDestinationForm's headers.) -->
                    <div
                      v-for="(_entry, entryIdx) in tier.prices"
                      :key="entryIdx"
                      class="price-row grid grid-cols-[1fr_160px_auto] gap-2 items-start py-0.5 px-3"
                    >
                      <OFormInput
                        :name="`tiers[${idx}].prices[${entryIdx}].key`"
                        :placeholder="t('modelPricing.usageKeyPlaceholder')"
                        :data-test="`model-pricing-price-key-input-${idx}-${entryIdx}`"
                      />
                      <OFormInput
                        :name="`tiers[${idx}].prices[${entryIdx}].value`"
                        type="number"
                        :min="0"
                        step="0.01"
                        :placeholder="t('modelPricing.pricePlaceholder')"
                        :data-test="`model-pricing-price-value-input-${idx}-${entryIdx}`"
                      >
                        <template #icon-left
                          ><span class="price-dollar text-xs pb-0.5">$</span></template
                        >
                      </OFormInput>
                      <!-- Fixed input-height band keeps the delete button centered
                           against the input row even when the key field grows a
                           below-field error (row is items-start so the error can't
                           push the value input / this button downward). -->
                      <div class="h-8.5 flex items-center">
                        <OButton
                          variant="outline-destructive"
                          size="icon"
                          type="button"
                          :data-test="`model-pricing-price-delete-btn-${idx}-${entryIdx}`"
                          @click="removePrice(idx, entryIdx)"
                        >
                          <OIcon name="delete" size="sm" />
                        </OButton>
                      </div>
                    </div>

                    <!-- Empty state -->
                    <div
                      v-if="!tier.prices.length"
                      class="price-empty flex flex-col items-center p-4 gap-[3px]"
                    >
                      <div class="price-empty-title text-xs font-medium">
                        {{ t("modelPricing.noPricesDefined") }}
                      </div>
                      <div class="price-empty-sub text-[11px] opacity-55">
                        {{ t("modelPricing.noPricesDesc") }}
                      </div>
                    </div>

                    <!-- Add row (staging draft, form-owned) -->
                    <div
                      class="price-add-row grid grid-cols-[1fr_160px_auto] gap-2 items-center py-1 px-3"
                      :class="{
                        'price-add-row--no-top': !tier.prices.length,
                      }"
                    >
                      <OFormInput
                        :name="`tiers[${idx}].draftKey`"
                        :placeholder="t('modelPricing.addUsageKeyPlaceholder')"
                        :data-test="`model-pricing-add-price-key-input-${idx}`"
                      />
                      <OFormInput
                        :name="`tiers[${idx}].draftValue`"
                        type="number"
                        :min="0"
                        step="0.01"
                        :placeholder="t('modelPricing.pricePlaceholder')"
                        :data-test="`model-pricing-add-price-value-input-${idx}`"
                      >
                        <template #icon-left
                          ><span class="price-dollar text-xs pb-0.5">$</span></template
                        >
                      </OFormInput>
                      <OButton
                        variant="outline"
                        size="icon"
                        type="button"
                        :disabled="!String(tier.draftKey ?? '').trim()"
                        :data-test="`model-pricing-add-price-btn-${idx}`"
                        @click="addPrice(idx)"
                      >
                        <OIcon name="add" size="xs" />
                      </OButton>
                    </div>
                  </div>

                  <!-- Price Preview Table -->
                  <div
                    v-if="previewEntries(tier).length"
                    class="mt-5 border rounded"
                    style="
                      background: rgba(0, 0, 0, 0.015);
                      border-color: var(--o2-border-color);
                    "
                  >
                    <div
                      class="px-4 py-2 text-xs text-gray-500 font-semibold border-b"
                      style="border-color: var(--o2-border-color)"
                    >
                      {{ t("modelPricing.pricePreview") }}
                    </div>
                    <table
                      class="w-full text-xs"
                      style="border-collapse: collapse"
                    >
                      <thead>
                        <tr
                          class="text-left text-gray-400 border-b"
                          style="border-color: var(--o2-border-color)"
                        >
                          <th class="px-4 py-2 font-medium">
                            {{ t("modelPricing.usageType") }}
                          </th>
                          <th class="px-4 py-2 font-medium">
                            {{ t("modelPricing.perThousand") }}
                          </th>
                          <th class="px-4 py-2 font-medium">
                            {{ t("modelPricing.perMillion") }}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="entry in previewEntries(tier)"
                          :key="entry.pending ? '__pending__' : entry.key"
                          class="border-b last:border-none"
                          :class="{
                            'preview-row-pending opacity-50 italic': entry.pending,
                          }"
                          style="border-color: var(--o2-border-color)"
                        >
                          <td
                            class="px-4 py-2 text-gray-600 font-medium"
                          >
                            {{ entry.key }}
                          </td>
                          <td class="px-4 py-2 text-gray-600">
                            ${{ formatPreviewCost(fromPerMillion(entry.value), 1000) }}
                          </td>
                          <td class="px-4 py-2 text-gray-600">
                            ${{ formatPreviewCost(fromPerMillion(entry.value), 1000000) }}
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
              type="button"
              class="self-start"
              data-test="model-pricing-add-tier-btn"
              @click="addTier"
            >
              {{ t("modelPricing.addTier") }}
            </OButton>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="page-footer flex items-center justify-end gap-2 px-6 h-[50px] shrink-0 border-t border-(--o2-border-color)">
      <OButton
        variant="outline"
        size="sm-action"
        type="button"
        :disabled="isSubmitting"
        @click="goBack"
        data-test="model-pricing-editor-cancel-btn"
      >
        {{ t("modelPricing.cancel") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm-action"
        type="submit"
        :loading="isSubmitting"
        data-test="model-pricing-editor-save-btn"
      >
        {{ t("modelPricing.save") }}
      </OButton>
    </div>
    </OForm>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onBeforeMount } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import modelPricingService from "@/services/model_pricing";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { copyToClipboard } from "@/utils/clipboard";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  makeModelPricingSchema,
  type ModelPricingForm,
} from "./ModelPricingEditor.schema";

const { t } = useI18n();
const store = useStore();
const router = useRouter();
const route = useRoute();

const existingModels = ref<any[]>([]);

const showExamples = ref(false);
const copiedPattern = ref<string | null>(null);

function copyPattern(pattern: string) {
  copyToClipboard(pattern, { silent: true }).then((success) => {
    if (success) {
      copiedPattern.value = pattern;
      setTimeout(() => {
        copiedPattern.value = null;
      }, 1500);
    }
  });
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

// Scalar validation is now schema-driven (name + match_pattern). The manual
// nameError/regexError computeds + nameTouched/patternTouched refs + the
// :disabled Save gate are gone (R3).
const modelPricingSchema = makeModelPricingSchema(t);

const isEdit = computed(
  () => !!route.query.id && route.query.duplicate !== "true",
);
const headerTitle = computed(() =>
  isEdit.value ? t("modelPricing.editTitle") : t("modelPricing.newTitle"),
);

const model = ref<any>(createEmptyModel());

// Dynamic defaults (edit-prefill projects the working model) → a typed computed.
// `model.value` holds the API-shaped record (per-token price MAP); the form holds
// the per-million ROW shape, so convert. For edit mode the async load re-seeds
// the form via form.reset(modelToForm(...)) in onBeforeMount once data arrives.
const modelPricingDefaults = computed(
  (): ModelPricingForm => modelToForm(model.value),
);

// Rule ③ OWNER pattern: this component OWNS <OForm> and must read the form-owned
// `tiers` array reactively to drive the v-for rows, so it creates the form here
// with useOForm and hands it to <OForm :form="form"> — ONE source of truth, no
// mirror ref / store.subscribe copy. `save` is the awaited submit handler (auto
// Save spinner). Async edit-prefill re-seeds via form.reset() once data loads.
const form = useOForm<ModelPricingForm>({
  defaultValues: modelPricingDefaults.value,
  schema: modelPricingSchema,
  onSubmit: save,
});

// Reactive view of the form-owned `tiers` array — form.useStore tracks array
// mutations (a plain form.state.values read in a computed would not).
const formTiers = form.useStore((s: any) => s.values.tiers ?? []);

function createEmptyModel() {
  return {
    id: null,
    name: "",
    match_pattern: "",
    enabled: true,
    tiers: [newTier(t("modelPricing.tierDefaultName"))],
  };
}

// API-shaped tier (per-token price map). Used to seed the working `model`.
function newTier(name: string, condition: any = null) {
  return { name, condition, prices: {} as Record<string, number> };
}

// ── map ↔ rows converters (the field-array unlock) ───────────────────────────
// One blank FORM tier (per-million row shape) for "Add tier".
function newFormTier(name: string, condition: any = null) {
  return {
    name,
    condition,
    prices: [] as Array<{ key: string; value: number }>,
    draftKey: "",
    draftValue: 0,
  };
}

// API model (per-token price MAP) → FORM value (per-million ROW array).
function modelToForm(m: any): ModelPricingForm {
  const tiers = (m?.tiers ?? []).map((tier: any, i: number) => ({
    name: tier.name ?? "",
    condition:
      i === 0
        ? null
        : tier.condition
          ? { ...tier.condition }
          : { usage_key: "input", operator: "gt", value: 0 },
    prices: Object.entries(tier.prices ?? {}).map(([k, v]) => ({
      key: k,
      value: toPerMillion(Number(v)),
    })),
    draftKey: "",
    draftValue: 0,
  }));
  return {
    name: m?.name ?? "",
    match_pattern: m?.match_pattern ?? "",
    tiers,
  };
}

// FORM value (per-million ROW array) → API tiers (per-token price MAP). Drops
// blank keys and auto-commits each tier's non-empty draft row.
function formToModelTiers(tiers: any[]): any[] {
  return (tiers ?? []).map((tier: any, i: number) => {
    const prices: Record<string, number> = {};
    for (const row of tier.prices ?? []) {
      const k = String(row.key ?? "").trim();
      if (k) prices[k] = fromPerMillion(Number(row.value) || 0);
    }
    const dk = String(tier.draftKey ?? "").trim();
    if (dk) prices[dk] = fromPerMillion(Number(tier.draftValue) || 0);
    return {
      name: tier.name,
      condition:
        i === 0
          ? null
          : tier.condition
            ? {
                usage_key: tier.condition.usage_key,
                operator: tier.condition.operator,
                value: Number(tier.condition.value) || 0,
              }
            : null,
      prices,
    };
  });
}

// Replace the whole form-owned tiers array (the safe field-array mutation, as
// CreateDestinationForm does for `headers`); `formTiers` (form.useStore) re-syncs
// reactively and the template re-renders.
function setTiers(next: any[]) {
  form.setFieldValue("tiers", next, { dontUpdateMeta: true });
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

// ── Field-array operations (whole-array setFieldValue; `formTiers`
//    (form.useStore) re-syncs reactively + re-renders) ──────────────────────
function addTier() {
  setTiers([
    ...formTiers.value,
    newFormTier(t("modelPricing.tierConditionalName"), {
      usage_key: "input",
      operator: "gt",
      value: 200000,
    }),
  ]);
}

function removeTier(idx: number) {
  setTiers(formTiers.value.filter((_: any, i: number) => i !== idx));
}

function removePrice(tierIdx: number, entryIdx: number) {
  setTiers(
    formTiers.value.map((tier: any, i: number) =>
      i !== tierIdx
        ? tier
        : {
            ...tier,
            prices: tier.prices.filter(
              (_: any, j: number) => j !== entryIdx,
            ),
          },
    ),
  );
}

// Commit a tier's staging draft row into its committed price rows, then clear
// the draft. (Validation of the key happens schema-side / at submit.)
function addPrice(tierIdx: number) {
  setTiers(
    formTiers.value.map((tier: any, i: number) => {
      if (i !== tierIdx) return tier;
      const dk = String(tier.draftKey ?? "").trim();
      if (!dk) return tier;
      return {
        ...tier,
        prices: [
          ...tier.prices,
          { key: dk, value: Number(tier.draftValue) || 0 },
        ],
        draftKey: "",
        draftValue: 0,
      };
    }),
  );
}

function isTemplateActive(tierIdx: number, templateKeys: string[]): boolean {
  const tier = formTiers.value[tierIdx];
  if (!tier) return false;
  const priceKeys = (tier.prices ?? []).map((r: any) => r.key);
  if (priceKeys.length !== templateKeys.length) return false;
  return templateKeys.every((k) => priceKeys.includes(k));
}

function applyTemplate(tierIdx: number, keys: string[]) {
  setTiers(
    formTiers.value.map((tier: any, i: number) => {
      if (i !== tierIdx) return tier;
      const newPrices = keys.map((k) => {
        const found = (tier.prices ?? []).find((r: any) => r.key === k);
        return { key: k, value: found ? found.value : 0 };
      });
      return { ...tier, prices: newPrices };
    }),
  );
}

function clearTemplate(tierIdx: number, keys: string[]) {
  setTiers(
    formTiers.value.map((tier: any, i: number) =>
      i !== tierIdx
        ? tier
        : {
            ...tier,
            prices: (tier.prices ?? []).filter(
              (r: any) => !keys.includes(r.key),
            ),
          },
    ),
  );
}

function toPerMillion(perToken: number): number {
  return perToken ? +(perToken * 1_000_000).toPrecision(10) : 0;
}

function fromPerMillion(perMillion: number): number {
  return perMillion > 0 ? perMillion / 1_000_000 : 0;
}

/** Live preview = committed price rows + the (non-empty) draft. Values are
 *  PER-MILLION; the template converts to per-token for the cost columns. */
function previewEntries(
  tier: any,
): Array<{ key: string; value: number; pending?: boolean }> {
  const out = (tier.prices ?? [])
    .filter((r: any) => String(r.key ?? "").trim())
    .map((r: any) => ({ key: String(r.key), value: Number(r.value) || 0 }));
  const dk = String(tier.draftKey ?? "").trim();
  if (dk && !out.find((e: any) => e.key === dk)) {
    out.push({ key: dk, value: Number(tier.draftValue) || 0, pending: true });
  }
  return out;
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

function goBack() {
  router.push({
    name: "modelPricing",
    query: { org_identifier: orgIdentifier.value },
  });
}

function notifyWarn(message: string) {
  toast({ variant: "error", message });
}

/** Show error notification only for non-403 errors.
 *  403 errors are already handled by the global HTTP interceptor (persistent top banner). */
function notifyError(prefix: string, e: any) {
  if (e?.response?.status === 403) return;
  const msg =
    e?.response?.data?.message || e?.message || t("modelPricing.errUnknown");
  toast({
    variant: "error",
    message: `${prefix}: ${msg}`,
    timeout: 5000,
  });
}

// @submit handler. The schema validates name/match_pattern + per-row key
// validity + condition.usage_key before @submit fires (R3). Two STRUCTURAL
// rules that don't map to a single field stay here as guards (toasts): a draft
// row with a value but no key, and "the default tier needs ≥1 non-zero price".
// `value` is the raw form value (per-million ROW shape); convert to the API
// (per-token MAP) shape for the payload.
async function save(value?: ModelPricingForm) {
  const tiers = (value?.tiers ?? formTiers.value) as any[];

  // Draft-row guards: a non-empty draft key must be a valid usage key; a draft
  // with a value but no key is an error (mirrors the old addPrice/save guards).
  for (const tier of tiers) {
    const dk = String(tier.draftKey ?? "").trim();
    if (dk) {
      const keyError = validateUsageKey(dk);
      if (keyError) {
        notifyWarn(keyError);
        return;
      }
    } else if (Number(tier.draftValue) > 0) {
      notifyWarn(t("modelPricing.tierPriceMissingKey", { name: tier.name }));
      return;
    }
  }

  // Require at least one non-zero price in the default tier (committed + draft).
  const defaultTier = tiers[0];
  if (defaultTier) {
    const values = (defaultTier.prices ?? [])
      .filter((r: any) => String(r.key ?? "").trim())
      .map((r: any) => Number(r.value) || 0);
    if (String(defaultTier.draftKey ?? "").trim()) {
      values.push(Number(defaultTier.draftValue) || 0);
    }
    if (values.length === 0 || values.every((v: number) => v === 0)) {
      notifyWarn(t("modelPricing.addDefaultPrice"));
      return;
    }
  }

  // Build the API-shaped payload: keep the loaded record's metadata (id,
  // enabled, valid_from, sort_order, org_id, source) from `model`, take the
  // validated scalars + converted tiers from the form.
  const m: any = {
    ...model.value,
    name: value?.name ?? model.value.name,
    match_pattern: value?.match_pattern ?? model.value.match_pattern,
    tiers: formToModelTiers(tiers),
  };

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

  // Loading is form-driven: OForm awaits this handler, so the Save button's
  // spinner (isSubmitting) spans the POST — no manual flag needed.
  try {
    if (m.id) {
      await modelPricingService.update(orgIdentifier.value, m.id, m);
    } else {
      await modelPricingService.create(orgIdentifier.value, m);
    }
    if (patternConflicts.length > 0) {
      const winner = patternConflicts[0].name;
      toast({
        variant: "warning",
        message: t("modelPricing.saveShadowedWarning", { winner }),
        timeout: 8000,
      });
    } else {
      toast({
        variant: "success",
        message: t("modelPricing.modelPricingSaved"),
      });
    }
    goBack();
  } catch (e: any) {
    notifyError(t("modelPricing.errSave"), e);
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
        if (isDuplicate) {
          model.value.id = null;
          model.value.org_id = orgIdentifier.value;
          model.value.name = model.value.name + t("settings.modelPricingEditor.copySuffix");
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
        // Data arrived after mount → re-seed the whole form (scalars + the
        // converted tier/price rows) once (the documented "async edit-prefill"
        // pattern; not a per-keystroke watch). formTiers (form.useStore) updates
        // reactively from the reset — no manual re-sync.
        form.reset(modelToForm(model.value));
      }
    } catch (e: any) {
      notifyError(t("modelPricing.errLoadModel"), e);
    }
  }
});
</script>

<style>
/* :last-child pseudo selector — kept in <style> per project rules */
.examples-table-row:last-child {
  border-bottom: none;
}
</style>
