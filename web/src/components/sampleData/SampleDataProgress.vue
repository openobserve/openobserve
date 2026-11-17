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
  <div class="flex flex-col gap-3 overflow-y-auto" data-test="sample-data-progress">
    <span
      class="sr-only"
      role="status"
      aria-live="polite"
      data-test="sample-data-progress-announcer"
      >{{ announcement }}</span
    >
    <div class="flex shrink-0 flex-col gap-2">
      <div class="flex items-end justify-between gap-3">
        <strong class="text-text-heading text-sm">{{
          done ? t("sampleData.progress.done") : t("sampleData.progress.loading")
        }}</strong>
        <span
          class="text-text-heading text-3xl leading-none font-semibold tabular-nums"
          data-test="sample-data-progress-percent"
          >{{ percent }}</span
        >
      </div>
      <OProgressBar
        :value="done ? 1 : session.fraction.value"
        :variant="done ? 'success' : 'default'"
        size="xs"
        :aria-label="done ? t('sampleData.progress.done') : t('sampleData.progress.loading')"
      />
    </div>

    <div
      class="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-3"
      data-test="sample-data-progress-counts"
    >
      <OStatCard
        v-for="tile in tiles"
        :key="tile.key"
        class="tabular-nums"
        :label="tile.label"
        :value="shown[tile.key].toLocaleString()"
        :icon="tile.icon"
        :tone="tile.tone"
        :data-test="`sample-data-progress-${tile.key}`"
      />
    </div>

    <SampleLivePreview
      v-if="live || session.recentLogs.value.length"
      class="shrink-0"
      :paused="!live"
      :chart="false"
      :feed="session.recentLogs.value"
      data-test="sample-data-progress-live"
    />

    <ul class="m-0 grid shrink-0 list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
      <li
        v-for="step in steps"
        :key="step.id"
        class="rounded-default flex min-w-0 items-center gap-2 border px-2.5 py-1 text-xs"
        :class="chipClass(step.status)"
        :data-test="`sample-data-step-${step.id}`"
        :data-status="step.status"
      >
        <OIcon
          :name="stepIcon(step.status)"
          size="sm"
          class="shrink-0"
          :class="stepIconClass(step.status)"
          :label="step.status === 'failed' ? t('sampleData.progress.skipped') : undefined"
        />
        <span class="truncate" :title="step.label">{{ step.label }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, watch } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OStatCard from "@/lib/data/StatStrip/OStatCard.vue";
import type { StatTone } from "@/lib/data/StatStrip/OStatStrip.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useSampleDataSession } from "@/composables/sampleData/useSampleDataSession";
import { SAMPLE_STEPS, type SampleCounts, type SampleStepId } from "@/utils/sampleData/loader";
import { prefersReducedMotion } from "@/components/ingestion/setupCard/useStreamDetect";
import SampleLivePreview from "./SampleLivePreview.vue";
import { chipClass, stepIcon, stepIconClass } from "./sampleStepStyle";

const TWEEN_MS = 600;
const COUNT_KEYS = ["logs", "spans", "metrics"] as const;

const props = defineProps<{ done?: boolean }>();

const { t } = useI18nTyped();
const session = useSampleDataSession();
const live = computed(() => !props.done && session.status.value === "loading");
// the region stays in the page so the change of its text is announced
const announcement = computed(() => (props.done ? t("sampleData.progress.done") : raw("")));
const percent = computed(() =>
  raw(`${props.done ? 100 : Math.round(session.fraction.value * 100)}%`),
);

const tiles = computed<
  { key: keyof SampleCounts; label: I18nText; icon: IconName; tone: StatTone }[]
>(() => [
  { key: "logs", label: t("sampleData.progress.logs"), icon: "search", tone: "blue" },
  { key: "spans", label: t("sampleData.progress.spans"), icon: "account-tree", tone: "purple" },
  { key: "metrics", label: t("sampleData.progress.metrics"), icon: "bar-chart", tone: "teal" },
]);

// counts arrive in batches; easing toward each new total makes them read as a live stream
const shown = reactive<SampleCounts>({ logs: 0, spans: 0, metrics: 0 });
let frame = 0;
watch(
  () => COUNT_KEYS.map((key) => session.counts[key]),
  (target) => {
    cancelAnimationFrame(frame);
    if (prefersReducedMotion()) {
      COUNT_KEYS.forEach((key, i) => (shown[key] = target[i]));
      return;
    }
    const from = COUNT_KEYS.map((key) => shown[key]);
    let start: number | undefined;
    const step = (now: number) => {
      start ??= now;
      const k = Math.min((now - start) / TWEEN_MS, 1);
      const eased = 1 - (1 - k) ** 3;
      COUNT_KEYS.forEach(
        (key, i) => (shown[key] = Math.round(from[i] + (target[i] - from[i]) * eased)),
      );
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  },
  { immediate: true },
);
onBeforeUnmount(() => cancelAnimationFrame(frame));

const stepLabels = computed<Record<SampleStepId, I18nText>>(() => ({
  functions: t("sampleData.steps.functions"),
  pipeline: t("sampleData.steps.pipeline"),
  telemetry: t("sampleData.steps.telemetry"),
  dashboards: t("sampleData.steps.dashboards"),
  alerts: t("sampleData.steps.alerts"),
  enrichment: t("sampleData.steps.enrichment"),
}));
const steps = computed(() =>
  SAMPLE_STEPS.map((id) => ({
    id,
    label: stepLabels.value[id],
    status: session.steps[id],
  })),
);
</script>
