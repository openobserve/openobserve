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
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { INLINE_EVIDENCE_LIMIT } from "@/constants/synthetics";
import {
  EVIDENCE_ERROR_MESSAGE,
  evidenceErrorCanRetry,
  evidenceErrorNeedsReload,
  type EvidenceErrorKind,
  type EvidenceStatus,
} from "@/composables/useSyntheticEvidence";
import {
  evidenceOriginTs,
  type EvidenceEvent,
} from "@/composables/synthetics/syntheticResultsSchema";

const props = withDefaults(
  defineProps<{
    stepId: string;
    /** This step's bucket, already ranked worst-first. */
    events: EvidenceEvent[];
    status: EvidenceStatus;
    /** Raw technical detail. Shown under the explanation, never as it. */
    error: string | null;
    /** What kind of failure, so the banner can say what to do about it. */
    errorKind?: EvidenceErrorKind | null;
    /** True when the capture cap bound during the run (X-8.2). */
    truncated?: boolean;
    /** Events the bundle could not attribute to any step. */
    unattributedCount?: number;
  }>(),
  { truncated: false, unattributedCount: 0, errorKind: null },
);

const emit = defineEmits<{ (e: "view-all", stepId: string): void; (e: "retry"): void }>();

const { t } = useI18n();

const shown = computed(() => props.events.slice(0, INLINE_EVIDENCE_LIMIT));
const hasMore = computed(() => props.events.length > INLINE_EVIDENCE_LIMIT);

/**
 * Elapsed readings count from the step's first event, not the shown five.
 *
 * The bucket is ranked worst-first, so the earliest event is routinely one the
 * cap dropped; zeroing on `shown` would move every offset in the card whenever
 * a new anomaly outranked the row that happened to be first.
 */
const originTs = computed(() => evidenceOriginTs(props.events));

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

/**
 * What the reader should understand and do.
 *
 * The banner used to interpolate the raw throw — "Could not load the evidence
 * bundle: 401 Unauthorized". That names the symptom in HTTP and leaves the
 * reader to guess whether the RUN is broken, whether their session died, or
 * whether the evidence is simply gone. Each has a different response, so each
 * gets its own sentence; the raw status moves to a detail line beneath, where
 * support can still read it.
 */
const errorMessage = computed(() =>
  // No kind means a caller that does not pass one; fall back to the generic
  // wording rather than rendering nothing.
  props.errorKind
    ? t(EVIDENCE_ERROR_MESSAGE[props.errorKind])
    : t("synthetics.evidence.loadFailed", { error: props.error ?? "" }),
);

const canRetry = computed(() => evidenceErrorCanRetry(props.errorKind ?? null));
const needsReload = computed(() => evidenceErrorNeedsReload(props.errorKind ?? null));

function reloadPage() {
  window.location.reload();
}
</script>

<template>
  <!--
    Same chrome as the StepEvidence sections it sits beside: bordered container
    that CLIPS, header strip, full-bleed divider, padded body. Padding lives on
    the header and the body, never on the container — a container inset would
    stop the divider short of the edges.

    Not a disclosure. It was one, and the collapse never earned its cost: the
    section defaults open, the body is height-capped below, and the trigger being
    a <button> forced the section's own action into the body where it read as a
    row of the list rather than as the header's action.
  -->
  <section
    class="card-container rounded-default border-border-default bg-card-glass-bg flex flex-col overflow-hidden border"
    data-test="synthetics-step-page-activity"
  >
    <div
      class="border-border-default flex min-h-9 items-center gap-x-2 border-b px-3 py-1.5"
      data-test="synthetics-step-page-activity-header"
    >
      <OIcon name="search" size="sm" class="text-text-secondary shrink-0" aria-hidden="true" />
      <span class="text-text-heading text-sm font-semibold">
        {{ t("synthetics.runDetail.pageActivity") }}
      </span>
      <span
        v-if="status === 'ready'"
        class="text-text-secondary text-xs"
        data-test="synthetics-step-page-activity-count"
      >
        {{ countLabel }}
      </span>
      <!-- Trailing in the header, where the section's scope is stated: the list
           below is a capped window on the run log, and this is the way out of
           the window. In the body it sat above the rows and read as one. -->
      <OButton
        v-if="hasMore"
        variant="ghost"
        size="xs"
        icon-right="arrow-forward"
        class="ml-auto shrink-0"
        data-test="synthetics-step-page-activity-view-all-btn"
        @click="emit('view-all', stepId)"
      >
        {{ t("synthetics.runDetail.pageActivityViewAllShort") }}
      </OButton>
    </div>

    <div class="flex flex-col gap-2 px-3 py-2.5">
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
        variant="error-soft"
        dense
        inline-actions
        data-test="synthetics-step-page-activity-error"
      >
        <div class="flex min-w-0 flex-col gap-0.5">
          <span>{{ errorMessage }}</span>
          <!-- The HTTP status still has to be readable — it is the first thing
               anyone debugging this asks for — but as a footnote, not as the
               message the user is expected to act on. -->
          <span
            v-if="error && errorKind"
            class="text-text-secondary font-mono text-xs break-words"
            data-test="synthetics-step-page-activity-error-detail"
          >
            {{ t("synthetics.evidence.loadFailedDetail", { error }) }}
          </span>
        </div>
        <template #actions>
          <OButton
            v-if="needsReload"
            variant="ghost"
            size="xs"
            data-test="synthetics-step-page-activity-reload-btn"
            @click="reloadPage"
          >
            {{ t("synthetics.evidence.reload") }}
          </OButton>
          <OButton
            v-else-if="canRetry"
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

      <!-- Four dense rows tall (4 × 2.375rem), then scroll. The cap is INLINE_
           EVIDENCE_LIMIT rows, so the fifth sits just past the fold: a step
           expansion holding several of these cards has to stay readable as a
           timeline, and a partially visible row is what says "there is more"
           without a second affordance. -->
      <div v-else class="max-h-38 overflow-y-auto" data-test="synthetics-step-page-activity-events">
        <EvidenceEvents :events="shown" mode="inline" :origin-ts="originTs" />
      </div>
    </div>
  </section>
</template>
