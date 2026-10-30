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
  <section
    data-test="rca-verdict-card"
    class="border-border-default flex flex-col gap-3 border-b pb-5"
  >
    <div class="flex flex-wrap items-center gap-2.5">
      <RcaPill
        data-test="rca-verdict-state"
        :tone="pill.tone"
        :icon="pill.icon"
        :spinner="pill.spinner"
      >
        {{ pill.label }}
      </RcaPill>
      <span
        v-if="qualifier"
        data-test="rca-verdict-qualifier"
        class="text-text-secondary text-compact font-semibold"
      >
        {{ qualifier }}
      </span>
    </div>

    <!-- A completed run that a responder's answer unblocked. -->
    <p
      v-if="unblockedText"
      data-test="rca-verdict-unblocked"
      class="text-status-warning-text text-compact m-0 font-semibold"
    >
      {{ unblockedText }}
    </p>

    <h2
      data-test="rca-verdict-headline"
      class="text-text-heading m-0 max-w-215 text-2xl leading-tight font-bold [text-wrap:pretty]"
    >
      <RcaInlineText :text="headline" />
    </h2>

    <p
      v-if="belowHeadline"
      data-test="rca-verdict-below"
      class="text-text-secondary text-compact m-0 font-semibold"
    >
      <RcaInlineText :text="belowHeadline" />
    </p>

    <!-- Several root causes: each with its onset and its own band. -->
    <ol
      v-if="causes.length"
      data-test="rca-verdict-causes"
      :aria-label="t('alerts.incidents.rcaSummary.rootCauses')"
      class="m-0 flex max-w-225 list-none flex-col gap-1 p-0"
    >
      <li v-for="cause in causes" :key="cause.id" data-test="rca-verdict-cause" class="text-sm">
        <span class="text-text-heading font-semibold">
          <RcaInlineText :text="cause.statement" />
        </span>
        <span data-test="rca-verdict-cause-meta" class="text-text-secondary text-xs">
          · {{ causeMeta(cause) }}
        </span>
      </li>
    </ol>

    <!-- Confidence line: graded and partial runs only, never while live. -->
    <div
      v-if="showConfidence"
      data-test="rca-verdict-confidence"
      class="flex max-w-225 flex-wrap items-center gap-2 text-sm"
    >
      <component
        :is="unverifiedCount > 0 ? 'button' : 'span'"
        data-test="rca-verdict-band"
        :data-band="card?.band ?? 'none'"
        :type="unverifiedCount > 0 ? 'button' : undefined"
        class="text-text-heading inline-flex items-center gap-2 border-none bg-transparent p-0 font-bold"
        :class="{ 'cursor-pointer hover:underline': unverifiedCount > 0 }"
        @click="unverifiedCount > 0 && $emit('show-unverified')"
      >
        <span class="inline-flex h-3 items-end gap-0.5" aria-hidden="true">
          <span
            v-for="bar in 3"
            :key="bar"
            class="w-1 rounded-xs"
            :class="[
              BAR_HEIGHT[bar - 1],
              bar <= rcaBandLevel(card?.band) ? 'bg-accent' : 'bg-border-default',
            ]"
          />
        </span>
        {{ rcaBandLabel(card?.band) }}
      </component>
      <span
        v-if="unverifiedCount > 0"
        data-test="rca-verdict-unverified-count"
        class="text-status-warning-text text-xs font-semibold"
      >
        {{
          t(
            "alerts.incidents.rcaSummary.unverifiedCount",
            { count: unverifiedCount },
            unverifiedCount,
          )
        }}
      </span>
      <button
        v-if="blindSpotCount > 0"
        type="button"
        data-test="rca-verdict-blind-link"
        class="text-status-warning-text text-compact inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 font-semibold hover:underline"
        @click="$emit('show-blind-spots')"
      >
        <OIcon name="visibility-off" size="sm" />
        {{
          t(
            "alerts.incidents.rcaSummary.blindSpotsBelow",
            { count: blindSpotCount },
            blindSpotCount,
          )
        }}
      </button>
    </div>

    <!-- What the agent claimed, what the evidence allows and why, and any cap. -->
    <dl
      v-if="breakdown"
      data-test="rca-verdict-confidence-why"
      class="text-compact m-0 -mt-1 grid max-w-225 grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-0.5"
    >
      <dt class="text-text-secondary">{{ t("alerts.incidents.rcaSummary.confidenceClaimed") }}</dt>
      <dd data-test="rca-confidence-claimed" class="text-text-heading m-0 font-semibold">
        {{ bandWord(breakdown.claimed) }}
      </dd>
      <dt class="text-text-secondary">{{ t("alerts.incidents.rcaSummary.confidenceEvidence") }}</dt>
      <dd data-test="rca-confidence-evidence" class="text-text-secondary m-0">
        <span class="text-text-heading font-semibold">{{ bandWord(breakdown.evidence) }}</span>
        · {{ evidenceText }}
      </dd>
      <template v-if="breakdown.caps.length > 0">
        <dt class="text-text-secondary">
          {{ t("alerts.incidents.rcaSummary.confidenceCapped", { band: bandWord("medium") }) }}
        </dt>
        <dd data-test="rca-confidence-caps" class="text-text-secondary m-0">
          {{ breakdown.caps.join(", ") }}
        </dd>
      </template>
    </dl>

    <RcaStageStepper
      v-if="cardState === 'investigating'"
      :stage-index="stageIndex"
      :stage="stage"
    />

    <dl
      v-if="graded"
      data-test="rca-verdict-facts"
      class="m-0 mt-0.5 flex min-w-0 flex-wrap items-start gap-8"
    >
      <div v-if="suspectText" class="max-w-105 min-w-0">
        <dt class="text-text-secondary text-xs">
          {{ t("alerts.incidents.rcaSummary.suspectChange") }}
        </dt>
        <dd data-test="rca-verdict-suspect" class="text-text-heading m-0 text-sm font-semibold">
          {{ suspectText }}
        </dd>
      </div>
      <div class="max-w-95 min-w-0">
        <dt class="text-text-secondary text-xs">{{ t("alerts.incidents.rcaSummary.impact") }}</dt>
        <dd data-test="rca-verdict-impact" class="text-text-heading m-0 text-sm font-semibold">
          <RcaInlineText :text="impactText" />
        </dd>
      </div>
      <div v-if="impactedServices.length" class="max-w-105 min-w-0">
        <dt class="text-text-secondary text-xs">
          {{ t("alerts.incidents.rcaSummary.impactedServices") }}
        </dt>
        <dd
          data-test="rca-verdict-services"
          class="text-text-heading m-0 text-sm font-semibold break-words"
        >
          {{ impactedServices.join(", ") }}
        </dd>
      </div>
    </dl>

    <!-- The server refused to start a run (AI credits, paid usage declined); no run records it. -->
    <RcaBlockedBanner
      v-if="refusal"
      :refusal="refusal"
      :retrying="triggering || resuming"
      @retry="refusal.retry ? $emit('retry', refusal.retry) : $emit('resume')"
    />

    <!-- The run is paused for an answer; the deadline is local time. -->
    <OBanner
      v-else-if="cardState === 'investigating' && waitingInput"
      data-test="rca-paused-banner"
      variant="warning"
      icon="pause-circle-filled"
      inline-actions
    >
      <p data-test="rca-paused-title" class="text-banner-warning-text m-0 text-sm font-semibold">
        {{
          pausedStep
            ? t("alerts.incidents.rcaSteer.paused.after", { step: pausedStep })
            : t("alerts.incidents.rcaSteer.paused.title")
        }}
      </p>
      <p
        v-if="pausedQuestion"
        data-test="rca-paused-question"
        class="text-banner-warning-text m-0 mt-0.5 text-sm break-words"
      >
        {{ pausedQuestion }}
      </p>
      <p data-test="rca-paused-deadline" class="text-banner-warning-text m-0 mt-0.5 text-sm">
        {{
          deadlineText
            ? t("alerts.incidents.rcaSteer.paused.waitsUntil", { time: deadlineText })
            : t("alerts.incidents.rcaSteer.paused.waits")
        }}
      </p>
      <template #actions>
        <OButton
          v-if="canSteer"
          data-test="rca-paused-tell-agent-btn"
          variant="outline"
          size="sm"
          icon-left="chat"
          @click="$emit('tell-agent')"
        >
          {{ t("alerts.incidents.rcaSteer.paused.tellAgent") }}
        </OButton>
        <OButton
          v-if="connectToolsetRoute"
          data-test="rca-paused-connect-btn"
          variant="outline"
          size="sm"
          icon-left="link"
          @click="openConnectToolset"
        >
          {{ t("alerts.incidents.rcaSummary.fix.connectToolset") }}
        </OButton>
      </template>
    </OBanner>

    <!-- Stale live run; it can still be cancelled. -->
    <OBanner
      v-else-if="cardState === 'investigating' && stale"
      data-test="rca-stale-banner"
      variant="warning"
      icon="warning"
      inline-actions
    >
      <p data-test="rca-stale-message" class="text-banner-warning-text m-0 text-sm">
        {{ t("alerts.incidents.rcaRun.stale", { time: staleSince }) }}
      </p>
      <template #actions>
        <OButton
          data-test="rca-stale-cancel-btn"
          variant="outline"
          size="sm"
          :loading="cancelling"
          @click="$emit('cancel')"
        >
          {{ t("alerts.incidents.rcaRun.cancelRun") }}
        </OButton>
      </template>
    </OBanner>

    <!-- A re-run of an analyzed incident, or a resumed run, is live. -->
    <OBanner
      v-else-if="cardState === 'investigating' && (hasEarlierReport || liveResumeStep)"
      data-test="rca-reanalyzing-banner"
      variant="info"
      inline-actions
    >
      <template #icon>
        <OSpinner size="xs" />
      </template>
      <p data-test="rca-reanalyzing-message" class="text-banner-info-text m-0 text-sm font-medium">
        {{ reanalyzingText }}
      </p>
      <template #actions>
        <OButton
          data-test="rca-follow-thread-btn"
          variant="outline"
          size="sm"
          @click="$emit('follow-thread')"
        >
          {{ t("alerts.incidents.rcaRun.followInThread") }}
        </OButton>
        <OButton
          data-test="rca-banner-cancel-btn"
          variant="outline"
          size="sm"
          :loading="cancelling"
          @click="$emit('cancel')"
        >
          {{ t("alerts.incidents.rcaCancel") }}
        </OButton>
      </template>
    </OBanner>

    <!-- The latest run failed; the reason leads, details stay collapsed. -->
    <OBanner
      v-else-if="cardState === 'failed'"
      data-test="rca-error-banner"
      variant="error-soft"
      icon="error-outline"
      inline-actions
    >
      <p data-test="rca-error-reason" class="text-banner-error-soft-text m-0 text-sm font-medium">
        {{ error?.reason || t("alerts.incidents.rcaFailed") }}
      </p>
      <template v-if="error?.details">
        <button
          type="button"
          data-test="rca-error-details-toggle"
          class="text-banner-error-soft-text mt-1 cursor-pointer self-start border-none bg-transparent p-0 text-xs underline"
          :aria-expanded="showErrorDetails"
          :aria-controls="errorDetailsId"
          @click="showErrorDetails = !showErrorDetails"
        >
          {{
            showErrorDetails
              ? t("alerts.incidents.rcaRun.hideDetails")
              : t("alerts.incidents.rcaRun.showDetails")
          }}
        </button>
        <p
          v-if="showErrorDetails"
          :id="errorDetailsId"
          data-test="rca-error-details"
          class="text-banner-error-soft-text m-0 mt-1 text-xs break-words whitespace-pre-wrap"
        >
          {{ error.details }}
        </p>
      </template>
      <template #actions>
        <OButton
          v-if="canResume"
          data-test="rca-resume-btn"
          variant="outline"
          size="sm"
          icon-left="play-arrow"
          :loading="resuming"
          :disabled="triggering"
          @click="$emit('resume')"
        >
          {{ t("alerts.incidents.rcaResume.button") }}
        </OButton>
        <ODropdown v-if="hasEarlierReport" align="end">
          <template #trigger>
            <OButton
              data-test="rca-retry-btn"
              variant="outline"
              size="sm"
              :loading="triggering"
              :disabled="resuming"
            >
              <OIcon name="refresh" size="sm" class="me-1" />
              {{ t("alerts.incidents.rcaRetry") }}
              <OIcon name="keyboard-arrow-down" size="xs" class="ms-1" />
            </OButton>
          </template>
          <ODropdownItem
            v-for="option in retryOptions"
            :key="option.dataTest"
            :data-test="option.dataTest"
            :description="reanalyzeCostLabel ?? undefined"
            @select="$emit('retry', { buildOnPrevious: option.buildOnPrevious })"
          >
            {{ option.label }}
          </ODropdownItem>
        </ODropdown>
        <OButton
          v-else
          data-test="rca-retry-btn"
          variant="outline"
          size="sm"
          :loading="triggering"
          :disabled="resuming"
          @click="$emit('retry', { buildOnPrevious: false })"
        >
          <OIcon name="refresh" size="sm" class="me-1" />
          {{ t("alerts.incidents.rcaRetry") }}
        </OButton>
      </template>
    </OBanner>

    <!-- The latest run was cancelled; its partial thread stays readable. -->
    <OBanner
      v-else-if="cardState === 'cancelled'"
      data-test="rca-cancelled-banner"
      variant="error-soft"
      icon="cancel"
      inline-actions
    >
      <p data-test="rca-cancelled-message" class="text-banner-error-soft-text m-0 text-sm">
        {{ cancelledText }}
      </p>
      <template v-if="canResume" #actions>
        <OButton
          data-test="rca-resume-btn"
          variant="outline"
          size="sm"
          icon-left="play-arrow"
          :loading="resuming"
          :disabled="triggering"
          @click="$emit('resume')"
        >
          {{ t("alerts.incidents.rcaResume.button") }}
        </OButton>
      </template>
    </OBanner>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type {
  RcaBand,
  RcaChangeKind,
  RcaRunError,
  RcaRunMode,
  RcaRunSummary,
  RcaSummaryCause,
  RcaVerdictDetails,
} from "@/services/incidents";
import {
  RCA_OUTCOME_PILL,
  rcaBandLabel,
  rcaBandLevel,
  rcaUtcRange,
  type RcaPillTone,
} from "@/utils/incidents/rcaSummary";
import { formatTimestampInTimezone } from "@/utils/date";
import { rcaBlindSpotRoute } from "@/utils/incidents/rcaEvidenceLinks";
import type { RcaCardState } from "@/utils/incidents/rcaThread";
import type { RcaUnblockedLine } from "@/utils/incidents/rcaSteering";
import type { RcaRefusal } from "@/composables/useIncidentRca";
import RcaBlockedBanner from "./RcaBlockedBanner.vue";
import RcaInlineText from "./RcaInlineText.vue";
import RcaPill from "./RcaPill.vue";
import RcaStageStepper from "./RcaStageStepper.vue";

