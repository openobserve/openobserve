<template>
  <aside class="eval-form-page__side eval-form-page__side--test">
    <section class="eval-test-panel">
      <h3>
        <OIcon name="play-arrow" size="xs" />
        {{ t("onlineEvals.scorer.testPanel.title") }}
      </h3>
      <p>{{ t("onlineEvals.scorer.testPanel.hint") }}</p>

      <div v-if="variables.length" class="eval-test-panel__fields">
        <label v-for="variable in variables" :key="variable">
          <code v-text="formatTemplateVariable(variable)" />
          <textarea
            :value="inputs[variable]"
            :rows="variable === 'metadata' ? 2 : 3"
            :placeholder="t('onlineEvals.scorer.testPanel.valuePlaceholder', { variable: formatTemplateVariable(variable) })"
            @input="updateInput(variable, ($event.target as HTMLTextAreaElement).value)"
          />
        </label>
      </div>

      <div v-else class="eval-test-panel__empty">
        {{ t("onlineEvals.scorer.testPanel.emptyPrefix") }}<code v-text="'{{ input }}'" />{{ t("onlineEvals.scorer.testPanel.emptySuffix") }}
      </div>

      <div class="eval-test-panel__actions">
        <OButton
          type="button"
          icon-left="play-arrow"
          :loading="state === 'running'"
          :disabled="variables.length === 0"
          @click="$emit('run')"
        >
          {{ t("onlineEvals.scorer.testPanel.runButton") }}
        </OButton>
      </div>

      <div class="eval-test-panel__result" :class="`is-${state}`">
        <template v-if="state === 'idle'">{{ t("onlineEvals.scorer.testPanel.stateIdle") }}</template>
        <template v-else-if="state === 'running'">{{ t("onlineEvals.scorer.testPanel.stateRunning") }}</template>
        <template v-else-if="state === 'success'">
          <strong>{{ t("onlineEvals.scorer.testPanel.successHeader") }}</strong>
          <span>{{ t("onlineEvals.scorer.testPanel.successScore") }}</span>
          <small>{{ t("onlineEvals.scorer.testPanel.successReasoning") }}</small>
        </template>
        <template v-else>
          <strong>{{ t("onlineEvals.scorer.testPanel.schemaHeader") }}</strong>
          <small>{{ t("onlineEvals.scorer.testPanel.schemaHint") }}</small>
        </template>
      </div>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { formatTemplateVariable } from "../../utils/evalFormat";

type TestState = "idle" | "running" | "success" | "error";

const props = defineProps<{
  variables: string[];
  inputs: Record<string, string>;
  state: TestState;
}>();

const emit = defineEmits<{
  (e: "run"): void;
  (e: "update:inputs", value: Record<string, string>): void;
}>();

const { t } = useI18n();

function updateInput(variable: string, value: string) {
  emit("update:inputs", { ...props.inputs, [variable]: value });
}
</script>

<style lang="scss" scoped>
.eval-form-page__side--test {
  padding: 0;
}

.eval-test-panel {
  min-height: 100%;
  padding: 20px;
  background-color: var(--o2-card-bg);
  border-radius: 0.375rem;
  box-shadow: 0 0 0.313rem 0.063rem var(--o2-hover-shadow);
}

.eval-test-panel h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  color: var(--o2-text);
  font-size: 14px;
  font-weight: 700;
}

.eval-test-panel p,
.eval-test-panel__empty,
.eval-test-panel__result {
  color: var(--o2-text-muted);
  font-size: 12px;
}

.eval-test-panel p {
  margin: 0 0 16px;
}

.eval-test-panel__fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.eval-test-panel label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.eval-test-panel code {
  color: var(--o2-text);
  font: 700 12px var(--o2-font-mono);
}

.eval-test-panel textarea,
.eval-test-panel select {
  border: 1px solid var(--o2-border-input);
  border-radius: 4px;
  background: var(--o2-card-bg-solid);
  color: var(--o2-text);
  font: 400 12px var(--o2-font);
}

.eval-test-panel textarea {
  padding: 8px 9px;
  resize: vertical;
  max-height: 160px;
  overflow-y: auto;
}

.eval-test-panel select {
  height: 32px;
  padding: 0 9px;
}

.eval-test-panel__empty {
  padding: 10px 12px;
  border: 1px solid var(--o2-border);
  border-radius: 6px;
  background: var(--o2-card-bg-solid);
}

.eval-test-panel__actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: 8px;
  margin-top: 14px;
}

.eval-test-panel__result {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 84px;
  margin-top: 16px;
  padding: 12px;
  border: 1px solid var(--o2-border);
  border-radius: 6px;
  background: var(--o2-card-bg-solid);
}

.eval-test-panel__result.is-success {
  border-color: color-mix(in srgb, var(--o2-status-success-text) 35%, var(--o2-border));
  color: var(--o2-status-success-text);
}

.eval-test-panel__result.is-error {
  border-color: color-mix(in srgb, var(--o2-status-error-text) 35%, var(--o2-border));
  color: var(--o2-status-error-text);
}

.eval-test-panel__result strong {
  color: var(--o2-text);
  font-size: 13px;
}

.eval-test-panel__result span,
.eval-test-panel__result small {
  color: var(--o2-text-secondary);
}
</style>
