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
  <div data-test="rca-stage-stepper" class="flex max-w-215 flex-col gap-1.5">
    <p
      v-if="current > 0"
      data-test="rca-stage-label"
      class="text-text-heading m-0 text-xs font-semibold"
      role="status"
    >
      {{
        t("alerts.incidents.rcaRun.stageOf", {
          index: current,
          count: stages.length,
          stage: currentLabel,
        })
      }}
    </p>
    <ol class="m-0 grid list-none auto-cols-fr grid-flow-col gap-1 p-0">
      <li
        v-for="(stage, idx) in stages"
        :key="stage.key"
        class="flex min-w-0 flex-col gap-1"
        :aria-current="idx + 1 === current ? 'step' : undefined"
      >
        <span
          class="h-1 rounded-full"
          :class="BAR_CLASS[barState(idx + 1)]"
          :data-state="barState(idx + 1)"
        />
        <span class="text-2xs truncate" :class="labelClass(idx + 1)">
          {{ t(stage.labelKey) }}
        </span>
      </li>
    </ol>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { RCA_STEPPER_STAGES, type StepperStage } from "@/utils/incidents/rcaThread";

const props = withDefaults(
  defineProps<{
    /** 1-based `stage_index` of the run summary. */
    stageIndex?: number | null;
    /** Stage id of the run summary, used when the index is missing. */
    stage?: string | null;
    /** Stages in order; Incidents uses the RCA protocol stages. */
    stages?: readonly StepperStage[];
    /** Keys of stages the run moved past without reaching. */
    skipped?: readonly string[];
  }>(),
  { stageIndex: null, stage: null, stages: () => RCA_STEPPER_STAGES, skipped: () => [] },
);

const { t } = useI18nTyped();

const stages = computed(() => props.stages);

/** 1-based index of the current stage; 0 before the first stage. */
const current = computed(() => {
  const index = props.stageIndex;
  if (index && index >= 1 && index <= stages.value.length) return index;
  return stages.value.findIndex((item) => item.key === props.stage) + 1;
});

const currentLabel = computed(() =>
  current.value > 0 ? t(stages.value[current.value - 1].labelKey) : "",
);

type BarState = "done" | "skipped" | "current" | "todo";

const barState = (position: number): BarState => {
  if (position === current.value) return "current";
  if (position > current.value) return "todo";
  return props.skipped.includes(stages.value[position - 1].key) ? "skipped" : "done";
};

const BAR_CLASS: Record<BarState, string> = {
  done: "bg-accent",
  skipped: "bg-border-default",
  current: "bg-accent/45",
  todo: "bg-border-default",
};

const LABEL_CLASS: Record<BarState, string> = {
  done: "text-text-body",
  skipped: "text-text-muted",
  current: "text-text-heading font-bold",
  todo: "text-text-secondary",
};

const labelClass = (position: number) => LABEL_CLASS[barState(position)];
</script>
