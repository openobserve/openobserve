<template>
  <div class="tw:flex tw:flex-col tw:gap-[10px]">
    <div class="tw:flex tw:flex-col tw:gap-0.5">
      <span class="tw:text-xs tw:font-semibold tw:text-text-primary">{{ t("onlineEvals.job.inputMapping.title") }}</span>
      <span class="tw:text-[11.5px] tw:text-text-secondary">{{ t("onlineEvals.job.inputMapping.hint") }}</span>
    </div>
    <div
      v-if="selectedScorers.length === 0"
      class="tw:py-2.5 tw:px-3 tw:border tw:border-dashed tw:border-dialog-header-border tw:rounded-md tw:text-text-secondary tw:text-xs tw:text-center"
    >
      {{ t("onlineEvals.job.inputMapping.selectScorers") }}
    </div>
    <template v-else>
      <article
        v-for="scorer in selectedScorers"
        :key="entityId(scorer)"
        class="tw:border tw:border-dialog-header-border tw:rounded-md tw:bg-card-bg tw:overflow-hidden"
      >
        <div class="tw:flex tw:items-center tw:justify-between tw:gap-3 tw:py-2.5 tw:px-3 tw:border-b tw:border-dialog-header-border">
          <div class="tw:flex tw:flex-col tw:gap-px tw:min-w-0">
            <strong class="tw:text-[13px] tw:font-semibold tw:text-text-primary tw:truncate">{{ scorer.name }}</strong>
            <small class="tw:text-[11px] tw:text-text-secondary">{{
              t("onlineEvals.job.scorerPicker.meta", {
                type: scorerTypeOf(scorer).replace("_", " "),
                version: scorer.version,
              })
            }}</small>
          </div>
          <span class="tw:shrink-0 tw:text-[11px] tw:font-semibold tw:text-text-secondary">
            {{ t("onlineEvals.job.inputMapping.variableCount", { count: variablesFor(scorer).length }) }}
          </span>
        </div>
        <div v-if="variablesFor(scorer).length" class="tw:grid tw:gap-1.5 tw:py-2.5 tw:px-3">
          <label
            v-for="variable in variablesFor(scorer)"
            :key="`${entityId(scorer)}-${variable}`"
            class="tw:grid tw:grid-cols-[minmax(130px,0.35fr)_minmax(0,1fr)] tw:items-center tw:gap-2.5"
          >
            <code class="tw:overflow-hidden tw:py-1.25 tw:px-2 tw:rounded tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_10%,transparent)] tw:text-text-primary tw:font-semibold tw:text-[11px] tw:font-mono tw:truncate">{{ formatTemplateVariable(variable) }}</code>
            <input
              class="tw:w-full tw:h-7 tw:py-0 tw:px-2.5 tw:border tw:border-input-border tw:rounded tw:bg-input-bg tw:text-input-text tw:font-normal tw:text-xs tw:font-mono tw:outline-none tw:transition-colors tw:duration-120 tw:focus:border-[var(--color-primary-600,#3F7994)]"
              :value="inputMappings[entityId(scorer)]?.[variable] || ''"
              :placeholder="defaultJobMappingValue(variable)"
              @input="updateMapping(entityId(scorer), variable, ($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>
        <div
          v-else
          class="tw:py-2.5 tw:px-3 tw:border tw:border-dashed tw:border-dialog-header-border tw:rounded-md tw:text-text-secondary tw:text-xs tw:text-center"
        >
          {{ t("onlineEvals.job.inputMapping.noVariables") }}
        </div>
      </article>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { Scorer } from "@/services/online-evals.service";
import { entityId, scorerTypeOf } from "../../utils/evalEntity";
import { formatTemplateVariable } from "../../utils/evalFormat";
import {
  defaultJobMappingValue,
  jobMappingVariablesForScorer,
} from "../../utils/jobMappings";

const props = defineProps<{
  selectedScorers: Scorer[];
  inputMappings: Record<string, Record<string, string>>;
}>();

const emit = defineEmits<{
  (e: "update:inputMappings", value: Record<string, Record<string, string>>): void;
}>();

const { t } = useI18n();

function variablesFor(scorer: Scorer) {
  return jobMappingVariablesForScorer(scorer, props.inputMappings[entityId(scorer)]);
}

function updateMapping(scorerId: string, variable: string, value: string) {
  emit("update:inputMappings", {
    ...props.inputMappings,
    [scorerId]: {
      ...(props.inputMappings[scorerId] || {}),
      [variable]: value,
    },
  });
}
</script>

