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
    :class="[
      'flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1',
      divided ? 'border-border-default relative -mx-2 mt-1 min-h-10 border-t px-2 pt-2' : 'min-h-8',
    ]"
    data-test="assistant-composer-bar"
  >
    <span class="flex min-w-0 items-center gap-1" data-test="assistant-composer-bar-left">
      <slot name="agent" />
    </span>
    <span
      class="ms-auto flex flex-none items-center gap-1"
      data-test="assistant-composer-bar-right"
    >
      <slot />
    </span>
  </div>
</template>

<script lang="ts">
// Send, Stop and the dictation Stop are the kit's one round shape; repoGuards allows it only here.
export const ROUND_ACTION_CLASS = "rounded-full";

// An idle Send reads as neutral, not as a half-lit primary; the arrow keeps 3:1 on the fill in both themes.
export const SEND_ACTION_CLASS = `${ROUND_ACTION_CLASS} aria-disabled:bg-surface-subtle! aria-disabled:text-text-secondary!`;
</script>

<script setup lang="ts">
withDefaults(defineProps<{ /** A thin line above the controls. */ divided?: boolean }>(), {
  divided: false,
});

defineSlots<{ agent?: () => unknown; default?: () => unknown }>();
</script>
