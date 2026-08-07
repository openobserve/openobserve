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
  Queues — the second slice of the AI Observability "Annotate" section. A queue
  is a stateful review to-do list (bound Score Configs + target dataset + a
  feeding filter). Frontend-first: reads llm-queues.service.ts, which serves
  mock fixtures until the backend API lands (VITE_LLM_ANNOTATION_MOCK). The
  Review action (and a row click) opens the Queue Detail route; the actual review
  workbench launches from there in a later slice.
-->
<template>
  <OPageLayout
    data-test="ai-queues-page"
    :title="t('aiObservability.nav.queues')"
    :subtitle="t('aiObservability.subtitle.queues')"
    icon="fact-check"
    bleed
    :scroll="false"
  >
    <template #actions>
      <OButton
        variant="primary"
        size="sm"
        icon-left="add"
        data-test="ai-queues-new-btn"
        @click="openCreate"
      >
        {{ t("aiObservability.queues.newButton") }}
      </OButton>
      <div
        class="border-border-default rounded-default ml-2 inline-flex h-8 items-center overflow-hidden border px-1"
      >
        <ORefreshButton
          :last-run-at="lastRunAt"
          :loading="loading"
          :disabled="loading"
          data-test="ai-queues-refresh-btn"
          @click="refresh"
        />
      </div>
    </template>

    <div class="bg-card-glass-bg flex h-full min-h-0 flex-col" data-test="ai-queues-list-page">
      <OTable
        data-test="ai-queues-list-table"
        :data="numberedRows"
        :columns="columns"
        row-key="id"
        :loading="loading"
        :footer-title="t('aiObservability.queues.listTitle')"
        :global-filter="search"
        :show-global-filter="false"
        :page-size="20"
        :page-size-options="[20, 50, 100, 250, 500]"
        :default-columns="false"
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="ai-queues-list"
        width="100%"
        class="h-full w-full"
        @row-click="openDetail"
      >
        <template #toolbar>
          <OSearchInput
            v-model="search"
            class="min-w-0 flex-1"
            :placeholder="t('aiObservability.queues.searchPlaceholder')"
            data-test="ai-queues-list-search-input"
            clearable
          />
        </template>

        <template #empty>
          <div class="flex items-center justify-center py-8">
            <OEmptyState
              size="hero"
              preset="no-queues"
              :filtered="Boolean(search)"
              data-test="ai-queues-empty-state"
              @action="openCreate"
            />
          </div>
        </template>

        <template #cell-description="{ row }">
          <span class="text-text-secondary line-clamp-1">{{ row.description || "—" }}</span>
        </template>

        <template #cell-scoreConfigs="{ row }">
          <div v-if="row.scoreConfigs.length" class="flex flex-nowrap items-center gap-1">
            <OTag
              v-for="cfg in row.scoreConfigs"
              :key="cfg.scoreConfigId"
              :variant="isStale(cfg) ? 'orange-soft' : 'default-soft'"
              shape="rounded"
              class="shrink-0"
            >
              {{ cfg.name }} v{{ cfg.version }}
            </OTag>
          </div>
          <span v-else class="text-text-secondary">—</span>
        </template>

        <template #cell-targetDataset="{ row }">
          <span v-if="row.targetDatasetName" class="flex items-center gap-1.5">
            <OIcon name="table-chart" size="sm" class="text-text-secondary shrink-0" />
            <span class="truncate">{{ row.targetDatasetName }}</span>
          </span>
          <span v-else class="text-text-secondary">—</span>
        </template>

        <template #cell-progress="{ row }">
          <div class="flex min-w-0 flex-col gap-1">
            <div class="flex items-center justify-between gap-2 text-xs tabular-nums">
              <span class="text-text-secondary">
                {{ t("aiObservability.queues.reviewedCount", { reviewed: row.reviewedCount, total: row.totalCount }) }}
              </span>
              <span :class="isCleared(row) ? 'text-status-success-text font-semibold' : 'text-text-body font-semibold'">
                {{ percent(row) }}%
              </span>
            </div>
            <OProgressBar
              :value="fraction(row)"
              :variant="isCleared(row) ? 'success' : 'default'"
              size="sm"
            />
          </div>
        </template>

        <template #cell-updatedAt="{ row }">
          <OTimeCell :value="row.updatedAt" unit="ms" mode="relative" empty-label="—" />
        </template>

        <template #cell-actions="{ row }">
          <div class="flex justify-end">
            <OTag v-if="isCleared(row)" variant="success-soft" icon="check-circle" data-test="ai-queues-cleared">
              {{ t("aiObservability.queues.cleared") }}
            </OTag>
            <OButton
              v-else
              variant="primary"
              size="sm"
              icon-left="play-arrow"
              data-test="ai-queues-review-btn"
              @click.stop="openDetail(row)"
            >
              {{ t("aiObservability.queues.review") }}
            </OButton>
          </div>
        </template>
      </OTable>
    </div>

    <ODrawer
      v-model:open="createOpen"
      side="right"
      size="lg"
      :title="t('aiObservability.queues.create.title')"
      form-id="new-queue-form"
      :primary-button-label="t('common.save')"
      :secondary-button-label="t('common.cancel')"
      :primary-button-loading="isSubmitting"
      data-test="ai-queues-create-drawer"
      @click:secondary="createOpen = false"
    >
      <OForm id="new-queue-form" :form="form">
        <div class="flex flex-col gap-4">
          <OFormInput
            name="name"
            :label="t('aiObservability.queues.create.nameLabel')"
            :placeholder="t('aiObservability.queues.create.namePlaceholder')"
            required
            data-test="ai-queues-create-name"
          />
          <OFormTextarea
            name="description"
            :label="t('aiObservability.queues.create.descriptionLabel')"
            :placeholder="t('aiObservability.queues.create.descriptionPlaceholder')"
            :rows="3"
            data-test="ai-queues-create-description"
          />

        <!-- Score Configs (required) — bind one or more, pin each to a version -->
        <div class="flex flex-col gap-2">
          <span class="inline-flex items-center gap-1">
            <span
              class="o-input-label text-compact text-input-label-text leading-tight font-medium"
            >
              {{ t("aiObservability.queues.create.scoreConfigsLabel")
              }}<span aria-hidden="true"> *</span>
            </span>
            <OIcon name="info-outline" size="sm" class="text-text-secondary">
              <OTooltip
                :content="t('aiObservability.queues.create.scoreConfigsHint')"
                max-width="20rem"
              />
            </OIcon>
          </span>

          <div
            v-if="!formValues.scoreConfigs.length"
            class="border-border-default rounded-default text-text-secondary flex items-center justify-center border border-dashed px-3 py-6 text-center text-xs"
            data-test="ai-queues-create-configs-empty"
          >
            {{ t("aiObservability.queues.create.scoreConfigsEmpty") }}
          </div>
          <div v-else class="flex flex-col gap-2">
            <div
              v-for="(cfg, i) in formValues.scoreConfigs"
              :key="cfg.scoreConfigId"
              class="border-status-info-text rounded-default bg-status-info-bg text-text-body flex items-center gap-2.5 border px-3 py-2 text-xs"
              :data-test="`ai-queues-create-config-${cfg.scoreConfigId}`"
            >
              <span class="bg-status-info-text h-2 w-2 shrink-0 rounded-full" />
              <strong class="min-w-0 flex-1 truncate font-mono">{{ cfg.name }}</strong>
              <OTag type="evalDataType" :value="cfg.dataType" class="shrink-0" />
              <OIcon name="keep-outline" size="sm" class="text-text-secondary shrink-0">
                <OTooltip :content="t('aiObservability.queues.create.pin')" />
              </OIcon>
              <OSelect
                :model-value="cfg.version"
                :options="versionOptions(cfg.scoreConfigId)"
                label-key="label"
                value-key="value"
                width="xs"
                :searchable="false"
                class="shrink-0"
                data-test="ai-queues-create-config-version"
                @update:model-value="(v: unknown) => setConfigVersion(i, Number(v))"
              />
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="close"
                :aria-label="t('common.remove')"
                data-test="ai-queues-create-config-remove"
                @click="removeConfig(i)"
              />
            </div>
          </div>

          <OSelect
            v-if="availableConfigs.length"
            :model-value="addConfigModel"
            :options="availableConfigOptions"
            label-key="label"
            value-key="value"
            multiple
            :placeholder="t('aiObservability.queues.create.addScoreConfig')"
            class="w-full"
            data-test="ai-queues-create-add-config"
            @update:model-value="onAddConfig"
          />
          <span
            v-else-if="!configOptions.length"
            class="text-text-secondary text-2xs"
            data-test="ai-queues-create-no-configs"
          >
            {{ t("aiObservability.queues.create.noScoreConfigs") }}
          </span>
          <span
            v-else
            class="text-text-secondary text-2xs"
            data-test="ai-queues-create-all-configs-added"
          >
            {{ t("aiObservability.queues.create.allScoreConfigsAdded") }}
          </span>

          <span
            v-if="scoreConfigsError"
            class="text-status-error-text text-2xs"
            data-test="ai-queues-create-configs-error"
          >
            {{ scoreConfigsError }}
          </span>
        </div>

        <!-- Target dataset (optional) -->
        <div class="flex flex-col gap-1.5">
          <span class="inline-flex items-center gap-1">
            <span
              class="o-input-label text-compact text-input-label-text leading-tight font-medium"
            >
              {{ t("aiObservability.queues.create.targetDatasetLabel") }}
            </span>
            <span class="text-text-secondary text-2xs font-normal">{{ t("common.optional") }}</span>
            <OIcon name="info-outline" size="sm" class="text-text-secondary">
              <OTooltip
                :content="t('aiObservability.queues.create.targetDatasetHint')"
                max-width="20rem"
              />
            </OIcon>
          </span>
          <OSelect
            :model-value="formValues.targetDatasetId"
            :options="datasetOptions"
            label-key="label"
            value-key="value"
            :placeholder="t('aiObservability.queues.create.targetDatasetNone')"
            clearable
            class="w-full"
            data-test="ai-queues-create-target-dataset"
            @update:model-value="setTargetDataset"
          />
        </div>

        <!-- Auto-routing (optional) — enqueue objects whose scores match rules -->
        <div class="flex flex-col gap-2">
          <span class="inline-flex items-center gap-1">
            <span
              class="o-input-label text-compact text-input-label-text leading-tight font-medium"
            >
              {{ t("aiObservability.queues.create.autoRoutingLabel") }}
            </span>
            <span class="text-text-secondary text-2xs font-normal">{{ t("common.optional") }}</span>
            <OIcon name="info-outline" size="sm" class="text-text-secondary">
              <OTooltip
                :content="t('aiObservability.queues.create.autoRoutingHint')"
                max-width="20rem"
              />
            </OIcon>
          </span>

          <div
            v-if="!formValues.autoRouting.conditions.length"
            class="border-border-default rounded-default text-text-secondary flex items-center justify-center border border-dashed px-3 py-5 text-center text-xs"
            data-test="ai-queues-create-auto-routing-empty"
          >
            {{ t("aiObservability.queues.create.autoRoutingEmpty") }}
          </div>
          <div v-else class="flex flex-col gap-2">
            <template v-for="(cond, i) in formValues.autoRouting.conditions" :key="i">
              <div
                v-if="i > 0"
                class="text-text-secondary text-2xs font-semibold tracking-wide"
                data-test="ai-queues-create-condition-and"
              >
                {{ t("aiObservability.queues.create.conditionAnd") }}
              </div>
              <div class="flex items-center gap-2" data-test="ai-queues-create-condition">
                <div class="min-w-0 flex-1">
                  <OSelect
                    :model-value="cond.scoreConfigId"
                    :options="configSelectOptions"
                    label-key="label"
                    value-key="value"
                    :placeholder="t('aiObservability.queues.create.conditionScorePlaceholder')"
                    data-test="ai-queues-create-condition-score"
                    @update:model-value="(v: unknown) => onConditionConfigChange(i, String(v))"
                  />
                </div>
                <OTag type="evalDataType" :value="conditionType(cond)" class="shrink-0" />
                <OSelect
                  :model-value="cond.operator"
                  :options="operatorOptions(cond)"
                  label-key="label"
                  value-key="value"
                  width="xs"
                  class="shrink-0"
                  data-test="ai-queues-create-condition-operator"
                  @update:model-value="(v: unknown) => updateCondition(i, { operator: String(v) })"
                />
                <OInput
                  v-if="conditionType(cond) === 'numeric'"
                  :model-value="cond.value"
                  type="number"
                  width="xs"
                  :placeholder="t('aiObservability.queues.create.conditionValuePlaceholder')"
                  class="shrink-0"
                  data-test="ai-queues-create-condition-value"
                  @update:model-value="(v: string | number) => updateCondition(i, { value: Number(v) })"
                />
                <OSelect
                  v-else
                  :model-value="cond.value"
                  :options="valueOptions(cond)"
                  label-key="label"
                  value-key="value"
                  width="xs"
                  class="shrink-0"
                  data-test="ai-queues-create-condition-value"
                  @update:model-value="(v: unknown) => updateCondition(i, { value: String(v) })"
                />
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  icon-left="close"
                  :aria-label="t('common.remove')"
                  data-test="ai-queues-create-condition-remove"
                  @click="removeCondition(i)"
                />
              </div>
            </template>
          </div>

          <OButton
            variant="outline"
            size="sm"
            icon-left="add"
            :disabled="!configSelectOptions.length"
            data-test="ai-queues-create-add-condition"
            @click="addCondition"
          >
            {{ t("aiObservability.queues.create.addCondition") }}
          </OButton>
          </div>
        </div>
      </OForm>
    </ODrawer>
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
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useNumberedRows } from "@/enterprise/components/onlineEvals/composables/useNumberedRows";
import llmQueuesService, {
  type LlmQueue,
  type LlmQueueBinding,
  type LlmScoreConfigOption,
  type AutoRouteOperator,
  type ScoreConfigDataType,
} from "@/services/llm-queues.service";
import llmDatasetsService from "@/services/llm-datasets.service";
import {
  makeQueueFormSchema,
  type QueueForm,
  type QueueBoundConfig,
  type QueueCondition,
} from "./QueueForm.schema";

