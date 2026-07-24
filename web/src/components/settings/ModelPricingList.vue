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
  <div class="flex h-full flex-col p-0">
    <!-- Full-page Import View -->
    <ImportModelPricing
      v-if="showImportModelPricingPage"
      :existing-models="models.filter((m: any) => !isReadOnly(m)).map((m: any) => m.name)"
      @cancel:hideform="showImportModelPricingPage = false"
      @update:list="fetchModels"
    />

    <!-- Test Match Dialog -->
    <TestModelMatchDialog v-model="showTestMatchDialog" />

    <!-- Main List View -->
    <OPageLayout
      v-if="!showImportModelPricingPage"
      icon="paid"
      :subtitle="t('settings.modelPricingList.subtitle')"
      bleed
    >
      <template #title>
        {{ t("modelPricing.header") }}
        <OButton variant="ghost" size="icon-sm" class="-ml-1" data-test="model-pricing-info-btn">
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

      <!-- List Table -->
      <div class="bg-card-glass-bg min-h-0 flex-1 overflow-hidden">
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
          :get-row-warning="
            (row: any) => !!(row.children?.length && shadowingParentNames.has(row.name))
          "
          @update:selected-ids="handleSelectedIdsUpdate"
        >
          <!-- Toolbar: Built-in/Custom tabs + search -->
          <template #toolbar>
            <div class="flex w-full items-center gap-2">
              <div class="app-tabs-container h-9">
                <AppTabs
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
              <OTooltip
                side="bottom"
                :content="t('common.refresh')"
                shortcut-id="modelPricingRefresh"
              />
            </OButton>
          </template>
          <template #tree-warning="{ row }">
            <div class="flex items-center gap-2 py-1 text-sm leading-none">
              <OIcon name="warning-amber" size="sm" class="text-status-warning-text opacity-85" />
              <span class="leading-tight">
                {{ t("modelPricing.shadowedWarningBanner", { name: row.name }) }}
              </span>
            </div>
          </template>
          <template #cell-name="{ row }">
            <div class="relative z-2 flex min-h-6 flex-nowrap items-center">
              <span
                v-if="getSource(row) === 'built_in'"
                class="mr-1 inline-flex shrink-0 cursor-default"
              >
                <img :src="ooLogo" class="h-4 w-4" :alt="t('modelPricing.openObserveLogoAlt')" />
                <OTooltip side="top" align="center" :content="t('modelPricing.sourceBuiltIn')" />
              </span>
              <span
                v-else-if="
                  getSource(row) === 'meta_org' ||
                  (getSource(row) === 'org' && row.org_id !== orgIdentifier)
                "
                class="mr-1 inline-flex shrink-0 cursor-default"
              >
                <OIcon name="corporate-fare" size="sm" class="text-text-secondary" />
                <OTooltip side="top" align="center" :content="t('modelPricing.sourceInherited')" />
              </span>
              <span v-else class="mr-1 inline-flex shrink-0 cursor-default">
                <OIcon name="person" size="sm" class="text-text-secondary" />
                <OTooltip side="top" align="center" :content="t('modelPricing.sourceCustom')" />
              </span>
              <div class="block w-full truncate">{{ row.name }}</div>
            </div>
          </template>
          <template #cell-match_pattern="{ row }">
            <div class="flex min-w-0 items-center gap-1">
              <code
                class="bg-surface-subtle border-card-glass-border rounded-default block max-w-full border px-1.5 py-0.5 text-xs text-inherit"
                :class="{
                  '[text-decoration-color:currentColor] opacity-50 [text-decoration:line-through]':
                    isChildRow(row),
                }"
                >{{ row.match_pattern }}</code
              >
              <OIcon
                v-if="isChildRow(row)"
                name="warning-amber"
                size="xs"
                class="text-status-warning-text shrink-0 opacity-85"
              >
                <OTooltip
                  side="top"
                  align="center"
                  :content="t('modelPricing.shadowedTooltip', { name: getParentName(row) })"
                />
              </OIcon>
            </div>
          </template>
          <template #cell-pricing="{ row }">
            <div class="flex flex-wrap gap-1">
              <template
                v-if="getDefaultTier(row) && Object.keys(getDefaultTier(row).prices || {}).length"
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
                      <div class="min-w-60">
                        <div class="text-compact mb-0.75 font-bold">
                          {{ row.name }}
                        </div>
                        <table class="w-full border-collapse">
                          <thead>
                            <tr>
                              <th
                                class="text-2xs text-table-header-text bg-table-header-bg border-table-header-border border-b pt-0 pr-4 pb-1 pl-0 text-left font-semibold"
                              >
                                {{ t("modelPricing.usageType") }}
                              </th>
                              <th
                                class="text-2xs text-table-header-text bg-table-header-bg border-table-header-border border-b pt-0 pr-0 pb-1 pl-0 text-right font-semibold"
                              >
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
                              <td class="py-0.5 pr-4 pl-0 text-xs">{{ formatPriceKey(key) }}</td>
                              <td class="py-0.5 pr-0 pl-0 text-right text-xs font-medium">
                                {{ formatPerMillion(price) }}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </template>
                  </OTooltip>
                </OTag>
              </template>
              <span v-else class="text-text-muted">&mdash;</span>
            </div>
          </template>
          <template #cell-actions="{ row }">
            <div class="flex items-center justify-end gap-1">
              <template v-if="!isReadOnly(row)">
                <OButton
                  :variant="row.enabled ? 'ghost-destructive' : 'ghost-success'"
                  size="icon-sm"
                  :title="
                    row.enabled ? t('modelPricing.actionDisable') : t('modelPricing.actionEnable')
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
              @action="(id) => (id === 'clear-filters' ? clearFilters() : openEditor(null))"
            />
          </template>

          <template #bottom>
            <div class="flex h-12 w-full items-center gap-x-2">
              <div class="flex w-25 items-center text-xs font-normal">
                {{ t("modelPricing.modelsCount", { count: resultTotal }) }}
              </div>
              <OButton
                v-if="selectedCount > 0"
                data-test="model-pricing-export-selected-btn"
                variant="outline"
                size="sm"
                @click="exportSelected"
              >
                <template #icon-left><OIcon name="download" size="xs" /></template>
                {{ t("modelPricing.exportSelected", { count: selectedCount }) }}
              </OButton>
              <OButton
                v-if="selectedCount > 0 && selectedIdsOnlyContainsOwn"
                data-test="model-pricing-delete-selected-btn"
                variant="outline-destructive"
                size="sm"
                :loading="bulkDeleteLoading"
                @click="confirmDeleteSelected"
                icon-left="delete"
              >
                {{ t("modelPricing.deleteSelected", { count: selectedCount }) }}
              </OButton>
            </div>
          </template>
        </OTable>
      </div>
    </OPageLayout>
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
          class="inline-flex shrink-0 cursor-default"
        >
          <img :src="ooLogo" class="h-4.5 w-4.5" :alt="t('modelPricing.openObserveLogoAlt')" />
          <OTooltip side="top" align="center" :content="t('modelPricing.sourceBuiltIn')" />
        </span>
        <span
          v-else-if="
            pricingDialogRow &&
            (getSource(pricingDialogRow) === 'meta_org' ||
              (getSource(pricingDialogRow) === 'org' && pricingDialogRow.org_id !== orgIdentifier))
          "
          class="inline-flex shrink-0 cursor-default"
        >
          <OIcon name="corporate-fare" size="sm" class="text-text-secondary" />
          <OTooltip side="top" align="center" :content="t('modelPricing.sourceInherited')" />
        </span>
        <span v-else class="inline-flex shrink-0 cursor-default">
          <OIcon name="person" size="sm" class="text-text-secondary" />
          <OTooltip side="top" align="center" :content="t('modelPricing.sourceCustom')" />
        </span>
      </template>

      <div class="flex-1 overflow-y-auto">
        <div v-if="pricingDialogRow">
          <div class="mb-4">
            <div class="text-text-secondary mb-1.5 text-xs font-semibold">
              {{ t("modelPricing.colPattern") }}
            </div>
            <code
              class="bg-surface-subtle border-card-glass-border rounded-default text-compact block max-h-75 overflow-y-auto border px-1.5 px-2.5 py-0.5 py-1.5 text-xs break-all whitespace-pre-wrap text-inherit"
              >{{ pricingDialogRow.match_pattern }}</code
            >
          </div>
          <OSeparator class="mb-4" />

          <div>
            <div
              class="text-text-secondary pricing-section-label mt-2 mb-1.5 text-xs font-semibold"
            >
              {{ t("modelPricing.colPricing") }}
            </div>
            <div
              v-if="sortedPriceEntries(getDefaultTier(pricingDialogRow)?.prices || {}).length"
              class="border-card-glass-border rounded-default mt-2 overflow-hidden border"
            >
              <table class="w-full border-collapse">
                <thead>
                  <tr>
                    <th
                      class="text-2xs text-table-header-text bg-table-header-bg border-table-header-border border-b px-3.5 py-1.5 text-left font-semibold"
                    >
                      {{ t("modelPricing.usageType") }}
                    </th>
                    <th
                      class="text-2xs text-table-header-text bg-table-header-bg border-table-header-border border-b px-3.5 py-1.5 text-right font-semibold"
                    >
                      {{ t("modelPricing.colPricing") }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="[key, price] in sortedPriceEntries(
                      getDefaultTier(pricingDialogRow)?.prices || {},
                    )"
                    :key="key"
                    class="last:[&>td]:border-b-0"
                  >
                    <td class="text-compact border-table-row-divider border-b px-3.5 py-2">
                      {{ formatPriceKey(key) }}
                    </td>
                    <td
                      class="text-compact border-table-row-divider border-b px-3.5 py-2 text-right font-semibold"
                    >
                      {{ formatPerMillion(price) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <span v-else class="text-text-muted">&mdash;</span>
          </div>
        </div>
      </div>
    </ODrawer>

    <ConfirmDialog
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
import useTheme from "@/composables/useTheme";
import { useRouter } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { getImageURL } from "@/utils/zincutils";
import modelPricingService from "@/services/model_pricing";
import ImportModelPricing from "@/components/settings/ImportModelPricing.vue";
import AppTabs from "@/components/common/AppTabs.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import TestModelMatchDialog from "@/components/settings/TestModelMatchDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";

const { t } = useI18n();
const store = useStore();
const { isDark } = useTheme();
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
const bulkDeleteLoading = ref(false);
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
const isFiltered = computed(() => !!filterQuery.value.trim() || selectedTab.value !== "all");

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
        m.name.toLowerCase().includes(search) || m.match_pattern.toLowerCase().includes(search),
    );
  }

  // Tab filtering
  const tab = selectedTab.value;
  if (tab === "org") {
    items = items.filter((m: any) => getSource(m) === "org" && m.org_id === orgIdentifier.value);
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

function sortedPriceEntries(prices: Record<string, number>): [string, number][] {
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
  return Object.fromEntries(sortedPriceEntries(tier.prices).slice(0, MAX_VISIBLE_PRICES));
}

/** How many prices are hidden behind the overflow "+N" chip. */
function getOverflowCount(model: any): number {
  const tier = getDefaultTier(model);
  if (!tier?.prices) return 0;
  const total = Object.keys(tier.prices).length;
  return Math.max(0, total - MAX_VISIBLE_PRICES);
}

const orgIdentifier = computed(() => store.state.selectedOrganization?.identifier || "");

const ooLogo = computed(() =>
  isDark.value
    ? getImageURL("openobserve_favicon_dark.ico")
    : getImageURL("images/common/openobserve_favicon.png"),
);

function notifyError(prefix: string, e: any) {
  if (e?.response?.status === 403) return;
  const msg = e?.response?.data?.message || e?.message || t("modelPricing.errUnknown");
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
    const displayName = model.name.length > 30 ? model.name.slice(0, 30) + "…" : model.name;
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
  const selected = allModels.value.filter((m: any) => selectedIds.value.includes(m.id));
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
      bulkDeleteLoading.value = true;
      try {
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
      } finally {
        bulkDeleteLoading.value = false;
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
  {
    id: "modelPricingRefresh",
    handler: () => {
      if (!isInputFocused()) fetchModels();
    },
  },
]);
</script>
