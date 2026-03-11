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
  <q-page class="q-pa-none" style="min-height: inherit; height: calc(100vh - 88px)">

    <!-- Full-page Import View -->
    <ImportModelPricing
      v-if="showImportModelPricingPage"
      :existing-models="models.filter((m: any) => !m.inherited).map((m: any) => m.name)"
      @cancel:hideform="showImportModelPricingPage = false"
      @update:list="fetchModels"
    />

    <!-- Main List View -->
    <div v-if="!showImportModelPricingPage">

    <!-- Editor Dialog -->
    <q-dialog v-model="showEditor" persistent>
      <q-card style="min-width: 600px; max-width: 800px">
        <q-card-section>
          <div class="text-h6">
            {{ editingModel?.id ? "Edit Model Pricing" : "New Model Pricing" }}
          </div>
        </q-card-section>

        <q-card-section class="q-pt-none" style="display: flex; flex-direction: column; gap: 16px; max-height: 70vh; overflow-y: auto;">
          <q-input
            v-model="editingModel.name"
            label="Model Name *"
            dense
            outlined
            :rules="[(val: string) => !!val?.trim() || 'Model name is required']"
            reactive-rules
            lazy-rules
            data-test="model-pricing-name-input"
          />

          <!-- Match pattern with live regex validation -->
          <q-input
            v-model="editingModel.match_pattern"
            label="Match Pattern (Regex) *"
            dense
            outlined
            :rules="[
              (val: string) => !!val?.trim() || 'Match pattern is required',
              () => !patternError || patternError,
            ]"
            reactive-rules
            lazy-rules
            data-test="model-pricing-pattern-input"
          >
            <template #append>
              <q-icon
                v-if="patternPreview && !patternError"
                name="check_circle"
                color="positive"
                size="18px"
              />
            </template>
          </q-input>

          <!-- Tiers -->
          <div>
            <div class="text-subtitle2 q-mb-sm">Pricing Tiers</div>
            <div
              v-for="(tier, idx) in editingModel.tiers"
              :key="idx"
              class="q-mb-md q-pa-md"
              style="border: 1px solid #ddd; border-radius: 6px; display: flex; flex-direction: column; gap: 12px"
            >
              <!-- Tier header: name + delete -->
              <div style="display: flex; align-items: flex-start; gap: 8px">
                <q-input
                  v-model="tier.name"
                  :label="idx === 0 ? 'Default Tier' : 'Tier Name'"
                  dense
                  outlined
                  style="flex: 1"
                />
                <q-btn
                  v-if="editingModel.tiers.length > 1"
                  padding="sm"
                  unelevated
                  size="sm"
                  round
                  flat
                  icon="delete"
                  color="negative"
                  style="margin-top: 2px; flex-shrink: 0"
                  @click="removeTier(idx)"
                />
              </div>

              <!-- Condition (non-default tiers) -->
              <div v-if="idx > 0 && tier.condition">
                <div class="text-caption q-mb-xs" style="font-weight: 600">Apply when</div>
                <div style="display: flex; gap: 8px; align-items: center">
                  <q-input
                    v-model="tier.condition.usage_key"
                    label="Usage Key"
                    dense
                    outlined
                    style="flex: 1"
                    placeholder="input"
                  />
                  <q-select
                    v-model="tier.condition.operator"
                    :options="operators"
                    dense
                    outlined
                    options-dense
                    emit-value
                    map-options
                    style="min-width: 100px; flex-shrink: 0"
                    :display-value="operators.find((o: any) => o.value === tier.condition.operator)?.label || ''"
                  />
                  <q-input
                    v-model.number="tier.condition.value"
                    label="Threshold"
                    type="number"
                    dense
                    outlined
                    style="width: 140px; flex-shrink: 0"
                  />
                </div>
              </div>

              <!-- Template prefill -->
              <div>
                <div class="text-caption q-mb-xs" style="color: #666">Prefill from template:</div>
                <div style="display: flex; gap: 6px">
                  <q-btn
                    v-for="tpl in usageTemplates"
                    :key="tpl.name"
                    unelevated
                    no-caps
                    size="sm"
                    :label="tpl.name"
                    :color="isTemplateActive(tier, tpl.keys) ? 'primary' : undefined"
                    :outline="!isTemplateActive(tier, tpl.keys)"
                    :style="!isTemplateActive(tier, tpl.keys) ? 'border: 1px solid #ccc; border-radius: 4px' : 'border-radius: 4px'"
                    @click="applyTemplate(tier, tpl.keys)"
                  />
                </div>
              </div>

              <!-- Existing prices -->
              <div>
                <div class="text-caption q-mb-xs" style="font-weight: 600">Prices ($ per 1M tokens)</div>
                <div
                  v-for="(price, pkey) in tier.prices"
                  :key="pkey"
                  style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px"
                >
                  <q-input
                    :model-value="pkey"
                    label="Usage Key"
                    dense
                    outlined
                    style="flex: 1"
                    @update:model-value="(val: any) => renamePrice(tier, pkey as string, val)"
                  />
                  <q-input
                    :model-value="toPerMillion(price as number)"
                    label="$ per 1M tokens"
                    type="number"
                    :min="0"
                    step="0.01"
                    dense
                    outlined
                    style="flex: 1"
                    @update:model-value="(val: any) => updatePrice(tier, pkey as string, fromPerMillion(Number(val)))"
                  />
                  <q-btn
                    padding="sm"
                    unelevated
                    size="sm"
                    round
                    flat
                    icon="close"
                    color="negative"
                    style="flex-shrink: 0"
                    @click="deletePrice(tier, pkey as string)"
                  />
                </div>

                <!-- Add new price row -->
                <div class="text-caption q-mb-xs" style="color: #888; margin-top: 4px">Add price:</div>
                <div style="display: flex; align-items: center; gap: 8px">
                  <q-input
                    v-model="addState[idx].key"
                    label="Usage key"
                    dense
                    outlined
                    style="flex: 1"
                    placeholder="e.g. input, output"
                  />
                  <q-input
                    v-model.number="addState[idx].value"
                    label="$ per 1M tokens"
                    type="number"
                    :min="0"
                    step="0.01"
                    dense
                    outlined
                    style="flex: 1"
                  />
                  <q-btn
                    padding="sm"
                    unelevated
                    size="sm"
                    round
                    flat
                    icon="add"
                    color="primary"
                    style="flex-shrink: 0"
                    @click="addPrice(tier, idx)"
                  />
                </div>
              </div>

              <!-- Price Preview -->
              <div v-if="pricePreviewRows(tier).length">
                <div class="text-caption q-mb-xs" style="font-weight: 600">Preview</div>
                <q-markup-table dense flat bordered separator="cell" style="font-size: 12px">
                  <thead>
                    <tr>
                      <th class="text-left">Usage Type</th>
                      <th class="text-right">$ per 1M tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in pricePreviewRows(tier)" :key="row.key">
                      <td>{{ row.key }}</td>
                      <td class="text-right">${{ row.per1M }}</td>
                    </tr>
                  </tbody>
                </q-markup-table>
              </div>
            </div>

            <q-btn
              flat
              no-caps
              icon="add"
              label="Add Tier"
              color="primary"
              @click="addTier"
            />
          </div>
        </q-card-section>

        <q-card-actions align="right" class="q-px-md q-pb-md">
          <q-btn
            class="o2-secondary-button tw:h-[36px]"
            label="Cancel"
            no-caps
            flat
            @click="showEditor = false"
          />
          <q-btn
            class="o2-primary-button no-border tw:h-[36px]"
            no-caps
            flat
            label="Save"
            @click="saveModel"
            :loading="saving"
            data-test="model-pricing-save-btn"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- List View Header -->
    <div
      class="tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-3 tw:h-[68px] tw:border-b-[1px]"
    >
      <div class="q-table__title tw:font-[600]" data-test="model-pricing-list-title">
        LLM Model Pricing
      </div>
      <div class="tw:flex tw:justify-end">
        <q-input
          v-model="filterQuery"
          borderless
          dense
          class="q-ml-auto no-border o2-search-input"
          placeholder="Search models..."
        >
          <template #prepend>
            <q-icon class="o2-search-input-icon" name="search" />
          </template>
        </q-input>
        <q-btn
          v-if="selectedCount > 0"
          class="o2-secondary-button q-ml-sm tw:h-[36px]"
          no-caps
          flat
          icon="upload"
          :label="`Export (${selectedCount})`"
          @click="exportSelected"
          data-test="model-pricing-export-selected-btn"
        />
        <q-btn
          v-if="selectedCount > 0"
          class="o2-secondary-button q-ml-sm tw:h-[36px]"
          no-caps
          flat
          :icon="outlinedDelete"
          :label="`Delete (${selectedCount})`"
          color="negative"
          @click="confirmDeleteSelected"
          data-test="model-pricing-delete-selected-btn"
        />
        <q-btn
          class="o2-secondary-button q-ml-sm tw:h-[36px]"
          no-caps
          flat
          icon="download"
          label="Import Models"
          @click="openImport"
          data-test="model-pricing-import-btn"
        />
        <q-btn
          class="o2-primary-button q-ml-sm tw:h-[36px]"
          no-caps
          flat
          label="New Model"
          @click="openEditor(null)"
          data-test="model-pricing-add-btn"
        />
      </div>
    </div>

    <!-- List Table -->
    <q-table
      data-test="model-pricing-list-table"
      :rows="filteredModels"
      :columns="columns"
      row-key="id"
      :pagination="pagination"
      class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
      :style="
        filteredModels.length > 0
          ? 'width: 100%; height: calc(100vh - 112px); overflow-y: auto;'
          : 'width: 100%'
      "
    >
      <template #header-cell-select>
        <q-th style="width: 40px; text-align: center;">
          <q-checkbox
            :model-value="allSelected"
            :indeterminate="someSelected"
            dense
            @update:model-value="toggleSelectAll"
            data-test="model-pricing-select-all"
          />
        </q-th>
      </template>

      <template #no-data>
        <div class="full-width column flex-center q-mt-xs full-height" style="font-size: 1.5rem">
          <div class="text-subtitle1 q-mb-sm">No model pricing definitions</div>
          <div class="text-caption q-mb-md">
            Click "New Model" to add a custom pricing definition.
          </div>
        </div>
      </template>

      <template v-slot:body="props">
        <!-- Section separator when inherited entries begin -->
        <q-tr
          v-if="props.row.__inheritedSectionStart"
          class="inherited-section-header"
        >
          <q-td :colspan="columns.length" style="padding: 10px 16px; background: #f5f5f5; border-bottom: 1px solid #ddd;">
            <div class="tw:flex tw:items-center tw:gap-2">
              <q-icon name="corporate_fare" size="18px" color="grey-7" />
              <span class="text-caption" style="font-weight: 600; color: #555;">
                Inherited from Meta Org
              </span>
              <span class="text-caption" style="color: #888;">
                &mdash; Read-only. Duplicate to create your own copy, then disable this one if needed.
              </span>
            </div>
          </q-td>
        </q-tr>

        <q-tr
          :props="props"
          :class="{ 'inherited-row': props.row.inherited }"
        >
          <q-td v-for="col in columns" :key="col.name" :props="props" :style="col.style">
            <template v-if="col.name === 'select'">
              <q-checkbox
                v-if="!props.row.inherited"
                :model-value="selectedIds.has(props.row.id)"
                dense
                @update:model-value="toggleSelect(props.row.id)"
                :data-test="`model-pricing-select-${props.rowIndex}`"
              />
            </template>
            <template v-else-if="col.name === 'name'">
              <div class="o2-table-cell-content tw:font-semibold tw:flex tw:items-center tw:gap-2">
                {{ props.row.name }}
                <q-badge
                  v-if="props.row.inherited"
                  color="blue-grey-3"
                  text-color="blue-grey-8"
                  label="Inherited"
                  style="font-size: 10px; padding: 2px 6px;"
                />
              </div>
            </template>
            <template v-else-if="col.name === 'match_pattern'">
              <div class="o2-table-cell-content">
                <code class="text-caption">{{ props.row.match_pattern }}</code>
              </div>
            </template>
            <template v-else-if="col.name === 'pricing'">
              <div class="o2-table-cell-content">
                <span v-if="getDefaultTier(props.row)">
                  {{ formatPerMillion(getDefaultTier(props.row).prices?.input) }} /
                  {{ formatPerMillion(getDefaultTier(props.row).prices?.output) }}
                </span>
              </div>
            </template>
            <template v-else-if="col.name === 'enabled'">
              <q-toggle
                v-if="!props.row.inherited"
                :model-value="props.row.enabled"
                @update:model-value="(val: boolean) => toggleEnabled(props.row, val)"
                dense
              />
              <q-icon
                v-else
                :name="props.row.enabled ? 'check_circle' : 'cancel'"
                :color="props.row.enabled ? 'positive' : 'grey-5'"
                size="20px"
              />
            </template>
            <template v-else-if="col.name === 'actions'">
              <div class="tw:flex tw:items-center tw:gap-1 tw:justify-center">
                <!-- Own entries: edit + delete + duplicate + export -->
                <template v-if="!props.row.inherited">
                  <q-btn
                    padding="sm"
                    unelevated
                    size="sm"
                    round
                    flat
                    icon="edit"
                    title="Edit"
                    @click.stop="openEditor(props.row)"
                    data-test="model-pricing-edit-btn"
                  />
                  <q-btn
                    padding="sm"
                    unelevated
                    size="sm"
                    round
                    flat
                    icon="content_copy"
                    title="Duplicate"
                    @click.stop="duplicateModel(props.row)"
                    data-test="model-pricing-duplicate-btn"
                  />
                  <q-btn
                    padding="sm"
                    unelevated
                    size="sm"
                    round
                    flat
                    icon="upload"
                    title="Export"
                    @click.stop="exportModel(props.row)"
                    data-test="model-pricing-export-btn"
                  />
                  <q-btn
                    padding="sm"
                    unelevated
                    size="sm"
                    round
                    flat
                    :icon="outlinedDelete"
                    title="Delete"
                    @click.stop="confirmDelete(props.row)"
                    data-test="model-pricing-delete-btn"
                  />
                </template>
                <!-- Inherited entries: duplicate + export (read-only otherwise) -->
                <template v-else>
                  <q-btn
                    padding="sm"
                    unelevated
                    size="sm"
                    round
                    flat
                    icon="content_copy"
                    title="Duplicate to this org"
                    @click.stop="duplicateModel(props.row)"
                    data-test="model-pricing-duplicate-btn"
                  />
                  <q-btn
                    padding="sm"
                    unelevated
                    size="sm"
                    round
                    flat
                    icon="upload"
                    title="Export"
                    @click.stop="exportModel(props.row)"
                    data-test="model-pricing-export-inherited-btn"
                  />
                </template>
              </div>
            </template>
            <template v-else>
              <div class="o2-table-cell-content">
                {{ props.row[col.field] }}
              </div>
            </template>
          </q-td>
        </q-tr>
      </template>

      <template #bottom="scope">
        <div class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[48px]">
          <div class="o2-table-footer-title tw:flex tw:items-center tw:gap-4 tw:mr-md">
            <span>{{ resultTotal }} models</span>
            <span v-if="selectedCount > 0" class="text-primary tw:font-semibold">
              {{ selectedCount }} selected
            </span>
          </div>
        </div>
      </template>
    </q-table>
    </div> <!-- end v-if="!showImportModelPricingPage" -->
  </q-page>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onBeforeMount, onActivated } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";
