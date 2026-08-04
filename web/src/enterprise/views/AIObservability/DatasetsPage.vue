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
  Datasets — the first slice of the AI Observability "Annotate" section. Golden
  (MVCC) datasets that the annotation workflow feeds into. Frontend-first: this
  page reads llm-datasets.service.ts, which serves mock fixtures until the
  backend API lands (see VITE_LLM_ANNOTATION_MOCK). No page-level date range —
  datasets are configuration objects, not time-series — so it uses OPageLayout
  directly rather than AiPageShell.
-->
<template>
  <OPageLayout
    data-test="ai-datasets-page"
    :title="t('aiObservability.nav.datasets')"
    :subtitle="t('aiObservability.subtitle.datasets')"
    icon="table-chart"
    bleed
    :scroll="false"
  >
    <template #actions>
      <OButton
        variant="primary"
        size="sm"
        icon-left="add"
        data-test="ai-datasets-new-btn"
        @click="openCreate"
      >
        {{ t("aiObservability.datasets.newButton") }}
      </OButton>
      <div
        class="border-border-default rounded-default ml-2 inline-flex h-8 items-center overflow-hidden border px-1"
      >
        <ORefreshButton
          :last-run-at="lastRunAt"
          :loading="loading"
          :disabled="loading"
          data-test="ai-datasets-refresh-btn"
          @click="refresh"
        />
      </div>
    </template>

    <div class="bg-card-glass-bg flex h-full min-h-0 flex-col" data-test="ai-datasets-list-page">
      <OTable
        data-test="ai-datasets-list-table"
        :data="numberedRows"
        :columns="columns"
        row-key="id"
        :loading="loading"
        @row-click="openDetail"
        :footer-title="t('aiObservability.datasets.listTitle')"
        :global-filter="search"
        :show-global-filter="false"
        :page-size="20"
        :page-size-options="[20, 50, 100, 250, 500]"
        :default-columns="false"
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="ai-datasets-list"
        width="100%"
        class="h-full w-full"
      >
        <template #toolbar>
          <OSearchInput
            v-model="search"
            class="min-w-0 flex-1"
            :placeholder="t('aiObservability.datasets.searchPlaceholder')"
            data-test="ai-datasets-list-search-input"
            clearable
          />
        </template>

        <template #empty>
          <div class="flex items-center justify-center py-8">
            <OEmptyState
              size="hero"
              preset="no-datasets"
              :filtered="Boolean(search)"
              data-test="ai-datasets-empty-state"
              @action="openCreate"
            />
          </div>
        </template>

        <template #cell-description="{ row }">
          <span class="text-text-secondary line-clamp-1">{{ row.description || "—" }}</span>
        </template>

        <template #cell-tags="{ row }">
          <div v-if="row.tags.length" class="flex flex-nowrap items-center gap-1">
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

        <template #cell-sources="{ row }">
          <div class="flex flex-nowrap items-center gap-1.5">
            <OTag variant="blue-soft" :count="row.sources.trace">
              {{ t("aiObservability.datasets.source.trace") }}
            </OTag>
            <OTag variant="purple-soft" :count="row.sources.annotation">
              {{ t("aiObservability.datasets.source.annotation") }}
            </OTag>
            <OTag variant="orange-soft" :count="row.sources.manual">
              {{ t("aiObservability.datasets.source.manual") }}
            </OTag>
          </div>
        </template>

        <template #cell-itemCount="{ row }">
          <span class="tabular-nums">{{ row.itemCount }}</span>
        </template>

        <template #cell-globalVersion="{ row }">
          <span class="tabular-nums">v{{ row.globalVersion }}</span>
        </template>

        <template #cell-updatedAt="{ row }">
          <OTimeCell :value="row.updatedAt" unit="ms" mode="relative" empty-label="—" />
        </template>

        <template #cell-actions="{ row }">
          <div class="actions-container flex items-center justify-center">
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="edit"
              :data-test="`ai-datasets-edit-${row.id}`"
              @click.stop="openEdit(row)"
            >
              <OTooltip side="bottom" :content="t('common.edit')" />
            </OButton>
            <OButton
              variant="ghost-destructive"
              size="icon-sm"
              icon-left="delete"
              :data-test="`ai-datasets-delete-${row.id}`"
              @click.stop="removeDataset(row)"
            >
              <OTooltip side="bottom" :content="t('common.delete')" />
            </OButton>
          </div>
        </template>
      </OTable>
    </div>

    <ODialog
      v-model:open="createOpen"
      :title="editingId ? t('aiObservability.datasets.editTitle') : t('aiObservability.datasets.create.title')"
      form-id="new-dataset-form"
      :primary-button-label="t('common.save')"
      :secondary-button-label="t('common.cancel')"
      :primary-button-loading="isSubmitting"
      data-test="ai-datasets-create-dialog"
      @click:secondary="createOpen = false"
    >
      <OForm id="new-dataset-form" :form="form">
        <div class="flex flex-col gap-4 p-1">
          <OFormInput
            name="name"
            :label="t('aiObservability.datasets.create.nameLabel')"
            :placeholder="t('aiObservability.datasets.create.namePlaceholder')"
            required
            data-test="ai-datasets-create-name"
          />
          <div class="flex flex-col gap-1.5">
            <span class="inline-flex items-center gap-1">
              <span
                class="o-input-label text-compact text-input-label-text leading-tight font-medium"
              >
                {{ t("aiObservability.datasets.create.descriptionLabel") }}
              </span>
              <span class="text-text-secondary text-2xs font-normal">{{ t("common.optional") }}</span>
            </span>
            <OFormTextarea
              name="description"
              :placeholder="t('aiObservability.datasets.create.descriptionPlaceholder')"
              :rows="3"
              data-test="ai-datasets-create-description"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <span class="inline-flex items-center gap-1">
              <span
                class="o-input-label text-compact text-input-label-text leading-tight font-medium"
              >
                {{ t("aiObservability.datasets.create.tagsLabel") }}
              </span>
              <span class="text-text-secondary text-2xs font-normal">{{ t("common.optional") }}</span>
            </span>
            <OFormTagInput
              name="tags"
              :placeholder="t('aiObservability.datasets.create.tagsPlaceholder')"
              data-test="ai-datasets-create-tags"
            />
          </div>
        </div>
      </OForm>
    </ODialog>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormTagInput from "@/lib/forms/TagInput/OFormTagInput.vue";
