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
    :title="title"
    :subtitle="subtitle"
    icon="bolt"
    :back="back"
    bleed
    data-test="autoresolve-run-page"
  >
    <template v-if="run && isTerminalRunState(run.state) && !run.autoresolve" #actions>
      <OButton
        variant="outline"
        size="sm-action"
        icon-left="bookmark-add"
        data-test="autoresolve-run-save-as"
        @click="onSaveAs"
      >
        {{ t("autoresolve.saved.saveAsAutoResolve") }}
      </OButton>
    </template>
    <template #title-trail>
      <BetaBadge stage="alpha" />
      <OTag
        v-if="shownState"
        type="autoresolveRunState"
        :value="shownState"
        data-test="autoresolve-run-state"
      />
      <span
        v-if="reconnecting"
        class="text-text-secondary text-xs whitespace-nowrap"
        role="status"
        data-test="autoresolve-run-reconnecting"
      >
        {{ t("autoresolve.run.reconnecting") }}
      </span>
    </template>

    <div
      v-if="error"
      class="flex h-full items-center justify-center"
      data-test="autoresolve-run-error"
    >
      <OEmptyState
        v-if="errorStatus === 403"
        preset="no-access"
        data-test="autoresolve-run-forbidden"
      />
      <OEmptyState
        v-else
        preset="load-error"
        :title="error"
        :description="errorStatus === 404 ? t('autoresolve.runNotFoundHint') : undefined"
        data-test="autoresolve-run-load-error"
        @action="retry"
      />
    </div>

    <OContent
      v-else-if="!run"
      y
      class="flex max-w-240 flex-col gap-3"
      data-test="autoresolve-run-loading"
    >
      <OSkeleton class="h-6 w-1/2" />
      <OSkeleton class="h-24 w-full" />
      <OSkeleton class="h-40 w-full" />
    </OContent>

    <div v-else class="flex h-full min-h-0 max-lg:flex-col max-lg:overflow-auto">
      <div class="min-w-0 flex-1 overflow-auto max-lg:flex-none max-lg:overflow-visible">
        <OContent y class="flex max-w-240 flex-col gap-4" data-test="autoresolve-run-main">
          <RcaStageStepper
            :stages="AUTORESOLVE_STAGES"
            :stage="stageKey"
            :skipped="skippedStages(run)"
          />

          <AutoResolveMissingConnection
            v-if="missingConnection"
            :run="run"
            :missing="missingConnection"
            @added="reread"
          />

          <section
            v-if="run.state === 'investigating'"
            class="flex flex-col gap-2"
            data-test="autoresolve-run-investigating"
          >
            <h2 class="text-text-heading m-0 text-sm font-semibold">
              {{ t("autoresolve.run.investigating") }}
            </h2>
            <ol
              v-if="liveSteps.length"
              class="rounded-surface border-border-default bg-surface-base m-0 flex list-none flex-col gap-3.5 border p-4"
            >
              <RcaThreadStep
                v-for="step in liveSteps"
                :key="step.index"
                :step="step"
                :run-live="run.thread.active"
                :finished="isFinishedStep(run.thread, step, threadIndex(step.index))"
                :timezone="timezone"
                :working-text="t('autoresolve.run.working')"
              />
            </ol>
            <AutoResolveTurnLine :run="run" :now-us="nowUs" />
            <p class="text-text-secondary m-0 text-xs">
              {{ t("autoresolve.run.investigatingNote") }}
            </p>
          </section>

          <!-- Without the model's verdict the state notice or the request says how the run ended. -->
          <AutoResolveOutcome
            v-if="run.outcome?.verdict"
            :outcome="run.outcome"
            :ended-at-us="run.ended_at_us"
            :checked="checkRan(run)"
            :error="outcomeCardError"
            :hide-explanation="!!missingConnection"
            :cant-fix="shownState === 'cant_fix'"
            :not-needed="shownState === 'not_needed'"
          />
          <AutoResolveVerdictCheck
            v-if="verdictRow && run.outcome?.verdict"
            :run="run"
            :submitting="verdictSubmitting"
            :notice="verdictNotice"
            @fixed="onFixed"
            @replan="onNotFixed"
          />

          <AutoResolveStepList
            v-if="run.steps.length"
            v-model:open="stepsOpen"
            :steps="run.steps"
            :title="stepsTitle"
            :approved-line="approvedLine"
            :now-us="nowUs"
          />

          <template v-if="run.state === 'proceeding' || run.state === 'checking'">
            <AutoResolveTurnLine :run="run" :now-us="nowUs" />
            <p
              v-if="run.state === 'proceeding'"
              class="text-text-secondary m-0 text-xs"
              data-test="autoresolve-run-proceeding-note"
            >
              {{ t("autoresolve.run.proceedingNote") }}
            </p>
          </template>
          <OInlineNotice
            v-else-if="stateNotice"
            :variant="stateNotice.variant"
            :text="stateNotice.text"
            :data-test="`autoresolve-run-notice-${run.state}`"
            class="self-start"
          />
          <AutoResolveVerdictCheck
            v-if="verdictRow && !run.outcome?.verdict"
            :run="run"
            :submitting="verdictSubmitting"
            :notice="verdictNotice"
            @fixed="onFixed"
            @replan="onNotFixed"
          />

          <div
            v-if="run.outcome?.verdict === 'worse'"
            class="flex flex-wrap items-center justify-between gap-3"
            data-test="autoresolve-run-revert"
          >
            <OInlineNotice
              v-if="revertError"
              variant="error"
              wrap
              :text="revertError"
              class="min-w-0 flex-1"
              data-test="autoresolve-run-revert-error"
            />
            <p v-else class="text-text-secondary m-0 text-xs">
              {{ t("autoresolve.run.revertHint") }}
            </p>
            <OButton
              variant="primary"
              size="sm-action"
              :loading="replan.isPending.value"
              data-test="autoresolve-run-revert-btn"
              @click="onRevert"
            >
              {{ t("autoresolve.run.raiseRevert") }}
            </OButton>
          </div>

          <AutoResolveApprovalRequest
            v-if="showRequest"
            :run="run"
            :submitting="submitting"
            :refused="refused"
            :removed-ids="removedIds"
            :notice="actionNotice"
            :replans-sent="replansSent"
            @approve="onApprove"
            @decline="onDecline"
            @replan="onReplan"
            @show-evidence="showEvidence"
          />

          <!-- The current stage leads; what came before it follows. -->
          <AutoResolveVerdicts
            v-if="shownVerdict?.verdict === 'not_fixed'"
            :verdict="shownVerdict"
          />

          <div
            v-if="showInvestigation"
            ref="investigationEl"
            class="rounded-surface border-border-default bg-surface-base border"
            data-test="autoresolve-run-investigated"
          >
            <OCollapsible v-model="threadOpen" trigger-class="px-4 py-2">
              <template #trigger="{ open }">
                <span class="flex min-w-0 flex-1 items-center gap-2">
                  <OIcon name="check-circle" size="sm" class="text-status-positive shrink-0" />
                  <span class="text-text-heading shrink-0 text-sm font-semibold">
                    {{ t("autoresolve.run.investigated") }}
                  </span>
                  <OTruncatedText as="span" class="text-text-secondary min-w-0 flex-1 text-xs">
                    {{ investigatedMeta }}
                  </OTruncatedText>
                  <OIcon
                    name="expand-more"
                    size="sm"
                    class="text-icon-color shrink-0 transition-transform duration-150 motion-reduce:transition-none"
                    :class="open ? 'rotate-180' : ''"
                  />
                </span>
              </template>
              <div class="flex flex-col gap-5 px-4 pt-1 pb-4">
                <template v-if="causeFindings">
                  <RcaHypotheses
                    ref="hypothesesEl"
                    :hypotheses="causeFindings.hypotheses"
                    outcome="root_cause_identified"
                    :evidence="causeFindings.evidence"
                    :org="orgId"
                  />
                  <RcaEvidenceList
                    :evidence="causeFindings.evidence"
                    :unverified="causeFindings.unverified"
                    :hypotheses="causeFindings.hypotheses"
                    :org="orgId"
                    @open-hypothesis="hypothesesEl?.showHypothesis($event)"
                  />
                </template>
                <section
                  v-if="investigatedPasses.length"
                  class="flex flex-col gap-3.5"
                  data-test="autoresolve-run-investigated-steps"
                >
                  <h3 v-if="causeFindings" class="text-text-heading m-0 text-base font-bold">
                    {{ t("autoresolve.run.steps") }}
                  </h3>
                  <template v-for="pass in investigatedPasses" :key="pass.startUs">
                    <h4
                      v-if="pass.heading"
                      class="border-border-subtle text-text-secondary m-0 border-t pt-3 text-xs font-semibold"
                      data-test="autoresolve-run-investigated-pass"
                    >
                      {{ pass.heading }}
                    </h4>
                    <ol class="m-0 flex list-none flex-col gap-3.5 p-0">
                      <!-- An earlier pass is over even while a replan's turn runs. -->
                      <RcaThreadStep
                        v-for="step in pass.steps"
                        :key="step.index"
                        :step="step"
                        :run-live="false"
                        :finished="isFinishedStep(run.thread, step, threadIndex(step.index))"
                        :timezone="timezone"
                        :working-text="t('autoresolve.run.working')"
                      />
                    </ol>
                  </template>
                </section>
              </div>
            </OCollapsible>
          </div>
        </OContent>
      </div>

      <aside
        class="w-88 shrink-0 overflow-auto max-lg:w-full max-lg:flex-none max-lg:overflow-visible"
        data-test="autoresolve-run-facts"
      >
        <OContent y class="max-lg:ps-page-edge ps-0">
          <OCard variant="glass">
            <OCardSection role="header" dense>
              <h2 class="text-text-heading m-0 text-sm font-semibold">
                {{ t("autoresolve.run.facts.title") }}
              </h2>
            </OCardSection>
            <OCardSection role="body" dense class="flex flex-col gap-3">
              <ODescriptionList dense label-width="narrow">
                <ODescriptionItem :label="t('autoresolve.run.facts.startedBy')">
                  <OUserCell v-if="run.trigger.kind === 'person'" :value="run.requester" />
                  <span v-else class="wrap-anywhere">{{ startedBy }}</span>
                </ODescriptionItem>
                <ODescriptionItem :label="t('autoresolve.run.facts.started')">
                  <OTimeCell :value="run.created_at_us" unit="us" :timezone="timezone" />
                </ODescriptionItem>
                <ODescriptionItem :label="t('autoresolve.run.facts.canUse')">
                  <span
                    class="flex flex-wrap items-center gap-x-2 gap-y-1"
                    data-test="autoresolve-run-can-use"
                  >
                    <span>{{ canUse }}</span>
                    <AutoResolveRemovedConnection
                      v-for="name in removedConnections.shown"
                      :key="name"
                      :name="name"
                    />
                    <OTag
                      v-if="removedConnections.more"
                      variant="error-outline"
                      size="sm"
                      :label="removedConnections.more"
                      data-test="autoresolve-run-removed-more"
                    />
                    <span
                      v-if="notInAutoResolve"
                      class="text-text-secondary w-full text-xs wrap-anywhere"
                      data-test="autoresolve-run-not-in-autoresolve"
                      >{{ notInAutoResolve }}</span
                    >
                  </span>
                </ODescriptionItem>
                <ODescriptionItem :label="t('autoresolve.run.facts.canApprove')">
                  <template v-if="run.approvers.length">{{ canApprove }}</template>
                </ODescriptionItem>
                <ODescriptionItem :label="t('autoresolve.run.facts.option')">
                  <span class="wrap-anywhere">{{ optionFact }}</span>
                </ODescriptionItem>
                <ODescriptionItem :label="t('autoresolve.run.facts.approval')">
                  <span
                    v-if="approvedFact"
                    class="flex min-w-0 flex-col items-start gap-0.5"
                    data-test="autoresolve-run-approved-fact"
                  >
                    <OUserCell :value="approvedFact.by" />
                    <OTimeCell :value="approvedFact.atUs" unit="us" :timezone="timezone" />
                  </span>
                  <template v-else>{{ approvalFact }}</template>
                </ODescriptionItem>
                <ODescriptionItem :label="t('autoresolve.run.facts.check')">
                  {{ checkFact }}
                </ODescriptionItem>
                <ODescriptionItem :label="t('autoresolve.run.facts.outcome')">
                  <span
                    v-if="shownVerdict"
                    class="flex flex-col items-start gap-1.5"
                    data-test="autoresolve-run-verdicts-fact"
                  >
                    <span v-if="agentState" class="flex flex-col items-start gap-0.5">
                      <OTag type="autoresolveRunState" :value="agentState" />
                      <span class="text-text-secondary text-xs">{{
                        t("autoresolve.verdict.agent")
                      }}</span>
                    </span>
                    <span class="flex flex-col items-start gap-0.5">
                      <OTag type="autoresolvePersonVerdict" :value="shownVerdict.verdict" />
                      <span class="text-text-secondary text-xs wrap-anywhere">{{
                        shownVerdict.by
                      }}</span>
                    </span>
                  </span>
                  <OTag
                    v-else-if="isTerminalRunState(run.state)"
                    type="autoresolveRunState"
                    :value="shownState"
                  />
                  <template v-else>{{ t("autoresolve.run.facts.notKnown") }}</template>
                </ODescriptionItem>
              </ODescriptionList>
              <section
                v-if="timeline.length > 1"
                class="border-border-default flex flex-col gap-2 border-t pt-3"
                data-test="autoresolve-run-timeline"
              >
                <h3 class="text-text-heading m-0 text-sm font-semibold">
                  {{ t("autoresolve.run.timeline.title") }}
                </h3>
                <OTimeline>
                  <OTimelineItem
                    v-for="item in timeline"
                    :key="item.key"
                    :title="item.title"
                    :variant="item.variant"
                    :data-test="`autoresolve-run-timeline-${item.kind}`"
                  >
                    <template #subtitle>
                      <OTruncatedText
                        v-for="(line, idx) in item.details"
                        :key="idx"
                        class="text-text-body block"
                        data-test="autoresolve-run-timeline-detail"
                        >{{ line }}</OTruncatedText
                      >{{ item.time }}
                    </template>
                  </OTimelineItem>
                </OTimeline>
              </section>
              <p class="border-border-default text-text-secondary m-0 border-t pt-3 text-xs">
                {{ t("autoresolve.run.facts.evidenceNote") }}
              </p>
            </OCardSection>
          </OCard>
        </OContent>
      </aside>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useMutation } from "@tanstack/vue-query";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTimeline from "@/lib/data/Timeline/OTimeline.vue";
