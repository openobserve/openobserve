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
  <OPageLayout
    :title="t('alertCalibration.title')"
    :subtitle="t('alertCalibration.subtitle')"
    icon="tune"
    tabs-below
    scroll
    pad-y
    data-test="alert-calibration-dashboard-page"
  >
    <template #header-tabs><AlertCalibrationTabs /></template>

    <template #actions>
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="refresh"
        :aria-label="t('alertCalibration.refresh')"
        :loading="data.loading.value"
        data-test="alert-calibration-dashboard-refresh"
        @click="refresh"
      >
        <OTooltip side="bottom" :content="t('alertCalibration.refresh')" />
      </OButton>
      <AlertCalibrationActions :config="config" part="run" />
    </template>

    <template #actions-overflow>
      <AlertCalibrationActions :config="config" part="configure" />
    </template>

    <div v-if="data.loading.value && !data.data.value" class="flex flex-col gap-4">
      <OSkeleton class="rounded-surface h-40 w-full" />
      <OSkeleton class="rounded-surface h-56 w-full" />
    </div>

    <OEmptyState
      v-else-if="data.error.value"
      size="hero"
      illustration="broken-panel"
      variant="error"
      :title="t('alertCalibration.digests.errorTitle')"
      :description="raw(data.error.value)"
      :action-label="t('alertCalibration.retry')"
      action-icon="refresh"
      @action="refresh"
    />

    <OEmptyState
      v-else-if="!latest"
      size="hero"
      illustration="history"
      :title="t('alertCalibration.dashboard.emptyTitle', { days: RUNS_LOOKBACK_DAYS })"
      :description="t('alertCalibration.dashboard.emptyDescription')"
      hide-action
      data-test="alert-calibration-dashboard-empty"
    />

    <div v-else class="flex flex-col gap-4" data-test="alert-calibration-dashboard">
      <AlertCalibrationPanel
        :title="t('alertCalibration.dashboard.latestRun')"
        :caption="
          t('alertCalibration.dashboard.latestRunCaption', {
            start: formatTime(latest.window_start),
            end: formatTime(latest.window_end),
            time: formatAgo(latest.emitted_at),
          })
        "
        :sql="runsSql()"
        data-test="alert-calibration-dashboard-latest"
      >
        <OStatStrip :items="latestStats" />
        <OText v-for="note in coverageNotes(t, latest)" :key="note" variant="meta" as="p">{{
          note
        }}</OText>
      </AlertCalibrationPanel>

      <AlertCalibrationPanel
        :title="t('alertCalibration.dashboard.byRule')"
        :caption="
          t('alertCalibration.dashboard.byRuleCaption', {
            runs: rows.length,
            gaps: gapRuns,
            blind: blindRuns,
          })
        "
        :sql="flaggedByRuleSql()"
        data-test="alert-calibration-dashboard-by-rule"
      >
        <OTable
          :data="tallies"
          :columns="tallyColumns"
          row-key="rule_id"
          pagination="none"
          sorting="none"
          :show-global-filter="false"
          dense
          bordered
          table-id="alert-calibration-dashboard-by-rule"
        >
          <template #cell-rule="{ row }">
            <div class="flex items-center gap-2">
              <OIcon :name="RULE_META[row.rule_id].icon" size="sm" class="text-text-secondary" />
              <span class="text-text-body">{{ t(RULE_META[row.rule_id].labelKey) }}</span>
            </div>
          </template>
        </OTable>
      </AlertCalibrationPanel>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import { raw, useI18nTyped } from "@/types/i18n";
import { alertCalibrationConfigQuery } from "@/services/alert_calibration.queries";
import AlertCalibrationTabs from "./AlertCalibrationTabs.vue";
import AlertCalibrationActions from "./AlertCalibrationActions.vue";
import AlertCalibrationPanel from "./AlertCalibrationPanel.vue";
import { useDigestSearch, useLatestRead } from "./useDigestSearch";
import {
  coverageNotes,
  coverageVerdict,
  flaggedByRuleSql,
  latestPerWindow,
  latestRun,
  lookbackRange,
  runsSql,
  RUNS_LOOKBACK_DAYS,
  type RuleId,
  type RunRow,
} from "./digests";
import { COVERAGE_BADGE } from "./format";
import { RULE_IDS, RULE_META } from "./rules";