const props = withDefaults(
  defineProps<{
    cardState: RcaCardState;
    /** Identifies the run the card shows; resets the error details toggle. */
    runId: string;
    /** The shown run is live and waits for an answer. */
    waitingInput?: boolean;
    summary?: RcaRunSummary | null;
    stale?: boolean;
    /** "HH:MM:SS" of the stale run's last update. */
    staleSince?: string;
    stageIndex?: number | null;
    stage?: string | null;
    /** Mode of the live run, for the M banner. */
    liveMode?: RcaRunMode | null;
    /** Title of the step the live run resumed from; set only for a resumed run. */
    liveResumeStep?: string | null;
    /** Mode of the failed run; Retry offers it first. */
    failedMode?: RcaRunMode | null;
    /** A completed run precedes the latest one: M shows, and Retry offers both modes. */
    hasEarlierReport?: boolean;
    error?: RcaRunError | null;
    /** The full E message. */
    cancelledText?: I18nText | null;
    triggering?: boolean;
    cancelling?: boolean;
    /** The latest failed or cancelled run can be resumed (J9): L and E offer "Resume run". */
    canResume?: boolean;
    resuming?: boolean;
    /** Organization of the incident, for the "Connect AI Toolset" link. */
    org?: string;
    /** The user can steer the run: the paused banner offers "Tell the agent". */
    canSteer?: boolean;
    /** Title of the step the paused run stopped after. */
    pausedStep?: string | null;
    /** The agent's open question. */
    pausedQuestion?: string | null;
    /** Answer deadline of the paused run in local "HH:mm <zone>". */
    deadlineText?: string | null;
    /** A completed run unblocked by an answer. */
    unblocked?: RcaUnblockedLine | null;
    /** A refused trigger or resume: the blocked banner replaces the others. */
    refusal?: RcaRefusal | null;
    /** AI credits a re-analysis uses; unset outside cloud. */
    reanalyzeCreditCost?: number | null;
    /** Impacted services of the shown completed run's verdict. */
    verdictDetails?: RcaVerdictDetails | null;
  }>(),
  {
    waitingInput: false,
    summary: null,
    stale: false,
    staleSince: "",
    stageIndex: null,
    stage: null,
    liveMode: null,
    liveResumeStep: null,
    failedMode: null,
    hasEarlierReport: false,
    error: null,
    cancelledText: null,
    triggering: false,
    cancelling: false,
    canResume: false,
    resuming: false,
    org: "",
    canSteer: false,
    pausedStep: null,
    pausedQuestion: null,
    deadlineText: null,
    unblocked: null,
    refusal: null,
    reanalyzeCreditCost: null,
    verdictDetails: null,
  },
);

