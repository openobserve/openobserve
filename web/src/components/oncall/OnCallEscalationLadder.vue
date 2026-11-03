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
  beside it. Channels are said once per priority, on its chip, because they
  belong to the priority and never to a step or a person. Per-person verdicts
  are spent only where something is wrong: a healthy ladder is read to check its
  SHAPE, and listing every address on it buried the one rung that would reach
  nobody.
-->
<template>
  <div class="relative flex flex-col gap-3" data-test="oncall-escalation-ladder">
    <!-- Every priority, including the ones that wake nobody: a priority absent from this strip is one nobody would think to check. -->
    <span class="flex min-w-0 flex-wrap items-center gap-2" data-test="oncall-ladder-strip">
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

    <div
      class="border-border-default rounded-surface bg-surface-base flex flex-col border"
      data-test="oncall-ladder-card"
    >
      <!-- Edit and Send test sit on the header of the ladder they act on. -->
      <div
        class="border-border-default flex flex-wrap items-center gap-2 border-b px-4 py-3"
        data-test="oncall-ladder-header"
      >
        <span class="flex items-center gap-1.5" data-test="oncall-ladder-heading">
          <OTag
            v-for="priority in selectedGroup?.priorities ?? [selected]"
            :key="priority"
            type="alertPriority"
            :value="priority.toLowerCase()"
            size="sm"
          />
        </span>
        <OnCallChannelIcons v-if="headerChannels.length" :channels="headerChannels" />
        <span class="ms-auto flex items-center gap-2">
          <!-- The why hangs off a wrapper: a disabled button gets no pointer events, so its own tooltip never opens. -->
          <span
            v-if="canConfigure && !silent"
            class="inline-flex"
            data-test="oncall-ladder-send-test-wrap"
          >
            <OTooltip
              v-if="!sendTestReady"
              side="bottom"
              :content="t('oncall.ladderSendTestBlocked')"
            />
            <OButton
              variant="outline"
              size="sm"
              icon-left="play-arrow"
              :disabled="!sendTestReady"
              data-test="oncall-ladder-send-test"
              @click="emit('send-test')"
            >
              {{ t("oncall.ladderSendTestPage") }}
            </OButton>
          </span>
          <OButton
            variant="outline-primary"
            size="sm"
            icon-left="edit"
            data-test="oncall-policy-edit"
            @click="emit('edit')"
          >
            {{ t("oncall.edit") }}
          </OButton>
        </span>
      </div>

      <OInnerLoading v-if="loading" showing />

      <template v-else>
        <!-- Every level of every priority aimed at the whole team, on a team that HAS rotations, is a policy minted before it had members. -->
        <span
          v-if="staleDefaultLadder"
          class="border-border-default flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b px-4 py-2"
          data-test="oncall-ladder-stale-default"
        >
          <OTag variant="warning-soft" size="sm">{{ t("oncall.ladderStaleDefaultTag") }}</OTag>
          <span class="text-text-secondary text-xs">{{ t("oncall.ladderStaleDefaultHint") }}</span>
        </span>

        <!-- Low priorities page nobody by default, so only P1–P3 say it in red. -->
        <p
          v-if="silent"
          class="px-4 py-3 text-sm"
          :class="silentIsDefault ? 'text-text-secondary' : 'text-status-error-text'"
          data-test="oncall-ladder-silent"
        >
          {{
            silentIsDefault
              ? t("oncall.ladderNobodyPagedDefault")
              : t("oncall.ladderPriorityPagesNobody", { priority: raw(selected) })
          }}
        </p>

        <!-- A numbered rail with a fixed time column, so every "who" starts on the same line. -->
        <ol v-else-if="preview" class="flex flex-col px-4 py-3" data-test="oncall-ladder-rungs">
          <li
            v-for="(group, index) in rungGroups"
            :key="group.key"
            class="relative flex items-start gap-3 pb-4"
            :data-test="`oncall-ladder-rung-${group.firstMicros}`"
          >
            <span
              class="bg-border-default absolute start-3 top-6 bottom-0 w-px"
              aria-hidden="true"
            />
            <span
              class="border-border-default bg-surface-base text-text-secondary relative flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium"
              aria-hidden="true"
            >
              {{ index + 1 }}
            </span>
            <OText
              variant="meta"
              class="w-24 shrink-0 pt-0.5"
              :data-test="`oncall-ladder-rung-time-${group.firstMicros}`"
            >
              {{ delayLabel(group.firstMicros) }}
            </OText>
            <span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <template v-if="isWholeTeamRung(group.rung)">
                <span>{{ t("oncall.ladderWholeTeam") }}</span>
                <span
                  class="flex items-center"
                  :data-test="`oncall-ladder-people-${group.firstMicros}`"
                >
                  <OAvatar
                    v-for="one in group.rung.recipients.slice(0, STACK)"
                    :key="one.user_email"
                    :value="one.user_email"
                    :name="nameOf(one.user_email)"
                    size="sm"
                    class="ring-surface-base -ms-1 ring-2 first:ms-0"
                  />
                  <span
                    v-if="group.rung.recipients.length > STACK"
                    class="text-text-secondary ms-1 text-xs"
                  >
                    {{ raw(`+${group.rung.recipients.length - STACK}`) }}
                  </span>
                  <OTooltip side="bottom" :content="peopleNames(group.rung)" />
                </span>
              </template>
              <template v-else>
                <OTag
                  v-for="seat in group.rung.targets.map(seatOf)"
                  :key="seat"
                  variant="default-outline"
                  size="sm"
                >
                  {{ raw(seat) }}
                </OTag>
                <span
                  v-for="one in group.rung.recipients"
                  :key="one.user_email"
                  class="flex min-w-0 items-center gap-1.5"
                >
                  <OAvatar :value="one.user_email" :name="nameOf(one.user_email)" size="sm" />
                  <span class="truncate">{{ raw(nameOf(one.user_email)) }}</span>
                </span>
              </template>
              <span v-if="group.count > 1" class="text-text-secondary text-xs">
                {{ t("oncall.ladderRepeatsUntil", { to: durationLabel(group.lastMicros) }) }}
              </span>
              <!-- Only when something is wrong, as a badge; the server's sentence is one hover away. -->
              <OTag
                v-if="problems[group.firstMicros]"
                variant="error-soft"
                size="sm"
                :data-test="`oncall-ladder-rung-problem-${group.firstMicros}`"
              >
                {{ problems[group.firstMicros]?.label }}
                <OTooltip
                  v-if="problems[group.firstMicros]?.tip"
                  side="bottom"
                  :content="problems[group.firstMicros]?.tip ?? undefined"
                />
              </OTag>
            </span>
            <OnCallChannelIcons
              v-if="stepChannels(group.rung).length"
              class="ms-auto shrink-0 pt-0.5"
              :channels="stepChannels(group.rung)"
            />
          </li>

          <!-- The ending is the rail's last stop: when the ladder runs out is what the delays are read against. -->
          <li class="flex items-center gap-3" data-test="oncall-ladder-ends">
            <span
              class="border-border-default bg-surface-base text-text-secondary flex size-6 shrink-0 items-center justify-center rounded-full border"
              aria-hidden="true"
            >
              <OIcon name="stop-circle" size="sm" />
            </span>
            <OText variant="meta" class="w-24 shrink-0" data-test="oncall-ladder-ends-time">
              {{ endTime }}
            </OText>
            <!-- How a page can leave this team, in the server's words, on hover of the ending it qualifies. -->
            <span class="text-text-secondary text-sm" data-test="oncall-ladder-ends-line">
              {{ endTitle }}
              <OTooltip
                v-if="preview.cross_team_moves.length"
                side="bottom"
                :content="raw(preview.cross_team_moves.join(' '))"
              />
            </span>
            <OButton
              variant="outline"
              size="sm"
              icon-left="add"
              data-test="oncall-ladder-add-rung"
              @click="emit('edit')"
            >
              {{ t("oncall.ladderAddStep") }}
            </OButton>
          </li>
        </ol>

        <!-- The AI's part, in one line under the ladder it runs beside. -->
        <span
          v-if="l0 && !silent"
          class="border-border-default flex items-center gap-1.5 border-t px-4 py-2"
          :data-test="`oncall-ladder-l0-${l0.mode}`"
        >
          <OIcon name="auto-awesome" size="sm" class="text-text-secondary" />
          <OText variant="meta">{{ l0Line }}</OText>
        </span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ButtonVariant } from "@/lib/core/Button/OButton.types";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OAvatar from "@/lib/core/Avatar/OAvatar.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OnCallChannelIcons from "./OnCallChannelIcons.vue";
