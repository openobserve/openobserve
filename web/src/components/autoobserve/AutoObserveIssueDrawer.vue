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
  <ODrawer
    :open="open"
    :width="85"
    :title="issue?.title"
    :sub-title="issue ? raw(`${issue.id} · ${issue.started}`) : undefined"
    bleed
    data-test="autoobserve-issue-drawer"
    @update:open="(v) => emit('update:open', v)"
  >
    <div v-if="issue" class="flex h-full flex-col">
      <OTabs v-model="tab" bordered class="shrink-0" data-test="autoobserve-issue-tabs">
        <OTab name="overview" :label="t('alerts.insights.tabs.overview')" />
        <OTab name="analysis" :label="t('alerts.incidents.incidentAnalysis')" />
        <OTab name="graph" :label="t('autoobserve.drawer.unfoldTab')" />
        <OTab name="firings">
          <div class="flex items-center gap-1.5">
            <span>{{ t("alerts.incidents.alertTriggers") }}</span>
            <OTag type="countChip" value="neutral">{{ firingTotal }}</OTag>
          </div>
        </OTab>
      </OTabs>
      <AutoObserveAnalysis
        v-if="tab === 'analysis'"
        ref="analysisRef"
        :issue="issue"
        :entry="proposalEntry"
        @approve="approve"
        @reject="reject"
        @open-unfold="openUnfold"
      >
        <template #report>
          <!-- The analysis tab already offers copy and download, so the embedded report's toolbar is hidden. -->
          <IncidentRCAAnalysis
            class="[&_[data-test=rca-toolbar]]:hidden"
            :has-existing-rca="true"
            :rca-loading="false"
            :formatted-rca-content="rcaHtml"
            :is-dark-mode="isDark"
            @copy-report="notInDemo"
            @download-report="notInDemo"
            @trigger-rca="notInDemo"
          />
        </template>
      </AutoObserveAnalysis>
      <AutoObserveUnfoldGraph
        v-else-if="tab === 'graph'"
        :cards="issue.unfold"
        :focus-id="unfoldFocus"
      />
      <div v-else-if="tab === 'firings'" class="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        <p class="text-text-secondary mb-2 text-xs" data-test="autoobserve-issue-triggers-note">
          {{
            t("autoobserve.drawer.triggersSample", { shown: triggers.length, total: firingTotal })
          }}
        </p>
        <div
          class="border-card-glass-border rounded-default flex min-h-0 flex-1 flex-col overflow-hidden border"
        >
          <IncidentAlertTriggersTable :triggers="triggers" :is-dark-mode="isDark" />
        </div>
      </div>
      <div
        v-else
        class="@container flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 [&>*]:shrink-0"
      >
        <div class="flex flex-wrap items-center gap-2">
          <OTag type="severity" :value="issue.severity" size="sm" />
          <OTag
            v-if="issue.deferred"
            variant="default-soft"
            size="sm"
            icon="schedule"
            :label="t('autoobserve.issues.heldForDigest')"
          />
          <OTag v-else type="incidentStatus" :value="issue.status" size="sm" />
          <OTag
            v-for="svc in issue.services"
            :key="svc"
            variant="default-soft"
            shape="rounded"
            size="sm"
            :label="raw(svc)"
          />
        </div>

        <OCard v-if="issue.proposal" variant="glass" data-test="autoobserve-issue-proposal">
          <OCardSection role="header" dense>
            <OIcon
              :name="issue.proposal.kind === 'fix' ? 'build' : 'lightbulb-outline'"
              size="sm"
              class="text-text-secondary"
            />
            <OText variant="panel-title">{{
              issue.proposal.kind !== "fix"
                ? t("autoobserve.drawer.caughtEarlier")
                : proposalEntry?.status === "awaiting"
                  ? t("autoobserve.drawer.waitingForOk")
                  : t("autoobserve.drawer.proposedFix")
            }}</OText>
          </OCardSection>
          <OCardSection role="body" dense class="flex items-start gap-4 max-md:flex-col">
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <span class="text-text-heading text-sm font-medium">{{ issue.proposal.title }}</span>
              <span class="text-text-secondary text-xs">{{ issue.proposal.detail }}</span>
            </div>
            <OButton
              v-if="proposalEntry?.status === 'awaiting'"
              variant="primary"
              size="sm"
              data-test="autoobserve-issue-proposal-approve"
              @click="approve"
            >
              {{ t("autoobserve.activity.approve") }}
            </OButton>
            <OTag
              v-else-if="proposalEntry"
              :variant="LEDGER_STATUS[proposalEntry.status].variant"
              size="sm"
              :label="t(LEDGER_STATUS[proposalEntry.status].key)"
            />
          </OCardSection>
        </OCard>

        <div
          class="flex flex-col gap-4 @min-[64rem]:grid @min-[64rem]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @min-[64rem]:items-start"
        >
          <div
            class="contents @min-[64rem]:flex @min-[64rem]:min-w-0 @min-[64rem]:flex-col @min-[64rem]:gap-4"
          >
            <OCard variant="glass" data-test="autoobserve-issue-rca">
              <OCardSection role="header" dense>
                <OIcon name="psychology" size="sm" class="text-text-secondary" />
                <OText variant="panel-title">{{ t("autoobserve.drawer.rca") }}</OText>
              </OCardSection>
              <OCardSection role="body" dense class="flex flex-col gap-3">
                <p class="text-text-body text-sm">{{ issue.summary }}</p>
                <div class="bg-surface-subtle rounded-surface flex flex-col gap-1.5 p-3">
                  <span class="text-text-body text-xs font-medium">{{
                    t("autoobserve.drawer.likelyCause")
                  }}</span>
                  <p class="text-text-heading text-sm">{{ issue.likelyCause }}</p>
                </div>
                <div class="flex items-center gap-3">
                  <span class="text-text-secondary shrink-0 text-xs font-medium">{{
                    t("autoobserve.drawer.confidence")
                  }}</span>
                  <OTag
                    :variant="issue.confidence === 'high' ? 'success-soft' : 'default-soft'"
                    size="sm"
                    :label="t(CONFIDENCE_LABEL[issue.confidence])"
                    data-test="autoobserve-issue-confidence"
                  />
                  <span class="text-text-secondary text-xs">{{
                    t("autoobserve.confidence.uncalibrated")
                  }}</span>
                </div>
                <ProblemSpark
                  v-if="problem"
                  :chart="problem.chart"
                  :outcome="problem.outcome"
                  size="card"
                  class="border-border-subtle flex border-t pt-3"
                  data-test="autoobserve-issue-chart"
                />
                <OButton
                  v-if="issue.evidence.length"
                  variant="ghost-primary"
                  size="xs"
                  class="self-start"
                  data-test="autoobserve-issue-see-evidence"
                  @click="seeEvidence"
                >
                  {{ t("autoobserve.drawer.seeEvidence", { count: issue.evidence.length }) }}
                </OButton>
              </OCardSection>
            </OCard>
            <OCard
              variant="glass"
              class="order-1 @min-[64rem]:order-none"
              data-test="autoobserve-issue-notification"
            >
              <OCardSection role="header" dense>
                <OIcon
                  :name="issue.deferred ? 'schedule' : 'send'"
                  size="sm"
                  class="text-text-secondary"
                />
                <OText variant="panel-title">{{
                  issue.deferred
                    ? t("autoobserve.issues.heldForDigest")
                    : t("autoobserve.drawer.notification")
                }}</OText>
                <span class="text-text-secondary ms-auto text-xs">{{ issue.channel }}</span>
              </OCardSection>
              <OCardSection role="body" dense>
                <p v-if="!issue.thread.length" class="text-text-secondary text-sm">
                  {{ t("autoobserve.drawer.notSent") }}
                </p>
                <div
                  v-else
                  class="border-border-default bg-surface-base rounded-surface flex flex-col border"
                >
                  <div
                    v-for="(msg, i) in issue.thread"
                    :key="i"
                    class="flex gap-3 p-3"
                    :class="i > 0 ? 'border-border-subtle bg-surface-subtle ms-8 border-t' : ''"
                  >
                    <div
                      class="bg-accent text-text-inverse rounded-default flex size-9 shrink-0 items-center justify-center"
                    >
                      <OIcon name="navigation" size="sm" />
                    </div>
                    <div class="flex min-w-0 flex-col gap-1">
                      <div class="flex items-baseline gap-2">
                        <span class="text-text-heading text-sm font-semibold">{{
                          t("autoobserve.drawer.sender")
                        }}</span>
                        <span class="text-text-secondary text-xs">{{ msg.at }}</span>
                        <span v-if="i > 0" class="text-text-secondary text-xs">{{
                          t("autoobserve.drawer.threadReply")
                        }}</span>
                      </div>
                      <p
                        v-for="(line, j) in msg.lines"
                        :key="j"
                        class="text-sm"
                        :class="
                          i === 0 && j === 0 ? 'text-text-heading font-semibold' : 'text-text-body'
                        "
                      >
                        {{ line }}
                      </p>
                      <div v-if="msg.fields" class="mt-1 grid grid-cols-2 gap-2">
                        <div v-for="f in msg.fields" :key="f.label" class="flex flex-col">
                          <span class="text-text-heading text-xs font-semibold">{{ f.label }}</span>
                          <span class="text-text-secondary text-xs">{{ f.value }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <p v-if="issue.severity === 'p1'" class="text-text-secondary mt-2 text-xs">
                  {{ t("autoobserve.drawer.p1Note") }}
                </p>
                <p v-else-if="issue.thread.length" class="text-text-secondary mt-2 text-xs">
                  {{ t("autoobserve.drawer.gateNote") }}
                </p>
              </OCardSection>
            </OCard>
          </div>
          <div
            class="contents @min-[64rem]:flex @min-[64rem]:min-w-0 @min-[64rem]:flex-col @min-[64rem]:gap-4"
          >
            <OCard variant="glass" data-test="autoobserve-issue-timeline">
              <OCardSection role="header" dense>
                <OIcon name="timeline" size="sm" class="text-text-secondary" />
                <OText variant="panel-title">{{ t("autoobserve.drawer.timeline") }}</OText>
              </OCardSection>
              <OCardSection role="body" dense>
                <OTimeline>
                  <OTimelineItem
                    v-for="(entry, i) in issue.timeline"
                    :key="i"
                    :label="raw(entry.at)"
                    :title="entry.title"
                    :subtitle="entry.detail"
                    :variant="entry.variant"
                  />
                </OTimeline>
              </OCardSection>
            </OCard>
            <OCard variant="glass" data-test="autoobserve-issue-blast">
              <OCardSection role="header" dense>
                <OIcon name="hub" size="sm" class="text-text-secondary" />
                <OText variant="panel-title">{{ t("autoobserve.drawer.blastRadius") }}</OText>
              </OCardSection>
              <OCardSection role="body" dense class="flex flex-col gap-3">
                <div v-for="group in blast" :key="group.key" class="flex flex-col gap-1.5">
                  <span class="text-text-secondary text-xs font-medium">{{ group.label }}</span>
                  <div class="flex flex-wrap gap-1">
                    <OTag
                      v-for="svc in group.services"
                      :key="svc"
                      :variant="group.key === 'affected' ? 'error-soft' : 'default-soft'"
                      shape="rounded"
                      size="sm"
                      :label="raw(svc)"
                    />
                    <span v-if="!group.services.length" class="text-text-secondary text-xs">{{
                      t("autoobserve.drawer.none")
                    }}</span>
                  </div>
                </div>
              </OCardSection>
            </OCard>
          </div>
        </div>
      </div>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useTheme } from "@/composables/useTheme";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import IncidentRCAAnalysis from "@/components/alerts/IncidentRCAAnalysis.vue";
