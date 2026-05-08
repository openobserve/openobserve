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
    v-if="filterPatterns.length > 0"
    class="tw:flex tw:items-center tw:gap-[0.5rem] tw:flex-wrap tw:p-[0.625rem] tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-bg-gray)] tw:mb-[0.5rem]"
    data-test="patterns-patternfilterbar-container"
  >
    <span
      class="tw:text-sm tw:font-medium tw:text-[var(--o2-text-primary)] tw:mr-[0.25rem]"
    >
      {{ t("search.patternFilterCount", { count: filterPatterns.length }) }}
    </span>
    <template v-for="fp in filterPatterns" :key="fp.pattern_id">
      <span
        class="tw:inline-flex tw:items-center tw:gap-[0.25rem] tw:rounded-full tw:px-[0.5rem] tw:py-[0.125rem] tw:text-xs tw:bg-[var(--o2-card-bg)] tw:border tw:border-[var(--o2-border-color)]"
        :data-test="`patterns-patternfilterbar-chip-${fp.pattern_id}`"
      >
        <span
          class="tw:w-[0.375rem] tw:h-[0.375rem] tw:rounded-full"
          :class="fp.action === 'include' ? 'tw:bg-[var(--o2-primary-color)]' : 'tw:bg-[var(--o2-anomaly-color,#ef4444)]'"
        />
        <span class="tw:text-[var(--o2-text-primary)] tw:max-w-[12rem] tw:truncate tw:font-mono">
          {{ truncateTemplate(fp.template) }}
        </span>
        <q-icon
          name="close"
          size="0.625rem"
          class="tw:cursor-pointer tw:text-[var(--o2-text-secondary)] hover:tw:text-[var(--o2-text-primary)]"
          @click.stop="$emit('remove', fp.pattern_id)"
        />
      </span>
    </template>
    <div class="tw:flex-1" />
    <OButton
      variant="primary"
      size="sm"
      @click="$emit('apply')"
      data-test="patterns-patternfilterbar-apply-btn"
    >
      {{ t("search.patternApplyFilters") }}
    </OButton>
    <OButton
      variant="ghost"
      size="sm"
      @click="$emit('clear')"
      data-test="patterns-patternfilterbar-clear-btn"
    >
      {{ t("search.patternClearFilters") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import type { FilterBarPattern } from "./usePatternActions";

const { t } = useI18n();

defineProps<{
  filterPatterns: FilterBarPattern[];
}>();

defineEmits<{
  (e: "remove", patternId: string): void;
  (e: "apply"): void;
  (e: "clear"): void;
}>();

function truncateTemplate(tmpl: string): string {
  return tmpl.length > 40 ? tmpl.slice(0, 37) + "..." : tmpl;
}
</script>