import { makeDatasetFormSchema, type DatasetForm } from "./DatasetForm.schema";
import OTag from "@/lib/core/Badge/OTag.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useNumberedRows } from "@/enterprise/components/onlineEvals/composables/useNumberedRows";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import llmDatasetsService, { type LlmDataset } from "@/services/llm-datasets.service";

defineOptions({ name: "AIDatasetsPage" });

const { t } = useI18n();
const store = useStore();
const router = useRouter();
const { confirm } = useConfirmDialog();

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

function openDetail(row: LlmDataset) {
  router.push({
    name: "aiDatasetDetail",
    params: { id: row.id },
    query: { org_identifier: orgId.value },
  });
}

const datasets = ref<LlmDataset[]>([]);
const loading = ref(false);
const lastRunAt = ref<number | null>(null);
const search = ref("");

const numberedRows = useNumberedRows(datasets);

const columns = computed(() => [
  { id: "#", header: "#", accessorKey: "#", sortable: false, size: 56, meta: { align: "left" } },
  {
    id: "name",
    header: t("aiObservability.datasets.columns.name"),
    accessorKey: "name",
    sortable: true,
    size: COL.name,
    minSize: 160,
    meta: { align: "left", flex: true },
  },
  {
    id: "description",
    header: t("aiObservability.datasets.columns.description"),
    accessorKey: "description",
    hideable: true,
    sortable: false,
    size: 280,
    meta: { align: "left" },
  },
  {
    id: "tags",
    header: t("aiObservability.datasets.columns.tags"),
    accessorKey: "tags",
    hideable: true,
    sortable: false,
    size: 240,
    meta: { align: "left" },
  },
  {
    id: "sources",
    header: t("aiObservability.datasets.columns.sources"),
    accessorKey: "sources",
    hideable: true,
    sortable: false,
    size: 300,
    meta: { align: "left" },
  },
  {
    id: "itemCount",
    header: t("aiObservability.datasets.columns.items"),
    accessorKey: "itemCount",
    hideable: true,
    sortable: true,
    size: 100,
    meta: { align: "left" },
  },
  {
    id: "globalVersion",
    header: t("aiObservability.datasets.columns.version"),
    accessorKey: "globalVersion",
    hideable: true,
    sortable: true,
    size: 100,
    meta: { align: "left" },
  },
  {
    id: "updatedAt",
    header: t("aiObservability.datasets.columns.updated"),
    accessorKey: "updatedAt",
    hideable: true,
    sortable: true,
    size: COL.createdAt,
    meta: { align: "left" },
  },
  {
    id: "actions",
    header: t("aiObservability.datasets.columns.actions"),
    accessorKey: "actions",
    sortable: false,
    size: 96,
    pinned: "right" as const,
    meta: { align: "center", cellClass: "actions-column", actionCount: 2 },
  },
]);

