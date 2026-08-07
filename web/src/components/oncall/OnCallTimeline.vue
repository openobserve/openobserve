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
  <div class="flex flex-col gap-3" data-test="oncall-timeline">
    <div class="flex items-center gap-2">
      <OToggleGroup
        :model-value="showAll ? 'all' : 'people'"
        @update:model-value="(v) => (showAll = v === 'all')"
      >
        <OToggleGroupItem value="people" size="sm" data-test="oncall-timeline-filter-people">
          {{ t("oncall.timelinePeople") }}
        </OToggleGroupItem>
        <OToggleGroupItem value="all" size="sm" data-test="oncall-timeline-filter-all">
          {{ t("oncall.timelineAll") }}
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <ol v-if="visibleEvents.length" class="flex flex-col gap-0">
      <li
        v-for="(event, index) in visibleEvents"
        :key="`${event.at}-${index}`"
        class="flex gap-3"
        data-test="oncall-timeline-event"
      >
        <!-- Rail: a dot per event, joined by a line except on the last row. -->
        <div class="flex w-4 shrink-0 flex-col items-center">
          <span
            class="mt-2 size-2 shrink-0 rounded-full"
            :class="dotClass(event.kind)"
            aria-hidden="true"
          />
          <span
            v-if="index < visibleEvents.length - 1"
            class="bg-border-default w-px flex-1"
            aria-hidden="true"
          />
        </div>

        <div class="flex min-w-0 flex-1 flex-col gap-0.5 pb-4">
          <div class="flex flex-wrap items-center gap-2">
            <OTag :variant="kindVariant(event.kind)" size="sm">
              {{ t(`oncall.eventKind_${event.kind}`) }}
            </OTag>
            <span v-if="event.level" class="text-text-secondary text-xs">
              {{ t(`oncall.level_${event.level}`) }}
            </span>
            <span class="text-text-muted text-xs">{{ formatAt(event.at) }}</span>
            <span class="text-text-muted text-xs">{{ relativeTo(event.at) }}</span>
          </div>
          <p class="text-text-body text-sm break-words">{{ raw(event.body) }}</p>
          <p class="text-text-muted text-xs">{{ raw(event.actor) }}</p>
        </div>
      </li>
    </ol>

    <p v-else class="text-text-secondary py-6 text-center text-sm">
      {{ showAll ? t("oncall.timelineEmpty") : t("oncall.timelineNoHumanEvents") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import type { OnCallResponseEvent, ResponseEventKind } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/oncall";

const props = defineProps<{
  events: OnCallResponseEvent[];
  /** Anchor for the relative column — the record's `opened_at`. */
  openedAt: number;
}>();

const { t } = useI18nTyped();

// Engine bookkeeping is folded away by default. A responder reading a
// postmortem wants what people did; the machine's ladder ticks are noise until
// they are specifically the question.
const showAll = ref(false);

const HUMAN_KINDS: ResponseEventKind[] = ["note", "ack", "handoff"];

const visibleEvents = computed(() =>
  showAll.value
    ? props.events
    : props.events.filter(
        (e) => HUMAN_KINDS.includes(e.kind) || e.kind === "page" || e.kind === "rca",
      ),
);

function dotClass(kind: ResponseEventKind): string {
  switch (kind) {
    case "page":
      return "bg-icon-chip-error-text";
    case "ack":
      return "bg-icon-chip-info-text";
    case "recovery":
    case "state":
      return "bg-icon-chip-success-text";
    case "rca":
      return "bg-icon-chip-warning-text";
    default:
      return "bg-border-strong";
  }
}

function kindVariant(kind: ResponseEventKind): string {
  switch (kind) {
    case "page":
      return "error-soft";
    case "ack":
      return "blue-soft";
    case "recovery":
    case "state":
      return "success-soft";
    case "rca":
      return "amber-soft";
    case "handoff":
      return "orange-soft";
    default:
      return "neutral-soft";
  }
}

function formatAt(atMicros: number): string {
  return new Date(atMicros / 1000).toLocaleString();
}

/** Offset from the record opening — how the trace is actually read. */
function relativeTo(atMicros: number): string {
  const delta = atMicros - props.openedAt;
  return delta <= 0 ? "+0s" : `+${formatMicrosDuration(delta)}`;
}
</script>