import { useOrgUserNames } from "@/composables/useOrgUserNames";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type {
  Channel,
  EscalationPreview,
  OnCallPolicy,
  PreviewRung,
  Rotation,
  TeamRungSummary,
} from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { MICROS_PER_MINUTE } from "@/ts/interfaces/oncall";
import { channelList, rungProblem, speakTarget } from "@/utils/oncall";
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
    /** May send a test page, which needs config access. */
    canConfigure?: boolean;
  }>(),
  {
    priorities: () => [],
    policy: null,
    rotations: () => [],
    selected: "P1",
    preview: null,
    loading: false,
    canConfigure: false,
  },
);

const emit = defineEmits<{
  (e: "update:selected", priority: string): void;
  (e: "edit"): void;
  (e: "open-members"): void;
  (e: "send-test"): void;
}>();

const { t } = useI18nTyped();
const { nameOf } = useOrgUserNames();

/// The lowest priorities page nobody unless somebody chose otherwise, so their silence is not a finding.
const DEFAULT_SILENT_FROM = 4;

/// The one target string `speakTarget` maps to "the whole team" — checked
/// against the engine's own words, not against `EscalationTarget.kind`, since
/// `PreviewRung.targets` never carries the kind, only the rendered sentence.
const isWholeTeamRung = (rung: PreviewRung) =>
  rung.targets.some((target) => target.trim().toLowerCase() === "the whole team");

