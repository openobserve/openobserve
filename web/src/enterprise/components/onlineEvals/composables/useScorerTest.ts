import { ref, watch, type Ref } from "vue";
import { defaultTestValue, extractTemplateVariables } from "../utils/evalFormat";

export function useScorerTest(template: Ref<string>) {
  const scorerTestInputs = ref<Record<string, string>>({
    input: "The capital of France is Paris, located on the Seine river.",
    output: "Paris is the capital of France.",
    metadata: "{}",
  });
  const scorerTestScenario = ref<"success" | "auth" | "schema">("success");
  const scorerTestState = ref<"idle" | "running" | "success" | "error">("idle");

  const scorerTestVariables = ref<string[]>([]);

  watch(
    template,
    (value) => {
      const variables = extractTemplateVariables(value || "");
      scorerTestVariables.value = variables;

      const next = { ...scorerTestInputs.value };
      variables.forEach((variable) => {
        if (next[variable] === undefined) next[variable] = defaultTestValue(variable);
      });
      scorerTestInputs.value = next;
      scorerTestState.value = "idle";
    },
    { immediate: true },
  );

  function runScorerTest() {
    scorerTestState.value = "running";
    window.setTimeout(() => {
      scorerTestState.value =
        scorerTestScenario.value === "success" ? "success" : "error";
    }, 450);
  }

  return {
    scorerTestInputs,
    scorerTestScenario,
    scorerTestState,
    scorerTestVariables,
    runScorerTest,
  };
}