defineOptions({ name: "AIQueuesPage" });

const { t } = useI18n();
const store = useStore();
const router = useRouter();

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const orgQuery = computed(() => ({ org_identifier: orgId.value }));

const queues = ref<LlmQueue[]>([]);
const loading = ref(false);
const lastRunAt = ref<number | null>(null);
const search = ref("");

const numberedRows = useNumberedRows(queues);

function isCleared(row: LlmQueue): boolean {
  return row.totalCount > 0 && row.reviewedCount >= row.totalCount;
}

function fraction(row: LlmQueue): number {
  if (!row.totalCount) return 0;
  return row.reviewedCount / row.totalCount;
}

function percent(row: LlmQueue): number {
  return Math.round(fraction(row) * 100);
}

function isStale(cfg: LlmQueueBinding): boolean {
  return cfg.latestVersion !== undefined && cfg.latestVersion > cfg.version;
}

const columns = computed(() => [
  { id: "#", header: "#", accessorKey: "#", sortable: false, size: 56, meta: { align: "left" } },
  {
    id: "name",
    header: t("aiObservability.queues.columns.name"),
    accessorKey: "name",
    sortable: true,
    size: COL.name,
    minSize: 160,
    meta: { align: "left", flex: true },
  },
  {
    id: "description",
    header: t("aiObservability.queues.columns.description"),
    accessorKey: "description",
    hideable: true,
    sortable: false,
    size: 240,
    meta: { align: "left" },
  },
  {
    id: "progress",
    header: t("aiObservability.queues.columns.progress"),
    accessorKey: "reviewedCount",
    hideable: true,
    sortable: true,
    size: 200,
    meta: { align: "left" },
  },
  {
    id: "scoreConfigs",
    header: t("aiObservability.queues.columns.scoreConfigs"),
    accessorKey: "scoreConfigs",
    hideable: true,
    sortable: false,
    size: 300,
    meta: { align: "left" },
  },
  {
    id: "targetDataset",
    header: t("aiObservability.queues.columns.targetDataset"),
    accessorKey: "targetDatasetName",
    hideable: true,
    sortable: true,
    size: 200,
    meta: { align: "left" },
  },
  {
    id: "updatedAt",
    header: t("aiObservability.queues.columns.updated"),
    accessorKey: "updatedAt",
    hideable: true,
    sortable: true,
    size: COL.createdAt,
    meta: { align: "left" },
  },
  {
    id: "actions",
    header: "",
    accessorKey: "actions",
    sortable: false,
    isAction: true,
    size: 130,
    meta: { align: "right" },
  },
]);

