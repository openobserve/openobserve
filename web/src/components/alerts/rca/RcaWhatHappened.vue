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
  <section data-test="rca-what-happened" :aria-labelledby="headingId" class="flex flex-col">
    <div class="mb-3 flex flex-wrap items-baseline gap-2">
      <h3 :id="headingId" class="text-text-heading m-0 text-base font-bold">
        {{ t("alerts.incidents.rcaSummary.whatHappened") }}
      </h3>
      <span v-if="!live" class="text-text-secondary text-xs">
        {{ t("alerts.incidents.rcaSummary.linkCount", { count: entries.length }, entries.length) }}
      </span>
      <span class="flex-1" />
      <span
        v-if="!live && entries.length > 0"
        data-test="rca-timeline-legend"
        class="text-text-secondary inline-flex flex-wrap items-center gap-3 text-xs"
      >
        <span v-for="marker in legend" :key="marker" class="inline-flex items-center gap-1.5">
          <span class="size-2.5 rounded-full" :class="MARKER[marker].dot" aria-hidden="true" />
          {{ markerLabel(marker) }}
        </span>
      </span>
    </div>

    <p v-if="live" data-test="rca-timeline-pending" class="text-text-secondary text-compact m-0">
      {{ t("alerts.incidents.rcaSummary.timelineComesWithReport") }}
    </p>
    <p
      v-else-if="entries.length === 0"
      data-test="rca-timeline-empty"
      class="text-text-secondary text-compact m-0"
    >
      {{ t("alerts.incidents.rcaSummary.timelineEmpty") }}
    </p>
    <ol v-else class="m-0 list-none p-0">
      <li
        v-for="(entry, idx) in entries"
        :key="idx"
        data-test="rca-timeline-entry"
        :data-status="entry.status"
        class="grid grid-cols-[7.5rem_1rem_minmax(0,1fr)] gap-x-3"
      >
        <span class="text-text-secondary pt-0.5 font-mono text-xs whitespace-nowrap">{{
          formatTimestampInTimezone(entry.at, "MMM D, HH:mm:ss", "UTC")
        }}</span>
        <span class="relative flex justify-center" aria-hidden="true">
          <span
            v-if="idx < entries.length - 1"
            class="bg-border-default absolute top-4 bottom-0 w-px"
          />
          <span class="relative mt-1.5 size-2.75 rounded-full" :class="MARKER[entry.status].dot" />
        </span>
        <div class="min-w-0 pb-3.5">
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="text-sm"
              :class="
                entry.status === 'refuted'
                  ? 'text-text-secondary line-through'
                  : 'text-text-heading'
              "
            >
              <RcaInlineText :text="entry.text" />
            </span>
            <span
              v-if="entry.status !== 'confirmed'"
              data-test="rca-timeline-marker"
              class="text-3xs font-bold"
              :class="MARKER[entry.status].tag"
            >
              {{ markerLabel(entry.status) }}
            </span>
            <span class="inline-flex gap-1">
              <button
                v-for="number in entry.evidence_numbers"
                :key="number"
                type="button"
                data-test="rca-timeline-chip"
                class="rounded-default text-3xs inline-grid h-5 min-w-5.5 cursor-pointer place-items-center border px-1.5 font-mono font-semibold"
                :class="
                  isOpen(idx, number)
                    ? 'bg-accent text-text-inverse border-transparent'
                    : 'border-border-control bg-surface-base text-text-heading hover:bg-surface-subtle-hover'
                "
                :aria-expanded="isOpen(idx, number)"
                :aria-controls="isOpen(idx, number) ? cardId(idx) : undefined"
                :aria-label="t('alerts.incidents.rcaSummary.openEvidence', { number })"
                @click="toggle(idx, number)"
              >
                {{ number }}
              </button>
            </span>
          </div>
          <RcaEvidenceCard
            v-if="openEntry && open?.row === idx"
            :id="cardId(idx)"
            class="mt-2 max-w-215"
            :entry="openEntry"
            :hypotheses="hypotheses"
            @open-hypothesis="$emit('open-hypothesis', $event)"
            :org="org"
            with-header
          />
        </div>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type {
  RcaEvidenceEntry,
  RcaSummaryHypothesis,
  RcaSummaryTimelineEntry,
  RcaTimelineStatus,
} from "@/services/incidents";
import { sortedRcaTimeline } from "@/utils/incidents/rcaSummary";
import { formatTimestampInTimezone } from "@/utils/date";
import RcaEvidenceCard from "./RcaEvidenceCard.vue";
import RcaInlineText from "./RcaInlineText.vue";

const props = defineProps<{
  timeline: RcaSummaryTimelineEntry[];
  evidence: RcaEvidenceEntry[];
  hypotheses: RcaSummaryHypothesis[];
  org: string;
  /** The run is live: the timeline comes with the report. */
  live: boolean;
}>();

defineEmits<{
  /** A citation's hypothesis link was clicked. */
  "open-hypothesis": [hypothesisId: string];
}>();

const { t } = useI18nTyped();
const headingId = useId();
const baseId = useId();

const MARKER: Record<RcaTimelineStatus, { dot: string; tag: string }> = {
  confirmed: { dot: "bg-accent", tag: "" },
  likely: { dot: "border-2 border-dashed border-border-strong", tag: "text-status-warning-text" },
  unverified: {
    dot: "border-2 border-dashed border-status-warning-text",
    tag: "text-status-warning-text",
  },
  refuted: { dot: "border-2 border-border-strong", tag: "text-text-secondary" },
};

const markerLabel = (status: RcaTimelineStatus): I18nText => {
  switch (status) {
    case "confirmed":
      return t("alerts.incidents.rcaSummary.marker.confirmed");
    case "likely":
      return t("alerts.incidents.rcaSummary.marker.likely");
    case "unverified":
      return t("alerts.incidents.rcaSummary.marker.unverified");
    case "refuted":
      return t("alerts.incidents.rcaSummary.marker.refuted");
  }
};

const entries = computed(() => sortedRcaTimeline(props.timeline));

/** Confirmed and Likely always; the other two only when a row uses them. */
const legend = computed<RcaTimelineStatus[]>(() =>
  (["confirmed", "likely", "unverified", "refuted"] as const).filter(
    (status) =>
      status === "confirmed" ||
      status === "likely" ||
      entries.value.some((entry) => entry.status === status),
  ),
);

const open = ref<{ row: number; number: number } | null>(null);
const isOpen = (row: number, number: number) =>
  open.value?.row === row && open.value.number === number;
const toggle = (row: number, number: number) => {
  open.value = isOpen(row, number) ? null : { row, number };
};
const cardId = (row: number) => `${baseId}-${row}`;

const openEntry = computed(
  () => props.evidence.find((entry) => entry.number === open.value?.number) ?? null,
);
</script>