import OTimelineItem from "@/lib/data/Timeline/OTimelineItem.vue";
import type { TimelineItemVariant } from "@/lib/data/Timeline/OTimelineItem.types";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import type { InlineNoticeVariant } from "@/lib/feedback/InlineNotice/OInlineNotice.types";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import RcaEvidenceList from "@/components/alerts/rca/RcaEvidenceList.vue";
import RcaHypotheses from "@/components/alerts/rca/RcaHypotheses.vue";
import RcaStageStepper from "@/components/alerts/rca/RcaStageStepper.vue";
import RcaThreadStep from "@/components/alerts/rca/RcaThreadStep.vue";
import AutoResolveApprovalRequest from "@/components/autoresolve/AutoResolveApprovalRequest.vue";
import AutoResolveMissingConnection from "@/components/autoresolve/AutoResolveMissingConnection.vue";
import AutoResolveOutcome from "@/components/autoresolve/AutoResolveOutcome.vue";
import AutoResolveRemovedConnection from "@/components/autoresolve/AutoResolveRemovedConnection.vue";
import AutoResolveStepList from "@/components/autoresolve/AutoResolveStepList.vue";
import AutoResolveTurnLine from "@/components/autoresolve/AutoResolveTurnLine.vue";
import AutoResolveVerdictCheck from "@/components/autoresolve/AutoResolveVerdictCheck.vue";
import AutoResolveVerdicts from "@/components/autoresolve/AutoResolveVerdicts.vue";
import { useAutoResolveRun } from "@/composables/useAutoResolveRun";
import { useOrgId } from "@/composables/query/useOrgId";
import {
  autoresolveErrorApprovers,
  autoresolveErrorConnection,
  autoresolveErrorMessage,
  autoresolveErrorStatus,
  isConnectionRemovedRefusal,
  isTerminalRunState,
  type AutoResolveAddedConnection,
  type AutoResolveApprover,
  type AutoResolvePlanRevision,
  type AutoResolveReplanInput,
  type AutoResolveRunCorrection,
  type AutoResolveRunState,
  type AutoResolveStep,
} from "@/services/autoresolve";
import {
  approveAutoResolveRunMutation,
  declineAutoResolveRunMutation,
  postAutoResolveVerdictMutation,
  replanAutoResolveRunMutation,
} from "@/services/autoresolve.queries";
import productAnalytics from "@/services/product_analytics";
import store from "@/stores";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import {
  AUTORESOLVE_STAGES,
  addableConnection,
  approversSentence,
  asksVerdict,
  autoresolveDuration,
  autoresolveTime,
  autoresolveWhen,
  canUseSentence,
  checkRan,
  CORRECTION_KIND_KEY,
  deadlineText,
  investigationSummary,
  namesSentence,
  needsText,
  removedChips,
  runConnections,
  shownRunState,
  skippedStages,
  stageIndexFor,
  startedByText,
  stepResultView,
  theMcps,
} from "@/utils/autoresolve/autoresolveText";
import { isFinishedStep } from "@/utils/incidents/rcaThread";

