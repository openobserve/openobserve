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

<!-- Same list → pick two → diff flow as the prompt drawer's Versions tab. -->
<template>
  <div v-if="comparing && compared.length === 2" data-test="scorer-version-compare">
    <OPageHeader
      :title="t('aiObservability.promptManagement.form.compareVersions')"
      :back="{
        label: t('onlineEvals.scorer.detail.tabs.versions'),
        onClick: () => (comparing = false),
        dataTest: 'scorer-version-compare-back',
      }"
    >
      <template #actions>
        <OSelect
          :model-value="compared[0].version"
          :options="versionOptions.filter((option) => option.value !== compared[1].version)"
          size="sm"
          width="xs"
          :aria-label="t('aiObservability.promptManagement.form.baseVersion')"
          data-test="scorer-version-compare-base"
          @update:model-value="(value) => setCompared(0, Number(value))"
        />
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="swap-horiz"
          data-test="scorer-version-compare-swap"
          @click="swapCompared"
        >
          <OTooltip :content="t('aiObservability.promptManagement.form.swapVersions')" />
        </OButton>
        <OSelect
          :model-value="compared[1].version"
          :options="versionOptions.filter((option) => option.value !== compared[0].version)"
          size="sm"
          width="xs"
          :aria-label="t('aiObservability.promptManagement.form.targetVersion')"
          data-test="scorer-version-compare-target"
          @update:model-value="(value) => setCompared(1, Number(value))"
        />
        <OToggleGroup
          :model-value="diffMode"
          type="single"
          data-test="scorer-version-compare-mode"
          @update:model-value="(value) => value && (diffMode = value as typeof diffMode)"
        >
          <OToggleGroupItem value="split" size="sm">{{
            t("aiObservability.promptManagement.form.split")
          }}</OToggleGroupItem>
          <OToggleGroupItem value="unified" size="sm">{{
            t("aiObservability.promptManagement.form.unified")
          }}</OToggleGroupItem>
        </OToggleGroup>
      </template>
    </OPageHeader>

    <OContent class="flex flex-col gap-4 pt-1">
      <section class="flex flex-col gap-2">
        <h4 :class="headingClass">
          {{ t("onlineEvals.scorer.detail.versions.template") }}
          <span class="ms-auto inline-flex gap-2 text-xs font-normal tabular-nums">
            <span class="text-status-success-text">{{ raw(`+${stats.added}`) }}</span>
            <span class="text-status-error-text">{{ raw(`−${stats.removed}`) }}</span>
          </span>
        </h4>
        <DiffViewer
          :original="compared[0].template ?? ''"
          :modified="compared[1].template ?? ''"
          :mode="diffMode"
          class="max-h-64!"
          data-test="scorer-version-diff-template"
          @stats="stats = $event"
        />
      </section>

      <section class="flex flex-col gap-2">
        <h4 :class="headingClass">
          {{ t("onlineEvals.scorer.detail.tabs.configuration") }}
          <span v-if="changedFields" class="text-text-secondary ms-auto text-xs font-normal">{{
            t("aiObservability.promptManagement.form.fieldsChanged", {
              changed: changedFields,
              total: configRows.length,
            })
          }}</span>
        </h4>
        <div
          class="rounded-default border-border-default text-compact grid grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)] overflow-hidden border"
          data-test="scorer-version-config-diff"
        >
          <span :class="headerCellClass">{{
            t("aiObservability.promptManagement.form.field")
          }}</span>
          <span :class="headerCellClass">{{ versionLabel(compared[0].version) }}</span>
          <span :class="headerCellClass">{{ versionLabel(compared[1].version) }}</span>
          <template v-for="row in configRows" :key="row.key">
            <span
              class="border-border-default border-t px-3 py-2"
              :class="row.changed ? 'text-text-heading font-medium' : 'text-text-secondary'"
              >{{ row.label }}</span
            >
            <span
              class="border-border-default border-t px-3 py-2 font-mono text-xs break-all"
              :class="row.changed ? 'bg-status-error-bg text-status-error-text' : ''"
              ><span class="block max-h-[5lh] overflow-y-auto">{{ row.left }}</span></span
            >
            <span
              class="border-border-default border-t px-3 py-2 font-mono text-xs break-all"
              :class="row.changed ? 'bg-status-success-bg text-status-success-text' : ''"
              ><span class="block max-h-[5lh] overflow-y-auto">{{ row.right }}</span></span
            >
          </template>
        </div>
      </section>
    </OContent>
  </div>

  <OTable
    v-else
    :data="versions"
    :columns="columns"
    row-key="id"
    pagination="none"
    :fill-height="false"
    :default-columns="false"
    :show-global-filter="false"
    :show-footer="false"
    :loading="loading"
    :empty-message="t('onlineEvals.scorer.detail.versions.empty')"
    :frame="false"
    selection="multiple"
    :show-select-all="false"
    :selected-ids="compareIds"
    :is-row-selectable="canCompare"
    data-test="scorer-version-table"
    @update:selected-ids="(ids: string[]) => (compareIds = ids)"
  >
    <template #toolbar>
      <div class="flex min-w-0 flex-1 items-center justify-end gap-2">
        <span class="text-text-secondary text-xs whitespace-nowrap">{{
          t("aiObservability.promptManagement.form.selectionCount", { count: compareIds.length })
        }}</span>
        <OTooltip :content="compareReason" :disabled="compareIds.length === 2">
          <OButton
            variant="outline"
            size="sm"
            :disabled="compareIds.length !== 2"
            data-test="scorer-version-compare-btn"
            @click="openCompare"
          >
            {{ t("aiObservability.promptManagement.compare") }}
          </OButton>
        </OTooltip>
      </div>
    </template>
    <template #cell-version="{ row }">
      <span class="inline-flex items-center gap-1.5 tabular-nums">
        {{ versionLabel(row.version) }}
        <OTag v-if="row.version === activeVersion" type="activeVersionFlag" value="active" />
      </span>
    </template>
    <template #cell-description="{ row }">
      <span class="text-text-secondary truncate">{{ row.description || raw("—") }}</span>
    </template>
    <template #cell-createdAt="{ row }">
      <OTimeCell :value="createdAtOf(row)" unit="ms" mode="relative" />
    </template>
  </OTable>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import DiffViewer, { type DiffStats } from "@/components/AIObservability/DiffViewer.vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import type { Scorer } from "@/services/online-evals.service";

