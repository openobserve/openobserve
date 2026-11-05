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

<script setup lang="ts">
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { useI18nTyped } from "@/types/i18n";

withDefaults(
  defineProps<{
    dataTest?: string;
    /** Under a failure message, which speaks for it, so it announces nothing itself. */
    failed?: boolean;
  }>(),
  { dataTest: "chart-placeholder", failed: false },
);

const { t } = useI18nTyped();
</script>

<template>
  <!-- Static on purpose: no axes or zero line, so it can never read as "No data" (ruling 11). -->
  <div
    :role="failed ? undefined : 'img'"
    :aria-label="failed ? undefined : t('components.chartPlaceholder.loading')"
    :aria-hidden="failed ? 'true' : undefined"
    class="h-full w-full p-2"
    :data-test="dataTest"
  >
    <OSkeleton type="rect" animation="none" class="h-full w-full" aria-hidden="true" />
  </div>
</template>
