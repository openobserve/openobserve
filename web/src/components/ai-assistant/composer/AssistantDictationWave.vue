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
  <span
    :class="[
      'rounded-default flex h-7 min-w-0 items-center gap-1.5 px-2',
      processing ? 'bg-surface-subtle' : 'bg-status-error-bg',
    ]"
    data-test="assistant-dictate-wave"
    :data-phase="processing ? 'processing' : 'listening'"
  >
    <span
      aria-hidden="true"
      :class="[
        'bg-status-error-text size-2 shrink-0 rounded-full',
        processing ? 'opacity-50' : 'motion-safe:animate-pulse',
      ]"
      data-test="assistant-dictate-live-dot"
    />
    <!-- The word never cuts: a narrow bar shortens the meter first -->
    <span
      :class="[
        'shrink-0 text-xs font-medium whitespace-nowrap',
        processing ? 'text-text-secondary' : 'text-status-error-text',
      ]"
      data-test="assistant-dictate-label"
      >{{ label }}</span
    >
    <span
      aria-hidden="true"
      class="flex h-5 w-14 min-w-0 shrink items-center justify-center gap-0.5 overflow-hidden"
      data-test="assistant-dictate-meter"
    >
      <span
        v-for="(bar, index) in WAVE_BARS"
        :key="index"
        :class="[
          processing ? 'bg-text-secondary' : `bg-status-error-text ${ASSISTANT_MOTION.wave}`,
          'rounded-default block h-1 w-0.5',
        ]"
        :style="{
          '--assistant-wave-peak': `${bar.peak * (MIN_SCALE + (1 - MIN_SCALE) * level)}rem`,
          '--assistant-wave-delay': bar.delay,
        }"
      />
    </span>
    <span
      aria-hidden="true"
      class="text-text-secondary min-w-7 text-end text-xs tabular-nums"
      data-test="assistant-dictate-elapsed"
      >{{ elapsed }}</span
    >
  </span>
</template>

<script lang="ts">
export interface AssistantDictationWaveProps {
  elapsedMs: number;
  /** 0 to 1: the live input level scales the bars. */
  level?: number;
  /** The engine is settling the last words; the bars rest. */
  processing?: boolean;
}

// Fourteen bars with uneven peaks read as speech, not as a progress bar.
const PEAKS_REM = [
  0.5, 0.75, 1, 0.625, 1.125, 0.875, 0.5625, 1.0625, 0.75, 1.25, 0.6875, 0.9375, 0.5, 1.125,
];

const WAVE_BARS = PEAKS_REM.map((peak, index) => ({ peak, delay: (index * 0.07).toFixed(2) }));

// Quiet input still moves the bars a little, so a live mic never looks frozen.
const MIN_SCALE = 0.35;
</script>

<script setup lang="ts">
import { computed } from "vue";

import { ASSISTANT_MOTION } from "@/components/ai-assistant/common/assistantMotion";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<AssistantDictationWaveProps>(), {
  level: 0,
  processing: false,
});

const { t } = useI18nTyped();

const label = computed(() =>
  props.processing ? t("assistant.voice.processing") : t("assistant.voice.listening"),
);

const elapsed = computed(() => {
  const seconds = Math.max(0, Math.floor(props.elapsedMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
});
</script>
