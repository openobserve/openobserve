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
  <div class="built-in-model-pricing-container card-container h-full flex flex-col">
    <!-- Search and Filter Bar -->
    <div class="filters-bar p-3 shrink-0 border-b border-(--q-color-separator)">
      <div class="flex items-center justify-between flex-wrap">
        <!-- Text search -->
        <div class="flex gap-3">
          <OSearchInput
            v-model="searchQuery"
            :placeholder="t('modelPricing.searchByModelName')"
            clearable
            class="no-border w-[220px]"
            data-test="built-in-model-pricing-search"
          />
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

    <!-- Error State -->
    <div v-if="error" class="text-center p-6">
      <OIcon name="error" style="width: 50px; height: 50px;" />
      <div class="mt-3 text-red-500">{{ error }}</div>
      <span class="mt-2">
        <OButton variant="ghost-primary" size="sm" @click="fetchModels()">
          {{ t("modelPricing.tryAgain") }}
        </OButton>
      </span>
    </div>

    <div v-else class="mb-3 px-3">
      <OTable
        :data="filteredModels"
        :columns="columns"
        row-key="name"
        :loading="loading"
        pagination="none"
        :bordered="false"
        :default-columns="false"
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="settings-builtin-model-pricing"
        selection="multiple"
        v-model:selected-ids="selectedIds"
        class="h-[calc(100vh-120px)]"
        data-test="built-in-model-pricing-table"
      >
        <!-- Model name + description -->
        <template #cell-name="{ row, value }">
          <div class="font-semibold">{{ value }}</div>
          <div
            v-if="row.description"
            class="text-xs"
            style="max-width: 260px; white-space: normal; line-height: 1.3; color: var(--o2-text-muted)"
          >
            {{ row.description }}
          </div>
        </template>

        <!-- Pattern -->
        <template #cell-pattern="{ row, value }">
          <code
            class="text-xs"
            style="word-break: break-all; white-space: normal"
          >
            {{ value || "—" }}
          </code>
        </template>

        <!-- Tiered pricing — each tier on its own row -->
        <template #cell-pricing="{ row }">
          <div v-if="!row.tiers?.length">—</div>
          <div v-else>
            <div
              v-for="(tier, idx) in [...row.tiers].sort(
                (a: any, b: any) =>
                  (a.condition ? 1 : 0) - (b.condition ? 1 : 0),
              )"
              :key="idx"
              class="tier-row py-px"
              :class="{ 'tier-conditional': !!tier.condition }"
            >
              <div class="tier-name text-[11px] font-semibold text-[#555] mb-px" :class="tier.condition ? 'text-[#888]' : ''">
                <span v-if="tier.condition">
                  {{ tier.name }}
                  <span style="font-weight: 400; color: var(--o2-text-muted)">
                    ({{ tier.condition.usage_key }}
                    {{ tier.condition.operator }}
                    {{ tier.condition.value.toLocaleString() }})
                  </span>
                </span>
                <span v-else>{{ tier.name }}</span>
              </div>
              <div class="flex gap-0.75 flex-wrap items-center">
                <span
                  v-for="[key, price] in sortedPriceEntries(tier.prices)"
                  :key="key"
                  class="inline-flex items-center px-1.5 py-px rounded-[6px] text-[11px] font-semibold whitespace-nowrap text-[#555] border border-[#ccc] dark:text-[#bbb] dark:border-[#555]"
                >
                  {{ fmtKey(key) }}: ${{ fmtPrice(price) }}
                </span>
              </div>
            </div>
          </div>
        </template>

        <template #empty>
          <div class="w-full flex flex-col flex-center p-6">
            <OIcon name="search-off" style="width: 50px; height: 50px;" />
            <div class="mt-3" style="color: var(--o2-text-muted)">
              {{ t("modelPricing.noModelsFound") }}
            </div>
          </div>
        </template>

        <template #bottom="bottomProps">
          <div
            class="flex items-center gap-4 py-2 px-1 o2-table-footer-title"
          >
            <span
              >{{
                bottomProps.totalRows !== 1
                  ? t("settings.builtInModelPricingTab.modelCountPlural", { count: bottomProps.totalRows })
                  : t("settings.builtInModelPricingTab.modelCountSingular", { count: bottomProps.totalRows })
              }}</span
            >
            <span
              v-if="selectedIds.length > 0"
              style="color: var(--o2-primary-color)"
              class="font-semibold"
            >
              {{ t("settings.builtInModelPricingTab.selectedCount", { count: selectedIds.length }) }}
            </span>
          </div>
        </template>
      </OTable>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import modelPricingService from "@/services/model_pricing";
import { ModelPricingCache } from "@/utils/modelPricingCache";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";

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
  components: { OButton, OSpinner, OSearchInput, OTable,
    OIcon,
},
  emits: ["import-models"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();

    const models = ref<BuiltInModel[]>([]);
    const loading = ref(false);
    const error = ref("");
    const searchQuery = ref("");
    const columns = [
      {
        id: "name",
        header: t("modelPricing.colModel"),
        accessorKey: "name",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.defaultModel,
        minSize: 160,
        meta: { align: "left", flex: true },
      },
      {
        id: "pattern",
        header: t("modelPricing.colPattern"),
        accessorKey: "match_pattern",
        sortable: false,
        resizable: true,
        hideable: true,
        size: COL.template,
        meta: { align: "left" },
      },
      {
        id: "pricing",
        header: t("modelPricing.colPricingSimple"),
        accessorKey: "tiers",
        sortable: false,
        resizable: true,
        hideable: true,
        size: COL.description,
        meta: { align: "left" },
      },
    ];

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

    const selectedIds = ref<string[]>([]);

    const selectedCount = computed(() => selectedIds.value.length);

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
          toast({
            message: t("settings.builtInModelPricingTab.modelsLoaded", { count: models.value.length }),
            variant: "success",
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
        toast({
          message: `${models.value.length} models loaded`,
          variant: "success",
        });
      } catch (e: any) {
        error.value =
          e.response?.data?.message ||
          e.message ||
          t("settings.builtInModelPricingTab.failedToLoadModels");
        toast({
          variant: "error",
          message: error.value,
        });
      } finally {
        loading.value = false;
      }
    };

    const refreshModels = () => fetchModels(true);

    const importSelectedModels = () => {
      const selected = models.value.filter((m) => selectedIds.value.includes(m.name));
      if (selected.length === 0) {
        toast({
          message: t("settings.builtInModelPricingTab.noModelsSelected"),
          variant: "warning",
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
      selectedIds,
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

<style>
/* Tier pricing rows — sibling selector not convertible to  */
.tier-row + .tier-row {
  border-top: 1px dashed var(--o2-border);
  margin-top: 2px;
  padding-top: 2px;
}
</style>
