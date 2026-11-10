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
    <div
      v-if="(records.loading.value && !run) || !dismissals.settled.value"
      class="flex flex-col gap-3"
    >
      <OSkeleton class="rounded-default h-16 w-full" />
      <OSkeleton class="rounded-default h-40 w-full" />
    </div>

    <LiveNoticeState
      v-else-if="loadError"
      size="block"
      :notice="{
        ...readNotice(
          t,
          records.error.value,
          t('alertCalibration.detail.unavailableTitle'),
          loadError,
        ),
        retry: false,
      }"
      :action="t('alertCalibration.detail.backToDigests')"
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
          <span class="text-sm font-medium">{{ t(partialTitleKey) }}</span>
          <span v-if="!measuredNothing" class="text-xs">{{
            t("alertCalibration.detail.partialCoverageDesc")
          }}</span>
          <span v-for="note in notes" :key="note" class="text-xs">{{ note }}</span>
        </div>
      </OBanner>

      <OStatStrip :items="stats" data-test="alert-calibration-digest-stats" />

      <OText v-if="!run.coverage_gap && notes.length" variant="meta" as="div">
        <span v-for="note in notes" :key="note" class="block">{{ note }}</span>
      </OText>

      <div v-if="hasFindings" class="flex flex-col gap-3">
        <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div class="flex min-w-0 flex-col gap-0.5">
            <OText variant="card-title" as="h2">{{
              t("alertCalibration.detail.findingsHeading")
            }}</OText>
            <OText variant="meta" as="p">{{ t("alertCalibration.detail.suggestionsOnly") }}</OText>
          </div>
          <OToggleGroup
            :model-value="ruleFilter"
            mobile-dropdown
            data-test="alert-calibration-digest-rule-filter"
            @update:model-value="onRuleFilter"
          >
            <OToggleGroupItem value="all" size="xs">{{
              t("alertCalibration.detail.filterAll")
            }}</OToggleGroupItem>
            <OToggleGroupItem
              v-for="rule in rulesOfVersion(version)"
              :key="rule"
              :value="rule"
              size="xs"
              :disabled="!presentRules.includes(rule)"
            >
              {{ t(ruleLabelKey(rule, version)) }}
            </OToggleGroupItem>
          </OToggleGroup>
        </div>
        <OText
          v-if="hitCount === SEARCH_SIZE"
          variant="meta"
          as="div"
          data-test="alert-calibration-digest-findings-capped"
        >
          <!-- OText's meta colour wins over a class on it, so the amber sits on the text. -->
          <span class="text-status-warning-text">{{ cappedNotice }}</span>
        </OText>
        <OText
          v-else-if="run.finding_count !== null && findings.length !== run.finding_count"
          variant="meta"
          as="div"
        >
          {{ t("alertCalibration.detail.perSubjectNote") }}
        </OText>
        <div class="flex flex-col gap-3">
          <OBanner
            v-if="dismissals.unknown.value"
            variant="error"
            icon="error"
            inline-actions
            data-test="alert-calibration-digest-states-unknown"
          >
            {{ t("alertCalibration.dismiss.statesUnknown") }}
            <template #actions>
              <OButton
                variant="outline"
                size="sm"
                data-test="alert-calibration-digest-states-retry"
                @click="dismissals.query.refetch()"
              >
                {{ t("alertCalibration.retry") }}
              </OButton>
            </template>
          </OBanner>
          <AlertCalibrationFindingCard
            v-for="finding in visibleFindings"
            :key="finding.finding_id ?? `${finding.rule_id}:${finding.alert_id}`"
            :finding="finding"
            :dismissal="finding.finding_id ? dismissals.byId.value.get(finding.finding_id) : null"
            :refresh="records.load"
          />
        </div>
      </div>

      <OBanner
        v-else-if="run.finding_count === null"
        variant="warning"
        data-test="alert-calibration-digest-counts-pending"
      >
        {{ visibilityCopy(t, run).pending.banner }}
      </OBanner>

      <OEmptyState
        v-else-if="isQuiet(run)"
        size="block"
        :illustration="isScoped(run) ? 'radar' : 'check'"
        :title="t('alertCalibration.detail.nothingTitle')"
        :description="visibilityCopy(t, run).nothingDescription"
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

      <AlertCalibrationSkipGroup
        title-key="alertCalibration.notChecked.title"
        why-key="alertCalibration.notChecked.why"
        :rows="notCheckedRows"
        :next-for="notCheckedNext"
        :cta-for="reviewQueryCta"
      />

      <div
        v-if="flatSkips.length || (skips.length && (skipsCapped || omittedRoutine > 0))"
        class="flex flex-col gap-2"
        data-test="alert-calibration-digest-skips"
      >
        <div class="flex min-w-0 flex-col gap-0.5">
          <OText variant="card-title" as="h2">{{
            t("alertCalibration.detail.declinedHeading")
          }}</OText>
          <OText variant="meta" as="p">{{ t("alertCalibration.detail.declinedDesc") }}</OText>
        </div>
        <OText
          v-if="skipsCapped"
          variant="meta"
          as="div"
          data-test="alert-calibration-digest-skips-capped"
        >
          <span class="text-status-warning-text">{{
            t("alertCalibration.detail.showingSkipsCapped", {
              shown: skips.length,
              total: writtenSkips,
              count: SEARCH_SIZE,
            })
          }}</span>
        </OText>
        <OCard v-if="flatSkips.length" variant="glass">
          <OCardSection role="body" class="flex flex-col gap-1.5 py-2">
            <div
              v-for="{ skip, detail } in skipRows"
              :key="skipKey(skip)"
              class="flex min-w-0 flex-wrap items-baseline gap-x-2"
              data-test="alert-calibration-digest-skip"
            >
              <OBadge variant="default-outline" size="sm" shape="rounded">{{
                ruleLabel(skip.rule_id)
              }}</OBadge>
              <span class="text-text-body text-xs font-medium">{{
                skip.alert_name ?? skip.alert_id
              }}</span>
              <OText variant="meta" as="span">{{ skipReasonLabel(t, skip.skip_reason) }}</OText>
              <OText
                v-if="detail"
                variant="meta"
                as="span"
                data-test="alert-calibration-digest-skip-detail"
                >{{ detail }}</OText
              >
            </div>
          </OCardSection>
        </OCard>
        <OText v-if="omittedRoutine > 0" variant="meta" as="div">
          {{
            t("alertCalibration.detail.declinedCounted", { count: omittedRoutine }, omittedRoutine)
          }}
        </OText>
      </div>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { format, formatDistanceToNowStrict } from "date-fns";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import { useLeaveIfAlertCalibrationOff } from "@/composables/alertCalibration/useAlertCalibrationEnabled";
