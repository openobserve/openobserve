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
  <div class="built-in-model-pricing-container card-container">
    <!-- Search and Filter Bar -->
    <div class="filters-bar q-pa-md">
      <div class="tw:flex tw:items-center tw:justify-between tw:flex-wrap">
        <!-- Text search -->
         <div class="tw:flex tw:gap-3">
        <q-input
            v-model="searchQuery"
            placeholder="Search by model name..."
            borderless
            dense
            flat
            clearable
            class="no-border tw:w-[220px]"
            data-test="built-in-model-pricing-search"
          >
            <template v-slot:prepend>
              <q-icon class="o2-search-input-icon" name="search" />
            </template>
          </q-input>

        <!-- Provider dropdown filter -->
          <q-select
            v-model="selectedProvider"
            :options="providerOptions"
            placeholder="Provider"
            dense
            borderless
            clearable
            options-dense
            use-input
            hide-selected
            menu-anchor="bottom left"
            fill-input
            class="no-border"
            data-test="built-in-model-pricing-provider-filter"
          >
            <template #option="scope">
              <q-item v-bind="scope.itemProps" dense>
                <q-item-section avatar style="min-width: 20px;">
                  <span
                    class="provider-dot"
                    :style="`background: ${providerColor(scope.opt)}`"
                  />
                </q-item-section>
                <q-item-section>
                  <q-item-label>{{ scope.opt }}</q-item-label>
                </q-item-section>
              </q-item>
            </template>
          </q-select>
         </div>

        <!-- Refresh -->
        <div>
          <q-btn
            label="Refresh"
            flat
            class="o2-secondary-button tw:w-[120px] tw:h-[36px]"
            @click="refreshModels"
            :loading="loading"
            data-test="built-in-model-pricing-refresh-btn"
          />
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading && models.length === 0" class="text-center q-pa-xl">
      <q-spinner-hourglass color="primary" size="50px" />
      <div class="q-mt-md">Loading models...</div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="text-center q-pa-xl">
      <q-icon name="error" size="50px" color="negative" />
      <div class="q-mt-md text-negative">{{ error }}</div>
      <q-btn flat color="primary" label="Try Again" @click="fetchModels()" class="q-mt-md" />
    </div>

    <div v-else class="q-mb-md q-px-md">
        <q-table
          :rows="filteredModels"
          :columns="columns"
          row-key="name"
          flat
          dense
          :pagination="{ rowsPerPage: 0 }"
          hide-pagination
          class="o2-quasar-table tw:h-[calc(100vh-120px)] o2-row-md o2-quasar-table-header-sticky"
          data-test="built-in-model-pricing-table"
        >
          <!-- Checkbox -->
          <template #body-cell-select="props">
            <q-td :props="props">
              <q-checkbox
                v-model="props.row.selected"
                dense
                size="xs"
                :data-test="`built-in-model-pricing-checkbox-${props.rowIndex}`"
              />
            </q-td>
          </template>

          <!-- Model name + description -->
          <template #body-cell-name="props">
            <q-td :props="props">
              <div class="tw:font-semibold">{{ props.row.name }}</div>
              <div v-if="props.row.description" class="text-caption text-grey-7" style="max-width: 260px; white-space: normal; line-height: 1.3;">
                {{ props.row.description }}
              </div>
            </q-td>
          </template>

          <!-- Provider — colored dot + name, no icon -->
          <template #body-cell-provider="props">
            <q-td :props="props">
              <span class="provider-badge" :style="`color: ${providerBadgeBg(props.row.provider)}; border-color: ${providerBadgeBg(props.row.provider)};`">
                {{ props.row.provider || 'Unknown' }}
              </span>
            </q-td>
          </template>

          <!-- Pattern -->
          <template #body-cell-pattern="props">
            <q-td :props="props">
              <code class="text-caption" style="word-break: break-all; white-space: normal;">
                {{ props.row.match_pattern || '—' }}
              </code>
            </q-td>
          </template>

          <!-- Tiered pricing — each tier on its own row -->
          <template #body-cell-pricing="props">
            <q-td :props="props">
              <div v-if="!props.row.tiers?.length">—</div>
              <div v-else>
                <div
                  v-for="(tier, idx) in [...props.row.tiers].sort((a: any, b: any) => (a.condition ? 1 : 0) - (b.condition ? 1 : 0))"
                  :key="idx"
                  class="tier-row"
                  :class="{ 'tier-conditional': !!tier.condition }"
                >
                  <div class="tier-name text-caption">
                    <span v-if="tier.condition">
                      {{ tier.name }}
                      <span class="text-grey-6" style="font-weight: 400;">
                        ({{ tier.condition.usage_key }} {{ tier.condition.operator }} {{ tier.condition.value.toLocaleString() }})
                      </span>
                    </span>
                    <span v-else>{{ tier.name }}</span>
                  </div>
                  <div class="tier-prices">
                    <span v-if="tier.prices?.input != null" class="price-chip price-input">
                      in: ${{ fmtPrice(tier.prices.input) }}/1M
                    </span>
                    <span v-if="tier.prices?.output != null" class="price-chip price-output">
                      out: ${{ fmtPrice(tier.prices.output) }}/1M
                    </span>
                    <span v-if="tier.prices?.cache_read_input_tokens != null" class="price-chip price-cache-read">
                      cache-read: ${{ fmtPrice(tier.prices.cache_read_input_tokens) }}/1M
                    </span>
                    <span v-if="tier.prices?.cache_creation_input_tokens != null" class="price-chip price-cache-write">
                      cache-write: ${{ fmtPrice(tier.prices.cache_creation_input_tokens) }}/1M
                    </span>
                  </div>
                </div>
              </div>
            </q-td>
          </template>

          <template #no-data>
            <div class="full-width column flex-center q-pa-xl">
              <q-icon name="search_off" size="50px" color="grey-5" />
              <div class="q-mt-md text-grey-6">No models found</div>
            </div>
          </template>

          <template #bottom>
            <div class="tw:flex tw:items-center tw:gap-4 tw:py-2 tw:px-1 text-caption text-grey-7">
              <span>{{ filteredModels.length }} model{{ filteredModels.length !== 1 ? 's' : '' }}</span>
              <span v-if="selectedCount > 0" class="text-primary tw:font-semibold">
                {{ selectedCount }} selected
              </span>
            </div>
          </template>
        </q-table>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import modelPricingService from "@/services/model_pricing";
