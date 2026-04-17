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
      :existing-models="models.filter((m: any) => !isReadOnly(m)).map((m: any) => m.name)"
      @cancel:hideform="showImportModelPricingPage = false"
      @update:list="fetchModels"
    />

    <!-- Test Match Dialog -->
    <TestModelMatchDialog
      v-model="showTestMatchDialog"
      :models="models"
    />

    <!-- Main List View -->
    <div v-if="!showImportModelPricingPage">

    <!-- List View Header -->
    <div class="tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-3 tw:h-[68px] tw:border-b-[1px]">
      <div class="q-table__title tw:font-[600]" data-test="model-pricing-list-title">
        LLM Model Pricing
        <q-btn icon="info_outline" flat round dense size="sm" color="grey-6" class="tw:mb-0.5">
          <q-tooltip class="bg-grey-9">
            <strong>Model Matching Priority:</strong><br>
            Your Org Models  &gt;  Meta Models  &gt;  Built-in Models
          </q-tooltip>
        </q-btn>
      </div>
      <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <div class="app-tabs-container tw:h-[36px]">
          <app-tabs
            class="tabs-selection-container"
            :tabs="tabOptions"
            v-model:active-tab="selectedTab"
            @update:active-tab="onTabChange"
          />
        </div>
        <q-input
          v-model="filterQuery"
          borderless
          dense
          class="no-border o2-search-input"
          placeholder="Search models..."
        >
          <template #prepend>
            <q-icon class="o2-search-input-icon" name="search" />
          </template>
        </q-input>
        <q-btn
          class="o2-secondary-button tw:h-[36px]"
          no-caps
          flat
          label="Refresh"
          :loading="refreshing"
          @click="refreshBuiltIn"
          data-test="model-pricing-refresh-btn"
        />
        <q-btn
          class="o2-secondary-button tw:h-[36px]"
          no-caps
          flat
          label="Test"
          @click="showTestMatchDialog = true"
          data-test="model-pricing-test-match-btn"
        />
        <q-btn
          class="o2-secondary-button tw:h-[36px]"
          no-caps
          flat
          label="Import"
          @click="openImport"
          data-test="model-pricing-import-btn"
        />
        <q-btn
          class="o2-primary-button tw:h-[36px]"
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
      ref="qTableRef"
      data-test="model-pricing-list-table"
      :rows="filteredModels"
      :columns="columns"
      row-key="id"
      v-model:pagination="pagination"
      :sort-method="customSort"
      class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
      :style="filteredModels.length
        ? 'width: 100%; height: calc(100vh - var(--navbar-height) - 87px); overflow-y: auto;'
        : 'width: 100%'"
    >
      <template v-slot:header="props">
        <q-tr :props="props">
          <q-th
            v-for="col in props.cols"
            :key="col.name"
            :props="props"
            :style="col.style"
          >
            <template v-if="col.name === 'select'">
              <q-checkbox
                v-if="selectableModels.length > 0"
                :model-value="allSelected"
                :indeterminate="someSelected"
                size="sm"
                class="o2-table-checkbox"
                @update:model-value="toggleSelectAll"
                data-test="model-pricing-select-all"
              />
            </template>
            <template v-else>{{ col.label }}</template>
          </q-th>
        </q-tr>
      </template>

      <template #no-data>
        <div v-if="loading" class="full-width column flex-center q-mt-xs" style="font-size: 1.5rem">
          <q-spinner-hourglass size="50px" color="primary" style="margin-top: 20vh" />
        </div>
        <div
          v-else
          class="full-width column flex-center"
          style="height: calc(100vh - 220px); gap: 8px;"
        >
          <q-icon name="monetization_on" size="48px" color="grey-4" />
          <div class="text-subtitle1 text-grey-7 q-mt-sm">No model pricing definitions</div>
          <div class="text-caption text-grey-7">
            Add a custom pricing definition to track LLM token costs.
          </div>
          <q-btn
            class="o2-primary-button q-mt-md tw:h-[36px]"
            no-caps
            flat
            label="New Model"
            @click="openEditor(null)"
            data-test="model-pricing-empty-add-btn"
          />
        </div>
      </template>

      <template v-slot:body="props">
        <q-tr
          :props="props"
        >
          <q-td v-for="col in columns" :key="col.name" :props="props" :style="col.style">
            <template v-if="col.name === 'select'">
              <q-checkbox
                :model-value="selectedIds.includes(props.row.id)"
                size="sm"
                class="o2-table-checkbox"
                @update:model-value="toggleSelect(props.row.id)"
                :data-test="`model-pricing-select-${props.rowIndex}`"
              />
            </template>
            <template v-else-if="col.name === 'name'">
              <div class="tw:flex tw:items-center tw:gap-2 tw:min-w-0">
                <span v-if="getSource(props.row) === 'built_in'" class="tw:shrink-0 tw:cursor-default tw:inline-flex">
                  <img :src="ooLogo" class="tw:w-[16px] tw:h-[16px]" alt="OpenObserve" />
                  <q-tooltip :delay="500" anchor="top middle" self="bottom middle">Built-in model provided by OpenObserve</q-tooltip>
                </span>
                <q-icon
                  v-else-if="getSource(props.row) === 'meta_org' || (getSource(props.row) === 'org' && props.row.org_id !== orgIdentifier)"
                  name="corporate_fare"
                  size="16px"
                  class="tw:shrink-0 tw:text-grey-6 tw:cursor-default"
                >
                  <q-tooltip :delay="500" anchor="top middle" self="bottom middle">Inherited from meta org</q-tooltip>
                </q-icon>
                <q-icon
                  v-else
                  name="person"
                  size="16px"
                  class="tw:shrink-0 tw:text-grey-6 tw:cursor-default"
                >
                  <q-tooltip :delay="500" anchor="top middle" self="bottom middle">Custom model</q-tooltip>
                </q-icon>
                <div class="o2-table-cell-content tw:font-semibold">
                  {{ props.row.name }}
                </div>
                <q-tooltip
                  v-if="props.row.name.length > 30"
                  anchor="top middle"
                  self="bottom middle"
                  :delay="500"
                  style="max-width: none; white-space: normal; word-break: break-all;"
                >
                  {{ props.row.name }}
                </q-tooltip>
              </div>
            </template>
            <template v-else-if="col.name === 'match_pattern'">
              <div class="tw:flex tw:items-center tw:gap-1">
                <code
                  class="text-caption pattern-code o2-table-cell-content"
                  :class="{'tw:opacity-40': !!getShadowedBy(props.row)}"
                >
                  {{ props.row.match_pattern }}
                </code>
                <q-icon
                  v-if="getShadowedBy(props.row)"
                  name="warning_amber"
                  size="14px"
                  color="warning"
                  class="tw:cursor-pointer"
                >
                  <q-tooltip :delay="300" class="bg-grey-9 text-caption" style="white-space: normal; max-width: 300px;">
                    Shadowed by "{{ getShadowedBy(props.row)?.name }}"
                    <div class="tw:mt-1 tw:opacity-75">
                      Higher priority match. This model won't be used for cost calculation.
                    </div>
                  </q-tooltip>
                </q-icon>
              </div>
            </template>
            <template v-else-if="col.name === 'pricing'">
              <div class="tw:flex tw:flex-wrap tw:gap-1">
                <template v-if="getDefaultTier(props.row) && Object.keys(getDefaultTier(props.row).prices || {}).length">
                  <span
                    v-for="(price, key) in getVisiblePrices(props.row)"
                    :key="key"
                    class="dimension-badge"
                    :class="getPriceKeyColorClass(key as string)"
                  >
                    <span class="tw:font-medium">{{ formatPriceKey(key as string) }}</span>=<span>{{ formatPerMillion(price as number) }}</span>
                  </span>
                  <span
                    v-if="getOverflowCount(props.row) > 0"
                    class="dimension-badge badge-more tw:cursor-pointer"
                    @click.stop="openPricingDialog(props.row)"
                  >
                    +{{ getOverflowCount(props.row) }} more
                    <q-tooltip :delay="400" anchor="top middle" self="bottom middle" class="pricing-overflow-tooltip">
                      <div class="pricing-overflow-tooltip-inner">
                        <span
                          v-for="(price, key) in getDefaultTier(props.row).prices"
                          :key="key"
                          class="dimension-badge"
                          :class="getPriceKeyColorClass(key as string)"
                        >
                          <span class="tw:font-medium">{{ formatPriceKey(key as string) }}</span>=<span>{{ formatPerMillion(price as number) }}</span>
                        </span>
                      </div>
                    </q-tooltip>
                  </span>
                </template>
                <span v-else class="text-grey-5">—</span>
              </div>
            </template>
            <template v-else-if="col.name === 'actions'">
              <div class="tw:flex tw:items-center tw:gap-1 tw:justify-end">
                <!-- Own entries: pause/play + edit + duplicate -->
                <template v-if="!isReadOnly(props.row)">
                  <q-btn
                    dense
                    unelevated
                    size="sm"
                    :color="props.row.enabled ? 'negative' : 'positive'"
                    :icon="props.row.enabled ? outlinedPause : outlinedPlayArrow"
                    round
                    flat
                    :title="props.row.enabled ? 'Disable' : 'Enable'"
                    @click.stop="toggleEnabled(props.row, !props.row.enabled)"
                    data-test="model-pricing-toggle-btn"
                  />
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
                </template>
                <!-- Read-only entries (meta/built-in): clone -->
                <template v-else>
                  <q-btn
                    padding="sm"
                    unelevated
                    size="sm"
                    round
                    flat
                    icon="content_copy"
                    title="Clone to this org"
                    @click.stop="duplicateModel(props.row)"
                    data-test="model-pricing-clone-btn"
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
        <div class="bottom-btn">
          <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[100px] tw:mr-md">
            {{ resultTotal }} models
          </div>
          <q-btn
            v-if="selectedCount > 0"
            data-test="model-pricing-export-selected-btn"
            class="q-mr-sm no-border o2-secondary-button tw:w-[300px] tw:h-[36px]"
            no-caps
            dense
            style="width: 160px; height: 32px;"
            icon="download"
            :label="`Export (${selectedCount})`"
            @click="exportSelected"
          />
          <q-btn
            v-if="selectedCount > 0 && selectedIdsOnlyContainsOwn"
            data-test="model-pricing-delete-selected-btn"
            class="q-mr-sm no-border o2-secondary-button"
            style="width: 160px; height: 32px;"
            no-caps
            flat
            :icon="outlinedDelete"
            :label="`Delete (${selectedCount})`"
            @click="confirmDeleteSelected"
          />
          <QTablePagination
            :scope="scope"
            :position="'bottom'"
            :resultTotal="resultTotal"
            :perPageOptions="perPageOptions"
            @update:changeRecordPerPage="changePagination"
          />
        </div>
      </template>
    </q-table>
    </div> <!-- end v-if="!showImportModelPricingPage" -->

  <!-- Pricing detail side panel -->
  <q-dialog v-model="showPricingDialog" position="right" maximized>
    <div :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'" class="pricing-dialog-panel " style="width: 30vw;">
      <div class="add-stream-header row items-center no-wrap q-px-md">
        <div class="col">
          <div style="font-size: 18px">{{ pricingDialogRow?.name }}</div>
        </div>
        <div class="col-auto">
          <q-btn v-close-popup round flat icon="cancel" />
        </div>
      </div>
      <q-separator />
      <div class="q-pa-md pricing-dialog-body">
        <div v-if="pricingDialogRow" class="tw:flex tw:flex-wrap tw:gap-2">
          <span
            v-for="(price, key) in getDefaultTier(pricingDialogRow)?.prices"
            :key="key"
            class="dimension-badge"
            :class="getPriceKeyColorClass(key as string)"
            style="font-size: 13px; padding: 4px 10px;"
          >
            <span class="tw:font-medium">{{ formatPriceKey(key as string) }}</span>=<span>{{ formatPerMillion(price as number) }}</span>
          </span>
        </div>
      </div>
    </div>
  </q-dialog>

  <confirm-dialog
    v-model="confirmDialogMeta.show"
    :title="confirmDialogMeta.title"
    :message="confirmDialogMeta.message"
    @update:ok="confirmDialogMeta.onConfirm()"
    @update:cancel="resetConfirmDialog"
  />
  </q-page>
