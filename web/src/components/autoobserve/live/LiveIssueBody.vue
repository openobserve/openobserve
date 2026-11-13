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
  <div class="flex h-full min-h-0 flex-col" data-test="autoobserve-live-issue">
    <OTabs v-model="tab" bordered class="shrink-0" data-test="autoobserve-issue-tabs">
      <OTab
        name="overview"
        :autofocus="tab === 'overview'"
        :label="t('alerts.insights.tabs.overview')"
        data-test="autoobserve-issue-tab-overview"
      />
      <OTab
        name="analysis"
        :autofocus="tab === 'analysis'"
        :label="t('alerts.incidents.incidentAnalysis')"
        data-test="autoobserve-issue-tab-analysis"
      />
      <OTab
        name="graph"
        :autofocus="tab === 'graph'"
        :label="t('autoobserve.drawer.unfoldTab')"
        data-test="autoobserve-issue-tab-graph"
      />
      <OTab name="firings" :autofocus="tab === 'firings'" data-test="autoobserve-issue-tab-firings">
        <div class="flex items-center gap-1.5">
          <span>{{ t("alerts.incidents.alertTriggers") }}</span>
          <!-- The badge holds its place while the incident loads, so the tabs after it never move. -->
          <OTag type="countChip" value="neutral" :class="{ invisible: !detail }">{{
            triggers.length
          }}</OTag>
        </div>
      </OTab>
      <OTab
        name="activity"
        :autofocus="tab === 'activity'"
        :label="t('alerts.incidents.activityTab')"
        data-test="autoobserve-issue-tab-activity"
      />
      <OTab
        v-if="logsRoute"
        name="logs"
        :autofocus="tab === 'logs'"
        :label="t('autoobserve.issueLive.logsTab')"
        data-test="autoobserve-issue-tab-logs"
      />
    </OTabs>

    <LiveIssueOverview
      v-if="tab === 'overview'"
      :item="item"
      :streams="streams"
      :why="why"
      :next="next"
      :headline="headline"
      :cause-note="causeNote"
      :band="band"
      :band-reason="bandReason"
      :timeline="timeline"
      :events-failed="eventsQuery.isError.value"
      :now-ms="now"
      @see-evidence="tab = 'analysis'"
      @open-activity="tab = 'activity'"
    />
    <AutoObserveAnalysis
      v-else-if="tab === 'analysis'"
      :issue="subject"
      :report="rca.reportText.value || null"
      :confidence-reason="bandReason"
      :comparison-status="comparisonStatus"
      :comparison-metric="t('autoobserve.issueLive.compare.metric')"
      :comparison-more="comparisonMore"
      :comparison-note="comparisonNote"
      :comparison-missing="comparisonMissing"
      :comparison-can-retry="comparisonCanRetry"
      :comparison-slots="compared.length * 2"
      :unscored-reason="t('autoobserve.issueLive.confidence.unscored')"
      :legend-labels="legendLabels"
      :resolved="item.incident.status === 'resolved'"
      @open-unfold="openUnfold"
      @retry-comparison="retryComparison"
    >
      <template #verdict-actions>
        <div
          v-if="!detail?.rca"
          class="flex flex-wrap items-center gap-2"
          data-test="autoobserve-issue-analyze"
        >
          <OButton
            variant="primary"
            size="sm"
            :icon-left="canStart ? 'auto-awesome' : 'lock'"
            :disabled="!canStart || !detail"
            :loading="rca.triggering.value"
            data-test="autoobserve-issue-analyze-btn"
            @click="rca.trigger({ buildOnPrevious: false })"
          >
            {{ t("alerts.incidents.rcaAnalyzeIncident") }}
          </OButton>
          <span
            v-if="lockedReason"
            class="text-text-secondary text-xs"
            data-test="autoobserve-issue-analyze-reason"
            >{{ lockedReason }}</span
          >
        </div>
        <OBadge
          v-else-if="runLine && runLine.label !== completedLabel"
          :variant="RCA_BADGE_VARIANT[runLine.tone]"
          size="sm"
          class="self-start"
          data-test="autoobserve-issue-run-state"
        >
          <template v-if="runLine.spinner" #icon><OSpinner size="xs" /></template>
          {{ runLine.label }}
        </OBadge>
      </template>
      <template #report>
        <RcaReportContent :html="reportHtml" :is-dark-mode="isDark" />
      </template>
    </AutoObserveAnalysis>
    <AutoObserveUnfoldGraph
      v-else-if="tab === 'graph'"
      :cards="cards"
      :focus-id="unfoldFocus"
      :note="unfoldNote"
      :hint="unfoldHint"
      live-issue
    >
      <template #chart="{ card }">
        <IssueSignal
          :stream="unfoldCardStream(card, streams)"
          :anchor-us="item.finding.first_seen_at"
          :end-us="issueEndUs(item)"
          :active="item.incident.status !== 'resolved'"
          size="card"
          data-test="autoobserve-unfold-signal"
        />
      </template>
    </AutoObserveUnfoldGraph>
    <div
      v-else-if="tab === 'firings'"
      class="flex min-h-0 flex-1 gap-4 overflow-hidden p-4 max-lg:flex-col"
      data-test="autoobserve-issue-triggers"
    >
      <!-- Loading and failed states keep the table and panel frames, so the table lands without a jump. -->
      <template v-if="!detail">
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <p class="mb-2 min-h-4 text-xs" />
          <div
            class="border-card-glass-border rounded-default flex min-h-40 flex-col gap-3 border p-3"
          >
            <div
              v-if="detailQuery.isError.value"
              role="alert"
              class="text-status-error-text flex items-center gap-2 text-sm"
              data-test="autoobserve-issue-triggers-error"
            >
              <OIcon name="error-outline" size="sm" />
              {{ t("autoobserve.issueLive.triggersFailed") }}
              <OButton variant="ghost-primary" size="xs" @click="detailQuery.refetch()">{{
                t("autoobserve.issueLive.spark.retry")
              }}</OButton>
            </div>
            <template v-else>
              <OSkeleton
                animation="pulse"
                class="h-5 w-full"
                data-test="autoobserve-issue-triggers-loading"
              />
              <OSkeleton v-for="i in 3" :key="i" animation="pulse" class="h-6 w-full" />
            </template>
          </div>
        </div>
        <div
          v-if="!detailQuery.isError.value"
          class="border-card-glass-border rounded-default flex min-h-40 w-80 shrink-0 flex-col gap-2 self-start border p-3 max-lg:w-full"
        >
          <OSkeleton animation="pulse" class="h-4 w-1/3" />
          <OSkeleton animation="pulse" class="h-5 w-2/3" />
          <OSkeleton animation="pulse" class="h-4 w-1/2" />
        </div>
      </template>
      <template v-else>
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <p class="text-text-secondary mb-2 text-xs" data-test="autoobserve-issue-triggers-note">
            {{
              t("autoobserve.issueLive.triggersCount", { count: triggers.length }, triggers.length)
            }}
          </p>
          <div
            class="border-card-glass-border rounded-default flex min-h-0 flex-1 flex-col overflow-hidden border"
          >
            <IncidentAlertTriggersTable
              :triggers="triggers"
              :is-dark-mode="isDark"
              table-id="autoobserve-issue-triggers"
              hide-empty-columns
              :format-time="triggerTime"
              :reason-label="triggerReason"
            />
          </div>
        </div>
        <div
          class="border-card-glass-border rounded-default w-80 shrink-0 self-start border p-3 max-lg:w-full"
        >
          <IncidentFindingDetails
            :facts="facts"
            :format-time="triggerTime"
            :note="t('autoobserve.issueLive.triggersNote')"
          />
        </div>
      </template>
    </div>
    <div v-else-if="tab === 'activity'" class="flex min-h-0 flex-1 flex-col p-4">
      <IncidentTimeline
        :org-id="org"
        :incident-id="item.incident.id"
        :visible="tab === 'activity'"
        :actor-label="(id: string) => String(actorName(t, id))"
        :format-time="triggerTime"
        plain-names
      />
    </div>
    <IssueLogsLink
      v-else-if="tab === 'logs' && logsRoute"
      :route="logsRoute"
      :streams="logStreams"
      :ended="logsEndUs !== null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { useNow } from "@/composables/useNow";
