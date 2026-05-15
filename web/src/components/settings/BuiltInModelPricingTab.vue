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
          <OInput
            v-model="searchQuery"
            :placeholder="t('modelPricing.searchByModelName')"
            clearable
            class="no-border tw:w-[220px]"
            data-test="built-in-model-pricing-search"
          >
            <template v-slot:prepend>
              <q-icon class="o2-search-input-icon" name="search" />
            </template>
          </OInput>
        </div>

        <!-- Refresh -->
        <div>
          <OButton
            variant="outline"
            size="sm-action"
            :loading="loading"
            @click="refreshModels"
            data-test="built-in-model-pricing-refresh-btn"
          >
            {{ t("modelPricing.refresh") }}
          </OButton>
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading && models.length === 0" class="text-center q-pa-xl">
      <OSpinner size="lg" />
      <div class="q-mt-md">{{ t("modelPricing.loadingModels") }}</div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="text-center q-pa-xl">
      <q-icon name="error" size="50px" color="negative" />
      <div class="q-mt-md text-negative">{{ error }}</div>
      <span class="tw:mt-2">
        <OButton variant="ghost-primary" size="sm" @click="fetchModels()">
          {{ t("modelPricing.tryAgain") }}
        </OButton>
      </span>
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
            <OCheckbox
              v-model="props.row.selected"
              :data-test="`built-in-model-pricing-checkbox-${props.rowIndex}`"
            />
          </q-td>
        </template>

        <!-- Model name + description -->
        <template #body-cell-name="props">
          <q-td :props="props">
            <div class="tw:font-semibold">{{ props.row.name }}</div>
            <div
              v-if="props.row.description"
              class="text-caption text-grey-7"
              style="max-width: 260px; white-space: normal; line-height: 1.3"
            >
              {{ props.row.description }}
            </div>
          </q-td>
        </template>

        <!-- Pattern -->
        <template #body-cell-pattern="props">
          <q-td :props="props">
            <code
              class="text-caption"
              style="word-break: break-all; white-space: normal"
            >
              {{ props.row.match_pattern || "—" }}
            </code>
          </q-td>
        </template>

        <!-- Tiered pricing — each tier on its own row -->
        <template #body-cell-pricing="props">
          <q-td :props="props">
            <div v-if="!props.row.tiers?.length">—</div>
            <div v-else>
              <div
                v-for="(tier, idx) in [...props.row.tiers].sort(
                  (a: any, b: any) =>
                    (a.condition ? 1 : 0) - (b.condition ? 1 : 0),
                )"
                :key="idx"
                class="tier-row"
                :class="{ 'tier-conditional': !!tier.condition }"
              >
                <div class="tier-name text-caption">
                  <span v-if="tier.condition">
                    {{ tier.name }}
                    <span class="text-grey-6" style="font-weight: 400">
                      ({{ tier.condition.usage_key }}
                      {{ tier.condition.operator }}
                      {{ tier.condition.value.toLocaleString() }})
                    </span>
                  </span>
                  <span v-else>{{ tier.name }}</span>
                </div>
                <div class="tier-prices">
                  <span
                    v-for="[key, price] in sortedPriceEntries(tier.prices)"
                    :key="key"
                    class="price-chip"
                  >
                    {{ fmtKey(key) }}: ${{ fmtPrice(price) }}
                  </span>
                </div>
              </div>
            </div>
          </q-td>
        </template>

        <template #no-data>
          <div class="full-width column flex-center q-pa-xl">
            <q-icon name="search_off" size="50px" color="grey-5" />
            <div class="q-mt-md text-grey-6">
              {{ t("modelPricing.noModelsFound") }}
            </div>
          </div>
        </template>

        <template #bottom>
          <div
            class="tw:flex tw:items-center tw:gap-4 tw:py-2 tw:px-1 text-caption text-grey-7"
          >
            <span
              >{{ filteredModels.length }} model{{
                filteredModels.length !== 1 ? "s" : ""
              }}</span
            >
            <span
              v-if="selectedCount > 0"
              class="text-primary tw:font-semibold"
            >
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
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import modelPricingService from "@/services/model_pricing";
import { ModelPricingCache } from "@/utils/modelPricingCache";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";

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

