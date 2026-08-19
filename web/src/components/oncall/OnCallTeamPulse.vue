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
  What a page fired right now would do — one rail, read left to right.

  This was four panels: on call now, backing them up, escalation reach, last
  seven days. They answered one question between them and asked the reader to
  assemble it, because the same ladder was split across three of them — the
  first rung under "on call now", the second under "backing them up", the shape
  of the rest under "reach". The rail is that ladder, in the order it fires.

  The rungs come from `GET .../escalation-preview`, which resolves each target
  against the rotation, the transports and the verification state at this
  instant — the one thing no amount of client-side arithmetic can work out. The
  handover comes from the SCHEDULE, because a slot carries no instants, and the
  week's figures from `GET .../overview`, counted in the database.
-->
<template>
  <div
    class="card-container rounded-surface bg-surface-base border-border-default flex flex-col gap-3 border px-4 py-3"
    data-test="oncall-team-pulse"
  >
    <OText variant="section" as="div" class="uppercase">
      {{ t("oncall.pulseFiresNow", { priority: raw(priority) }) }}
    </OText>

    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <OSpinner v-if="loading && !preview" variant="ring" size="xs" />

      <!-- A ladder nobody is on the end of is the loudest thing this strip can
           say, so it takes the whole rail rather than a chip beside it. -->
      <p v-else-if="!preview" class="text-text-secondary text-sm" data-test="oncall-pulse-unknown">
        {{ t("oncall.pulsePreviewUnavailable") }}
      </p>
      <p
        v-else-if="!steps.length"
        class="text-status-error-text text-sm"
        data-test="oncall-pulse-reaches-nobody"
      >
        {{ t("oncall.pulseReachesNobody", { priority: raw(priority) }) }}
      </p>

      <template v-for="(step, index) in steps" :key="step.key">
        <!-- The delay is the server's own, measured from the page opening —
             the same number the Escalation tab labels the rung with. -->
        <span
          v-if="index"
          class="text-text-secondary flex shrink-0 items-center gap-2 text-xs"
          aria-hidden="true"
        >
          <span class="bg-border-default h-px w-6" />
          {{ step.delay }}
          <span class="bg-border-default h-px w-6" />
        </span>

        <span class="flex min-w-0 flex-col gap-0.5" :data-test="`oncall-pulse-rung-${index}`">
          <OText variant="body-strong" as="span" class="truncate">{{ step.who }}</OText>
          <span class="flex flex-wrap items-center gap-1.5">
            <span class="text-text-secondary text-xs">{{ step.detail }}</span>
            <!-- Only where something is wrong. A rung that fires and reaches
                 nobody is worse than a slow one: the ladder moves on and the
                 page stays unanswered. The finding is a badge rather than a
                 bare mark — an icon says only "look here", and the reason is
                 four words; the server's full sentence stays on hover. -->
            <OTag
              v-if="step.problem"
              variant="error-soft"
              size="sm"
              :data-test="`oncall-pulse-rung-problem-${index}`"
            >
              {{ step.problem.label }}
              <OTooltip
                v-if="step.problem.tip"
                side="bottom"
                :content="step.problem.tip ?? undefined"
              />
            </OTag>
          </span>
        </span>
      </template>

      <span class="ms-auto flex shrink-0 items-center gap-2">
        <!-- Every priority that wakes nobody, on one chip: the finding is
             "these page nobody", which is one fact however many share it. -->
        <OTag
          v-if="silentPriorities.length"
          variant="error-soft"
          size="sm"
          data-test="oncall-pulse-silent"
        >
          {{ t("oncall.pulseSilent", { priorities: silentLabel }) }}
        </OTag>
        <OButton
          variant="ghost-primary"
          size="xs"
          data-test="oncall-pulse-edit-ladder"
          @click="emit('edit-ladder')"
        >
          {{ t("oncall.pulseEditLadder") }}
        </OButton>
      </span>
    </div>

    <OSeparator />

    <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
      <span class="text-text-secondary">{{ t("oncall.pulseHandoff") }}</span>
      <template v-if="handoffWho">
        <span class="text-text-heading font-semibold" data-test="oncall-pulse-handoff">
          {{ handoffWho }}
        </span>
        <span class="text-text-secondary">{{ handoffAt }}</span>
      </template>
      <span v-else class="text-text-secondary" data-test="oncall-pulse-no-handoff">
        {{ t("oncall.teamNoHandover") }}
      </span>
      <OButton
        variant="ghost-primary"
        size="xs"
        data-test="oncall-pulse-open-schedule"
        @click="emit('open-schedule')"
      >
        {{ t("oncall.pulseFullSchedule") }}
      </OButton>

      <span class="ms-auto flex flex-wrap items-baseline gap-x-2">
        <span class="text-text-secondary">{{ t("oncall.pulseWindow", { days: windowDays }) }}</span>
        <template v-if="stats && stats.pages">
          <span class="text-text-heading font-semibold" data-test="oncall-pulse-pages">
            {{ t("oncall.pulsePagesCount", { count: stats.pages }, stats.pages) }}
          </span>
          <span class="text-text-secondary" aria-hidden="true">{{ dot }}</span>
          <!-- Red only at nothing-acked-quickly: a share below a made-up
               threshold is an opinion, none at all is a fact. -->
          <span
            class="font-semibold"
            :class="nothingAckedFast ? 'text-status-error-text' : 'text-text-heading'"
            data-test="oncall-pulse-acked"
          >
            {{ t("oncall.pulseAckedFast", { percent: ackedFastPct }) }}
          </span>
          <span v-if="stats.reached_final_rung" class="text-text-secondary" aria-hidden="true">
            {{ dot }}
          </span>
          <span
            v-if="stats.reached_final_rung"
            class="text-text-secondary"
            data-test="oncall-pulse-reached-final"
          >
            {{ t("oncall.activityReachedFinal", { count: stats.reached_final_rung }) }}
          </span>
        </template>
        <span v-else class="text-text-secondary" data-test="oncall-pulse-no-pages">
          {{ t("oncall.activityNone") }}
        </span>
        <OButton
          variant="ghost-primary"
          size="xs"
          data-test="oncall-pulse-view-pages"
          @click="emit('open-pages')"
        >
          {{ t("oncall.pulseViewPages") }}
        </OButton>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { useOnCallClock } from "@/composables/useOnCallClock";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type {
  EscalationPreview,
  OnCallSchedule,
  OnCallSlot,
  TeamOverview,
} from "@/ts/interfaces/oncall";
import { DEFAULT_SLOT, sameSlot } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";
import {
  formatInZone,
  nextHandover,
  rungProblem,
  speakTarget,
  winningRotation,
} from "@/utils/oncall";