import { useTheme } from "@/composables/useTheme";
import { useLicenseLock } from "@/composables/useFeatureLock";
import { useIncidentRca } from "@/composables/useIncidentRca";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import IncidentAlertTriggersTable from "@/components/alerts/IncidentAlertTriggersTable.vue";
import IncidentFindingDetails from "@/components/alerts/IncidentFindingDetails.vue";
import IncidentTimeline from "@/components/alerts/IncidentTimeline.vue";
import RcaReportContent from "@/components/alerts/rca/RcaReportContent.vue";
import type { AutoObserveIncidentItem } from "@/services/autoobserve";
import type { IncidentAlert, IncidentWithAlerts } from "@/services/incidents";
import { incidentEventsQuery, incidentQuery } from "@/services/incidents.queries";
import { AUTOOBSERVE_TRIGGER_KIND, findingFacts } from "@/utils/incidents/findingDimensions";
import { RCA_BADGE_VARIANT } from "@/utils/incidents/rcaCell";
import { rcaEvidenceTitle } from "@/utils/incidents/rcaSummary";
import { renderRcaReport } from "@/utils/incidents/rcaReportMarkdown";
import AutoObserveAnalysis from "../AutoObserveAnalysis.vue";
import AutoObserveUnfoldGraph from "../AutoObserveUnfoldGraph.vue";
import type { Evidence, Severity } from "../aoTypes";
import { analysisLine, findingLogs, findingSentence } from "./incidentsCopy";
import { actorName, formatWhen } from "./liveCopy";
import IssueLogsLink from "./IssueLogsLink.vue";
import IssueSignal from "./IssueSignal.vue";
import LiveIssueOverview from "./LiveIssueOverview.vue";
import {
  COMPARISON_CAP,
  hypothesisVerdict,
  issueCause,
  issueComparisonMissing,
  issueComparisonNote,
  issueComparisonRows,
  issueItemWindow,
  issueLogsEndMs,
  issueLogStreams,
  issueEndUs,
  issueNext,
  issueStreams,
  issueTimeline,
  issueUnfoldCards,
  unfoldCardStream,
  UNFOLD_STREAM_CAP,
  type AnalysisSubject,
  type ComparedStream,
  type LiveIssueTab,
} from "./issueModel";
import { toIssueBaseline } from "./issueBaseline";
import { useAoVolumeSeries } from "./useAoVolumeSeries";
import { useLiveZone } from "./liveModel";
import { useIssueSeriesList } from "./useIssueSeries";

