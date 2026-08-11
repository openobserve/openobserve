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

<!--
  Dataset Detail — the goldens inside one dataset. Reached by clicking a row on
  the Datasets list. Header carries the dataset meta + Edit / Delete / Add Item;
  the body is the Items table, paged server-side off
  GET /datasets/{id}/items. Golden items are MVCC — editing one APPENDS a row
  under the same logical id, which is why every write addresses the logical id.
-->
<template>
  <OPageLayout
    data-test="ai-dataset-detail-page"
    :back="backTarget"
    :title="raw(dataset?.name) || t('aiObservability.datasets.detail.fallbackTitle')"
    :subtitle="metaSubtitle"
    icon="table-chart"
    bleed
    :scroll="false"
  >
    <template #actions>
      <OButton
        variant="primary"
        size="sm"
        :disabled="!dataset"
        data-test="ai-dataset-detail-add-item"
        @click="openAddItem"
      >
        {{ t("aiObservability.datasets.detail.addItem.button") }}
      </OButton>
    </template>

    <div class="bg-card-glass-bg flex h-full min-h-0 flex-col" data-test="ai-dataset-detail-body">
      <OTable
        data-test="ai-dataset-detail-items-table"
        :data="items"
        :columns="columns"
        row-key="id"
        :loading="loading"
        show-index
        :footer-title="t('aiObservability.datasets.detail.footerTitle')"
        :global-filter="search"
        :show-global-filter="false"
        pagination="server"
        :current-page="currentPage"
        :total-count="totalItems"
        :page-size="pageSize"
        :page-size-options="pageSizeOptions"
        :default-columns="false"
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="ai-dataset-items"
        width="100%"
        class="h-full w-full"
        @update:current-page="onPageChange"
        @update:page-size="onPageSizeChange"
        @row-click="openItemDetail"
      >
        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            data-test="ai-dataset-detail-refresh-btn"
            @click="refresh"
          >
            <OTooltip side="bottom" :content="t('common.refresh')" />
          </OButton>
        </template>

        <template #toolbar>
          <OSearchInput
            v-model="search"
            class="min-w-0 flex-1"
            :placeholder="t('aiObservability.datasets.detail.searchPlaceholder')"
            data-test="ai-dataset-detail-search-input"
            clearable
          />
        </template>

        <template #empty>
          <div class="flex items-center justify-center py-8">
            <OEmptyState
              size="hero"
              preset="no-dataset-items"
              :filtered="Boolean(search)"
              data-test="ai-dataset-detail-empty-state"
              @action="openAddItem"
            />
          </div>
        </template>

        <!-- Show the message CONTENT; the role envelope is kept in the stored
             value but only adds noise in a two-line cell. -->
        <template #cell-input="{ row }">
          <span class="text-text-body line-clamp-2">{{ row.inputPreview }}</span>
        </template>

        <template #cell-expectedOutput="{ row }">
          <span class="text-text-body line-clamp-2">{{ row.expectedOutput }}</span>
        </template>

        <template #cell-source="{ row }">
          <OTag :variant="sourceVariant(row.source)" shape="rounded" class="shrink-0">
            {{ t(`aiObservability.datasets.source.${row.source}`) }}
          </OTag>
        </template>

        <template #cell-tags="{ row }">
          <div v-if="row.tags.length" class="flex flex-wrap items-center gap-1">
            <OTag
              v-for="tag in row.tags"
              :key="tag"
              variant="default-soft"
              shape="rounded"
              class="shrink-0"
            >
              {{ tag }}
            </OTag>
          </div>
          <span v-else class="text-text-secondary">—</span>
        </template>

        <template #cell-version="{ row }">
          <span class="tabular-nums">{{ versionLabel(row.version) }}</span>
        </template>

        <template #cell-actions="{ row }">
          <div class="actions-container flex items-center justify-center">
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="edit"
              :data-test="`ai-dataset-detail-item-edit-${row.id}`"
              @click.stop="openEditItem(row)"
            >
              <OTooltip side="bottom" :content="t('common.edit')" />
            </OButton>
            <OButton
              variant="ghost-destructive"
              size="icon-sm"
              icon-left="delete"
              :data-test="`ai-dataset-detail-item-delete-${row.id}`"
              @click.stop="removeItem(row)"
            >
              <OTooltip side="bottom" :content="t('common.delete')" />
            </OButton>
          </div>
        </template>
      </OTable>
    </div>

    <!-- Item detail — the app convention for an entity detail view. Mounted only
         while a row is selected so it always loads that item's versions fresh. -->
    <DatasetItemDetail
      v-if="detailItem"
      :item="detailItem"
      :dataset-id="datasetId"
      @close="detailItem = null"
      @edit="editFromDetail"
      @delete="deleteFromDetail"
    />

    <!-- Add / Edit item — a drawer, same shell as the dataset create/edit form -->
    <ODrawer
      v-model:open="itemOpen"
      side="right"
      size="lg"
      :title="
        editingItemId
          ? t('aiObservability.datasets.detail.addItem.editTitle')
          : t('aiObservability.datasets.detail.addItem.title')
      "
      form-id="dataset-item-form"
      :primary-button-label="t('common.save')"
      :secondary-button-label="t('common.cancel')"
      :primary-button-loading="isItemSubmitting"
      data-test="ai-dataset-detail-item-drawer"
      @click:secondary="itemOpen = false"
    >
      <OForm id="dataset-item-form" :form="itemForm">
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <span
              class="o-input-label text-compact text-input-label-text leading-tight font-medium"
            >
              {{ t("aiObservability.datasets.detail.addItem.inputLabel") }}
            </span>
            <OFormTextarea
              name="input"
              :placeholder="t('aiObservability.datasets.detail.addItem.inputPlaceholder')"
              :rows="3"
              required
              data-test="ai-dataset-detail-item-input"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <span
              class="o-input-label text-compact text-input-label-text leading-tight font-medium"
            >
              {{ t("aiObservability.datasets.detail.addItem.expectedLabel") }}
            </span>
            <OFormTextarea
              name="expectedOutput"
              :placeholder="t('aiObservability.datasets.detail.addItem.expectedPlaceholder')"
              :rows="4"
              required
              data-test="ai-dataset-detail-item-expected"
            />
            <span v-if="editingItemId" class="text-text-secondary text-2xs">
              {{ t("aiObservability.datasets.detail.addItem.versionNote") }}
            </span>
          </div>
          <div class="flex flex-col gap-1.5">
            <span class="inline-flex items-center gap-1">
              <span
                class="o-input-label text-compact text-input-label-text leading-tight font-medium"
              >
                {{ t("aiObservability.datasets.create.tagsLabel") }}
              </span>
              <span class="text-text-secondary text-2xs font-normal">{{
                t("common.optional")
              }}</span>
            </span>
            <OFormTagInput
              name="tags"
              :placeholder="t('aiObservability.datasets.create.tagsPlaceholder')"
              data-test="ai-dataset-detail-item-tags"
            />
          </div>
        </div>
      </OForm>
    </ODrawer>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import { useRoute } from "vue-router";
