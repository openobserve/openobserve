import type { EvalTargetScope, Scorer } from "@/services/online-evals.service";
import { entityId } from "./evalEntity";
import { extractTemplateVariables } from "./evalFormat";
import { isSystemProvidedVariable } from "./systemProvidedVariables";

export function scorerTemplateVariables(scorer: Scorer) {
  return [
    ...new Set([
      ...((scorer.variables || []) as string[]),
      ...extractTemplateVariables(scorer.template || ""),
    ]),
  ];
}

export function defaultJobMappingValue(variable: string) {
  const defaults: Record<string, string> = {
    input: "{{gen_ai_input_messages}}",
    output: "{{gen_ai_output_messages}}",
    context: "{{gen_ai_system_instructions}}",
    metadata: "{{attributes}}",
    "trace.id": "{{trace_id}}",
    "span.id": "{{span_id}}",
    trace_id: "{{trace_id}}",
    span_id: "{{span_id}}",
    session_id: "{{session_id}}",
  };

  return defaults[variable] || `{{${variable.replace(/\./g, "_")}}}`;
}

export function jobMappingVariablesForScorer(
  scorer: Scorer,
  existingMapping: Record<string, string> | undefined,
) {
  return [...new Set([...scorerTemplateVariables(scorer), ...Object.keys(existingMapping || {})])];
}

export function buildJobInputMappingPayload(
  scorerIds: string[],
  inputMappings: Record<string, Record<string, string>>,
  targetScope: EvalTargetScope = "span",
) {
  const payload: Record<string, Record<string, string>> = {};

  scorerIds.forEach((scorerId) => {
    const cleanMapping = Object.fromEntries(
      Object.entries(inputMappings[scorerId] || {})
        .map(([key, value]) => [key.trim(), value.trim()])
        .filter(
          ([key, value]) =>
            key && value && !isSystemProvidedVariable(targetScope, key),
        ),
    );

    if (Object.keys(cleanMapping).length) payload[scorerId] = cleanMapping;
  });

  return Object.keys(payload).length ? payload : null;
}

export function normalizeJobInputMappings(
  value: any,
  selectedScorerIds: string[],
) {
  const parsedValue = parseMaybeJson(value);
  if (
    !parsedValue ||
    typeof parsedValue !== "object" ||
    Array.isArray(parsedValue)
  )
    return {};

  const entries = Object.entries(parsedValue);
  const hasPerScorerShape = entries.some(
    ([, mapping]) =>
      mapping &&
      typeof mapping === "object" &&
      !Array.isArray(mapping) &&
      Object.values(mapping).every(
        (fieldValue) => typeof fieldValue === "string",
      ),
  );

  if (hasPerScorerShape) {
    return Object.fromEntries(
      entries
        .filter(([, mapping]) => mapping && typeof mapping === "object" && !Array.isArray(mapping))
        .map(([scorerId, mapping]) => [scorerId, { ...(mapping as Record<string, string>) }]),
    );
  }

  const flatMapping = Object.fromEntries(
    entries.filter(([, mappingValue]) => typeof mappingValue === "string"),
  ) as Record<string, string>;

  return Object.fromEntries(selectedScorerIds.map((scorerId) => [scorerId, { ...flatMapping }]));
}

export function syncJobInputMappings(
  scorerIds: string[],
  scorers: Scorer[],
  inputMappings: Record<string, Record<string, string>>,
  scorerVersions: Record<string, number | null>,
) {
  const selected = new Set(scorerIds);
  const nextMappings: Record<string, Record<string, string>> = {};
  const nextVersions: Record<string, number | null> = {};

  selected.forEach((scorerId) => {
    const scorer = scorers.find((item) => entityId(item) === scorerId);
    const mapping = { ...(inputMappings[scorerId] || {}) };

    if (scorer) {
      scorerTemplateVariables(scorer).forEach((variable) => {
        if (mapping[variable] === undefined)
          mapping[variable] = defaultJobMappingValue(variable);
      });
    }

    nextMappings[scorerId] = mapping;
    nextVersions[scorerId] = scorerVersions[scorerId] ?? null;
  });

  return { nextMappings, nextVersions };
}

function parseMaybeJson(value: any) {
  if (typeof value !== "string") return value;
  if (!value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
