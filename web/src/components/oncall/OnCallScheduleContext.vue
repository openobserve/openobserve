<!--
  The four facts somebody opens the schedule to check, before they look at any
  block on the chart: who holds the pager, when it moves and to whom, who is
  backing them, and whether the next fortnight has a hole in it.

  Every one is read off data the tab already fetched — the slots, the resolved
  segments and the reachability report — so the strip costs no request and
  cannot drift from the chart underneath it.
-->
<template>
  <div
    class="border-border-default bg-surface-base grid grid-cols-1 gap-px border-y sm:grid-cols-2 xl:grid-cols-4"
    data-test="oncall-schedule-context"
  >
    <!-- Who holds it now. The reachability verdict rides here rather than in a
         panel further down: "on call" and "cannot be paged" is one fact. -->
    <section class="bg-surface-base flex flex-col gap-1.5 px-4 py-3">
      <OText variant="meta">{{ t("oncall.ctxOnCallNow") }}</OText>
      <template v-if="primary">
        <span class="flex flex-wrap items-center gap-2">
          <OUserCell :value="primary.user_email" />
          <OTag
            :variant="reachable ? 'success-soft' : 'error-soft'"
            size="sm"
            data-test="oncall-schedule-context-reachable"
          >
            {{ reachable ? t("oncall.ctxReachable") : t("oncall.ctxUnreachable") }}
          </OTag>
        </span>
        <OText variant="meta">{{ raw(primary.rotation) }}</OText>
      </template>
      <p v-else class="text-status-error-text text-sm" data-test="oncall-schedule-context-nobody">
        {{ t("oncall.nobodyOnCallShort") }}
      </p>
    </section>

    <!-- The countdown, and the name it hands to. A time with no successor is
         half the answer: "who do I brief" is the reason anybody reads this. -->
    <section class="bg-surface-base flex flex-col gap-1.5 px-4 py-3">
      <OText variant="meta">{{ t("oncall.ctxHandoverIn") }}</OText>
      <template v-if="handover">
        <span
          class="text-text-heading text-lg font-medium tabular-nums"
          data-test="oncall-schedule-context-countdown"
        >
          {{ raw(handover.countdown) }}
        </span>
        <span class="text-text-secondary flex flex-wrap items-center gap-1 text-xs">
          {{ raw(handover.at) }}
          <OIcon name="arrow-forward" size="xs" />
          <OUserCell v-if="handover.to" :value="handover.to" />
          <span v-else class="text-status-error-text">{{ t("oncall.ctxHandsToNobody") }}</span>
        </span>
      </template>
      <p v-else class="text-text-muted text-sm">{{ ABSENT }}</p>
    </section>

    <!-- The secondary SLOT, not the next person in the primary cycle. Those are
         different people the moment a team staffs a second pool. -->
    <section class="bg-surface-base flex flex-col gap-1.5 px-4 py-3">
      <OText variant="meta">{{ t("oncall.ctxSecondary") }}</OText>
      <template v-if="secondary">
        <OUserCell :value="secondary.who" />
        <OText variant="meta">{{ secondary.provenance }}</OText>
      </template>
      <!-- Only a one-person rotation genuinely has nobody behind it. Saying so
           beats an empty box that reads as a loading state. -->
      <p v-else class="text-text-secondary text-sm" data-test="oncall-schedule-context-no-secondary">
        {{ t("oncall.ctxNoSecondary") }}
      </p>
    </section>

    <!-- The only cell that is ever alarming, and only when it should be. -->
    <section class="bg-surface-base flex flex-col gap-1.5 px-4 py-3">
      <OText variant="meta">{{ t("oncall.ctxGapsIn", { days: windowDays }) }}</OText>
      <template v-if="gaps.count">
        <span
          class="text-status-error-text text-lg font-medium"
          data-test="oncall-schedule-context-gaps"
        >
          {{ t("oncall.ctxGapCount", { count: gaps.count, duration: gaps.total }, gaps.count) }}
        </span>
        <span class="text-text-secondary text-xs">{{ raw(gaps.firstWindow) }}</span>
      </template>
      <template v-else>
        <span class="text-status-success-text text-lg font-medium">
          {{ t("oncall.ctxNoGaps") }}
        </span>
        <OText variant="meta">{{ t("oncall.ctxNoGapsHint") }}</OText>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { OnCallSlot, ResolvedSegment, TeamReachability } from "@/ts/interfaces/oncall";
