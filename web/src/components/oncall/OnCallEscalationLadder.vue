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
  at this instant and whether a page to them would land, and only the server can
  answer it: it holds the rotation, the transports and the verification state.
-->
<template>
  <div class="flex flex-col gap-3" data-test="oncall-escalation-ladder">
    <!-- Every priority, including the ones that wake nobody. A priority absent
         from this strip is one nobody would think to check. -->
    <span class="flex flex-wrap items-center gap-2">
      <OButton
        v-for="entry in priorities"
        :key="entry.priority"
        :variant="entry.priority === selected ? 'primary' : 'outline'"
        size="xs"
        :data-test="`oncall-ladder-priority-${entry.priority.toLowerCase()}`"
        @click="emit('update:selected', entry.priority)"
      >
        {{ raw(entry.priority) }}
        <span class="text-2xs ms-1.5" :class="summaryToneFor(entry)">
          {{ summaryFor(entry) }}
        </span>
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
        :variant="rungVariant(rung)"
        framed
        :data-test="`oncall-ladder-rung-${rung.after_micros}`"
      >
        <span class="mt-1 flex flex-col gap-1">
          <!-- A rung that fires and reaches nobody is worse than a slow one:
               the ladder moves on and the page stays unanswered. -->
          <OTag v-if="rung.resolves_to_nobody" variant="error-soft" size="sm" class="self-start">
            {{ t("oncall.ladderReachesNobody") }}
          </OTag>
          <!-- Only worth counting on a rung with several people, where one
               silent address hides among names that would land. A "1 of 1" says
               nothing the reason underneath does not say better. -->
          <OTag
            v-else-if="unreachableIn(rung)"
            variant="error-soft"
            size="sm"
            class="self-start"
          >
            {{ unreachableIn(rung) }}
          </OTag>

          <span
            v-for="person in rung.recipients"
            :key="person.user_email"
            class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
            :data-test="`oncall-ladder-person-${person.user_email}`"
          >
            <span class="text-text-secondary text-xs">{{ t("oncall.ladderRightNow") }}</span>
            <OUserCell :value="person.user_email" />
            <!-- Channels that would carry it, or the server's reason none can.
                 Never our own guess at why a page failed. -->
            <span v-if="person.would_a_page_land" class="text-status-success-text text-xs">
              {{ channelList(person) }}
            </span>
            <span v-else class="text-status-error-text text-xs">
              {{ raw(person.why_not) || t("oncall.contactNoChannel") }}
            </span>
          </span>
        </span>
      </OTimelineItem>
    </OTimeline>

    <!-- What happens when the rungs run out, in the server's words. -->
    <OBanner
      v-if="preview?.ends_with"
      :variant="preview.reaches_nobody ? 'error-soft' : 'info'"
      inline-actions
      data-test="oncall-ladder-ends"
    >
      {{ raw(preview.ends_with) }}
      <template #actions>
        <OButton
          variant="outline"
          size="xs"
          data-test="oncall-ladder-add-rung"
          @click="emit('edit')"
        >
          {{ t("oncall.ladderAddRung") }}
        </OButton>
      </template>
    </OBanner>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OTimeline from "@/lib/data/Timeline/OTimeline.vue";
import OTimelineItem from "@/lib/data/Timeline/OTimelineItem.vue";
import type { TimelineItemVariant } from "@/lib/data/Timeline/OTimelineItem.types";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import type {
  EscalationPreview,
  PreviewRecipient,
  PreviewRung,
  TeamRungSummary,
} from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { speakTarget } from "@/utils/oncall";
import { formatMicrosDuration } from "@/utils/formatters";

const props = withDefaults(
  defineProps<{
    /** Every priority, from the overview — including the silent ones. */
    priorities?: TeamRungSummary[];
    selected?: string;
    preview?: EscalationPreview | null;
    loading?: boolean;
  }>(),
  { priorities: () => [], selected: "P1", preview: null, loading: false },
);

const emit = defineEmits<{ (e: "update:selected", priority: string): void; (e: "edit"): void }>();

const { t } = useI18nTyped();

/// The engine's own English, said the way the editor says it — one vocabulary
/// for one concept, rather than two a click apart.
const saidTargets = (targets: string[]) =>
  targets.map((target) => speakTarget(target, t)).join(", ");


/// "3 rungs · 20m", or the finding when the priority wakes nobody.
function summaryFor(entry: TeamRungSummary): I18nText {
  if (!entry.pages_anyone) return t("oncall.reachPagesNobody");
  const rungs = String(t("oncall.reachRungs", { count: entry.rungs }, entry.rungs));
  return entry.nobody_after_micros
    ? raw(`${rungs} · ${formatMicrosDuration(entry.nobody_after_micros)}`)
    : raw(rungs);
}

/// The finding is red only on an UNSELECTED chip. The selected one is a filled
/// surface, and red on it fails contrast badly enough to be unreadable — while
/// being the one priority whose finding is already spelled out in full
/// underneath. So it inherits the button's own foreground instead: nothing is
/// lost, and the red is spent where it is still the only warning on screen.
function summaryToneFor(entry: TeamRungSummary): string {
  if (entry.pages_anyone || entry.priority === props.selected) return "";
  return "text-status-error-text";
}

/// Kept to a few characters — this is a rail, not a column. "0m" rather than
/// "immediately", which the design also uses and which lines the rungs up.
function delayLabel(afterMicros: number): I18nText {
  return afterMicros === 0 ? raw("0m") : raw(`+${formatMicrosDuration(afterMicros)}`);
}

/// "1 of 6 unreachable" — the count that matters on a whole-team rung, where a
/// single silent address is easy to miss among the names that would land.
function unreachableIn(rung: PreviewRung): I18nText | "" {
  const total = rung.recipients.length;
  if (total < 2) return "";
  const bad = rung.recipients.filter((person) => !person.would_a_page_land).length;
  return bad ? t("oncall.ladderUnreachableCount", { count: bad, total }) : "";
}

/// Position, not state. The rail is the clock: the rung firing now is the one
/// somebody is living through, and the rest are still ahead. Colouring it by
/// health instead turned the whole rail red on a deployment where nothing can
/// be delivered, which says the same thing three times and loses the ordering.
function rungVariant(rung: PreviewRung): TimelineItemVariant {
  return rung.after_micros === 0 ? "destructive" : "muted";
}

function channelList(person: PreviewRecipient): I18nText {
  return raw(
    person.deliverable_channels.map((channel) => String(t(`oncall.channel_${channel}`))).join(", "),
  );
}

/// Kept so the template reads the prop rather than reaching through `props`.
const preview = computed(() => props.preview);
</script>