interface TimelineEntry {
  key: string;
  /** The line's data-test suffix: one per kind of line, such as step or correction. */
  kind: string;
  at: number;
  title: I18nText;
  time: I18nText;
  /** One line each, cut to the panel's width. */
  details?: I18nText[];
  variant: TimelineItemVariant;
}

const ENDED_QUIETLY = new Set(["worked", "no_change"]);
/** A turn runs in these states, so the page's clock ticks each second. */
const LIVE_STATES: ReadonlySet<AutoResolveRunState> = new Set([
  "investigating",
  "proceeding",
  "checking",
]);
const WAITING_FOR_YOU_KEYS = [
  "autoresolve.run.facts.waitingForYou",
  "autoresolve.run.facts.waitingForYouOn",
] as const;
const WAITING_FOR_KEYS = [
  "autoresolve.run.facts.waitingFor",
  "autoresolve.run.facts.waitingForOn",
] as const;
const LAPSED_KEYS = ["autoresolve.run.facts.lapsedAt", "autoresolve.run.facts.lapsedOn"] as const;

const { t } = useI18nTyped();
const route = useRoute();
const orgId = useOrgId();

const runId = computed(() => String(route.params.id ?? ""));
const { run, reconnecting, error, errorStatus, refresh, retry } = useAutoResolveRun(runId);