const props = withDefaults(
  defineProps<{ item: AutoObserveIncidentItem; initialTab?: LiveIssueTab }>(),
  { initialTab: "overview" },
);

const { t } = useI18nTyped();
const { isDark } = useTheme();
const store = useStore();
const now = useNow();
const zone = useLiveZone();

const EVIDENCE_KIND: Record<string, Evidence["kind"]> = {
  metrics: "metric",
  traces: "trace",
};

// Only reasons that say why a firing joined; an alert id alone names no reason.
const REASON_KEY: Partial<Record<IncidentAlert["correlation_reason"], I18nKey>> = {
  service_discovery: "alerts.incidents.correlationServiceDiscovery",
  primary_match: "alerts.incidents.correlationPrimaryMatch",
  secondary_match: "alerts.incidents.correlationSecondaryMatch",
};

// The trail lists the agent's strongest reads; the full set stays on the incident page.
const EVIDENCE_CAP = 8;

const tab = ref<LiveIssueTab>(props.initialTab);
const unfoldFocus = ref<string>();
// The comparison costs one search per stream, so it starts only once the analysis tab is opened.
const analysisSeen = ref(props.initialTab === "analysis");
watch(tab, (v) => v === "analysis" && (analysisSeen.value = true));
watch(
  () => [props.item.incident.id, props.initialTab] as const,
  ([, initial]) => {
    tab.value = initial;
    analysisSeen.value = initial === "analysis";
    unfoldFocus.value = undefined;
  },
);

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const id = computed(() => props.item.incident.id);

const detailQuery = useQuery(() => ({
  ...incidentQuery(org.value, id.value),
  enabled: !!org.value,
}));
const eventsQuery = useQuery(() => ({
  ...incidentEventsQuery(org.value, id.value),
  enabled: !!org.value,
}));

// The run composable writes the refreshed run back onto the incident, so it gets its own copy.
const detail = ref<IncidentWithAlerts | null>(null);
watch(
  () => detailQuery.data.value,
  (data) => (detail.value = data ? { ...data } : null),
  { immediate: true },
);
watch(id, () => (detail.value = null));

const rca = useIncidentRca(
  org,
  detail,
  computed(() => tab.value === "analysis"),
);

