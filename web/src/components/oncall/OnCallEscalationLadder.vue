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
  What each priority's ladder would actually do, right now.

  A policy reads as a list of target KINDS — "the on-call", "the whole team" —
  which is not the question anybody has. The question is who that resolves to
  at this instant, and only the server can answer it: it holds the rotation,
  the transports and the verification state.

  One line per rung, and the ending is the rail's last rung rather than a panel
  beside it. Channels and per-person verdicts are spent only where something is
  wrong: a healthy ladder is read to check its SHAPE, and listing every address
  and transport on it buried the one rung that would reach nobody.
-->
<template>
  <div class="flex flex-col gap-4" data-test="oncall-escalation-ladder">
    <!-- Every priority, including the ones that wake nobody. A priority absent
         from this strip is one nobody would think to check. The edit button
         rides along on the same row rather than a title above it — this
         strip already says what is being edited. -->
    <span class="flex flex-wrap items-center gap-2">
      <OButton
        v-for="group in groups"
        :key="group.key"
        :variant="group.variant"
        size="xs"
        :data-test="`oncall-ladder-priority-${group.key}`"
        @click="emit('update:selected', group.selects)"
      >
        {{ group.label }}
        <span class="text-2xs ms-1.5" :class="group.summaryTone">{{ group.summary }}</span>
      </OButton>
      <OButton
        variant="outline"
        size="xs"
        class="ms-auto"
        data-test="oncall-policy-edit"
        @click="emit('edit')"
      >
        {{ t("oncall.edit") }}
      </OButton>
    </span>

    <OInnerLoading v-if="loading" showing />

    <template v-else>
      <!-- Every level of every priority aimed at the whole team, on a team that
         HAS rotations, is only ever one thing: a policy minted before the team
         had members, so before there were rotation ids for a level to name. -->
      <span
        v-if="staleDefaultLadder"
        class="border-border-default bg-surface-subtle rounded-surface flex flex-wrap items-baseline gap-x-2 gap-y-1 border p-3"
        data-test="oncall-ladder-stale-default"
      >
        <OTag variant="warning-soft" size="sm">{{ t("oncall.ladderStaleDefaultTag") }}</OTag>
        <span class="text-text-secondary text-xs">{{ t("oncall.ladderStaleDefaultHint") }}</span>
      </span>

      <!-- L0 rides above the rail rather than on it: the agent starts when the
         record opens, so it is not a rung with a delay of its own. The server's
         sentence carries whether anything waits — for `parallel` nothing does. -->
      <span
        v-if="l0"
        class="border-border-default bg-surface-subtle rounded-surface flex flex-wrap items-baseline gap-x-2 gap-y-1 border p-3"
        :data-test="`oncall-ladder-l0-${l0.mode}`"
      >
        <OTag variant="primary-soft" size="sm">{{ l0ModeLabel }}</OTag>
        <span class="text-text-secondary text-xs">{{ raw(l0.summary) }}</span>
      </span>

      <p
        v-if="!preview || !preview.pages_anyone"
        class="text-status-error-text text-sm"
        data-test="oncall-ladder-silent"
      >
        {{ t("oncall.ladderPriorityPagesNobody", { priority: raw(selected) }) }}
      </p>

      <OTimeline v-else data-test="oncall-ladder-rungs">
        <!-- Consecutive rungs aiming at the same people, with the same
           verdict, fold into one row: four identical "whole team, 3 of 3
           unreachable" blocks are one finding, not four events to read one
           by one. Mirrors the fold OnCallEscalation.vue does for the fired
           ladder — the shape repeats because the underlying question does. -->
        <OTimelineItem
          v-for="group in rungGroups"
          :key="group.key"
          :label="rungLabel(group)"
          :title="raw(saidTargets(group.rung.targets))"
          :subtitle="isWholeTeamRung(group.rung) ? undefined : subtitleFor(group)"
          variant="muted"
          :data-test="`oncall-ladder-rung-${group.firstMicros}`"
        >
          <!-- A whole-team target resolves to the roster this instant — the
             count is an answer to "who", so it opens the tab that names them
             rather than sitting there as inert text. -->
          <template v-if="isWholeTeamRung(group.rung)" #subtitle>
            <button
              v-if="resolvesTo(group.rung)"
              type="button"
              class="underline hover:text-text-heading"
              :data-test="`oncall-ladder-open-members-${group.firstMicros}`"
              @click="emit('open-members')"
            >
              {{ resolvesTo(group.rung) }}
            </button>
            <template v-if="group.count > 1">
              · {{ t("oncall.reachRungs", { count: group.count }, group.count) }}
            </template>
          </template>

          <!-- Only when something is wrong, and as a badge: the server's reason
             is a full sentence, which is a paragraph on a rail. The sentence
             itself is one hover away, so nothing is hidden. -->
          <OTag
            v-if="problems[group.firstMicros]"
            variant="error-soft"
            size="sm"
            class="mt-1"
            :data-test="`oncall-ladder-rung-problem-${group.firstMicros}`"
          >
            {{ problems[group.firstMicros]?.label }}
            <OTooltip
              v-if="problems[group.firstMicros]?.tip"
              side="bottom"
              :content="problems[group.firstMicros]?.tip ?? undefined"
            />
          </OTag>
        </OTimelineItem>

        <!-- The ending is a rung of the same rail: it is when the ladder runs
           out, which is the fact the delays above are read against. -->
        <OTimelineItem
          :label="t('oncall.ladderEnd')"
          :title="endTitle"
          variant="muted"
          data-test="oncall-ladder-ends"
        >
          <span class="flex flex-wrap items-baseline gap-x-2">
            <!-- The server's own sentence — never our guess at what a policy ends with. -->
            <span class="text-text-secondary text-xs">{{ raw(preview.ends_with) }}</span>
            <OButton
              variant="ghost-primary"
              size="xs"
              data-test="oncall-ladder-add-rung"
              @click="emit('edit')"
            >
              {{ t("oncall.ladderAddRung") }}
            </OButton>
          </span>

          <!-- How a page can leave this team at all. Both sentences are the
             server's: "escalate to a sibling" is not a thing, and wording it
             that way would tell somebody they still hold a page they gave away. -->
          <span
            v-for="(move, index) in preview.cross_team_moves"
            :key="index"
            class="text-text-secondary block text-xs"
            :data-test="`oncall-ladder-move-${index}`"
          >
            {{ raw(move) }}
          </span>
        </OTimelineItem>
      </OTimeline>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import type { ButtonVariant } from "@/lib/core/Button/OButton.types";
