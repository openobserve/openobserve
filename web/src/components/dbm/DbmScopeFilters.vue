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
  DbmScopeFilters — five scope dimensions as one toolbar control.

  Rendered as five full-width stacked selects they read as a form standing
  between the user and the table, and cost more vertical space than the rows
  they filter. Here the selects live in a popover and only the dimensions the
  user actually SET appear on the toolbar, as removable chips — so an unfiltered
  page spends one button on scope, and a filtered one shows its scope as the
  short list it usually is.
-->
<template>
  <div class="flex min-w-0 items-center gap-1.5" data-test="dbm-queries-scope">
    <OPopover v-model:open="open">
      <template #trigger>
        <OButton
          variant="outline"
          size="sm"
          icon-left="filter-list"
          class="shrink-0"
          data-test="dbm-queries-scope-trigger"
        >
          {{ t("dbm.filters.scope") }}
          <OTag
            v-if="activeCount"
            :label="raw(String(activeCount))"
            size="xs"
            class="ms-1"
            data-test="dbm-queries-scope-count"
          />
        </OButton>
      </template>

      <div class="flex w-72 flex-col">
        <div class="flex flex-col gap-2.5 p-3">
          <p class="text-text-heading text-sm font-semibold" data-test="dbm-queries-scope-title">
            {{ t("dbm.filters.popoverTitle") }}
          </p>
          <OSelect
            v-for="filter in filters"
            :key="filter.key"
            :label="filter.dimension"
            :model-value="filter.value"
            :options="filter.options"
            size="md"
            :searchable="false"
            clearable
            :placeholder="filter.placeholder"
            :data-test="`dbm-queries-filter-${filter.key}`"
            @update:model-value="filter.onChange"
          />
        </div>

        <div class="border-border-default flex items-center border-t px-3 py-2.5">
          <OButton
            variant="outline"
            size="sm"
            :disabled="!activeCount"
            data-test="dbm-queries-scope-clear"
            @click="emit('clear')"
          >
            {{ t("dbm.filters.clearScope") }}
          </OButton>
        </div>
      </div>
    </OPopover>

    <!-- The chips scroll rather than push: five set dimensions are wider than
         the toolbar, and a chip strip that grows must not shove the refresh and
         column controls off the right edge. -->
    <div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
      <ODimensionChip
        v-for="filter in activeFilters"
        :key="filter.key"
        :dim-key="filter.key"
        :key-label="filter.dimension"
        :value="filter.value ?? ''"
        removable
        :remove-label="t('dbm.filters.removeScope')"
        :remove-data-test="`dbm-queries-scope-chip-${filter.key}-remove`"
        class="shrink-0"
        :data-test="`dbm-queries-scope-chip-${filter.key}`"
        @remove="filter.onChange(null)"
      />

      <!-- Amber, not a dimension colour: the insight is a lens the reader applied, not a dimension they picked. -->
      <ODimensionChip
        v-if="insightChip"
        dim-key="insight"
        :key-label="insightChip.dimension"
        :value="insightChip.label"
        variant="warning-soft"
        removable
        :remove-label="t('dbm.filters.removeScope')"
        remove-data-test="dbm-queries-scope-chip-insight-remove"
        class="shrink-0"
        data-test="dbm-queries-scope-chip-insight"
        @remove="emit('clearInsight')"
      />

      <!-- Clear all, INLINE beside the chips.
           The same action already exists inside the popover, but only there:
           with two or three chips showing, resetting the view meant opening
           the Filters dropdown to find a button whose effect is on the row the
           reader is already looking at, or removing each chip one at a time.
           Shown only when something is actually set, so the toolbar stays
           quiet on an unfiltered page. -->
      <OButton
        v-if="activeCount"
        variant="ghost-primary"
        size="xs"
        class="shrink-0"
        data-test="dbm-queries-scope-clear-inline"
        @click="emit('clear')"
      >
        {{ t("dbm.filters.clearScope") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

/** One scope dimension: its current value, the values available, and its setter. */
export interface DbmScopeFilter {
  key: string;
  /**
   * Plain-language name of the axis, shown as the chip's key segment. The
   * COLOUR comes from `key`, not this, so `service` matches the incident list.
   */
  dimension: I18nText;
  value: string | null;
  placeholder: I18nText;
  options: { value: string; label: I18nText }[];
  onChange: (value: unknown) => void;
}

/** The active insight filter, rendered as a chip in the same grammar. */
export interface DbmInsightChip {
  dimension: I18nText;
  label: I18nText;
}

const props = withDefaults(
  defineProps<{
    filters: DbmScopeFilter[];
    insightChip?: DbmInsightChip | null;
  }>(),
  { insightChip: null },
);

const emit = defineEmits<{
  (e: "clear"): void;
  (e: "clearInsight"): void;
}>();

const { t } = useI18nTyped();

const open = ref(false);

const activeFilters = computed(() => props.filters.filter((f) => !!f.value));
const activeCount = computed(() => activeFilters.value.length);
</script>
