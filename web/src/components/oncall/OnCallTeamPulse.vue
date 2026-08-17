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
  The four questions somebody has about a team before they read anything else:
  who is holding the pager, who catches it if they miss it, how far the ladder
  reaches before it gives up, and how the last week actually went.

  The ladder and the week's figures come from `GET .../overview`, counted in the
  database over the window. The shift's start and handover come from the
  SCHEDULE instead, because the overview names who is on call but carries no
  instants — a slot has no start and no end.
-->
<template>
  <div class="grid grid-cols-1 gap-px md:grid-cols-2 xl:grid-cols-4" data-test="oncall-team-pulse">
    <!-- ── On call now ─────────────────────────────────────────── -->
    <section class="bg-surface-base flex flex-col gap-1.5 px-4 py-3">
      <span class="flex items-center gap-1.5">
        <OIcon name="notifications-active" size="xs" class="text-text-secondary" />
        <OText variant="section">{{ t("oncall.teamOnCallNow") }}</OText>
      </span>

      <template v-if="holder">
        <span class="flex flex-wrap items-center gap-2" data-test="oncall-pulse-holder">
          <OUserCell :value="holder.user_email" />
          <OTag variant="success-soft" size="sm">{{ raw(holder.rotation) }}</OTag>
        </span>
        <p class="text-text-secondary truncate text-xs" data-test="oncall-pulse-shift">
          {{ shiftLine }}
          <OTooltip side="bottom" :content="shiftLine" />
        </p>

        <!-- Would a page to this person actually land, per channel. Every
             verdict carries the server's own reason, so a blocked channel says
             WHY rather than failing quietly at 3am. -->
        <span v-if="holderChannels.length" class="flex flex-wrap items-center gap-1">
          <OTag
            v-for="entry in holderChannels"
            :key="entry.channel"
            :variant="entry.deliverable ? 'success-soft' : 'error-soft'"
            size="sm"
            :data-test="`oncall-pulse-channel-${entry.channel}`"
          >
            {{ channelLabel(entry) }}
            <OTooltip
              v-if="entry.blocked_because"
              side="bottom"
              :content="raw(entry.blocked_because)"
            />
          </OTag>
        </span>
      </template>
      <p v-else class="text-status-error-text text-sm" data-test="oncall-pulse-nobody">
        {{ t("oncall.nobodyOnCallShort") }}
      </p>
    </section>

    <!-- ── Backing them up ─────────────────────────────────────── -->
    <section class="bg-surface-base flex flex-col gap-1.5 px-4 py-3">
      <span class="flex items-center gap-1.5">
        <OIcon name="group-work" size="xs" class="text-text-secondary" />
        <OText variant="section">{{ t("oncall.teamBackingUp") }}</OText>
      </span>

      <template v-if="backupWho">
        <span class="flex flex-wrap items-center gap-2">
          <OUserCell :value="backupWho" />
          <span class="text-text-secondary text-xs">{{ backupLine }}</span>
          <!-- Where a derived secondary came from. Shown only when the offset is
               not 1: at 1 the person literally IS the next in the cycle, which
               the target label already says, and a "+1" beside it reads as a
               second delay rather than a position. -->
          <OTag
            v-if="backupOffset"
            variant="default-soft"
            size="sm"
            data-test="oncall-pulse-backup-offset"
          >
            {{ t("oncall.ctxSecondaryDerived", { offset: backupOffset }) }}
          </OTag>
        </span>
        <p class="text-text-secondary text-xs" data-test="oncall-pulse-next">
          {{ nextPrimaryLine }}
        </p>
      </template>
      <!-- A one-person rotation has no next: naming the same person as backup
           would suggest a second pair of hands that does not exist. -->
      <p v-else class="text-status-warning-text text-sm" data-test="oncall-pulse-no-backup">
        {{ t("oncall.teamNobodyBacking") }}
      </p>
    </section>

    <!-- ── Escalation reach ────────────────────────────────────── -->
    <section class="bg-surface-base flex flex-col gap-1.5 px-4 py-3">
      <span class="flex items-center gap-1.5">
        <OIcon name="arrow-upward" size="xs" class="text-text-secondary" />
        <OText variant="section">{{ t("oncall.teamReach") }}</OText>
      </span>

      <ul class="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1">
        <li
          v-for="entry in visibleReach"
          :key="entry.priority"
          class="col-span-2 grid grid-cols-subgrid items-baseline"
          :data-test="`oncall-pulse-reach-${entry.priority.toLowerCase()}`"
        >
          <OTag type="alertPriority" :value="entry.priority.toLowerCase()" size="sm" />
          <span v-if="!entry.pages_anyone" class="text-status-error-text truncate text-xs">
            {{ t("oncall.reachPagesNobody") }}
          </span>
          <span v-else class="flex min-w-0 items-baseline gap-2 text-xs">
            <!-- One dot per rung: the shape of the ladder is readable before
                 the number is, and a one-rung P3 stands out against a P1. -->
            <span class="flex shrink-0 items-center gap-0.5" aria-hidden="true">
              <span
                v-for="dot in entry.rungs"
                :key="dot"
                class="bg-text-secondary size-1 rounded-full"
              />
            </span>
            <span class="text-text-body shrink-0">
              {{ t("oncall.reachRungs", { count: entry.rungs }, entry.rungs) }}
            </span>
            <span v-if="entry.nobody_after_micros" class="text-text-secondary ms-auto truncate">
              {{ nobodyAfter(entry) }}
            </span>
          </span>
        </li>
        <!-- The priorities that page, but did not fit. Dropping them silently
             left a panel reading "P1, P2, P5" with no way to tell whether P3
             was absent, silent, or merely not shown — three different facts
             wearing one blank space. Named here, so the only thing missing is
             their detail. -->
        <li
          v-if="hiddenReach.length"
          class="col-span-2 grid grid-cols-subgrid items-baseline"
          data-test="oncall-pulse-reach-more"
        >
          <span class="text-text-secondary text-2xs">{{ hiddenLabel }}</span>
          <span class="text-text-secondary truncate text-xs">
            {{ t("oncall.reachAlsoPage") }}
          </span>
        </li>

        <!-- Every priority that wakes nobody, on one row. Five separate
             "Pages nobody" lines is the same fact five times, and it pushed
             this panel past the height of the three beside it. -->
        <li
          v-if="silentPriorities.length"
          class="col-span-2 grid grid-cols-subgrid items-baseline"
          data-test="oncall-pulse-reach-silent"
        >
          <span class="text-text-secondary text-2xs">{{ silentLabel }}</span>
          <span class="text-status-error-text truncate text-xs">
            {{ t("oncall.reachPagesNobody") }}
          </span>
        </li>
      </ul>
    </section>

    <!-- ── Last N days ─────────────────────────────────────────── -->
    <section class="bg-surface-base flex flex-col gap-1.5 px-4 py-3">
      <span class="flex items-center gap-1.5">
        <OIcon name="show-chart" size="xs" class="text-text-secondary" />
        <OText variant="section">{{ t("oncall.teamLastDays", { days: windowDays }) }}</OText>
      </span>

      <template v-if="stats && stats.pages">
        <span class="flex flex-wrap items-baseline gap-x-2">
          <span
            class="text-text-heading text-2xl leading-none font-semibold"
            data-test="oncall-pulse-pages"
          >
            {{ stats.pages }}
          </span>
          <span class="text-text-body text-sm">{{ t("oncall.activityPages") }}</span>
          <!-- Counted in the database over the window, not averaged from a
               fetched page, which is what makes it safe on a tile. -->
          <span
            v-if="stats.acknowledged"
            class="text-status-success-text text-sm font-semibold"
            data-test="oncall-pulse-fast"
          >
            {{ ackedFastPct }}
          </span>
          <span v-if="stats.acknowledged" class="text-text-secondary text-xs">
            {{ t("oncall.activityAckedUnder5m") }}
          </span>
        </span>
        <p class="text-text-secondary text-xs" data-test="oncall-pulse-activity">
          {{ activityLine }}
        </p>
      </template>
      <p v-else class="text-text-secondary text-sm" data-test="oncall-pulse-no-pages">
        {{ t("oncall.activityNone") }}
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { useOnCallClock } from "@/composables/useOnCallClock";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type {
  ChannelReadiness,
  OnCallPolicy,
  OnCallSchedule,
  OnCallSlot,
  TeamOverview,
  TeamReachability,
  TeamRungSummary,
} from "@/ts/interfaces/oncall";
import { DEFAULT_SLOT, sameSlot } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";
import { DELIVERABLE_CHANNELS } from "@/utils/oncall";
import { formatInZone, nextHandover, upcomingShifts, winningRotation } from "@/utils/oncall";

