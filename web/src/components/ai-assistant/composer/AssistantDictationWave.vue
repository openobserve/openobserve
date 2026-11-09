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
  <span class="flex h-6 flex-none items-center gap-1.5" data-test="assistant-dictate-wave">
    <span aria-hidden="true" class="flex h-5 w-14 flex-none items-center justify-center gap-0.5">
      <span
        v-for="(bar, index) in WAVE_BARS"
        :key="index"
        :class="[ASSISTANT_MOTION.wave, 'bg-accent rounded-default block h-1 w-0.5']"
        :style="{
          '--assistant-wave-peak': `${bar.peak}rem`,
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
}

// Fourteen bars with uneven peaks read as speech, not as a progress bar.
const PEAKS_REM = [
  0.5, 0.75, 1, 0.625, 1.125, 0.875, 0.5625, 1.0625, 0.75, 1.25, 0.6875, 0.9375, 0.5, 1.125,
];

const WAVE_BARS = PEAKS_REM.map((peak, index) => ({ peak, delay: (index * 0.07).toFixed(2) }));
</script>

<script setup lang="ts">
import { computed } from "vue";

import { ASSISTANT_MOTION } from "@/components/ai-assistant/common/assistantMotion";

const props = defineProps<AssistantDictationWaveProps>();

const elapsed = computed(() => {
  const seconds = Math.max(0, Math.floor(props.elapsedMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
});
</script>
