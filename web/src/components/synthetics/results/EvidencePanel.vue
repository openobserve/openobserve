<!-- Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<script setup lang="ts">
/**
 * The evidence panel — what the browser did while the journey ran.
 *
 * Reads the BUNDLE, not `evidence_by_step`. That field is an anomaly index:
 * `summarise()` emits a row only for a step that had a console error, a page
 * error, a failed request or a non-2xx response. A run whose network was healthy
 * carries an empty index while the bundle holds every event — so on the most
 * common failure (a locator that never matched) the index says "nothing to
 * report" and the bundle says what the page was actually doing.
 *
 * Per attempt: each attempt uploads its own bundle, attempt 0 at the bare key
 * and retries at `attempt-N-`. Showing one under another's label is a real
 * error, not a cosmetic one.
 */
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";

import {
  evidenceOriginTs,
  foldEvidenceBundle,
  type EvidenceEvent,
} from "@/composables/synthetics/syntheticResultsSchema";
import { useEvidenceFilters } from "@/composables/synthetics/useEvidenceFilters";
import EvidenceEvents from "./EvidenceEvents.vue";
import EvidenceFilters from "./EvidenceFilters.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import {
  EVIDENCE_ERROR_MESSAGE,
  evidenceErrorCanRetry,
  evidenceErrorNeedsReload,
  type EvidenceErrorKind,
  type EvidenceStatus,
} from "@/composables/useSyntheticEvidence";

const props = withDefaults(
  defineProps<{
    /** Object-storage key of the selected attempt's bundle. Null when none exists. */
    evidenceKey: string | null;
    /** step_id -> definition, for naming the step on each row. */
    stepDefs: Map<string, { name: string; selector: string | null }>;
    /** The attempt's events, already fetched and named by useSyntheticEvidence. */
    events: EvidenceEvent[];
    status: EvidenceStatus;
    /** Raw technical detail. Shown under the explanation, never as it. */
    error: string | null;
    /** What kind of failure, so the banner can say what to do about it. */
    errorKind?: EvidenceErrorKind | null;
    /** `evidence_truncated` from the record, or a truncation event in the stream. */
    truncated?: boolean;
    /** Scope every row and every count to one step. Null shows the whole run. */
    stepFilter?: string | null;
    /** Display name for the filtered step, for the banner. */
    stepFilterName?: string;
    /** Whether capture is switched off for this check, vs merely not kept. */
    captureOff?: boolean;
    /** Whether the run passed — evidence is retained for failures by default. */
    runPassed?: boolean;
  }>(),
  {
    truncated: false,
    stepFilter: null,
    stepFilterName: "",
    captureOff: false,
    runPassed: false,
    errorKind: null,
  },
);

const emit = defineEmits<{ (e: "clear-step-filter"): void; (e: "retry"): void }>();

const { t } = useI18nTyped();

const loading = computed(() => props.status === "loading" || props.status === "idle");
const loadError = computed(() => (props.status === "error" ? props.error : null));

// Same wording and same affordance as the per-step Page activity block — one
// failure must not be described two ways depending on which surface saw it.
const errorMessage = computed(() =>
  props.errorKind
    ? t(EVIDENCE_ERROR_MESSAGE[props.errorKind])
    : t("synthetics.evidence.loadFailed", { error: loadError.value ?? "" }),
);
const canRetry = computed(() => evidenceErrorCanRetry(props.errorKind ?? null));
const needsReload = computed(() => evidenceErrorNeedsReload(props.errorKind ?? null));

function reloadPage() {
  window.location.reload();
}

/**
 * Events after the STEP filter, before the view.
 *
 * The badges are folded from this, not from the whole run: a badge that counts
 * the run while the list shows one step is a lie, not a shortcut.
 */
const scopedEvents = computed(() =>
  props.stepFilter ? props.events.filter((e) => e.stepId === props.stepFilter) : props.events,
);

const bundle = computed(() =>
  foldEvidenceBundle(scopedEvents.value, props.stepDefs, props.truncated),
);

/**
 * Zero on the elapsed column: the attempt's first event, taken BEFORE the step
 * filter and shared by every section.
 *
 * Per-section zeroes would let the 200 at the top of Network and the 503 at the
 * top of Console both read "+0ms" when one preceded the other by three seconds —
 * the exact comparison the column exists to make.
 */
const originTs = computed(() => evidenceOriginTs(props.events));