import IncidentAlertTriggersTable from "@/components/alerts/IncidentAlertTriggersTable.vue";
import type { IncidentAlert } from "@/services/incidents";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTimeline from "@/lib/data/Timeline/OTimeline.vue";
import OTimelineItem from "@/lib/data/Timeline/OTimelineItem.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import AutoObserveUnfoldGraph from "./AutoObserveUnfoldGraph.vue";
import AutoObserveAnalysis from "./AutoObserveAnalysis.vue";
import ProblemSpark from "./v2/ProblemSpark.vue";
import { overridesFor, problemsFor } from "./v2/fixtures";
import { useDecisions } from "./v2/useDecisions";
import { PROBLEMS, type Scenario } from "./data/facts";
import { useScenario } from "./data/useScenario";
import {
  CONFIDENCE_LABEL,
  DEMO_DATE,
  LEDGER_STATUS,
  type Issue,
  type LedgerEntry,
} from "./fixtures";

const props = defineProps<{
  open: boolean;
  issue: Issue | null;
  ledger: LedgerEntry[];
  scenario?: Scenario;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  "update-entry": [id: string, patch: Partial<LedgerEntry>];
}>();

const { t } = useI18nTyped();
const { isDark } = useTheme();

const tab = ref("overview");
const unfoldFocus = ref<string>();
watch(
  () => props.issue?.id,
  () => {
    tab.value = "overview";
    unfoldFocus.value = undefined;
  },
);