</template>

<script lang="ts" setup>
import { ref, computed, onBeforeMount, onActivated, onMounted } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { outlinedDelete, outlinedPause, outlinedPlayArrow } from "@quasar/extras/material-icons-outlined";
import { getImageURL } from "@/utils/zincutils";
import modelPricingService from "@/services/model_pricing";
import ImportModelPricing from "@/components/settings/ImportModelPricing.vue";
import AppTabs from "@/components/common/AppTabs.vue";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import TestModelMatchDialog from "@/components/settings/TestModelMatchDialog.vue";

const store = useStore();
const router = useRouter();
const q = useQuasar();

const qTableRef = ref<any>(null);
const models = ref<any[]>([]);
const loading = ref(true);
const refreshing = ref(false);

// Pricing detail side panel
const showPricingDialog = ref(false);
const pricingDialogRow = ref<any>(null);

function openPricingDialog(row: any) {
  pricingDialogRow.value = row;
  showPricingDialog.value = true;
}

const confirmDialogMeta = ref({
  show: false,
  title: "",
  message: "",
  onConfirm: async () => {},
});

const resetConfirmDialog = () => {
  confirmDialogMeta.value.show = false;
};
const filterQuery = ref("");
const showImportModelPricingPage = ref(false);
const showTestMatchDialog = ref(false);
const selectedIds = ref<string[]>([]);
const selectedTab = ref("all");