const streams = computed(() => issueStreams(props.item));
const triggers = computed(() => detail.value?.triggers ?? []);
const events = computed(() => eventsQuery.data.value ?? []);
const facts = computed(() => findingFacts(t, detail.value?.group_values, triggers.value));

const why = computed(() => issueCause(t, zone.value, props.item, now.value));
const next = computed(() => {
  const action = rca.reportVerdict.value?.proposedActions[0];
  return action ? raw(action.title) : issueNext(t, zone.value, props.item, now.value);
});

const card = computed(() => rca.runSummary.value?.card ?? null);
const headline = computed(() => (card.value?.headline ? raw(card.value.headline) : null));
const band = computed(() => card.value?.band ?? detail.value?.rca?.confidence ?? null);
const bandReason = computed(() => card.value?.confidence?.evidence_reason ?? null);

const causeNote = computed<I18nText | null>(() => {
  if (headline.value) return null;
  if (rca.live.value) return t("autoobserve.issueLive.noCauseRunning");
  return canStart.value
    ? t("autoobserve.issueLive.noCause")
    : t("autoobserve.issueLive.noCauseOff");
});

const timeline = computed(() => issueTimeline(t, zone.value, props.item, events.value));

const cards = computed(() =>
  issueUnfoldCards(
    t,
    zone.value,
    props.item,
    triggers.value,
    events.value,
    card.value?.suspect_change ?? null,
  ),
);

const unfoldNote = computed(() => {
  const rest = streams.value.length - UNFOLD_STREAM_CAP;
  return rest > 0 ? t("autoobserve.issueLive.unfold.more", { count: rest }, rest) : null;
});

// The hint names only what the graph holds, so it never promises a change or firings it lacks.
const unfoldHint = computed(() =>
  cards.value.some((c) => c.kind === "change")
    ? t("autoobserve.issueLive.unfold.hintChange")
    : t("autoobserve.issueLive.unfold.hint"),
);

const openUnfold = (cardId: string) => {
  unfoldFocus.value = cardId;
  tab.value = "graph";
};

const compared = computed(() => (analysisSeen.value ? streams.value.slice(0, COMPARISON_CAP) : []));
const window = computed(() => issueItemWindow(props.item, now.value));
const seriesList = useIssueSeriesList(compared, window);
const volume = useAoVolumeSeries(compared, window);

const comparisonStatus = computed(() => {
  const list = seriesList.value;
  if (!list.length) return null;
  if (list.some((s) => s.status === "loading" || s.status === "idle")) return "loading";
  if (list.every((s) => s.status === "failed" || s.status === "denied")) return "failed";
  // The usual level replaces the before bar, so the bars wait for it instead of swapping later.
  if (list.some((s) => volume.stateOf(s.stream).kind === "loading")) return "loading";
  return "ready";
});

// A failed usual-level read silently swaps the healthy bars to before/after counts, so it is named too.
const usualFailed = computed(() => compared.value.some((s) => volume.stateOf(s).kind === "failed"));

// Streams whose counts failed or were denied; their bars are missing, so it names them and what is missing.
const comparisonMissing = computed(() => {
  const list = seriesList.value;
  if (comparisonStatus.value !== "ready" && comparisonStatus.value !== "failed") return null;
  const names = (status: string) =>
    list.filter((s) => s.status === status).map((s) => s.stream.name);
  return issueComparisonMissing(
    t,
    zone.value.locale,
    names("failed"),
    names("denied"),
    usualFailed.value,
  );
});
const comparisonCanRetry = computed(
  () => usualFailed.value || seriesList.value.some((s) => s.status === "failed"),
);

const comparisonMore = computed(() => {
  const rest = streams.value.length - compared.value.length;
  return rest > 0 ? t("autoobserve.issueLive.compare.more", { count: rest }, rest) : null;
});

const retryComparison = () => {
  seriesList.value.filter((s) => s.status === "failed").forEach((s) => s.retry());
  if (usualFailed.value) volume.retry();
};

const legendLabels = computed(() => ({
  healthy: t("autoobserve.issueLive.compare.legendHealthy"),
  affected: t("autoobserve.issueLive.compare.legendAffected"),
}));

const comparedPairs = computed<ComparedStream[]>(() =>
  seriesList.value.flatMap((s) => {
    if (!s.series || s.status === "failed" || s.status === "denied") return [];
    const state = volume.stateOf(s.stream);
    const baseline = "series" in state ? toIssueBaseline(state.series, window.value) : null;
    return [{ stream: s.stream, series: s.series, baseline }];
  }),
);
const comparisonNote = computed(() =>
  issueComparisonNote(t, zone.value.locale, comparedPairs.value),
);