const analysisRef = ref<InstanceType<typeof AutoObserveAnalysis>>();
const seeEvidence = async () => {
  tab.value = "analysis";
  await nextTick();
  analysisRef.value?.scrollToTrail();
};

const { scenario: sharedScenario } = useScenario();
const scenario = computed(() => props.scenario ?? sharedScenario.value);
const decisions = useDecisions();
// Built exactly like the Standard row, so a fix approved in either view redraws this chart too.
const problem = computed(() => {
  const fact = Object.values(PROBLEMS).find((f) => f.incidentId === props.issue?.id);
  if (!fact) return undefined;
  const overrides = overridesFor(scenario.value, decisions.decisions, decisions.phases);
  return problemsFor(overrides)[fact.id];
});

const openUnfold = (cardId: string) => {
  unfoldFocus.value = cardId;
  tab.value = "graph";
};

// Fixture times are wall-clock on the pinned demo day, so every incident view agrees with the timeline.
const clockUs = (at: string, daysAgo: number) => {
  const [h, m] = at.split(":").map(Number);
  const [y, mo, d] = DEMO_DATE;
  return new Date(y, mo, d - daysAgo, h, m).getTime() * 1000;
};
const firingTotal = computed(() => props.issue?.firings.reduce((n, f) => n + f.count, 0) ?? 0);
// Only a completed step with a real clock time counts as the investigation landing.
const analyzedAtLabel = computed(
  () =>
    props.issue?.timeline.find((e) => e.variant === "primary" && /^\d{2}:\d{2}$/.test(e.at))?.at ??
    "",
);