const tabOptions = [
  { label: "All", value: "all" },
  { label: "Custom", value: "org" },
  { label: "System", value: "inherited" },
];

function onTabChange() {
  selectedIds.value = [];
}

const perPageOptions: any = [
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
  { label: "250", value: 250 },
  { label: "500", value: 500 },
];

function changePagination(val: { label: string; value: any }) {
  pagination.value.rowsPerPage = val.value;
  qTableRef.value?.setPagination(pagination.value);
}

const hasSelectableModels = computed(() =>
  models.value.length > 0
);

const columns = computed(() => {
  const cols: any[] = [];
  if (hasSelectableModels.value) {
    cols.push({ name: "select", label: "", field: "select", align: "center", style: "width: 40px; min-width: 40px; max-width: 40px;" });
  }
  cols.push(
    { name: "name", label: "Model", field: "name", align: "left", sortable: true, style: "width: 280px; min-width: 280px; max-width: 280px;" },
    { name: "match_pattern", label: "Pattern", field: "match_pattern", align: "left", style: "width: 280px; min-width: 280px; max-width: 280px; overflow: hidden;" },
    { name: "pricing", label: "Pricing (per 1M tokens)", field: "pricing", align: "left", style: "min-width: 200px;" },
    { name: "actions", label: "Actions", field: "actions", align: "center", style: "width: 120px; min-width: 120px; max-width: 120px;" },
  );
  return cols;
});