const timezone = computed(() => store.state.timezone || "UTC");

const title = computed(() => {
  if (run.value) return raw(run.value.goal);
  return error.value ? t("autoresolve.runTitle") : raw("");
});
const subtitle = computed(() => (error.value ? raw("") : t("autoresolve.runTitle")));
const back = computed(() => ({
  label: t("autoresolve.title"),
  to: { name: "autoresolve", query: { tab: "runs", org_identifier: orgId.value } },
}));

const shownState = computed(() => (run.value ? shownRunState(run.value) : null));

const stageKey = computed(() =>
  run.value ? AUTORESOLVE_STAGES[stageIndexFor(run.value.state)].key : null,
);

const threadOpen = ref(false);
const stepsOpen = ref(true);
// A finished run leads with its outcome, so the calls start folded once it worked or needed nothing.
watch(
  () => run.value?.outcome?.verdict,
  (verdict) => (stepsOpen.value = !verdict || !ENDED_QUIETLY.has(verdict)),
  { immediate: true },
);

const investigation = computed(() => (run.value ? investigationSummary(run.value) : null));
// A later pass is headed by who asked again: the newest correction between the two plans.
const investigatedPasses = computed(() => {
  const passes = investigation.value?.passes ?? [];
  const corrections = run.value?.corrections ?? [];
  return passes
    .map((pass, i) => {
      if (!i) return { ...pass, heading: null };
      const after = passes[i - 1].endUs;
      const by = corrections
        .filter((c) => c.created_at_us >= after && c.created_at_us < pass.endUs)
        .sort((a, b) => a.created_at_us - b.created_at_us)
        .at(-1);
      const heading = by
        ? t(
            by.kind === "not_fixed"
              ? "autoresolve.run.passNotFixed"
              : "autoresolve.run.passCorrected",
            { name: raw(by.created_by), time: evidenceTime(by.created_at_us) },
          )
        : t("autoresolve.run.passPlannedAgain", { time: evidenceTime(pass.startUs) });
      return { ...pass, heading };
    })
    .filter((pass) => pass.steps.length);
});
const callsText = (calls: number, durationUs: number) =>
  t(
    "autoresolve.run.investigatedMeta",
    { count: calls, duration: autoresolveDuration(durationUs, t) },
    calls,
  );
// The current plan's hypotheses and cited reads; a replan's turn has not concluded yet.
const causeFindings = computed(() => {
  const current = run.value;
  const plan = current?.plan;
  if (!plan || current.state === "investigating") return null;
  const evidence = plan.evidence ?? [];
  const unverified = plan.unverified ?? [];
  if (!evidence.length && !unverified.length) return null;
  return { evidence, unverified, hypotheses: plan.hypotheses ?? [] };
});
const showInvestigation = computed(
  () =>
    (investigatedPasses.value.length > 0 || !!causeFindings.value) &&
    (run.value?.state !== "investigating" || !!run.value?.planned_at_us),
);
const investigatedMeta = computed(() => {
  const calls = investigation.value
    ? callsText(investigation.value.calls, investigation.value.durationUs)
    : null;
  const evidence = causeFindings.value?.evidence;
  if (!evidence) return calls ?? raw("");
  const decisive = evidence.filter((e) => e.decisive).length;
  const cited = t(
    "autoresolve.approval.evidenceSummary",
    { count: evidence.length, decisive },
    evidence.length,
  );
  return calls ? t("autoresolve.run.investigatedWithEvidence", { calls, cited }) : cited;
});

const investigationEl = ref<HTMLElement | null>(null);
const hypothesesEl = ref<InstanceType<typeof RcaHypotheses> | null>(null);
// The hypotheses and evidence lead inside the block. It grows open over a short animation and
// the column cannot scroll to it before that ends, so a closed block scrolls on animationend.
const showEvidence = async () => {
  const wasOpen = threadOpen.value;
  threadOpen.value = true;
  await nextTick();
  const block = investigationEl.value;
  const scroll = () => block?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  const content = block?.querySelector('[data-test="o-collapsible-content"]');
  if (wasOpen || !content) scroll();
  else content.addEventListener("animationend", scroll, { once: true });
};
// A weak grade or a citation that did not verify is the exception worth a look: it opens itself.
watch(
  () => run.value?.plan?.fingerprint,
  () => {
    const plan = run.value?.plan;
    if (plan && (plan.band === "low" || (plan.unverified?.length ?? 0) > 0)) {
      threadOpen.value = true;
    }
  },
  { immediate: true },
);

