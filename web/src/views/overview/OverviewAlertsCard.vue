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
  <OverviewSectionCard
    section="alerts"
    :title="
      hasIncidents ? t('overview.sections.alertsAndIncidents') : t('overview.sections.alerts')
    "
    :subtitle="subtitle"
    :link-label="view === 'empty' ? t('overview.alerts.emptyAction') : t('overview.alerts.viewAll')"
    :view="view"
    :locked-message="lockedReason"
    :can-unlock="false"
    @retry="emit('retry')"
    @view-all="view === 'empty' ? emit('create') : emit('open')"
  >
    <template #empty>
      <OEmptyState
        size="slim"
        :title="t('overview.alerts.emptyTitle')"
        :description="t('overview.alerts.emptyDesc')"
        data-test="overview-alerts-empty"
      />
    </template>
    <div class="flex flex-1 flex-col">
      <ul
        :class="[
          'grid gap-2 px-3 pb-2 max-md:grid-cols-2',
          boxes.length === 4 ? 'grid-cols-4' : 'grid-cols-3',
        ]"
        data-test="overview-alerts-boxes"
      >
        <li
          v-for="box in boxes"
          :key="box.key"
          :class="[
            'rounded-default relative flex border transition-colors motion-reduce:transition-none',
            box.count > 0 && box.tint
              ? box.tint
              : 'border-border-default hover:border-border-strong',
          ]"
          :data-test="`overview-alerts-frame-${box.key}`"
        >
          <OButton
            variant="cell"
            class="flex-1"
            :data-test="`overview-alerts-box-${box.key}`"
            @click="emit('select', box.target)"
          >
            <span class="flex flex-col gap-0 px-3 py-1.5 text-start">
              <span
                :class="[
                  'text-xl font-bold tabular-nums',
                  box.count > 0 ? box.tone : 'text-text-heading',
                ]"
                data-test="overview-alerts-box-count"
                >{{ box.count }}</span
              >
              <span :class="['text-text-label text-xs', askVisible && box.count > 0 && 'pe-6']">{{
                box.label
              }}</span>
            </span>
          </OButton>
          <OverviewAskAiButton
            kind="box"
            :item-key="box.key"
            :label="box.label"
            :show="box.count > 0"
            class="absolute end-1 top-1"
            @ask="
              emit('askAi', {
                kind: 'count',
                topic: box.target,
                count: box.count,
                ...(box.level && { level: box.level }),
              })
            "
          />
        </li>
      </ul>
      <div
        v-if="rows.length === 0"
        class="border-border-default flex flex-1 flex-col items-center justify-center gap-0.5 border-t px-3 py-2 text-center"
        data-test="overview-alerts-none-firing"
      >
        <OIcon name="check-circle" size="md" class="text-status-success-text" />
        <p class="text-text-heading text-sm font-medium">
          {{ t("overview.alerts.noneFiring") }}
        </p>
        <p class="text-text-secondary text-xs" data-test="overview-alerts-evaluated">
          {{ t("overview.alerts.rulesEvaluated", { count: enabledRules }, enabledRules) }}
        </p>
      </div>
      <div v-else data-test="overview-alerts-firing">
        <div
          class="border-border-default text-text-label flex items-center justify-between gap-3 border-t px-3 py-1.5 text-xs"
          data-test="overview-alerts-table-header"
        >
          <span>{{ t("overview.alerts.firingNow") }}</span>
          <span>{{ t("overview.alerts.firingFor") }}</span>
        </div>
        <ul class="flex flex-col">
          <li
            v-for="(row, index) in rows"
            :key="`${row.stream}-${row.name}-${row.since}-${index}`"
            class="border-border-default flex items-center border-t"
          >
            <OverviewRowButton
              compact
              class="min-w-0 flex-1"
              :data-test="`overview-alerts-firing-${row.name}`"
              @click="emit('select', 'firing')"
            >
              <span class="flex min-w-0 items-center gap-3">
                <OTag
                  type="countChip"
                  :value="rowTone(row.level)"
                  class="min-w-16 shrink-0 justify-center"
                  :data-test="`overview-alerts-firing-level-${row.name}`"
                  >{{ rowLevelLabel(row.level) }}</OTag
                >
                <span class="flex min-w-0 flex-col text-start">
                  <OTruncatedText class="text-text-body text-sm font-medium">{{
                    raw(row.name)
                  }}</OTruncatedText>
                  <OTruncatedText class="text-text-secondary text-xs">{{
                    raw(row.stream)
                  }}</OTruncatedText>
                </span>
              </span>
              <span class="text-text-secondary shrink-0 text-xs tabular-nums">{{ row.age }}</span>
            </OverviewRowButton>
            <span v-if="askVisible" class="flex w-9 shrink-0 justify-center">
              <OverviewAskAiButton
                kind="alert"
                :item-key="row.name"
                :label="row.name"
                @ask="emit('askAi', { kind: 'alert', alert: row.alert })"
              />
            </span>
          </li>
        </ul>
      </div>
      <OButton
        v-if="remaining > 0"
        variant="ghost-primary"
        size="sm"
        class="ms-0.5 mb-2 self-start"
        data-test="overview-alerts-show-more"
        @click="emit('select', 'firing')"
      >
        {{ t("overview.alerts.showMore", { count: remaining }, remaining) }}
      </OButton>
    </div>
  </OverviewSectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type {
  OverviewAlertLevel,
  OverviewAlertsData,
  OverviewSection,
} from "@/ts/interfaces/overview";
import type { IncidentsTile, OverviewTarget } from "./OverviewHeadlineStrip.vue";
import OverviewAskAiButton from "./OverviewAskAiButton.vue";
import OverviewRowButton from "./OverviewRowButton.vue";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import {
  FIRING_ROWS_LIMIT,
  firingRows,
  firingTotal,
  hasKnownSince,
  levelCount,
  microsToMs,
  sectionView,
} from "./overviewFormat";
import type { OverviewAskAiTarget } from "./overviewAskAi";
import { useOverviewAskAi } from "./useOverviewAskAi";
import { useOverviewTime } from "./useOverviewTime";