const pagination = ref({ rowsPerPage: 20 });

const resultTotal = computed(() => filteredModels.value.length);

// Selection helpers
const selectableModels = computed(() =>
  filteredModels.value
);

/** Selectable models visible on the current page only. */
const currentPageSelectableModels = computed(() => {
  const perPage = pagination.value.rowsPerPage || 0;
  // rowsPerPage=0 means "show all"
  if (perPage === 0) {
    return filteredModels.value;
  }
  const page = (qTableRef.value?.computedPagination?.page ?? 1);
  const start = (page - 1) * perPage;
  const end = start + perPage;
  return filteredModels.value.slice(start, end);
});

const selectedIdsOnlyContainsOwn = computed(() => {
  if (selectedIds.value.length === 0) return false;
  return selectedIds.value.every(id => {
    const model = models.value.find((m: any) => m.id === id);
    return model && !isReadOnly(model);
  });
});

const selectedCount = computed(() => selectedIds.value.length);
const allSelected = computed(() =>
  currentPageSelectableModels.value.length > 0 &&
  currentPageSelectableModels.value.every((m: any) => selectedIds.value.includes(m.id))
);
const someSelected = computed(() =>
  selectedCount.value > 0 && !allSelected.value
);

function toggleSelectAll() {
  const pageIds = currentPageSelectableModels.value.map((m: any) => m.id);
  if (allSelected.value) {
    selectedIds.value = [];
  } else {
    // Select only the current page's selectable items — clear any off-screen selections
    selectedIds.value = [...pageIds];
  }
}