defineEmits<{
  cancel: [];
  "follow-thread": [];
  retry: [options: { buildOnPrevious: boolean; guidance?: string }];
  /** The band chip: open "Cited but not verified". */
  "show-unverified": [];
  /** "N blind spots below". */
  "show-blind-spots": [];
  /** "Tell the agent": focus the steer box. */
  "tell-agent": [];
  /** "Resume run" on a failed or cancelled run. */
  resume: [];
}>();

const { t } = useI18nTyped();
const router = useRouter();

/** "Connect AI Toolset" when a blind spot of the run asks for one. */
const connectToolsetRoute = computed(() =>
  props.summary?.blind_spots.some((spot) => spot.fix === "connect_toolset")
    ? rcaBlindSpotRoute("connect_toolset", props.org)
    : null,
);
const openConnectToolset = () => {
  if (connectToolsetRoute.value) void router.push(connectToolsetRoute.value);
};

const unblockedText = computed<I18nText | null>(() => {
  const line = props.unblocked;
  if (!line || props.cardState !== "analyzed") return null;
  return line.need
    ? t("alerts.incidents.rcaSteer.unblockedWithNeed", {
        author: line.author,
        time: line.time,
        need: line.need,
      })
    : t("alerts.incidents.rcaSteer.unblocked", { author: line.author, time: line.time });
});