import { ModelPricingCache } from "@/utils/modelPricingCache";

interface ModelTier {
  name: string;
  condition: any;
  prices: Record<string, number>;
}

interface BuiltInModel {
  name: string;
  match_pattern: string;
  description?: string;
  provider?: string;
  tiers: ModelTier[];
  sort_order?: number;
  selected?: boolean;
}

const PROVIDER_CONFIG: Record<string, { bg: string; text: string }> = {
  OpenAI:    { bg: "#10a37f", text: "#ffffff" },
  Anthropic: { bg: "#c47b45", text: "#ffffff" },
  Google:    { bg: "#4285f4", text: "#ffffff" },
};
const DEFAULT_PROVIDER = { bg: "#78909c", text: "#ffffff" };

function getProvider(name: string | undefined) {
  return PROVIDER_CONFIG[name || ""] || DEFAULT_PROVIDER;
}

export default defineComponent({
  name: "BuiltInModelPricingTab",
  emits: ["import-models"],
  setup(props, { emit }) {
    const store = useStore();
    const q = useQuasar();

    const models = ref<BuiltInModel[]>([]);
    const loading = ref(false);
    const error = ref("");
    const searchQuery = ref("");
    const selectedProvider = ref<string | null>(null);

    const columns = [
      { name: "select",   label: "",         field: "selected",      align: "center" as const, style: "width: 40px" },
      { name: "name",     label: "Model",    field: "name",          align: "left"   as const, sortable: true },
      { name: "provider", label: "Provider", field: "provider",      align: "left"   as const, sortable: true, style: "width: 120px" },
      { name: "pattern",  label: "Pattern",  field: "match_pattern", align: "left"   as const, style: "max-width: 200px" },
      { name: "pricing",  label: "Pricing",  field: "tiers",         align: "left"   as const },
    ];

    // Plain string options — no emit-value/map-options needed
    const providerOptions = computed(() => {
      return [...new Set(models.value.map(m => m.provider || "Unknown"))].sort();
    });

    const filteredModels = computed(() => {
      let result = models.value;
      if (searchQuery.value) {
        const sq = searchQuery.value.toLowerCase();
        result = result.filter(m =>
          m.name.toLowerCase().includes(sq) ||
          (m.description || "").toLowerCase().includes(sq)
        );
      }
      if (selectedProvider.value) {
        result = result.filter(m => (m.provider || "Unknown") === selectedProvider.value);
      }
      return result;
    });

    const selectedCount = computed(() => models.value.filter(m => m.selected).length);

    function providerColor(name: string | undefined)    { return getProvider(name).bg; }
    function providerBadgeBg(name: string | undefined)  { return getProvider(name).bg; }
    function providerBadgeText(name: string | undefined){ return getProvider(name).text; }

    function fmtPrice(perToken: number): string {
      const perM = perToken * 1_000_000;
      if (perM >= 1)    return perM.toFixed(2);
      if (perM >= 0.1)  return perM.toFixed(3);
      if (perM >= 0.01) return perM.toFixed(4);
      return perM.toPrecision(2);
    }

    const fetchModels = async (clearCache = false) => {
      loading.value = true;
      error.value = "";
      const orgId = store.state.selectedOrganization?.identifier || "";

      if (clearCache) ModelPricingCache.clear(orgId);

      if (!clearCache) {
        const cached = ModelPricingCache.get<BuiltInModel[]>(orgId);
        if (cached) {
          models.value = cached.map((m: BuiltInModel) => ({ ...m, selected: false }));
          loading.value = false;
          q.notify({
            message: `${models.value.length} models loaded`,
            color: "positive",
            position: "bottom",
            timeout: 2000,
          });
          return;
        }
      }

      try {
        const res = await modelPricingService.getBuiltIn(orgId);
        const fetched: BuiltInModel[] = res.data.models || [];
        ModelPricingCache.set(orgId, fetched);
        models.value = fetched.map((m: BuiltInModel) => ({ ...m, selected: false }));
        q.notify({
          message: `${models.value.length} models loaded`,
          color: "positive",
          position: "bottom",
          timeout: 2000,
        });
      } catch (e: any) {
        error.value = e.response?.data?.message || e.message || "Failed to load models";
        q.notify({ type: "negative", message: error.value, position: "bottom", timeout: 4000 });
      } finally {
        loading.value = false;
      }
    };

    const refreshModels = () => fetchModels(true);

    const importSelectedModels = () => {
      const selected = models.value.filter(m => m.selected);
      if (selected.length === 0) {
        q.notify({ message: "No models selected. Please select at least one model.", color: "warning", position: "bottom", timeout: 2000 });
        return;
      }
      emit("import-models", selected.map(m => ({
        name: m.name,
        match_pattern: m.match_pattern,
        tiers: m.tiers,
        description: m.description || "",
        sort_order: m.sort_order ?? 0,
        enabled: true,
      })));
    };

    onMounted(() => fetchModels());

    return {
      models, loading, error, searchQuery, selectedProvider,
      columns, providerOptions, filteredModels, selectedCount,
      providerColor, providerBadgeBg, providerBadgeText,
      fmtPrice, fetchModels, refreshModels, importSelectedModels,
    };
  },
});
</script>

<style scoped lang="scss">
.built-in-model-pricing-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.filters-bar {
  flex-shrink: 0;
  border-bottom: 1px solid var(--q-color-separator);
}
.models-list {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

/* Provider dot used in dropdown options and selected display */
.provider-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* Provider badge — border only, matching IncidentList style */
.provider-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  border: 1px solid currentColor;
}

/* Tier pricing rows */
.tier-row {
  padding: 2px 0;
  & + .tier-row {
    border-top: 1px dashed #e0e0e0;
    margin-top: 3px;
    padding-top: 3px;
  }
}
.tier-name {
  font-size: 11px;
  font-weight: 600;
  color: #555;
  margin-bottom: 2px;
}
.tier-conditional .tier-name {
  color: #888;
}
.tier-prices {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.price-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  border: 1px solid currentColor;
}
.price-input       { color: #2e7d32; }
.price-output      { color: #1565c0; }
.price-cache-read  { color: #f57f17; }
.price-cache-write { color: #880e4f; }

body.body--dark {
  .price-input       { color: #81c784; }
  .price-output      { color: #64b5f6; }
  .price-cache-read  { color: #ffd54f; }
  .price-cache-write { color: #f48fb1; }
  .provider-badge    { opacity: 0.85; }
}
</style>
