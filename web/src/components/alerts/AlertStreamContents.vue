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
import { computed, ref } from "vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { dataNoun, formatNumber } from "@/utils/alerts/alertCopy";
import AlertMetricLabels from "./AlertMetricLabels.vue";
import AlertSampleEvents from "./AlertSampleEvents.vue";
import { SAMPLE_SIZE, useMetricLabels, useStreamSamples } from "./streamContents";

const props = defineProps<{ streamName: string; streamType: string }>();
const emit = defineEmits<{
  /** A label to group by, or with a value, a matcher to add to the query. */
  (e: "insert", payload: { label: string; value?: string }): void;
}>();

interface Part {
  id: string;
  text?: I18nText;
  failed?: boolean;
}

const { t } = useI18nTyped();
const open = ref(false);
const isMetrics = computed(() => props.streamType === "metrics");
// Loaded here, not inside the fold, so the closed line can count them and opening shows them at once.
const labels = useMetricLabels(() => (isMetrics.value ? props.streamName : ""));
const samples = useStreamSamples(
  () => props.streamName,
  () => props.streamType,
);
const separator = raw(" · ");

const labelsPart = computed<Part>(() => {
  if (labels.state.value === "failed")
    return { id: "labels", text: t("alerts.form.watch.labelsFailed"), failed: true };
  if (labels.state.value !== "ready") return { id: "labels" };
  const count = labels.labels.value.length;
  return {
    id: "labels",
    text: t("alerts.form.watch.labelCount", { count: formatNumber(count) }, count),
  };
});

const samplesPart = computed<Part>(() => {
  const state = samples.state.value;
  if (state === "failed") {
    const noun = dataNoun(props.streamType, "custom", 2, t);
    return { id: "samples", text: t("alerts.form.watch.samplesFailed", { noun }), failed: true };
  }
  if (state !== "ready") return { id: "samples" };
  const count = Math.min(samples.hits.value.length, SAMPLE_SIZE);
  const noun = dataNoun(props.streamType, "custom", count, t);
  return {
    id: "samples",
    text: t("alerts.form.watch.sampleCount", { count: formatNumber(count), noun }, count),
  };
});

const parts = computed(() =>
  isMetrics.value ? [labelsPart.value, samplesPart.value] : [samplesPart.value],
);
</script>

<template>
  <OCollapsible
    v-model="open"
    trigger-class="-ms-1 w-auto! max-w-full px-1! py-1!"
    data-test="add-alert-stream-contents"
  >
    <template #trigger>
      <span
        class="text-text-secondary flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs leading-5"
        data-test="add-alert-stream-contents-toggle"
      >
        <i18n-t keypath="alerts.form.watch.streamContentsLine" tag="span" scope="global">
          <template #parts>
            <template v-for="(part, index) in parts" :key="part.id">
              <template v-if="index">{{ separator }}</template>
              <OSkeleton
                v-if="!part.text"
                type="text"
                animation="none"
                class="inline-block! h-3 w-16 align-middle"
                :data-test="`add-alert-stream-contents-${part.id}-loading`"
              />
              <span
                v-else
                :class="part.failed ? 'text-status-error-text' : ''"
                :data-test="`add-alert-stream-contents-${part.id}`"
                >{{ part.text }}</span
              >
            </template>
          </template>
        </i18n-t>
        <span class="text-text-link underline underline-offset-2">{{
          open ? t("common.hide") : t("common.show")
        }}</span>
      </span>
    </template>
    <AlertMetricLabels
      v-if="isMetrics"
      :stream-name="streamName"
      :source="labels"
      @insert="emit('insert', $event)"
    />
    <AlertSampleEvents :stream-name="streamName" :stream-type="streamType" :source="samples" />
  </OCollapsible>
</template>
