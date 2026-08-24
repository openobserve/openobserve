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

<!--
  DbmTableToolbar — the leading half of a DBM list table's toolbar: a fixed-width
  search box, then whatever controls the page adds beside it.

  Eight tables opened their `#toolbar` slot with the same flex row and the same
  `w-64` search box; only the placeholder and the `data-test` changed. The
  controls that DO differ — scope filters, perspective and grouping toggles —
  stay in the page and arrive through the default slot, so this owns the shape
  of the row without owning its contents.
-->
<template>
  <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
    <div class="w-64 shrink-0">
      <OSearchInput
        :model-value="search"
        :placeholder="placeholder"
        clearable
        :debounce="debounce"
        :data-test="searchDataTest"
        @update:model-value="onSearch"
      />
    </div>
    <slot />
  </div>
</template>

<script setup lang="ts">
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import type { I18nText } from "@/types/i18n";

withDefaults(
  defineProps<{
    search: string;
    placeholder: I18nText;
    searchDataTest: string;
    /**
     * Databases types against an already-loaded client list, so it filters on
     * every keystroke; every other table refetches and debounces.
     */
    debounce?: number;
  }>(),
  { debounce: undefined },
);

const emit = defineEmits<{
  "update:search": [value: string];
  /**
   * Fired alongside the model update on the tables that refetch when the query
   * changes (blocked, deadlocks, top queries). Pages that filter client-side
   * simply do not listen.
   */
  search: [value: string];
}>();

const onSearch = (value: unknown) => {
  const next = typeof value === "string" ? value : "";
  emit("update:search", next);
  emit("search", next);
};
</script>
