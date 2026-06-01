<template>
  <div
    class="eval-type-dialog"
    role="dialog"
    aria-modal="true"
    @click.self="$emit('close')"
  >
    <div class="eval-type-dialog__panel">
      <div class="eval-type-dialog__head">
        <h2>Create a new Scorer</h2>
        <OButton
          icon-left="close"
          variant="ghost"
          size="icon-sm"
          @click="$emit('close')"
        />
      </div>
      <p>Choose the scorer type. Pick whichever fits how you want to author and run it.</p>
      <div class="eval-type-dialog__cards">
        <button type="button" @click="$emit('select', 'llm_judge')">
          <OIcon name="smart-toy" size="sm" />
          <strong>LLM Judge</strong>
          <span>Use a configured provider to evaluate semantically.</span>
        </button>
        <button type="button" @click="$emit('select', 'remote')">
          <OIcon name="cloud" size="sm" />
          <strong>Remote</strong>
          <span>Call your own HTTP endpoint for scoring.</span>
        </button>
        <button type="button" disabled>
          <OIcon name="code" size="sm" />
          <strong>Code</strong>
          <span>Coming soon.</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { ScorerType } from "@/services/online-evals.service";

defineEmits<{
  (e: "close"): void;
  (e: "select", type: ScorerType): void;
}>();
</script>
