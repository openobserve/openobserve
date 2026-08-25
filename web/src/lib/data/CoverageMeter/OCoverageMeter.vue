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
  OCoverageMeter — a confidence read-out for a partially-observed dataset.

  It answers "how much of this can you actually see", in the same visual system
  as the data it describes rather than as small print. Three parts:

    • a proportion bar carrying the computable share (or an indeterminate track
      when the share genuinely cannot be computed — it never invents a number),
    • two lines of reasoning: what the share is made of, what the remainder is,
    • qualifier chips + a freshness read-out, toned by MEANING: only genuinely
      missing data is red; approximate-but-complete stays quiet.

  Generic and props-driven — no domain knowledge, no store, no services.
-->
<template>
  <div
    class="bg-surface-panel border-border-default rounded-surface flex flex-col gap-2 border p-3"
    :data-test="`${dataTestPrefix}-coverage-meter`"
  >
    <!-- headline: label · share · freshness -->
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span
        v-if="label"
        class="text-text-label text-2xs font-semibold tracking-wide uppercase"
        :data-test="`${dataTestPrefix}-coverage-meter-label`"
      >
        {{ label }}
      </span>

      <span
        :class="['text-sm font-semibold tabular-nums', shareToneClass]"
        :data-test="`${dataTestPrefix}-coverage-meter-share`"
      >
        {{ shareLabel }}
      </span>

      <span class="ms-auto flex items-center gap-2">
        <span
          v-if="freshnessLabel"
          :class="['text-xs', freshnessToneClass]"
          :data-test="`${dataTestPrefix}-coverage-meter-freshness`"
        >
          {{ freshnessLabel }}
        </span>

        <OButton
          v-if="detailsLabel"
          variant="ghost-primary"
          size="sm"
          :data-test="`${dataTestPrefix}-coverage-meter-details`"
          @click="emit('details')"
        >
          {{ detailsLabel }}
        </OButton>
      </span>
    </div>

    <!-- the bar. An unmeasurable share draws the TRACK only: a partial fill
         would be a claim we cannot make. -->
    <OProgressBar
      v-if="state === 'measured'"
      :value="clampedValue"
      :variant="barVariant"
      size="xs"
      :data-test="`${dataTestPrefix}-coverage-meter-bar`"
    />
    <div
      v-else
      class="bg-progress-bar-track h-1 w-full rounded-full"
      :data-test="`${dataTestPrefix}-coverage-meter-bar-indeterminate`"
    />

    <!-- the meter's own reasoning -->
    <div v-if="hasReasoning" class="text-text-secondary flex flex-col gap-0.5 text-xs">
      <template v-if="state === 'measured'">
        <span v-if="accountedFor" :data-test="`${dataTestPrefix}-coverage-meter-accounted`">
          {{ accountedFor }}
        </span>
        <span v-if="remainder" :data-test="`${dataTestPrefix}-coverage-meter-remainder`">
          {{ remainder }}
        </span>
      </template>
      <span v-else-if="stateNote" :data-test="`${dataTestPrefix}-coverage-meter-state-note`">
        {{ stateNote }}
      </span>
    </div>

    <!-- qualifier chips -->
    <div v-if="notes.length" class="flex flex-wrap items-center gap-1.5">
      <OTooltip v-for="note in notes" :key="note.id" :content="note.description" side="top">
        <OTag
          :variant="noteVariant(note.tone)"
          size="xs"
          :label="note.label"
          clickable
          :data-test="`${dataTestPrefix}-coverage-meter-note-${note.id}`"
          @click="emit('note', note.id)"
        />
      </OTooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw } from "@/types/i18n";

import type {
  CoverageMeterEmits,
  CoverageMeterProps,
  CoverageNoteTone,
} from "./OCoverageMeter.types";

const props = withDefaults(defineProps<CoverageMeterProps>(), {
  state: "measured",
  warnBelow: 0.8,
  dangerBelow: 0.5,
  notes: () => [],
});

const emit = defineEmits<CoverageMeterEmits>();

const dataTestPrefix = computed(() => props.dataTest ?? "o2");

const clampedValue = computed(() => Math.min(1, Math.max(0, props.value ?? 0)));

/**
 * The share as a whole percent. A measured share never reads `100%` unless it
 * truly is 1 — rounding 0.999 up would erase the remainder the meter exists to
 * disclose.
 */
const shareLabel = computed(() => {
  if (props.state !== "measured" || props.value === undefined) return raw("—");
  const pct = Math.round(clampedValue.value * 100);
  return raw(`${pct >= 100 && clampedValue.value < 1 ? 99 : pct}%`);
});

const isDanger = computed(
  () => props.state === "measured" && clampedValue.value < props.dangerBelow,
);
const isWarn = computed(
  () =>
    props.state === "subset" ||
    (props.state === "measured" && clampedValue.value < props.warnBelow && !isDanger.value),
);

const barVariant = computed<"default" | "warning" | "danger">(() => {
  if (isDanger.value) return "danger";
  if (isWarn.value) return "warning";
  return "default";
});

const shareToneClass = computed(() => {
  if (isDanger.value) return "text-status-error-text";
  if (isWarn.value) return "text-status-warning-text";
  if (props.state !== "measured") return "text-text-muted";
  return "text-text-heading";
});

const TONE_TEXT: Record<CoverageNoteTone, string> = {
  neutral: "text-text-secondary",
  info: "text-text-link",
  warning: "text-status-warning-text",
  error: "text-status-error-text",
};
const freshnessToneClass = computed(() => TONE_TEXT[props.freshnessTone ?? "neutral"]);

/**
 * Tone → chip variant. Everything but a genuine gap stays soft and quiet: a
 * qualifier that fires on most views must not read as an alarm.
 */
const NOTE_VARIANT: Record<CoverageNoteTone, BadgeVariant> = {
  neutral: "default-soft",
  info: "blue-soft",
  warning: "amber-soft",
  error: "error-soft",
};
const noteVariant = (tone?: CoverageNoteTone): BadgeVariant => NOTE_VARIANT[tone ?? "neutral"];

const hasReasoning = computed(() =>
  props.state === "measured" ? !!(props.accountedFor || props.remainder) : !!props.stateNote,
);
</script>
