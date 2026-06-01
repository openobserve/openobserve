<template>
  <div class="eval-form-section__wide eval-scorer-picker">
    <div class="eval-form-field-head">
      <span>Scorers</span>
      <small>Select one or more scorers to run for every matched span.</small>
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
          <small>{{ scorerTypeOf(scorer).replace("_", " ") }} · v{{ scorer.version }}</small>
        </span>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Scorer } from "@/services/online-evals.service";
import { entityId, scorerTypeOf } from "../../utils/evalEntity";

defineProps<{
  scorers: Scorer[];
  selectedIds: string[];
}>();

defineEmits<{
  (e: "toggle", scorerId: string): void;
}>();
</script>