const triggers = computed<IncidentAlert[]>(() => {
  const issue = props.issue;
  if (!issue) return [];
  return issue.firings.flatMap((f, i) =>
    f.sampleTimes.map((at) => ({
      incident_id: issue.id,
      alert_id: f.detector,
      alert_name: f.detector,
      alert_kind: "internal" as const,
      alert_fired_at: clockUs(at, f.daysAgo),
      correlation_reason: i === 0 ? ("primary_match" as const) : ("service_discovery" as const),
      created_at: clockUs(at, f.daysAgo),
      labels: { "service.name": f.service },
    })),
  );
});

const notInDemo = () => toast({ variant: "info", message: t("autoobserve.notInDemo") });

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const rcaHtml = computed(() => {
  const issue = props.issue;
  if (!issue) return "";
  const h2 = (text: string) =>
    `<div class="rca-h2 font-bold text-lg mt-5 mb-3 rca-section-bg px-4 py-3 rounded-default border-s-4">${escapeHtml(text)}</div>`;
  const p = (text: string) => `<p class="mb-3">${escapeHtml(text)}</p>`;
  const evidence = issue.evidence
    .map(
      (ev) =>
        `<li class="rca-list-item"><strong class="font-semibold">${escapeHtml(ev.title)}</strong>: <code class="rca-inline-code px-1.5 py-0.5 rounded-default text-sm font-mono">${escapeHtml(ev.detail)}</code>${ev.count ? ` (${escapeHtml(ev.count)})` : ""}</li>`,
    )
    .join("");
  return `<div class="rca-report-content">${[
    h2(t("autoobserve.drawer.rcaSummary")),
    p(issue.summary),
    h2(t("autoobserve.drawer.likelyCause")),
    p(issue.likelyCause),
    p(
      t("autoobserve.drawer.confidenceValue", {
        value: t(CONFIDENCE_LABEL[issue.confidence]),
      }),
    ),
    ...(analyzedAtLabel.value
      ? [p(t("autoobserve.drawer.analyzedAt", { time: analyzedAtLabel.value }))]
      : []),
    h2(t("autoobserve.drawer.evidence")),
    `<ul class="rca-ul ps-5 my-3 space-y-1.5 list-disc">${evidence}</ul>`,
    h2(t("autoobserve.drawer.nextStep")),
    p(issue.nextStep),
  ].join("")}</div>`;
});

const blast = computed(() => {
  if (!props.issue) return [];
  return [
    {
      key: "upstream",
      label: t("autoobserve.drawer.upstream"),
      services: props.issue.upstream,
    },
    {
      key: "affected",
      label: t("autoobserve.drawer.affected"),
      services: props.issue.services,
    },
    {
      key: "downstream",
      label: t("autoobserve.drawer.downstream"),
      services: props.issue.downstream,
    },
  ];
});

const proposalEntry = computed(() =>
  props.ledger.find((e) => e.id === props.issue?.proposal?.ledgerId),
);

const approve = () => {
  if (!proposalEntry.value) return;
  emit("update-entry", proposalEntry.value.id, { status: "approved" });
  toast({ variant: "success", message: t("autoobserve.activity.approvedToast") });
};

const reject = () => {
  if (!proposalEntry.value) return;
  emit("update-entry", proposalEntry.value.id, {
    status: "rejected",
    note: t("autoobserve.activity.rejectedNote"),
  });
  toast({ variant: "default", message: t("autoobserve.activity.rejectedToast") });
};
</script>