import OTimeline from "@/lib/data/Timeline/OTimeline.vue";
import OTimelineItem from "@/lib/data/Timeline/OTimelineItem.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type {
  EscalationPreview,
  OnCallPolicy,
  PreviewRung,
  Rotation,
  TeamRungSummary,
} from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { rungProblem, speakTarget } from "@/utils/oncall";
import { formatMicrosDuration } from "@/utils/formatters";

const props = withDefaults(
  defineProps<{
    /** Every priority, from the overview — including the silent ones. */
    priorities?: TeamRungSummary[];
    /** The stored policy, read only to tell which priorities share a ladder. */
    policy?: OnCallPolicy | null;
    /** The team's rotations — read only to tell the stale default apart from
     *  a team that genuinely has nobody but "everyone". */
    rotations?: Rotation[];
    selected?: string;
    preview?: EscalationPreview | null;
    loading?: boolean;
  }>(),
  {
    priorities: () => [],
    policy: null,
    rotations: () => [],
    selected: "P1",
    preview: null,
    loading: false,
  },
);

const emit = defineEmits<{
  (e: "update:selected", priority: string): void;
  (e: "edit"): void;
  (e: "open-members"): void;
}>();

const { t } = useI18nTyped();

/// The engine's own English, said the way the editor says it — one vocabulary
/// for one concept, rather than two a click apart.
const saidTargets = (targets: string[]) =>
  targets.map((target) => speakTarget(target, t)).join(", ");

/// The one target string `speakTarget` maps to "the whole team" — checked
/// against the engine's own words, not against `EscalationTarget.kind`, since
/// `PreviewRung.targets` never carries the kind, only the rendered sentence.
const isWholeTeamRung = (rung: PreviewRung) =>
  rung.targets.some((target) => target.trim().toLowerCase() === "the whole team");

const numberOf = (entry: TeamRungSummary) => Number(entry.priority.slice(1));