/** Heights of the three band bars (redesign glyph). */
const BAR_HEIGHT = ["h-1.5", "h-2.25", "h-3"] as const;

const card = computed(() => props.summary?.card ?? null);
const live = computed(() => props.cardState === "investigating");
/** A completed run with a derived outcome. */
const outcome = computed(() =>
  props.cardState === "analyzed" ? (card.value?.outcome ?? null) : null,
);
/** A failed or cancelled run with a stored partial record. */
const partial = computed(
  () => (props.cardState === "failed" || props.cardState === "cancelled") && !!props.summary,
);
const graded = computed(() => outcome.value !== null);

/** A graded run's stored impacted services. */
const impactedServices = computed(() =>
  graded.value ? (props.verdictDetails?.impactedServices ?? []) : [],
);

const pill = computed<{
  tone: RcaPillTone;
  icon: IconName | null;
  spinner: boolean;
  label: I18nText;
}>(() => {
  if (outcome.value) {
    const view = RCA_OUTCOME_PILL[outcome.value];
    return { tone: view.tone, icon: view.icon, spinner: false, label: t(view.key) };
  }
  switch (props.cardState) {
    case "investigating":
      return props.waitingInput
        ? {
            tone: "warn",
            icon: "block",
            spinner: false,
            label: t("alerts.incidents.rcaRun.state.waitingInput"),
          }
        : {
            tone: "neutral",
            icon: null,
            spinner: true,
            label: t("alerts.incidents.rcaRun.state.investigating"),
          };
    case "analyzed":
      return {
        tone: "ok",
        icon: "check-circle",
        spinner: false,
        label: t("alerts.incidents.rcaRun.state.analyzed"),
      };
    case "failed":
      return {
        tone: "err",
        icon: "error",
        spinner: false,
        label: t("alerts.incidents.rcaRun.state.failed"),
      };
    default:
      return {
        tone: "err",
        icon: "cancel",
        spinner: false,
        label: t("alerts.incidents.rcaRun.state.cancelled"),
      };
  }
});