import modelPricingService from "@/services/model_pricing";
import ImportModelPricing from "@/components/settings/ImportModelPricing.vue";

const store = useStore();
const router = useRouter();
const q = useQuasar();

const models = ref<any[]>([]);
const filterQuery = ref("");
const showEditor = ref(false);
const showImportModelPricingPage = ref(false);
const saving = ref(false);
const selectedIds = ref<Set<string>>(new Set());

// Per-tier add-price state: array of { key, value } indexed by tier position
const addState = ref<Array<{ key: string; value: number }>>([{ key: "", value: 0 }]);

const editingModel = ref<any>(createEmptyModel());

// Regex validation state
const patternError = ref("");
const patternPreview = ref(false);

watch(
  () => editingModel.value.match_pattern,
  (pattern: string) => {
    if (!pattern) {
      patternError.value = "";
      patternPreview.value = false;
      return;
    }
    try {
      // Strip inline flags like (?i), (?m), (?s), (?ims) etc.
      // These are valid in Rust regex but not in JS RegExp.
      const jsPattern = pattern.replace(/\(\?[imsx]+\)/g, "");
      new RegExp(jsPattern);
      patternError.value = "";
      patternPreview.value = true;
    } catch (e: any) {
      patternError.value = e.message;
      patternPreview.value = false;
    }
  }
);

