<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed } from "vue";

import OBadge from "@/lib/core/Badge/OBadge.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type {
  CompositeAlertChild,
  CompositeAlertDetail,
  CompositeAlertReadableChild,
} from "@/ts/interfaces/alert";
import { raw, useI18nTyped } from "@/types/i18n";
import { nameResolvedExpression } from "./expression";

const props = defineProps<{
  alert: CompositeAlertDetail | Record<string, unknown>;
}>();

const { t } = useI18nTyped();
const value = computed(() => props.alert as unknown as CompositeAlertDetail);
const rows = computed(() => value.value.children ?? []);
const expression = computed(() =>
  nameResolvedExpression(value.value.composite_condition.expression, rows.value),
);
const showMissingJob = computed(
  () => value.value.enabled && !value.value.scheduler_job_present,
);
const columns = computed<OTableColumnDef<CompositeAlertChild>[]>(() => [
  { id: "child", header: t("alerts.composite.child"), accessorKey: "alert_id" },
  { id: "state", header: t("alerts.composite.state"), accessorKey: "level" },
  { id: "level_at", header: t("alerts.composite.lastComputed"), accessorKey: "level_at" },
  { id: "freshness", header: t("alerts.composite.freshness"), accessorKey: "stale" },
]);

const readable = (child: CompositeAlertChild): child is CompositeAlertReadableChild =>
  child.accessible;
const formatMicros = (timestamp?: number | null): ReturnType<typeof raw> =>
  timestamp ? raw(new Date(timestamp / 1000).toLocaleString()) : raw("—");
const childState = (child: CompositeAlertReadableChild) => {
  if (!child.enabled) {
    return t("alerts.composite.disabledNeverEvaluated", {
      state: child.level ?? t("alerts.composite.neverEvaluated"),
    });
  }
  if (child.stale && child.policy_decision === "used_last_state") {
    return t("alerts.composite.staleUsingLast", {
      level: child.level ?? t("alerts.composite.unknownResult"),
    });
  }
  return t("alerts.composite.levelOutcomeEnabled", {
    level: child.level ?? t("alerts.composite.neverEvaluated"),
    outcome: child.last_outcome ?? t("alerts.composite.unknownResult"),
  });
};
const detailResult = computed(() =>
  value.value.evaluation?.level
    ? raw(value.value.evaluation.level)
    : value.value.evaluation?.result === true
      ? t("alerts.composite.trueResult")
      : value.value.evaluation?.result === false
        ? t("alerts.composite.falseResult")
        : t("alerts.composite.unknownResult"),
);
</script>

<template>
  <section class="flex flex-col gap-4" data-test="alerts-composite-detail">
    <OBanner
      v-if="showMissingJob"
      variant="warning"
      data-test="alerts-composite-detail-missing-job"
      :content="t('alerts.composite.missingJobWarning')"
    />

    <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
      <div class="border-border-default bg-surface-subtle rounded-surface border p-4">
        <div class="text-text-secondary text-xs">{{ t("alerts.composite.currentResult") }}</div>
        <OBadge
          class="mt-2"
          :variant="value.evaluation?.result ? 'error-soft' : 'default-soft'"
          data-test="alerts-composite-detail-result"
        >
          {{ detailResult }}
        </OBadge>
      </div>
      <div class="border-border-default bg-surface-subtle rounded-surface border p-4">
        <div class="text-text-secondary text-xs">{{ t("alerts.composite.warningPolicy") }}</div>
        <div class="mt-2 text-sm font-medium">
          {{
            value.composite_condition.warning_counts_as_firing
              ? t("alerts.composite.warningCountsAsFiring")
              : t("alerts.composite.warningDoesNotCount")
          }}
        </div>
      </div>
      <div class="border-border-default bg-surface-subtle rounded-surface border p-4">
        <div class="text-text-secondary text-xs">{{ t("alerts.composite.stalePolicy") }}</div>
        <div class="mt-2 text-sm font-medium" data-test="alerts-composite-detail-stale-policy">
          {{
            value.composite_condition.stale_child_policy === "use_last_state"
              ? t("alerts.composite.useLastState")
              : raw(value.composite_condition.stale_child_policy)
          }}
        </div>
      </div>
    </div>

    <div class="border-border-default bg-surface-subtle rounded-surface border p-4">
      <div class="text-text-secondary text-xs">{{ t("alerts.composite.expression") }}</div>
      <div
        class="mt-2 break-words text-sm font-medium"
        data-test="alerts-composite-detail-expression"
      >
        {{ raw(expression) }}
      </div>
    </div>

    <OTable
      :data="rows"
      :columns="columns"
      row-key="alert_id"
      pagination="none"
      :show-global-filter="false"
      :fill-height="false"
      data-test="alerts-composite-detail-children-table"
    >
      <template #cell-child="{ row }">
        <div :data-test="`alerts-composite-detail-child-${row.alert_id}`" class="min-w-0">
          <template v-if="readable(row)">
            <a
              class="text-link-primary block max-w-80 truncate font-medium"
              :href="`/web/alerts/detail/${row.alert_id}?folder=${encodeURIComponent(row.folder_id)}`"
              :title="row.name"
              :aria-label="t('alerts.composite.openChild', { name: row.name })"
              :data-test="`alerts-composite-detail-child-link-${row.alert_id}`"
            >
              {{ raw(row.name) }}
            </a>
            <span class="text-text-secondary text-xs">{{ childState(row) }}</span>
            <span
              class="text-text-secondary block text-xs"
              data-test="alerts-composite-detail-level-at"
            >
              {{ formatMicros(row.level_at) }}
            </span>
            <span
              class="text-text-secondary block text-xs"
              data-test="alerts-composite-detail-freshness"
            >
              {{ row.stale ? t("alerts.composite.freshnessExpired") : t("alerts.composite.fresh") }}
            </span>
          </template>
          <span v-else class="font-mono text-xs">{{ raw(row.alert_id) }}</span>
        </div>
      </template>
      <template #cell-state="{ row }">
        <span v-if="readable(row)">{{ childState(row) }}</span>
      </template>
      <template #cell-level_at="{ row }">
        <span v-if="readable(row)" data-test="alerts-composite-detail-level-at">
          {{ formatMicros(row.level_at) }}
        </span>
      </template>
      <template #cell-freshness="{ row }">
        <span v-if="readable(row)" data-test="alerts-composite-detail-freshness">
          {{ row.stale ? t("alerts.composite.freshnessExpired") : t("alerts.composite.fresh") }}
        </span>
      </template>
    </OTable>
  </section>
</template>
