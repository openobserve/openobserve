<template>
  <aside
    class="eval-form-page__side eval-form-page__side--test max-[60rem]:border-border-default p-0 max-[60rem]:border-t max-[60rem]:border-l-0"
  >
    <section
      class="eval-test-panel bg-surface-base rounded-default min-h-full p-5 shadow-[0_0_0.313rem_0.063rem_var(--color-hover-shadow)]"
    >
      <!-- Header -->
      <div class="flex flex-col gap-1">
        <h3 class="text-text-heading m-0 text-sm font-bold">
          {{ t("onlineEvals.scorer.testPanel.title") }}
        </h3>
        <p class="text-text-secondary m-0 text-xs leading-[1.45]">
          {{ t("onlineEvals.scorer.testPanel.hint") }}
        </p>
      </div>

      <!-- Variable inputs -->
      <div v-if="variables.length" class="eval-test-panel__fields flex flex-col gap-3">
        <div v-for="variable in variables" :key="variable" class="flex flex-col gap-1.5">
          <label class="text-text-label font-mono text-xs font-semibold">{{
            formatTemplateVariable(variable)
          }}</label>
          <textarea
            :value="inputs[variable]"
            :rows="variable === 'metadata' ? 2 : 3"
            :placeholder="
              t('onlineEvals.scorer.testPanel.valuePlaceholder', {
                variable: formatTemplateVariable(variable),
              })
            "
            :data-test="`scorer-test-input-${variable}`"
            class="border-border-default rounded-default bg-surface-base text-text-body placeholder:text-text-muted focus:border-accent box-border max-h-40 w-full [resize:vertical] overflow-y-auto border px-2.25 py-2 font-sans text-xs leading-normal font-normal focus:outline-none"
            @input="updateInput(variable, ($event.target as HTMLTextAreaElement).value)"
          />
        </div>
      </div>
      <div
        v-else
        class="eval-test-panel__empty text-text-secondary border-border-default rounded-default bg-surface-base [&_code]:text-text-body border px-3 py-2.5 text-xs [&_code]:font-mono [&_code]:font-semibold"
      >
        {{ t("onlineEvals.scorer.testPanel.emptyPrefix") }}<code v-text="'{{ input }}'" />{{
          t("onlineEvals.scorer.testPanel.emptySuffix")
        }}
      </div>

      <!-- Run -->
      <div class="eval-test-panel__actions mt-3.5 flex flex-col items-start gap-1.5">
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
          class="text-2xs text-text-secondary italic"
          data-test="scorer-test-disabled-hint"
        >
          {{ t("onlineEvals.scorer.testPanel.disabledHint") }}
        </span>
      </div>

      <!-- Result — only shown once a test has run (no idle placeholder box). -->
      <div
        v-if="state !== 'idle'"
        class="border-border-default rounded-default bg-surface-base text-text-secondary mt-4 flex flex-col gap-2 border p-3 text-xs"
        :class="{
          'border-[color-mix(in_srgb,var(--color-status-success-text)_35%,var(--color-border-default))]':
            state === 'success',
          'text-status-error-text border-[color-mix(in_srgb,var(--color-status-error-text)_35%,var(--color-border-default))]':
            state === 'error',
        }"
        data-test="scorer-test-result"
      >
        <template v-if="state === 'running'">
          <span class="text-text-secondary">{{
            t("onlineEvals.scorer.testPanel.stateRunning")
          }}</span>
        </template>

        <template v-else-if="state === 'success' && result">
          <strong class="text-text-heading text-compact font-semibold">{{
            t("onlineEvals.scorer.testPanel.successHeader")
          }}</strong>
          <dl
            class="eval-test-panel__result-grid text-text-secondary m-0 grid gap-x-3 gap-y-1 text-xs"
            style="grid-template-columns: max-content 1fr"
          >
            <template v-if="displayValue !== null">
              <dt class="text-text-secondary font-medium">
                {{ t("onlineEvals.scorer.testPanel.resultScore") }}
              </dt>
              <dd
                class="eval-test-panel__result-score text-text-secondary text-compact m-0 font-mono font-bold"
              >
                {{ displayValue }}
              </dd>
            </template>
            <template v-if="latencyLabel">
              <dt class="text-text-secondary font-medium">
                {{ t("onlineEvals.scorer.testPanel.resultLatency") }}
              </dt>
              <dd class="text-text-body m-0">{{ latencyLabel }}</dd>
            </template>
            <template v-if="modelLabel">
              <dt class="text-text-secondary font-medium">
                {{ t("onlineEvals.scorer.testPanel.resultModel") }}
              </dt>
              <dd
                class="eval-test-panel__result-mono text-text-body m-0 font-mono text-xs font-medium"
              >
                {{ modelLabel }}
              </dd>
            </template>
            <template v-if="tokensLabel">
              <dt class="text-text-secondary font-medium">
                {{ t("onlineEvals.scorer.testPanel.resultTokens") }}
              </dt>
              <dd class="text-text-body m-0">{{ tokensLabel }}</dd>
            </template>
          </dl>
          <details
            v-if="reasoningText"
            class="eval-test-panel__details border-border-default text-text-secondary border-t pt-2"
          >
            <summary class="text-text-heading cursor-pointer text-xs font-semibold">
              {{ t("onlineEvals.scorer.testPanel.resultReasoning") }}
            </summary>
            <p
              class="text-text-secondary text-2xs m-0 mt-1.5 font-mono font-normal break-words whitespace-pre-wrap"
            >
              {{ reasoningText }}
            </p>
          </details>
          <details
            v-if="rawResponseText"
            class="eval-test-panel__details border-border-default text-text-secondary border-t pt-2"
          >
            <summary class="text-text-heading cursor-pointer text-xs font-semibold">
              {{ t("onlineEvals.scorer.testPanel.resultRaw") }}
            </summary>
            <pre
              class="text-text-secondary text-2xs m-0 mt-1.5 font-mono font-normal break-words whitespace-pre-wrap"
              >{{ rawResponseText }}</pre
            >
          </details>
        </template>

        <template v-else>
          <strong class="text-compact font-semibold">{{
            t("onlineEvals.scorer.testPanel.errorHeader")
          }}</strong>
          <p
            class="eval-test-panel__error-message text-status-error-text m-0 text-xs break-words whitespace-pre-wrap"
          >
            {{ errorText }}
          </p>
          <p
            v-if="latencyLabel"
            class="eval-test-panel__error-meta text-text-secondary text-2xs m-0"
          >
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

