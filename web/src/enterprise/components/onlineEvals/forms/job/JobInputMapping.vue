<template>
  <div class="job-mapping">
    <div class="job-mapping__head">
      <span class="job-mapping__title">{{ t("onlineEvals.job.inputMapping.title") }}</span>
      <span class="job-mapping__hint">{{ t("onlineEvals.job.inputMapping.hint") }}</span>
    </div>
    <div v-if="selectedScorers.length === 0" class="job-mapping__empty">
      {{ t("onlineEvals.job.inputMapping.selectScorers") }}
    </div>
    <template v-else>
      <article
        v-for="scorer in selectedScorers"
        :key="entityId(scorer)"
        class="job-mapping-card"
      >
        <div class="job-mapping-card__head">
          <div class="job-mapping-card__head-text">
            <strong class="job-mapping-card__name">{{ scorer.name }}</strong>
            <small class="job-mapping-card__meta">{{
              t("onlineEvals.job.scorerPicker.meta", {
                type: scorerTypeOf(scorer).replace("_", " "),
                version: scorer.version,
              })
            }}</small>
          </div>
          <span class="job-mapping-card__count">
            {{ t("onlineEvals.job.inputMapping.variableCount", { count: variablesFor(scorer).length }) }}
          </span>
        </div>
        <div v-if="variablesFor(scorer).length" class="job-mapping-card__rows">
          <label
            v-for="variable in variablesFor(scorer)"
            :key="`${entityId(scorer)}-${variable}`"
            class="job-mapping-row"
          >
            <code class="job-mapping-row__var">{{ formatTemplateVariable(variable) }}</code>
            <input
              class="job-mapping-row__input"
              :value="inputMappings[entityId(scorer)]?.[variable] || ''"
              :placeholder="defaultJobMappingValue(variable)"
              @input="updateMapping(entityId(scorer), variable, ($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>
        <div v-else class="job-mapping__empty">
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

<style lang="scss" scoped>
.job-mapping {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.job-mapping__head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.job-mapping__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
}

.job-mapping__hint {
  font-size: 11.5px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.job-mapping__empty {
  padding: 10px 12px;
  border: 1px dashed var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-size: 12px;
  text-align: center;
}

.job-mapping-card {
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
  background: var(--color-card-bg);
  overflow: hidden;
}

.job-mapping-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
}

.job-mapping-card__head-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.job-mapping-card__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-mapping-card__meta {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.job-mapping-card__count {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.job-mapping-card__rows {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
}

.job-mapping-row {
  display: grid;
  grid-template-columns: minmax(130px, 0.35fr) minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.job-mapping-row__var {
  overflow: hidden;
  padding: 5px 8px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-text-secondary) 10%, transparent);
  color: var(--color-text-primary, currentColor);
  font-weight: 600;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-mapping-row__input {
  width: 100%;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--color-input-border, var(--o2-border-input));
  border-radius: 4px;
  background: var(--color-input-bg, var(--color-card-bg));
  color: var(--color-input-text, var(--color-text-primary));
  font-weight: 400;
  font-size: 12px;
  outline: none;
  transition: border-color 0.12s;
}

.job-mapping-row__input:focus {
  border-color: var(--color-primary-600, #3F7994);
}
</style>
