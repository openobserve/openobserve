<template>
  <aside class="eval-form-page__side eval-form-page__side--test">
    <div class="ts">
      <!-- Header -->
      <div class="ts__head">
        <h3 class="ts__title">{{ t("onlineEvals.scorer.testPanel.title") }}</h3>
        <p class="ts__subtitle">{{ t("onlineEvals.scorer.testPanel.hint") }}</p>
      </div>

      <!-- Variable inputs -->
      <div v-if="variables.length" class="ts__fields">
        <div v-for="variable in variables" :key="variable" class="ts__field">
          <label class="ts__label">{{ formatTemplateVariable(variable) }}</label>
          <textarea
            class="ts__textarea"
            :value="inputs[variable]"
            :rows="variable === 'metadata' ? 2 : 3"
            :placeholder="
              t('onlineEvals.scorer.testPanel.valuePlaceholder', {
                variable: formatTemplateVariable(variable),
              })
            "
            :data-test="`scorer-test-input-${variable}`"
            @input="
              updateInput(variable, ($event.target as HTMLTextAreaElement).value)
            "
          />
        </div>
      </div>
      <div v-else class="ts__empty">
        {{ t("onlineEvals.scorer.testPanel.emptyPrefix")
        }}<code v-text="'{{ input }}'" />{{
          t("onlineEvals.scorer.testPanel.emptySuffix")
        }}
      </div>

      <!-- Run -->
      <div class="ts__actions">
        <OButton
          variant="primary"
          size="sm-action"
          :loading="state === 'running'"
          :disabled="state === 'running' || !canRun"
          :title="canRun ? undefined : t('onlineEvals.scorer.testPanel.disabledHint')"
          data-test="scorer-test-run-btn"
          @click="$emit('run')"
        >
          {{ t("onlineEvals.scorer.testPanel.runButton") }}
        </OButton>
        <span
          v-if="!canRun && state !== 'running'"
          class="ts__disabled-hint"
          data-test="scorer-test-disabled-hint"
        >
          {{ t("onlineEvals.scorer.testPanel.disabledHint") }}
        </span>
      </div>

      <!-- Result — only shown once a test has run (no idle placeholder box). -->
      <div
        v-if="state !== 'idle'"
        class="ts__result"
        :class="`is-${state}`"
        data-test="scorer-test-result"
      >
        <template v-if="state === 'running'">
          <span class="ts__result-running">{{
            t("onlineEvals.scorer.testPanel.stateRunning")
          }}</span>
        </template>

        <template v-else-if="state === 'success' && result">
          <strong class="ts__result-head">{{
            t("onlineEvals.scorer.testPanel.successHeader")
          }}</strong>
          <dl class="ts__grid">
            <template v-if="displayValue !== null">
              <dt>{{ t("onlineEvals.scorer.testPanel.resultScore") }}</dt>
              <dd class="ts__grid-score">{{ displayValue }}</dd>
            </template>
            <template v-if="latencyLabel">
              <dt>{{ t("onlineEvals.scorer.testPanel.resultLatency") }}</dt>
              <dd>{{ latencyLabel }}</dd>
            </template>
            <template v-if="modelLabel">
              <dt>{{ t("onlineEvals.scorer.testPanel.resultModel") }}</dt>
              <dd class="ts__grid-mono">{{ modelLabel }}</dd>
            </template>
            <template v-if="tokensLabel">
              <dt>{{ t("onlineEvals.scorer.testPanel.resultTokens") }}</dt>
              <dd>{{ tokensLabel }}</dd>
            </template>
          </dl>
          <details v-if="reasoningText" class="ts__details">
            <summary>{{ t("onlineEvals.scorer.testPanel.resultReasoning") }}</summary>
            <p>{{ reasoningText }}</p>
          </details>
          <details v-if="rawResponseText" class="ts__details">
            <summary>{{ t("onlineEvals.scorer.testPanel.resultRaw") }}</summary>
            <pre>{{ rawResponseText }}</pre>
          </details>
        </template>

        <template v-else>
          <strong class="ts__result-head">{{
            t("onlineEvals.scorer.testPanel.errorHeader")
          }}</strong>
          <p class="ts__error-message">{{ errorText }}</p>
          <p v-if="latencyLabel" class="ts__error-meta">
            {{ t("onlineEvals.scorer.testPanel.resultLatency") }}: {{ latencyLabel }}
          </p>
        </template>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
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
  return parts.length
    ? `${totalTokens.value} (${parts.join(", ")})`
    : String(totalTokens.value);
});

const errorText = computed(
  () =>
    props.errorMessage ||
    props.result?.error ||
    t("onlineEvals.scorer.testPanel.errorFallback"),
);
</script>

<style lang="scss" scoped>
// Right rail (AddAlert pattern): a left-border divider separates it from the
// form column. No floating-card bg/shadow.
.eval-form-page__side--test {
  flex: 3.5;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border-left: 1px solid var(--color-border-default, var(--o2-border));
  padding: 8px 10px;
}

.ts {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px 16px;
}

/* — Header — */
.ts__head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ts__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
}

.ts__subtitle {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

/* — Inputs — */
.ts__fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ts__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ts__label {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
}

.ts__textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 9px;
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 4px;
  background: var(--color-card-bg);
  color: var(--color-text-primary, currentColor);
  font-family: var(--font-sans);
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  max-height: 160px;
  overflow-y: auto;
}

.ts__textarea::placeholder {
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.ts__textarea:focus {
  outline: none;
  border-color: var(--color-primary-600, #3f7994);
}

.ts__empty {
  padding: 10px 12px;
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
  background: var(--color-card-bg);
  font-size: 12px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.ts__empty code {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
}

/* — Run — */
.ts__actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.ts__disabled-hint {
  font-size: 11px;
  font-style: italic;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

/* — Result — */
.ts__result {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
  background: var(--color-card-bg);
  font-size: 12px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.ts__result.is-success {
  border-color: color-mix(
    in srgb,
    var(--o2-status-success-text) 35%,
    var(--o2-border)
  );
}

.ts__result.is-error {
  border-color: color-mix(
    in srgb,
    var(--o2-status-error-text) 35%,
    var(--o2-border)
  );
}

.ts__result-running {
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.ts__result-head {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
}

.ts__result.is-error .ts__result-head {
  color: var(--o2-status-error-text);
}

.ts__grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 0;
}

.ts__grid dt {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-weight: 500;
}

.ts__grid dd {
  margin: 0;
  color: var(--color-text-primary, currentColor);
}

.ts__grid-score {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
}

.ts__grid-mono {
  font-family: var(--font-mono);
  font-size: 12px;
}

.ts__details {
  border-top: 1px solid var(--color-dialog-header-border, var(--o2-border));
  padding-top: 8px;
}

.ts__details summary {
  cursor: pointer;
  color: var(--color-text-primary, currentColor);
  font-size: 12px;
  font-weight: 600;
}

.ts__details p,
.ts__details pre {
  margin: 6px 0 0;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-family: var(--font-mono);
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-word;
}

.ts__error-message {
  margin: 0;
  color: var(--o2-status-error-text);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

.ts__error-meta {
  margin: 0;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-size: 11.5px;
}
</style>