const chosenOption = computed(() =>
  run.value?.plan?.options.find((o) => o.id === run.value?.chosen_option_id),
);
const stepsTitle = computed(() =>
  chosenOption.value ? raw(chosenOption.value.title) : t("autoresolve.run.calls"),
);
const approvedLine = computed(() => {
  const current = run.value;
  if (!current?.approved_by || !current.approved_at_us) return null;
  return t("autoresolve.run.approvedBy", {
    name: raw(current.approved_by),
    time: evidenceTime(current.approved_at_us),
  });
});

const nowUs = ref(Date.now() * 1000);
let ticker: ReturnType<typeof setInterval> | undefined;
watch(
  () => !!run.value && (!!run.value.turn || LIVE_STATES.has(run.value.state)),
  (live) => {
    clearInterval(ticker);
    nowUs.value = Date.now() * 1000;
    ticker = live ? setInterval(() => (nowUs.value = Date.now() * 1000), 1000) : undefined;
  },
  { immediate: true },
);
onScopeDispose(() => clearInterval(ticker));

const stepLabels = (steps: AutoResolveStep[]) =>
  namesSentence(
    steps.map((s) => t("autoresolve.run.stepLabel", { seq: s.seq })),
    t,
  );

// These states' red notice carries the run's error, so the outcome card does not repeat it.
const ERROR_NOTICE_STATES: ReadonlySet<AutoResolveRunState> = new Set([
  "step_failed",
  "outcome_unknown",
  "failed",
]);

const outcomeCardError = computed(() => {
  const current = run.value;
  if (!current || ERROR_NOTICE_STATES.has(current.state)) return null;
  return current.outcome?.error?.trim() || null;
});

const stateNotice = computed<{ variant: InlineNoticeVariant; text: I18nText } | null>(() => {
  const current = run.value;
  if (!current) return null;
  const detail = current.outcome?.error?.trim() || current.outcome?.explanation?.trim();
  // The server's sentence can lead the notice, so it needs its own full stop.
  const reason = detail ? raw(/[.!?…]$/.test(detail) ? detail : `${detail}.`) : null;
  switch (current.state) {
    case "step_failed": {
      const failed = current.steps.find((s) => s.state === "failed");
      const ran = current.steps.filter((s) => s.state === "done");
      const notRun = current.steps.filter((s) => s.state === "not_run" || s.state === "approved");
      const params = {
        step: failed?.seq ?? "—",
        ran: ran.length ? stepLabels(ran) : t("autoresolve.run.notice.noSteps"),
        notRun: notRun.length ? stepLabels(notRun) : t("autoresolve.run.notice.noSteps"),
      };
      // With no other step either way, "Ran: none. Did not run: none." says nothing.
      if (!ran.length && !notRun.length) {
        return {
          variant: "error",
          text: reason ?? t("autoresolve.run.notice.stepFailedAlone", params),
        };
      }
      return {
        variant: "error",
        text: reason
          ? t("autoresolve.run.notice.stepFailedWith", { ...params, reason })
          : t("autoresolve.run.notice.stepFailed", params),
      };
    }
    case "outcome_unknown":
      return {
        variant: "error",
        text: reason
          ? t("autoresolve.run.notice.outcomeUnknownWith", { reason })
          : t("autoresolve.run.notice.outcomeUnknown"),
      };
    case "failed":
      return {
        variant: "error",
        text: reason
          ? t("autoresolve.run.notice.failedWith", { reason })
          : t("autoresolve.run.notice.failed"),
      };
    case "waiting_approval":
      // After a hold the new plan repeats the calls that already ran, as done.
      return current.plan?.options.some((o) => o.steps.some((s) => s.state === "done"))
        ? { variant: "warning", text: t("autoresolve.run.notice.held") }
        : null;
    default:
      return null;
  }
});

const showRequest = computed(() => {
  const current = run.value;
  if (!current?.plan) return false;
  if (current.state === "waiting_approval") return true;
  return (current.state === "lapsed" || current.state === "declined") && !current.approved_by;
});

const startedBy = computed(() =>
  run.value ? startedByText(run.value.trigger, run.value.requester) : raw(""),
);

// Connections a refused approval named as removed, until the run's own snapshot marks them.
const removedIds = ref<string[]>([]);
const connectionsUsed = computed(() =>
  run.value ? runConnections(run.value, new Set(removedIds.value)) : [],
);
const removedConnections = computed(() =>
  removedChips(
    connectionsUsed.value.filter((c) => c.removed).map((c) => c.name),
    t,
  ),
);
const canUse = computed(() =>
  canUseSentence(
    connectionsUsed.value.filter((c) => !c.removed).map((c) => c.name),
    t,
  ),
);
const notInAutoResolve = computed(() => {
  const names = run.value?.autoresolve ? (run.value.not_connected ?? []) : [];
  return names.length
    ? t("autoresolve.run.facts.notInAutoResolve", { mcps: theMcps(names, t) })
    : null;
});

const missingConnection = computed(() => (run.value ? addableConnection(run.value) : null));

// A person's verdict stays beside the agent's until the next attempt has its own outcome.
const shownVerdict = computed(() => {
  const current = run.value;
  const pv = current?.person_verdict;
  if (!current || !pv) return null;
  return pv.revision === current.revision || !current.outcome?.verdict ? pv : null;
});
const agentState = computed<AutoResolveRunState | null>(() => {
  const current = run.value;
  const fromVerdict = shownVerdict.value?.agent_verdict;
  if (fromVerdict) return fromVerdict;
  return current && isTerminalRunState(current.state) ? current.state : null;
});

// The server lets the requester, an approver or an admin decide.
const verdictRow = computed(
  () =>
    !!run.value &&
    asksVerdict(run.value, (store.state.userInfo as { email?: string } | null)?.email),
);

const canApprove = computed(() =>
  run.value ? approversSentence(run.value.approvers, t) : raw(""),
);

const optionFact = computed(() => {
  const current = run.value;
  if (!current) return raw("");
  if (chosenOption.value) return raw(chosenOption.value.title);
  return isTerminalRunState(current.state)
    ? t("autoresolve.run.facts.noneChosen")
    : t("autoresolve.run.facts.notChosen");
});