async function refresh() {
  if (!orgId.value) return;
  loading.value = true;
  try {
    queues.value = await llmQueuesService.list(orgId.value);
    lastRunAt.value = Date.now();
  } catch {
    toast({ variant: "error", message: t("aiObservability.queues.loadError") });
  } finally {
    loading.value = false;
  }
}

// Review (and a row click) open the review Workbench directly — no intermediate
// item-list page.
function openDetail(row: LlmQueue) {
  router.push({ name: "aiQueueWorkbench", params: { id: row.id }, query: orgQuery.value });
}

// ── Create drawer (useOForm + Zod — mirrors ScoreConfigDialog) ──
// This component OWNS <OForm>: name/description are name-bound OForm* inputs; the
// bespoke controls (score-config bindings, target dataset, auto-routing) bridge
// into the one form via `form.setFieldValue` and read back through `formValues`.
const createOpen = ref(false);
const configOptions = ref<LlmScoreConfigOption[]>([]);
const datasetOptions = ref<{ label: string; value: string }[]>([]);

const emptyForm = (): QueueForm => ({
  name: "",
  description: "",
  scoreConfigs: [],
  targetDatasetId: "",
  autoRouting: { matchMode: "all", conditions: [] },
});

const form = useOForm<QueueForm>({
  defaultValues: emptyForm(),
  schema: makeQueueFormSchema(t),
  onSubmit: save,
});
const formValues = form.useStore((s: any) => s.values as QueueForm);
const isSubmitting = form.useStore((s: any) => s.isSubmitting as boolean);
// Score Configs is a bespoke (non-OForm*) field, so its schema error is surfaced
// manually — the Save button stays enabled and validates on click, like the
// other forms (which don't gate Save on validity).
const scoreConfigsError = form.useStore((s: any) =>
  firstFieldError(s.fieldMeta?.scoreConfigs?.errors ?? []),
);