/** The M banner line: a resumed run names its step, a re-run names its mode. */
const reanalyzingText = computed<I18nText>(() => {
  if (props.liveResumeStep) {
    return t("alerts.incidents.rcaRun.resumingFrom", { step: props.liveResumeStep });
  }
  return props.liveMode === "build_on_previous"
    ? t("alerts.incidents.rcaRun.reanalyzingBuildOnPrevious")
    : t("alerts.incidents.rcaRun.reanalyzingFresh");
});

/** Next to the pill: the live label or the inconclusive qualifier. */
const qualifier = computed<I18nText | null>(() => {
  if (live.value) {
    const soFar = card.value?.verdict_so_far;
    if (!soFar || !card.value?.leading) return null;
    return soFar.label === "revised" && soFar.was
      ? t("alerts.incidents.rcaSummary.verdictSoFarRevised", { was: soFar.was })
      : t("alerts.incidents.rcaSummary.verdictSoFarPreliminary");
  }
  return outcome.value === "inconclusive" && card.value?.headline
    ? t("alerts.incidents.rcaSummary.suspectedNotConfirmed")
    : null;
});

const headline = computed<I18nText>(() => {
  if (live.value) {
    if (!props.summary) return t("alerts.incidents.rcaRun.headline.investigating");
    const leading = card.value?.leading;
    return leading
      ? t("alerts.incidents.rcaSummary.leading", { statement: leading.statement })
      : t("alerts.incidents.rcaSummary.noLeadingYet");
  }
  if (outcome.value) {
    if (card.value?.headline) return raw(card.value.headline);
    return outcome.value === "inconclusive"
      ? t("alerts.incidents.rcaSummary.noHypothesisRecorded")
      : t("alerts.incidents.rcaRun.headline.analyzed");
  }
  if (partial.value) {
    return props.cardState === "cancelled"
      ? t("alerts.incidents.rcaSummary.cancelledBeforeVerdict")
      : t("alerts.incidents.rcaSummary.failedBeforeVerdict");
  }
  switch (props.cardState) {
    case "analyzed":
      return t("alerts.incidents.rcaRun.headline.analyzed");
    case "failed":
      return t("alerts.incidents.rcaRun.headline.failed");
    default:
      return t("alerts.incidents.rcaRun.headline.cancelled");
  }
});