// The step card is about to mount this same toolbar, so the view/first-party/
// wrap state and the counts they drive live in one composable rather than two
// copies that could drift apart.
const { view, firstPartyOnly, wrap, views, visibleEvents } = useEvidenceFilters(
  computed(() => bundle.value.events),
);
</script>

<template>
  <div class="flex flex-col gap-3 p-3" data-test="synthetics-evidence-panel">
    <!-- ── Empty states. All four are distinct; today they all look like nothing. -->
    <div
      v-if="!evidenceKey"
      class="text-text-secondary text-sm"
      data-test="synthetics-evidence-empty"
    >
      <template v-if="captureOff">{{ t("synthetics.evidence.captureOff") }}</template>
      <template v-else-if="runPassed">{{ t("synthetics.evidence.failuresOnly") }}</template>
      <template v-else>{{ t("synthetics.evidence.none") }}</template>
    </div>

    <template v-else>
      <div v-if="loading" class="flex flex-col gap-2" data-test="synthetics-evidence-loading">
        <OSkeleton v-for="i in 4" :key="i" type="text" class="h-4 w-full" />
      </div>

      <!-- A failed fetch is reported, never rendered as an empty run. The owner
           holds the bundle, so retrying is its call, not this panel's. -->
      <OBanner
        v-else-if="loadError"
        variant="error-soft"
        dense
        inline-actions
        data-test="synthetics-evidence-error"
      >
        <div class="flex min-w-0 flex-col gap-0.5">
          <span>{{ errorMessage }}</span>
          <!-- The HTTP status stays readable — it is the first thing anyone
               debugging this asks for — but as a footnote, not as the message
               the user is expected to act on. -->
          <span
            v-if="loadError && errorKind"
            class="text-text-secondary font-mono text-xs break-words"
            data-test="synthetics-evidence-error-detail"
          >
            {{ t("synthetics.evidence.loadFailedDetail", { error: loadError }) }}
          </span>
        </div>
        <template #actions>
          <OButton
            v-if="needsReload"
            variant="ghost"
            size="xs"
            data-test="synthetics-evidence-reload-btn"
            @click="reloadPage"
          >
            {{ t("synthetics.evidence.reload") }}
          </OButton>
          <OButton
            v-else-if="canRetry"
            variant="ghost"
            size="xs"
            data-test="synthetics-evidence-retry-btn"
            @click="emit('retry')"
          >
            {{ t("synthetics.evidence.retry") }}
          </OButton>
        </template>
      </OBanner>

      <template v-else>
        <!-- Scoped to one step, arrived at from a step expansion. Dismissible,
             because the run-level view is the other half of the question. -->
        <OBanner
          v-if="stepFilter"
          variant="info"
          dense
          inline-actions
          :content="t('synthetics.evidence.stepFilterBanner', { step: stepFilterName })"
          data-test="synthetics-evidence-step-filter"
        >
          <template #actions>
            <OButton
              variant="ghost"
              size="xs"
              data-test="synthetics-evidence-clear-step-filter-btn"
              @click="emit('clear-step-filter')"
            >
              {{ t("synthetics.evidence.clearStepFilter") }}
            </OButton>
          </template>
        </OBanner>

        <!-- X-8.2: reduced fidelity is reported. A silently short list reads as a
             quiet run. -->
        <div
          v-if="bundle.truncated"
          class="rounded-default border-status-warning-text/30 border p-2 text-xs"
          data-test="synthetics-evidence-truncated"
        >
          <OIcon name="warning" size="xs" class="text-status-warning-text mr-1" />
          {{ t("synthetics.evidence.truncated") }}
        </div>

        <EvidenceFilters
          v-model:view="view"
          v-model:first-party-only="firstPartyOnly"
          v-model:wrap="wrap"
          :views="views"
        />

        <!-- One table for the view. Rows come from the shared component, so the
             step expansion and this panel cannot drift apart; kind and step are
             both columns on the row rather than axes the list is cut along. The
             empty case is the table's own OEmptyState — an all-network bundle
             read under Console has to say so, not render silence. -->
        <EvidenceEvents
          :events="visibleEvents"
          mode="panel"
          :filtered="!!stepFilter"
          :origin-ts="originTs"
          :wrap="wrap"
          @clear-filters="emit('clear-step-filter')"
        />
      </template>
    </template>
  </div>
</template>
