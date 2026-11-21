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
    aria-hidden="true"
    data-test="assistant-spark"
    :data-size="size"
    :data-tone="muted ? 'muted' : 'brand'"
    :data-working="working ? '' : undefined"
    :class="['inline-flex shrink-0', SIZES[size], muted ? 'text-text-muted' : '']"
  >
    <span
      v-if="working && !muted"
      data-test="assistant-spark-working"
      :class="['size-full', ASSISTANT_MOTION.sparkWorking]"
    />
    <svg v-else viewBox="0 0 24 24" fill="none" focusable="false" class="size-full">
      <defs v-if="!muted">
        <linearGradient
          :id="gradientId"
          x1="8"
          y1="2"
          x2="16"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            v-for="stop in STOPS"
            :key="stop.offset"
            :offset="stop.offset"
            :style="{ stopColor: stop.color }"
          />
        </linearGradient>
      </defs>
      <path
        :d="SPARK_PATH"
        :fill="muted ? 'currentColor' : `url(#${gradientId})`"
        class="forced-colors:fill-current"
      />
    </svg>
  </span>
</template>

<script lang="ts">
export type AssistantSparkSize = 16 | 20 | 24 | 32 | 40;

/** The four-point star; the working utility in tailwind.css masks with the same path. */
export const SPARK_PATH =
  "M12 1.5C14.34 7.8 17.22 10.32 21 12C17.22 13.68 14.34 16.2 12 22.5C9.66 16.2 6.78 13.68 3 12C6.78 10.32 9.66 7.8 12 1.5Z";

const SIZES: Record<AssistantSparkSize, string> = {
  16: "size-4",
  20: "size-5",
  24: "size-6",
  32: "size-8",
  40: "size-10",
};

const STOPS = [
  { offset: "0", color: "var(--color-assistant-spark-from)" },
  { offset: "0.45", color: "var(--color-assistant-spark-via)" },
  { offset: "1", color: "var(--color-assistant-spark-to)" },
];
</script>

<script setup lang="ts">
import { useId } from "vue";

import { ASSISTANT_MOTION } from "./assistantMotion";

withDefaults(
  defineProps<{
    size?: AssistantSparkSize;
    /** A turn is running: the colours turn inside the star, still under reduced motion. */
    working?: boolean;
    /** Off or gated: one muted fill, no gradient. */
    muted?: boolean;
  }>(),
  { size: 20, working: false, muted: false },
);

// Several sparks share a page, so each gradient needs its own id.
const gradientId = `assistant-spark-${useId()}`;
</script>
