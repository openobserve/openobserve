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
            class="ml-1"
            data-test="dbm-queries-scope-count"
          />
        </OButton>
      </template>

      <!-- The placeholder already names the dimension ("All engines"), so a
           label above each select would say it twice. -->
      <div class="flex w-72 flex-col gap-1.5 p-1">
        <p class="text-text-label text-3xs px-1 font-semibold tracking-wide uppercase">
          {{ t("dbm.filters.popoverTitle") }}
        </p>
        <OSelect
          v-for="filter in filters"
          :key="filter.key"
          :model-value="filter.value"
          :options="filter.options"
          size="sm"
          :searchable="false"
          clearable
          :placeholder="filter.placeholder"
          :data-test="`dbm-queries-filter-${filter.key}`"
          @update:model-value="filter.onChange"
        />
        <div v-if="activeCount" class="flex items-center gap-1.5 px-1 pt-0.5">
          <OButton
            variant="ghost-primary"
            size="xs"
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
      <!-- Active scope, inline and clearable. The chip is the app-standard
           ODimensionChip, so `service` here is the same colour it is on the
           incident list; the remove button sits beside it rather than inside,
           because the chip is a shared primitive with no slot for one. -->
      <span
        v-for="filter in activeFilters"
        :key="filter.key"
        class="inline-flex min-w-0 shrink-0 items-center gap-0.5"
        :data-test="`dbm-queries-scope-chip-${filter.key}`"
      >
        <ODimensionChip
          :dim-key="filter.key"
          :key-label="filter.dimension"
          :value="filter.value ?? ''"
          class="min-w-0"
        />
        <OButton
          variant="ghost-muted"
          size="icon-xs-circle"
          icon-left="close"
          :data-test="`dbm-queries-scope-chip-${filter.key}-remove`"
          @click="filter.onChange(null)"
        >
          <OTooltip side="bottom" :content="t('dbm.filters.removeScope')" />
        </OButton>
      </span>

      <!-- The insight filter deliberately stays amber and stays hand-rolled: it
           is NOT a dimension the user picked, so giving it a dimension colour
           would say the wrong thing. It borrows ODimensionChip's geometry (two
           segments, sm badge metrics, rounded-default) so it sits level. -->
      <span
        v-if="insightChip"
        class="inline-flex min-w-0 shrink-0 items-center gap-0.5"
        data-test="dbm-queries-scope-chip-insight"
      >
        <span
          class="bg-badge-warning-soft-bg text-badge-warning-soft-text text-2xs rounded-default inline-flex min-w-0 items-stretch overflow-hidden font-medium"
        >
          <span class="shrink-0 bg-current/8 py-1.5 ps-2.5 pe-1 whitespace-nowrap opacity-90">{{
            insightChip.dimension
          }}</span>
          <span class="min-w-0 truncate py-1.5 ps-1 pe-2.5 font-semibold">{{
            insightChip.label
          }}</span>
        </span>
        <OButton
          variant="ghost-muted"
          size="icon-xs-circle"
          icon-left="close"
          data-test="dbm-queries-scope-chip-insight-remove"
          @click="emit('clearInsight')"
        >
          <OTooltip side="bottom" :content="t('dbm.filters.removeScope')" />
        </OButton>
      </span>
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
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
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