const props = withDefaults(
  defineProps<{
    /** The engine's own dry run of the ladder this strip draws. */
    preview?: EscalationPreview | null;
    loading?: boolean;
    /** Slots as `whoIsOnCall` returns them — the authority on WHO hands over. */
    slots?: OnCallSlot[];
    /** The schedule answers WHEN; a slot carries no start or end instant. */
    schedule?: OnCallSchedule | null;
    /** `GET .../overview` — the silent priorities and the window's figures. */
    overview?: TeamOverview | null;
    timezone?: string;
  }>(),
  {
    preview: null,
    loading: false,
    slots: () => [],
    schedule: null,
    overview: null,
    timezone: "UTC",
  },
);

const emit = defineEmits<{
  (e: "edit-ladder"): void;
  (e: "open-schedule"): void;
  (e: "open-pages"): void;
}>();

const { t } = useI18nTyped();

/// The separator between facts on one line. Decoration, so it is hidden from
/// a screen reader rather than read out between every figure.
const dot = raw("·");

const nowMicros = useOnCallClock();

/// Which ladder is on the rail. Named in the heading rather than assumed: the
/// other priorities can run a different one, and a strip that says "a page"
/// while drawing P1's rungs would be wrong on every team that varies them.
const priority = computed(() => props.preview?.priority ?? "P1");

