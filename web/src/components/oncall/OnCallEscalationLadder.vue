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
        <span class="text-2xs ms-1.5" :class="entry.pages_anyone ? '' : 'text-status-error-text'">
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

    <ol v-else class="flex flex-col gap-2">
      <li
        v-for="rung in preview.rungs"
        :key="rung.after_micros"
        class="flex items-start gap-3"
        :data-test="`oncall-ladder-rung-${rung.after_micros}`"
      >
        <OTag
          :variant="rung.after_micros === 0 ? 'error-soft' : 'default-soft'"
          size="sm"
          class="mt-2 shrink-0"
        >
          {{ delayLabel(rung.after_micros) }}
        </OTag>

        <div
          class="card-container rounded-default bg-surface-base flex min-w-0 flex-1 flex-col gap-1 border px-3 py-2"
          :class="rung.resolves_to_nobody ? 'border-status-error-text' : 'border-border-default'"
        >
          <span class="flex flex-wrap items-center gap-2">
            <span class="text-text-heading text-sm font-medium">
              {{ raw(rung.targets.join(", ")) }}
            </span>
            <!-- A rung that fires and reaches nobody is worse than a slow one:
                 the ladder moves on and the page stays unanswered. -->
            <OTag v-if="rung.resolves_to_nobody" variant="error-soft" size="sm">
              {{ t("oncall.ladderReachesNobody") }}
            </OTag>
            <OTag v-else-if="unreachableIn(rung)" variant="error-soft" size="sm">
              {{ unreachableIn(rung) }}
            </OTag>
          </span>

          <span
            v-for="person in rung.recipients"
            :key="person.user_email"
            class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
            :data-test="`oncall-ladder-person-${person.user_email}`"
          >
            <OUserCell :value="person.user_email" />
            <span class="text-text-secondary text-xs">{{ raw(person.reason) }}</span>
            <!-- Channels that would carry it, or the server's reason none can.
                 Never our own guess at why a page failed. -->
            <span
              v-if="person.would_a_page_land"
              class="text-status-success-text text-xs"
            >
              {{ channelList(person) }}
            </span>
            <span v-else class="text-status-error-text truncate text-xs">
              {{ raw(person.why_not) || t("oncall.contactNoChannel") }}
            </span>
          </span>
        </div>
      </li>
    </ol>

    <!-- What happens when the rungs run out, in the server's words. -->
    <OBanner
      v-if="preview?.ends_with"
      :variant="preview.reaches_nobody ? 'error' : 'info'"
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

/// "3 rungs · 20m", or the finding when the priority wakes nobody.
function summaryFor(entry: TeamRungSummary): I18nText {
  if (!entry.pages_anyone) return t("oncall.reachPagesNobody");
  const rungs = String(t("oncall.reachRungs", { count: entry.rungs }, entry.rungs));
  return entry.nobody_after_micros
    ? raw(`${rungs} · ${formatMicrosDuration(entry.nobody_after_micros)}`)
    : raw(rungs);
}

function delayLabel(afterMicros: number): I18nText {
  return afterMicros === 0
    ? t("oncall.rungImmediately")
    : raw(`+${formatMicrosDuration(afterMicros)}`);
}

/// "1 of 6 unreachable" — the count that matters on a whole-team rung, where a
/// single silent address is easy to miss among the names that would land.
function unreachableIn(rung: PreviewRung): I18nText | "" {
  const total = rung.recipients.length;
  const bad = rung.recipients.filter((person) => !person.would_a_page_land).length;
  return bad ? t("oncall.ladderUnreachableCount", { count: bad, total }) : "";
}

function channelList(person: PreviewRecipient): I18nText {
  return raw(
    person.deliverable_channels.map((channel) => String(t(`oncall.channel_${channel}`))).join(", "),
  );
}

/// Kept so the template reads the prop rather than reaching through `props`.
const preview = computed(() => props.preview);
</script>
