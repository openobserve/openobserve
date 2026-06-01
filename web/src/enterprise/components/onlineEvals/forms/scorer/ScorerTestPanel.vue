<template>
  <aside class="eval-form-page__side eval-form-page__side--test">
    <section class="eval-test-panel">
      <h3>
        <OIcon name="play-arrow" size="xs" />
        Test this scorer
      </h3>
      <p>Try your scorer with sample data before saving. Test runs are not persisted.</p>

      <div v-if="variables.length" class="eval-test-panel__fields">
        <label v-for="variable in variables" :key="variable">
          <code v-text="formatTemplateVariable(variable)" />
          <textarea
            :value="inputs[variable]"
            :rows="variable === 'metadata' ? 2 : 3"
            :placeholder="`Value for {{ ${variable} }}`"
            @input="updateInput(variable, ($event.target as HTMLTextAreaElement).value)"
          />
        </label>
      </div>

      <div v-else class="eval-test-panel__empty">
        Add variables like <code v-text="'{{ input }}'" /> to the scorer template to test with sample fields.
      </div>

      <div class="eval-test-panel__actions">
        <OButton
          type="button"
          icon-left="play-arrow"
          :loading="state === 'running'"
          :disabled="variables.length === 0"
          @click="$emit('run')"
        >
          Run test
        </OButton>
        <select
          :value="scenario"
          @change="$emit('update:scenario', ($event.target as HTMLSelectElement).value as TestScenario)"
        >
          <option value="success">Mock response</option>
          <option value="auth">Auth error</option>
          <option value="schema">Schema mismatch</option>
        </select>
      </div>

      <div class="eval-test-panel__result" :class="`is-${state}`">
        <template v-if="state === 'idle'">Run a test to see the result here.</template>
        <template v-else-if="state === 'running'">Running scorer test...</template>
        <template v-else-if="state === 'success'">
          <strong>Success</strong>
          <span>score: 0.92</span>
          <small>reasoning: The answer is supported by the supplied context.</small>
        </template>
        <template v-else>
          <strong>{{ scenario === "auth" ? "Authentication failed" : "Schema mismatch" }}</strong>
          <small>{{
            scenario === "auth"
              ? "Check provider credentials before saving."
              : "The response did not match the configured output schema."
          }}</small>
        </template>
      </div>
    </section>
  </aside>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { formatTemplateVariable } from "../../utils/evalFormat";

type TestScenario = "success" | "auth" | "schema";
type TestState = "idle" | "running" | "success" | "error";

const props = defineProps<{
  variables: string[];
  inputs: Record<string, string>;
  scenario: TestScenario;
  state: TestState;
}>();

const emit = defineEmits<{
  (e: "run"): void;
  (e: "update:scenario", value: TestScenario): void;
  (e: "update:inputs", value: Record<string, string>): void;
}>();

function updateInput(variable: string, value: string) {
  emit("update:inputs", { ...props.inputs, [variable]: value });
}
</script>