// Healthy bars start once every stream is back and the incident is resolved, whichever is later.
const healthyFromUs = computed(() => {
  const back = issueEndUs(props.item);
  const resolved =
    props.item.incident.status === "resolved" ? (detail.value?.resolved_at ?? null) : null;
  return back === null || resolved === null ? back : Math.max(back, resolved);
});

const minutes = computed(() => {
  const endUs = issueEndUs(props.item);
  const end = endUs !== null ? endUs / 1000 : now.value;
  return Math.max(1, Math.round((end - props.item.finding.first_seen_at / 1000) / 60_000));
});

const subject = computed<AnalysisSubject>(() => {
  const summary = rca.runSummary.value;
  const names = streams.value.map((s) => s.name);
  const resolved = props.item.incident.status === "resolved";
  const impact: I18nText[] = card.value?.impact?.summary
    ? [raw(card.value.impact.summary)]
    : names.length > 1
      ? [findingSentence(t, props.item)]
      : [];
  return {
    id: props.item.incident.id,
    severity: String(props.item.incident.severity).toLowerCase() as Severity,
    services: names.length > 3 ? [...names.slice(0, 3), `+${names.length - 3}`] : names,
    confidence: band.value,
    analysis: {
      verdict: headline.value ?? why.value,
      impact,
      duration: resolved
        ? t("autoobserve.analysis.lasted", { count: minutes.value })
        : t("autoobserve.analysis.soFar", { count: minutes.value }),
      hypotheses: (summary?.hypotheses ?? [])
        .filter((h) => h.status !== "symptom")
        .map((h) => ({
          name: raw(h.statement),
          verdict: hypothesisVerdict(h.status),
          reason: raw(h.reason),
        })),
      comparison:
        comparisonStatus.value === "ready"
          ? {
              metric: t("autoobserve.issueLive.compare.metric"),
              rows: issueComparisonRows(
                t,
                zone.value.locale,
                comparedPairs.value,
                healthyFromUs.value,
              ),
            }
          : undefined,
    },
    evidence: (summary?.evidence ?? []).slice(0, EVIDENCE_CAP).map((e) => ({
      kind: EVIDENCE_KIND[e.target] ?? "log",
      title: rcaEvidenceTitle(e),
      detail: raw(e.result_summary),
    })),
    unfold: cards.value,
    nextStep: next.value,
  };
});

const runLine = computed(() =>
  props.item.investigation.state
    ? analysisLine(t, props.item, store.state.zoConfig?.incidents_rca_enabled === true)
    : null,
);
const completedLabel = computed(() => t("alerts.incidents.aiAnalysis.analyzed"));

const aiLock = useLicenseLock("ai_assistant");
const canStart = computed(() => store.state.zoConfig?.incidents_rca_enabled === true);
// The same reason the incident page gives, so a locked control always says why.
const lockedReason = computed<I18nText | null>(() => {
  if (canStart.value) return null;
  return aiLock.locked.value ? aiLock.lockedReason.value : t("autoobserve.issueLive.analyzeOff");
});

const reportHtml = computed(() =>
  rca.reportText.value ? renderRcaReport(rca.reportText.value) : "",
);

// A finished incident's logs end an hour after it ended; an open one's run to now.
const logsEndUs = computed(
  () =>
    issueEndUs(props.item) ??
    (props.item.incident.status === "resolved" ? (detail.value?.resolved_at ?? null) : null),
);
const logsRoute = computed(() =>
  findingLogs(props.item, issueLogsEndMs(logsEndUs.value, now.value)),
);

const triggerTime = (us: number) =>
  String(formatWhen(us / 1000, zone.value.locale, zone.value.timeZone, now.value));
// AutoObserve joins its own findings into one incident; other firings keep the server's reason when it named one.
const triggerReason = (row: IncidentAlert): string | null => {
  if (row.alert_kind === AUTOOBSERVE_TRIGGER_KIND)
    return String(t("autoobserve.issueLive.triggersGrouped"));
  const key = REASON_KEY[row.correlation_reason];
  return key ? String(t(key)) : null;
};
const logStreams = computed(() => issueLogStreams(props.item));
</script>