export default defineComponent({
  name: "BuiltInModelPricingTab",
  components: { OButton, OSpinner, OInput, OCheckbox },
  emits: ["import-models"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const q = useQuasar();

    const models = ref<BuiltInModel[]>([]);
    const loading = ref(false);
    const error = ref("");
    const searchQuery = ref("");
    const columns = computed(() => [
      {
        name: "select",
        label: "",
        field: "selected",
        align: "center" as const,
        style: "width: 40px",
      },
      {
        name: "name",
        label: t("modelPricing.colModel"),
        field: "name",
        align: "left" as const,
        sortable: true,
      },
      {
        name: "pattern",
        label: t("modelPricing.colPattern"),
        field: "match_pattern",
        align: "left" as const,
        style: "max-width: 200px",
      },
      {
        name: "pricing",
        label: t("modelPricing.colPricingSimple"),
        field: "tiers",
        align: "left" as const,
      },
    ]);

    const filteredModels = computed(() => {
      let result = models.value;
      if (searchQuery.value) {
        const sq = searchQuery.value.toLowerCase();
        result = result.filter(
          (m) =>
            m.name.toLowerCase().includes(sq) ||
            (m.description || "").toLowerCase().includes(sq),
        );
      }
      return result;
    });

    const selectedCount = computed(
      () => models.value.filter((m) => m.selected).length,
    );

    // Deterministic key order: input before output, then alphabetical
    const PRICE_KEY_ORDER: Record<string, number> = {
      input_tokens: 0,
      output_tokens: 1,
    };

    function sortedPriceEntries(
      prices: Record<string, number>,
    ): [string, number][] {
      return Object.entries(prices).sort(([a], [b]) => {
        const oa = PRICE_KEY_ORDER[a] ?? 99;
        const ob = PRICE_KEY_ORDER[b] ?? 99;
        if (oa !== ob) return oa - ob;
        return a.localeCompare(b);
      });
    }

    function fmtKey(key: string): string {
      return key.replace(/_tokens$/, "").replace(/_/g, "-");
    }

    function fmtPrice(perToken: number): string {
      const perM = perToken * 1_000_000;
      if (perM >= 1) return perM.toFixed(2);
      if (perM >= 0.1) return perM.toFixed(3);
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
          models.value = cached.map((m: BuiltInModel) => ({
            ...m,
            selected: false,
          }));
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
        models.value = fetched.map((m: BuiltInModel) => ({
          ...m,
          selected: false,
        }));
        q.notify({
          message: `${models.value.length} models loaded`,
          color: "positive",
          position: "bottom",
          timeout: 2000,
        });
      } catch (e: any) {
        error.value =
          e.response?.data?.message || e.message || "Failed to load models";
        q.notify({
          type: "negative",
          message: error.value,
          position: "bottom",
          timeout: 4000,
        });
      } finally {
        loading.value = false;
      }
    };

    const refreshModels = () => fetchModels(true);

    const importSelectedModels = () => {
      const selected = models.value.filter((m) => m.selected);
      if (selected.length === 0) {
        q.notify({
          message: "No models selected. Please select at least one model.",
          color: "warning",
          position: "bottom",
          timeout: 2000,
        });
        return;
      }
      emit(
        "import-models",
        selected.map((m) => ({
          name: m.name,
          match_pattern: m.match_pattern,
          tiers: m.tiers,
          description: m.description || "",
          sort_order: m.sort_order ?? 0,
          enabled: true,
        })),
      );
    };

    onMounted(() => fetchModels());

    return {
      t,
      models,
      loading,
      error,
      searchQuery,
      columns,
      filteredModels,
      selectedCount,
      sortedPriceEntries,
      fmtKey,
      fmtPrice,
      fetchModels,
      refreshModels,
      importSelectedModels,
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

/* Tier pricing rows */
.tier-row {
  padding: 1px 0;
  & + .tier-row {
    border-top: 1px dashed #e0e0e0;
    margin-top: 2px;
    padding-top: 2px;
  }
}
.tier-name {
  font-size: 11px;
  font-weight: 600;
  color: #555;
  margin-bottom: 1px;
}
.tier-conditional .tier-name {
  color: #888;
}
.tier-prices {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
  align-items: center;
}
.price-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  color: #555;
  border: 1px solid #ccc;
}

body.body--dark {
  .price-chip {
    color: #bbb;
    border-color: #555;
  }
}
</style>
