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

    <!-- Dismissals outlive runs and the config, so they stay reachable when there is no board. -->
    <div
      v-else-if="data.error.value || !config?.enabled || !latest"
      class="flex flex-col gap-3"
      data-test="alert-calibration-dashboard-no-board"
    >
      <div v-if="dismissedReachable" class="flex justify-end">
        <AlertCalibrationFindingsFilter
          :model-value="view"
          :dismissed-label="dismissedLabel"
          @update:model-value="onView"
        />
      </div>

      <template v-if="view === 'dismissed'">
        <DecisionsDismissedList v-if="decisionRoute.transport.value === 'decision'" />
        <AlertCalibrationDismissedList v-else-if="decisionRoute.transport.value !== 'pending'" />
      </template>

      <LiveNoticeState
        v-else-if="forbidden || data.error.value"
        size="block"
        :notice="boardNotice"
        :detail="readFailedDetail(data.error.value)"
        :busy="data.loading.value"
        :data-test="
          forbidden ? 'alert-calibration-dashboard-no-access' : 'alert-calibration-dashboard-error'
        "
        retry-test="alert-calibration-dashboard-retry"
        @retry="refresh"
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
        v-else
        size="hero"
        illustration="history"
        :title="t('alertCalibration.dashboard.emptyTitle', { days: RUNS_LOOKBACK_DAYS })"
        :description="t('alertCalibration.dashboard.emptyDescription')"
        hide-action
        data-test="alert-calibration-dashboard-empty"
      />
    </div>

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
            <!-- A linked finding's state takes the caption's line, so nothing below moves. -->
            <OText
              v-if="view === 'open' && focusGoneText"
              variant="meta"
              as="p"
              data-test="alert-calibration-dashboard-finding-gone"
              >{{ focusGoneText }}</OText
            >
            <OText v-else variant="meta" as="p">{{
              t("alertCalibration.dashboard.attentionCaption")
            }}</OText>
            <OText variant="meta" as="p" data-test="alert-calibration-dashboard-latest-age">
              {{
                t("alertCalibration.dashboard.latestRunAgo", {
                  time: formatAgo(latest.emitted_at),
                })
              }}
            </OText>
          </div>
          <AlertCalibrationFindingsFilter
            :model-value="view"
            :dismissed-label="dismissedLabel"
            @update:model-value="onView"
          />
        </div>

        <template v-if="view === 'dismissed'">
          <DecisionsDismissedList v-if="decisionRoute.transport.value === 'decision'" />
          <AlertCalibrationDismissedList v-else-if="decisionRoute.transport.value !== 'pending'" />
        </template>

        <OBanner
          v-if="view === 'open' && dismissals.unknown.value"
          variant="error"
          icon="error"
          inline-actions
          data-test="alert-calibration-dashboard-states-unknown"
        >
          {{ t("alertCalibration.dismiss.statesUnknown") }}
          <template #actions>
            <OButton
              variant="outline"
              size="sm"
              data-test="alert-calibration-dashboard-states-retry"
              @click="dismissals.query.refetch()"
            >
              {{ t("alertCalibration.retry") }}
            </OButton>
          </template>
        </OBanner>

        <OBanner
          v-if="view === 'open' && countsPending"
          variant="warning"
          data-test="alert-calibration-dashboard-counts-pending"
        >
          {{ visibilityCopy(t, latest).pending.banner }}
        </OBanner>
        <OBanner
          v-else-if="view === 'open' && allDismissed"
          variant="default"
          icon="info"
          data-test="alert-calibration-dashboard-all-dismissed"
        >
          {{ copy.allOpenDismissed(hiddenTotal) }}
        </OBanner>
        <OBanner
          v-else-if="view === 'open' && latest.finding_count === 0"
          :variant="isScoped(latest) ? 'info' : 'success'"
          :icon="isScoped(latest) ? 'info' : 'check-circle'"
        >
          {{ visibilityCopy(t, latest).allClear }}
        </OBanner>

        <OCard
          v-for="group in shownGroups"
          :key="group.rule_id"
          variant="glass"
          :data-test="`alert-calibration-dashboard-rule-${group.rule_id}`"
        >
          <OCollapsible
            :icon="RULE_META[group.rule_id].icon"
            trigger-class="px-4 py-3"
            :default-open="group.findings.some((f) => isFocused(f))"
          >
            <template #trigger>
              <span class="text-text-heading min-w-0 flex-1 truncate text-sm font-medium">
                {{ t(ruleLabelKey(group.rule_id, version)) }}
              </span>
              <OBadge
                v-if="group.severity"
                :variant="SEVERITY_BADGE[group.severity]"
                size="sm"
                shape="rounded"
              >
                {{ t(SEVERITY_LABEL[group.severity]) }}
              </OBadge>
              <OBadge
                v-if="group.pending"
                variant="warning-soft"
                size="sm"
                shape="rounded"
                data-test="alert-calibration-dashboard-group-pending"
              >
                {{ visibilityCopy(t, latest).pending.badge }}
              </OBadge>
              <OBadge
                v-else-if="!RULE_META[group.rule_id].clusterWide"
                :variant="group.findings.length ? 'default-soft' : 'default-outline'"
                size="sm"
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
            <OText
              v-else-if="!group.findings.length && group.dismissedAlerts"
              variant="meta"
              as="p"
              class="px-4 pb-3"
              data-test="alert-calibration-dashboard-rule-all-dismissed"
            >
              {{ copy.ruleAllDismissed(group.dismissedAlerts) }}
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
                  :class="{ 'ring-accent ring-2 ring-inset': isFocused(finding) }"
                  :data-focused="isFocused(finding) || undefined"
                  :data-test="`alert-calibration-dashboard-alert-${finding.alert_id}`"
                >
                  <OBadge :variant="SEVERITY_BADGE[finding.severity]" size="sm" shape="rounded">
                    {{ t(SEVERITY_LABEL[finding.severity]) }}
                  </OBadge>
                  <div class="flex min-w-0 flex-1 basis-56 flex-wrap items-baseline gap-x-2">
                    <OText variant="body-strong" as="span">{{ finding.alert_name }}</OText>
                    <OText
                      variant="meta"
                      as="span"
                      class="min-w-0"
                      data-test="alert-calibration-dashboard-alert-line"
                      >{{ lineOf(finding) }}</OText
                    >
                  </div>
                  <template v-if="appliedOf(finding)">
                    <OBadge
                      variant="default-soft"
                      size="sm"
                      shape="rounded"
                      data-test="alert-calibration-dashboard-applied"
                    >
                      {{ t("alertCalibration.dashboard.applied") }}
                    </OBadge>
                    <OButton
                      variant="outline"
                      size="xs"
                      :loading="decisionRoute.isUndoing(appliedOf(finding)!.decision_id)"
                      data-test="alert-calibration-dashboard-undo-apply"
                      @click="undoApply(finding)"
                    >
                      {{ insightCtaLabel(t, "undo") }}
                    </OButton>
                  </template>
                  <OButton
                    v-else-if="changeOf(finding)"
                    variant="outline"
                    size="xs"
                    data-test="alert-calibration-dashboard-review-change"
                    @click="reviewChange(finding)"
                  >
                    {{ insightCtaLabel(t, "reviewChange") }}
                  </OButton>
                  <OButton
                    v-if="ctasOf(finding).review"
                    variant="outline"
                    size="xs"
                    :loading="reviewing === finding.finding_id"
                    data-test="alert-calibration-dashboard-review-alert"
                    @click="review(finding)"
                  >
                    {{ insightCtaLabel(t, "reviewAlert") }}
                  </OButton>
                  <OButton
                    v-if="finding.alert_id"
                    variant="ghost-primary"
                    size="xs"
                    data-test="alert-calibration-dashboard-open-alert"
                    @click="openAlert(finding)"
                  >
                    {{ insightCtaLabel(t, "openAlert") }}
                  </OButton>
                  <OButton
                    v-if="ctasOf(finding).logs"
                    variant="ghost-primary"
                    size="xs"
                    data-test="alert-calibration-dashboard-logs"
                    @click="openLogs(finding)"
                  >
                    {{ insightCtaLabel(t, "openInLogs") }}
                  </OButton>
                  <OButton
                    v-if="canAsk && ctasOf(finding).ai"
                    variant="ghost-primary"
                    size="xs"
                    data-test="alert-calibration-dashboard-ask-ai"
                    @click="ask(finding)"
                  >
                    {{ insightCtaLabel(t, "askAi") }}
                  </OButton>
                  <OButton
                    v-if="isDismissable(finding)"
                    variant="ghost-muted"
                    size="xs"
                    data-test="alert-calibration-dashboard-dismiss"
                    @click="openDismiss(finding)"
                  >
                    {{ copy.button() }}
                  </OButton>
                </li>
              </ul>
              <div class="border-border-default flex justify-end border-t px-3 py-1.5">
                <OButton
                  variant="ghost-primary"
                  size="xs"
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

    <ReviewChangeDialog v-if="changeTarget" v-model:open="changeOpen" :target="changeTarget" />
    <AlertCalibrationDismissDialog
      v-if="dismissTarget"
      :key="dismissTarget.finding_id"
      v-model:open="dismissOpen"
      :finding="dismissTarget"
      :refresh="data.load"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
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
import { httpStatus } from "@/services/alert_calibration";
import { alertCalibrationConfigQuery } from "@/services/alert_calibration.queries";
import { useLeaveIfAlertCalibrationOff } from "@/composables/alertCalibration/useAlertCalibrationEnabled";
import { useActiveDismissals } from "@/composables/alertCalibration/useDismissals";
import AlertCalibrationTabs from "./AlertCalibrationTabs.vue";
import AlertCalibrationActions from "./AlertCalibrationActions.vue";
import AlertCalibrationLastRun from "./AlertCalibrationLastRun.vue";
import AlertCalibrationDismissDialog from "./AlertCalibrationDismissDialog.vue";
import AlertCalibrationDismissedList from "./AlertCalibrationDismissedList.vue";
import DecisionsDismissedList from "@/components/autoobserve/decisions/DecisionsDismissedList.vue";
import {
  appliedDecisionsQuery,
  dismissedDecisionsQuery,
  useDecisionRoute,
} from "@/composables/autoobserve/useDecisionRoute";
import ReviewChangeDialog from "@/components/autoobserve/decisions/ReviewChangeDialog.vue";
import type { ReviewChangeTarget } from "@/components/autoobserve/decisions/appliedChanges";
import { applyCopy, applySuggestionsOf } from "./applySuggestion";
import AlertCalibrationFindingsFilter from "./AlertCalibrationFindingsFilter.vue";
import {
  dismissalCopy,
  dismissedSinceRun,
  hiddenByRun,
  isDismissable,
  openCount,
  openFindings,
  type DismissableFinding,
} from "./dismissals";
import { useDigestSearch, useLatestRead } from "./useDigestSearch";
import { readFailedDetail, readNotice } from "./notices";
import LiveNoticeState from "@/components/autoobserve/live/LiveNoticeState.vue";
import {
  countOrDash,
  coverageNoteRows,
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
import { coverageBadge, SEVERITY_BADGE, SEVERITY_LABEL } from "./format";
import { RULE_META, ruleLabelKey, rulesShownFor } from "./rules";
import { openAlertReview } from "./reviewAlert";
import { rowCtas, type RowCtas } from "./rowCtas";
import {
  aiEnabled,
  askAiPayload,
  insightCtaLabel,
  type InsightAskPayload,
} from "@/components/autoobserve/insight/insightCta";

const emit = defineEmits<{ sendToAiChat: [payload: InsightAskPayload] }>();
const { t, locale } = useI18nTyped();
useLeaveIfAlertCalibrationOff("alertList");
const router = useRouter();
const store = useStore();
const route = useRoute();
const { search, orgId } = useDigestSearch();
const copy = computed(() => dismissalCopy(t, locale.value));
const dismissals = useActiveDismissals({ reportRefetchFailure: true, freshOnMount: true });
const decisionRoute = useDecisionRoute();

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

/** Both reads settle before the first paint, so a finding never shows open and then folds (P5a-D3). */
const loading = computed(
  () =>
    configQuery.isPending.value ||
    (data.loading.value && !data.data.value) ||
    !dismissals.settled.value,
);
const latest = computed(() => data.data.value?.latest ?? null);
const boardNotice = computed(() =>
  readNotice(
    t,
    forbidden.value ? { response: { status: 403 } } : data.error.value,
    t("alertCalibration.dashboard.loadFailedTitle"),
  ),
);
/** A 403 is a missing permission, not a failure, so it gets no Retry. */
const forbidden = computed(
  () => httpStatus(data.error.value) === 403 || httpStatus(configQuery.error.value) === 403,
);
const version = computed(() => latest.value?.schema_version ?? 1);
/** The list and the records read can reach nodes of different cache freshness, so either one's unknown count makes the board unknown. */
const countsPending = computed(
  () => !!data.data.value?.listPending || !!data.data.value?.recordsPending,
);
/** Folding follows the list query only, never a mutation in flight (no optimistic hide). */
const open = computed(() => openFindings(data.data.value?.findings ?? [], dismissals.active.value));
const hiddenSinceRun = computed(() =>
  dismissedSinceRun(data.data.value?.findings ?? [], dismissals.active.value),
);
const openTotal = computed(() =>
  latest.value
    ? openCount(latest.value, data.data.value?.findings ?? [], dismissals.active.value)
    : null,
);
/** A run after the dismissals has no records for them, so its own count of what it left out joins the later ones. */
const hiddenTotal = computed(
  () =>
    hiddenSinceRun.value +
    (latest.value ? hiddenByRun(latest.value, dismissals.query.data.value) : 0),
);
const allDismissed = computed(() => openTotal.value === 0 && hiddenTotal.value > 0);

const appliedRead = useQuery(() => ({
  ...appliedDecisionsQuery(orgId.value),
  enabled: decisionRoute.transport.value === "decision",
}));
/** The applies still in force, by finding: the run's words describe the alert before the change. */
const appliedById = computed(
  () =>
    new Map(
      (appliedRead.data.value ?? [])
        .filter((view) => view.state === "applied")
        .map((view) => [view.id, view] as const),
    ),
);
const appliedOf = (finding: FindingRecord) =>
  finding.finding_id ? (appliedById.value.get(finding.finding_id) ?? null) : null;
const applyText = computed(() => applyCopy(t, locale.value));
/** An applied row says what changed; the run's sentence still describes the alert before it. */
const lineOf = (finding: FindingRecord) => {
  const fields = appliedOf(finding)?.change?.fields;
  const lines = fields ? applyText.value.appliedLines(fields) : [];
  return lines.length ? raw(lines.join(" · ")) : titleAfterName(finding);
};
// The records read offers a destination change only while the alert has none, so an apply or its undo re-reads them.
watch(
  () => (appliedRead.data.value ? [...appliedById.value.keys()].sort().join() : null),
  (now, before) => {
    if (now !== null && before != null && now !== before) void data.load();
  },
);
const undoApply = (finding: FindingRecord) => {
  const view = appliedOf(finding);
  if (view)
    void decisionRoute.undo([{ org: orgId.value, view, title: finding.alert_name ?? null }]);
};

const decisionDismissed = useQuery(() => ({
  ...dismissedDecisionsQuery(orgId.value, null),
  enabled: decisionRoute.transport.value === "decision",
}));
/** The total of the list the Dismissed view shows, kept apart from the run's counts (P5a-Q4). */
const dismissedTotal = computed<number | null>(() => {
  if (decisionRoute.transport.value === "decision") {
    return decisionDismissed.data.value?.total ?? null;
  }
  return dismissals.unknown.value ? null : (dismissals.query.data.value?.total ?? 0);
});
const dismissedLabel = computed(() => copy.value.filterDismissed(dismissedTotal.value));
const view = computed(() => (route.query.findings === "dismissed" ? "dismissed" : "open"));
// A reader the page refuses is not offered the Dismissed view beside the refusal.
const dismissedReachable = computed(
  () => !forbidden.value && (view.value === "dismissed" || (dismissedTotal.value ?? 0) > 0),
);
const onView = (value: unknown) => {
  if (!value || value === view.value) return;
  const query = { ...route.query };
  if (value === "dismissed") query.findings = "dismissed";
  else delete query.findings;
  void router.replace({ query });
};

/** A Slack link names one finding; the board opens its group and marks its row. */
const focusId = computed(() =>
  typeof route.query.finding === "string" ? route.query.finding : null,
);
const isFocused = (finding: FindingRecord) =>
  !!focusId.value && finding.finding_id === focusId.value;
const focusGone = computed(
  () => !!focusId.value && !!data.data.value && !open.value.some((f) => isFocused(f)),
);
/** Why a linked finding is not on the board: dismissed, so its Undo is under Dismissed, or outside what this reader sees. */
const focusGoneText = computed(() => {
  if (!focusGone.value) return null;
  const id = focusId.value;
  const dismissed =
    (data.data.value?.findings ?? []).some((f) => f.finding_id === id) ||
    (decisionDismissed.data.value?.decisions ?? []).some((v) => v.id === id);
  if (dismissed) return t("alertCalibration.dashboard.findingDismissed");
  return latest.value && isScoped(latest.value)
    ? t("alertCalibration.dashboard.findingGoneScoped")
    : t("alertCalibration.dashboard.findingGone");
});
watch(
  () => !loading.value && open.value.some((f) => isFocused(f)),
  async (found) => {
    if (!found) return;
    await nextTick();
    document
      .querySelector('[data-focused="true"]')
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  },
  { immediate: true },
);

const dismissTarget = shallowRef<DismissableFinding | null>(null);
const dismissOpen = ref(false);
const changeTarget = shallowRef<ReviewChangeTarget | null>(null);
const changeOpen = ref(false);

// Only a finding with an id can be applied through the decision route, which keys it by finding.
const changeOf = (finding: DigestRecord) =>
  finding.finding_id && finding.alert_id ? (applySuggestionsOf(finding)[0] ?? null) : null;

const reviewChange = (finding: DigestRecord) => {
  const action = changeOf(finding);
  if (!action) return;
  changeTarget.value = {
    findingId: finding.finding_id!,
    alertId: finding.alert_id!,
    alertName: finding.alert_name ?? finding.alert_id!,
    action,
  };
  changeOpen.value = true;
};
const openDismiss = (finding: DismissableFinding) => {
  dismissTarget.value = finding;
  dismissOpen.value = true;
};

/** A scoped reader never gets the cluster rows, so a cluster rule would claim a clear it cannot see. */
const groups = computed(() => {
  const scoped = !!latest.value && isScoped(latest.value);
  const rules = rulesShownFor(orgId.value, version.value).filter(
    (rule) => !(scoped && RULE_META[rule].clusterWide),
  );
  const all = data.data.value?.findings ?? [];
  const hidden = all.filter((f) => !open.value.includes(f));
  // An empty rule on a run whose counts are unknown has not been shown clear, only not yet read.
  return findingsByRule(rules, open.value).map((group) => ({
    ...group,
    pending: countsPending.value && !group.findings.length,
    dismissedAlerts: alertCount(hidden.filter((f) => f.rule_id === group.rule_id)),
  }));
});
/** The Dismissed view replaces the groups, so none render under it. */
const shownGroups = computed(() => (view.value === "open" ? groups.value : []));
/** One alert can hold two findings of a rule, such as its errors and its missing source. */
const alertCount = (findings: FindingRecord[]) =>
  new Set(findings.map((f) => f.alert_id ?? f.alert_name)).size;

const latestStats = computed<StatItem[]>(() => {
  const run = latest.value;
  if (!run) return [];
  const verdict = coverageBadge(run);
  const scope = visibilityCopy(t, run).alertsInScope;
  return [
    {
      key: "findings",
      label: t("alertCalibration.dashboard.openFindings"),
      value: countsPending.value ? raw("—") : countOrDash(openTotal.value, locale.value),
      icon: "fact-check",
      tone: countsPending.value
        ? "neutral"
        : (openTotal.value ?? 0) > 0
          ? "warning"
          : isScoped(run) || allDismissed.value
            ? "neutral"
            : "success",
    },
    {
      key: "scope",
      label: t("alertCalibration.dashboard.alertsInScope"),
      value: countOrDash(scope.count, locale.value),
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

// Parsed once per read, not per button per render: a rule can list many rows.
const ctas = computed(
  () =>
    new Map(
      (data.data.value?.findings ?? []).map((f) => [f, rowCtas(t, f, Date.now() * 1000)] as const),
    ),
);
const ctasOf = (finding: FindingRecord): RowCtas =>
  ctas.value.get(finding) ?? rowCtas(t, finding, Date.now() * 1000);
const canAsk = computed(() => aiEnabled(store.state.zoConfig));
const reviewing = ref<string | null>(null);

const review = async (finding: FindingRecord) => {
  const action = ctasOf(finding).review;
  if (!action || reviewing.value !== null) return;
  reviewing.value = finding.finding_id ?? "";
  await openAlertReview(router, orgId.value, action, finding);
  reviewing.value = null;
};

const openLogs = (finding: FindingRecord) => {
  const target = ctasOf(finding).logs;
  if (target) void router.push(target);
};

const ask = (finding: FindingRecord) => {
  const ai = ctasOf(finding).ai;
  if (ai) emit("sendToAiChat", askAiPayload(t, ai, orgId.value));
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
  void dismissals.query.refetch();
  if (decisionRoute.transport.value === "decision") {
    void decisionDismissed.refetch();
    void appliedRead.refetch();
  }
}

onMounted(() => void data.load());
</script>
