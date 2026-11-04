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
        <OText
          v-for="note in coverageNoteRows(t, latest)"
          :key="note.text"
          variant="meta"
          as="p"
          :data-test="
            note.gap ? 'alert-calibration-dashboard-gap-note' : 'alert-calibration-dashboard-note'
          "
        >
          <!-- OText's meta colour wins over a class on it, so the amber sits on the text. -->
          <span :class="note.gap ? 'text-status-warning-text' : ''">{{ note.text }}</span>
        </OText>
      </section>

      <section class="flex flex-col gap-3" data-test="alert-calibration-dashboard-attention">
        <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div class="flex min-w-0 flex-col gap-0.5">
            <OText variant="card-title" as="h2">{{
              t("alertCalibration.dashboard.attention")
            }}</OText>
            <OText variant="meta" as="p">{{
              t("alertCalibration.dashboard.attentionCaption")
            }}</OText>
          </div>
          <OText
            variant="meta"
            as="p"
            class="shrink-0"
            data-test="alert-calibration-dashboard-latest-age"
          >
            {{
              t("alertCalibration.dashboard.latestRunAgo", { time: formatAgo(latest.emitted_at) })
            }}
          </OText>
        </div>

        <OBanner
          v-if="countsPending"
          variant="warning"
          data-test="alert-calibration-dashboard-counts-pending"
        >
          {{ visibilityCopy(t, latest).pending.banner }}
        </OBanner>
        <OBanner
          v-else-if="latest.finding_count === 0"
          :variant="isScoped(latest) ? 'info' : 'success'"
          :icon="isScoped(latest) ? 'info' : 'check-circle'"
        >
          {{ visibilityCopy(t, latest).allClear }}
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
                {{ t(ruleLabelKey(group.rule_id, version)) }}
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
                v-if="group.pending"
                variant="warning-soft"
                size="xs"
                shape="rounded"
                data-test="alert-calibration-dashboard-group-pending"
              >
                {{ visibilityCopy(t, latest).pending.badge }}
              </OBadge>
              <OBadge
                v-else-if="!RULE_META[group.rule_id].clusterWide"
                :variant="group.findings.length ? 'default-soft' : 'default-outline'"
                size="xs"
                shape="rounded"
              >
                {{
                  t(
                    "alertCalibration.dashboard.alertsFlagged",
                    { count: alertCount(group.findings) },
                    alertCount(group.findings),
                  )
                }}
              </OBadge>
            </template>

            <OText v-if="group.pending" variant="meta" as="p" class="px-4 pb-3">
              {{ visibilityCopy(t, latest).pending.banner }}
            </OText>
            <OText v-else-if="!group.findings.length" variant="meta" as="p" class="px-4 pb-3">
              {{
                RULE_META[group.rule_id].clusterWide
                  ? t("alertCalibration.dashboard.nothingCongested")
                  : t("alertCalibration.dashboard.nothingFlagged")
              }}
            </OText>
            <div v-else class="border-border-default border-t">
              <ul class="divide-border-default flex flex-col divide-y">
                <li
                  v-for="finding in group.findings"
                  :key="
                    finding.finding_id ?? finding.alert_id ?? finding.alert_name ?? finding.rule_id
                  "
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
import { formatDistanceToNowStrict } from "date-fns";
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
import analytics from "@/services/product_analytics";
import { alertCalibrationConfigQuery } from "@/services/alert_calibration.queries";
import { useLeaveIfAlertCalibrationOff } from "@/composables/alertCalibration/useAlertCalibrationEnabled";
import AlertCalibrationTabs from "./AlertCalibrationTabs.vue";
import AlertCalibrationActions from "./AlertCalibrationActions.vue";
import AlertCalibrationLastRun from "./AlertCalibrationLastRun.vue";
import { useDigestSearch, useLatestRead } from "./useDigestSearch";
import {
  countOrDash,
  coverageNoteRows,
  coverageVerdict,
  findingsByRule,
  isScoped,
  latestEmission,
  latestPerWindow,
  latestRun,
  lookbackRange,
  RUNS_LOOKBACK_DAYS,
  titleAfterName,
  visibilityCopy,
  type DigestRecord,
  type FindingRecord,
  type RuleId,
  type RunRow,
} from "./digests";
import { COVERAGE_BADGE, SEVERITY_BADGE, SEVERITY_LABEL } from "./format";
import { RULE_META, ruleLabelKey, rulesShownFor } from "./rules";

