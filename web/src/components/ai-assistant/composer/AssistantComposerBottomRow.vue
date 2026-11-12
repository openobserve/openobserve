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
      'flex min-w-0 items-center gap-1',
      divided
        ? 'relative -mx-2 mt-1 h-10 px-2 pt-1.5 before:bg-gradient-brand-ribbon before:absolute before:inset-x-0 before:top-0 before:h-px before:opacity-50 before:content-[\'\']'
        : 'h-8',
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
</script>

<script setup lang="ts">
withDefaults(defineProps<{ /** A thin line above the controls, for Home's Ask box. */ divided?: boolean }>(), {
  divided: false,
});

defineSlots<{ agent?: () => unknown; default?: () => unknown }>();
</script>
