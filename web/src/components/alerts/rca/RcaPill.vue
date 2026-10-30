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
    class="text-3xs inline-flex items-center gap-1.5 border px-2 font-bold"
    :class="[
      RCA_PILL_TONE_CLASS[tone],
      wrap
        ? 'rounded-default min-h-5.5 max-w-full py-0.5 leading-tight'
        : 'h-5.5 shrink-0 rounded-full leading-none whitespace-nowrap',
    ]"
  >
    <OSpinner v-if="spinner" size="xs" />
    <OIcon v-else-if="icon" :name="icon" size="xs" />
    <slot />
  </span>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { RCA_PILL_TONE_CLASS, type RcaPillTone } from "@/utils/incidents/rcaSummary";

withDefaults(
  defineProps<{
    tone: RcaPillTone;
    icon?: IconName | null;
    spinner?: boolean;
    /** A long label wraps inside a narrow column instead of overflowing it. */
    wrap?: boolean;
  }>(),
  { icon: null, spinner: false, wrap: false },
);
</script>
