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
    :link-label="view === 'empty' ? t('overview.alerts.emptyAction') : t('overview.viewAll')"
    :link-aria-label="view === 'empty' ? undefined : t('overview.alerts.viewAllAria')"
    :view="view"
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
    <div class="flex flex-col gap-3">
      <p class="flex items-baseline gap-2" data-test="overview-alerts-hero">
        <span
          :class="[
            'text-3xl font-semibold tabular-nums',
            levels.total > 0 ? 'text-text-heading' : 'text-text-secondary',
          ]"
          data-test="overview-alerts-hero-count"
          >{{ levels.total }}</span
        >
        <span class="text-text-secondary text-sm">{{
          t("overview.alerts.firingLabel", { count: levels.total }, levels.total)
        }}</span>
      </p>
      <div class="flex flex-col gap-1">
        <OSegmentedBar
          :segments="severitySegments"
          :label="severityLabel"
          data-test="overview-alerts-severity-bar"
        />
        <div
          class="-mx-1 flex flex-wrap items-center justify-between gap-x-6 text-sm"
          data-test="overview-alerts-counts"
        >
          <ul class="flex flex-wrap items-center gap-x-3">
            <li v-for="level in levelItems" :key="level.key">
              <OButton
                variant="row"
                :data-test="`overview-alerts-level-${level.key}`"
                @click="emit('select', 'firing')"
              >
                <i18n-t
                  :keypath="level.keypath"
                  tag="span"
                  scope="global"
                  class="text-text-secondary px-1 font-normal"
                >
                  <template #count>
                    <span
                      :class="[
                        'font-semibold tabular-nums',
                        level.count > 0 ? level.tone : 'text-text-heading',
                      ]"
                      >{{ level.count }}</span
                    >
                  </template>
                </i18n-t>
              </OButton>
            </li>
          </ul>
          <ul class="flex flex-wrap items-center gap-x-3">
            <li v-for="item in problemItems" :key="item.key">
              <OButton
                variant="row"
                :data-test="`overview-alerts-count-${item.key}`"
                @click="emit('select', item.key)"
              >
                <i18n-t
                  :keypath="item.keypath"
                  :plural="item.count"
                  tag="span"
                  scope="global"
                  class="text-text-secondary px-1 font-normal"
                >
                  <template #count>
                    <span
                      :class="[
                        'font-semibold tabular-nums',
                        item.count > 0 ? 'text-status-negative' : 'text-text-heading',
                      ]"
                      >{{ item.count }}</span
                    >
                  </template>
                </i18n-t>
              </OButton>
            </li>
          </ul>
        </div>
      </div>
      <div v-if="rows.length > 0" class="-mx-2" data-test="overview-alerts-firing">
        <div
          class="border-border-default text-text-label grid grid-cols-[6rem_minmax(0,2fr)_minmax(0,1fr)_5rem] gap-x-4 border-b px-2 pb-1.5 text-xs max-md:hidden"
          data-test="overview-alerts-table-header"
        >
          <span>{{ t("overview.alerts.columns.severity") }}</span>
          <span>{{ t("overview.alerts.columns.alert") }}</span>
          <span>{{ t("overview.alerts.columns.stream") }}</span>
          <span class="text-end">{{ t("overview.alerts.firingFor") }}</span>
        </div>
        <ul class="divide-border-default flex flex-col divide-y">
          <li v-for="(row, index) in rows" :key="`${row.stream}-${row.name}-${row.since}-${index}`">
            <OverviewRowButton
              :data-test="`overview-alerts-firing-${row.name}`"
              @click="emit('open')"
            >
              <span
                class="grid w-full grid-cols-[6rem_minmax(0,2fr)_minmax(0,1fr)_5rem] items-center gap-x-4 text-start max-md:grid-cols-[auto_minmax(0,1fr)_auto] max-md:gap-y-0.5"
              >
                <span class="max-md:row-span-2">
                  <OTag
                    type="countChip"
                    :value="rowTone(row.level)"
                    :data-test="`overview-alerts-firing-level-${row.name}`"
                    >{{ rowLevelLabel(row.level) }}</OTag
                  >
                </span>
                <OTruncatedText class="text-text-heading text-sm max-md:col-span-2">{{
                  raw(row.name)
                }}</OTruncatedText>
                <OTruncatedText class="text-text-secondary text-xs">{{
                  raw(row.stream)
                }}</OTruncatedText>
                <span class="text-text-secondary text-end text-xs tabular-nums">{{ row.age }}</span>
              </span>
            </OverviewRowButton>
          </li>
        </ul>
      </div>
      <OButton
        v-if="remaining > 0"
        variant="ghost-primary"
        size="sm"
        class="self-start"
        data-test="overview-alerts-show-more"
        @click="emit('open')"
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
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSegmentedBar from "@/lib/data/SegmentedBar/OSegmentedBar.vue";
import type { SegmentedBarSegment } from "@/lib/data/SegmentedBar/OSegmentedBar.types";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import type {
  OverviewAlertLevel,
  OverviewAlertsData,
  OverviewSection,
} from "@/ts/interfaces/overview";
import type { IncidentsTile, OverviewTarget } from "./OverviewHeadlineStrip.vue";
import OverviewRowButton from "./OverviewRowButton.vue";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import {
  firingRows,
  firingTotal,
  hasKnownSince,
  levelCount,
  microsToMs,
  sectionView,
} from "./overviewFormat";
import { useOverviewTime } from "./useOverviewTime";