const { t } = useI18nTyped();
useLeaveIfAlertCalibrationOff("alertList");
const router = useRouter();
const { search, orgId } = useDigestSearch();

const configQuery = useQuery(() => alertCalibrationConfigQuery(orgId.value));
const config = computed(() => configQuery.data.value ?? null);

const formatAgo = (micros: number) =>
  raw(formatDistanceToNowStrict(micros / 1000, { addSuffix: true }));

/** The latest run's own records, so the page says what is wrong now rather than what any run ever flagged. */
const data = useLatestRead(async () => {
  const rows = latestPerWindow(await search<RunRow>("", lookbackRange(Date.now() * 1000)));
  const run = latestRun(rows);
  if (!run) {
    return {
      latest: null,
      findings: [] as FindingRecord[],
      listPending: false,
      recordsPending: false,
    };
  }
  const hits = await search<DigestRecord>("/records", {
    window_start: run.window_start,
    window_end: run.window_end,
  });
  const emission = latestEmission(hits);
  // The runs list selects fixed columns, so the run's own records carry its version and newer coverage.
  return {
    latest: emission.run ?? run,
    findings: emission.findings,
    listPending: run.finding_count === null,
    recordsPending: emission.run?.finding_count === null,
  };
});

const loading = computed(
  () => configQuery.isPending.value || (data.loading.value && !data.data.value),
);
const latest = computed(() => data.data.value?.latest ?? null);
const version = computed(() => latest.value?.schema_version ?? 1);
/** The list and the records read can reach nodes of different cache freshness, so either one's unknown count makes the board unknown. */
const countsPending = computed(
  () => !!data.data.value?.listPending || !!data.data.value?.recordsPending,
);
/** A scoped reader never gets the cluster rows, so a cluster rule would claim a clear it cannot see. */
const groups = computed(() => {
  const scoped = !!latest.value && isScoped(latest.value);
  const rules = rulesShownFor(orgId.value, version.value).filter(
    (rule) => !(scoped && RULE_META[rule].clusterWide),
  );
  // An empty rule on a run whose counts are unknown has not been shown clear, only not yet read.
  return findingsByRule(rules, data.data.value?.findings ?? []).map((group) => ({
    ...group,
    pending: countsPending.value && !group.findings.length,
  }));
});
/** One alert can hold two findings of a rule, such as its errors and its missing source. */
const alertCount = (findings: FindingRecord[]) =>
  new Set(findings.map((f) => f.alert_id ?? f.alert_name)).size;

const latestStats = computed<StatItem[]>(() => {
  const run = latest.value;
  if (!run) return [];
  const verdict = COVERAGE_BADGE[coverageVerdict(run)];
  const scope = visibilityCopy(t, run).alertsInScope;
  return [
    {
      key: "findings",
      label: t("alertCalibration.dashboard.findings"),
      value: countsPending.value ? raw("—") : countOrDash(run.finding_count),
      icon: "fact-check",
      tone: countsPending.value
        ? "neutral"
        : (run.finding_count ?? 0) > 0
          ? "warning"
          : isScoped(run)
            ? "neutral"
            : "success",
    },
    {
      key: "scope",
      label: t("alertCalibration.dashboard.alertsInScope"),
      value: scope.value,
      sub: scope.sub,
      subIcon: scope.subIcon,
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

/** A new tab, so the board stays where it was while the alert is fixed. */
const openAlert = (finding: FindingRecord) => {
  analytics.track("alert_calibration_finding_alert_opened", {
    rule: finding.rule_id,
    source: "dashboard",
  });
  const { href } = router.resolve({
    name: "alertDetail",
    params: { alert_id: finding.alert_id },
    query: { org_identifier: orgId.value },
  });
  window.open(href, "_blank", "noopener,noreferrer");
};

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
