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
  <div class="flex flex-col gap-3" data-test="sample-data-progress">
    <div class="flex items-center justify-between gap-3">
      <strong class="text-text-heading text-sm">{{
        status === "loaded" ? t("sampleData.progress.done") : t("sampleData.progress.loading")
      }}</strong>
      <span class="text-text-secondary text-xs" data-test="sample-data-progress-counts">{{
        countsLine
      }}</span>
    </div>
    <OProgressBar
      :value="session.fraction.value"
      :variant="status === 'loaded' ? 'success' : 'default'"
      size="sm"
    />
    <ul
      class="m-0 grid list-none grid-cols-1 p-0"
      :class="stacked ? 'gap-3 pt-1' : 'gap-2 sm:grid-cols-2'"
    >
      <li
        v-for="step in steps"
        :key="step.id"
        class="flex items-center gap-2 text-sm"
        :data-test="`sample-data-step-${step.id}`"
        :data-status="step.status"
      >
        <OIcon :name="stepIcon(step.status)" size="sm" :class="stepIconClass(step.status)" />
        <span :class="step.status === 'pending' ? 'text-text-secondary' : 'text-text-body'">{{
          step.label
        }}</span>
        <OTag
          v-if="step.status === 'failed'"
          :label="t('sampleData.progress.skipped')"
          variant="warning"
          size="sm"
        />
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  useSampleDataSession,
  type SampleStepStatus,
} from "@/composables/sampleData/useSampleDataSession";
import { SAMPLE_STEPS, type SampleStepId } from "@/utils/sampleData/loader";

defineProps<{ stacked?: boolean }>();

const { t } = useI18nTyped();
const session = useSampleDataSession();
const status = session.status;

const stepLabels = computed<Record<SampleStepId, I18nText>>(() => ({
  functions: t("sampleData.steps.functions"),
  pipeline: t("sampleData.steps.pipeline"),
  telemetry: t("sampleData.steps.telemetry"),
  dashboards: t("sampleData.steps.dashboards"),
  alerts: t("sampleData.steps.alerts"),
  enrichment: t("sampleData.steps.enrichment"),
}));
const steps = computed(() =>
  SAMPLE_STEPS.map((id) => ({ id, label: stepLabels.value[id], status: session.steps[id] })),
);
const countsLine = computed(() =>
  t("sampleData.progress.counts", {
    logs: raw(session.counts.logs.toLocaleString()),
    spans: raw(session.counts.spans.toLocaleString()),
    metrics: raw(session.counts.metrics.toLocaleString()),
  }),
);

const stepIcon = (s: SampleStepStatus): IconName => {
  if (s === "done") return "check-circle";
  if (s === "failed") return "warning-amber";
  if (s === "running") return "progress-activity";
  return "radio-button-unchecked";
};
const stepIconClass = (s: SampleStepStatus) => {
  if (s === "done") return "text-status-success-text";
  if (s === "failed") return "text-icon-chip-warning-text";
  if (s === "running") return "text-accent animate-spin";
  return "text-text-secondary";
};
</script>