async function refresh() {
  if (!orgId.value) return;
  loading.value = true;
  try {
    datasets.value = await llmDatasetsService.list(orgId.value);
    lastRunAt.value = Date.now();
  } catch {
    toast({ variant: "error", message: t("aiObservability.datasets.loadError") });
  } finally {
    loading.value = false;
  }
}

// ── Create / Edit dialog (useOForm + Zod — mirrors ScoreConfigDialog) ──
// One dialog serves both: `editingId` (null = create) decides the mode. Every
// field is a name-bound OForm* input, so no setFieldValue bridge is needed.
const createOpen = ref(false);
const editingId = ref<string | null>(null);

const form = useOForm<DatasetForm>({
  defaultValues: { name: "", description: "", tags: [] },
  schema: makeDatasetFormSchema(t),
  onSubmit: save,
});
const isSubmitting = form.useStore((s: any) => s.isSubmitting as boolean);

function openCreate() {
  editingId.value = null;
  form.reset();
  createOpen.value = true;
}

function openEdit(row: LlmDataset) {
  editingId.value = row.id;
  form.reset({ name: row.name, description: row.description ?? "", tags: [...row.tags] });
  createOpen.value = true;
}

// Runs only after the Zod schema passes (name required).
async function save(values: DatasetForm) {
  if (!orgId.value) return;
  const payload = {
    name: values.name.trim(),
    description: values.description.trim() || null,
    tags: values.tags,
  };
  try {
    if (editingId.value) {
      await llmDatasetsService.update(orgId.value, editingId.value, payload);
      toast({ variant: "success", message: t("aiObservability.datasets.editSuccess") });
    } else {
      await llmDatasetsService.create(orgId.value, payload);
      toast({ variant: "success", message: t("aiObservability.datasets.create.success") });
    }
    createOpen.value = false;
    await refresh();
  } catch {
    toast({
      variant: "error",
      message: editingId.value
        ? t("aiObservability.datasets.editError")
        : t("aiObservability.datasets.create.error"),
    });
  }
}

async function removeDataset(row: LlmDataset) {
  const ok = await confirm({
    title: t("aiObservability.datasets.deleteTitle"),
    message: t("aiObservability.datasets.deleteMessage", { name: row.name }),
    confirmLabel: t("common.delete"),
    cancelLabel: t("common.cancel"),
  });
  if (!ok) return;
  try {
    await llmDatasetsService.remove(orgId.value, row.id);
    toast({ variant: "success", message: t("aiObservability.datasets.deleteSuccess") });
    await refresh();
  } catch {
    toast({ variant: "error", message: t("aiObservability.datasets.deleteError") });
  }
}

onMounted(refresh);
</script>
