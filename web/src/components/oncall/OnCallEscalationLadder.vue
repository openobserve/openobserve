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
         from this strip is one nobody would think to check. -->
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
    </span>

    <OInnerLoading v-if="loading" showing />

    <p
      v-else-if="!preview || !preview.pages_anyone"
      class="text-status-error-text text-sm"
      data-test="oncall-ladder-silent"
    >
      {{ t("oncall.ladderPriorityPagesNobody", { priority: raw(selected) }) }}
    </p>

    <OTimeline v-else data-test="oncall-ladder-rungs">
      <OTimelineItem
        v-for="rung in preview.rungs"
        :key="rung.after_micros"
        :label="delayLabel(rung.after_micros)"
        :title="raw(saidTargets(rung.targets))"
        :subtitle="resolvesTo(rung)"
        variant="muted"
        :data-test="`oncall-ladder-rung-${rung.after_micros}`"
      >
        <!-- Only when something is wrong, and as a badge: the server's reason
             is a full sentence, which is a paragraph on a rail. The sentence
             itself is one hover away, so nothing is hidden. -->
        <OTag
          v-if="problems[rung.after_micros]"
          variant="error-soft"
          size="sm"
          class="mt-1"
          :data-test="`oncall-ladder-rung-problem-${rung.after_micros}`"
        >
          {{ problems[rung.after_micros]?.label }}
          <OTooltip
            v-if="problems[rung.after_micros]?.tip"
            side="bottom"
            :content="problems[rung.after_micros]?.tip ?? undefined"
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
    selected?: string;
    preview?: EscalationPreview | null;
    loading?: boolean;
  }>(),
  { priorities: () => [], policy: null, selected: "P1", preview: null, loading: false },
);

const emit = defineEmits<{ (e: "update:selected", priority: string): void; (e: "edit"): void }>();

const { t } = useI18nTyped();

/// The engine's own English, said the way the editor says it — one vocabulary
/// for one concept, rather than two a click apart.
const saidTargets = (targets: string[]) =>
  targets.map((target) => speakTarget(target, t)).join(", ");

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

/// Kept so the template reads the prop rather than reaching through `props`.
const preview = computed(() => props.preview);
</script>
