<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed } from "vue";

import OBadge from "@/lib/core/Badge/OBadge.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type {
  CompositeAlertChild,
  CompositeAlertReadableChild,
  CompositeAlertValidationResponse,
} from "@/ts/interfaces/alert";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{
  preview: CompositeAlertValidationResponse | Record<string, unknown>;
}>();

const { t } = useI18nTyped();
const value = computed(
  () => props.preview as unknown as CompositeAlertValidationResponse,
);
const rows = computed(() => value.value.children ?? []);
// Direct operand negation (`!{id}`) inverts that child's truth in the final
// boolean. Negated GROUPS are not attributed to their members here — the
// inversion belongs to the group, not to any one child.
const negatedIds = computed(() => {
  const ids = new Set<string>();
  const expression = value.value.canonical_expression ?? "";
  for (const match of expression.matchAll(/!\{([^{}]+)\}/g)) {
    if (match[1]) ids.add(match[1]);
  }
  return ids;
});
const columns = computed<OTableColumnDef<CompositeAlertChild>[]>(() => [
  { id: "child", header: t("alerts.composite.child"), accessorKey: "alert_id" },
  { id: "level", header: t("alerts.composite.level"), accessorKey: "level" },
  { id: "truth", header: t("alerts.composite.mappedTruth"), accessorKey: "truth" },
  { id: "freshness", header: t("alerts.composite.freshness"), accessorKey: "stale" },
  { id: "lastComputed", header: t("alerts.composite.lastComputed"), accessorKey: "level_at" },
  { id: "negation", header: t("alerts.composite.negation"), accessorKey: "alert_id" },
]);

const readable = (child: CompositeAlertChild): child is CompositeAlertReadableChild =>
  child.accessible;

const resultLabel = computed(() => {
  if (!value.value.valid) return t("alerts.composite.invalid");
  if (value.value.result_level) return raw(value.value.result_level);
  if (value.value.result === true) return t("alerts.composite.trueResult");
  if (value.value.result === false) return t("alerts.composite.falseResult");
  return t("alerts.composite.unknownResult");
});

const warningText = (code: string) => {
  const known: Record<string, ReturnType<typeof t>> = {
    child_disabled: t("alerts.composite.warningChildDisabled"),
    child_never_evaluated: t("alerts.composite.warningChildNeverEvaluated"),
    child_stale: t("alerts.composite.warningChildStale"),
  };
  return known[code] ?? raw(code);
};

const childDiagnostic = (child: CompositeAlertReadableChild) => {
  if (!child.enabled) return t("alerts.composite.disabledChild");
  if (child.level == null || child.level_at == null) {
    return t("alerts.composite.neverEvaluatedChild");
  }
  if (child.stale && child.policy_decision === "used_last_state") {
    return t("alerts.composite.staleUsingLast", { level: child.level });
  }
  return t("alerts.composite.levelTruth", {
    level: child.level,
    truth: child.truth ? t("alerts.composite.trueResult") : t("alerts.composite.falseResult"),
  });
};

const formatMicros = (value?: number | null): ReturnType<typeof raw> =>
  value ? raw(new Date(value / 1000).toLocaleString()) : raw("—");
</script>

<template>
  <section class="flex min-h-0 flex-col gap-3" data-test="alerts-composite-preview">
    <div
      class="border-border-default bg-surface-subtle rounded-surface flex items-center justify-between gap-3 border p-4"
      data-test="alerts-composite-preview-result"
      aria-live="polite"
    >
      <span class="text-text-secondary text-sm">{{ t("alerts.composite.previewResult") }}</span>
      <OBadge
        :variant="preview.valid && preview.result ? 'error-soft' : 'default-soft'"
        size="sm"
      >
        {{ resultLabel }}
      </OBadge>
    </div>

    <OBanner
      v-for="warning in value.warnings"
      :key="`${warning.code}-${warning.child_alert_id ?? ''}`"
      variant="warning"
      dense
      :data-test="`alerts-composite-preview-warning-${warning.code}`"
      :content="warningText(warning.code)"
    />
    <OBanner
      v-for="error in value.errors"
      :key="`${error.code}-${error.child_alert_id ?? ''}`"
      variant="error-soft"
      dense
      :data-test="`alerts-composite-preview-error-${error.code}`"
      :content="error.message ? raw(error.message) : raw(error.code)"
    />

    <OTable
      :data="rows"
      :columns="columns"
      row-key="alert_id"
      pagination="none"
      :show-global-filter="false"
      :frame="true"
      :fill-height="false"
      data-test="alerts-composite-preview-table"
    >
      <template #cell-child="{ row }">
        <div :data-test="`alerts-composite-preview-child-${row.alert_id}`" class="min-w-0">
          <template v-if="readable(row)">
            <div class="truncate font-medium" :title="row.name">{{ raw(row.name) }}</div>
            <div class="text-text-secondary text-xs">
              {{ childDiagnostic(row) }}
            </div>
            <span
              v-if="row.stale_deadline"
              class="text-text-secondary text-xs"
              data-test="alerts-composite-preview-stale-deadline"
            >
              {{ formatMicros(row.stale_deadline) }}
            </span>
          </template>
          <span v-else class="font-mono text-xs">{{ raw(row.alert_id) }}</span>
        </div>
      </template>
      <template #cell-level="{ row }">
        <span v-if="readable(row)">{{ raw(row.level ?? "—") }}</span>
      </template>
      <template #cell-truth="{ row }">
        <span v-if="readable(row)">
          {{ row.truth ? t("alerts.composite.trueResult") : t("alerts.composite.falseResult") }}
        </span>
      </template>
      <template #cell-freshness="{ row }">
        <template v-if="readable(row)">
          <span v-if="row.stale">{{ t("alerts.composite.freshnessExpired") }}</span>
          <span v-else>{{ t("alerts.composite.fresh") }}</span>
        </template>
      </template>
      <template #cell-lastComputed="{ row }">
        <span
          v-if="readable(row)"
          data-test="alerts-composite-preview-level-at"
        >
          {{ formatMicros(row.level_at) }}
        </span>
      </template>
      <template #cell-negation="{ row }">
        <span v-if="readable(row)">
          {{ negatedIds.has(row.alert_id) ? t("alerts.composite.negated") : raw("—") }}
        </span>
      </template>
    </OTable>
  </section>
</template>
