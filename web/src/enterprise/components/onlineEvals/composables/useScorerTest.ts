import { ref, watch, type Ref } from "vue";
import type { TranslateFn } from "@/types/i18n";
import onlineEvalsService, {
  type ScorerTestPayload,
  type ScorerTestResult,
} from "@/services/online-evals.service";
import { defaultTestValue, extractTemplateVariables } from "../utils/evalFormat";

export type ScorerTestState = "idle" | "running" | "success" | "error";

export function useScorerTest(template: Ref<string>, t: TranslateFn) {
  const scorerTestInputs = ref<Record<string, string>>({
    input: t("onlineEvals.scorerTestSampleInput"),
    output: t("onlineEvals.scorerTestSampleOutput"),
    metadata: "{}",
  });
  const scorerTestState = ref<ScorerTestState>("idle");
  const scorerTestVariables = ref<string[]>([]);
  const scorerTestResult = ref<ScorerTestResult | null>(null);
  const scorerTestError = ref<string | null>(null);

  watch(
    template,
    (value) => {
      const variables = extractTemplateVariables(value || "");
      scorerTestVariables.value = variables;

      const next = { ...scorerTestInputs.value };
      variables.forEach((variable) => {
        if (next[variable] === undefined) next[variable] = defaultTestValue(variable, t);
      });
      scorerTestInputs.value = next;
      scorerTestState.value = "idle";
      scorerTestResult.value = null;
      scorerTestError.value = null;
    },
    { immediate: true },
  );

  async function runScorerTest(orgId: string, payload: ScorerTestPayload) {
    scorerTestState.value = "running";
    scorerTestResult.value = null;
    scorerTestError.value = null;
    try {
      const data = await onlineEvalsService.scorers.test(orgId, payload);
      scorerTestResult.value = data;
      // Backend returns `success: false` with an `error` field for runtime
      // failures (LLM call rejected, parse failure, etc.) but still HTTP 200.
      scorerTestState.value = data?.success ? "success" : "error";
      if (!data?.success) {
        scorerTestError.value = data?.error ?? t("onlineEvals.scorerTestFailed");
      }
    } catch (err: any) {
      // HTTP-level failure (400 / 5xx / network). Surface the server message
      // when available so the user can act on it.
      const body = err?.response?.data ?? {};
      scorerTestError.value =
        body.message || body.error || err?.message || t("onlineEvals.failedToRunScorerTest");
      scorerTestState.value = "error";
    }
  }

  return {
    scorerTestInputs,
    scorerTestState,
    scorerTestVariables,
    scorerTestResult,
    scorerTestError,
    runScorerTest,
  };
}
