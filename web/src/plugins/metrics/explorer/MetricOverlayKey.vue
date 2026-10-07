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
    class="text-text-secondary flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
    :data-test="dataTest"
  >
    <span class="inline-flex items-center gap-1.5 max-md:hidden">
      <span class="w-4 border-t-2 border-current" aria-hidden="true" />
      {{ t("metrics.explorer.detail.overlay.current") }}
    </span>
    <span v-if="period" class="inline-flex items-center gap-1.5">
      <template v-if="periodEmpty">
        {{ t("metrics.explorer.detail.overlay.noData", { period }) }}
      </template>
      <template v-else>
        <span class="w-4 border-t-2 border-dotted border-current" aria-hidden="true" />
        {{ period }}
      </template>
    </span>
    <span v-if="forecast" class="inline-flex items-center gap-1.5">
      <span class="w-4 border-t-2 border-dashed border-current" aria-hidden="true" />
      {{ t("metrics.explorer.detail.overlay.forecast") }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped, type I18nText } from "@/types/i18n";

withDefaults(
  defineProps<{
    /** The compared period's name, e.g. "1 hour ago"; null when nothing is compared. */
    period?: I18nText | null;
    periodEmpty?: boolean;
    forecast?: boolean;
    dataTest: string;
  }>(),
  { period: null, periodEmpty: false, forecast: false },
);

const { t } = useI18nTyped();
</script>