function setScoreConfigs(next: QueueBoundConfig[]) {
  form.setFieldValue("scoreConfigs", next);
}
function setAutoRouting(next: QueueForm["autoRouting"]) {
  form.setFieldValue("autoRouting", next);
}
function setTargetDataset(v: unknown) {
  form.setFieldValue("targetDatasetId", v == null ? "" : String(v));
}

// Configs not already bound — the "Add Score Config" picker options.
const availableConfigs = computed(() =>
  configOptions.value.filter(
    (o) => !formValues.value.scoreConfigs.some((c) => c.scoreConfigId === o.id),
  ),
);

// Searchable multi-select add-picker (mirrors the Scorer form's Score Config
// select). Tick one or more; each binds and the picker clears back to empty so
// the bound rows below stay the source of truth (no duplicate chips).
const addConfigModel = ref<string[]>([]);
const availableConfigOptions = computed(() =>
  availableConfigs.value.map((o) => ({ label: o.name, value: o.id })),
);
function onAddConfig(v: unknown) {
  const ids = Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)];
  ids.forEach((id) => {
    const opt = availableConfigs.value.find((o) => o.id === id);
    if (opt) addConfig(opt);
  });
  addConfigModel.value = [];
}

// Conditions can only route on the Score Configs the queue actually scores on,
// so the dropdown is the bound set — not the whole catalog.
const configSelectOptions = computed(() =>
  formValues.value.scoreConfigs.map((c) => ({ label: c.name, value: c.scoreConfigId })),
);

