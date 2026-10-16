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

<!-- Verdict card, Phase 2 form (contract E5): state pill, headline, the stage
     stepper while live (02 TH37) and the banners of TH40 (M, L, N, E). No band,
     no credits. Phase 3 adds the cause, confidence and facts. -->
<template>
  <section
    data-test="rca-verdict-card"
    class="border-border-default flex flex-col gap-3 border-b pb-5"
  >
    <div class="flex items-center gap-2">
      <OBadge
        data-test="rca-verdict-state"
        :variant="pill.variant"
        :icon="pill.icon ?? undefined"
        size="sm"
      >
        <template v-if="cardState === 'investigating'" #icon>
          <OSpinner size="xs" />
        </template>
        {{ pill.label }}
      </OBadge>
    </div>

    <h2
      data-test="rca-verdict-headline"
      class="text-text-heading m-0 text-2xl leading-tight font-bold"
    >
      {{ headline }}
    </h2>

    <RcaStageStepper
      v-if="cardState === 'investigating'"
      :stage-index="stageIndex"
      :stage="stage"
    />

    <!-- N: stale live run (01 RR-19); it can still be cancelled. -->
    <OBanner
      v-if="cardState === 'investigating' && stale"
      data-test="rca-stale-banner"
      variant="warning"
      icon="warning"
      inline-actions
    >
      <p data-test="rca-stale-message" class="text-banner-warning-text m-0 text-sm">
        {{ t("alerts.incidents.rcaRun.stale", { time: staleSince }) }}
      </p>
      <p
        v-if="earlierReportNote"
        data-test="rca-earlier-report-note"
        class="text-banner-warning-text m-0 mt-0.5 text-xs"
      >
        {{ earlierReportNote }}
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

    <!-- M: a re-run is live and an earlier report stays readable below. -->
    <OBanner
      v-else-if="cardState === 'investigating' && earlierReportNote"
      data-test="rca-reanalyzing-banner"
      variant="info"
      inline-actions
    >
      <template #icon>
        <OSpinner size="xs" />
      </template>
      <p data-test="rca-reanalyzing-message" class="text-banner-info-text m-0 text-sm font-medium">
        {{
          liveMode === "build_on_previous"
            ? t("alerts.incidents.rcaRun.reanalyzingBuildOnPrevious")
            : t("alerts.incidents.rcaRun.reanalyzingFresh")
        }}
      </p>
      <p data-test="rca-earlier-report-note" class="text-banner-info-text m-0 mt-0.5 text-xs">
        {{ earlierReportNote }}
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

    <!-- L: the latest run failed (01 RR-47); the reason leads, details stay collapsed. -->
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
      <p
        v-if="earlierReportNote"
        data-test="rca-earlier-report-note"
        class="text-banner-error-soft-text m-0 mt-0.5 text-xs"
      >
        {{ earlierReportNote }}
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
        <ODropdown v-if="earlierReportNote" align="end">
          <template #trigger>
            <OButton data-test="rca-retry-btn" variant="outline" size="sm" :loading="triggering">
              <OIcon name="refresh" size="sm" class="me-1" />
              {{ t("alerts.incidents.rcaRetry") }}
              <OIcon name="keyboard-arrow-down" size="xs" class="ms-1" />
            </OButton>
          </template>
          <ODropdownItem
            v-for="option in retryOptions"
            :key="option.dataTest"
            :data-test="option.dataTest"
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
          @click="$emit('retry', { buildOnPrevious: false })"
        >
          <OIcon name="refresh" size="sm" class="me-1" />
          {{ t("alerts.incidents.rcaRetry") }}
        </OButton>
      </template>
    </OBanner>

    <!-- E: the latest run was cancelled; its partial thread stays readable. -->
    <OBanner
      v-else-if="cardState === 'cancelled'"
      data-test="rca-cancelled-banner"
      variant="error-soft"
      icon="cancel"
    >
      <p data-test="rca-cancelled-message" class="text-banner-error-soft-text m-0 text-sm">
        {{ cancelledText }}
      </p>
      <p
        v-if="earlierReportNote"
        data-test="rca-earlier-report-note"
        class="text-banner-error-soft-text m-0 mt-0.5 text-xs"
      >
        {{ earlierReportNote }}
      </p>
    </OBanner>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { RcaRunError, RcaRunMode } from "@/services/incidents";
import type { RcaCardState } from "@/utils/incidents/rcaThread";
import RcaStageStepper from "./RcaStageStepper.vue";

const props = withDefaults(
  defineProps<{
    cardState: RcaCardState;
    /** Identifies the run the card shows; resets the error details toggle. */
    runId: string;
    stale?: boolean;
    /** "HH:MM:SS" of the stale run's last update. */
    staleSince?: string;
    stageIndex?: number | null;
    stage?: string | null;
    /** Mode of the live run, for the M banner. */
    liveMode?: RcaRunMode | null;
    /** Mode of the failed run; Retry offers it first. */
    failedMode?: RcaRunMode | null;
    /** "The report below is from the HH:MM run." when an earlier report shows below. */
    earlierReportNote?: I18nText | null;
    error?: RcaRunError | null;
    /** The full E message. */
    cancelledText?: I18nText | null;
    triggering?: boolean;
    cancelling?: boolean;
  }>(),
  {
    stale: false,
    staleSince: "",
    stageIndex: null,
    stage: null,
    liveMode: null,
    failedMode: null,
    earlierReportNote: null,
    error: null,
    cancelledText: null,
    triggering: false,
    cancelling: false,
  },
);

defineEmits<{
  cancel: [];
  "follow-thread": [];
  retry: [options: { buildOnPrevious: boolean }];
}>();

const { t } = useI18nTyped();

const pill = computed<{ variant: BadgeVariant; icon: string | null; label: I18nText }>(() => {
  switch (props.cardState) {
    case "investigating":
      return {
        variant: "default-soft",
        icon: null,
        label: t("alerts.incidents.rcaRun.state.investigating"),
      };
    case "analyzed":
      return {
        variant: "success-soft",
        icon: "check-circle",
        label: t("alerts.incidents.rcaRun.state.analyzed"),
      };
    case "failed":
      return {
        variant: "error-soft",
        icon: "error",
        label: t("alerts.incidents.rcaRun.state.failed"),
      };
    default:
      return {
        variant: "error-soft",
        icon: "cancel",
        label: t("alerts.incidents.rcaRun.state.cancelled"),
      };
  }
});

const headline = computed(() => {
  switch (props.cardState) {
    case "investigating":
      return t("alerts.incidents.rcaRun.headline.investigating");
    case "analyzed":
      return t("alerts.incidents.rcaRun.headline.analyzed");
    case "failed":
      return t("alerts.incidents.rcaRun.headline.failed");
    default:
      return t("alerts.incidents.rcaRun.headline.cancelled");
  }
});

// Details stay collapsed for every new failure (01 RR-47).
const showErrorDetails = ref(false);
const errorDetailsId = useId();
watch(
  () => props.runId,
  () => (showErrorDetails.value = false),
);

// Retry offers both modes, the failed run's mode first (02 TH40 L).
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
</script>
