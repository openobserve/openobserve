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
  <div class="flex flex-col h-full p-0">
    <!-- Full-page Import View -->
    <ImportModelPricing
      v-if="showImportModelPricingPage"
      :existing-models="
        models.filter((m: any) => !isReadOnly(m)).map((m: any) => m.name)
      "
      @cancel:hideform="showImportModelPricingPage = false"
      @update:list="fetchModels"
    />

    <!-- Test Match Dialog -->
    <TestModelMatchDialog v-model="showTestMatchDialog" />

    <!-- Main List View -->
    <div v-if="!showImportModelPricingPage" class="flex flex-col h-full">
      <!-- List View Header -->
      <!-- Standard section header: title + actions only. Tabs + search moved
           into the table toolbar below. -->
      <AppPageHeader icon="paid" :subtitle="t('settings.modelPricingList.subtitle')" class="shrink-0 px-4 border-b border-border-default">
        <template #title>
          {{ t("modelPricing.header") }}
          <OButton
            variant="ghost"
            size="icon-sm"
            class="-ml-1"
            data-test="model-pricing-info-btn"
          >
            <OIcon name="info-outline" size="sm" />
            <OTooltip :content="t('modelPricing.matchingPriorityTooltip')" />
          </OButton>
        </template>
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            :loading="refreshing"
            @click="refreshBuiltIn"
            data-test="model-pricing-refresh-btn"
          >
            {{ t("modelPricing.refresh") }}
          </OButton>
          <OButton
            variant="outline"
            size="sm"
            @click="showTestMatchDialog = true"
            data-test="model-pricing-test-match-btn"
          >
            {{ t("modelPricing.testBtn") }}
          </OButton>
          <OButton
            variant="outline"
            size="sm"
            @click="openImport"
            data-test="model-pricing-import-btn"
          >
            {{ t("modelPricing.importBtn") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm"
            @click="openEditor(null)"
            data-test="model-pricing-add-btn"
          >
            {{ t("modelPricing.newModel") }}
          </OButton>
        </template>
      </AppPageHeader>

      <!-- List Table -->
      <div class="card-container flex-1 min-h-0 overflow-hidden">
      <OTable
        ref="qTableRef"
        :frame="false"
        data-test="model-pricing-list-table"
        :data="filteredModels"
        :columns="columns"
        row-key="id"
        :loading="loading"
        :selected-ids="selectedIds"
        selection="multiple"
        pagination="client"
        :page-size="20"
        :page-size-options="[20, 50, 100, 250, 500]"
        sorting="client"
        filter-mode="client"
        :default-columns="false"
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="settings-model-pricing"
        :show-global-filter="false"
        tree
        tree-column-id="name"
        :get-row-warning="(row: any) => !!(row.children?.length && shadowingParentNames.has(row.name))"
        @update:selected-ids="handleSelectedIdsUpdate"
      >
        <!-- Toolbar: Built-in/Custom tabs + search -->
        <template #toolbar>
          <div class="flex items-center gap-2 w-full">
            <div class="app-tabs-container h-9">
              <app-tabs
                class="tabs-selection-container"
                :tabs="tabOptions"
                v-model:active-tab="selectedTab"
                @update:active-tab="onTabChange"
              />
            </div>
            <OSearchInput
              v-model="filterQuery"
              class="ml-auto w-64"
              :placeholder="t('modelPricing.searchPlaceholder')"
            />
          </div>
        </template>
        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            data-test="model-pricing-list-refresh-btn"
            @click="fetchModels"
          >
            <OTooltip side="bottom" :content="t('common.refresh')" shortcut-id="modelPricingRefresh" />
          </OButton>
        </template>
        <template #tree-warning="{ row }">
          <div class="flex items-center gap-2 py-1 text-sm leading-none">
            <OIcon name="warning-amber" size="sm" class="text-[#f59e0b] opacity-85" />
            <span class="leading-tight">
              {{
                t("modelPricing.shadowedWarningBanner", { name: row.name })
              }}
            </span>
          </div>
        </template>
        <template #cell-name="{ row }">
          <div class="flex items-center flex-nowrap relative z-[2] min-h-[24px]">
            <span
              v-if="getSource(row) === 'built_in'"
              class="shrink-0 cursor-default inline-flex mr-1"
            >
              <img
                :src="ooLogo"
                class="w-[16px] h-[16px]"
                alt="OpenObserve"
              />
              <OTooltip side="top" align="center" :content="t('modelPricing.sourceBuiltIn')" />
            </span>
            <span
              v-else-if="
                getSource(row) === 'meta_org' ||
                (getSource(row) === 'org' &&
                  row.org_id !== orgIdentifier)
              "
              class="shrink-0 cursor-default inline-flex mr-1"
            >
              <OIcon
                name="corporate-fare"
                size="sm"
                class="text-[#757575] dark:text-[#bdbdbd]"
               />
              <OTooltip side="top" align="center" :content="t('modelPricing.sourceInherited')" />
            </span>
            <span
              v-else
              class="shrink-0 cursor-default inline-flex mr-1"
            >
              <OIcon
                name="person"
                size="sm"
                class="text-[#757575] dark:text-[#bdbdbd]"
               />
              <OTooltip side="top" align="center" :content="t('modelPricing.sourceCustom')" />
            </span>
            <div class="truncate w-full block">{{ row.name }}</div>
          </div>
        </template>
        <template #cell-match_pattern="{ row }">
          <div class="flex items-center gap-1 min-w-0">
            <code
              class="text-xs block max-w-full bg-[rgba(0,0,0,0.04)] border border-(--o2-border-color) py-[2px] px-[6px] rounded text-inherit dark:bg-[rgba(255,255,255,0.05)]"
              :class="{ 'opacity-50 [text-decoration:line-through] [text-decoration-color:currentColor]': isChildRow(row) }"
              >{{ row.match_pattern }}</code
            >
            <OIcon
              v-if="isChildRow(row)"
              name="warning-amber"
              size="xs"
              class="shrink-0 text-[#f59e0b] opacity-85"
            >
              <OTooltip side="top" align="center" :content="t('modelPricing.shadowedTooltip', { name: getParentName(row) })" />
            </OIcon>
          </div>
        </template>
        <template #cell-pricing="{ row }">
          <div class="flex flex-wrap gap-1">
            <template
              v-if="
                getDefaultTier(row) &&
                Object.keys(getDefaultTier(row).prices || {}).length
              "
            >
              <ODimensionChip
                v-for="(price, key) in getVisiblePrices(row)"
                :key="key"
                :dim-key="key as string"
                :key-label="formatPriceKey(key as string)"
                :value="formatPerMillion(price as number)"
              />
              <OTag
                v-if="getOverflowCount(row) > 0"
                type="countChip"
                value="neutral"
                clickable
                @click.stop="openPricingDialog(row)"
              >
                +{{ getOverflowCount(row) }}
                {{ t("modelPricing.overflowMore") }}
                <OTooltip>
                  <template #content>
                    <div class="min-w-[240px]">
                      <div class="font-bold text-[13px] mb-[3px]">
                        {{ row.name }}
                      </div>
                      <table class="w-full border-collapse pricing-breakdown-table">
                        <thead>
                          <tr>
                            <th>{{ t("modelPricing.usageType") }}</th>
                            <th>
                              {{ t("modelPricing.colPricingSimple") }}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            v-for="[key, price] in sortedPriceEntries(
                              getDefaultTier(row)?.prices || {},
                            )"
                            :key="key"
                          >
                            <td>{{ formatPriceKey(key) }}</td>
                            <td>{{ formatPerMillion(price) }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </template>
                </OTooltip>
              </OTag>
            </template>
            <span v-else class="text-text-primary">&mdash;</span>
          </div>
        </template>
        <template #cell-actions="{ row }">
          <div class="flex items-center gap-1 justify-end">
            <template v-if="!isReadOnly(row)">
              <OButton
                :variant="
                  row.enabled ? 'ghost-destructive' : 'ghost-success'
                "
                size="icon-sm"
                :title="
                  row.enabled
                    ? t('modelPricing.actionDisable')
                    : t('modelPricing.actionEnable')
                "
                @click.stop="toggleEnabled(row, !row.enabled)"
                data-test="model-pricing-toggle-btn"
                :data-row-action="row.enabled ? 'pause' : 'resume'"
                :icon-left="row.enabled ? 'pause' : 'play-arrow'"
              />
              <OButton
                variant="ghost"
                size="icon-sm"
                :title="t('modelPricing.actionEdit')"
                @click.stop="openEditor(row)"
                data-test="model-pricing-edit-btn"
                data-row-action="edit"
                icon-left="edit"
              />
              <OButton
                variant="ghost-destructive"
                size="icon-sm"
                :title="t('modelPricing.actionDelete')"
                @click.stop="confirmDelete(row)"
                data-test="model-pricing-delete-btn"
                data-row-action="delete"
                icon-left="delete"
              />
              <OButton
                variant="ghost"
                size="icon-sm"
                :title="t('modelPricing.actionDuplicate')"
                @click.stop="duplicateModel(row)"
                data-test="model-pricing-duplicate-btn"
                data-row-action="duplicate"
                icon-left="content-copy"
              />
            </template>
            <template v-else>
              <OButton
                variant="ghost"
                size="icon-sm"
                :title="t('modelPricing.actionClone')"
                @click.stop="duplicateModel(row)"
                data-test="model-pricing-clone-btn"
                data-row-action="duplicate"
                icon-left="content-copy"
              />
            </template>
          </div>
        </template>

        <template #empty>
          <OEmptyState
            size="hero"
            preset="no-model-pricing"
            :filtered="isFiltered"
            data-test="model-pricing-empty-state"
            @action="(id) => id === 'clear-filters' ? clearFilters() : openEditor(null)"
          />
        </template>

        <template #bottom="scope">
          <div class="flex items-center w-full h-[48px] gap-x-2">
            <div
              class="o2-table-footer-title flex items-center w-[100px]"
            >
              {{ t("modelPricing.modelsCount", { count: resultTotal }) }}
            </div>
            <OButton
              v-if="selectedCount > 0"
              data-test="model-pricing-export-selected-btn"
              variant="outline"
              size="sm"
              @click="exportSelected"
            >
              <template #icon-left
                ><OIcon name="download" size="xs"
              /></template>
              {{ t("modelPricing.exportSelected", { count: selectedCount }) }}
            </OButton>
            <OButton
              v-if="selectedCount > 0 && selectedIdsOnlyContainsOwn"
              data-test="model-pricing-delete-selected-btn"
              variant="outline-destructive"
              size="sm"
              @click="confirmDeleteSelected"
              icon-left="delete"
            >
              {{ t("modelPricing.deleteSelected", { count: selectedCount }) }}
            </OButton>
          </div>
        </template>
      </OTable>
      </div>
    </div>
    <!-- end v-if="!showImportModelPricingPage" -->

    <!-- Pricing detail side panel -->
    <ODrawer
      data-test="model-pricing-list-pricing-drawer"
      v-model:open="showPricingDialog"
      :width="30"
      :title="pricingDialogRow?.match_pattern"
      :title-data-test="'model-pricing-drawer-title'"
      :sub-title="t('modelPricing.modelDetails')"
    >
      <!-- Source (built-in / inherited / custom) indicator trails on the right. -->
      <template #header-right>
        <span
            v-if="getSource(pricingDialogRow) === 'built_in'"
            class="shrink-0 cursor-default inline-flex"
          >
            <img
              :src="ooLogo"
              class="w-[18px] h-[18px]"
              alt="OpenObserve"
            />
            <OTooltip side="top" align="center" :content="t('modelPricing.sourceBuiltIn')" />
          </span>
          <span
            v-else-if="
              pricingDialogRow &&
              (getSource(pricingDialogRow) === 'meta_org' ||
                (getSource(pricingDialogRow) === 'org' &&
                  pricingDialogRow.org_id !== orgIdentifier))
            "
            class="shrink-0 cursor-default inline-flex"
          >
            <OIcon
              name="corporate-fare"
              size="sm"
              class="text-[#757575] dark:text-[#bdbdbd]"
             />
            <OTooltip side="top" align="center" :content="t('modelPricing.sourceInherited')" />
          </span>
          <span
            v-else
            class="shrink-0 cursor-default inline-flex"
          >
            <OIcon
              name="person"
              size="sm"
              class="text-[#757575] dark:text-[#bdbdbd]"
             />
            <OTooltip side="top" align="center" :content="t('modelPricing.sourceCustom')" />
          </span>
      </template>

      <div class="p-3 flex-1 overflow-y-auto">
        <div v-if="pricingDialogRow">
          <div class="mb-4">
            <div class="text-xs font-semibold mb-[6px] text-[#555] dark:text-[#aaa]">
              {{ t("modelPricing.colPattern") }}
            </div>
            <code class="text-xs block bg-[rgba(0,0,0,0.04)] border border-(--o2-border-color) py-[2px] px-[6px] rounded text-inherit text-[13px] px-[10px] py-[6px] whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto dark:bg-[rgba(255,255,255,0.05)]">{{
              pricingDialogRow.match_pattern
            }}</code>
          </div>
          <OSeparator class="mb-4" />

          <div>
            <div class="text-xs font-semibold mb-[6px] text-[#555] mt-2 pricing-section-label">
              {{ t("modelPricing.colPricing") }}
            </div>
            <div
              v-if="
                sortedPriceEntries(
                  getDefaultTier(pricingDialogRow)?.prices || {},
                ).length
              "
              class="mt-2 border border-(--o2-border-color) rounded-lg overflow-hidden"
            >
              <table class="w-full border-collapse pricing-panel-table">
                <thead>
                  <tr>
                    <th>{{ t("modelPricing.usageType") }}</th>
                    <th>{{ t("modelPricing.colPricing") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="[key, price] in sortedPriceEntries(
                      getDefaultTier(pricingDialogRow)?.prices || {},
                    )"
                    :key="key"
                  >
                    <td>{{ formatPriceKey(key) }}</td>
                    <td>{{ formatPerMillion(price) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <span v-else class="text-gray-400">&mdash;</span>
          </div>
        </div>
      </div>
    </ODrawer>

    <confirm-dialog
      v-model="confirmDialogMeta.show"
      :title="confirmDialogMeta.title"
      :message="confirmDialogMeta.message"
      @update:ok="confirmDialogMeta.onConfirm()"
      @update:cancel="resetConfirmDialog"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onBeforeMount, onActivated } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { getImageURL } from "@/utils/zincutils";
import modelPricingService from "@/services/model_pricing";
import ImportModelPricing from "@/components/settings/ImportModelPricing.vue";
import AppTabs from "@/components/common/AppTabs.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import TestModelMatchDialog from "@/components/settings/TestModelMatchDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";

const { t } = useI18n();
const store = useStore();
const router = useRouter();

const qTableRef = ref<any>(null);
const models = ref<any[]>([]);
const loading = ref(true);
const refreshing = ref(false);

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

const tabOptions = computed(() => [
  { label: t("modelPricing.tabAll"), value: "all", icon: "format-list-bulleted" },
  { label: t("modelPricing.tabCustom"), value: "org", icon: "tune" },
  { label: t("modelPricing.tabSystem"), value: "inherited", icon: "business" },
]);

function onTabChange() {
  selectedIds.value = [];
}

/** Flat list of all models (parents + children) for ID-based lookups. */
const allModels = computed(() => {
  const result: any[] = [];
  for (const m of models.value) {
    result.push(m);
    if (m.children?.length) result.push(...m.children);
  }
  return result;
});

/** Set of model ids that are children of some parent (= shadowed rows). */
const childIds = computed(() => {
  const ids = new Set<string>();
  for (const m of models.value) {
    for (const c of m.children ?? []) ids.add(c.id);
  }
  return ids;
});

function isChildRow(row: any): boolean {
  return !!(row && childIds.value.has(row.id));
}

function getParentName(row: any): string {
  for (const m of models.value) {
    if (m.children?.some((c: any) => c.id === row.id)) return m.name;
  }
  return "";
}

const columns: OTableColumnDef[] = [
  {
    id: "name",
    header: t("modelPricing.colModel"),
    accessorKey: "name",
    sortable: true,
    resizable: true,
    hideable: true,
    minSize: 180,
    meta: { align: "left", flex: true },
  },
  {
    id: "match_pattern",
    header: t("modelPricing.colMatchPattern"),
    accessorKey: "match_pattern",
    resizable: true,
    hideable: true,
    minSize: 200,
    meta: { align: "left", flex: true },
  },
  {
    id: "pricing",
    header: t("modelPricing.colPricing"),
    accessorKey: "pricing",
    resizable: true,
    hideable: true,
    minSize: 200,
    meta: { align: "left", flex: true },
  },
  {
    id: "actions",
    header: t("modelPricing.colActions"),
    isAction: true,
    pinned: "right",
    size: 168,
    minSize: 44,
    meta: { align: "center", actionCount: 4 },
  },
];

const resultTotal = computed(() => filteredModels.value.length);

function handleSelectedIdsUpdate(ids: string[]) {
  selectedIds.value = ids;
}

const selectedIdsOnlyContainsOwn = computed(() => {
  if (selectedIds.value.length === 0) return false;
  return selectedIds.value.every((id) => {
    const model = allModels.value.find((m: any) => m.id === id);
    return model && !isReadOnly(model);
  });
});

const selectedCount = computed(() => selectedIds.value.length);

/** Get the source of a model: 'built_in', 'meta_org', or 'org'. */
function getSource(model: any): string {
  return model.source || "org";
}

/** True when a model entry is read-only (built-in or from another org). */
function isReadOnly(model: any): boolean {
  return model.source === "built_in" || model.org_id !== orgIdentifier.value;
}

// True when the search box or a non-"all" tab is narrowing the list. Drives
// OEmptyState's `:filtered` so an empty result reads as "No model pricing found"
// (with Clear filters) rather than the first-run "create your first" card.
const isFiltered = computed(
  () => !!filterQuery.value.trim() || selectedTab.value !== "all",
);

function clearFilters() {
  filterQuery.value = "";
  selectedTab.value = "all";
}

const filteredModels = computed(() => {
  let items = models.value;
  if (filterQuery.value) {
    const search = filterQuery.value.toLowerCase();
    items = items.filter(
      (m: any) =>
        m.name.toLowerCase().includes(search) ||
        m.match_pattern.toLowerCase().includes(search),
    );
  }

  // Tab filtering
  const tab = selectedTab.value;
  if (tab === "org") {
    items = items.filter(
      (m: any) => getSource(m) === "org" && m.org_id === orgIdentifier.value,
    );
  } else if (tab === "inherited") {
    items = items.filter(
      (m: any) =>
        getSource(m) === "meta_org" ||
        getSource(m) === "built_in" ||
        (getSource(m) === "org" && m.org_id !== orgIdentifier.value),
    );
  }

  return items;
});

/** Names of parents that shadow at least one child — used to gate the warning row. */
const shadowingParentNames = computed(() => {
  const names = new Set<string>();
  for (const m of models.value) {
    if (m.children?.length) names.add(m.name);
  }
  return names;
});

/** Shorten usage key for display: replace underscores with hyphens, drop trailing "_tokens". */
function formatPriceKey(key: string): string {
  return key.replace(/_tokens$/, "").replace(/_/g, "-");
}

function formatPerMillion(pricePerToken: number | undefined | null): string {
  if (pricePerToken == null || pricePerToken === undefined) return "$0.00";
  if (pricePerToken === 0) return "$0.00";
  const perMillion = pricePerToken * 1_000_000;
  return `$${perMillion.toFixed(2)}`;
}

function getDefaultTier(model: any) {
  const fallback = model.tiers?.find((t: any) => !t.condition);
  return fallback || model.tiers?.[0];
}

const PRICE_KEY_ORDER = ["input", "output"];

function sortedPriceEntries(
  prices: Record<string, number>,
): [string, number][] {
  return Object.entries(prices).sort(([a], [b]) => {
    const ai = PRICE_KEY_ORDER.indexOf(a);
    const bi = PRICE_KEY_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

/** Return the first N prices to display inline as chips. */
const MAX_VISIBLE_PRICES = 2;
function getVisiblePrices(model: any): Record<string, number> {
  const tier = getDefaultTier(model);
  if (!tier?.prices) return {};
  return Object.fromEntries(
    sortedPriceEntries(tier.prices).slice(0, MAX_VISIBLE_PRICES),
  );
}

/** How many prices are hidden behind the overflow "+N" chip. */
function getOverflowCount(model: any): number {
  const tier = getDefaultTier(model);
  if (!tier?.prices) return 0;
  const total = Object.keys(tier.prices).length;
  return Math.max(0, total - MAX_VISIBLE_PRICES);
}

const orgIdentifier = computed(
  () => store.state.selectedOrganization?.identifier || "",
);

const ooLogo = computed(() =>
  store.state.theme === "dark"
    ? getImageURL("openobserve_favicon_dark.ico")
    : getImageURL("images/common/openobserve_favicon.png"),
);

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

async function fetchModels() {
  loading.value = true;
  try {
    const res = await modelPricingService.list(orgIdentifier.value);
    models.value = res.data || [];
  } catch (e: any) {
    notifyError(t("modelPricing.errLoadModels"), e);
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
    const { __sectionStart, ...clean } = model;
    const updated = { ...clean, enabled };
    await modelPricingService.update(orgIdentifier.value, model.id, updated);
    await fetchModels();
    const displayName =
      model.name.length > 30 ? model.name.slice(0, 30) + "…" : model.name;
    const message = enabled
      ? t("modelPricing.modelEnabledNotif", { name: displayName })
      : t("modelPricing.modelDisabledNotif", { name: displayName });
    toast({ variant: "success", message });
  } catch (e: any) {
    notifyError(t("modelPricing.errUpdate"), e);
  }
}

function duplicateModel(model: any) {
  router.push({
    name: "modelPricingEditor",
    query: {
      org_identifier: orgIdentifier.value,
      id: model.id,
      duplicate: "true",
    },
  });
}

function confirmDelete(model: any) {
  confirmDialogMeta.value = {
    show: true,
    title: t("modelPricing.confirmDeleteTitle"),
    message: t("modelPricing.confirmDeleteMessage", { name: model.name }),
    onConfirm: async () => {
      try {
        await modelPricingService.delete(orgIdentifier.value, model.id);
        toast({
          variant: "success",
          message: t("modelPricing.modelPricingDeleted"),
        });
        await fetchModels();
      } catch (e: any) {
        notifyError(t("modelPricing.errDelete"), e);
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
    toast({
      variant: "success",
      message: t("modelPricing.builtInRefreshed"),
    });
    await fetchModels();
  } catch (e: any) {
    notifyError(t("modelPricing.errRefresh"), e);
  } finally {
    refreshing.value = false;
  }
}

function exportSelected() {
  const selected = allModels.value.filter((m: any) =>
    selectedIds.value.includes(m.id),
  );
  if (selected.length === 0) {
    toast({
      variant: "warning",
      message: t("modelPricing.noModelsSelected"),
    });
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
    title: t("modelPricing.confirmDeleteSelectedTitle"),
    message: t("modelPricing.confirmDeleteSelectedMessage", { count }),
    onConfirm: async () => {
      let successCount = 0;
      for (const id of selectedIds.value) {
        const modelEntry = allModels.value.find((m: any) => m.id === id);
        const modelName = modelEntry?.name || id;
        try {
          await modelPricingService.delete(orgIdentifier.value, id);
          successCount++;
        } catch (e: any) {
          notifyError(t("modelPricing.errDeleteNamed", { name: modelName }), e);
        }
      }
      if (successCount > 0) {
        toast({
          variant: "success",
          message: t("modelPricing.deletedModelsNotif", {
            count: successCount,
          }),
        });
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

useShortcuts([
  { id: "modelPricingRefresh", handler: () => { if (!isInputFocused()) fetchModels(); } },
]);
</script>

<style>
/* ── Pricing panel table (side panel) child selectors ──────────────── */
.pricing-panel-table th {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-table-header-text);
  text-align: left;
  padding: 6px 14px;
  background: var(--color-table-header-bg);
  border-bottom: 1px solid var(--color-table-header-border);
}

.pricing-panel-table th:last-child {
  text-align: right;
}

.pricing-panel-table td {
  font-size: 13px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--color-table-row-divider);
}

.pricing-panel-table td:last-child {
  text-align: right;
  font-weight: 600;
}

.pricing-panel-table tr:last-child td {
  border-bottom: none;
}

/* ── Pricing breakdown tooltip table child selectors ──────────────── */
.pricing-breakdown-table th {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-table-header-text);
  background: var(--color-table-header-bg);
  text-align: left;
  padding: 0 16px 4px 0;
  border-bottom: 1px solid var(--color-table-header-border);
}

.pricing-breakdown-table th:last-child {
  text-align: right;
  padding-right: 0;
}

.pricing-breakdown-table td {
  font-size: 12px;
  padding: 2px 16px 2px 0;
  border-bottom: none;
}

.pricing-breakdown-table td:last-child {
  text-align: right;
  padding-right: 0;
  font-weight: 500;
}

.pricing-breakdown-table tr:last-child td {
  border-bottom: none;
}

</style>