const approvalFact = computed(() => {
  const current = run.value;
  if (!current) return raw("");
  const deadline = current.approval_deadline_us;
  if (current.state === "waiting_approval" && deadline) {
    return current.can_approve
      ? deadlineText(deadline, WAITING_FOR_YOU_KEYS, t)
      : deadlineText(deadline, WAITING_FOR_KEYS, t, { names: canApprove.value });
  }
  if (current.state === "lapsed" && deadline) return deadlineText(deadline, LAPSED_KEYS, t);
  if (current.state === "declined") return t("autoresolve.state.declined");
  if (isTerminalRunState(current.state) && !current.approved_by && current.corrections?.length) {
    return t("autoresolve.run.facts.correctedNotApproved");
  }
  return isTerminalRunState(current.state)
    ? t("autoresolve.run.facts.notAskedEnded")
    : t("autoresolve.run.facts.notAsked");
});

const approvedFact = computed(() => {
  const current = run.value;
  if (!current?.approved_by || !current.approved_at_us) return null;
  if (current.state === "waiting_approval" && current.approval_deadline_us) return null;
  return { by: current.approved_by, atUs: current.approved_at_us };
});

const checkFact = computed(() => {
  const current = run.value;
  if (current?.state === "no_change" && checkRan(current)) {
    return t("autoresolve.run.facts.checkNotMet");
  }
  switch (current?.state) {
    case "checking":
      return t("autoresolve.run.facts.checkRunning");
    case "worked":
      return t("autoresolve.run.facts.checkMet");
    case "worse":
      return t("autoresolve.run.facts.checkNotMet");
    case "investigating":
    case "waiting_approval":
    case "proceeding":
      return t("autoresolve.run.facts.checkNotRun");
    default:
      return t("autoresolve.run.facts.checkDidNotRun");
  }
});

const evidenceTime = (us: number): string => autoresolveWhen(us).text;
const sameDay = (a: number, b: number) =>
  autoresolveTime(a, "YYYY-MM-DD") === autoresolveTime(b, "YYYY-MM-DD");

// One entry per sent step: sent and finished times share it, so the record reads one line per call.
const stepEvidence = (step: AutoResolveStep): TimelineEntry[] => {
  const params = { seq: step.seq, tool: raw(step.tool) };
  const failed = step.state === "failed";
  const view = stepResultView(failed ? step.error : step.result_summary);
  // JSON on one line shows raw keys; the step card holds it in full.
  const detail = view?.kind === "text" ? view.line : undefined;
  // A step refused before it was sent (its MCP unreachable or changed) still belongs in the record.
  if (!step.consumed_at_us && failed && step.finished_at_us) {
    return [
      {
        key: step.id,
        kind: "step",
        at: step.finished_at_us,
        title: detail
          ? t("autoresolve.run.evidence.stepFailedWith", { ...params, detail: raw(detail) })
          : t("autoresolve.run.evidence.stepFailed", params),
        time: raw(evidenceTime(step.finished_at_us)),
        variant: "destructive",
      },
    ];
  }
  if (!step.consumed_at_us) return [];
  const sent = evidenceTime(step.consumed_at_us);
  let title: I18nText = t("autoresolve.run.evidence.stepSent", params);
  if (step.finished_at_us && detail) {
    title = failed
      ? t("autoresolve.run.evidence.stepFailedWith", { ...params, detail: raw(detail) })
      : t("autoresolve.run.evidence.stepDoneWith", { ...params, detail: raw(detail) });
  } else if (step.finished_at_us) {
    title = failed
      ? t("autoresolve.run.evidence.stepFailed", params)
      : t("autoresolve.run.evidence.stepDone", params);
  }
  return [
    {
      key: step.id,
      kind: "step",
      at: step.consumed_at_us,
      title,
      time: step.finished_at_us
        ? t("autoresolve.run.evidence.span", {
            from: sent,
            to: sameDay(step.consumed_at_us, step.finished_at_us)
              ? autoresolveTime(step.finished_at_us)
              : evidenceTime(step.finished_at_us),
          })
        : raw(sent),
      variant: failed ? "destructive" : step.finished_at_us ? "success" : "primary",
    },
  ];
};

const correctionTitle = (c: AutoResolveRunCorrection): I18nText => {
  const name = raw(c.created_by);
  if (c.kind === "not_fixed") return t("autoresolve.run.evidence.planAgain", { name });
  const kind = t(CORRECTION_KIND_KEY[c.kind]);
  return c.option_title
    ? t("autoresolve.run.timeline.correctionOn", { name, kind, option: raw(c.option_title) })
    : t("autoresolve.run.evidence.correction", { name, kind });
};

const notFixedDetail = (c: AutoResolveRunCorrection): I18nText =>
  c.option_title
    ? t("autoresolve.run.timeline.notFixedOn", { option: raw(c.option_title), note: raw(c.note) })
    : t("autoresolve.run.evidence.notFixedNote", { note: raw(c.note) });

const correctionEvidence = (c: AutoResolveRunCorrection, idx: number): TimelineEntry => {
  const time = evidenceTime(c.created_at_us);
  return {
    key: `correction-${idx}`,
    kind: "correction",
    at: c.created_at_us,
    title: correctionTitle(c),
    details: [c.kind === "not_fixed" ? notFixedDetail(c) : raw(c.note)],
    time: c.remembered ? t("autoresolve.run.evidence.remembered", { time }) : raw(time),
    variant: "info",
  };
};

const addedEvidence = (a: AutoResolveAddedConnection, idx: number): TimelineEntry => {
  const params = { name: raw(a.by), mcp: theMcps([a.name], t) };
  const current = run.value;
  return {
    key: `connection-${idx}`,
    kind: "connection",
    at: a.at_us,
    title: current?.autoresolve
      ? t("autoresolve.run.evidence.connectionAdded", params)
      : t("autoresolve.run.evidence.connectionAddedRun", params),
    details: a.trigger_off ? [t("autoresolve.run.evidence.triggerOff")] : undefined,
    time: raw(evidenceTime(a.at_us)),
    variant: "info",
  };
};

