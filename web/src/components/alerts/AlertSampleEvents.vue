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
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { timestampToTimezoneDate } from "@/utils/timezone";
import { dataNoun } from "@/utils/alerts/alertCopy";
import { SAMPLE_SIZE, useStreamSamples, type StreamSamplesSource } from "./streamContents";

const props = defineProps<{
  streamName: string;
  streamType: string;
  /** Events already loaded by a parent that also counts them; loads its own when absent. */
  source?: StreamSamplesSource;
}>();

const MESSAGE_FIELDS = ["message", "msg", "log", "body"];

const { t } = useI18nTyped();
const noun = computed(() => dataNoun(props.streamType, "custom", 2, t));
const store = useStore();
const query =
  props.source ??
  useStreamSamples(
    () => props.streamName,
    () => props.streamType,
  );

const timestampColumn = computed(() => store.state.zoConfig?.timestamp_column || "_timestamp");
const openIndex = ref<number | null>(null);

const showValue = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value ?? null);

const rows = computed(() =>
  query.hits.value.slice(0, SAMPLE_SIZE).map((hit) => {
    const { [timestampColumn.value]: timestamp, ...fields } = hit;
    const field = MESSAGE_FIELDS.find((name) => typeof fields[name] === "string");
    return {
      time: timestampToTimezoneDate(Number(timestamp), store.state.timezone, "HH:mm:ss"),
      text: field ? String(fields[field]) : JSON.stringify(fields),
      fields: Object.entries(fields).map(([key, value]) => ({ key, value: showValue(value) })),
    };
  }),
);

watch(
  () => [props.streamName, props.streamType],
  () => (openIndex.value = null),
);
</script>

<template>
  <OSettingRow
    :label="t('alerts.sections.samples.label', { noun })"
    :description="t('alerts.sections.samples.help')"
    fill
    wide
    data-test="add-alert-sample-events"
  >
    <ul v-if="rows.length" class="m-0 flex list-none flex-col gap-0.5 p-0">
      <li v-for="(row, index) in rows" :key="index" data-test="add-alert-sample-event">
        <OCollapsible
          :model-value="openIndex === index"
          trigger-class="px-1! py-0.5!"
          @update:model-value="openIndex = $event ? index : null"
        >
          <template #trigger="{ open }">
            <span
              class="flex min-w-0 flex-1 items-center gap-3 text-xs"
              data-test="add-alert-sample-toggle"
            >
              <OIcon
                name="chevron-right"
                size="xs"
                class="text-text-secondary shrink-0 transition-transform duration-150"
                :class="open ? 'rotate-90' : ''"
              />
              <span class="text-text-secondary shrink-0">{{ raw(row.time) }}</span>
              <OTruncatedText class="text-text-body min-w-0 font-mono" :tooltip="false">{{
                raw(row.text)
              }}</OTruncatedText>
              <span class="sr-only">{{
                open ? t("alerts.discovery.sampleCollapse") : t("alerts.discovery.sampleExpand")
              }}</span>
            </span>
          </template>
          <dl
            class="m-0 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-0.5 py-1 ps-6 text-xs"
          >
            <div
              v-for="field in row.fields"
              :key="field.key"
              class="contents"
              data-test="add-alert-sample-field"
            >
              <dt class="text-text-secondary min-w-0 break-all">{{ raw(field.key) }}</dt>
              <dd class="text-text-body m-0 min-w-0 font-mono break-all">
                <OTruncatedText :lines="3">{{ raw(field.value) }}</OTruncatedText>
              </dd>
            </div>
          </dl>
        </OCollapsible>
      </li>
    </ul>
    <p v-else class="text-text-secondary m-0 pt-2 text-xs" data-test="add-alert-sample-status">
      <template v-if="query.state.value === 'failed'">{{
        t("alerts.sections.samples.failed", { noun })
      }}</template>
      <template v-else-if="query.state.value === 'ready'">{{
        t("alerts.sections.samples.empty")
      }}</template>
      <template v-else>{{ t("alerts.sections.samples.loading", { noun }) }}</template>
    </p>
  </OSettingRow>
</template>