function toggleSelect(id: string) {
  const idx = selectedIds.value.indexOf(id);
  if (idx >= 0) {
    selectedIds.value.splice(idx, 1);
  } else {
    selectedIds.value.push(id);
  }
}

/** Get the source of a model: 'built_in', 'meta_org', or 'org'. */
function getSource(model: any): string {
  return model.source || 'org';
}


/** True when a model entry is read-only (built-in or from another org). */
function isReadOnly(model: any): boolean {
  return model.source === 'built_in' || model.org_id !== orgIdentifier.value;
}

function sectionIcon(section: string): string {
  return section === 'built_in' ? 'auto_awesome' : 'corporate_fare';
}

function sectionLabel(section: string): string {
  return section === 'built_in' ? 'Built-in (OpenObserve)' : 'Meta Org';
}

const filteredModels = computed(() => {
  let items = models.value;
  if (filterQuery.value) {
    const search = filterQuery.value.toLowerCase();
    items = items.filter(
      (m: any) =>
        m.name.toLowerCase().includes(search) ||
        m.match_pattern.toLowerCase().includes(search)
    );
  }

  // Tab filtering
  const tab = selectedTab.value;
  if (tab === 'org') {
    items = items.filter((m: any) => getSource(m) === 'org' && m.org_id === orgIdentifier.value);
    return items.map((m: any) => ({ ...m, __sectionStart: null }));
  }
  if (tab === 'inherited') {
    const metaItems = items.filter((m: any) => getSource(m) === 'meta_org' || (getSource(m) === 'org' && m.org_id !== orgIdentifier.value));
    const builtInItems = items.filter((m: any) => getSource(m) === 'built_in');
    const sorted: any[] = [];
    if (metaItems.length > 0) {
      metaItems[0] = { ...metaItems[0], __sectionStart: 'meta_org' };
      for (let i = 1; i < metaItems.length; i++) metaItems[i] = { ...metaItems[i], __sectionStart: null };
      sorted.push(...metaItems);
    }
    if (builtInItems.length > 0) {
      builtInItems[0] = { ...builtInItems[0], __sectionStart: 'built_in' };
      for (let i = 1; i < builtInItems.length; i++) builtInItems[i] = { ...builtInItems[i], __sectionStart: null };
      sorted.push(...builtInItems);
    }
    return sorted;
  }

  // "all" tab — group by source with section headers
  const orgItems = items.filter((m: any) => getSource(m) === 'org' && m.org_id === orgIdentifier.value);
  const metaItems = items.filter((m: any) => getSource(m) === 'meta_org' || (getSource(m) === 'org' && m.org_id !== orgIdentifier.value));
  const builtInItems = items.filter((m: any) => getSource(m) === 'built_in');

  const sorted: any[] = [];

  // Add org items
  sorted.push(...orgItems);

  // Add meta section
  if (metaItems.length > 0) {
    metaItems[0] = { ...metaItems[0], __sectionStart: 'meta_org' };
    for (let i = 1; i < metaItems.length; i++) {
      metaItems[i] = { ...metaItems[i], __sectionStart: null };
    }
    sorted.push(...metaItems);
  }

  // Add built-in section
  if (builtInItems.length > 0) {
    builtInItems[0] = { ...builtInItems[0], __sectionStart: 'built_in' };
    for (let i = 1; i < builtInItems.length; i++) {
      builtInItems[i] = { ...builtInItems[i], __sectionStart: null };
    }
    sorted.push(...builtInItems);
  }

  // Ensure org items don't have section markers
  for (const item of orgItems) {
    item.__sectionStart = null;
  }

  return sorted;
});

