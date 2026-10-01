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

<!-- One usage figure in the same card shape the LLM Insights KPI row uses. -->
<template>
  <div
    class="bg-card-glass-bg rounded-default border-border-default flex flex-col gap-1 border px-3.5 py-2.5 max-lg:shrink-0 max-lg:basis-auto max-lg:px-1.5 max-lg:py-1"
    :title="lgUp ? undefined : label"
  >
    <div class="mb-1 flex items-center justify-between gap-2 max-lg:mb-0">
      <div
        class="text-2xs text-text-secondary min-w-0 truncate leading-normal font-semibold max-lg:hidden"
      >
        {{ label }}
      </div>
      <span
        v-if="icon"
        class="rounded-default bg-surface-subtle text-text-secondary inline-flex h-6 w-6 shrink-0 items-center justify-center"
      >
        <OIcon :name="icon" size="sm" />
      </span>
    </div>
    <!-- Loading keeps the card's shape, so nothing moves when the figures land. -->
    <template v-if="loading">
      <OSkeleton type="text" class="h-6 w-20" data-test="usage-kpi-card-loading" />
      <OSkeleton type="text" class="h-3 w-28 max-lg:hidden" />
    </template>
    <div
      v-else
      class="truncate text-2xl leading-none font-semibold max-lg:text-lg"
      :class="
        tone === 'danger'
          ? 'text-status-error-text'
          : tone === 'warn'
            ? 'text-status-warning-text'
            : positive
              ? 'text-status-success-text'
              : 'text-text-heading'
      "
    >
      {{ value }}
      <span v-if="valueSuffix" class="text-text-secondary text-xs font-medium">
        {{ valueSuffix }}
      </span>
    </div>
    <div v-if="hint && !loading" class="text-2xs text-text-secondary truncate max-lg:hidden">
      {{ hint }}
      <span v-if="struck" class="line-through">{{ struck }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { I18nText } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import useBreakpoint from "@/composables/useBreakpoint";

defineProps<{
  label: I18nText;
  icon?: IconName;
  value: I18nText;
  hint?: I18nText;
  /** A figure the value replaced, such as the pre-discount amount, shown struck through. */
  struck?: I18nText;
  /** A value that is good news for the reader, such as a saving. */
  positive?: boolean;
  /** A small figure beside the value, such as the percentage a saving represents. */
  valueSuffix?: I18nText;
  /** Bad news for the reader, such as spend near or past a budget. Wins over `positive`. */
  tone?: "warn" | "danger";
  /** The figures are still being fetched; value and hint show as skeleton bars. */
  loading?: boolean;
}>();

const { lgUp } = useBreakpoint();
</script>
