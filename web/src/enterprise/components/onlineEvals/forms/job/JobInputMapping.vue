<template>
  <div class="flex flex-col gap-[10px]">
    <div class="flex flex-col gap-0.5">
      <span class="text-xs font-semibold text-text-primary">{{ t("onlineEvals.job.inputMapping.title") }}</span>
      <span class="text-[11.5px] text-text-secondary">{{ t("onlineEvals.job.inputMapping.hint") }}</span>
    </div>
    <div
      v-if="selectedScorers.length === 0"
      class="py-2.5 px-3 border border-dashed border-dialog-header-border rounded-md text-text-secondary text-xs text-center"
    >
      {{ t("onlineEvals.job.inputMapping.selectScorers") }}
    </div>
    <template v-else>
      <article
        v-for="scorer in selectedScorers"
        :key="entityId(scorer)"
        class="border border-dialog-header-border rounded-md bg-card-bg overflow-hidden"
      >
        <div class="flex items-center justify-between gap-3 py-2.5 px-3 border-b border-dialog-header-border">
          <div class="flex flex-col gap-px min-w-0">
            <strong class="text-[13px] font-semibold text-text-primary truncate">{{ scorer.name }}</strong>
            <small class="text-[11px] text-text-secondary">{{
              t("onlineEvals.job.scorerPicker.meta", {
                type: scorerTypeOf(scorer).replace("_", " "),
                version: scorer.version,
              })
            }}</small>
          </div>
          <span class="shrink-0 text-[11px] font-semibold text-text-secondary">
            {{ t("onlineEvals.job.inputMapping.variableCount", { count: variablesFor(scorer).length }) }}
          </span>
        </div>
        <div v-if="variablesFor(scorer).length" class="grid gap-1.5 py-2.5 px-3">
          <label
            v-for="variable in variablesFor(scorer)"
            :key="`${entityId(scorer)}-${variable}`"
            class="grid grid-cols-[minmax(130px,0.35fr)_minmax(0,1fr)] items-center gap-2.5"
          >
            <code class="overflow-hidden py-1.25 px-2 rounded bg-[color-mix(in_srgb,var(--color-text-secondary)_10%,transparent)] text-text-primary font-semibold text-[11px] font-mono truncate">{{ formatTemplateVariable(variable) }}</code>
            <input
              class="w-full h-7 py-0 px-2.5 border border-input-border rounded bg-input-bg text-input-text font-normal text-xs font-mono outline-none transition-colors duration-120 focus:border-[var(--color-primary-600,#3F7994)]"
              :value="inputMappings[entityId(scorer)]?.[variable] || ''"
              :placeholder="defaultJobMappingValue(variable)"
              @input="updateMapping(entityId(scorer), variable, ($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>
        <div
          v-else
          class="py-2.5 px-3 border border-dashed border-dialog-header-border rounded-md text-text-secondary text-xs text-center"
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

