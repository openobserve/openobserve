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

    <div v-if="loading" class="flex flex-col gap-4">
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
      v-else-if="!config?.enabled"
      size="hero"
      illustration="schedule"
      :title="t('alertCalibration.dashboard.notEnabledTitle')"
      :description="t('alertCalibration.dashboard.notEnabledDescription')"
      :action-label="t('alertCalibration.configure')"
      action-icon="settings"
      data-test="alert-calibration-dashboard-not-enabled"
      @action="configure"
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

    <div v-else class="flex flex-col gap-5" data-test="alert-calibration-dashboard">
      <AlertCalibrationLastRun only-failure />

      <section class="flex flex-col gap-2">
        <OStatStrip :items="latestStats" data-test="alert-calibration-dashboard-latest" />
        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div class="flex min-w-0 flex-col">
            <OText v-for="note in coverageNotes(t, latest)" :key="note" variant="meta" as="p">{{
              note
            }}</OText>
          </div>
          <OText variant="meta" as="p" class="ms-auto text-end">
            {{
              t("alertCalibration.dashboard.latestRunCaption", {
                start: formatTime(latest.window_start),
                end: formatTime(latest.window_end),
                time: formatAgo(latest.emitted_at),
              })
            }}
          </OText>
        </div>
      </section>

      <section class="flex flex-col gap-3" data-test="alert-calibration-dashboard-attention">
        <div class="flex flex-col gap-0.5">
          <OText variant="card-title" as="h2">{{
            t("alertCalibration.dashboard.attention")
          }}</OText>
          <OText variant="meta" as="p">{{
            t("alertCalibration.dashboard.attentionCaption")
          }}</OText>
        </div>

        <OBanner v-if="latest.finding_count === 0" variant="success" icon="check-circle">
          {{ t("alertCalibration.dashboard.allClear") }}
        </OBanner>

        <OCard
          v-for="group in groups"
          :key="group.rule_id"
          variant="glass"
          :data-test="`alert-calibration-dashboard-rule-${group.rule_id}`"
        >
          <OCollapsible :icon="RULE_META[group.rule_id].icon" trigger-class="px-4 py-3">
            <template #trigger>
              <span class="text-text-heading min-w-0 flex-1 truncate text-sm font-medium">
                {{ t(RULE_META[group.rule_id].labelKey) }}
              </span>
              <OBadge
                v-if="group.severity"
                :variant="SEVERITY_BADGE[group.severity]"
                size="xs"
                shape="rounded"
              >
                {{ t(SEVERITY_LABEL[group.severity]) }}
              </OBadge>
              <OBadge
                :variant="group.findings.length ? 'default-soft' : 'default-outline'"
                size="xs"
                shape="rounded"
              >
                {{
                  t(
                    "alertCalibration.dashboard.alertsFlagged",
                    { count: group.findings.length },
                    group.findings.length,
                  )
                }}
              </OBadge>
            </template>

            <OText v-if="!group.findings.length" variant="meta" as="p" class="px-4 pb-3">
              {{ t("alertCalibration.dashboard.nothingFlagged") }}
            </OText>
            <div v-else class="border-border-default bg-surface-subtle border-t">
              <ul class="divide-border-default flex flex-col divide-y">
                <li
                  v-for="finding in group.findings"
                  :key="finding.alert_id ?? finding.alert_name"
                  class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2"
                  :data-test="`alert-calibration-dashboard-alert-${finding.alert_id}`"
                >
                  <OBadge :variant="SEVERITY_BADGE[finding.severity]" size="xs" shape="rounded">
                    {{ t(SEVERITY_LABEL[finding.severity]) }}
                  </OBadge>
                  <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                    <OText variant="body-strong" as="span">{{ finding.alert_name }}</OText>
                    <OText variant="meta" as="span" class="min-w-0">{{
                      titleAfterName(finding)
                    }}</OText>
                  </div>
                  <OButton
                    v-if="finding.alert_id"
                    variant="ghost-muted"
                    size="xs"
                    icon-left="open-in-new"
                    data-test="alert-calibration-dashboard-open-alert"
                    @click="openAlert(finding)"
                  >
                    {{ t("alertCalibration.dashboard.openAlert") }}
                  </OButton>
                </li>
              </ul>
              <div class="border-border-default flex justify-end border-t px-3 py-1.5">
                <OButton
                  variant="ghost-muted"
                  size="xs"
                  icon-left="fact-check"
                  data-test="alert-calibration-dashboard-view-evidence"
                  @click="viewEvidence(group.rule_id)"
                >
                  {{ t("alertCalibration.dashboard.viewEvidence") }}
                </OButton>
              </div>
            </div>
          </OCollapsible>
        </OCard>
      </section>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import { raw, useI18nTyped } from "@/types/i18n";
