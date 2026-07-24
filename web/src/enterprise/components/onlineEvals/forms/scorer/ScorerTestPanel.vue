<template>
  <aside class="eval-form-page__side eval-form-page__side--test p-0 max-[60rem]:border-l-0 max-[60rem]:border-t max-[60rem]:border-border-default">
    <section class="eval-test-panel min-h-full p-5 bg-surface-base rounded-default shadow-[0_0_0.313rem_0.063rem_var(--color-hover-shadow)]">
      <!-- Header -->
      <div class="flex flex-col gap-1">
        <h3 class="m-0 text-text-heading text-sm font-bold">{{ t("onlineEvals.scorer.testPanel.title") }}</h3>
        <p class="m-0 text-text-secondary text-xs leading-[1.45]">{{ t("onlineEvals.scorer.testPanel.hint") }}</p>
      </div>

      <!-- Variable inputs -->
      <div v-if="variables.length" class="eval-test-panel__fields flex flex-col gap-3">
        <div v-for="variable in variables" :key="variable" class="flex flex-col gap-1.5">
          <label class="text-text-label font-semibold text-xs font-mono">{{ formatTemplateVariable(variable) }}</label>
          <textarea
            :value="inputs[variable]"
            :rows="variable === 'metadata' ? 2 : 3"
            :placeholder="
              t('onlineEvals.scorer.testPanel.valuePlaceholder', {
                variable: formatTemplateVariable(variable),
              })
            "
            :data-test="`scorer-test-input-${variable}`"
            class="w-full box-border border border-border-default rounded-default bg-surface-base text-text-body font-normal text-xs font-sans leading-normal py-2 px-2.25 [resize:vertical] max-h-40 overflow-y-auto placeholder:text-text-muted focus:outline-none focus:border-accent"
            @input="
              updateInput(variable, ($event.target as HTMLTextAreaElement).value)
            "
          />
        </div>
      </div>
      <div v-else class="eval-test-panel__empty text-text-secondary text-xs py-2.5 px-3 border border-border-default rounded-default bg-surface-base [&_code]:font-mono [&_code]:font-semibold [&_code]:text-text-body">
        <!-- eslint-disable-next-line local/no-bare-bound-text-props, vue/no-bare-strings-in-template -- literal "{{ input }}" is documented template syntax shown in a <code> block, not translatable text -->
        {{ t("onlineEvals.scorer.testPanel.emptyPrefix") }}<code v-text="'{{ input }}'" />{{ t("onlineEvals.scorer.testPanel.emptySuffix") }}
      </div>

      <!-- Run -->
      <div class="eval-test-panel__actions flex flex-col items-start gap-1.5 mt-3.5">
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
          class="text-2xs italic text-text-secondary"
          data-test="scorer-test-disabled-hint"
        >
          {{ t("onlineEvals.scorer.testPanel.disabledHint") }}
        </span>
      </div>

      <!-- Result — only shown once a test has run (no idle placeholder box). -->
      <div
        v-if="state !== 'idle'"
        class="flex flex-col gap-2 mt-4 p-3 border border-border-default rounded-default bg-surface-base text-text-secondary text-xs"
        :class="{ 'border-[color-mix(in_srgb,var(--color-status-success-text)_35%,var(--color-border-default))]': state === 'success', 'border-[color-mix(in_srgb,var(--color-status-error-text)_35%,var(--color-border-default))] text-status-error-text': state === 'error' }"
        data-test="scorer-test-result"
      >
        <template v-if="state === 'running'">
          <span class="text-text-secondary">{{ t("onlineEvals.scorer.testPanel.stateRunning") }}</span>
        </template>

        <template v-else-if="state === 'success' && result">
          <strong class="text-text-heading text-compact font-semibold">{{ t("onlineEvals.scorer.testPanel.successHeader") }}</strong>
          <dl class="eval-test-panel__result-grid grid gap-x-3 gap-y-1 m-0 text-text-secondary text-xs" style="grid-template-columns: max-content 1fr">
            <template v-if="displayValue !== null">
              <dt class="text-text-secondary font-medium">{{ t("onlineEvals.scorer.testPanel.resultScore") }}</dt>
              <dd class="eval-test-panel__result-score m-0 text-text-secondary font-bold text-compact font-mono">{{ displayValue }}</dd>
            </template>
            <template v-if="latencyLabel">
              <dt class="text-text-secondary font-medium">{{ t("onlineEvals.scorer.testPanel.resultLatency") }}</dt>
              <dd class="m-0 text-text-body">{{ latencyLabel }}</dd>
            </template>
            <template v-if="modelLabel">
              <dt class="text-text-secondary font-medium">{{ t("onlineEvals.scorer.testPanel.resultModel") }}</dt>
              <dd class="eval-test-panel__result-mono m-0 text-text-body font-medium text-xs font-mono">{{ modelLabel }}</dd>
            </template>
            <template v-if="tokensLabel">
              <dt class="text-text-secondary font-medium">{{ t("onlineEvals.scorer.testPanel.resultTokens") }}</dt>
              <dd class="m-0 text-text-body">{{ tokensLabel }}</dd>
            </template>
          </dl>
          <details v-if="reasoningText" class="eval-test-panel__details border-t border-border-default pt-2 text-text-secondary">
            <summary class="cursor-pointer text-text-heading text-xs font-semibold">{{ t("onlineEvals.scorer.testPanel.resultReasoning") }}</summary>
            <p class="m-0 mt-1.5 text-text-secondary font-normal text-2xs font-mono whitespace-pre-wrap break-words">{{ reasoningText }}</p>
          </details>
          <details v-if="rawResponseText" class="eval-test-panel__details border-t border-border-default pt-2 text-text-secondary">
            <summary class="cursor-pointer text-text-heading text-xs font-semibold">{{ t("onlineEvals.scorer.testPanel.resultRaw") }}</summary>
            <pre class="m-0 mt-1.5 text-text-secondary font-normal text-2xs font-mono whitespace-pre-wrap break-words">{{ rawResponseText }}</pre>
          </details>
        </template>

        <template v-else>
          <strong class="text-compact font-semibold">{{ t("onlineEvals.scorer.testPanel.errorHeader") }}</strong>
          <p class="eval-test-panel__error-message m-0 text-status-error-text text-xs whitespace-pre-wrap break-words">{{ errorText }}</p>
          <p v-if="latencyLabel" class="eval-test-panel__error-meta m-0 text-text-secondary text-2xs">
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
