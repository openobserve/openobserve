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
import { useI18nTyped } from "@/types/i18n";

withDefaults(defineProps<{ dataTest?: string }>(), { dataTest: "chart-placeholder" });

const { t } = useI18nTyped();
</script>

<template>
  <!-- Blank on purpose: the panel's loader line is the signal, and axes here would read as "No data". -->
  <div
    role="img"
    :aria-label="t('components.chartPlaceholder.loading')"
    class="h-full w-full"
    :data-test="dataTest"
  />
</template>