import { useActiveDismissals } from "@/composables/alertCalibration/useDismissals";
import { raw, useI18nTyped, type I18nText, type I18nKey } from "@/types/i18n";
import analytics from "@/services/product_analytics";
import { readErrorCopy } from "@/services/alert_calibration";
import LiveNoticeState from "@/components/autoobserve/live/LiveNoticeState.vue";
import { readNotice } from "./notices";
import { writeAlertEditHandoff } from "@/utils/alerts/alertPrefillStorage";
import AlertCalibrationFindingCard from "./AlertCalibrationFindingCard.vue";
import AlertCalibrationSkipGroup, {
  type SkipGroupCta,
  type SkipGroupRow,
} from "./AlertCalibrationSkipGroup.vue";
import { alertFolderOf, editAlertRoute } from "./alertEditorLink";
import { toEditHandoff, type ReviewAlertAction } from "./applySuggestion";
import { useDigestSearch, useLatestRead } from "./useDigestSearch";
import {
  countOrDash,
  coverageNotes,
  coverageVerdict,
  isQuiet,
  isScoped,
  latestEmission,
  recordHits,
  SEARCH_SIZE,
  visibilityCopy,
  type DigestRecord,
  type RuleId,
  type RunRow,
} from "./digests";
import {
  coverageBadge,
  formatMinutes,
  NOT_CHECKED_CAUSES,
  notCheckedCause,
  notCheckedCopy,
  skipDetailLabel,
  skipReasonLabel,
  type NotCheckedCause,
} from "./format";
import { isRuleId, ruleLabelKey, rulesOfVersion } from "./rules";