const numberOf = (entry: TeamRungSummary) => Number(entry.priority.slice(1));

/// What makes two priorities the same ladder. `null` means UNKNOWN — without
/// the policy we cannot claim two ladders match, so nothing folds. `p1_parallel`
/// is part of the shape: the same steps fired at once are a different ladder,
/// and the same steps sent on other channels are too.
function ladderKey(entry: TeamRungSummary): string | null {
  if (!entry.pages_anyone) return "silent";
  if (!props.policy) return null;
  const priority = numberOf(entry);
  const rung = props.policy.rungs.find((candidate) => candidate.priority === priority);
  if (!rung) return null;
  return JSON.stringify([
    priority === 1 && props.policy.p1_parallel === true,
    rung.steps,
    [...rung.channels].sort(),
  ]);
}

/// `send_test_page` pages the earliest step (delays are unique per priority) of the requested priority, so the preview must be that priority's and its first step must reach somebody.
const sendTestReady = computed(() => {
  const preview = props.preview;
  if (!preview?.pages_anyone || preview.priority !== props.selected) return false;
  const first = [...preview.rungs].sort((a, b) => a.after_micros - b.after_micros)[0];
  return !!first?.recipients.length;
});

interface PriorityGroup {
  key: string;
  label: I18nText;
  summary: I18nText;
  variant: ButtonVariant;
  summaryTone: string;
  /** Which priority a click selects — the first of the run. */
  selects: string;
  priorities: string[];
}

/// Consecutive priorities running the same ladder fold into one chip, so five chips never describe one ladder.
const groups = computed<PriorityGroup[]>(() => {
  const runs: TeamRungSummary[][] = [];
  let previousKey: string | null = null;

  for (const entry of props.priorities) {
    const key = ladderKey(entry);
    const run = runs[runs.length - 1];
    // A null key never folds, and nor does a gap: "P1–P4" would promise a P2 and a P3 the strip never listed.
    const follows = run && numberOf(entry) === numberOf(run[run.length - 1]) + 1;
    if (key !== null && key === previousKey && follows) run.push(entry);
    else runs.push([entry]);
    previousKey = key;
  }

  return runs.map((run) => {
    const first = run[0];
    const last = run[run.length - 1];
    const isSelected = run.some((entry) => entry.priority === props.selected);
    // P4–P5 page nobody by default, so only a silent P1–P3 is drawn as a finding.
    const silent = !first.pages_anyone && numberOf(first) < DEFAULT_SILENT_FROM;
    return {
      key: (run.length > 1 ? `${first.priority}-${last.priority}` : first.priority).toLowerCase(),
      label: run.length > 1 ? raw(`${first.priority}–${last.priority}`) : raw(first.priority),
      summary: summaryFor(first, run.length),
      variant: isSelected ? "outline-primary" : silent ? "outline-destructive" : "outline",
      summaryTone: silent && !isSelected ? "" : "text-text-secondary",
      selects: first.priority,
      priorities: run.map((entry) => entry.priority),
    };
  });
});