const planEntry = (plan: AutoResolvePlanRevision): TimelineEntry => {
  const options = plan.options.map((o) =>
    o.band
      ? t("autoresolve.run.timeline.optionBand", {
          title: raw(o.title),
          band: t(`alerts.incidents.aiAnalysis.band.${o.band}`),
        })
      : raw(o.title),
  );
  const missing = plan.missing_capability;
  const details: I18nText[] = plan.cause ? [raw(plan.cause)] : [];
  if (options.length) details.push(namesSentence(options, t));
  else if (missing) details.push(needsText(missing, t) ?? raw(missing));
  return {
    key: `plan-${plan.revision}`,
    kind: "plan",
    at: plan.planned_at_us,
    title: t("autoresolve.run.timeline.planned"),
    time: raw(evidenceTime(plan.planned_at_us)),
    details,
    variant: "primary",
  };
};

const ATTEMPT_END_KEY: Partial<Record<AutoResolveRunState, I18nKey>> = {
  worked: "autoresolve.state.worked",
  no_change: "autoresolve.state.noChange",
  worse: "autoresolve.state.worse",
  outcome_unknown: "autoresolve.state.outcomeUnknown",
};

// A plan a replan moved past: its approval, the steps that ran and how it ended.
const attemptEntries = (plan: AutoResolvePlanRevision): TimelineEntry[] => {
  const attempt = plan.attempt;
  if (!attempt) return [];
  const items: TimelineEntry[] = [];
  if (attempt.approved_at_us) {
    const option = plan.options.find((o) => o.id === attempt.option_id);
    const name = raw(attempt.approved_by);
    items.push({
      key: `approved-${plan.revision}`,
      kind: "approved",
      at: attempt.approved_at_us,
      title: option
        ? t("autoresolve.run.evidence.approved", { name, option: raw(option.title) })
        : t("autoresolve.run.evidence.approvedPlan", { name }),
      time: raw(evidenceTime(attempt.approved_at_us)),
      variant: "primary",
    });
  }
  items.push(...attempt.steps.flatMap(stepEvidence));
  const endKey = ATTEMPT_END_KEY[attempt.state];
  if (attempt.ended_at_us && endKey) {
    items.push({
      key: `attempt-ended-${plan.revision}`,
      kind: "attempt-ended",
      at: attempt.ended_at_us,
      title: t("autoresolve.run.timeline.attemptEnded", { result: t(endKey) }),
      time: raw(evidenceTime(attempt.ended_at_us)),
      details: attempt.explanation ? [raw(attempt.explanation)] : undefined,
      variant: attempt.state === "worked" ? "success" : "muted",
    });
  }
  return items;
};

// A replan's live list holds only its own turn; the turns before it sit in "Investigated" above.
const liveSteps = computed(() => {
  const current = run.value;
  if (!current) return [];
  const asked = [
    ...(current.corrections ?? []).map((c) => c.created_at_us),
    ...(current.added_connections ?? []).map((c) => c.at_us),
  ];
  const replanFrom = current.turn?.started_at_us ?? (asked.length ? Math.max(...asked) : null);
  const from = current.planned_at_us ? replanFrom : null;
  if (from === null) return current.thread.steps;
  return current.thread.steps
    .map((s) => ({
      ...s,
      tool_calls: s.tool_calls.filter((c) => (c.started_at ?? s.started_at ?? from) >= from),
    }))
    .filter((s) => s.tool_calls.length || (s.started_at ?? from) >= from);
});
const threadIndex = (index: number) =>
  run.value?.thread.steps.findIndex((s) => s.index === index) ?? -1;

// The whole run in time order: what the agent investigated and proposed, and what people did.
const timeline = computed<TimelineEntry[]>(() => {
  const current = run.value;
  if (!current) return [];
  const asked = [
    ...(current.corrections ?? []).map(correctionEvidence),
    ...(current.added_connections ?? []).map(addedEvidence),
  ];
  // A first investigation still running has no pass to show yet; the main column shows it live.
  const passes =
    current.state === "investigating" && !current.planned_at_us
      ? []
      : (investigation.value?.passes ?? []);
  const items: TimelineEntry[] = [
    {
      key: "started",
      kind: "started",
      at: current.created_at_us,
      title: current.trigger.label
        ? raw(current.trigger.label)
        : t("autoresolve.run.evidence.started", { name: raw(current.requester) }),
      time: raw(evidenceTime(current.created_at_us)),
      variant: "muted",
    },
    ...asked,
    ...passes.map((pass, i): TimelineEntry => ({
      key: `pass-${i}`,
      kind: "investigated",
      at: pass.startUs,
      title: t("autoresolve.run.investigated"),
      time: raw(evidenceTime(pass.startUs)),
      details: [callsText(pass.calls, pass.durationUs)],
      variant: "muted",
    })),
    ...(current.plan_history ?? []).map(planEntry),
    ...(current.plan_history ?? []).flatMap(attemptEntries),
  ];
  if (current.approved_at_us) {
    items.push({
      key: "approved",
      kind: "approved",
      at: current.approved_at_us,
      title: chosenOption.value
        ? t("autoresolve.run.evidence.approved", {
            name: raw(current.approved_by),
            option: raw(chosenOption.value.title),
          })
        : t("autoresolve.run.evidence.approvedPlan", { name: raw(current.approved_by) }),
      time: raw(evidenceTime(current.approved_at_us)),
      variant: "primary",
    });
  }
  items.push(...current.steps.flatMap(stepEvidence));
  const fixed = current.person_verdict?.verdict === "fixed" ? current.person_verdict : null;
  if (fixed) {
    items.push({
      key: `verdict-${fixed.revision}`,
      kind: "verdict",
      at: fixed.at_us,
      title: t("autoresolve.run.evidence.markedFixed", { name: raw(fixed.by) }),
      time: raw(evidenceTime(fixed.at_us)),
      variant: "info",
    });
  }
  if (current.ended_at_us && isTerminalRunState(current.state)) {
    items.push({
      key: "ended",
      kind: "ended",
      at: current.ended_at_us,
      title: t("autoresolve.run.evidence.ended"),
      time: raw(evidenceTime(current.ended_at_us)),
      variant: current.state === "worked" ? "success" : "muted",
    });
  }
  if (current.state === "investigating" && asked.length) {
    const at = Math.max(...asked.map((a) => a.at));
    items.push({
      key: "planning-again",
      kind: "planning",
      at,
      title: t("autoresolve.run.evidence.planningAgain"),
      time: raw(evidenceTime(at)),
      variant: "primary",
    });
  }
  return items.sort((a, b) => a.at - b.at);
});

