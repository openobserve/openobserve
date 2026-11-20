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
        {{ t("alerts.incidents.rcaSummary.eventCount", { count: entries.length }, entries.length) }}
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
    <ol v-else class="m-0 flex list-none flex-col p-0">
      <template v-for="(entry, idx) in entries" :key="idx">
        <li
          v-if="dayHeaders[idx]"
          data-test="rca-timeline-day"
          class="text-text-secondary list-none pt-1 pb-1.5 text-xs font-semibold"
        >
          {{ dayHeaders[idx] }}
        </li>
        <RcaFoldRow
          data-test="rca-timeline-entry"
          :data-status="statusOf(idx)"
          flush
          :open="expanded.has(idx) || open?.row === idx"
          @update:open="setExpanded(idx, $event)"
        >
          <template #lead>
            <span
              data-test="rca-timeline-time"
              class="text-text-secondary w-10 shrink-0 font-mono text-xs"
              >{{ clock(entry.at) }}</span
            >
            <span
              class="size-2.5 shrink-0 rounded-full"
              :class="MARKER[statusOf(idx)].dot"
              aria-hidden="true"
            />
          </template>
          <span
            class="font-normal"
            :class="entry.status === 'refuted' ? 'text-text-secondary line-through' : ''"
          >
            <RcaInlineText :text="entry.text" />
          </span>
          <template #meta>
            <span
              v-if="statusOf(idx) !== 'confirmed'"
              data-test="rca-timeline-marker"
              class="text-3xs shrink-0 font-bold"
              :class="MARKER[statusOf(idx)].tag"
            >
              {{ markerLabel(statusOf(idx)) }}
            </span>
          </template>
          <template #actions>
            <span class="flex h-7 min-w-24 items-center justify-end">
              <span v-if="entry.evidence_numbers.length" class="inline-flex shrink-0 gap-1">
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
              <span
                v-else-if="fromIncident[idx]"
                data-test="rca-timeline-from-incident"
                class="text-text-secondary shrink-0 text-xs"
              >
                {{ t("alerts.incidents.rcaLight.fromIncident") }}
              </span>
              <span
                v-else
                data-test="rca-timeline-no-evidence"
                class="text-text-secondary shrink-0 text-xs"
              >
                {{ t("alerts.incidents.rcaLight.noEvidence") }}
              </span>
            </span>
          </template>
          <template v-if="openEntry && open?.row === idx" #body>
            <RcaEvidenceCard
              :id="cardId(idx)"
              class="max-w-215"
              :entry="openEntry"
              :hypotheses="hypotheses"
              :org="org"
              with-header
              @open-hypothesis="$emit('open-hypothesis', $event)"
            />
          </template>
        </RcaFoldRow>
      </template>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type {
  IncidentAlert,
  RcaEvidenceEntry,
  RcaSummaryHypothesis,
  RcaSummaryTimelineEntry,
  RcaTimelineStatus,
} from "@/services/incidents";
import { sortedRcaTimeline } from "@/utils/incidents/rcaSummary";
import { formatTimestampInTimezone } from "@/utils/date";
import { timezoneAbbr } from "@/utils/formatters";
import RcaEvidenceCard from "./RcaEvidenceCard.vue";
import RcaFoldRow from "./RcaFoldRow.vue";
import RcaInlineText from "./RcaInlineText.vue";

const props = withDefaults(
  defineProps<{
    timeline: RcaSummaryTimelineEntry[];
    evidence: RcaEvidenceEntry[];
    hypotheses: RcaSummaryHypothesis[];
    org: string;
    /** The run is live: the timeline comes with the report. */
    live: boolean;
    /** The app's time zone; the day headers name it. */
    timezone?: string;
    /** This incident's own firings; a row that is one of them needs no evidence. */
    firings?: Pick<IncidentAlert, "alert_name" | "alert_fired_at">[];
  }>(),
  { timezone: "UTC", firings: () => [] },
);

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

const FIRING_MATCH_US = 60_000_000;

// Detections are named `<rule>__<stream>` (detectionAlertName); the analysis names the rule only.
const withoutStream = (name: string) => {
  const cut = name.lastIndexOf("__");
  return cut > 0 && cut < name.length - 2 ? name.slice(0, cut) : name;
};

// A parenthetical may only count the triggers; any other remark is a claim the firing record cannot back.
const isTriggerRemark = (part: string) =>
  /^(?:single|only|first|last|\d+)(?: and (?:first|last))? (?:trigger|alert|firing)s?$/i.test(part);