/** Sort within each section group so section banners stay in place. */
function customSort(rows: any[], sortBy: string, descending: boolean) {
  if (!sortBy) return rows;

  const compare = (a: any, b: any) => {
    const aVal = (a[sortBy] ?? '').toString().toLowerCase();
    const bVal = (b[sortBy] ?? '').toString().toLowerCase();
    const cmp = aVal.localeCompare(bVal);
    return descending ? -cmp : cmp;
  };

  const orgRows = rows.filter((r: any) => getSource(r) === 'org' && r.org_id === orgIdentifier.value);
  const metaRows = rows.filter((r: any) => getSource(r) === 'meta_org' || (getSource(r) === 'org' && r.org_id !== orgIdentifier.value));
  const builtInRows = rows.filter((r: any) => getSource(r) === 'built_in');

  orgRows.sort(compare);
  metaRows.sort(compare);
  builtInRows.sort(compare);

  // Clear and re-apply section markers
  [...orgRows, ...metaRows, ...builtInRows].forEach((r: any) => { r.__sectionStart = null; });
  if (metaRows.length > 0) metaRows[0].__sectionStart = 'meta_org';
  if (builtInRows.length > 0) builtInRows[0].__sectionStart = 'built_in';

  return [...orgRows, ...metaRows, ...builtInRows];
}

function getDefaultTier(model: any) {
  // Find the first unconditional tier (the fallback/default tier).
  // The editor always stores the default as tiers[0], but inherited/built-in
  // entries might have a different order.
  const fallback = model.tiers?.find((t: any) => !t.condition);
  return fallback || model.tiers?.[0];
}

/** Return the first N prices to display inline as chips. */
const MAX_VISIBLE_PRICES = 2;
function getVisiblePrices(model: any): Record<string, number> {
  const tier = getDefaultTier(model);
  if (!tier?.prices) return {};
  const entries = Object.entries(tier.prices);
  return Object.fromEntries(entries.slice(0, MAX_VISIBLE_PRICES));
}

/** How many prices are hidden behind the overflow "+N" chip. */
function getOverflowCount(model: any): number {
  const tier = getDefaultTier(model);
  if (!tier?.prices) return 0;
  const total = Object.keys(tier.prices).length;
  return Math.max(0, total - MAX_VISIBLE_PRICES);
}

/** Returns the model that shadows this one, or null if not shadowed. */
function getShadowedBy(model: any): { name: string; match_pattern: string } | null {
  if (!model.enabled) return null;
  for (const other of models.value) {
    if (other.id === model.id) continue;
    if (!other.enabled) continue;
    if (other.match_pattern !== model.match_pattern) continue;
    const otherVf = other.valid_from ?? 0;
    const thisVf = model.valid_from ?? 0;
    if (otherVf !== thisVf) continue;
    const otherSo = other.sort_order ?? 0;
    const thisSo = model.sort_order ?? 0;
    if (otherSo < thisSo) return { name: other.name, match_pattern: other.match_pattern };
    if (otherSo === thisSo && other.name.localeCompare(model.name) < 0) return { name: other.name, match_pattern: other.match_pattern };
  }
  return null;
}

/** Shorten usage key for display: replace underscores with hyphens, drop trailing "_tokens". */
function formatPriceKey(key: string): string {
  return key.replace(/_tokens$/, '').replace(/_/g, '-');
}

