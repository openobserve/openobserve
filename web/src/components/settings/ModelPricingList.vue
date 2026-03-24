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

    <!-- Main List View -->
    <div v-if="!showImportModelPricingPage">

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
          class="o2-secondary-button q-ml-sm tw:h-[36px]"
          no-caps
          flat
          icon="refresh"
          label="Refresh Built-in"
          :loading="refreshing"
          @click="refreshBuiltIn"
          data-test="model-pricing-refresh-btn"
        />
        <q-btn
          class="o2-secondary-button q-ml-sm tw:h-[36px]"
          no-caps
          flat
          label="Bulk Import"
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
      ref="qTableRef"
      data-test="model-pricing-list-table"
      :rows="filteredModels"
      :columns="columns"
      row-key="id"
      v-model:pagination="pagination"
      class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
      style="width: 100%; height: calc(100vh - 120px); overflow-y: auto;"
    >
      <template v-slot:header="props">
        <q-tr :props="props">
          <q-th style="width: 40px; text-align: center;">
            <q-checkbox
              :model-value="allSelected"
              :indeterminate="someSelected"
              size="sm"
              class="o2-table-checkbox"
              @update:model-value="toggleSelectAll"
              data-test="model-pricing-select-all"
            />
          </q-th>
          <q-th
            v-for="col in props.cols.filter((c: any) => c.name !== 'select')"
            :key="col.name"
            :props="props"
            :style="col.style"
          >
            {{ col.label }}
          </q-th>
        </q-tr>
      </template>

      <template #no-data>
        <div
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
        <!-- Section separator -->
        <q-tr
          v-if="props.row.__sectionStart"
          class="inherited-section-header"
        >
          <q-td :colspan="columns.length + 1" style="padding: 10px 16px; background: #f5f5f5; border-bottom: 1px solid #ddd;">
            <div class="tw:flex tw:items-center tw:gap-2">
              <q-icon :name="sectionIcon(props.row.__sectionStart)" size="18px" color="grey-7" />
              <span class="text-caption" style="font-weight: 600; color: #555;">
                {{ sectionLabel(props.row.__sectionStart) }}
              </span>
              <span class="text-caption" style="color: #888;">
                &mdash; Read-only. Clone to create your own copy.
              </span>
            </div>
          </q-td>
        </q-tr>

        <q-tr
          :props="props"
          :class="{ 'inherited-row': isReadOnly(props.row) }"
        >
          <q-td v-for="col in columns" :key="col.name" :props="props" :style="col.style">
            <template v-if="col.name === 'select'">
              <q-checkbox
                v-if="!isReadOnly(props.row)"
                :model-value="selectedIds.has(props.row.id)"
                size="sm"
                class="o2-table-checkbox"
                @update:model-value="toggleSelect(props.row.id)"
                :data-test="`model-pricing-select-${props.rowIndex}`"
              />
            </template>
            <template v-else-if="col.name === 'name'">
              <div class="o2-table-cell-content tw:font-semibold tw:flex tw:items-center tw:gap-2">
                {{ props.row.name }}
                <q-badge
                  v-if="getSource(props.row) === 'built_in'"
                  color="blue-2"
                  text-color="blue-8"
                  label="Built-in"
                  style="font-size: 10px; padding: 2px 6px;"
                />
                <q-badge
                  v-else-if="getSource(props.row) === 'meta_org'"
                  color="purple-2"
                  text-color="purple-8"
                  label="Meta"
                  style="font-size: 10px; padding: 2px 6px;"
                />
              </div>
            </template>
            <template v-else-if="col.name === 'provider'">
              <div class="o2-table-cell-content">
                {{ props.row.provider || '' }}
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
            <template v-else-if="col.name === 'actions'">
              <div class="tw:flex tw:items-center tw:gap-1 tw:justify-center">
                <!-- Own entries: pause/play + edit + duplicate + export + delete -->
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
                  <q-btn
                    padding="sm"
                    unelevated
                    size="sm"
                    round
                    flat
                    icon="download"
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
                <!-- Read-only entries (meta/built-in): clone + export -->
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
                  <q-btn
                    padding="sm"
                    unelevated
                    size="sm"
                    round
                    flat
                    icon="download"
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
        <div class="bottom-btn tw:h-[48px]">
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
            v-if="selectedCount > 0"
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
import { ref, computed, onBeforeMount, onActivated } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { outlinedDelete, outlinedPause, outlinedPlayArrow } from "@quasar/extras/material-icons-outlined";
import modelPricingService from "@/services/model_pricing";
import ImportModelPricing from "@/components/settings/ImportModelPricing.vue";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";

const store = useStore();
const router = useRouter();
const q = useQuasar();

const qTableRef = ref<any>(null);
const models = ref<any[]>([]);
const refreshing = ref(false);

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
const selectedIds = ref<Set<string>>(new Set());

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

const columns: any[] = [
  { name: "select", label: "", field: "select", align: "center", style: "width: 40px" },
  { name: "name", label: "Model", field: "name", align: "left", sortable: true },
  { name: "provider", label: "Provider", field: "provider", align: "left", style: "width: 120px" },
  { name: "match_pattern", label: "Pattern", field: "match_pattern", align: "left", style: "max-width: 300px; overflow: hidden;" },
  { name: "pricing", label: "Input / Output (per 1M)", field: "pricing", align: "left" },
  { name: "actions", label: "Actions", field: "actions", align: "left", classes: "actions-column" },
];

const pagination = ref({ rowsPerPage: 20 });

const resultTotal = computed(() => filteredModels.value.length);

// Selection helpers — only own (non-read-only) models can be selected
const selectableModels = computed(() =>
  filteredModels.value.filter((m: any) => !isReadOnly(m))
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
        m.match_pattern.toLowerCase().includes(search) ||
        (m.provider || '').toLowerCase().includes(search)
    );
  }
  // Group by source: org first, then meta_org, then built_in
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
    const updated = { ...model, enabled };
    await modelPricingService.update(orgIdentifier.value, model.id, updated);
    model.enabled = enabled;
    q.notify({ type: "positive", message: `Model "${model.name}" ${enabled ? "enabled" : "disabled"}` });
  } catch (e: any) {
    q.notify({ type: "negative", message: "Failed to update: " + e.message });
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
        q.notify({ type: "positive", message: "Model pricing deleted" });
        await fetchModels();
      } catch (e: any) {
        q.notify({ type: "negative", message: "Failed to delete: " + e.message });
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
    q.notify({ type: "positive", message: "Built-in models refreshed" });
    await fetchModels();
  } catch (e: any) {
    q.notify({ type: "negative", message: "Refresh failed: " + e.message });
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
    (m: any) => !isReadOnly(m) && selectedIds.value.has(m.id)
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
  confirmDialogMeta.value = {
    show: true,
    title: "Delete Selected Models",
    message: `Are you sure you want to delete ${count} selected model${count !== 1 ? "s" : ""}?`,
    onConfirm: async () => {
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

.inherited-row {
  opacity: 0.7;
  background: #fafafa;

  &:hover {
    opacity: 0.85;
  }
}
</style>