function configForId(id: string): LlmScoreConfigOption | undefined {
  return configOptions.value.find((o) => o.id === id);
}

// Auto-routing condition builder — the operator + value adapt to the selected
// Score Config's data type: numeric → comparisons + number input; categorical →
// is / is-not + a category dropdown; boolean → is + true/false.
function conditionType(cond: QueueCondition): ScoreConfigDataType {
  return configForId(cond.scoreConfigId)?.dataType ?? "numeric";
}

const NUMERIC_OPERATORS = [
  { label: "<", value: "<" },
  { label: "≤", value: "<=" },
  { label: ">", value: ">" },
  { label: "≥", value: ">=" },
  { label: "=", value: "==" },
  { label: "≠", value: "!=" },
];

function operatorOptions(cond: QueueCondition) {
  if (conditionType(cond) === "numeric") return NUMERIC_OPERATORS;
  return [
    { label: t("aiObservability.queues.create.operatorIs"), value: "==" },
    { label: t("aiObservability.queues.create.operatorIsNot"), value: "!=" },
  ];
}

function valueOptions(cond: QueueCondition) {
  if (conditionType(cond) === "boolean") {
    return [
      { label: "true", value: "true" },
      { label: "false", value: "false" },
    ];
  }
  return (configForId(cond.scoreConfigId)?.categories ?? []).map((c) => ({ label: c, value: c }));
}

function defaultsForType(cfg: LlmScoreConfigOption | undefined): {
  operator: string;
  value: number | string;
} {
  const type = cfg?.dataType ?? "numeric";
  if (type === "numeric") return { operator: "<", value: 0 };
  if (type === "boolean") return { operator: "==", value: "true" };
  return { operator: "==", value: cfg?.categories?.[0] ?? "" };
}