// Usage type template prefill keys (canonical names matching our usage extractor)
const usageTemplates = [
  {
    name: "OpenAI",
    keys: ["input", "output", "cache_read_input_tokens", "output_reasoning_tokens"],
  },
  {
    name: "Anthropic",
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

const columns: any[] = [
  { name: "select", label: "", field: "select", align: "center", style: "width: 40px" },
  { name: "name", label: "Model", field: "name", align: "left", sortable: true },
  { name: "match_pattern", label: "Pattern", field: "match_pattern", align: "left", style: "max-width: 300px; overflow: hidden;" },
  { name: "pricing", label: "Input / Output (per 1M)", field: "pricing", align: "left" },
  { name: "enabled", label: "Enabled", field: "enabled", align: "center" },
  { name: "actions", label: "Actions", field: "actions", align: "left", classes: "actions-column" },
];

const pagination = ref({ rowsPerPage: 20 });

const resultTotal = computed(() => filteredModels.value.length);

// Selection helpers — only own (non-inherited) models can be selected
const selectableModels = computed(() =>
  filteredModels.value.filter((m: any) => !m.inherited)
);
const selectedCount = computed(() => selectedIds.value.size);
const allSelected = computed(() =>
  selectableModels.value.length > 0 &&
  selectableModels.value.every((m: any) => selectedIds.value.has(m.id))
);
const someSelected = computed(() =>
  selectedCount.value > 0 && !allSelected.value
);

function toggleSelectAll() {
  if (allSelected.value) {
    selectedIds.value = new Set();
  } else {
    selectedIds.value = new Set(selectableModels.value.map((m: any) => m.id));
  }
}

function toggleSelect(id: string) {
  const next = new Set(selectedIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selectedIds.value = next;
}

const filteredModels = computed(() => {
  let items = models.value;
  if (filterQuery.value) {
    const search = filterQuery.value.toLowerCase();
    items = items.filter(
      (m: any) =>
        m.name.toLowerCase().includes(search) || m.match_pattern.toLowerCase().includes(search)
    );
  }
  // Sort: org-specific first, then inherited. Mark where inherited section starts.
  const orgItems = items.filter((m: any) => !m.inherited);
  const inheritedItems = items.filter((m: any) => m.inherited);
  const sorted = [...orgItems, ...inheritedItems];
  // Mark the first inherited row so the template can render a section header
  let inheritedStartMarked = false;
  for (const item of sorted) {
    item.__inheritedSectionStart = false;
    if (item.inherited && !inheritedStartMarked) {
      item.__inheritedSectionStart = true;
      inheritedStartMarked = true;
    }
  }
  return sorted;
});

function newTier(name: string, condition: any = null) {
  return { name, condition, prices: {} as Record<string, number> };
}

function createEmptyModel() {
  return {
    id: null,
    name: "",
    match_pattern: "",
    enabled: true,
    tiers: [newTier("Default")],
  };
}

function resetAddState(tierCount: number) {
  addState.value = Array.from({ length: tierCount }, () => ({ key: "", value: 0 }));
}

function getDefaultTier(model: any) {
  return model.tiers?.[0];
}

function formatPerMillion(pricePerToken: number | undefined): string {
  if (!pricePerToken) return "$0";
  const perMillion = pricePerToken * 1_000_000;
  return `$${perMillion.toFixed(2)}`;
}

const orgIdentifier = computed(
  () => store.state.selectedOrganization?.identifier || ""
);

async function fetchModels() {
  try {
    const res = await modelPricingService.list(orgIdentifier.value);
    models.value = res.data || [];
  } catch (e: any) {
    q.notify({ type: "negative", message: "Failed to load models: " + e.message });
  }
}

function openEditor(model: any) {
  if (model) {
    editingModel.value = JSON.parse(JSON.stringify(model));
    // Ensure non-default tiers have a condition object
    for (let i = 1; i < editingModel.value.tiers.length; i++) {
      if (!editingModel.value.tiers[i].condition) {
        editingModel.value.tiers[i].condition = { usage_key: "input", operator: "gt", value: 0 };
      }
    }
  } else {
    editingModel.value = createEmptyModel();
  }
  resetAddState(editingModel.value.tiers.length);
  showEditor.value = true;
}

function addTier() {
  editingModel.value.tiers.push(
    newTier("Conditional Tier", { usage_key: "input", operator: "gt", value: 200000 })
  );
  addState.value.push({ key: "", value: 0 });
}

function removeTier(idx: number) {
  editingModel.value.tiers.splice(idx, 1);
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

function toPerMillion(perToken: number): number {
  return perToken ? +(perToken * 1_000_000).toPrecision(10) : 0;
}

function fromPerMillion(perMillion: number): number {
  return perMillion > 0 ? perMillion / 1_000_000 : 0;
}

function formatPrice(value: number, significantDigits = 4): string {
  if (value === 0) return "0";
  if (Math.abs(value) < 0.00000001) {
    return value.toExponential(significantDigits - 1);
  }
  const absVal = Math.abs(value);
  const decimalPlaces = absVal >= 1
    ? significantDigits
    : Math.max(significantDigits, Math.ceil(-Math.log10(absVal)) + significantDigits);
  return value.toFixed(Math.min(decimalPlaces, 20)).replace(/\.?0+$/, "");
}

function pricePreviewRows(tier: any) {
  return Object.entries(tier.prices as Record<string, number>)
    .filter(([, v]) => v > 0)
    .map(([key, price]) => ({
      key,
      per1M: formatPrice(price * 1_000_000),
    }));
}

function addPrice(tier: any, idx: number | string) {
  const i = Number(idx);
  const key = (addState.value[i]?.key || "").trim();
  if (!key) return;
  tier.prices = { ...tier.prices, [key]: fromPerMillion(addState.value[i].value || 0) };
  addState.value[i] = { key: "", value: 0 };
}

async function saveModel() {
  const model = editingModel.value;
  if (!model.name.trim()) {
    q.notify({ type: "warning", message: "Model name is required" });
    return;
  }
  if (!model.match_pattern.trim()) {
    q.notify({ type: "warning", message: "Match pattern is required" });
    return;
  }

  // First tier is always the default (no condition)
  if (model.tiers.length > 0) {
    model.tiers[0].condition = null;
  }

  saving.value = true;
  try {
    if (model.id) {
      await modelPricingService.update(orgIdentifier.value, model.id, model);
    } else {
      await modelPricingService.create(orgIdentifier.value, model);
    }
    showEditor.value = false;
    q.notify({ type: "positive", message: "Model pricing saved" });
    await fetchModels();
  } catch (e: any) {
    const msg = e.response?.data?.message || e.message;
    q.notify({ type: "negative", message: "Failed to save: " + msg });
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled(model: any, enabled: boolean) {
  try {
    const updated = { ...model, enabled };
    await modelPricingService.update(orgIdentifier.value, model.id, updated);
    model.enabled = enabled;
  } catch (e: any) {
    q.notify({ type: "negative", message: "Failed to update: " + e.message });
  }
}

function duplicateModel(model: any) {
  const copy = JSON.parse(JSON.stringify(model));
  copy.id = null; // new entry
  copy.inherited = false;
  copy.name = copy.name + " (Copy)";
  delete copy.__inheritedSectionStart;
  openEditor(copy);
}

async function confirmDelete(model: any) {
  q.dialog({
    title: "Delete Model Pricing",
    message: `Are you sure you want to delete "${model.name}"?`,
    cancel: true,
    persistent: true,
  }).onOk(async () => {
    try {
      await modelPricingService.delete(orgIdentifier.value, model.id);
      q.notify({ type: "positive", message: "Model pricing deleted" });
      await fetchModels();
    } catch (e: any) {
      q.notify({ type: "negative", message: "Failed to delete: " + e.message });
    }
  });
}

function openImport() {
  showImportModelPricingPage.value = true;
  router.push({
    name: "modelPricing",
    query: {
      org_identifier: store.state.selectedOrganization?.identifier,
      action: "import",
    },
  });
}

function exportModel(model: any) {
  const exportData = {
    name: model.name,
    match_pattern: model.match_pattern,
    enabled: model.enabled,
    tiers: model.tiers,
    sort_order: model.sort_order ?? 0,
    valid_from: model.valid_from ?? null,
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${model.name}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportSelected() {
  const selected = models.value.filter(
    (m: any) => !m.inherited && selectedIds.value.has(m.id)
  );
  if (selected.length === 0) {
    q.notify({ type: "warning", message: "No models selected to export" });
    return;
  }
  const exportData = selected.map((m: any) => ({
    name: m.name,
    match_pattern: m.match_pattern,
    enabled: m.enabled,
    tiers: m.tiers,
    sort_order: m.sort_order ?? 0,
    valid_from: m.valid_from ?? null,
  }));
  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "model_pricing_export.json";
  link.click();
  URL.revokeObjectURL(url);
}

function confirmDeleteSelected() {
  const count = selectedIds.value.size;
  q.dialog({
    title: "Delete Selected Models",
    message: `Are you sure you want to delete ${count} selected model${count !== 1 ? "s" : ""}?`,
    cancel: true,
    persistent: true,
  }).onOk(async () => {
    let successCount = 0;
    for (const id of selectedIds.value) {
      try {
        await modelPricingService.delete(orgIdentifier.value, id);
        successCount++;
      } catch (e: any) {
        q.notify({ type: "negative", message: `Failed to delete model: ${e.message}` });
      }
    }
    if (successCount > 0) {
      q.notify({ type: "positive", message: `Deleted ${successCount} model${successCount !== 1 ? "s" : ""}` });
      selectedIds.value = new Set();
      await fetchModels();
    }
  });
}

onBeforeMount(() => {
  fetchModels();
  if (router.currentRoute.value.query.action === "import") {
    showImportModelPricingPage.value = true;
  }
});

onActivated(() => {
  if (router.currentRoute.value.query.action === "import") {
    showImportModelPricingPage.value = true;
  }
});
</script>

<style lang="scss">
.o2-table-cell-content {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
  display: block;
}

.inherited-row {
  opacity: 0.7;
  background: #fafafa;

  &:hover {
    opacity: 0.85;
  }
}
</style>