/** Under the headline: contributing factor and blocked runs. */
const belowHeadline = computed<I18nText | null>(() => {
  if (outcome.value === "contributing_factor") {
    return t("alerts.incidents.rcaSummary.noSingleRootCause");
  }
  if (outcome.value === "blocked") {
    return card.value?.needs
      ? t("alerts.incidents.rcaSummary.needs", { needs: card.value.needs })
      : t("alerts.incidents.rcaSummary.needsInput");
  }
  return null;
});

const showConfidence = computed(() => graded.value || partial.value);

/** The root causes of a run with several; empty otherwise. */
const causes = computed(() =>
  outcome.value === "multiple_root_causes" ? (card.value?.causes ?? []) : [],
);
/** "from 14:02 UTC · Medium confidence"; a cause with no onset shows only its band. */
const causeMeta = (cause: RcaSummaryCause): I18nText => {
  const parts: string[] = [];
  if (typeof cause.onset_us === "number") {
    parts.push(
      t("alerts.incidents.rcaSummary.causeOnset", {
        time: formatTimestampInTimezone(cause.onset_us, "HH:mm", "UTC"),
      }),
    );
  }
  parts.push(rcaBandLabel(cause.band));
  return raw(parts.join(" · "));
};
const breakdown = computed(() => (graded.value ? (card.value?.confidence ?? null) : null));
const BAND_WORD: Record<RcaBand, I18nText> = {
  high: t("alerts.incidents.aiAnalysis.band.high"),
  medium: t("alerts.incidents.aiAnalysis.band.medium"),
  low: t("alerts.incidents.aiAnalysis.band.low"),
};
const bandWord = (band: RcaBand) => BAND_WORD[band];
/** "1 decisive source (logs) · High needs a second decisive source …" */
const evidenceText = computed(() => {
  const value = breakdown.value;
  if (!value) return "";
  return value.next_level
    ? `${value.evidence_reason} · ${value.next_level}`
    : value.evidence_reason;
});
const unverifiedCount = computed(() =>
  showConfidence.value ? (props.summary?.unverified.length ?? 0) : 0,
);
const blindSpotCount = computed(() =>
  showConfidence.value ? (props.summary?.blind_spots.length ?? 0) : 0,
);

