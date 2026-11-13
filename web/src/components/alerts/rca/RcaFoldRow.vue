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

<!-- One title row of an analysis list; its detail opens below it, and its actions sit beside the toggle. -->
<template>
  <li class="flex min-w-0 list-none items-start gap-2" :class="flush ? '' : 'px-1.5 py-0.5'">
    <OCollapsible
      :model-value="open"
      class="min-w-0 flex-1"
      @update:model-value="(value: boolean) => $emit('update:open', value)"
    >
      <template #trigger>
        <span class="flex min-w-0 flex-1 items-center gap-3" data-test="rca-fold-row-toggle">
          <slot name="lead" />
          <OTruncatedText
            v-if="!open"
            as="span"
            class="flex-1 text-sm font-semibold"
            :class="muted ? 'text-text-secondary' : 'text-text-heading'"
            :tooltip="false"
          >
            <slot />
          </OTruncatedText>
          <span
            v-else
            class="min-w-0 flex-1 text-sm font-semibold [text-wrap:pretty] break-words"
            :class="muted ? 'text-text-secondary' : 'text-text-heading'"
          >
            <slot />
          </span>
          <slot name="meta" />
          <OIcon
            data-test="rca-fold-row-chevron"
            name="expand-more"
            size="sm"
            class="text-icon-color shrink-0 transition-transform duration-150 motion-reduce:transition-none"
            :class="open ? 'rotate-180' : ''"
          />
        </span>
      </template>
      <div v-if="$slots.body" class="flex flex-col gap-2 px-2 pb-2" data-test="rca-fold-row-body">
        <slot name="body" />
      </div>
    </OCollapsible>
    <div v-if="$slots.actions" class="flex shrink-0 items-center py-1">
      <slot name="actions" />
    </div>
  </li>
</template>

<script setup lang="ts">
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";

withDefaults(
  defineProps<{
    open: boolean;
    /** A ruled-out row reads quieter. */
    muted?: boolean;
    /** No inset: the row sits in a plain list, not a bordered card. */
    flush?: boolean;
  }>(),
  { muted: false, flush: false },
);

defineEmits<{ "update:open": [open: boolean] }>();
</script>