import { alertCalibrationConfigQuery } from "@/services/alert_calibration.queries";
import { useLeaveIfAlertCalibrationOff } from "@/composables/alertCalibration/useAlertCalibrationEnabled";
import AlertCalibrationTabs from "./AlertCalibrationTabs.vue";
import AlertCalibrationActions from "./AlertCalibrationActions.vue";
import AlertCalibrationLastRun from "./AlertCalibrationLastRun.vue";
import { useDigestSearch, useLatestRead } from "./useDigestSearch";
import {
  coverageNotes,
  coverageVerdict,
  findingsByRule,
  latestEmission,
  latestPerWindow,
  latestRun,
  lookbackRange,
  RUNS_LOOKBACK_DAYS,
  titleAfterName,
  type DigestRecord,
  type FindingRecord,
  type RuleId,
  type RunRow,
} from "./digests";
import { COVERAGE_BADGE, SEVERITY_BADGE, SEVERITY_LABEL } from "./format";
import { RULE_IDS, RULE_META } from "./rules";

const { t } = useI18nTyped();
useLeaveIfAlertCalibrationOff("alertList");
const router = useRouter();
const { search, orgId } = useDigestSearch();

const configQuery = useQuery(() => alertCalibrationConfigQuery(orgId.value));
const config = computed(() => configQuery.data.value ?? null);

const formatTime = (micros: number) => raw(format(micros / 1000, "MMM d, HH:mm"));
const formatAgo = (micros: number) =>
  raw(formatDistanceToNowStrict(micros / 1000, { addSuffix: true }));

/** The latest run's own records, so the page says what is wrong now rather than what any run ever flagged. */
const data = useLatestRead(async () => {
  const rows = latestPerWindow(await search<RunRow>("", lookbackRange(Date.now() * 1000)));
  const run = latestRun(rows);
  if (!run) return { latest: null, findings: [] as FindingRecord[] };
  const hits = await search<DigestRecord>("/records", {
    window_start: run.window_start,
    window_end: run.window_end,
  });
  return { latest: run, findings: latestEmission(hits).findings };
});

const loading = computed(
  () => configQuery.isPending.value || (data.loading.value && !data.data.value),
);
const latest = computed(() => data.data.value?.latest ?? null);
const groups = computed(() => findingsByRule(RULE_IDS, data.data.value?.findings ?? []));

const latestStats = computed<StatItem[]>(() => {
  const run = latest.value;
  if (!run) return [];
  const verdict = COVERAGE_BADGE[coverageVerdict(run)];
  return [
    {
      key: "findings",
      label: t("alertCalibration.dashboard.findings"),
      value: run.finding_count,
      icon: "fact-check",
      tone: run.finding_count > 0 ? "warning" : "success",
    },
    {
      key: "scope",
      label: t("alertCalibration.dashboard.alertsInScope"),
      value: run.alerts_in_scope,
      icon: "notifications",
    },
    {
      key: "coverage",
      label: t("alertCalibration.dashboard.coverage"),
      value: t(verdict.shortKey),
      icon: "verified-user",
      tone: verdict.tone,
    },
  ];
});

const configure = () =>
  router.push({ name: "alertCalibrationSettings", query: { org_identifier: orgId.value } });

const openAlert = (finding: FindingRecord) =>
  router.push({
    name: "alertDetail",
    params: { alert_id: finding.alert_id },
    query: { org_identifier: orgId.value },
  });

const viewEvidence = (rule: RuleId) => {
  if (!latest.value) return;
  void router.push({
    name: "alertCalibrationDigest",
    params: {
      windowStart: String(latest.value.window_start),
      windowEnd: String(latest.value.window_end),
    },
    query: { org_identifier: orgId.value, rule },
  });
};

/** A refresh reaches the server for everything the view shows. */
function refresh() {
  void configQuery.refetch();
  void data.load();
}

onMounted(() => void data.load());
</script>
