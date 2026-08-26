<!-- Copyright 2026 OpenObserve Inc.

  Right rail of the experiment create form. Replaces the prototype's terminal
  "Review" step: everything that step used to state at the end is live here
  while the form is being filled, so nothing about the run is a surprise.

  Purely presentational — the form owns the preview request and hands the
  result down.
-->
<template>
  <aside
    class="border-border-default min-w-0 flex-[3.5] overflow-auto border-l p-3 max-[68.75rem]:border-t max-[68.75rem]:border-l-0"
    data-test="ai-experiment-form-rail"
  >
    <section
      class="border-dialog-header-border rounded-default mb-3 border px-4 py-3.5"
      data-test="ai-experiment-form-preview"
    >
      <header class="text-text-secondary mb-1.5 flex items-center gap-1.5">
        <OIcon name="visibility" size="xs" />
        <span class="text-compact text-text-heading m-0 font-semibold">
          {{ t("aiObservability.experiments.form.previewTitle") }}
        </span>
      </header>

      <div v-if="!datasetSelected" class="text-text-secondary m-0 text-xs leading-normal">
        {{ t("aiObservability.experiments.form.previewEmpty") }}
      </div>
      <div v-else-if="!previewReady" class="text-text-secondary m-0 text-xs leading-normal">
        {{ t("aiObservability.experiments.form.previewIncomplete") }}
      </div>
      <div v-else-if="loading" class="text-text-secondary m-0 text-xs leading-normal">
        {{ t("aiObservability.experiments.form.previewLoading") }}
      </div>
      <div v-else-if="error" class="text-status-error-text m-0 text-xs leading-normal">
        {{ errorMessage ? raw(errorMessage) : t("aiObservability.experiments.previewError") }}
      </div>
      <template v-else-if="preview">
        <div class="flex items-baseline gap-1.5">
          <span class="text-text-heading text-2xl font-bold tabular-nums">
            {{ formattedSlots }}
          </span>
          <span class="text-text-secondary text-xs">
            {{ t("aiObservability.experiments.form.previewSlots") }}
          </span>
        </div>
        <p class="text-text-secondary mt-1 mb-0 text-xs leading-normal">
          {{
            t("aiObservability.experiments.previewCounts", {
              rows: preview.rowCount,
              trials: preview.trialCount,
              slots: preview.slotCount,
            })
          }}
        </p>

        <!-- Skip accounting. A row with no expected_output cannot be scored by a
           reference-based scorer, so it is either dropped entirely or scored on
           fewer dimensions — the single most surprising thing about a run. -->
        <div v-if="applicability" class="mt-3 flex flex-col gap-1.5">
          <div
            v-if="applicability.fullySkippedRowCount > 0"
            class="text-text-secondary flex items-start gap-1.5 text-xs leading-normal"
            data-test="ai-experiment-form-skip-full"
          >
            <OIcon
              name="warning-amber"
              size="xs"
              class="text-status-warning-text mt-0.5 shrink-0"
            />
            <span>
              {{
                t("aiObservability.experiments.form.skippedFully", {
                  count: applicability.fullySkippedRowCount,
                })
              }}
            </span>
          </div>
          <div
            v-if="applicability.partiallySkippedRowCount > 0"
            class="text-text-secondary flex items-start gap-1.5 text-xs leading-normal"
            data-test="ai-experiment-form-skip-partial"
          >
            <OIcon name="info-outline" size="xs" class="text-text-secondary mt-0.5 shrink-0" />
            <span>
              {{
                t("aiObservability.experiments.form.skippedPartially", {
                  count: applicability.partiallySkippedRowCount,
                })
              }}
            </span>
          </div>
          <div
            v-if="
              applicability.fullySkippedRowCount === 0 &&
              applicability.partiallySkippedRowCount === 0
            "
            class="text-text-secondary text-xs leading-normal"
          >
            {{ t("aiObservability.experiments.form.skippedNone") }}
          </div>
        </div>
      </template>
    </section>

    <section
      class="border-dialog-header-border rounded-default border px-4 py-3.5"
      data-test="ai-experiment-form-summary"
    >
      <header class="text-text-secondary mb-1.5 flex items-center gap-1.5">
        <OIcon name="info-outline" size="xs" />
        <span class="text-compact text-text-heading m-0 font-semibold">
          {{ t("aiObservability.experiments.form.summaryTitle") }}
        </span>
      </header>
      <dl
        class="[&_dt]:text-text-secondary [&_dd]:text-text-body m-0 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-xs [&_dd]:m-0"
      >
        <dt>{{ t("aiObservability.experiments.dataset") }}</dt>
        <dd>{{ datasetLabel || emptyValue }}</dd>
        <dt>{{ t("aiObservability.experiments.form.temperatureLabel") }}</dt>
        <dd class="tabular-nums">{{ temperature }}</dd>
        <dt>{{ t("aiObservability.experiments.scorers") }}</dt>
        <dd>
          {{
            scorerCount > 0
              ? t("aiObservability.experiments.form.summaryScorers", { count: scorerCount })
              : emptyValue
          }}
        </dd>
        <dt>{{ t("aiObservability.experiments.trials") }}</dt>
        <dd class="tabular-nums">{{ trialCount }}</dd>
      </dl>
      <p class="text-text-secondary mt-3 mb-0 text-xs leading-normal">
        {{ t("aiObservability.experiments.immutableHint") }}
      </p>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { ExperimentPreview } from "@/services/llm-experiments.service";

const props = defineProps<{
  datasetSelected: boolean;
  /** False while the task section is too incomplete for preview() to run. */
  previewReady: boolean;
  preview: ExperimentPreview | null;
  loading: boolean;
  error: boolean;
  /** Server-provided reason; falls back to the generic preview error copy. */
  errorMessage?: string;
  datasetLabel: string;
  temperature: number;
  scorerCount: number;
  trialCount: number;
}>();

const { t } = useI18nTyped();

const emptyValue = computed(() => t("aiObservability.experiments.form.summaryEmpty"));
const applicability = computed(() => props.preview?.applicability ?? null);
const formattedSlots = computed(() => (props.preview?.slotCount ?? 0).toLocaleString());
</script>