const props = defineProps<{ windowStart: string | number; windowEnd: string | number }>();

const { t, locale } = useI18nTyped();
useLeaveIfAlertCalibrationOff("alertList");
const router = useRouter();
const route = useRoute();
const { search, orgId } = useDigestSearch();
const dismissals = useActiveDismissals({ reportRefetchFailure: true, freshOnMount: true });

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
  return { hits: recordHits(hits), ...latestEmission(hits) };
});

const run = computed(() => records.data.value?.run ?? null);
const version = computed(() => run.value?.schema_version ?? 1);
const findings = computed(() => records.data.value?.findings ?? []);
const skips = computed(() => records.data.value?.skips ?? []);
/** Two rules share `failure`, so one alert can carry two skips that differ only in reason. */
const skipKey = (skip: DigestRecord) => `${skip.rule_id}:${skip.alert_id}:${skip.skip_reason}`;
const isNotChecked = (skip: DigestRecord) => skip.skip_reason === "definition_not_checked";
const flatSkips = computed(() => skips.value.filter((skip) => !isNotChecked(skip)));
const skipRows = computed(() =>
  flatSkips.value.map((skip) => ({ skip, detail: skipDetailLabel(t, skip.skip_detail) })),
);
const notChecked = computed(() =>
  skips.value
    .filter(isNotChecked)
    .map((skip) => ({ skip, cause: notCheckedCause(skip.skip_detail) }))
    .sort(
      (a, b) =>
        NOT_CHECKED_CAUSES.indexOf(a.cause) - NOT_CHECKED_CAUSES.indexOf(b.cause) ||
        (a.skip.alert_name ?? "").localeCompare(b.skip.alert_name ?? ""),
    ),
);
const notCheckedByKey = computed(
  () => new Map(notChecked.value.map(({ skip }) => [skipKey(skip), skip])),
);
const notCheckedRows = computed<SkipGroupRow[]>(() =>
  notChecked.value.map(({ skip, cause }) => ({
    key: skipKey(skip),
    group: cause,
    label: raw(skip.alert_name ?? skip.alert_id ?? ""),
    why: notCheckedCopy(t, cause).cause,
  })),
);
const notCheckedNext = (row: SkipGroupRow): I18nText =>
  notCheckedCopy(t, row.group as NotCheckedCause).next;

const reviewing = ref<string | null>(null);
let unmounted = false;
onBeforeUnmount(() => {
  unmounted = true;
});
const reviewQuery = async (key: string) => {
  const skip = notCheckedByKey.value.get(key);
  if (reviewing.value || !skip?.alert_id) return;
  const action: ReviewAlertAction = {
    type: "review_alert",
    alert_id: skip.alert_id,
    focus: "query",
  };
  reviewing.value = key;
  const folder = await alertFolderOf(orgId.value, skip.alert_id, skip.alert_name);
  reviewing.value = null;
  if (unmounted) return;
  writeAlertEditHandoff(toEditHandoff(action, skip));
  void router.push(editAlertRoute(orgId.value, skip.alert_id, folder));
};
const reviewQueryCta = (row: SkipGroupRow): SkipGroupCta => ({
  label: t("insight.cta.reviewAlert"),
  run: () => void reviewQuery(row.key),
  pending: reviewing.value === row.key,
});
/** Floors not met are only counted by a version-2 run; a version-1 run has no split. */
const omittedRoutine = computed(() => run.value?.omitted_routine_skip_count ?? 0);
/** A rule from a newer writer is named generically, never by its stored id. */
const ruleLabel = (rule: string): I18nText =>
  t(isRuleId(rule) ? ruleLabelKey(rule, version.value) : "alertCalibration.rules.other");
