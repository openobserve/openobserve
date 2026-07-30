<!-- Copyright 2026 OpenObserve Inc. -->

<!--
  StepPageActivity — what the page was doing during ONE step.

  The step expansion already says what the RUNNER experienced: the error, the
  screenshot, which locator candidates resolved, which settle signals fired. What
  it could not say is what the APPLICATION was doing at the same moment — that
  lived one tab away, in a list grouped by event kind, where the correlation the
  engineer arrived with had to be rebuilt by hand.

  Capped at INLINE_EVIDENCE_LIMIT and ranked worst-first, because attribution is
  lopsided: a live 158-event bundle carried two distinct step ids, so one step's
  bucket can hold 136 rows. The full list stays one click away, filtered to this
  step — the step is a filter over the run log, not a second copy of it.

  Separate from StepEvidence.vue, which is gated on the failure detail and so
  renders only on the step that failed. Page activity renders on ANY step that
  owns events: a 503 during a step that PASSED is routinely the cause of the
  timeout two steps later.
-->

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import EvidenceEvents from "./EvidenceEvents.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { INLINE_EVIDENCE_LIMIT } from "@/constants/synthetics";
import type { EvidenceStatus } from "@/composables/useSyntheticEvidence";
import type { EvidenceEvent } from "@/composables/synthetics/syntheticResultsSchema";

const props = withDefaults(
  defineProps<{
    stepId: string;
    /** This step's bucket, already ranked worst-first. */
    events: EvidenceEvent[];
    status: EvidenceStatus;
    error: string | null;
    /** True when the capture cap bound during the run (X-8.2). */
    truncated?: boolean;
    /** Events the bundle could not attribute to any step. */
    unattributedCount?: number;
  }>(),
  { truncated: false, unattributedCount: 0 },
);

const emit = defineEmits<{ (e: "view-all", stepId: string): void; (e: "retry"): void }>();

const { t } = useI18n();

const shown = computed(() => props.events.slice(0, INLINE_EVIDENCE_LIMIT));
const hasMore = computed(() => props.events.length > INLINE_EVIDENCE_LIMIT);

/**
 * "5 of 136", or "5 of 136+" when the cap bound during capture.
 *
 * The `+` is the whole point: a silently short list reads as a quiet run, which
 * is the opposite of what a truncated capture means.
 */
const countLabel = computed(() =>
  t(
    props.truncated
      ? "synthetics.runDetail.pageActivityCountTruncated"
      : "synthetics.runDetail.pageActivityCount",
    { shown: shown.value.length, total: props.events.length },
  ),
);

const isLoading = computed(() => props.status === "idle" || props.status === "loading");
</script>

<template>
  <OCollapsible
    :label="t('synthetics.runDetail.pageActivity')"
    :default-open="true"
    data-test="synthetics-step-page-activity"
  >
    <template #trigger>
      <span class="text-text-heading text-xs font-semibold">
        {{ t("synthetics.runDetail.pageActivity") }}
      </span>
      <span
        v-if="status === 'ready'"
        class="text-text-secondary text-2xs ml-2"
        data-test="synthetics-step-page-activity-count"
      >
        {{ countLabel }}
      </span>
    </template>

    <div class="flex flex-col gap-2">
      <div
        v-if="isLoading"
        class="flex flex-col gap-1"
        data-test="synthetics-step-page-activity-loading"
      >
        <OSkeleton v-for="i in 3" :key="i" type="text" class="h-4 w-full" />
      </div>

      <!-- A failed fetch is reported, never rendered as an empty step. -->
      <OBanner
        v-else-if="status === 'error'"
        variant="error"
        dense
        inline-actions
        :content="t('synthetics.evidence.loadFailed', { error: error ?? '' })"
        data-test="synthetics-step-page-activity-error"
      >
        <template #actions>
          <OButton
            variant="ghost"
            size="xs"
            data-test="synthetics-step-page-activity-retry-btn"
            @click="emit('retry')"
          >
            {{ t("synthetics.evidence.retry") }}
          </OButton>
        </template>
      </OBanner>

      <!-- Empty is a finding, and a lonely one: attribution is sparse, so naming
           the unattributed remainder is what stops this reading as "the run was
           quiet". -->
      <p
        v-else-if="!events.length"
        class="text-text-secondary m-0 text-xs"
        data-test="synthetics-step-page-activity-empty"
      >
        {{ t("synthetics.evidence.noEventsInStep") }}
        <span v-if="unattributedCount > 0">
          {{ t("synthetics.evidence.unattributedCount", { count: unattributedCount }) }}
        </span>
      </p>

      <template v-else>
        <EvidenceEvents :events="shown" mode="inline" />
        <div v-if="hasMore" class="flex">
          <OButton
            variant="ghost"
            size="xs"
            icon-right="arrow-forward"
            data-test="synthetics-step-page-activity-view-all-btn"
            @click="emit('view-all', stepId)"
          >
            {{ t("synthetics.runDetail.pageActivityViewAll", { count: events.length }) }}
          </OButton>
        </div>
      </template>
    </div>
  </OCollapsible>
</template>