const CHANGE_KIND: Record<RcaChangeKind, I18nText> = {
  deploy: t("alerts.incidents.rcaSummary.changeKind.deploy"),
  commit: t("alerts.incidents.rcaSummary.changeKind.commit"),
  config_change: t("alerts.incidents.rcaSummary.changeKind.configChange"),
  feature_flag: t("alerts.incidents.rcaSummary.changeKind.featureFlag"),
  infra: t("alerts.incidents.rcaSummary.changeKind.infra"),
};

/** "Deploy 4f2c1e · 14:02 UTC (diff not read) (from a.rao)"; null hides the row. */
const suspectText = computed<I18nText | null>(() => {
  const change = card.value?.suspect_change;
  if (!change) return null;
  const parts = [
    t("alerts.incidents.rcaSummary.suspectRef", {
      kind: CHANGE_KIND[change.kind],
      reference: change.reference,
      time: formatTimestampInTimezone(change.occurred_at, "HH:mm", "UTC"),
    }),
  ];
  if (change.shown_state === "not_read") parts.push(t("alerts.incidents.rcaSummary.diffNotRead"));
  if (change.lead_author) {
    parts.push(t("alerts.incidents.rcaSummary.fromAuthor", { author: change.lead_author }));
  }
  return raw(parts.join(" "));
});

/** "3 services · peak 4.1% 5xx · 14:04–14:31 UTC" */
const impactText = computed<I18nText>(() => {
  const impact = card.value?.impact;
  if (!impact) return t("alerts.incidents.rcaSummary.noImpact");
  const parts: string[] = [impact.summary];
  if (impact.peak) parts.push(t("alerts.incidents.rcaSummary.peak", { peak: impact.peak }));
  if (impact.window) parts.push(rcaUtcRange(impact.window.start, impact.window.end));
  return raw(parts.join(" · "));
});

// Details stay collapsed for every new failure.
const showErrorDetails = ref(false);
const errorDetailsId = useId();
watch(
  () => props.runId,
  () => (showErrorDetails.value = false),
);

// Retry offers both modes, the failed run's mode first.
const retryOptions = computed(() => {
  const fresh = {
    buildOnPrevious: false,
    dataTest: "rca-retry-fresh",
    label: t("alerts.incidents.rcaFreshAnalysis"),
  };
  const build = {
    buildOnPrevious: true,
    dataTest: "rca-retry-build",
    label: t("alerts.incidents.rcaBuildOnPrevious"),
  };
  return props.failedMode === "build_on_previous" ? [build, fresh] : [fresh, build];
});

const reanalyzeCostLabel = computed<I18nText | null>(() => {
  const cost = props.reanalyzeCreditCost;
  return cost ? t("alerts.incidents.rcaCreditCost", { cost }, cost) : null;
});
</script>
