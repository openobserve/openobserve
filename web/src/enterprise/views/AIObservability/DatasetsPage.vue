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
      </OTable>
    </div>

    <ODialog
      v-model:open="createOpen"
      :title="t('aiObservability.datasets.create.title')"
      :primary-button-label="t('common.create')"
      :secondary-button-label="t('common.cancel')"
      :primary-button-disabled="!canSubmit"
      :primary-button-loading="creating"
      data-test="ai-datasets-create-dialog"
      @click:primary="submitCreate"
      @click:secondary="createOpen = false"
    >
      <div class="flex flex-col gap-4 p-1">
        <OInput
          v-model="form.name"
          :label="t('aiObservability.datasets.create.nameLabel')"
          :placeholder="t('aiObservability.datasets.create.namePlaceholder')"
          required
          data-test="ai-datasets-create-name"
        />
        <OTextarea
          v-model="form.description"
          :label="t('aiObservability.datasets.create.descriptionLabel')"
          :placeholder="t('aiObservability.datasets.create.descriptionPlaceholder')"
          :rows="3"
          data-test="ai-datasets-create-description"
        />
        <div class="flex flex-col gap-1.5">
          <span class="text-input-label-text text-sm font-medium">
            {{ t("aiObservability.datasets.create.tagsLabel") }}
          </span>
          <OTagInput
            v-model="form.tags"
            :placeholder="t('aiObservability.datasets.create.tagsPlaceholder')"
            data-test="ai-datasets-create-tags"
          />
        </div>
      </div>
    </ODialog>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OTagInput from "@/lib/forms/TagInput/OTagInput.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useNumberedRows } from "@/enterprise/components/onlineEvals/composables/useNumberedRows";
import llmDatasetsService, { type LlmDataset } from "@/services/llm-datasets.service";

defineOptions({ name: "AIDatasetsPage" });

const { t } = useI18n();
const store = useStore();

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

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

// ── Create dialog ──
const createOpen = ref(false);
const creating = ref(false);
const form = reactive({ name: "", description: "", tags: [] as string[] });

const canSubmit = computed(() => form.name.trim().length > 0);

function openCreate() {
  form.name = "";
  form.description = "";
  form.tags = [];
  createOpen.value = true;
}

async function submitCreate() {
  if (!canSubmit.value || !orgId.value) return;
  creating.value = true;
  try {
    await llmDatasetsService.create(orgId.value, {
      name: form.name.trim(),
      description: form.description.trim() || null,
      tags: form.tags,
    });
    toast({ variant: "success", message: t("aiObservability.datasets.create.success") });
    createOpen.value = false;
    await refresh();
  } catch {
    toast({ variant: "error", message: t("aiObservability.datasets.create.error") });
  } finally {
    creating.value = false;
  }
}

onMounted(refresh);
</script>
