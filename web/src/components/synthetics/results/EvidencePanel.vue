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
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import {
  foldEvidenceBundle,
  type EvidenceEvent,
} from "@/composables/synthetics/syntheticResultsSchema";
import EvidenceEvents from "./EvidenceEvents.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
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
    /** Resolves a key to a fetchable URL — used for the download link only. */
    resolveUrl: (key: string) => string;
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

const { t } = useI18n();

type Filter = "all" | "consoleErrors" | "pageErrors" | "requestsFailed" | "nonNon2xx";

const filter = ref<Filter>("all");
const firstPartyOnly = ref(false);

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
 * Events after the STEP filter, before the kind filter.
 *
 * The chips are folded from this, not from the whole run: a chip that counts
 * the run while the list shows one step is a lie, not a shortcut.
 */
const scopedEvents = computed(() =>
  props.stepFilter ? props.events.filter((e) => e.stepId === props.stepFilter) : props.events,
);

const bundle = computed(() =>
  foldEvidenceBundle(scopedEvents.value, props.stepDefs, props.truncated),
);

/**
 * Grouped by kind, so the labels come from one place.
 *
 * Severity order, not volume order: page errors before a wall of 200s.
 */
const GROUP_LABEL: Record<string, string> = {
  pageErrors: "synthetics.evidence.groupPageErrors",
  requestsFailed: "synthetics.evidence.groupFailedReq",
  console: "synthetics.evidence.groupConsole",
  network: "synthetics.evidence.groupNetwork",
};

function matches(e: EvidenceEvent): boolean {
  if (firstPartyOnly.value && !e.firstParty) return false;
  switch (filter.value) {
    case "consoleErrors":
      return e.kind === "console" && e.level === "error";
    case "pageErrors":
      return e.kind === "pageerror" || e.kind === "crash";
    case "requestsFailed":
      return e.kind === "requestfailed";
    case "nonNon2xx":
      return e.kind === "response" && (e.status ?? 0) >= 400;
    default:
      return true;
  }
}

/** Groups after filtering. An emptied group disappears — unlike a zero-count
 *  chip, an empty section header carries no information. */
const visibleGroups = computed(() =>
  bundle.value.groups
    .map((g) => ({ ...g, events: g.events.filter(matches) }))
    .filter((g) => g.events.length > 0),
);

const chips = computed(() => {
  const c = bundle.value.counts;
  return [
    { key: "all" as Filter, label: t("synthetics.evidence.filterAll"), count: c.all },
    {
      key: "consoleErrors" as Filter,
      label: t("synthetics.evidence.filterConsole"),
      count: c.consoleErrors,
    },
    {
      key: "pageErrors" as Filter,
      label: t("synthetics.evidence.filterPageErrors"),
      count: c.pageErrors,
    },
    {
      key: "nonNon2xx" as Filter,
      label: t("synthetics.evidence.filterNon2xx"),
      count: c.nonNon2xx,
    },
    {
      key: "requestsFailed" as Filter,
      label: t("synthetics.evidence.filterFailedReq"),
      count: c.requestsFailed,
    },
  ];
});

const downloadUrl = computed(() => (props.evidenceKey ? props.resolveUrl(props.evidenceKey) : ""));
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
      <!-- Header -->
      <div class="flex items-center justify-between gap-2">
        <span class="text-text-body text-sm">
          {{ t("synthetics.evidence.title", { count: bundle.counts.all }) }}
        </span>
        <!-- Named for what it is: NDJSON, not JSON. A JSON pane cannot parse it. -->
        <a
          :href="downloadUrl"
          download
          class="text-text-secondary hover:text-text-body flex items-center gap-1 text-xs"
          data-test="synthetics-evidence-download"
        >
          <OIcon name="download" size="xs" />
          evidence.ndjson
        </a>
      </div>

      <div v-if="loading" class="flex flex-col gap-2" data-test="synthetics-evidence-loading">
        <OSkeleton v-for="i in 4" :key="i" type="text" class="h-4 w-full" />
      </div>

      <!-- A failed fetch is reported, never rendered as an empty run. The owner
           holds the bundle, so retrying is its call, not this panel's. -->
      <OBanner
        v-else-if="loadError"
        variant="error"
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

        <!-- Chips keep their counts and stay visible at zero: a hidden zero is
             indistinguishable from a chip that does not exist, and "no console
             errors" is information. -->
        <div class="flex flex-wrap items-center gap-2">
          <OToggleGroup v-model="filter" type="single">
            <OToggleGroupItem
              v-for="c in chips"
              :key="c.key"
              :value="c.key"
              size="xs"
              :class="c.count === 0 && c.key !== 'all' ? 'opacity-50' : ''"
              :data-test="`synthetics-evidence-chip-${c.key}`"
            >
              {{ c.label }} {{ c.count }}
            </OToggleGroupItem>
          </OToggleGroup>
          <OCheckbox
            v-model="firstPartyOnly"
            size="sm"
            :label="t('synthetics.evidence.firstPartyOnly')"
            class="ml-2"
            data-test="synthetics-evidence-first-party"
          />
        </div>

        <div v-if="!bundle.counts.all" class="text-text-secondary text-sm">
          {{ t("synthetics.evidence.noEvents") }}
        </div>

        <!-- Grouped by kind. Step attribution moved onto the row: a live
             158-event bundle had only two distinct step_ids, so grouping by step
             produced one section of 136 and told the reader nothing. -->
        <div v-for="g in visibleGroups" :key="g.kind" class="flex flex-col gap-1">
          <div
            class="border-border-default flex items-center gap-2 border-b pb-1 text-xs"
            :class="g.hasAnomaly ? 'text-status-error-text' : 'text-text-secondary'"
            :data-test="`synthetics-evidence-group-${g.kind}`"
          >
            <OIcon v-if="g.hasAnomaly" name="warning" size="xs" />
            <span>{{ t(GROUP_LABEL[g.kind]) }}</span>
            <span class="text-text-secondary">{{ g.events.length }}</span>
          </div>

          <!-- Rows come from the shared table, so the step expansion and this
               panel cannot drift apart. Attribution is kept on the row, just
               not as the grouping axis. -->
          <EvidenceEvents
            :events="g.events"
            mode="panel"
            :filtered="!!stepFilter"
            @clear-filters="emit('clear-step-filter')"
          />
        </div>
      </template>
    </template>
  </div>
</template>