interface CountItem {
  key: string;
  keypath: I18nKey;
  count: number;
  tone?: string;
}

const props = defineProps<{
  section?: OverviewSection<OverviewAlertsData>;
  pending: boolean;
  failed: boolean;
  forbidden?: boolean;
  incidentsState?: IncidentsTile;
  incidentsTotal?: number;
}>();

const emit = defineEmits<{
  retry: [];
  open: [];
  create: [];
  select: [target: Extract<OverviewTarget, "firing" | "failing" | "incidents">];
}>();

const { t } = useI18nTyped();
const { formatElapsed } = useOverviewTime();

// OSS and a deployment with incidents off have no incidents to summarise, so the title says alerts only
const hasIncidents = computed(
  () =>
    props.incidentsState !== undefined &&
    props.incidentsState !== "locked" &&
    props.incidentsState !== "unavailable",
);

const view = computed(() => {
  const base = sectionView(props.section, props);
  return base === "ok" && props.section?.data?.total === 0 ? "empty" : base;
});

// the age is read at render time so each new overview snapshot restarts it from the current clock
const rows = computed(() =>
  firingRows(props.section?.data).map((row) => ({
    ...row,
    age: hasKnownSince(row.since) ? formatElapsed(Date.now() - microsToMs(row.since)) : "",
  })),
);
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

const levels = computed(() => {
  const data = props.section?.data;
  const total = firingTotal(data);
  const critical = levelCount(data, "critical");
  const warning = levelCount(data, "warning");
  return { total, critical, warning, other: Math.max(0, total - critical - warning) };
});

const severitySegments = computed<SegmentedBarSegment[]>(() => {
  const { total, critical, warning, other } = levels.value;
  if (total === 0) return [];
  const pct = (count: number) => (count / total) * 100;
  return [
    { id: "critical", pct: pct(critical), variant: "danger" },
    { id: "warning", pct: pct(warning), variant: "warning" },
    { id: "other", pct: pct(other), variant: "neutral" },
  ];
});

const severityLabel = computed(() =>
  t("overview.alerts.severityBar", {
    critical: levels.value.critical,
    warning: levels.value.warning,
    other: levels.value.other,
  }),
);

const levelItems = computed<CountItem[]>(() => [
  {
    key: "critical",
    keypath: "overview.alerts.levelCount.critical",
    count: levels.value.critical,
    tone: "text-status-negative",
  },
  {
    key: "warning",
    keypath: "overview.alerts.levelCount.warning",
    count: levels.value.warning,
    tone: "text-status-warning-text",
  },
  {
    key: "other",
    keypath: "overview.alerts.levelCount.other",
    count: levels.value.other,
    tone: "text-text-heading",
  },
]);

const problemItems = computed(() => {
  const list: Array<CountItem & { key: "incidents" | "failing" }> = [];
  if (props.incidentsState === "ok") {
    list.push({
      key: "incidents",
      keypath: "overview.alerts.openIncidents",
      count: props.incidentsTotal ?? 0,
    });
  }
  list.push({
    key: "failing",
    keypath: "overview.alerts.failingRules",
    count: props.section?.data?.failed_evaluation ?? 0,
  });
  return list;
});
</script>
