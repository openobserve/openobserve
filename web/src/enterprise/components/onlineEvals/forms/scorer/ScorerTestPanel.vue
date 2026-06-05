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
          :disabled="state === 'running' || !canRun"
          :title="canRun ? undefined : t('onlineEvals.scorer.testPanel.disabledHint')"
          data-test="scorer-test-run-btn"
          @click="$emit('run')"
        >
          {{ t("onlineEvals.scorer.testPanel.runButton") }}
        </OButton>
      </div>

      <p
        v-if="!canRun && state !== 'running'"
        class="eval-test-panel__disabled-hint"
        data-test="scorer-test-disabled-hint"
      >
        {{ t("onlineEvals.scorer.testPanel.disabledHint") }}
      </p>

      <div class="eval-test-panel__result" :class="`is-${state}`" data-test="scorer-test-result">
        <template v-if="state === 'idle'">
          {{ t("onlineEvals.scorer.testPanel.stateIdle") }}
        </template>

        <template v-else-if="state === 'running'">
          {{ t("onlineEvals.scorer.testPanel.stateRunning") }}
        </template>

        <template v-else-if="state === 'success' && result">
          <strong>{{ t("onlineEvals.scorer.testPanel.successHeader") }}</strong>
          <dl class="eval-test-panel__result-grid">
            <template v-if="displayValue !== null">
              <dt>{{ t("onlineEvals.scorer.testPanel.resultScore") }}</dt>
              <dd class="eval-test-panel__result-score">{{ displayValue }}</dd>
            </template>
            <template v-if="latencyLabel">
              <dt>{{ t("onlineEvals.scorer.testPanel.resultLatency") }}</dt>
              <dd>{{ latencyLabel }}</dd>
            </template>
            <template v-if="modelLabel">
              <dt>{{ t("onlineEvals.scorer.testPanel.resultModel") }}</dt>
              <dd class="eval-test-panel__result-mono">{{ modelLabel }}</dd>
            </template>
            <template v-if="tokensLabel">
              <dt>{{ t("onlineEvals.scorer.testPanel.resultTokens") }}</dt>
              <dd>{{ tokensLabel }}</dd>
            </template>
          </dl>
          <details v-if="reasoningText" class="eval-test-panel__details">
            <summary>{{ t("onlineEvals.scorer.testPanel.resultReasoning") }}</summary>
            <p>{{ reasoningText }}</p>
          </details>
          <details v-if="rawResponseText" class="eval-test-panel__details">
            <summary>{{ t("onlineEvals.scorer.testPanel.resultRaw") }}</summary>
            <pre>{{ rawResponseText }}</pre>
          </details>
        </template>

        <template v-else>
          <strong>{{ t("onlineEvals.scorer.testPanel.errorHeader") }}</strong>
          <p class="eval-test-panel__error-message">{{ errorText }}</p>
          <p v-if="latencyLabel" class="eval-test-panel__error-meta">
            {{ t("onlineEvals.scorer.testPanel.resultLatency") }}: {{ latencyLabel }}
          </p>
        </template>
      </div>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { ScorerTestResult } from "@/services/online-evals.service";
import { formatTemplateVariable } from "../../utils/evalFormat";

type TestState = "idle" | "running" | "success" | "error";

const props = defineProps<{
  variables: string[];
  inputs: Record<string, string>;
  state: TestState;
  result: ScorerTestResult | null;
  errorMessage: string | null;
  canRun: boolean;
}>();

const emit = defineEmits<{
  (e: "run"): void;
  (e: "update:inputs", value: Record<string, string>): void;
}>();

const { t } = useI18n();

function updateInput(variable: string, value: string) {
  emit("update:inputs", { ...props.inputs, [variable]: value });
}

function pick<T>(camel: T | undefined, snake: T | undefined): T | null {
  if (camel !== undefined && camel !== null) return camel;
  if (snake !== undefined && snake !== null) return snake;
  return null;
}

const numericValue = computed(() =>
  pick(props.result?.valueNumeric, props.result?.value_numeric),
);
const booleanValue = computed(() =>
  pick(props.result?.valueBoolean, props.result?.value_boolean),
);
const categoricalValue = computed(() =>
  pick(props.result?.valueCategorical, props.result?.value_categorical),
);

const displayValue = computed<string | null>(() => {
  if (numericValue.value !== null) {
    return Number(numericValue.value).toFixed(2);
  }
  if (booleanValue.value !== null) return String(booleanValue.value);
  if (categoricalValue.value !== null) return String(categoricalValue.value);
  return null;
});

const latencyMs = computed(() =>
  pick(props.result?.latencyMs, props.result?.latency_ms),
);
const latencyLabel = computed(() => {
  const ms = latencyMs.value;
  if (ms == null) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
});

const modelLabel = computed(() =>
  pick(props.result?.modelUsed, props.result?.model_used) ?? "",
);

const reasoningText = computed(() => props.result?.reasoning ?? "");
const rawResponseText = computed(
  () => pick(props.result?.rawResponse, props.result?.raw_response) ?? "",
);

const promptTokens = computed(() =>
  pick(props.result?.promptTokens, props.result?.prompt_tokens),
);
const completionTokens = computed(() =>
  pick(props.result?.completionTokens, props.result?.completion_tokens),
);
const totalTokens = computed(() =>
  pick(props.result?.totalTokens, props.result?.total_tokens),
);

const tokensLabel = computed(() => {
  if (totalTokens.value == null) return "";
  const parts: string[] = [];
  if (promptTokens.value != null) parts.push(`p:${promptTokens.value}`);
  if (completionTokens.value != null) parts.push(`c:${completionTokens.value}`);
  return parts.length ? `${totalTokens.value} (${parts.join(", ")})` : String(totalTokens.value);
});

const errorText = computed(
  () => props.errorMessage || props.result?.error || t("onlineEvals.scorer.testPanel.errorFallback"),
);
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

.eval-test-panel__disabled-hint {
  margin: 6px 0 0;
  font-size: 11px;
  font-style: italic;
  color: var(--o2-text-muted);
}

.eval-test-panel__result {
  display: flex;
  flex-direction: column;
  gap: 8px;
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

.eval-test-panel__result-grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 0;
  color: var(--o2-text-secondary);
  font-size: 12px;
}

.eval-test-panel__result-grid dt {
  color: var(--o2-text-muted);
  font-weight: 500;
}

.eval-test-panel__result-grid dd {
  margin: 0;
  color: var(--o2-text);
}

.eval-test-panel__result-score {
  font: 700 13px var(--o2-font-mono);
}

.eval-test-panel__result-mono {
  font: 500 12px var(--o2-font-mono);
}

.eval-test-panel__details {
  border-top: 1px solid var(--o2-border);
  padding-top: 8px;
  color: var(--o2-text-secondary);
}

.eval-test-panel__details summary {
  cursor: pointer;
  color: var(--o2-text);
  font-size: 12px;
  font-weight: 600;
}

.eval-test-panel__details p,
.eval-test-panel__details pre {
  margin: 6px 0 0;
  color: var(--o2-text-secondary);
  font: 400 11.5px var(--o2-font-mono);
  white-space: pre-wrap;
  word-break: break-word;
}

.eval-test-panel__error-message {
  margin: 0;
  color: var(--o2-status-error-text);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

.eval-test-panel__error-meta {
  margin: 0;
  color: var(--o2-text-muted);
  font-size: 11.5px;
}
</style>
