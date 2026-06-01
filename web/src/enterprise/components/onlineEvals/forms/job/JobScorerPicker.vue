<template>
  <div class="eval-form-section__wide eval-scorer-picker">
    <div class="eval-form-field-head">
      <span>{{ t("onlineEvals.job.scorerPicker.title") }}</span>
      <small>{{ t("onlineEvals.job.scorerPicker.hint") }}</small>
    </div>
    <div class="eval-scorer-picker__grid">
      <label
        v-for="scorer in scorers"
        :key="entityId(scorer)"
        class="eval-scorer-option"
        :class="{ 'is-selected': selectedIds.includes(entityId(scorer)) }"
      >
        <input
          type="checkbox"
          :checked="selectedIds.includes(entityId(scorer))"
          @change="$emit('toggle', entityId(scorer))"
        />
        <span>
          <strong>{{ scorer.name }}</strong>
          <small>{{
            t("onlineEvals.job.scorerPicker.meta", {
              type: scorerTypeOf(scorer).replace("_", " "),
              version: scorer.version,
            })
          }}</small>
        </span>
      </label>
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
