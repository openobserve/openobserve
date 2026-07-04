<template>
  <aside class="eval-form-page__side eval-form-page__side--test tw:p-0">
    <section class="eval-test-panel tw:min-h-full tw:p-5 tw:bg-(--o2-card-bg) tw:rounded-md tw:shadow-[0_0_0.313rem_0.063rem_var(--o2-hover-shadow)]">
      <!-- Header -->
      <div class="tw:flex tw:flex-col tw:gap-1">
        <h3 class="tw:m-0 tw:text-(--o2-text) tw:text-sm tw:font-bold">{{ t("onlineEvals.scorer.testPanel.title") }}</h3>
        <p class="tw:m-0 tw:text-(--o2-text-muted) tw:text-xs tw:leading-[1.45]">{{ t("onlineEvals.scorer.testPanel.hint") }}</p>
      </div>

      <!-- Variable inputs -->
      <div v-if="variables.length" class="eval-test-panel__fields tw:flex tw:flex-col tw:gap-3">
        <div v-for="variable in variables" :key="variable" class="tw:flex tw:flex-col tw:gap-[6px]">
          <label class="tw:text-(--o2-text) tw:font-semibold tw:text-xs tw:[font-family:var(--o2-font-mono)]">{{ formatTemplateVariable(variable) }}</label>
          <textarea
            :value="inputs[variable]"
            :rows="variable === 'metadata' ? 2 : 3"
            :placeholder="
              t('onlineEvals.scorer.testPanel.valuePlaceholder', {
                variable: formatTemplateVariable(variable),
              })
            "
            :data-test="`scorer-test-input-${variable}`"
            class="tw:w-full tw:box-border tw:border tw:border-(--o2-border-input) tw:rounded tw:bg-(--o2-card-bg-solid) tw:text-(--o2-text) tw:font-normal tw:text-xs tw:[font-family:var(--o2-font)] tw:leading-normal tw:py-2 tw:px-[9px] tw:[resize:vertical] tw:max-h-[160px] tw:overflow-y-auto"
            @input="
              updateInput(variable, ($event.target as HTMLTextAreaElement).value)
            "
          />
        </div>
      </div>
      <div v-else class="eval-test-panel__empty tw:text-(--o2-text-muted) tw:text-xs tw:py-[10px] tw:px-3 tw:border tw:border-(--o2-border) tw:rounded-md tw:bg-(--o2-card-bg-solid) [&_code]:tw:[font-family:var(--o2-font-mono)] [&_code]:tw:font-semibold [&_code]:tw:text-(--o2-text)">
        {{ t("onlineEvals.scorer.testPanel.emptyPrefix") }}<code v-text="'{{ input }}'" />{{ t("onlineEvals.scorer.testPanel.emptySuffix") }}
      </div>

      <!-- Run -->
      <div class="eval-test-panel__actions tw:flex tw:flex-col tw:items-start tw:gap-[6px] tw:mt-[14px]">
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
          class="tw:text-[11px] tw:italic tw:text-(--o2-text-muted)"
          data-test="scorer-test-disabled-hint"
        >
          {{ t("onlineEvals.scorer.testPanel.disabledHint") }}
        </span>
      </div>

      <!-- Result — only shown once a test has run (no idle placeholder box). -->
      <div
        v-if="state !== 'idle'"
        class="tw:flex tw:flex-col tw:gap-2 tw:mt-4 tw:p-3 tw:border tw:border-(--o2-border) tw:rounded-md tw:bg-(--o2-card-bg-solid) tw:text-(--o2-text-muted) tw:text-xs"
        :class="{ 'tw:border-[color-mix(in_srgb,var(--o2-status-success-text)_35%,var(--o2-border))]': state === 'success', 'tw:border-[color-mix(in_srgb,var(--o2-status-error-text)_35%,var(--o2-border))] tw:text-(--o2-status-error-text)': state === 'error' }"
        data-test="scorer-test-result"
      >
        <template v-if="state === 'running'">
          <span class="tw:text-(--o2-text-secondary)">{{ t("onlineEvals.scorer.testPanel.stateRunning") }}</span>
        </template>

        <template v-else-if="state === 'success' && result">
          <strong class="tw:text-(--o2-text) tw:text-[13px] tw:font-semibold">{{ t("onlineEvals.scorer.testPanel.successHeader") }}</strong>
          <dl class="eval-test-panel__result-grid tw:grid tw:gap-x-3 tw:gap-y-1 tw:m-0 tw:text-(--o2-text-secondary) tw:text-xs" style="grid-template-columns: max-content 1fr">
            <template v-if="displayValue !== null">
              <dt class="tw:text-(--o2-text-muted) tw:font-medium">{{ t("onlineEvals.scorer.testPanel.resultScore") }}</dt>
              <dd class="eval-test-panel__result-score tw:m-0 tw:text-(--o2-text) tw:font-bold tw:text-[13px] tw:[font-family:var(--o2-font-mono)]">{{ displayValue }}</dd>
            </template>
            <template v-if="latencyLabel">
              <dt class="tw:text-(--o2-text-muted) tw:font-medium">{{ t("onlineEvals.scorer.testPanel.resultLatency") }}</dt>
              <dd class="tw:m-0 tw:text-(--o2-text)">{{ latencyLabel }}</dd>
            </template>
            <template v-if="modelLabel">
              <dt class="tw:text-(--o2-text-muted) tw:font-medium">{{ t("onlineEvals.scorer.testPanel.resultModel") }}</dt>
              <dd class="eval-test-panel__result-mono tw:m-0 tw:text-(--o2-text) tw:font-medium tw:text-xs tw:[font-family:var(--o2-font-mono)]">{{ modelLabel }}</dd>
            </template>
            <template v-if="tokensLabel">
              <dt class="tw:text-(--o2-text-muted) tw:font-medium">{{ t("onlineEvals.scorer.testPanel.resultTokens") }}</dt>
              <dd class="tw:m-0 tw:text-(--o2-text)">{{ tokensLabel }}</dd>
            </template>
          </dl>
          <details v-if="reasoningText" class="eval-test-panel__details tw:border-t tw:border-(--o2-border) tw:pt-2 tw:text-(--o2-text-secondary)">
            <summary class="tw:cursor-pointer tw:text-(--o2-text) tw:text-xs tw:font-semibold">{{ t("onlineEvals.scorer.testPanel.resultReasoning") }}</summary>
            <p class="tw:m-0 tw:mt-[6px] tw:text-(--o2-text-secondary) tw:font-normal tw:text-[11.5px] tw:[font-family:var(--o2-font-mono)] tw:whitespace-pre-wrap tw:break-words">{{ reasoningText }}</p>
          </details>
          <details v-if="rawResponseText" class="eval-test-panel__details tw:border-t tw:border-(--o2-border) tw:pt-2 tw:text-(--o2-text-secondary)">
            <summary class="tw:cursor-pointer tw:text-(--o2-text) tw:text-xs tw:font-semibold">{{ t("onlineEvals.scorer.testPanel.resultRaw") }}</summary>
            <pre class="tw:m-0 tw:mt-[6px] tw:text-(--o2-text-secondary) tw:font-normal tw:text-[11.5px] tw:[font-family:var(--o2-font-mono)] tw:whitespace-pre-wrap tw:break-words">{{ rawResponseText }}</pre>
          </details>
        </template>

        <template v-else>
          <strong class="tw:text-[13px] tw:font-semibold">{{ t("onlineEvals.scorer.testPanel.errorHeader") }}</strong>
          <p class="eval-test-panel__error-message tw:m-0 tw:text-(--o2-status-error-text) tw:text-xs tw:whitespace-pre-wrap tw:break-words">{{ errorText }}</p>
          <p v-if="latencyLabel" class="eval-test-panel__error-meta tw:m-0 tw:text-(--o2-text-muted) tw:text-[11.5px]">
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
