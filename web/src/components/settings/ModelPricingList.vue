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
  <div class="tw:rounded-md tw:flex tw:flex-col tw:h-full tw:p-0">
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
    <div v-if="!showImportModelPricingPage" class="tw:flex tw:flex-col tw:h-full">
      <!-- List View Header -->
      <!-- Standard section header: title + actions only. Tabs + search moved
           into the table toolbar below. -->
      <AppPageHeader icon="paid" :subtitle="'LLM model cost configuration'" class="tw:shrink-0 tw:px-4 tw:border-b tw:border-border-default">
        <template #title>
          {{ t("modelPricing.header") }}
          <OButton
            variant="ghost"
            size="icon-sm"
            class="tw:-ml-1"
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
      <div class="card-container tw:flex-1 tw:min-h-0 tw:overflow-hidden">
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
          <div class="tw:flex tw:items-center tw:gap-2 tw:w-full">
            <div class="app-tabs-container tw:h-9">
              <app-tabs
                class="tabs-selection-container"
                :tabs="tabOptions"
                v-model:active-tab="selectedTab"
                @update:active-tab="onTabChange"
              />
            </div>
            <OSearchInput
              v-model="filterQuery"
              class="tw:ml-auto tw:w-64"
              :placeholder="t('modelPricing.searchPlaceholder')"
            />
          </div>
        </template>
        <template #tree-warning="{ row }">
          <div class="tw:flex tw:items-center tw:gap-2 tw:py-1 tw:text-sm tw:leading-none">
            <OIcon name="warning-amber" size="sm" class="shadowed-icon" />
            <span class="tw:leading-tight">
              {{
                t("modelPricing.shadowedWarningBanner", { name: row.name })
              }}
            </span>
          </div>
        </template>
        <template #cell-name="{ row }">
          <div class="tw:flex tw:items-center tw:flex-nowrap tree-node-content">
            <span
              v-if="getSource(row) === 'built_in'"
              class="tw:shrink-0 tw:cursor-default tw:inline-flex tw:mr-1"
            >
              <img
                :src="ooLogo"
                class="tw:w-[16px] tw:h-[16px]"
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
              class="tw:shrink-0 tw:cursor-default tw:inline-flex tw:mr-1"
            >
              <OIcon
                name="corporate-fare"
                size="sm"
                class="source-icon"
               />
              <OTooltip side="top" align="center" :content="t('modelPricing.sourceInherited')" />
            </span>
            <span
              v-else
              class="tw:shrink-0 tw:cursor-default tw:inline-flex tw:mr-1"
            >
              <OIcon
                name="person"
                size="sm"
                class="source-icon"
               />
              <OTooltip side="top" align="center" :content="t('modelPricing.sourceCustom')" />
            </span>
            <div class="o2-table-cell-content">{{ row.name }}</div>
          </div>
        </template>
        <template #cell-match_pattern="{ row }">
          <div class="tw:flex tw:items-center tw:gap-1 tw:min-w-0">
            <code
              class="tw:text-xs tw:block tw:max-w-full pattern-code"
              :class="{ 'shadowed-pattern': isChildRow(row) }"
              >{{ row.match_pattern }}</code
            >
            <OIcon
              v-if="isChildRow(row)"
              name="warning-amber"
              size="xs"
              class="tw:shrink-0 shadowed-icon"
            >
              <OTooltip side="top" align="center" :content="t('modelPricing.shadowedTooltip', { name: getParentName(row) })" />
            </OIcon>
          </div>
        </template>
        <template #cell-pricing="{ row }">
          <div class="tw:flex tw:flex-wrap tw:gap-1">
            <template
              v-if="
                getDefaultTier(row) &&
                Object.keys(getDefaultTier(row).prices || {}).length
              "
            >
              <span
                v-for="(price, key) in getVisiblePrices(row)"
                :key="key"
                class="dimension-badge"
                :class="getPriceKeyColorClass(key as string)"
              >
                <span class="tw:font-medium">{{
                  formatPriceKey(key as string)
                }}</span
                >=<span>{{ formatPerMillion(price as number) }}</span>
              </span>
              <span
                v-if="getOverflowCount(row) > 0"
                class="dimension-badge badge-more tw:cursor-pointer"
                @click.stop="openPricingDialog(row)"
              >
                +{{ getOverflowCount(row) }}
                {{ t("modelPricing.overflowMore") }}
                <OTooltip>
                  <template #content>
                    <div class="pricing-breakdown-tooltip">
                      <div class="pricing-breakdown-title">
                        {{ row.name }}
                      </div>
                      <table class="pricing-breakdown-table">
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
              </span>
            </template>
            <span v-else class="tw:text-gray-400">&mdash;</span>
          </div>
        </template>
        <template #cell-actions="{ row }">
          <div class="tw:flex tw:items-center tw:gap-1 tw:justify-end">
            <template v-if="!isReadOnly(row)">
              <OButton
                :variant="
                  row.enabled ? 'ghost-destructive' : 'ghost'
                "
                size="icon-sm"
                :title="
                  row.enabled
                    ? t('modelPricing.actionDisable')
                    : t('modelPricing.actionEnable')
                "
                @click.stop="toggleEnabled(row, !row.enabled)"
                data-test="model-pricing-toggle-btn"
                :icon-left="row.enabled ? 'pause' : 'play-arrow'"
              />
              <OButton
                variant="ghost"
                size="icon-sm"
                :title="t('modelPricing.actionEdit')"
                @click.stop="openEditor(row)"
                data-test="model-pricing-edit-btn"
                icon-left="edit"
              />
              <OButton
                variant="ghost-destructive"
                size="icon-sm"
                :title="t('modelPricing.actionDelete')"
                @click.stop="confirmDelete(row)"
                data-test="model-pricing-delete-btn"
                icon-left="delete"
              />
              <OButton
                variant="ghost"
                size="icon-sm"
                :title="t('modelPricing.actionDuplicate')"
                @click.stop="duplicateModel(row)"
                data-test="model-pricing-duplicate-btn"
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
                icon-left="content-copy"
              />
            </template>
          </div>
        </template>

        <template #empty>
          <div
            class="tw:w-full tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-y-3"
          >
            <OIcon name="monetization-on" style="width: 48px; height: 48px; opacity: 0.2;" class="tw:text-gray-400" />
            <div class="tw:text-base tw:font-medium tw:text-gray-400 tw:mt-2">
              {{ t("modelPricing.noModels") }}
            </div>
            <div class="tw:text-xs tw:text-gray-400">
              {{ t("modelPricing.noModelsDesc") }}
            </div>
            <OButton
              variant="primary"
              size="sm"
              class="tw:self-center"
              @click="openEditor(null)"
              data-test="model-pricing-empty-add-btn"
            >
              {{ t("modelPricing.newModel") }}
            </OButton>
          </div>
        </template>

        <template #bottom="scope">
          <div class="bottom-btn tw:h-[48px] tw:gap-x-2">
            <div
              class="o2-table-footer-title tw:flex tw:items-center tw:w-[100px]"
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
    <ODrawer data-test="model-pricing-list-pricing-drawer" v-model:open="showPricingDialog" :width="30" title="Hello">
      <template #header-left>
        <span
            v-if="getSource(pricingDialogRow) === 'built_in'"
            class="tw:shrink-0 tw:cursor-default tw:inline-flex"
          >
            <img
              :src="ooLogo"
              class="tw:w-[18px] tw:h-[18px]"
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
            class="tw:shrink-0 tw:cursor-default tw:inline-flex"
          >
            <OIcon
              name="corporate-fare"
              size="sm"
              class="source-icon"
             />
            <OTooltip side="top" align="center" :content="t('modelPricing.sourceInherited')" />
          </span>
          <span
            v-else
            class="tw:shrink-0 tw:cursor-default tw:inline-flex"
          >
            <OIcon
              name="person"
              size="sm"
              class="source-icon"
             />
            <OTooltip side="top" align="center" :content="t('modelPricing.sourceCustom')" />
          </span>
      </template>

      <div class="tw:p-3 pricing-dialog-body">
        <div v-if="pricingDialogRow">
          <div class="tw:mb-4">
            <div class="pricing-section-label">
              {{ t("modelPricing.colPattern") }}
            </div>
            <code class="tw:text-xs pattern-code pattern-code-panel">{{
              pricingDialogRow.match_pattern
            }}</code>
          </div>
          <OSeparator class="tw:mb-4" />

          <div>
            <div class="pricing-section-label tw:mt-2">
              {{ t("modelPricing.colPricing") }}
            </div>
            <div
              v-if="
                sortedPriceEntries(
                  getDefaultTier(pricingDialogRow)?.prices || {},
                ).length
              "
              class="pricing-panel-table-wrap"
            >
              <table class="pricing-panel-table">
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
            <span v-else class="tw:text-gray-400">&mdash;</span>
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
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";

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

