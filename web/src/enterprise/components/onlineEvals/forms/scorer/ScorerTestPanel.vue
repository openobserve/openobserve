<template>
  <aside class="eval-form-page__side eval-form-page__side--test p-0">
    <section class="eval-test-panel min-h-full p-5 bg-(--o2-card-bg) rounded-md shadow-[0_0_0.313rem_0.063rem_var(--o2-hover-shadow)]">
      <!-- Header -->
      <div class="flex flex-col gap-1">
        <h3 class="m-0 text-(--o2-text) text-sm font-bold">{{ t("onlineEvals.scorer.testPanel.title") }}</h3>
        <p class="m-0 text-(--o2-text-muted) text-xs leading-[1.45]">{{ t("onlineEvals.scorer.testPanel.hint") }}</p>
      </div>

      <!-- Variable inputs -->
      <div v-if="variables.length" class="eval-test-panel__fields flex flex-col gap-3">
        <div v-for="variable in variables" :key="variable" class="flex flex-col gap-[6px]">
          <label class="text-(--o2-text) font-semibold text-xs [font-family:var(--o2-font-mono)]">{{ formatTemplateVariable(variable) }}</label>
          <textarea
            :value="inputs[variable]"
            :rows="variable === 'metadata' ? 2 : 3"
            :placeholder="
              t('onlineEvals.scorer.testPanel.valuePlaceholder', {
                variable: formatTemplateVariable(variable),
              })
            "
            :data-test="`scorer-test-input-${variable}`"
            class="w-full box-border border border-(--o2-border-input) rounded bg-(--o2-card-bg-solid) text-(--o2-text) font-normal text-xs [font-family:var(--o2-font)] leading-normal py-2 px-[9px] [resize:vertical] max-h-[160px] overflow-y-auto"
            @input="
              updateInput(variable, ($event.target as HTMLTextAreaElement).value)
            "
          />
        </div>
      </div>
      <div v-else class="eval-test-panel__empty text-(--o2-text-muted) text-xs py-[10px] px-3 border border-(--o2-border) rounded-md bg-(--o2-card-bg-solid) [&_code]:[font-family:var(--o2-font-mono)] [&_code]:font-semibold [&_code]:text-(--o2-text)">
        {{ t("onlineEvals.scorer.testPanel.emptyPrefix") }}<code v-text="'{{ input }}'" />{{ t("onlineEvals.scorer.testPanel.emptySuffix") }}
      </div>

      <!-- Run -->
      <div class="eval-test-panel__actions flex flex-col items-start gap-[6px] mt-[14px]">
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
          class="text-[11px] italic text-(--o2-text-muted)"
          data-test="scorer-test-disabled-hint"
        >
          {{ t("onlineEvals.scorer.testPanel.disabledHint") }}
        </span>
      </div>

      <!-- Result — only shown once a test has run (no idle placeholder box). -->
      <div
        v-if="state !== 'idle'"
        class="flex flex-col gap-2 mt-4 p-3 border border-(--o2-border) rounded-md bg-(--o2-card-bg-solid) text-(--o2-text-muted) text-xs"
        :class="{ 'border-[color-mix(in_srgb,var(--o2-status-success-text)_35%,var(--o2-border))]': state === 'success', 'border-[color-mix(in_srgb,var(--o2-status-error-text)_35%,var(--o2-border))] text-(--o2-status-error-text)': state === 'error' }"
        data-test="scorer-test-result"
      >
        <template v-if="state === 'running'">
          <span class="text-(--o2-text-secondary)">{{ t("onlineEvals.scorer.testPanel.stateRunning") }}</span>
        </template>

        <template v-else-if="state === 'success' && result">
          <strong class="text-(--o2-text) text-[13px] font-semibold">{{ t("onlineEvals.scorer.testPanel.successHeader") }}</strong>
          <dl class="eval-test-panel__result-grid grid gap-x-3 gap-y-1 m-0 text-(--o2-text-secondary) text-xs" style="grid-template-columns: max-content 1fr">
            <template v-if="displayValue !== null">
              <dt class="text-(--o2-text-muted) font-medium">{{ t("onlineEvals.scorer.testPanel.resultScore") }}</dt>
              <dd class="eval-test-panel__result-score m-0 text-(--o2-text) font-bold text-[13px] [font-family:var(--o2-font-mono)]">{{ displayValue }}</dd>
            </template>
            <template v-if="latencyLabel">
              <dt class="text-(--o2-text-muted) font-medium">{{ t("onlineEvals.scorer.testPanel.resultLatency") }}</dt>
              <dd class="m-0 text-(--o2-text)">{{ latencyLabel }}</dd>
            </template>
            <template v-if="modelLabel">
              <dt class="text-(--o2-text-muted) font-medium">{{ t("onlineEvals.scorer.testPanel.resultModel") }}</dt>
              <dd class="eval-test-panel__result-mono m-0 text-(--o2-text) font-medium text-xs [font-family:var(--o2-font-mono)]">{{ modelLabel }}</dd>
            </template>
            <template v-if="tokensLabel">
              <dt class="text-(--o2-text-muted) font-medium">{{ t("onlineEvals.scorer.testPanel.resultTokens") }}</dt>
              <dd class="m-0 text-(--o2-text)">{{ tokensLabel }}</dd>
            </template>
          </dl>
          <details v-if="reasoningText" class="eval-test-panel__details border-t border-(--o2-border) pt-2 text-(--o2-text-secondary)">
            <summary class="cursor-pointer text-(--o2-text) text-xs font-semibold">{{ t("onlineEvals.scorer.testPanel.resultReasoning") }}</summary>
            <p class="m-0 mt-[6px] text-(--o2-text-secondary) font-normal text-[11.5px] [font-family:var(--o2-font-mono)] whitespace-pre-wrap break-words">{{ reasoningText }}</p>
          </details>
          <details v-if="rawResponseText" class="eval-test-panel__details border-t border-(--o2-border) pt-2 text-(--o2-text-secondary)">
            <summary class="cursor-pointer text-(--o2-text) text-xs font-semibold">{{ t("onlineEvals.scorer.testPanel.resultRaw") }}</summary>
            <pre class="m-0 mt-[6px] text-(--o2-text-secondary) font-normal text-[11.5px] [font-family:var(--o2-font-mono)] whitespace-pre-wrap break-words">{{ rawResponseText }}</pre>
          </details>
        </template>

        <template v-else>
          <strong class="text-[13px] font-semibold">{{ t("onlineEvals.scorer.testPanel.errorHeader") }}</strong>
          <p class="eval-test-panel__error-message m-0 text-(--o2-status-error-text) text-xs whitespace-pre-wrap break-words">{{ errorText }}</p>
          <p v-if="latencyLabel" class="eval-test-panel__error-meta m-0 text-(--o2-text-muted) text-[11.5px]">
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

<style>
/* :focus and ::placeholder cannot be expressed inline. */
.eval-test-panel textarea::placeholder {
  color: var(--o2-text-muted);
}

.eval-test-panel textarea:focus {
  outline: none;
  border-color: var(--color-primary-600, #3f7994);
}
</style>