const hitCount = computed(() => records.data.value?.hits ?? 0);
/** Returned findings show even when their emission's count did not come back with them. */
const hasFindings = computed(
  () => findings.value.length > 0 || (run.value?.finding_count ?? 0) > 0,
);
const cappedNotice = computed<I18nText>(() => {
  const total = run.value?.finding_count;
  const shown = findings.value.length;
  return total == null
    ? t("alertCalibration.visibility.showingCappedUnread", { shown, count: SEARCH_SIZE })
    : t("alertCalibration.detail.showingCapped", { shown, total, count: SEARCH_SIZE });
});
/** A version-1 run writes no skip records, so it has no written count to fall short of. */
const writtenSkips = computed(() => run.value?.written_skip_count ?? skips.value.length);
const skipsCapped = computed(
  () => hitCount.value === SEARCH_SIZE && skips.value.length < writtenSkips.value,
);

const loadError = computed<I18nText | null>(() => {
  if (records.error.value) {
    return readErrorCopy(t, records.error.value, "run");
  }
  if (records.data.value && !run.value) {
    return t("alertCalibration.detail.noRecords");
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
  if (!value) return;
  ruleFilter.value = value as typeof ruleFilter.value;
  analytics.track("alert_calibration_rule_filtered", { rule: ruleFilter.value });
};

const notes = computed(() => (run.value ? coverageNotes(t, run.value) : []));

/** Measured nothing is not a floor on anything, so the floor sentence would mislead. */
const measuredNothing = computed(() => !!run.value && coverageVerdict(run.value) === "none");
const partialTitleKey = computed<I18nKey>(() =>
  measuredNothing.value
    ? "alertCalibration.coverage.none"
    : "alertCalibration.detail.partialCoverage",
);

const stats = computed<StatItem[]>(() => {
  const r = run.value;
  if (!r) return [];
  const verdict = coverageBadge(r);
  const scope = visibilityCopy(t, r).alertsInScope;
  const windowMinutes = Math.round((r.window_end - r.window_start) / 60_000_000);
  return [
    {
      key: "findings",
      label: t("alertCalibration.detail.statFindings"),
      value: countOrDash(r.finding_count, locale.value),
      sub: t(verdict.labelKey),
      icon: "fact-check",
      tone: hasFindings.value ? "warning" : "neutral",
    },
    {
      key: "scope",
      label: t("alertCalibration.detail.statAlertsInScope"),
      value: countOrDash(scope.count, locale.value),
      sub: scope.sub,
      subIcon: scope.subIcon,
      icon: "notifications",
    },
    {
      key: "declined",
      label: t("alertCalibration.detail.statDeclined"),
      value: countOrDash(r.skip_count, locale.value),
      sub: t("alertCalibration.detail.statDeclinedSub"),
      subTooltip: t("alertCalibration.detail.statDeclinedTooltip"),
      icon: "block",
    },
    ...dismissedStat(r),
    {
      key: "window",
      label: t("alertCalibration.detail.statWindow"),
      value: formatMinutes(t, windowMinutes),
      icon: "calendar-month",
    },
  ];
});

/** A run from before dismissals never wrote the count, so it gets no tile; a scoped reader's is withheld. */
const dismissedStat = (r: RunRow): StatItem[] => {
  if (r.dismissed_count === undefined) return [];
  const hidden = r.dismissed_count === null;
  return [
    {
      key: "dismissed",
      label: t("alertCalibration.dismiss.stat"),
      value: countOrDash(r.dismissed_count, locale.value),
      sub: hidden
        ? t("alertCalibration.visibility.orgTotalHidden")
        : t("alertCalibration.dismiss.statSub"),
      subIcon: hidden ? "info-outline" : undefined,
      icon: "visibility-off",
    },
  ];
};

const noneFoundReason = computed<I18nText>(() => {
  const r = run.value;
  if (!r) return raw("");
  const reasons: I18nText[] = [];
  if (r.coverage_gap) reasons.push(t("alertCalibration.detail.noneFoundGap"));
  const declined = r.skip_count ?? 0;
  if (declined > 0) {
    reasons.push(t("alertCalibration.detail.noneFoundDeclined", { count: declined }, declined));
  }
  reasons.push(t("alertCalibration.detail.noneFoundNotClearance"));
  return raw(reasons.join(" "));
});

watch([windowStart, windowEnd], () => {
  ruleFilter.value = "all";
  void records.load();
});
onMounted(() => void records.load());
</script>