const props = withDefaults(
  defineProps<{
    /** Slots as `whoIsOnCall` returns them — the authority on WHO. */
    slots?: OnCallSlot[];
    /** The schedule answers WHEN; a slot carries no start or end instant. */
    schedule?: OnCallSchedule | null;
    policy?: OnCallPolicy | null;
    /** `GET .../overview` — the ladder summary and the window's statistics. */
    overview?: TeamOverview | null;
    /** `GET .../reachability` — would a page to each person actually land. */
    reachability?: TeamReachability | null;
    timezone?: string;
  }>(),
  {
    slots: () => [],
    schedule: null,
    policy: null,
    overview: null,
    reachability: null,
    timezone: "UTC",
  },
);

const { t } = useI18nTyped();

const nowMicros = useOnCallClock();

/// The primary slot, named rather than taken as "the first one with somebody in
/// it". A two-slot team returns two staffed slots and the order is the server's
/// business, so first-non-empty would eventually show the secondary under a
/// heading that says "On call now".
const holder = computed<OnCallSlot | null>(
  () =>
    props.slots.find((slot) => sameSlot(slot.slot, DEFAULT_SLOT) && !!slot.user_email) ??
    props.slots.find((slot) => !!slot.user_email) ??
    null,
);

/// The rotation actually in force, resolved the way the engine resolves it.
const rotation = computed(() =>
  props.schedule
    ? winningRotation(props.schedule.rotations, nowMicros.value, props.schedule.timezone)
    : null,
);

