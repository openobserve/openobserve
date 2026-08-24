<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed } from "vue";

import CompositeExpressionPills from "./CompositeExpressionPills.vue";
import CompositeStatusTimeline from "./CompositeStatusTimeline.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type {
  CompositeAlertChild,
  CompositeAlertDetail,
  CompositeAlertReadableChild,
} from "@/ts/interfaces/alert";
import { raw, useI18nTyped } from "@/types/i18n";
import { letterFor, nameResolvedExpression } from "./expression";

const props = defineProps<{
  alert: CompositeAlertDetail | Record<string, unknown>;
}>();

const { t } = useI18nTyped();
const value = computed(() => props.alert as unknown as CompositeAlertDetail);
const rows = computed(() => value.value.children ?? []);
const expression = computed(() =>
  nameResolvedExpression(value.value.composite_condition.expression, rows.value),
);
const showMissingJob = computed(() => value.value.enabled && !value.value.scheduler_job_present);

const readable = (child: CompositeAlertChild): child is CompositeAlertReadableChild =>
  child.accessible;

const detailResult = computed(() =>
  value.value.evaluation?.result === true
    ? t("alerts.composite.trueResult")
    : value.value.evaluation?.result === false
      ? t("alerts.composite.falseResult")
      : t("alerts.composite.unknownResult"),
);

const formatMicros = (timestamp?: number | null): ReturnType<typeof raw> =>
  timestamp ? raw(new Date(timestamp / 1000).toLocaleString()) : raw("—");

const childLink = (child: CompositeAlertReadableChild): string =>
  `/web/alerts/detail/${child.alert_id}?folder=${encodeURIComponent(child.folder_id)}`;

const childReason = (
  child: CompositeAlertReadableChild,
): ReturnType<typeof t> | ReturnType<typeof raw> | null => {
  if (child.stale_reason === "freshness_expired") return t("alerts.composite.freshnessExpired");
  if (child.last_outcome === "error") return t("alerts.composite.evaluationError");
  return null;
};
</script>

<template>
  <section class="flex flex-col gap-4" data-test="alerts-composite-detail">
    <OBanner
      v-if="showMissingJob"
      variant="warning"
      data-test="alerts-composite-detail-missing-job"
      :content="t('alerts.composite.missingJobWarning')"
    />

    <!-- Current evaluation -->
    <div class="border-border-default bg-surface-subtle rounded-surface border p-4">
      <div class="mb-3 flex items-center justify-between gap-3">
        <span class="text-text-secondary text-xs">{{
          t("alerts.composite.currentEvaluation")
        }}</span>
        <OTag
          v-if="value.evaluation?.level"
          type="alertLevel"
          :value="value.evaluation.level"
          size="sm"
          data-test="alerts-composite-detail-result"
        />
        <OTag
          v-else-if="value.evaluation"
          :variant="value.evaluation.result ? 'error-soft' : 'default-soft'"
          size="sm"
          :label="detailResult"
          data-test="alerts-composite-detail-result"
        />
      </div>

      <div
        class="border-border-default bg-surface-base rounded-default border p-3"
        data-test="alerts-composite-detail-expression-live"
      >
        <CompositeExpressionPills
          :expression="value.composite_condition.expression"
          :children="rows"
        />
      </div>

      <div class="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        <div
          v-for="(child, index) in rows"
          :key="child.alert_id"
          class="border-border-default bg-surface-base rounded-default border p-2.5"
          :data-test="`alerts-composite-detail-child-${child.alert_id}`"
        >
          <template v-if="readable(child)">
            <div class="flex items-center gap-2">
              <span
                class="bg-theme-accent-soft text-theme-accent rounded-default flex h-6 w-6 shrink-0 items-center justify-center text-xs font-bold"
              >
                {{ raw(letterFor(index)) }}
              </span>
              <a
                class="text-link-primary min-w-0 flex-1 truncate font-medium"
                :href="childLink(child)"
                :title="child.name"
                :data-test="`alerts-composite-detail-child-link-${child.alert_id}`"
              >
                {{ raw(child.name) }}
              </a>
              <OTag type="alertLevel" :value="child.level ?? 'nodata'" size="xs" />
              <OTag v-if="child.alert_type" type="alertType" :value="child.alert_type" size="xs" />
              <OTag
                v-if="child.last_outcome"
                type="alertState"
                :value="child.last_outcome"
                size="xs"
              />
              <OTag
                v-if="!child.enabled"
                variant="default-soft"
                size="xs"
                :label="t('alerts.composite.disabledChild')"
              />
            </div>
            <div class="text-text-secondary mt-1.5 flex items-center gap-2 text-xs">
              <span>{{ t("alerts.composite.lastComputed") }}</span>
              <span :data-test="`alerts-composite-detail-level-at-${child.alert_id}`">
                {{ formatMicros(child.level_at) }}
              </span>
              <span
                v-if="childReason(child)"
                class="text-status-warning-text"
                :data-test="`alerts-composite-detail-stale-reason-${child.alert_id}`"
              >
                {{ childReason(child) }}
              </span>
            </div>
          </template>
          <span v-else class="font-mono text-xs">{{ raw(child.alert_id) }}</span>
        </div>
      </div>
    </div>

    <!-- Status timeline -->
    <div class="border-border-default bg-surface-subtle rounded-surface border p-4">
      <div class="text-text-secondary mb-2 text-xs">{{ t("alerts.composite.statusTimeline") }}</div>
      <CompositeStatusTimeline :alert-id="value.id" />
    </div>

    <!-- Configuration -->
    <div
      class="border-border-default bg-surface-subtle rounded-surface border p-4"
      data-test="alerts-composite-detail-config"
    >
      <div class="text-text-secondary mb-2 text-xs">{{ t("alerts.composite.settings") }}</div>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt class="text-text-secondary whitespace-nowrap">
          {{ t("alerts.composite.expression") }}
        </dt>
        <dd
          class="text-text-heading min-w-0 font-mono text-xs break-words"
          data-test="alerts-composite-detail-expression"
        >
          {{ raw(expression) }}
        </dd>
        <dt class="text-text-secondary whitespace-nowrap">
          {{ t("alerts.composite.warningPolicy") }}
        </dt>
        <dd class="text-text-heading">
          {{
            value.composite_condition.warning_counts_as_firing
              ? t("alerts.composite.warningCountsAsFiring")
              : t("alerts.composite.warningDoesNotCount")
          }}
        </dd>
        <dt class="text-text-secondary whitespace-nowrap">
          {{ t("alerts.composite.stalePolicy") }}
        </dt>
        <dd class="text-text-heading" data-test="alerts-composite-detail-stale-policy">
          {{
            value.composite_condition.stale_child_policy === "use_last_state"
              ? t("alerts.composite.useLastState")
              : raw(value.composite_condition.stale_child_policy)
          }}
        </dd>
        <dt class="text-text-secondary whitespace-nowrap">
          {{ t("alerts.composite.levelWhenFiring") }}
        </dt>
        <dd class="text-text-heading">{{ t("alerts.composite.levelWhenFiringValue") }}</dd>
      </dl>
    </div>
  </section>
</template>