const approve = useMutation(() => approveAutoResolveRunMutation(orgId.value));
const decline = useMutation(() => declineAutoResolveRunMutation(orgId.value));
const replan = useMutation(() => replanAutoResolveRunMutation(orgId.value));
const submitting = computed(
  () => approve.isPending.value || decline.isPending.value || replan.isPending.value,
);

const reread = () =>
  void refresh().catch((err: unknown) => console.error("AutoResolve run refresh failed:", err));

const serverMessage = (err: unknown) => raw(autoresolveErrorMessage(err));

const refused = ref<{ optionId: string; approvers: AutoResolveApprover[] } | null>(null);
watch(
  () => run.value?.plan?.fingerprint,
  () => (refused.value = null),
);

// A failed decision is said where it was asked, in the button row, never in a toast.
const actionNotice = ref<{ variant: InlineNoticeVariant; text: I18nText } | null>(null);
const revertError = ref<I18nText | null>(null);
watch(
  () => run.value?.state,
  () => (actionNotice.value = null),
);

const onApprove = (optionId: string) => {
  const current = run.value;
  if (!current?.plan) return;
  const optionCount = current.plan.options.length;
  actionNotice.value = null;
  approve.mutate(
    { id: current.id, optionId, fingerprint: current.plan.fingerprint },
    {
      onSuccess: () => {
        productAnalytics.track("autoresolve_run_approved", { option_count: optionCount });
        reread();
      },
      onError: (err: unknown) => {
        const status = autoresolveErrorStatus(err);
        const removed = autoresolveErrorConnection(err);
        if (status === 403) {
          refused.value = { optionId, approvers: autoresolveErrorApprovers(err) };
        } else if (isConnectionRemovedRefusal(err) && removed) {
          if (!removedIds.value.includes(removed.id)) removedIds.value.push(removed.id);
        } else if (isConnectionRemovedRefusal(err)) {
          actionNotice.value = {
            variant: "error",
            text: serverMessage(err) || t("autoresolve.run.approveFailed"),
          };
        } else if (status === 409) {
          actionNotice.value = {
            variant: "warning",
            text: serverMessage(err) || t("autoresolve.run.planChanged"),
          };
        } else {
          actionNotice.value = {
            variant: "error",
            text: serverMessage(err) || t("autoresolve.run.approveFailed"),
          };
        }
        reread();
      },
    },
  );
};

const onDecline = () => {
  const current = run.value;
  if (!current) return;
  actionNotice.value = null;
  decline.mutate(
    { id: current.id, fingerprint: current.plan?.fingerprint ?? null },
    {
      onSuccess: reread,
      onError: (err: unknown) => {
        actionNotice.value = {
          variant: "error",
          text: serverMessage(err) || t("autoresolve.run.declineFailed"),
        };
        reread();
      },
    },
  );
};

const sendReplan = (
  body: AutoResolveReplanInput,
  onFailed: (text: I18nText) => void,
  onSent?: () => void,
) => {
  const current = run.value;
  if (!current) return;
  replan.mutate(
    { id: current.id, body },
    {
      onSuccess: () => {
        onSent?.();
        reread();
      },
      onError: (err: unknown) => {
        onFailed(serverMessage(err) || t("autoresolve.run.replanFailed"));
        reread();
      },
    },
  );
};

const replansSent = ref(0);
const onReplan = (body: AutoResolveReplanInput) => {
  actionNotice.value = null;
  const kind = body.kind;
  sendReplan(
    body,
    (text) => (actionNotice.value = { variant: "error", text }),
    () => {
      replansSent.value += 1;
      if (kind) productAnalytics.track("autoresolve_plan_corrected", { kind });
    },
  );
};

const router = useRouter();
const onSaveAs = () => {
  const current = run.value;
  if (!current) return;
  void router.push({
    name: "autoresolveSavedNew",
    query: { from_run: current.id, org_identifier: orgId.value },
  });
};
const onRevert = () => {
  revertError.value = null;
  sendReplan({ note: t("autoresolve.run.revertNote") }, (text) => (revertError.value = text));
};

const verdict = useMutation(() => postAutoResolveVerdictMutation(orgId.value));
const verdictNotice = ref<{ variant: InlineNoticeVariant; text: I18nText } | null>(null);
const verdictSubmitting = computed<"fixed" | "not_fixed" | null>(() => {
  if (verdict.isPending.value) return "fixed";
  return replan.isPending.value ? "not_fixed" : null;
});
watch(
  () => run.value?.state,
  () => (verdictNotice.value = null),
);

const onFixed = () => {
  const current = run.value;
  if (!current) return;
  verdictNotice.value = null;
  verdict.mutate(current.id, {
    onSuccess: () => {
      productAnalytics.track("autoresolve_verdict_given", { verdict: "fixed" });
      reread();
    },
    onError: (err: unknown) => {
      verdictNotice.value = {
        variant: "error",
        text: serverMessage(err) || t("autoresolve.verdict.failed"),
      };
      reread();
    },
  });
};

const onNotFixed = (body: AutoResolveReplanInput) => {
  verdictNotice.value = null;
  sendReplan(
    body,
    (text) => (verdictNotice.value = { variant: "error", text }),
    () => productAnalytics.track("autoresolve_verdict_given", { verdict: "not_fixed" }),
  );
};
</script>