function getPriceKeyColorClass(key: string): string {
  const k = key.toLowerCase();
  if (k.includes('input')) return 'badge-blue';
  if (k.includes('output')) return 'badge-green';
  // Hash-based color for all other arbitrary keys
  const palette = ['badge-cyan', 'badge-purple', 'badge-pink', 'badge-orange', 'badge-amber', 'badge-violet', 'badge-rose', 'badge-teal', 'badge-indigo'];
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash = hash & hash;
  }
  return palette[Math.abs(hash) % palette.length];
}

function formatPerMillion(pricePerToken: number | undefined | null): string {
  if (pricePerToken == null || pricePerToken === undefined) return "$0.00";
  if (pricePerToken === 0) return "$0.00";
  const perMillion = pricePerToken * 1_000_000;
  return `$${perMillion.toFixed(2)}`;
}

const orgIdentifier = computed(
  () => store.state.selectedOrganization?.identifier || ""
);

const ooLogo = computed(() =>
  store.state.theme === "dark"
    ? getImageURL("openobserve_favicon_dark.ico")
    : getImageURL("images/common/openobserve_favicon.png")
);

/** Show error notification only for non-403 errors.
 *  403 errors are already handled by the global HTTP interceptor (persistent top banner). */
function notifyError(prefix: string, e: any) {
  if (e?.response?.status === 403) return;
  const msg = e?.response?.data?.message || e?.message || "Unknown error";
  q.notify({ type: "negative", message: `${prefix}: ${msg}`, position: "bottom", timeout: 5000 });
}

async function fetchModels() {
  loading.value = true;
  try {
    const res = await modelPricingService.list(orgIdentifier.value);
    models.value = res.data || [];
  } catch (e: any) {
    notifyError("Failed to load models", e);
  } finally {
    loading.value = false;
  }
}

function openEditor(model: any) {
  if (model) {
    router.push({
      name: "modelPricingEditor",
      query: { org_identifier: orgIdentifier.value, id: model.id },
    });
  } else {
    router.push({
      name: "modelPricingEditor",
      query: { org_identifier: orgIdentifier.value },
    });
  }
}

async function toggleEnabled(model: any, enabled: boolean) {
  try {
    // Strip internal UI fields before sending to API
    const { __sectionStart, ...clean } = model;
    const updated = { ...clean, enabled };
    await modelPricingService.update(orgIdentifier.value, model.id, updated);
    await fetchModels(); // refetch to reflect server state
    q.notify({ type: "positive", message: `Model "${model.name}" ${enabled ? "enabled" : "disabled"}`, position: "bottom", timeout: 3000 });
  } catch (e: any) {
    notifyError("Failed to update", e);
  }
}

function duplicateModel(model: any) {
  router.push({
    name: "modelPricingEditor",
    query: { org_identifier: orgIdentifier.value, id: model.id, duplicate: "true" },
  });
}