import { formatDistanceToNowStrict } from "date-fns";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormTagInput from "@/lib/forms/TagInput/OFormTagInput.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import DatasetItemDetail from "@/enterprise/components/AIObservability/DatasetItemDetail.vue";
import { makeDatasetItemFormSchema, type DatasetItemForm } from "./DatasetItemForm.schema";
import llmDatasetsService, {
  DATASET_ITEMS_MAX_PAGE_SIZE,
  type LlmDataset,
  type LlmDatasetItem,
  type LlmDatasetItemSource,
} from "@/services/llm-datasets.service";

defineOptions({ name: "AIDatasetDetailPage" });

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const { confirm } = useConfirmDialog();

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const datasetId = computed<string>(() => String(route.params.id ?? ""));

const dataset = ref<LlmDataset | null>(null);
const items = ref<LlmDatasetItem[]>([]);
const loading = ref(false);
const search = ref("");

// The items endpoint pages server-side (size 1..100), so the table does too.
const currentPage = ref(1);
const pageSize = ref(20);
const totalItems = ref(0);
const pageSizeOptions = [20, 50, DATASET_ITEMS_MAX_PAGE_SIZE];

/** The `v` prefix is a version marker, not copy — same shape as the pill on the
 *  item detail drawer. */
const versionLabel = (version: number) => raw(`v${version}`);

const backTarget = computed(() => ({
  label: t("aiObservability.nav.datasets"),
  to: { name: "aiDatasets", query: { org_identifier: orgId.value } },
}));

const metaSubtitle = computed(() => {
  if (!dataset.value) return raw("");
  const updated = dataset.value.updatedAt
    ? formatDistanceToNowStrict(new Date(dataset.value.updatedAt), { addSuffix: true })
    : "";
  return t("aiObservability.datasets.detail.meta", {
    count: totalItems.value,
    updated,
  });
});

const columns = computed(() => [
  {
    id: "input",
    header: t("aiObservability.datasets.detail.columns.input"),
    accessorKey: "input",
    sortable: false,
    size: COL.name,
    minSize: 200,
    meta: { align: "left", flex: true },
  },
  {
    id: "expectedOutput",
    header: t("aiObservability.datasets.detail.columns.expectedOutput"),
    accessorKey: "expectedOutput",
    sortable: false,
    size: COL.name,
    minSize: 200,
    meta: { align: "left", flex: true },
  },
  {
    id: "source",
    header: t("aiObservability.datasets.detail.columns.source"),
    accessorKey: "source",
    hideable: true,
    // Not sortable: the items API takes no sort param, so a client sort would
    // only reorder the loaded page.
    sortable: false,
    size: 130,
    meta: { align: "left" },
  },
  {
    id: "tags",
    header: t("aiObservability.datasets.detail.columns.tags"),
    accessorKey: "tags",
    hideable: true,
    sortable: false,
    size: 200,
    meta: { align: "left" },
  },
  {
    id: "version",
    header: t("aiObservability.datasets.detail.columns.version"),
    accessorKey: "version",
    hideable: true,
    sortable: false,
    size: 90,
    meta: { align: "left" },
  },
  {
    id: "actions",
    header: t("aiObservability.datasets.detail.columns.actions"),
    accessorKey: "actions",
    sortable: false,
    size: 96,
    pinned: "right" as const,
    meta: { align: "center", cellClass: "actions-column", actionCount: 2 },
  },
]);