function getPriceKeyColorClass(key: string): string {
  const k = key.toLowerCase();
  if (k.includes("input")) return "badge-blue";
  if (k.includes("output")) return "badge-green";
  const palette = [
    "badge-cyan",
    "badge-purple",
    "badge-pink",
    "badge-orange",
    "badge-amber",
    "badge-violet",
    "badge-rose",
    "badge-teal",
    "badge-indigo",
  ];
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
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

/** Return the first N prices to display tw:inline as chips. */
const MAX_VISIBLE_PRICES = 2;
function getVisiblePrices(model: any): Record<string, number> {
  const tier = getDefaultTier(model);
  if (!tier?.prices) return {};
  return Object.fromEntries(
    sortedPriceEntries(tier.prices).slice(0, MAX_VISIBLE_PRICES),
  );
}

/** How many prices are tw:hidden behind the overflow "+N" chip. */
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

/* Add pattern code tw:block styling */
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

.pricing-section-label {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
  color: #555;

  .body--dark & {
    color: #aaa;
  }
}

.pattern-code-panel {
  display: block;
  font-size: 13px;
  padding: 6px 10px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow-y: auto;
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

/* ── Pricing detail side panel ────────────────────── */
.pricing-dialog-panel {
  width: 30vw !important;
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

/* ── Pricing panel table (side panel) ──────────────── */
.pricing-panel-table-wrap {
  margin-top: 8px;
  border: 1px solid var(--o2-border-color);
  border-radius: 8px;
  overflow: hidden;
}

.pricing-panel-table {
  width: 100%;
  border-collapse: collapse;

  th {
    font-size: 11px;
    font-weight: 600;
    opacity: 0.5;
    text-align: left;
    padding: 6px 14px;
    background: rgba(0, 0, 0, 0.025);
    border-bottom: 1px solid var(--o2-border-color);

    .body--dark & {
      background: rgba(255, 255, 255, 0.04);
    }

    &:last-child {
      text-align: right;
    }
  }

  td {
    font-size: 13px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--o2-border-color);

    &:last-child {
      text-align: right;
      font-weight: 600;
    }
  }

  tr:last-child td {
    border-bottom: none;
  }
}

/* ── Pricing overflow tooltip ──────────────────────── */
.pricing-overflow-tooltip {
  padding: 12px 16px;
  min-width: 260px;
}

.pricing-breakdown-tooltip {
  min-width: 240px;
}

.pricing-breakdown-title {
  font-weight: 700;
  font-size: 13px;
  margin-bottom: 3px;
}

.pricing-breakdown-table {
  width: 100%;
  border-collapse: collapse;

  th {
    font-size: 11px;
    font-weight: 600;
    opacity: 0.65;
    text-align: left;
    padding: 0 16px 4px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.15);

    &:last-child {
      text-align: right;
      padding-right: 0;
    }
  }

  td {
    font-size: 12px;
    padding: 2px 16px 2px 0;
    border-bottom: none;

    &:last-child {
      text-align: right;
      padding-right: 0;
      font-weight: 500;
    }
  }

  tr:last-child td {
    border-bottom: none;
  }
}

body.body--dark {
  .dimension-badge {
    color: #ffffff;
    border-color: #4b5563;
  }
}

/* ── Column header info icon ───────────────────────────── */
.col-header-info-icon {
  opacity: 0.35;
  cursor: default;
  vertical-align: middle;
  &:hover {
    opacity: 0.7;
  }
}

/* ── Source icons (person / corporate_fare) ────────────── */
.source-icon {
  color: #757575;

  .body--dark & {
    color: #bdbdbd;
  }
}

/* ── Shadowed pattern (strikethrough + dim) ────────────── */
.shadowed-pattern {
  opacity: 0.5;
  text-decoration: line-through;
  text-decoration-color: currentColor;
}

/* ── Shadowed icon (orange-ish, muted) ─────────────────── */
.shadowed-icon {
  color: #f59e0b;
  opacity: 0.85;

  .body--dark & {
    color: #fbbf24;
  }
}

/* ── Tree connector lines ────── */

.tree-name-cell {
  position: relative;
}

.tree-parent-expanded.tree-name-cell::after {
  content: "";
  position: absolute;
  left: 14px;
  top: calc(50% + 11px);
  bottom: 0;
  width: 1.5px;
  background-color: var(--q-primary);
  opacity: 0.6;
  z-index: 1;
}

.tree-child.tree-name-cell {
  &::before {
    content: "";
    position: absolute;
    left: 14px;
    top: 0;
    bottom: 0;
    width: 1.5px;
    background-color: var(--q-primary);
    opacity: 0.6;
    z-index: 1;
  }

  &.tree-last-child::before {
    bottom: 50%;
  }

  &::after {
    content: "";
    position: absolute;
    left: 15px;
    top: 50%;
    transform: translateY(-50%);
    width: 18px;
    height: 1.5px;
    background-color: var(--q-primary);
    opacity: 0.6;
    z-index: 1;
  }
}

.tree-icon-wrapper {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-right: 4px;
}

.tree-expand-icon {
  flex-shrink: 0;
}

.tree-node-content {
  position: relative;
  z-index: 2;
  min-height: 24px;
}

.tree-child-content {
  padding-left: 44px;
}

.tree-dot-marker {
  position: absolute;
  left: 33px;
  top: 50%;
  transform: translateY(-50%);
  width: 7px;
  height: 7px;
  background-color: var(--q-primary);
  opacity: 0.7;
  border: 2px solid var(--q-background);
  border-radius: 0;
  z-index: 3;
  pointer-events: none;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
}

.tree-dot-marker.tree-dot-parent {
  border-radius: 50%;
}
</style>
