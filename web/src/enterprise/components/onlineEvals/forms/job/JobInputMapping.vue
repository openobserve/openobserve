<template>
  <div class="eval-form-section__wide eval-input-mapping">
    <div class="eval-form-field-head">
      <span>Input mapping</span>
      <small>Map span fields into each scorer template variable.</small>
    </div>
    <div v-if="selectedScorers.length === 0" class="eval-input-mapping__empty">
      Select scorers to configure their mappings.
    </div>
    <template v-else>
      <article
        v-for="scorer in selectedScorers"
        :key="entityId(scorer)"
        class="eval-mapping-card"
      >
        <div class="eval-mapping-card__head">
          <div>
            <strong>{{ scorer.name }}</strong>
            <small>{{ scorerTypeOf(scorer).replace("_", " ") }} · v{{ scorer.version }}</small>
          </div>
          <i>{{ variablesFor(scorer).length }} variables</i>
        </div>
        <div v-if="variablesFor(scorer).length" class="eval-mapping-card__rows">
          <label
            v-for="variable in variablesFor(scorer)"
            :key="`${entityId(scorer)}-${variable}`"
            class="eval-mapping-row"
          >
            <code v-text="formatTemplateVariable(variable)" />
            <input
              :value="inputMappings[entityId(scorer)]?.[variable] || ''"
              :placeholder="defaultJobMappingValue(variable)"
              @input="updateMapping(entityId(scorer), variable, ($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>
        <div v-else class="eval-input-mapping__empty">
          This scorer has no template variables to map.
        </div>
      </article>
    </template>
  </div>
</template>

<script setup lang="ts">
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
