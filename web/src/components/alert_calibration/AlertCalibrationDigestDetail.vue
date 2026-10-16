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
    :title="
      run
        ? t('alertCalibration.detail.title', { time: formatTime(run.window_end) })
        : t('alertCalibration.detail.titleLoading')
    "
    :subtitle="
      run
        ? t('alertCalibration.detail.subtitle', {
            start: formatDay(run.window_start),
            end: formatDay(run.window_end),
            time: formatAgo(run.emitted_at),
          })
        : raw('')
    "
    icon="tune"
    :back="{ label: t('alertCalibration.detail.back'), to: digestsRoute }"
    scroll
    pad-y
    data-test="alert-calibration-digest-page"
  >
    <template #actions>
      <OButton
        v-if="run"
        variant="outline"
        size="sm"
        icon-left="open-in-new"
        data-test="alert-calibration-digest-view-in-logs"
        @click="viewInLogs"
      >
        {{ t("alertCalibration.detail.viewInLogs") }}
        <OTooltip side="bottom" :content="t('alertCalibration.detail.viewInLogsHint')" />
      </OButton>
    </template>

    <div v-if="records.loading.value && !run" class="flex flex-col gap-3">
      <OSkeleton class="rounded-default h-16 w-full" />
      <OSkeleton class="rounded-default h-40 w-full" />
    </div>

    <OEmptyState
      v-else-if="loadError"
      size="hero"
      illustration="broken-panel"
      variant="error"
      :title="t('alertCalibration.detail.unavailableTitle')"
      :description="loadError"
      :action-label="t('alertCalibration.detail.backToDigests')"
      action-icon="chevron-left"
      data-test="alert-calibration-digest-error"
      @action="router.push(digestsRoute)"
    />

    <div v-else-if="run" class="flex flex-col gap-4">
      <OBanner
        v-if="run.coverage_gap"
        variant="warning"
        data-test="alert-calibration-digest-partial"
      >
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="text-sm font-medium">{{
            t("alertCalibration.detail.partialCoverage")
          }}</span>
          <span class="text-xs">{{ t("alertCalibration.detail.partialCoverageDesc") }}</span>
          <span v-for="note in notes" :key="note" class="text-xs">{{ note }}</span>
        </div>
      </OBanner>

      <OStatStrip :items="stats" data-test="alert-calibration-digest-stats" />

      <OText v-if="!run.coverage_gap && notes.length" variant="meta" as="div">
        <span v-for="note in notes" :key="note" class="block">{{ note }}</span>
      </OText>

      <div v-if="run.finding_count > 0" class="flex flex-col gap-3">
        <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div class="flex min-w-0 flex-col gap-0.5">
            <OText variant="card-title" as="h2">{{
              t("alertCalibration.detail.findingsHeading")
            }}</OText>
            <OText variant="meta" as="p" class="flex items-center gap-1">
              <OIcon name="lightbulb-outline" size="xs" class="shrink-0" />
              <span>{{ t("alertCalibration.detail.suggestionsOnly") }}</span>
            </OText>
          </div>
          <OToggleGroup
            v-if="presentRules.length > 1"
            :model-value="ruleFilter"
            mobile-dropdown
            data-test="alert-calibration-digest-rule-filter"
            @update:model-value="onRuleFilter"
          >
            <OToggleGroupItem value="all" size="xs">{{
              t("alertCalibration.detail.filterAll")
            }}</OToggleGroupItem>
            <OToggleGroupItem v-for="rule in presentRules" :key="rule" :value="rule" size="xs">
              {{ t(RULE_META[rule].labelKey) }}
            </OToggleGroupItem>
          </OToggleGroup>
        </div>
        <OText v-if="hitCount === SEARCH_SIZE" variant="meta" as="div">
          {{
            t("alertCalibration.detail.showingCapped", {
              shown: findings.length,
              total: run.finding_count,
              count: SEARCH_SIZE,
            })
          }}
        </OText>
        <OText v-else-if="findings.length !== run.finding_count" variant="meta" as="div">
          {{ t("alertCalibration.detail.perAlertNote") }}
        </OText>
        <div class="flex flex-col gap-3">
          <AlertCalibrationFindingCard
            v-for="finding in visibleFindings"
            :key="`${finding.rule_id}:${finding.alert_id}`"
            :finding="finding"
          />
        </div>
      </div>

      <OEmptyState
        v-else-if="isClean(run)"
        size="block"
        illustration="check"
        :title="t('alertCalibration.detail.nothingTitle')"
        :description="
          t('alertCalibration.detail.nothingDescription', { count: run.alerts_in_scope })
        "
        hide-action
        data-test="alert-calibration-digest-clean"
      />

      <OEmptyState
        v-else
        size="block"
        illustration="radar"
        :title="t('alertCalibration.detail.noneFoundTitle')"
        :description="noneFoundReason"
        hide-action
        data-test="alert-calibration-digest-none-found"
      />

      <OSeparator />

      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-baseline gap-2">
          <OText variant="card-title" as="h2">{{
            t("alertCalibration.detail.declinedHeading")
          }}</OText>
          <OText variant="meta" as="span">{{ t("alertCalibration.detail.declinedHint") }}</OText>
        </div>
        <OText v-if="run.skip_count === 0" variant="meta" as="div">
          {{ t("alertCalibration.detail.nothingDeclined") }}
        </OText>
        <template v-else>
          <div>
            <OBadge variant="default-soft" size="sm" shape="rounded" :count="run.skip_count">
              {{ t("alertCalibration.detail.declinedPairs") }}
            </OBadge>
          </div>
          <OText variant="meta" as="div">{{
            t("alertCalibration.detail.declinedNotWritten")
          }}</OText>
        </template>
      </div>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { format, formatDistanceToNowStrict } from "date-fns";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import { b64EncodeUnicode } from "@/utils/formatters";
