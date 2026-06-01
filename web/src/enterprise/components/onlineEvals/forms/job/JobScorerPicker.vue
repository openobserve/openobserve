<template>
  <div class="job-scorer-picker">
    <div class="job-scorer-picker__head">
      <span class="job-scorer-picker__title">{{ t("onlineEvals.job.scorerPicker.title") }}</span>
      <span class="job-scorer-picker__hint">{{ t("onlineEvals.job.scorerPicker.hint") }}</span>
    </div>
    <div class="job-scorer-picker__grid">
      <label
        v-for="scorer in scorers"
        :key="entityId(scorer)"
        class="job-scorer-option"
        :class="{ 'job-scorer-option--selected': selectedIds.includes(entityId(scorer)) }"
      >
        <input
          type="checkbox"
          class="job-scorer-option__check"
          :checked="selectedIds.includes(entityId(scorer))"
          @change="$emit('toggle', entityId(scorer))"
        />
        <div class="job-scorer-option__body">
          <strong class="job-scorer-option__name">{{ scorer.name }}</strong>
          <small class="job-scorer-option__meta">{{
            t("onlineEvals.job.scorerPicker.meta", {
              type: scorerTypeOf(scorer).replace("_", " "),
              version: scorer.version,
            })
          }}</small>
        </div>
      </label>
      <div v-if="!scorers.length" class="job-scorer-picker__empty">
        No scorers available. Create one first in the Scorers tab.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { Scorer } from "@/services/online-evals.service";
import { entityId, scorerTypeOf } from "../../utils/evalEntity";

defineProps<{
  scorers: Scorer[];
  selectedIds: string[];
}>();

defineEmits<{
  (e: "toggle", scorerId: string): void;
}>();

const { t } = useI18n();
</script>

<style lang="scss" scoped>
.job-scorer-picker {
  margin-bottom: 16px;
}

.job-scorer-picker__head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
}

.job-scorer-picker__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
}

.job-scorer-picker__hint {
  font-size: 11.5px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.job-scorer-picker__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.job-scorer-picker__empty {
  grid-column: 1 / -1;
  padding: 12px 14px;
  border: 1px dashed var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
  text-align: center;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-size: 12px;
}

.job-scorer-option {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 54px;
  padding: 10px 12px;
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
  background: var(--color-card-bg);
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}

.job-scorer-option:hover {
  border-color: color-mix(in srgb, var(--color-primary-600, #3F7994) 40%, var(--color-dialog-header-border));
}

.job-scorer-option--selected {
  border-color: var(--color-primary-600, #3F7994);
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 6%, var(--color-card-bg));
}

.job-scorer-option__check {
  appearance: none;
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--color-input-border, var(--o2-border-input));
  border-radius: 3px;
  background: var(--color-card-bg);
  cursor: pointer;
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
}

.job-scorer-option__check:checked {
  background: var(--color-primary-600, #3F7994);
  border-color: var(--color-primary-600, #3F7994);
}

.job-scorer-option__check:checked::after {
  content: "";
  width: 7px;
  height: 4px;
  border-left: 1.5px solid white;
  border-bottom: 1.5px solid white;
  transform: rotate(-45deg) translate(0, -1px);
}

.job-scorer-option__body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.job-scorer-option__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-scorer-option__meta {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}
</style>
