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
  <dl
    class="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3 gap-y-1"
    data-test="assistant-chip-fields"
  >
    <template v-for="entry in entries" :key="entry.key">
      <dt
        :class="[
          'min-w-0 font-mono text-xs break-all',
          entry.internal ? 'text-text-secondary' : 'text-text-heading',
        ]"
        :data-internal="entry.internal ? '' : undefined"
      >
        {{ entry.key }}
        <span v-if="entry.internal" class="text-text-secondary"
          >{{ dot }} {{ t("assistant.context.internal") }}</span
        >
      </dt>
      <dd
        :class="[
          'min-w-0 text-xs break-all whitespace-pre-wrap',
          entry.long && 'max-h-32 overflow-y-auto',
          entry.internal ? 'text-text-secondary' : 'text-text-body',
        ]"
        :tabindex="entry.long ? 0 : undefined"
      >
        {{ entry.value }}
      </dd>
    </template>
  </dl>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { INTERNAL_FIELDS } from "@/composables/assistant";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    row: Record<string, unknown>;
    /** Greys `_o2_id` and `_original` and marks them internal while they are kept off the wire. */
    hideInternal?: boolean;
  }>(),
  { hideInternal: true },
);

// A value past this many characters scrolls in its own focusable box, so the popover stays short.
const LONG_VALUE_CHARS = 400;

const { t } = useI18nTyped();
const dot = raw("·");

// Values render as text interpolation only, so a planted `<img onerror>` stays literal (CT-03 AC 6).
const entries = computed(() =>
  Object.entries(props.row)
    .map(([key, value]) => ({
      key,
      value: typeof value === "string" ? value : JSON.stringify(value),
      internal: props.hideInternal && INTERNAL_FIELDS.has(key),
    }))
    .map((entry) => ({ ...entry, long: entry.value.length > LONG_VALUE_CHARS })),
);
</script>