const zone = computed(
  () => props.schedule?.timezone || props.overview?.timezone || props.timezone,
);

/// Carries the zone abbreviation: "hands over at 18:00" is ambiguous to a
/// reader in another office, which is most of them.
const clock = (micros: number) =>
  formatInZone(micros, zone.value, {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

/// "Since 18:00 Wed · 5h 12m left · hands to Mia at 18:00" — one sentence,
/// because the three facts are only useful together.
const shiftLine = computed<I18nText>(() => {
  const current = rotation.value;
  if (!current) return raw("");

  const shift = upcomingShifts(current, nowMicros.value, 2)[0];
  const endsAt = nextHandover(current, nowMicros.value);
  const parts: string[] = [];

  if (shift) {
    parts.push(
      String(
        t("oncall.teamSince", {
          time: raw(
            formatInZone(shift.startMicros, zone.value, {
              weekday: "short",
              hour: "2-digit",
              minute: "2-digit",
            }),
          ),
        }),
      ),
    );
  }
  if (endsAt && endsAt > nowMicros.value) {
    parts.push(
      String(t("oncall.teamLeft", { duration: formatMicrosDuration(endsAt - nowMicros.value) })),
    );
  }
  const nextPerson = holder.value?.next_user_email;
  parts.push(
    endsAt && nextPerson
      ? String(t("oncall.teamHandsTo", { name: raw(nextPerson), time: raw(clock(endsAt)) }))
      : String(t("oncall.teamNoHandover")),
  );
  return raw(parts.join(" · "));
});

/// The channels that would be tried for whoever is on call right now.
const holderChannels = computed<ChannelReadiness[]>(() => {
  const email = holder.value?.user_email?.toLowerCase();
  if (!email) return [];
  const member = props.reachability?.members.find(
    (candidate) => candidate.user_email.toLowerCase() === email,
  );
  // Only channels a Notifier can send. "✗ SMS ✗ Push" implied a fixable
  // problem with this person's setup; the truth is the transport does not
  // exist yet, which is not a per-member fact and not this panel's news.
  return (member?.channels ?? []).filter((entry) =>
    (DELIVERABLE_CHANNELS as readonly string[]).includes(entry.channel),
  );
});

function channelLabel(entry: ChannelReadiness): I18nText {
  const name = t(`oncall.channel_${entry.channel}`);
  return raw(`${entry.deliverable ? "✓" : "✗"} ${name}`);
}

/// The second rung of the P1 ladder: when it fires, and **what it names**.
///
/// The label is read off the rung's target rather than fixed to "Secondary".
/// It used to say Secondary on the grounds that secondary was a rung and not a
/// role — true until slots landed. Now a team can staff a real `secondary`
/// slot, and on such a team `next_on_call` and the secondary are *different
/// people*: this panel said "Secondary — mei" while the Schedule tab said
/// "Secondary → priya", and both were right about different things. Naming the
/// target is what keeps the two screens telling one story.
const backupTarget = computed(() => {
  const steps = props.policy?.rungs.find((rung) => rung.priority === 1)?.steps ?? [];
  const second = [...steps].sort((a, b) => a.after_micros - b.after_micros)[1];
  // `targets` is required on the wire, but a rung that somehow arrives without
  // one must not take the whole team overview down with it.
  return second ? { step: second, target: second.targets?.[0] ?? null } : null;
});

const backupLine = computed<I18nText>(() => {
  const found = backupTarget.value;
  if (!found?.target) return raw("");
  const label = String(t(`oncall.target_${found.target.kind}`));
  return raw(
    `${label} · ${t("oncall.teamPagedAt", { delay: formatMicrosDuration(found.step.after_micros) })}`,
  );
});

/// How far down the cycle a derived secondary sits. Null unless the rung is
/// the derived one AND the offset is interesting — see the template.
const backupOffset = computed<number | null>(() => {
  if (backupTarget.value?.target?.kind !== "next_on_call") return null;
  const offset = holder.value?.next_offset ?? 1;
  return offset > 1 ? offset : null;
});

/// Who that rung reaches. `next_on_call` stays **within** the primary slot, so
/// the slot holder's own `next_user_email` is the answer — not the first
/// non-empty slot, which on a two-slot team is a coin toss.
const backupWho = computed<string | null>(() => {
  const target = backupTarget.value?.target;
  if (!target) return null;
  if (target.kind === "user") return target.email;
  if (target.kind === "next_on_call") return holder.value?.next_user_email ?? null;
  if (target.kind === "on_call_now") return holder.value?.user_email ?? null;
  // whole_team / everyone_on_schedule reach a room, not a person — the ladder
  // on the Escalation tab names them, and one avatar here would misrepresent
  // how many people that rung wakes.
  return null;
});

const nextPrimaryLine = computed<I18nText>(() => {
  const current = rotation.value;
  if (!current) return raw("");
  const [thisShift, afterThat] = upcomingShifts(current, nowMicros.value, 3).slice(0, 2);
  if (!thisShift) return raw("");

  const parts: string[] = [
    String(
      t("oncall.teamNextPrimary", {
        name: raw(holder.value?.next_user_email ?? ""),
        duration: formatMicrosDuration(thisShift.endMicros - nowMicros.value),
      }),
    ),
  ];
  // Only when it is somebody NEW: a two-person rotation cycles straight back,
  // and "Then Ana" under "Next Ana" reads as a third shift that is not coming.
  if (afterThat && afterThat.member !== holder.value?.next_user_email) {
    parts.push(
      String(
        t("oncall.teamThen", {
          name: raw(afterThat.member),
          date: raw(formatInZone(afterThat.startMicros, zone.value, { dateStyle: "medium" })),
        }),
      ),
    );
  }
  return raw(parts.join(" · "));
});

const reach = computed<TeamRungSummary[]>(() => props.overview?.rungs ?? []);

/**
 * Rows this panel may draw.
 *
 * Four panels sit side by side and the tallest sets the height of the row, so
 * a list that grows one line per priority makes the other three mostly empty.
 * Three is what fits beside them.
 */
const MAX_REACH_ROWS = 3;

/// Priorities that wake nobody, collapsed to one line — the finding is "these
/// page nobody", which is one fact however many priorities share it.
const silentPriorities = computed(() => reach.value.filter((entry) => !entry.pages_anyone));

const silentLabel = computed<I18nText>(() =>
  raw(silentPriorities.value.map((entry) => entry.priority).join(", ")),
);

const pagingPriorities = computed(() => reach.value.filter((entry) => entry.pages_anyone));

/// The ladders that actually fire, most urgent first. The two summary lines —
/// "these also page" and "these page nobody" — take the last rows when they are
/// needed, so neither is the one that falls off the bottom.
const visibleReach = computed<TeamRungSummary[]>(() => {
  const paging = pagingPriorities.value;
  const budget = MAX_REACH_ROWS - (silentPriorities.value.length ? 1 : 0);
  // Everything fits, so nothing is collapsed and no summary row is spent.
  if (paging.length <= budget) return paging;
  // One row goes to naming what did not fit; the rest show their ladders.
  return paging.slice(0, Math.max(0, budget - 1));
});

/// Priorities that page and were not drawn in full — named, never dropped.
const hiddenReach = computed<TeamRungSummary[]>(() =>
  pagingPriorities.value.slice(visibleReach.value.length),
);

const hiddenLabel = computed<I18nText>(() =>
  raw(hiddenReach.value.map((entry) => entry.priority).join(", ")),
);

/// The instant after which this priority stops waking anybody.
function nobodyAfter(entry: TeamRungSummary): I18nText {
  return t("oncall.reachNobodyAfter", {
    duration: formatMicrosDuration(entry.nobody_after_micros ?? 0),
  });
}

const stats = computed(() => props.overview?.stats ?? null);
const windowDays = computed(() => props.overview?.days ?? 7);

const ackedFastPct = computed<I18nText>(() =>
  raw(`${Math.round(props.overview?.acked_under_5m_percent ?? 0)}%`),
);

/// How far pages actually got. "Reached the whole team" is the loud one — it
/// means the ladder ran to the end and everybody was woken.
const activityLine = computed<I18nText>(() => {
  const s = stats.value;
  if (!s) return raw("");
  const parts: string[] = [];
  if (s.reached_second_rung) {
    parts.push(String(t("oncall.activityReachedSecond", { count: s.reached_second_rung })));
  }
  if (s.reached_final_rung) {
    parts.push(String(t("oncall.activityReachedFinal", { count: s.reached_final_rung })));
  }
  if (s.night_pages) {
    parts.push(String(t("oncall.activityOvernight", { count: s.night_pages }, s.night_pages)));
  }
  return raw(parts.join(" · "));
});
</script>