interface RuleTally {
  rule_id: RuleId;
  alerts_flagged: number;
  runs_flagging: number;
}

const { t } = useI18nTyped();
const { search, orgId } = useDigestSearch();

const configQuery = useQuery(() => alertCalibrationConfigQuery(orgId.value));
const config = computed(() => configQuery.data.value ?? null);

const formatTime = (micros: number) => raw(format(micros / 1000, "MMM d, HH:mm"));
const formatAgo = (micros: number) =>
  raw(formatDistanceToNowStrict(micros / 1000, { addSuffix: true }));

const data = useLatestRead(async () => {
  const range = lookbackRange(Date.now() * 1000);
  const [emissions, flagged] = await Promise.all([
    search<RunRow>(runsSql(), range),
    search<RuleTally>(flaggedByRuleSql(), range),
  ]);
  return { rows: latestPerWindow(emissions), flagged };
});

const rows = computed(() => data.data.value?.rows ?? []);
const latest = computed(() => latestRun(rows.value));
const gapRuns = computed(() => rows.value.filter((r) => r.coverage_gap).length);
const blindRuns = computed(
  () => rows.value.filter((r) => r.coverage_stream_substrate_empty).length,
);

/** Every rule shows, so a rule that flagged nothing reads as zero rather than as missing. */
const tallies = computed<RuleTally[]>(() => {
  const byRule = new Map((data.data.value?.flagged ?? []).map((row) => [row.rule_id, row]));
  return RULE_IDS.map((rule_id) => ({
    rule_id,
    alerts_flagged: Number(byRule.get(rule_id)?.alerts_flagged ?? 0),
    runs_flagging: Number(byRule.get(rule_id)?.runs_flagging ?? 0),
  }));
});

const latestStats = computed<StatItem[]>(() => {
  const run = latest.value;
  if (!run) return [];
  const verdict = COVERAGE_BADGE[coverageVerdict(run)];
  return [
    {
      key: "findings",
      label: t("alertCalibration.dashboard.findings"),
      value: run.finding_count,
      sub: t("alertCalibration.dashboard.thisRunOnly"),
      icon: "fact-check",
      tone: run.finding_count > 0 ? "warning" : "neutral",
    },
    {
      key: "scope",
      label: t("alertCalibration.dashboard.alertsInScope"),
      value: run.alerts_in_scope,
      icon: "notifications",
    },
    {
      key: "declined",
      label: t("alertCalibration.dashboard.declined"),
      value: run.skip_count,
      icon: "block",
    },
    {
      key: "coverage",
      label: t("alertCalibration.dashboard.coverage"),
      value: t(verdict.labelKey),
      icon: "verified-user",
      tone: verdict.tone,
    },
  ];
});

const tallyColumns = computed<OTableColumnDef<RuleTally>[]>(() => [
  {
    id: "rule",
    header: t("alertCalibration.dashboard.colRule"),
    accessorKey: "rule_id",
    size: 260,
    meta: { align: "left" },
  },
  {
    id: "alerts",
    header: t("alertCalibration.dashboard.colAlertsFlagged"),
    accessorKey: "alerts_flagged",
    size: 160,
    meta: { align: "right" },
  },
  {
    id: "runs",
    header: t("alertCalibration.dashboard.colRunsFlagging"),
    accessorKey: "runs_flagging",
    size: 180,
    meta: { align: "right" },
  },
]);

/** A refresh reaches the server for everything the view shows. */
function refresh() {
  void configQuery.refetch();
  void data.load();
}

onMounted(() => void data.load());
</script>
