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
    :title="t('overview.sections.alerts')"
    :link-label="t('overview.viewAll')"
    :link-aria-label="t('overview.alerts.viewAllAria')"
    :view="view"
    :summary-forbidden="forbidden"
    @retry="emit('retry')"
    @view-all="emit('open')"
  >
    <template #empty>
      <OEmptyState
        size="inline"
        icon="notifications"
        :title="t('overview.alerts.emptyTitle')"
        data-test="overview-alerts-empty"
      >
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            data-test="overview-alerts-open-btn"
            @click="emit('create')"
          >
            {{ t("overview.alerts.emptyAction") }}
          </OButton>
        </template>
      </OEmptyState>
    </template>
    <div class="flex flex-col gap-4">
      <ul class="grid grid-cols-4 gap-3 max-md:grid-cols-2" data-test="overview-alerts-tiles">
        <li
          v-for="tile in tiles"
          :key="tile.key"
          class="flex flex-col gap-0.5"
          :data-test="`overview-alerts-tile-${tile.key}`"
        >
          <span :class="['text-2xl font-semibold tabular-nums', tile.valueClass]">{{
            tile.value
          }}</span>
          <span class="text-text-secondary text-xs">{{ tile.label }}</span>
        </li>
      </ul>
      <div data-test="overview-alerts-firing">
        <div class="mb-1 flex items-center justify-between gap-3 px-2">
          <span class="text-text-label text-xs font-medium">{{
            t("overview.alerts.firingNow")
          }}</span>
          <span v-if="rows.length > 0" class="text-text-label text-xs font-medium">{{
            t("overview.alerts.firingFor")
          }}</span>
        </div>
        <p
          v-if="rows.length === 0"
          class="text-text-secondary px-2 py-1.5 text-sm"
          data-test="overview-alerts-all-clear"
        >
          {{ t("overview.alerts.allClear") }}
        </p>
        <ul v-else class="flex flex-col">
          <li v-for="(row, index) in rows" :key="`${row.stream}-${row.name}-${row.since}-${index}`">
            <OverviewRowButton
              :data-test="`overview-alerts-firing-${row.name}`"
              @click="emit('open')"
            >
              <span class="flex min-w-0 items-center gap-2">
                <OTag
                  type="countChip"
                  :value="rowTone(row.level)"
                  class="shrink-0"
                  :data-test="`overview-alerts-firing-level-${row.name}`"
                  >{{
                    row.level === "ok"
                      ? t("overview.level.okFiring")
                      : t(`overview.level.${row.level}`)
                  }}</OTag
                >
                <OTruncatedText class="text-text-body text-sm">{{ raw(row.name) }}</OTruncatedText>
                <OTruncatedText class="text-text-secondary text-xs max-md:hidden">{{
                  raw(row.stream)
                }}</OTruncatedText>
              </span>
              <span class="text-text-secondary shrink-0 text-xs tabular-nums">{{ row.age }}</span>
            </OverviewRowButton>
          </li>
        </ul>
        <OButton
          v-if="remaining > 0"
          variant="ghost-primary"
          size="sm"
          data-test="overview-alerts-show-more"
          @click="emit('open')"
        >
          {{ t("overview.alerts.showMore", { count: remaining }, remaining) }}
        </OButton>
      </div>
    </div>
  </OverviewSectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type {
  OverviewAlertLevel,
  OverviewAlertsData,
  OverviewSection,
} from "@/ts/interfaces/overview";
import type { IncidentsTile } from "./OverviewHeadlineStrip.vue";
import OverviewRowButton from "./OverviewRowButton.vue";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import {
  firingRows,
  firingTotal,
  hasKnownSince,
  levelCount,
  levelTone,
  microsToMs,
  sectionView,
} from "./overviewFormat";
import { useOverviewTime } from "./useOverviewTime";

const props = defineProps<{
  section?: OverviewSection<OverviewAlertsData>;
  pending: boolean;
  failed: boolean;
  forbidden?: boolean;
  incidentsState?: IncidentsTile;
  incidentsTotal?: number;
}>();

const emit = defineEmits<{ retry: []; open: []; create: [] }>();

const { t } = useI18nTyped();
const { formatElapsed } = useOverviewTime();

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

// a rule in the firing list is firing whatever its configured level, so "ok" must not read as healthy
const rowTone = (level: OverviewAlertLevel) => (level === "ok" ? "neutral" : levelTone(level));

const tiles = computed(() => {
  const data = props.section?.data;
  const critical = levelCount(data, "critical");
  const warning = levelCount(data, "warning");
  const other = Math.max(0, firingTotal(data) - critical - warning);
  const failing = data?.failed_evaluation ?? 0;
  const list = [
    {
      key: "critical",
      label: t("overview.alerts.criticalLevel"),
      value: critical,
      valueClass: critical > 0 ? "text-status-negative" : "text-text-heading",
    },
    {
      key: "warning",
      label: t("overview.alerts.warningLevel"),
      value: warning,
      valueClass: warning > 0 ? "text-status-warning-text" : "text-text-heading",
    },
  ];
  if (other > 0) {
    list.push({
      key: "other",
      label: t("overview.alerts.otherLevel"),
      value: other,
      valueClass: "text-text-heading",
    });
  }
  if (props.incidentsState === "ok") {
    list.push({
      key: "incidents",
      label: t("overview.cards.openIncidents"),
      value: props.incidentsTotal ?? 0,
      valueClass: "text-text-heading",
    });
  }
  list.push({
    key: "failing",
    label: t("overview.alerts.failing"),
    value: failing,
    valueClass: failing > 0 ? "text-status-negative" : "text-text-heading",
  });
  return list;
});
</script>