/// What makes two priorities the same ladder. `null` means UNKNOWN — without
/// the policy we cannot claim two ladders match, so nothing folds. `p1_parallel`
/// is part of the shape: the same steps fired at once are a different ladder.
function ladderKey(entry: TeamRungSummary): string | null {
  if (!entry.pages_anyone) return "silent";
  if (!props.policy) return null;
  const priority = numberOf(entry);
  const rung = props.policy.rungs.find((candidate) => candidate.priority === priority);
  if (!rung) return null;
  return JSON.stringify([priority === 1 && props.policy.p1_parallel === true, rung.steps]);
}

interface PriorityGroup {
  key: string;
  label: I18nText;
  summary: I18nText;
  variant: ButtonVariant;
  summaryTone: string;
  /** Which priority a click selects — the first of the run. */
  selects: string;
}

/// Consecutive priorities running the same ladder fold into one chip. Five
/// chips that all describe one ladder are five things to check, and a reader
/// comparing them has to hold four of them in their head to find the one that
/// differs.
const groups = computed<PriorityGroup[]>(() => {
  const runs: TeamRungSummary[][] = [];
  let previousKey: string | null = null;

  for (const entry of props.priorities) {
    const key = ladderKey(entry);
    const run = runs[runs.length - 1];
    // A null key never folds — not with its neighbour and not with itself. Nor
    // does a gap: "P1–P4" would promise a P2 and a P3 the strip never listed.
    const follows = run && numberOf(entry) === numberOf(run[run.length - 1]) + 1;
    if (key !== null && key === previousKey && follows) run.push(entry);
    else runs.push([entry]);
    previousKey = key;
  }

  return runs.map((run) => {
    const first = run[0];
    const last = run[run.length - 1];
    const isSelected = run.some((entry) => entry.priority === props.selected);
    const silent = !first.pages_anyone;

    return {
      key: (run.length > 1 ? `${first.priority}-${last.priority}` : first.priority).toLowerCase(),
      label: run.length > 1 ? raw(`${first.priority}–${last.priority}`) : raw(first.priority),
      summary: summaryFor(first, run.length),
      variant: isSelected ? "outline-primary" : silent ? "outline-destructive" : "outline",
      // The chip's own border and text already carry the finding when it is
      // red; on the others the sub-label is metadata and stays quiet.
      summaryTone: silent && !isSelected ? "" : "text-text-secondary",
      selects: first.priority,
    };
  });
});

/// "3 rungs · 20m" for one priority, and for a folded run the only fact that is
/// still true of every member of it.
function summaryFor(entry: TeamRungSummary, folded: number): I18nText {
  if (!entry.pages_anyone) return t("oncall.reachPagesNobody");
  if (folded > 1) return t("oncall.ladderSameLadder");
  const rungs = String(t("oncall.reachRungs", { count: entry.rungs }, entry.rungs));
  return entry.nobody_after_micros
    ? raw(`${rungs} · ${formatMicrosDuration(entry.nobody_after_micros)}`)
    : raw(rungs);
}

/// Kept to a few characters — this is a rail, not a column. "0m" rather than
/// "immediately", which the design also uses and which lines the rungs up.
function delayLabel(afterMicros: number): I18nText {
  return afterMicros === 0 ? raw("0m") : raw(`+${formatMicrosDuration(afterMicros)}`);
}

interface RungGroup {
  key: string;
  /** The first rung in the run — every rung it absorbs reads identically. */
  rung: PreviewRung;
  count: number;
  firstMicros: number;
  lastMicros: number;
}

/// What makes two rungs the same finding: who they aim at, who that resolves
/// to, and whether each of those people is reachable. Delay is deliberately
/// absent — that is the axis being folded, not part of the match.
function rungSignature(rung: PreviewRung): string {
  const people = rung.recipients
    .map((one) => `${one.user_email}:${one.would_a_page_land}:${one.why_not ?? ""}`)
    .join(",");
  return JSON.stringify([rung.targets, people, rung.resolves_to_nobody]);
}

