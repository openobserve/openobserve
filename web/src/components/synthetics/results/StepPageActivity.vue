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

  Shows the step's FULL bucket, in time order, paged — the same table the
  Evidence tab renders for the whole run, filtered to this step. It used to be
  a worst-first top five with the rest a tab-switch away; now the tab switch is
  only for the run-level view, not for finishing reading one step.

  Separate from StepEvidence.vue, which is gated on the failure detail and so
  renders only on the step that failed. Page activity renders on ANY step that
  owns events: a 503 during a step that PASSED is routinely the cause of the
  timeout two steps later.
-->

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";

import EvidenceEvents from "./EvidenceEvents.vue";
import EvidenceFilters from "./EvidenceFilters.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { useEvidenceFilters } from "@/composables/synthetics/useEvidenceFilters";
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
    /** This step's whole event bucket, in whatever order the caller holds it. */
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

const { t } = useI18nTyped();

// Same toolbar state as the run-level panel, scoped to this step's bucket.
const filters = useEvidenceFilters(computed(() => props.events));

/**
 * Elapsed readings count from the step's WHOLE bucket, never the filtered list.
 *
 * Zeroing on the filtered view would move every offset in the card whenever a
 * filter changed which row happened to be first — the one thing the elapsed
 * column exists to hold stable.
 */
const originTs = computed(() => evidenceOriginTs(props.events));

/**
 * "12 events" — what the step has, not what a cap let through.
 *
 * No truncation `+` here: truncation is a property of the whole capture, and
 * the panel already reports it; this count is scoped to one step.
 */
const countLabel = computed(() =>
  t("synthetics.runDetail.pageActivityEvents", { count: props.events.length }),
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
      <!-- Trailing in the header, where the section's scope is stated: this
           table is one step, and the button is the way to the run-level view.
           Unconditional — the run-level view is a different question (how does
           this step compare to the rest) rather than an overflow escape now
           that nothing here is capped. In the body it sat above the rows and
           read as one. -->
      <OButton
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

      <template v-else>
        <EvidenceFilters
          v-model:view="filters.view.value"
          v-model:first-party-only="filters.firstPartyOnly.value"
          v-model:wrap="filters.wrap.value"
          :views="filters.views.value"
        />

        <!-- Pagination is now the height bound, not a fixed max-height: the
             table pages itself, so a nested vertical scrollbar inside a step
             expansion that is itself scrolling is no longer needed. -->
        <div data-test="synthetics-step-page-activity-events">
          <EvidenceEvents
            :events="filters.visibleEvents.value"
            mode="inline"
            :origin-ts="originTs"
            :wrap="filters.wrap.value"
          />
        </div>
      </template>
    </div>
  </section>
</template>