function versionOptions(configId: string) {
  const cfg = configForId(configId);
  const latest = cfg?.latestVersion;
  return (cfg?.versions ?? [1]).map((v) => ({
    label: v === latest ? t("aiObservability.queues.create.versionLatest", { version: v }) : `v${v}`,
    value: v,
  }));
}

// ── Score Config bindings ──
function addConfig(opt: LlmScoreConfigOption) {
  setScoreConfigs([
    ...formValues.value.scoreConfigs,
    { scoreConfigId: opt.id, name: opt.name, dataType: opt.dataType, version: opt.latestVersion },
  ]);
}

function removeConfig(index: number) {
  const removed = formValues.value.scoreConfigs[index];
  setScoreConfigs(formValues.value.scoreConfigs.filter((_, i) => i !== index));
  // Drop any auto-routing conditions that referenced the now-unbound config.
  if (removed) {
    setAutoRouting({
      ...formValues.value.autoRouting,
      conditions: formValues.value.autoRouting.conditions.filter(
        (c) => c.scoreConfigId !== removed.scoreConfigId,
      ),
    });
  }
}

function setConfigVersion(index: number, version: number) {
  setScoreConfigs(
    formValues.value.scoreConfigs.map((c, i) => (i === index ? { ...c, version } : c)),
  );
}

// ── Auto-routing conditions ──
function updateCondition(index: number, patch: Partial<QueueCondition>) {
  setAutoRouting({
    ...formValues.value.autoRouting,
    conditions: formValues.value.autoRouting.conditions.map((c, i) =>
      i === index ? { ...c, ...patch } : c,
    ),
  });
}

function addCondition() {
  const bound = formValues.value.scoreConfigs[0];
  const d = defaultsForType(bound ? configForId(bound.scoreConfigId) : undefined);
  setAutoRouting({
    ...formValues.value.autoRouting,
    conditions: [
      ...formValues.value.autoRouting.conditions,
      { scoreConfigId: bound?.scoreConfigId ?? "", operator: d.operator, value: d.value },
    ],
  });
}

// Re-picking the Score Config resets operator + value to that type's defaults.
function onConditionConfigChange(index: number, newId: string) {
  const d = defaultsForType(configForId(newId));
  updateCondition(index, { scoreConfigId: newId, operator: d.operator, value: d.value });
}

function removeCondition(index: number) {
  setAutoRouting({
    ...formValues.value.autoRouting,
    conditions: formValues.value.autoRouting.conditions.filter((_, i) => i !== index),
  });
}

async function openCreate() {
  form.reset();
  createOpen.value = true;
  if (!orgId.value) return;
  const [configs, datasets] = await Promise.all([
    llmQueuesService.listScoreConfigOptions(orgId.value),
    llmDatasetsService.list(orgId.value),
  ]);
  configOptions.value = configs;
  // No explicit "None" row — an empty select IS review-only. The placeholder
  // communicates that, and `clearable` lets the user return to it.
  datasetOptions.value = datasets.map((d) => ({ label: d.name, value: d.id }));
}

// Runs only after the Zod schema passes (name required; ≥1 Score Config).
async function save(values: QueueForm) {
  if (!orgId.value) return;
  const targetName = datasetOptions.value.find((o) => o.value === values.targetDatasetId)?.label;
  // Drop half-filled condition rows (no score dimension picked).
  const routingConditions = values.autoRouting.conditions.filter((c) => c.scoreConfigId);
  try {
    await llmQueuesService.create(orgId.value, {
      name: values.name.trim(),
      description: values.description.trim() || null,
      targetDatasetId: values.targetDatasetId || null,
      targetDatasetName: values.targetDatasetId ? (targetName ?? null) : null,
      scoreConfigs: values.scoreConfigs.map((c) => ({
        scoreConfigId: c.scoreConfigId,
        version: c.version,
      })),
      autoRouting: routingConditions.length
        ? {
            matchMode: values.autoRouting.matchMode,
            conditions: routingConditions.map((c) => ({
              scoreConfigId: c.scoreConfigId,
              operator: c.operator as AutoRouteOperator,
              value: c.value,
            })),
          }
        : null,
    });
    toast({ variant: "success", message: t("aiObservability.queues.create.success") });
    createOpen.value = false;
    await refresh();
  } catch {
    toast({ variant: "error", message: t("aiObservability.queues.create.error") });
  }
}

onMounted(refresh);
</script>