const props = defineProps<{
  /** Full history, newest first. */
  versions: Scorer[];
  loading: boolean;
  /** The version jobs run today; tagged in the list. */
  activeVersion: number;
}>();

const { t } = useI18nTyped();

const versions = toRef(props, "versions");
const compareIds = ref<string[]>([]);
const comparing = ref(false);
const compareBaseId = ref("");
const compareHeadId = ref("");
const diffMode = ref<"split" | "unified">("split");
const stats = ref<DiffStats>({ added: 0, removed: 0 });

const headingClass =
  "text-compact text-text-heading border-b-text-secondary/12 m-0 flex items-center gap-1.5 border-b pb-1.5 leading-normal font-semibold";
const headerCellClass = "bg-surface-subtle text-text-secondary px-3 py-2 text-xs font-semibold";

const versionLabel = (version: number) =>
  t("aiObservability.promptManagement.versionNumber", { version });
const createdAtOf = (row: Scorer) => row.createdAt ?? row.created_at ?? null;

watch(versions, () => {
  compareIds.value = [];
  comparing.value = false;
});

const versionOptions = computed(() =>
  versions.value.map((version) => ({ label: raw(`v${version.version}`), value: version.version })),
);
const compared = computed(() =>
  [compareBaseId.value, compareHeadId.value]
    .map((id) => versions.value.find((version) => version.id === id))
    .filter((version): version is Scorer => Boolean(version)),
);
const compareReason = computed(() =>
  versions.value.length < 2
    ? t("aiObservability.promptManagement.compareNeedsVersions")
    : t("aiObservability.promptManagement.selectTwoVersions"),
);

// Older version starts as the base so the diff reads as a change forward in time.
function openCompare() {
  const [base, head] = versions.value
    .filter((version) => compareIds.value.includes(version.id))
    .sort((left, right) => left.version - right.version);
  if (!base || !head) return;
  compareBaseId.value = base.id;
  compareHeadId.value = head.id;
  comparing.value = true;
}
function setCompared(side: 0 | 1, versionNumber: number) {
  const picked = versions.value.find((version) => version.version === versionNumber);
  const other = side === 0 ? compareHeadId.value : compareBaseId.value;
  if (!picked || picked.id === other) return;
  if (side === 0) compareBaseId.value = picked.id;
  else compareHeadId.value = picked.id;
  compareIds.value = [compareBaseId.value, compareHeadId.value];
}
function swapCompared() {
  [compareBaseId.value, compareHeadId.value] = [compareHeadId.value, compareBaseId.value];
}
function canCompare(row: Scorer) {
  return compareIds.value.includes(row.id) || compareIds.value.length < 2;
}

const compact = (value: unknown) =>
  value === null || value === undefined || value === ""
    ? "—"
    : typeof value === "string"
      ? value
      : JSON.stringify(value);

const CONFIG_FIELDS: { key: string; label: I18nKey; read: (scorer: Scorer) => unknown }[] = [
  {
    key: "description",
    label: "onlineEvals.scorer.detail.versions.fields.description",
    read: (s) => s.description,
  },
  {
    key: "variables",
    label: "onlineEvals.scorer.detail.versions.fields.variables",
    read: (s) => s.variables,
  },
  {
    key: "params",
    label: "onlineEvals.scorer.detail.versions.fields.params",
    read: (s) => s.params,
  },
  {
    key: "producesScoreConfig",
    label: "onlineEvals.scorer.detail.versions.fields.producesScoreConfig",
    read: (s) => s.producesScoreConfigId ?? s.produces_score_config_id,
  },
  {
    key: "referenceBased",
    label: "onlineEvals.scorer.detail.versions.fields.referenceBased",
    read: (s) => s.referenceBased ?? s.reference_based,
  },
  {
    key: "outputSchema",
    label: "onlineEvals.scorer.detail.versions.fields.outputSchema",
    read: (s) => s.outputSchema ?? s.output_schema,
  },
];
const configRows = computed(() => {
  const [left, right] = compared.value;
  if (!left || !right) return [];
  return CONFIG_FIELDS.map((field) => {
    const leftText = compact(field.read(left));
    const rightText = compact(field.read(right));
    return {
      key: field.key,
      label: t(field.label),
      left: leftText,
      right: rightText,
      changed: leftText !== rightText,
    };
  });
});
const changedFields = computed(() => configRows.value.filter((row) => row.changed).length);

const columns: OTableColumnDef<Scorer>[] = [
  {
    id: "version",
    accessorKey: "version",
    header: t("aiObservability.promptManagement.version"),
    size: 140,
  },
  {
    id: "description",
    accessorKey: "description",
    header: t("onlineEvals.scorer.detail.versions.fields.description"),
    size: 220,
    meta: { flex: true },
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: t("aiObservability.promptManagement.form.created"),
    size: 140,
  },
];
</script>