function confirmDelete(model: any) {
  confirmDialogMeta.value = {
    show: true,
    title: "Delete Model Pricing",
    message: `Are you sure you want to delete "${model.name}"?`,
    onConfirm: async () => {
      try {
        await modelPricingService.delete(orgIdentifier.value, model.id);
        q.notify({ type: "positive", message: "Model pricing deleted", position: "bottom", timeout: 3000 });
        await fetchModels();
      } catch (e: any) {
        notifyError("Failed to delete", e);
      }
    },
  };
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

async function refreshBuiltIn() {
  refreshing.value = true;
  try {
    await modelPricingService.refreshBuiltIn(orgIdentifier.value);
    q.notify({ type: "positive", message: "Built-in models refreshed", position: "bottom", timeout: 3000 });
    await fetchModels();
  } catch (e: any) {
    notifyError("Refresh failed", e);
  } finally {
    refreshing.value = false;
  }
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
    (m: any) => selectedIds.value.includes(m.id)
  );
  if (selected.length === 0) {
    q.notify({ type: "warning", message: "No models selected to export", position: "bottom", timeout: 3000 });
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
  const count = selectedIds.value.length;
  confirmDialogMeta.value = {
    show: true,
    title: "Delete Selected Models",
    message: `Are you sure you want to delete ${count} selected model${count !== 1 ? "s" : ""}?`,
    onConfirm: async () => {
      let successCount = 0;
      for (const id of selectedIds.value) {
        const modelEntry = models.value.find((m: any) => m.id === id);
        const modelName = modelEntry?.name || id;
        try {
          await modelPricingService.delete(orgIdentifier.value, id);
          successCount++;
        } catch (e: any) {
          notifyError(`Failed to delete "${modelName}"`, e);
        }
      }
      if (successCount > 0) {
        q.notify({ type: "positive", message: `Deleted ${successCount} model${successCount !== 1 ? "s" : ""}`, position: "bottom", timeout: 3000 });
        selectedIds.value = [];
        await fetchModels();
      }
    },
  };
}

onBeforeMount(() => {
  fetchModels();
  if (router.currentRoute.value.query.action === "import") {
    showImportModelPricingPage.value = true;
  }
});

onActivated(() => {
  fetchModels();
  if (router.currentRoute.value.query.action === "import") {
    showImportModelPricingPage.value = true;
  }
});
</script>

<style lang="scss">
.bottom-btn {
  display: flex;
  align-items: center;
  width: 100%;
}

.o2-table-cell-content {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
  display: block;
}

.section-header-cell {
  padding: 10px 16px;
  background: rgba(0, 0, 0, 0.04);
  border-bottom: 1px solid var(--o2-border-color);

  .body--dark & {
    background: rgba(255, 255, 255, 0.06);
  }
}

.section-header-title {
  font-weight: 700;
  opacity: 0.8;
}

.section-header-subtitle {
  opacity: 0.6;
}

/* Add pattern code block styling */
.pattern-code {
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid var(--o2-border-color);
  padding: 2px 6px;
  border-radius: 4px;
  color: inherit;
}

body.body--dark .pattern-code {
  background: rgba(255, 255, 255, 0.05);
}

/* ── Dimension badges (pricing) ─────────────────────── */
.dimension-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 400;
  white-space: nowrap;
  border: 1px solid #d1d5db;
  color: inherit;
}

.badge-more {
  background: #e5e7eb;
  color: #6b7280;
  font-weight: 500;
  border: none;
}

body.body--dark .badge-more {
  background: #4b5563;
  color: #d1d5db;
}

.badge-blue   { border-color: #1d4ed8; }
.badge-green  { border-color: #065f46; }
.badge-cyan   { border-color: #0e7490; }
.badge-purple { border-color: #7c3aed; }
.badge-pink   { border-color: #9f1239; }
.badge-orange { border-color: #c2410c; }
.badge-gray   { border-color: #4b5563; }
.badge-amber  { border-color: #d97706; }
.badge-violet { border-color: #7c3aed; }
.badge-rose   { border-color: #e11d48; }
.badge-teal   { border-color: #0f766e; }
.badge-indigo { border-color: #4f46e5; }

/* ── Pricing detail side panel ────────────────────── */
.pricing-dialog-panel {
  width: 30vw;
  min-width: 320px;
  max-width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;

  .add-stream-header {
    min-height: 64px;
  }
}

.pricing-dialog-body {
  flex: 1;
  overflow-y: auto;
}

/* ── Pricing overflow tooltip ──────────────────────── */
.pricing-overflow-tooltip {
  padding: 10px 12px;
  max-width: 440px;
}

.pricing-overflow-tooltip-inner {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

body.body--dark {
  .dimension-badge { color: #ffffff; }
  .badge-blue   { border-color: #93c5fd; }
  .badge-green  { border-color: #6ee7b7; }
  .badge-cyan   { border-color: #67e8f9; }
  .badge-purple { border-color: #c4b5fd; }
  .badge-pink   { border-color: #f9a8d4; }
  .badge-orange { border-color: #fdba74; }
  .badge-gray   { border-color: #d1d5db; }
  .badge-amber  { border-color: #fbbf24; }
  .badge-violet { border-color: #c4b5fd; }
  .badge-rose   { border-color: #fda4af; }
  .badge-teal   { border-color: #5eead4; }
  .badge-indigo { border-color: #a5b4fc; }
}
</style>