import { useLeaveIfAlertCalibrationOff } from "@/composables/alertCalibration/useAlertCalibrationEnabled";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import AlertCalibrationFindingCard from "./AlertCalibrationFindingCard.vue";
import { useDigestSearch, useLatestRead } from "./useDigestSearch";
import {
  coverageNotes,
  coverageVerdict,
  DIGEST_STREAM,
  isClean,
  latestEmission,
  runRecordsSql,
  SEARCH_SIZE,
  type DigestRecord,
  type RuleId,
} from "./digests";
import { COVERAGE_BADGE, formatMinutes } from "./format";
import { isRuleId, RULE_META } from "./rules";

const props = defineProps<{ windowStart: string | number; windowEnd: string | number }>();

const { t } = useI18nTyped();
useLeaveIfAlertCalibrationOff("alertList");
const router = useRouter();
const route = useRoute();
const { search, orgId } = useDigestSearch();

const windowStart = computed(() => Number(props.windowStart));
const windowEnd = computed(() => Number(props.windowEnd));
const digestsRoute = computed(() => ({
  name: "alertCalibrationRuns",
  query: { org_identifier: orgId.value },
}));

const formatTime = (micros: number) => raw(format(micros / 1000, "MMM d, HH:mm"));
const formatDay = (micros: number) => raw(format(micros / 1000, "MMM d"));
const formatAgo = (micros: number) =>
  raw(formatDistanceToNowStrict(micros / 1000, { addSuffix: true }));

const records = useLatestRead(async () => {
  const hits = await search<DigestRecord>("/records", {
    window_start: windowStart.value,
    window_end: windowEnd.value,
  });
  return { hits: hits.length, ...latestEmission(hits) };
});

const run = computed(() => records.data.value?.run ?? null);
const findings = computed(() => records.data.value?.findings ?? []);
const hitCount = computed(() => records.data.value?.hits ?? 0);

const loadError = computed<I18nText | null>(() => {
  if (records.error.value) {
    return t("alertCalibration.detail.loadFailed", { message: raw(records.error.value) });
  }
  if (records.data.value && !run.value) {
    return t("alertCalibration.detail.noRecords", { stream: DIGEST_STREAM });
  }
  return null;
});

const ruleFilter = ref<"all" | RuleId>("all");
const presentRules = computed(() => [...new Set(findings.value.map((f) => f.rule_id))]);
/** The dashboard links here per rule, so the filter it names starts selected once the records arrive. */
const requestedRule = computed(() => {
  const rule = route.query.rule;
  return typeof rule === "string" && isRuleId(rule) ? rule : null;
});
watch(presentRules, (rules) => {
  if (requestedRule.value && rules.includes(requestedRule.value)) {
    ruleFilter.value = requestedRule.value;
  }
});
const visibleFindings = computed(() =>
  ruleFilter.value === "all"
    ? findings.value
    : findings.value.filter((f) => f.rule_id === ruleFilter.value),
);
const onRuleFilter = (value: unknown) => {
  if (value) ruleFilter.value = value as typeof ruleFilter.value;
};

const notes = computed(() => (run.value ? coverageNotes(t, run.value) : []));

const stats = computed<StatItem[]>(() => {
  const r = run.value;
  if (!r) return [];
  const verdict = COVERAGE_BADGE[coverageVerdict(r)];
  const windowMinutes = Math.round((r.window_end - r.window_start) / 60_000_000);
  return [
    {
      key: "findings",
      label: t("alertCalibration.detail.statFindings"),
      value: r.finding_count,
      sub: t(verdict.labelKey),
      icon: "fact-check",
      tone: r.finding_count > 0 ? "warning" : "neutral",
    },
    {
      key: "scope",
      label: t("alertCalibration.detail.statAlertsInScope"),
      value: r.alerts_in_scope,
      icon: "notifications",
    },
    {
      key: "declined",
      label: t("alertCalibration.detail.statDeclined"),
      value: r.skip_count,
      sub: t("alertCalibration.detail.statDeclinedSub"),
      icon: "block",
    },
    {
      key: "window",
      label: t("alertCalibration.detail.statWindow"),
      value: formatMinutes(t, windowMinutes),
      icon: "calendar-month",
    },
  ];
});

const noneFoundReason = computed<I18nText>(() => {
  const r = run.value;
  if (!r) return raw("");
  const reasons: I18nText[] = [];
  if (r.coverage_gap) reasons.push(t("alertCalibration.detail.noneFoundGap"));
  if (r.skip_count > 0) {
    reasons.push(
      t("alertCalibration.detail.noneFoundDeclined", { count: r.skip_count }, r.skip_count),
    );
  }
  reasons.push(t("alertCalibration.detail.noneFoundNotClearance"));
  return raw(reasons.join(" "));
});

/** Opens Logs on the same records this page reads, from the run's end to now. */
function viewInLogs() {
  router.push({
    path: "/logs",
    query: {
      org_identifier: orgId.value,
      stream: DIGEST_STREAM,
      stream_type: "logs",
      from: String(windowEnd.value),
      to: String(Date.now() * 1000),
      refresh: "0",
      sql_mode: "true",
      query: b64EncodeUnicode(runRecordsSql(windowStart.value, windowEnd.value)),
      type: "logs",
    },
  });
}

watch([windowStart, windowEnd], () => {
  ruleFilter.value = "all";
  void records.load();
});
onMounted(() => void records.load());
</script>