const FIRING_STATEMENT =
  /^(?:alert\s+)?`?([\w.:-]+(?:…|\.\.\.)?)`?\s+(?:fired|fires|triggered)(?: at (\d{1,2}):(\d{2})(?::(\d{2}))?( UTC)?)?(?:\s+\(([^()]*)\))?[.!]?$/i;
const DAY_S = 86_400;

// "3 triggers" and "single" claim how often the alert fired; "first" and "last" claim which firing this is.
const remarkHolds = (part: string, name: string, firedAt: number) => {
  const times = [
    ...new Set(
      props.firings.filter((f) => f.alert_name.toLowerCase() === name).map((f) => f.alert_fired_at),
    ),
  ];
  return part
    .toLowerCase()
    .split(" ")
    .every((word) => {
      if (/^\d+$/.test(word)) return Number(word) === times.length;
      if (word === "single" || word === "only") return times.length === 1;
      if (word === "first") return firedAt === Math.min(...times);
      if (word === "last") return firedAt === Math.max(...times);
      return true;
    });
};

// A clock time in the text, read in the zone it names, must sit within the match window of the firing.
const clockMatches = (match: RegExpMatchArray, firedAt: number) => {
  if (match[2] === undefined) return true;
  const zone = match[5] ? "UTC" : props.timezone;
  const [h, m, sec] = formatTimestampInTimezone(firedAt, "HH:mm:ss", zone).split(":").map(Number);
  const fired = (h * 60 + m) * 60 + sec;
  const from = (Number(match[2]) * 60 + Number(match[3])) * 60 + Number(match[4] ?? 0);
  const to = from + (match[4] === undefined ? 59 : 0);
  const gap = (a: number, b: number) => {
    const d = Math.abs(a - b) % DAY_S;
    return Math.min(d, DAY_S - d);
  };
  const off = fired >= from && fired <= to ? 0 : Math.min(gap(fired, from), gap(fired, to));
  return off * 1_000_000 <= FIRING_MATCH_US;
};

// Only a complete firing statement, whose time and count agree with the incident's record, is backed by it.
const namesFiring = (text: string, name: string, firedAt: number) => {
  const match = text.match(FIRING_STATEMENT);
  const remark = match?.[6]?.split(/\s*,\s*/);
  if (!match || (remark && !remark.every(isTriggerRemark)) || !clockMatches(match, firedAt)) {
    return false;
  }
  if (remark && !remark.every((part) => remarkHolds(part, name, firedAt))) return false;
  const claimed = match[1];
  if (claimed === name) return true;
  const names = [...new Set(props.firings.map((firing) => firing.alert_name.toLowerCase()))];
  if (claimed === withoutStream(name)) {
    return names.filter((n) => withoutStream(n) === claimed).length === 1;
  }
  if (!/(?:…|\.\.\.)$/.test(claimed)) return false;
  const prefix = claimed.replace(/(?:…|\.\.\.)$/, "");
  return name.startsWith(prefix) && names.filter((n) => n.startsWith(prefix)).length === 1;
};

const fromIncident = computed(() =>
  entries.value.map((entry) => {
    const text = entry.text.toLowerCase();
    return (
      entry.status !== "refuted" &&
      props.firings.some(
        (firing) =>
          Math.abs(entry.at - firing.alert_fired_at) <= FIRING_MATCH_US &&
          namesFiring(text, firing.alert_name.toLowerCase(), firing.alert_fired_at),
      )
    );
  }),
);
const statusOf = (idx: number): RcaTimelineStatus =>
  fromIncident.value[idx] ? "confirmed" : entries.value[idx].status;

const clock = (us: number) => formatTimestampInTimezone(us, "HH:mm", props.timezone);

/** "Oct 9 · UTC" before the first row of each day. */
const dayHeaders = computed(() => {
  let last = "";
  return entries.value.map((entry) => {
    const day = formatTimestampInTimezone(entry.at, "MMM D", props.timezone);
    if (day === last) return null;
    last = day;
    return t("alerts.incidents.rcaLight.dayZone", {
      day,
      zone: timezoneAbbr(props.timezone, new Date(entry.at / 1000)),
    });
  });
});

const expanded = ref(new Set<number>());
const setExpanded = (row: number, value: boolean) => {
  const next = new Set(expanded.value);
  if (value) next.add(row);
  else {
    next.delete(row);
    if (open.value?.row === row) open.value = null;
  }
  expanded.value = next;
};

/** Confirmed and Likely always; the other two only when a row uses them. */
const legend = computed<RcaTimelineStatus[]>(() =>
  (["confirmed", "likely", "unverified", "refuted"] as const).filter(
    (status) =>
      status === "confirmed" ||
      status === "likely" ||
      entries.value.some((_, idx) => statusOf(idx) === status),
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
