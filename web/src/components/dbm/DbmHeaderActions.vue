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
  DbmHeaderActions — the header's last-run dot, time picker and Refresh button,
  in the same form AI Observability's page header wears. The range is the
  page's own URL-backed range, so every tab shows and writes the same window.
-->
<template>
  <AiLastRefreshed
    class="me-1"
    :last-run-at="lastRunAt"
    :loading="loading"
    data-test="dbm-header-last-refreshed"
  />
  <DateTime
    auto-apply
    menu-align="end"
    calendar-presets
    :default-type="range.type"
    :default-absolute-time="{ startTime: range.startTime, endTime: range.endTime }"
    :default-relative-time="range.relativeTimePeriod ?? undefined"
    data-test-name="dbm-header-datetime"
    class="h-8"
    @on:date-change="(value: DbmDateChange) => emit('date-change', value)"
  />
  <OButton
    variant="primary"
    size="sm-toolbar"
    icon-left="refresh"
    :disabled="loading"
    :loading="loading"
    data-test="dbm-header-refresh"
    @click="emit('refresh')"
  >
    <!-- Icon-only on phones so the actions share the title row; sr-only keeps the button named. -->
    <span class="max-md:sr-only">{{ t("common.refresh") }}</span>
  </OButton>
</template>

<script setup lang="ts">
import DateTime from "@/components/DateTime.vue";
import type { DbmDateChange, DbmRange } from "@/composables/dbm/useDbmScope";
import AiLastRefreshed from "@/enterprise/components/AIObservability/AiLastRefreshed.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";

defineProps<{
  range: DbmRange;
  lastRunAt: number | null;
  loading: boolean;
}>();

const emit = defineEmits<{
  "date-change": [value: DbmDateChange];
  refresh: [];
}>();

const { t } = useI18nTyped();
</script>
