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

<!-- Needs the context TraceDetails provides; renders nothing without it. -->
<template>
  <div
    v-if="timeline"
    class="border-border-default rounded-default bg-surface-base flex flex-col gap-1.5 border px-3 py-2"
    :data-test="`behind-this-step-${step.spanId}`"
  >
    <div class="text-text-secondary text-2xs font-semibold">
      {{ t("requestTimeline.behindThisStep") }}
    </div>
    <div class="text-text-body text-xs" data-test="behind-this-step-sentence">
      {{ sentence }}
    </div>
    <TraceLanes
      :spans="subtree"
      :stream-name="timeline.streamName.value"
      :axis-start-us="step.startUs"
      :axis-duration-us="step.durationUs"
      :label-width="LABEL_WIDTH"
      @open-logs="timeline.openLogsAt($event.spanId, $event.timestampUs)"
      @pod-state="podState = $event"
    />
    <div>
      <OButton
        variant="outline"
        size="xs"
        data-test="behind-this-step-open-waterfall"
        @click="timeline.openInWaterfall(step.spanId)"
      >
        {{ t("requestTimeline.openInWaterfall") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, inject, ref } from "vue";
import { useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import {
  attributionSentence,
  REQUEST_TIMELINE_KEY,
  subtreeOf,
  type PodState,
  type StepAttribution,
} from "./timeAttribution";

const TraceLanes = defineAsyncComponent(() => import("./TraceLanes.vue"));

const props = defineProps<{ step: StepAttribution }>();

const LABEL_WIDTH = 128;
const POD_SENTENCE: Record<PodState, I18nKey> = {
  healthy: "requestTimeline.podSentenceHealthy",
  restarted: "requestTimeline.podSentenceRestarted",
  oomKilled: "requestTimeline.podSentenceOomKilled",
};

const { t } = useI18nTyped();
const timeline = inject(REQUEST_TIMELINE_KEY, null);
const podState = ref<{ pod: string; state: PodState } | null>(null);

const subtree = computed(() => subtreeOf(timeline?.spans.value ?? [], props.step.spanId));
const sentence = computed(() => {
  const base = attributionSentence(props.step, t);
  const pod = podState.value;
  return (pod ? `${base} ${t(POD_SENTENCE[pod.state], { pod: pod.pod })}` : base) as I18nText;
});
</script>
