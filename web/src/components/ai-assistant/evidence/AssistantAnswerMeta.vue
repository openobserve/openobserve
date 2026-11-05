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
  <div
    v-if="confidenceLabel || stale"
    class="text-text-secondary flex min-w-0 flex-wrap items-center gap-x-1 text-xs leading-5"
    data-test="assistant-answer-meta"
  >
    <span
      v-if="confidenceLabel"
      class="inline-flex items-center gap-x-1.5"
      data-test="assistant-answer-confidence"
      :data-level="confidenceLevel"
    >
      <span class="inline-flex w-6 shrink-0" data-test="assistant-answer-confidence-meter">
        <OSegmentedBar :segments="meterSegments" gapped />
      </span>
      <span data-test="assistant-answer-confidence-label">{{ confidenceLabel }}</span>
    </span>
    <span v-if="stale" class="inline-flex items-center gap-x-1 whitespace-nowrap">
      <span v-if="confidenceLabel" aria-hidden="true">·</span>
      <span class="text-status-warning-text" data-test="assistant-answer-age">{{ ageLine }}</span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { isStaleAnswer, stepsOf, type AssistantTurnView } from "@/composables/assistant/pure";
import OSegmentedBar from "@/lib/data/SegmentedBar/OSegmentedBar.vue";
import type { SegmentedBarSegment } from "@/lib/data/SegmentedBar/OSegmentedBar.types";
import type { ChatMessage } from "@/ts/interfaces/chat";
import { useI18nTyped, type I18nText } from "@/types/i18n";

import { dataAgeText } from "./evidenceText";

// Inconclusive fills no step, so an empty meter never reads as a low score.
const LEVELS = { inconclusive: 0, low: 1, medium: 2, high: 3 } as const;
const STEPS = [1, 2, 3] as const;

const props = withDefaults(
  defineProps<{
    message: ChatMessage;
    turn?: AssistantTurnView | null;
    readonly?: boolean;
    /** Findings only: "Medium confidence", or "Inconclusive". */
    confidence?: "high" | "medium" | "low" | "inconclusive" | null;
  }>(),
  { turn: null, readonly: false, confidence: null },
);

const { t } = useI18nTyped();

const steps = computed(() => stepsOf(props.message, props.turn?.org ?? ""));
const stale = computed(() => isStaleAnswer(steps.value, Date.now()));
const ageLine = computed(() => dataAgeText(steps.value, Date.now(), t));
const confidenceLabel = computed<I18nText | null>(() => {
  if (!props.confidence) return null;
  return t(`assistant.turn.confidence.${props.confidence}`);
});
const confidenceLevel = computed(() => (props.confidence ? LEVELS[props.confidence] : 0));
const meterSegments = computed<SegmentedBarSegment[]>(() =>
  STEPS.map((step) => ({
    id: String(step),
    pct: 100 / STEPS.length,
    variant: step <= confidenceLevel.value ? "contrast" : "muted",
  })),
);
</script>