/// Consecutive rungs sharing a signature fold into one row. A ladder that
/// pages the same unreachable people every 5 minutes for half an hour is one
/// fact — "still nobody" — not six rows saying it again.
const rungGroups = computed<RungGroup[]>(() => {
  const rungs = preview.value?.rungs ?? [];
  const out: RungGroup[] = [];
  let previousSignature: string | null = null;

  for (const rung of rungs) {
    const signature = rungSignature(rung);
    const last = out[out.length - 1];
    if (last && signature === previousSignature) {
      last.count += 1;
      last.lastMicros = rung.after_micros;
    } else {
      out.push({
        key: `${rung.after_micros}`,
        rung,
        count: 1,
        firstMicros: rung.after_micros,
        lastMicros: rung.after_micros,
      });
    }
    previousSignature = signature;
  }
  return out;
});

/// A single rung keeps its own delay; a folded run reads as the span it
/// covers — "0m–30m" rather than four timestamps a reader would add up
/// themselves.
function rungLabel(group: RungGroup): I18nText {
  if (group.count === 1) return delayLabel(group.firstMicros);
  return raw(`${delayLabel(group.firstMicros)}–${formatMicrosDuration(group.lastMicros)}`);
}

/// Who it resolves to, plus — only once there is more than one rung to
/// account for — how many rungs said the same thing, reusing the count
/// phrasing the priority strip already uses for "3 rungs".
function subtitleFor(group: RungGroup): I18nText | undefined {
  const base = resolvesTo(group.rung);
  if (group.count <= 1) return base;
  const times = t("oncall.reachRungs", { count: group.count }, group.count);
  return raw(base ? `${base} · ${times}` : `${times}`);
}

/// Who the rung resolves to this instant — the line the whole preview exists
/// for. Named while it is one or two people; counted past that, where six
/// addresses are a wall rather than an answer.
function resolvesTo(rung: PreviewRung): I18nText | undefined {
  const people = rung.recipients;
  if (!people.length) return undefined;
  return people.length <= 2
    ? t("oncall.ladderResolvesTo", { who: raw(people.map((one) => one.user_email).join(", ")) })
    : t("oncall.ladderResolvesToMany", { count: people.length });
}

/// The exception badge per rung, keyed by delay so the template asks once.
/// Shared with the pulse strip, which used to say the same thing differently.
const problems = computed(() => {
  const out: Record<number, ReturnType<typeof rungProblem>> = {};
  for (const rung of props.preview?.rungs ?? []) {
    out[rung.after_micros] = rungProblem(rung, t);
  }
  return out;
});

/// A ladder that hands the page to the default team has not stopped — saying
/// it stopped would tell somebody nobody is coming when somebody is.
const endTitle = computed<I18nText>(() =>
  props.preview?.final_action === "notify_default_team"
    ? t("oncall.ladderEndsHandsOff")
    : t("oncall.ladderEndsStops"),
);

/// The preview's own L0 block, or nothing at all. Two ways to get nothing, and
/// both mean the same thing on screen: an older server that does not send the
/// field, and `available: false` — a deployment with no agent reachable does
/// not hold a page, whatever mode the policy stores.
const l0 = computed(() => {
  const block = props.preview?.l0;
  return block?.available ? block : null;
});

/// `mode` is read as the server resolved it FOR THIS PRIORITY. The P1
/// invariant and the P4/P5 rule are already applied, so nothing here consults
/// `policy.l0` — one place decides what a priority's mode is.
const l0ModeLabel = computed<I18nText>(() => {
  switch (l0.value?.mode) {
    case "gate":
      return t("oncall.ladderL0Gate");
    case "only":
      return t("oncall.ladderL0Only");
    default:
      return t("oncall.ladderL0Parallel");
  }
});

/// A team's policy is minted at create_team — before it has members, so before
/// it has rotations, so before there are ids for a level to name. It took the
/// whole-team fallback and, on a row created before 2026-08-21, nothing
/// revisited it. Rotations plus an all-whole_team ladder is only ever that.
const staleDefaultLadder = computed(() => {
  if (!props.rotations.length) return false;
  const steps = (props.policy?.rungs ?? []).flatMap((rung) => rung.steps);
  if (!steps.length) return false;
  return steps.every((step) => step.targets.every((target) => target.kind === "whole_team"));
});

/// Kept so the template reads the prop rather than reaching through `props`.
const preview = computed(() => props.preview);
</script>