const numericValue = computed(() => pick(props.result?.valueNumeric, props.result?.value_numeric));
const booleanValue = computed(() => pick(props.result?.valueBoolean, props.result?.value_boolean));
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

const latencyMs = computed(() => pick(props.result?.latencyMs, props.result?.latency_ms));
const latencyLabel = computed(() => {
  const ms = latencyMs.value;
  if (ms == null) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
});

const modelLabel = computed(() => pick(props.result?.modelUsed, props.result?.model_used) ?? "");

const reasoningText = computed(() => props.result?.reasoning ?? "");
const rawResponseText = computed(
  () => pick(props.result?.rawResponse, props.result?.raw_response) ?? "",
);

const promptTokens = computed(() => pick(props.result?.promptTokens, props.result?.prompt_tokens));
const completionTokens = computed(() =>
  pick(props.result?.completionTokens, props.result?.completion_tokens),
);
const totalTokens = computed(() => pick(props.result?.totalTokens, props.result?.total_tokens));

const tokensLabel = computed(() => {
  if (totalTokens.value == null) return "";
  const parts: string[] = [];
  if (promptTokens.value != null) parts.push(`p:${promptTokens.value}`);
  if (completionTokens.value != null) parts.push(`c:${completionTokens.value}`);
  return parts.length ? `${totalTokens.value} (${parts.join(", ")})` : String(totalTokens.value);
});

const errorText = computed(
  () =>
    props.errorMessage || props.result?.error || t("onlineEvals.scorer.testPanel.errorFallback"),
);
</script>
