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
import { computed, watch } from "vue";
import { useStore } from "vuex";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { timestampToTimezoneDate } from "@/utils/timezone";
import { useAlertStreamQuery } from "@/composables/alerts/useAlertStreamQuery";

const props = defineProps<{
  streamName: string;
  streamType: string;
}>();

const SAMPLE_SIZE = 5;
const WINDOW_US = 60 * 60 * 1000 * 1000;
const MESSAGE_FIELDS = ["message", "msg", "log", "body"];

const { t } = useI18nTyped();
const store = useStore();
const query = useAlertStreamQuery();

const timestampColumn = computed(() => store.state.zoConfig?.timestamp_column || "_timestamp");

const rows = computed(() =>
  query.hits.value.slice(0, SAMPLE_SIZE).map((hit) => {
    const { [timestampColumn.value]: timestamp, ...fields } = hit;
    const field = MESSAGE_FIELDS.find((name) => typeof fields[name] === "string");
    return {
      time: timestampToTimezoneDate(Number(timestamp), store.state.timezone, "HH:mm:ss"),
      text: field ? String(fields[field]) : JSON.stringify(fields),
    };
  }),
);

watch(
  () => [props.streamName, props.streamType],
  () => {
    if (!props.streamName) return;
    const now = Date.now() * 1000;
    query.run({
      sql: `SELECT * FROM "${props.streamName.replace(/"/g, '""')}" ORDER BY "${timestampColumn.value}" DESC`,
      streamType: props.streamType,
      startTime: now - WINDOW_US,
      endTime: now,
      size: SAMPLE_SIZE,
    });
  },
  { immediate: true },
);
</script>

<template>
  <OSettingRow
    :label="t('alerts.sections.samples.label')"
    :description="t('alerts.sections.samples.help')"
    fill
    data-test="add-alert-sample-events"
  >
    <ul v-if="rows.length" class="m-0 flex list-none flex-col gap-1.5 p-0">
      <li
        v-for="(row, index) in rows"
        :key="index"
        class="flex min-w-0 gap-3 text-xs"
        data-test="add-alert-sample-event"
      >
        <span class="text-text-secondary shrink-0">{{ raw(row.time) }}</span>
        <span class="text-text-body min-w-0 truncate font-mono">{{ raw(row.text) }}</span>
      </li>
    </ul>
    <p v-else class="text-text-secondary m-0 pt-2 text-xs" data-test="add-alert-sample-status">
      <template v-if="query.state.value === 'failed'">{{
        t("alerts.sections.samples.failed")
      }}</template>
      <template v-else-if="query.state.value === 'ready'">{{
        t("alerts.sections.samples.empty")
      }}</template>
      <template v-else>{{ t("alerts.sections.samples.loading") }}</template>
    </p>
  </OSettingRow>
</template>
