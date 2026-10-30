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
  <div :data-test="dataTest">
    <div class="flex h-2 gap-px overflow-hidden rounded-full">
      <span
        v-for="s in visible"
        :key="s.id"
        class="h-full min-w-0.5"
        :class="s.swatch"
        :style="{ flexGrow: s.value, flexBasis: 0 }"
      />
    </div>
    <div class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      <div
        v-for="s in visible"
        :key="s.id"
        class="flex min-w-0 items-center gap-1.5"
        :data-test="`${dataTest}-legend-${s.id}`"
      >
        <span class="size-2 shrink-0 rounded-full" :class="s.swatch" />
        <OTruncatedText class="text-text-body">{{ s.label }}</OTruncatedText>
        <span class="text-text-secondary ms-auto whitespace-nowrap tabular-nums">{{
          s.display
        }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { StackSegment } from "./profileStyles";

const props = defineProps<{
  segments: StackSegment[];
  dataTest?: string;
}>();

const visible = computed(() => props.segments.filter((s) => s.value > 0));
</script>