export type AlertsBoxTarget =
  Extract<OverviewTarget, "firing" | "failing" | "incidents"> | "critical" | "warning";

interface CountBox {
  key: string;
  label: I18nText;
  count: number;
  tone: string;
  // a box above zero takes a soft status surface so the problem reads before its number
  tint?: string;
  target: AlertsBoxTarget;
  level?: "critical" | "warning";
}

const TINT = {
  danger: "bg-status-error-bg border-status-negative",
  warning: "bg-status-warning-bg border-status-warning-text",
} as const;

const props = defineProps<{
  section?: OverviewSection<OverviewAlertsData>;
  pending: boolean;
  failed: boolean;
  forbidden?: boolean;
  incidentsState?: IncidentsTile;
  incidentsTotal?: number;
  lockedReason?: I18nText;
}>();

const emit = defineEmits<{
  retry: [];
  open: [];
  create: [];
  select: [target: AlertsBoxTarget];
  askAi: [target: OverviewAskAiTarget];
}>();

const { t } = useI18nTyped();
const { formatElapsed } = useOverviewTime();
const { visible: askVisible } = useOverviewAskAi();

// OSS and a deployment with incidents off have no incidents to summarise, so the title says alerts only
const hasIncidents = computed(
  () =>
    props.incidentsState !== undefined &&
    props.incidentsState !== "locked" &&
    props.incidentsState !== "unavailable",
);

const view = computed(() => {
  if (props.lockedReason) return "locked";
  const base = sectionView(props.section, props);
  return base === "ok" && props.section?.data?.total === 0 ? "empty" : base;
});

const subtitle = computed<I18nText | undefined>(() => {
  const data = props.section?.data;
  if (view.value !== "ok" || !data) return undefined;
  return t("overview.alerts.subtitle", {
    active: t("overview.alerts.rulesActive", { count: data.enabled }, data.enabled),
    failing: t(
      "overview.alerts.rulesFailingToEvaluate",
      { count: data.failed_evaluation },
      data.failed_evaluation,
    ),
  });
});

// the age is read at render time so each new overview snapshot restarts it from the current clock
const rows = computed(() =>
  firingRows(props.section?.data)
    .slice(0, FIRING_ROWS_LIMIT)
    .map((row) => ({
      ...row,
      alert: row,
      age: hasKnownSince(row.since) ? formatElapsed(Date.now() - microsToMs(row.since)) : "",
    })),
);
const enabledRules = computed(() => props.section?.data?.enabled ?? 0);
const remaining = computed(() => Math.max(0, firingTotal(props.section?.data) - rows.value.length));

// a rule in the firing list is firing whatever its configured level, so only critical and warning are named
const rowTone = (level: OverviewAlertLevel) => {
  if (level === "critical") return "error";
  return level === "warning" ? "warning" : "neutral";
};
const rowLevelLabel = (level: OverviewAlertLevel): I18nText => {
  if (level === "critical") return t("overview.level.critical");
  return level === "warning" ? t("overview.level.warning") : t("overview.level.okFiring");
};

const boxes = computed<CountBox[]>(() => {
  const data = props.section?.data;
  const list: CountBox[] = [
    {
      key: "critical",
      label: t("overview.alerts.criticalLevel"),
      count: levelCount(data, "critical"),
      tone: "text-status-negative",
      tint: TINT.danger,
      target: "critical",
      level: "critical",
    },
    {
      key: "warning",
      label: t("overview.alerts.warningLevel"),
      count: levelCount(data, "warning"),
      tone: "text-status-warning-text",
      tint: TINT.warning,
      target: "warning",
      level: "warning",
    },
  ];
  if (props.incidentsState === "ok") {
    list.push({
      key: "incidents",
      label: t("overview.cards.openIncidents"),
      count: props.incidentsTotal ?? 0,
      tone: "text-text-heading",
      target: "incidents",
    });
  }
  list.push({
    key: "failing",
    label: t("overview.alerts.rulesFailing"),
    count: data?.failed_evaluation ?? 0,
    tone: "text-status-negative",
    tint: TINT.danger,
    target: "failing",
  });
  return list;
});
</script>
