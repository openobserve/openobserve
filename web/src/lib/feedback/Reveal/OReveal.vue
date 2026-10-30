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

<!-- The one skeleton-to-content swap: a skeleton only while nothing exists, and content the moment it does, faded in. -->
<script setup lang="ts">
import { ref, watch } from "vue";
import type { RevealProps } from "./OReveal.types";
import OSkeleton from "../Skeleton/OSkeleton.vue";

const props = withDefaults(defineProps<RevealProps>(), { as: "div" });

// Content ready at mount is shown as-is; only content the user watched arrive gets the fade, from 40% so it never blinks.
const arrived = ref(false);
watch(
  () => props.ready,
  (ready, wasReady) => {
    if (ready && wasReady === false) arrived.value = true;
  },
);
</script>

<template>
  <component
    :is="as"
    v-if="ready"
    :class="
      arrived
        ? 'motion-safe:animate-in motion-safe:fade-in-40 motion-safe:duration-200 motion-safe:ease-out'
        : undefined
    "
  >
    <slot />
  </component>
  <component :is="as" v-else aria-busy="true" data-test="o-reveal-skeleton">
    <slot name="skeleton">
      <OSkeleton class="h-full" />
    </slot>
  </component>
</template>
