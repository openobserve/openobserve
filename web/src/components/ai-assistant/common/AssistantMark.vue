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
    data-test="assistant-mark"
    :data-size="size"
    :class="[
      'rounded-default bg-assistant-mark-bg shadow-assistant-mark inline-flex shrink-0 items-center justify-center',
      chipSize,
      sparkle ? ASSISTANT_MOTION.sparkle : '',
      muted ? 'text-text-muted' : 'text-assistant-mark-fg',
    ]"
  >
    <OIcon :name="glyph ?? assistantGlyph.assistant" :size="size" />
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

import type { IconName } from "@/lib/core/Icon/OIcon.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";

import { ASSISTANT_MOTION } from "./assistantMotion";
import { assistantGlyph } from "./glyphs";

const CHIP_SIZES = { xs: "size-5", sm: "size-6", md: "size-9", lg: "size-12" } as const;

const props = withDefaults(
  defineProps<{
    size?: "xs" | "sm" | "md" | "lg";
    /** The chat's agent, when the mark names one instead of the product. */
    glyph?: IconName;
    /** Gate states: the glyph in `text-text-muted`. */
    muted?: boolean;
    /** Plays the one-off opening sparkle; the panel sets it only on the open that should animate. */
    sparkle?: boolean;
  }>(),
  { size: "sm", muted: false, glyph: undefined, sparkle: false },
);

const chipSize = computed(() => CHIP_SIZES[props.size]);
</script>