function sourceVariant(source: LlmDatasetItemSource): BadgeVariant {
  return source === "trace" ? "blue-soft" : source === "annotation" ? "purple-soft" : "orange-soft";
}

async function refresh() {
  if (!orgId.value || !datasetId.value) return;
  loading.value = true;
  try {
    const [ds, page] = await Promise.all([
      llmDatasetsService.get(orgId.value, datasetId.value),
      llmDatasetsService.listItems(orgId.value, datasetId.value, {
        from: (currentPage.value - 1) * pageSize.value,
        size: pageSize.value,
      }),
    ]);
    dataset.value = ds;
    items.value = page.items;
    totalItems.value = page.total;
  } catch {
    toast({ variant: "error", message: t("aiObservability.datasets.detail.loadError") });
  } finally {
    loading.value = false;
  }
}

function onPageChange(page: number) {
  currentPage.value = page;
  refresh();
}

function onPageSizeChange(size: number) {
  pageSize.value = size;
  currentPage.value = 1;
  refresh();
}

// ── Item detail ──
// Only one overlay is shown at a time: editing from the detail closes it and
// opens the form, so the two drawers never stack.
const detailItem = ref<LlmDatasetItem | null>(null);

function openItemDetail(row: LlmDatasetItem) {
  detailItem.value = row;
}

function editFromDetail(row: LlmDatasetItem) {
  detailItem.value = null;
  openEditItem(row);
}

async function deleteFromDetail(row: LlmDatasetItem) {
  const removed = await removeItem(row);
  if (removed) detailItem.value = null;
}

// ── Add / Edit item (one form, editingItemId decides the mode) ──
const itemOpen = ref(false);
const editingItemId = ref<string | null>(null);
const itemForm = useOForm<DatasetItemForm>({
  defaultValues: { input: "", expectedOutput: "", tags: [] },
  schema: makeDatasetItemFormSchema(t),
  onSubmit: saveItem,
});
const isItemSubmitting = itemForm.useStore((s: any) => s.isSubmitting as boolean);

function openAddItem() {
  editingItemId.value = null;
  itemForm.reset({ input: "", expectedOutput: "", tags: [] });
  itemOpen.value = true;
}

function openEditItem(row: LlmDatasetItem) {
  editingItemId.value = row.id;
  itemForm.reset({ input: row.input, expectedOutput: row.expectedOutput, tags: [...row.tags] });
  itemOpen.value = true;
}

async function saveItem(values: DatasetItemForm) {
  if (!orgId.value || !dataset.value) return;
  const input = values.input.trim();
  const expectedOutput = values.expectedOutput.trim();
  const editing = items.value.find((item) => item.id === editingItemId.value) ?? null;
  const payload = {
    // Both fields are JSON server-side. When the text is untouched, re-send the
    // original value so a structured input (a messages array) isn't flattened
    // into a string by an edit that only changed the answer.
    input: editing && input === editing.input ? editing.rawInput : input,
    expectedOutput:
      editing && expectedOutput === editing.expectedOutput
        ? editing.rawExpectedOutput
        : expectedOutput,
    // The update endpoint replaces the whole row, so metadata has to be re-sent
    // or an edit silently wipes the item's subset-filter dimensions.
    metadata: editing?.metadata ?? null,
    tags: values.tags,
  };
  try {
    if (editingItemId.value) {
      await llmDatasetsService.updateItem(
        orgId.value,
        dataset.value.id,
        editingItemId.value,
        payload,
      );
    } else {
      await llmDatasetsService.addItem(orgId.value, dataset.value.id, payload);
    }
    toast({ variant: "success", message: t("aiObservability.datasets.detail.addItem.success") });
    itemOpen.value = false;
    await refresh();
  } catch {
    toast({ variant: "error", message: t("aiObservability.datasets.detail.addItem.error") });
  }
}

async function removeItem(row: LlmDatasetItem): Promise<boolean> {
  if (!dataset.value) return false;
  const ok = await confirm({
    title: t("aiObservability.datasets.detail.deleteItemTitle"),
    message: t("aiObservability.datasets.detail.deleteItemMessage"),
    confirmLabel: t("common.delete"),
    cancelLabel: t("common.cancel"),
  });
  if (!ok) return false;
  try {
    await llmDatasetsService.removeItem(orgId.value, dataset.value.id, row.id);
    toast({ variant: "success", message: t("aiObservability.datasets.detail.deleteItemSuccess") });
    await refresh();
    return true;
  } catch {
    toast({ variant: "error", message: t("aiObservability.datasets.detail.deleteItemError") });
    return false;
  }
}

onMounted(refresh);
</script>