const selectedGroup = computed(
  () => groups.value.find((group) => group.priorities.includes(props.selected)) ?? null,
);

/// "Email, SMS · 3 steps · 20m" for one priority; a folded run keeps the channels, which the fold guarantees they share.
function summaryFor(entry: TeamRungSummary, folded: number): I18nText {
  if (!entry.pages_anyone) return t("oncall.reachPagesNobody");
  const channels = channelList(entry.channels, t);
  const parts = channels ? [channels] : [];
  if (folded > 1) return raw([...parts, String(t("oncall.ladderSameLadder"))].join(" · "));
  parts.push(String(t("oncall.policyChipSteps", { count: entry.rungs }, entry.rungs)));
  if (entry.nobody_after_micros) parts.push(formatMicrosDuration(entry.nobody_after_micros));
  return raw(parts.join(" · "));
}

const MINUTES_PER_HOUR = 60;

function durationLabel(micros: number): I18nText {
  const minutes = Math.round(micros / MICROS_PER_MINUTE);
  return minutes < MINUTES_PER_HOUR
    ? t("oncall.ladderMinutes", { count: minutes }, minutes)
    : raw(formatMicrosDuration(micros));
}

function delayLabel(afterMicros: number): I18nText {
  return afterMicros === 0
    ? t("oncall.ladderStepAtOnce")
    : t("oncall.ladderStepAfter", { duration: durationLabel(afterMicros) });
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

/// The seat a target names: a rotation's name for its on-call, the engine's own words otherwise.
function seatOf(target: string): string {
  const onCall = target.trim().match(/^whoever is on call in (.+)$/i);
  return onCall ? onCall[1] : speakTarget(target, t);
}

function peopleNames(rung: PreviewRung): I18nText {
  return raw(rung.recipients.map((one) => nameOf(one.user_email)).join(", "));
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

/// A ladder that hands the page to the default team has not stopped, so it must not say it did.
const endTitle = computed<I18nText>(() =>
  props.preview?.final_action === "notify_default_team"
    ? t("oncall.ladderEndsHandsOff")
    : t("oncall.ladderEndsNobodyAnswered"),
);

/// How many faces a whole-team step shows before it counts the rest.
const STACK = 3;

/// Who a step could actually reach, by channel — the union of its people's deliverable channels.
function stepChannels(rung: PreviewRung): Channel[] {
  return [...new Set(rung.recipients.flatMap((one) => one.deliverable_channels))];
}

const headerChannels = computed<Channel[]>(() => {
  const entry = props.priorities.find((p) => p.priority === props.selected);
  return entry?.pages_anyone ? entry.channels : [];
});

/// When the ladder runs out: the last step's delay.
const endTime = computed<I18nText>(() => {
  const last = rungGroups.value[rungGroups.value.length - 1];
  return delayLabel(last ? last.lastMicros : 0);
});

const silent = computed(() => !props.preview || !props.preview.pages_anyone);

/// The preview's own L0 block, or nothing at all. Two ways to get nothing, and
/// both mean the same thing on screen: an older server that does not send the
/// field, and `available: false` — a deployment with no agent reachable does
/// not hold a page, whatever mode the policy stores.
const l0 = computed(() => {
  const block = props.preview?.l0;
  return block?.available ? block : null;
});

/// The AI's part for this priority in one line; `mode` is already resolved for it by the server.
const l0Line = computed<I18nText>(() => {
  const mode = l0.value?.mode;
  switch (mode) {
    case undefined:
    case "parallel":
      return t("oncall.ladderL0LineParallel");
    case "gate":
      return t("oncall.ladderL0LineGate", { seconds: l0.value?.triage_budget_seconds ?? 0 });
    case "only":
      return t("oncall.ladderL0LineOnly");
    case "off":
      return t("oncall.ladderL0Off");
    default: {
      const neverMode: never = mode;
      return neverMode;
    }
  }
});

const silentIsDefault = computed(
  () => Number(props.selected.replace(/\D/g, "")) >= DEFAULT_SILENT_FROM,
);

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