import { DEFAULT_SLOT, sameSlot } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { ABSENT } from "@/composables/useSloFormat";
import { formatMicrosDuration } from "@/utils/formatters";

const MICROS_PER_DAY = 86_400_000_000;

const props = withDefaults(
  defineProps<{
    /** `/on-call` — the authority on WHO, per slot. */
    slots?: OnCallSlot[];
    /** `resolved-schedule` for the window the chart is showing. */
    segments?: ResolvedSegment[];
    reachability?: TeamReachability | null;
    /** The team's zone. Every instant here is rendered in it, never the browser's. */
    timezone?: string;
    /** Micros. Defaults to now; injectable so the spec is not clock-dependent. */
    now?: number;
  }>(),
  { slots: () => [], segments: () => [], reachability: null, timezone: "UTC", now: 0 },
);

const { t } = useI18nTyped();

const nowMicros = computed(() => props.now || Date.now() * 1000);

const primary = computed<OnCallSlot | null>(
  () => props.slots.find((s) => sameSlot(s.slot, DEFAULT_SLOT) && !!s.user_email) ?? null,
);

/**
 * A team has ONE member list by default and the secondary is **derived** from
 * it — there is no second list to fill in and nothing to keep in sync. A slot
 * is the opt-in upgrade for a genuinely different pool.
 *
 * So there are two different things that can occupy this cell, and they must
 * not be labelled alike: an explicitly staffed slot, and a person the rotation
 * computed. The derived one carries its offset, because otherwise the first
 * question anybody asks is why that person.
 */
const secondary = computed<{ who: string; provenance: I18nText } | null>(() => {
  const staffed = props.slots.find((s) => !sameSlot(s.slot, DEFAULT_SLOT) && !!s.user_email);
  if (staffed) {
    return { who: staffed.user_email, provenance: raw(staffed.rotation) };
  }
  const derived = primary.value?.next_user_email;
  if (!derived) return null;
  return {
    who: derived,
    provenance: t("oncall.ctxSecondaryDerived", { offset: primary.value?.next_offset ?? 1 }),
  };
});

/// Deliverable on at least one channel. A member the report does not mention is
/// treated as reachable rather than broken — an absent row is a missing answer,
/// and rendering it as "cannot be paged" would invent an outage.
const reachable = computed(() => {
  const email = primary.value?.user_email?.toLowerCase();
  if (!email) return false;
  const member = props.reachability?.members.find((m) => m.user_email.toLowerCase() === email);
  if (!member) return true;
  return member.channels.some((c) => c.deliverable);
});

function formatAt(micros: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: props.timezone,
  }).format(new Date(micros / 1000));
}

/// When the segment covering `now` ends, and who the next one names. Read off
/// the server's segments rather than from the rotation's cadence, so a cover or
/// an absence moves the countdown exactly as it moves the page.
const handover = computed(() => {
  const ordered = [...props.segments].sort((a, b) => a.from - b.from);
  const index = ordered.findIndex((s) => s.from <= nowMicros.value && s.to > nowMicros.value);
  const current = index >= 0 ? ordered[index] : null;
  if (!current) return null;
  const next = ordered[index + 1];
  return {
    countdown: formatMicrosDuration(current.to - nowMicros.value),
    at: formatAt(current.to),
    to: next?.user_email ?? "",
  };
});

const windowDays = computed(() => {
  const spans = props.segments;
  if (!spans.length) return 0;
  const from = Math.min(...spans.map((s) => s.from));
  const to = Math.max(...spans.map((s) => s.to));
  return Math.max(1, Math.round((to - from) / MICROS_PER_DAY));
});

/// A gap is a segment with nobody in it — never a hole between segments, which
/// is what makes it countable at all.
const gaps = computed(() => {
  const found = props.segments.filter((s) => !s.user_email && s.to > nowMicros.value);
  const total = found.reduce((sum, s) => sum + (s.to - Math.max(s.from, nowMicros.value)), 0);
  const first = found[0];
  return {
    count: found.length,
    total: formatMicrosDuration(total),
    firstWindow: first ? `${formatAt(first.from)} → ${formatAt(first.to)}` : "",
  };
});
</script>
