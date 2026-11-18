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
    class="flex min-h-8 min-w-0 flex-nowrap items-center gap-x-1"
    data-test="assistant-composer-bar"
    :data-dictating="dictating ? '' : undefined"
  >
    <span class="flex min-w-0 items-center gap-1" data-test="assistant-composer-bar-left">
      <slot name="plus" />
      <slot v-if="dictating" name="recording" />
    </span>
    <span
      class="ms-auto flex flex-none items-center gap-1"
      data-test="assistant-composer-bar-right"
    >
      <slot name="agent" />
      <slot name="mic" />
      <slot name="send" />
    </span>
  </div>
</template>

<script lang="ts">
// An idle Send reads as neutral, not as a half-lit primary; the arrow keeps 3:1 on the fill in both themes.
export const SEND_ACTION_CLASS =
  "aria-disabled:bg-surface-subtle! aria-disabled:text-text-secondary!";

export const BAR_CONTROL_SIZE = "sm";
</script>

<script setup lang="ts">
withDefaults(
  defineProps<{
    /** The recording block shows after +; agent, mic and Send stay where they are. */
    dictating?: boolean;
  }>(),
  { dictating: false },
);

defineSlots<{
  plus?: () => unknown;
  recording?: () => unknown;
  agent?: () => unknown;
  mic?: () => unknown;
  send?: () => unknown;
}>();
</script>