const preview = computed(() => props.preview);

interface LadderStep {
  key: string;
  /** Absolute delay from the page opening. Empty on the opening rung. */
  delay: I18nText;
  who: I18nText;
  detail: I18nText;
  /** The badge, and the server's full sentence behind it. */
  problem: ReturnType<typeof rungProblem>;
}

/// The engine's own English, said the way the editor says it — one vocabulary
/// for one concept, rather than two a click apart.
const saidTargets = (targets: string[]) =>
  targets.map((target) => speakTarget(target, t)).join(", ");

/// A ladder that hands the page to the default team has not stopped — saying
/// it stopped would tell somebody nobody is coming when somebody is.
const endPhrase = computed<I18nText>(() =>
  props.preview?.final_action === "notify_default_team"
    ? t("oncall.pulseThenHandsOff")
    : t("oncall.pulseThenStops"),
);

const steps = computed<LadderStep[]>(() => {
  const rungs = preview.value?.rungs ?? [];
  return rungs.map((rung, index) => {
    const people = rung.recipients;
    const last = index === rungs.length - 1;
    // A rung wakes a pool or a person, and only one of those has a name worth
    // printing: six addresses on a rail is a wall rather than an answer.
    const many = people.length > 1;
    const parts = [
      many
        ? String(t("oncall.pulseAllMembers", { count: people.length }, people.length))
        : String(index === 0 ? t("oncall.pulsePagedFirst") : t("oncall.pulseIfNoAck")),
    ];
    if (last) parts.push(String(endPhrase.value));

    return {
      key: `${rung.after_micros}-${index}`,
      delay: raw(`+${formatMicrosDuration(rung.after_micros)}`),
      who: people.length === 1 ? raw(people[0].user_email) : raw(saidTargets(rung.targets)),
      detail: raw(parts.join(" · ")),
      problem: rungProblem(rung, t),
    };
  });
});

const silentPriorities = computed(() =>
  (props.overview?.rungs ?? []).filter((entry) => !entry.pages_anyone),
);

const silentLabel = computed<I18nText>(() =>
  raw(silentPriorities.value.map((entry) => entry.priority).join(", ")),
);

/// The primary slot, named rather than taken as "the first one with somebody
/// in it": a two-slot team returns two staffed slots and the order is the
/// server's business, so first-non-empty eventually hands over the secondary.
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

const zone = computed(() => props.schedule?.timezone || props.overview?.timezone || props.timezone);

/// When the pager changes hands, or null when nothing is scheduled to take it.
const handoverAt = computed<number | null>(() => {
  const current = rotation.value;
  if (!current || !holder.value?.next_user_email) return null;
  const at = nextHandover(current, nowMicros.value);
  return at && at > nowMicros.value ? at : null;
});

const handoffWho = computed<I18nText | null>(() =>
  handoverAt.value
    ? t("oncall.pulseHandoffIn", {
        name: raw(holder.value?.next_user_email ?? ""),
        duration: formatMicrosDuration(handoverAt.value - nowMicros.value),
      })
    : null,
);

/// The instant as well as the countdown: "in 5d 10h" is unreadable against a
/// calendar, and a reader in another office needs the zone spelled out.
const handoffAt = computed<I18nText>(() =>
  handoverAt.value
    ? raw(
        `· ${formatInZone(handoverAt.value, zone.value, {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
        })}`,
      )
    : raw(""),
);

const stats = computed(() => props.overview?.stats ?? null);
const windowDays = computed(() => props.overview?.days ?? 7);

const ackedFastPct = computed<I18nText>(() =>
  raw(`${Math.round(props.overview?.acked_under_5m_percent ?? 0)}`),
);

const nothingAckedFast = computed(() => !!stats.value?.pages && !stats.value.acked_under_5m);
</script>
