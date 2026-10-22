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
    data-test="assistant-status-dot"
    :data-state="state"
    :data-shape="shape"
    :class="[
      'inline-flex items-center gap-1',
      placement === 'corner' ? 'absolute -end-0.5 -top-0.5' : '',
    ]"
  >
    <span
      v-if="shape === 'ring'"
      aria-hidden="true"
      class="ring-assistant-signal-working size-2 rounded-full bg-transparent ring-2 motion-safe:animate-pulse motion-reduce:animate-none forced-colors:border"
    />
    <template v-else-if="shape === 'dot-count'">
      <span
        aria-hidden="true"
        :class="['bg-assistant-signal-attention size-2 rounded-full', dotRing]"
      />
      <span
        v-if="count"
        class="text-text-secondary text-2xs font-medium tabular-nums max-md:sr-only"
        >{{ count }}</span
      >
    </template>
    <span
      v-else-if="shape === 'glyph'"
      aria-hidden="true"
      class="text-assistant-signal-failed inline-flex size-3 items-center justify-center"
    >
      <OIcon :name="assistantGlyph.failed" size="xs" />
    </span>
    <span
      v-else
      aria-hidden="true"
      :class="['bg-assistant-signal-unread size-2 rounded-full', dotRing]"
    />
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";

import { assistantSignalShape, type AssistantStatusDotProps } from "./AssistantStatusDot.types";
import { assistantGlyph } from "./glyphs";

const props = withDefaults(defineProps<AssistantStatusDotProps>(), {
  count: undefined,
  placement: "inline",
});

const shape = computed(() => assistantSignalShape[props.state]);
// Forced colours drop fills and box-shadow rings, so a half-width border repaints a dot solid and keeps it unlike the hollow working ring.
const dotRing = computed(() =>
  props.placement === "corner"
    ? "ring-surface-base ring-2 forced-colors:border-4"
    : "forced-colors:border-4",
);
</script>
