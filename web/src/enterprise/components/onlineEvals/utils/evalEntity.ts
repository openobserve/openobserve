import type {
  EvalJob,
  EvalJobScorerRef,
  EvalTargetScope,
  Provider,
  ScoreConfig,
  Scorer,
  ScorerType,
} from "@/services/online-evals.service";

export function valueOf<T = any>(row: any, camelKey: string, snakeKey: string): T | undefined {
  return row?.[camelKey] ?? row?.[snakeKey];
}

export function booleanOf(row: any, camelKey: string, snakeKey: string) {
  return Boolean(valueOf(row, camelKey, snakeKey));
}

export function entityId(row: ScoreConfig | Scorer) {
  return String(valueOf(row, "entityId", "entity_id") || row.id);
}

export function providerTypeOf(row: Provider) {
  return String(valueOf(row, "providerType", "provider_type") || "");
}

export function defaultModelOf(row: Provider) {
  return String(valueOf(row, "defaultModel", "default_model") || "");
}

export function availableModelsOf(row: Provider) {
  return (valueOf(row, "availableModels", "available_models") || []) as string[];
}

export function scorerTypeOf(row: Scorer): ScorerType {
  return (valueOf(row, "scorerType", "scorer_type") || "llm_judge") as ScorerType;
}

export function dataTypeOf(row: ScoreConfig) {
  return String(valueOf(row, "dataType", "data_type") || "numeric");
}

export function streamTypeOf(row: EvalJob) {
  return String(valueOf(row, "streamType", "stream_type") || "traces");
}

export function targetScopeOf(row: EvalJob): EvalTargetScope {
  return (valueOf(row, "targetScope", "target_scope") || "span") as EvalTargetScope;
}

export function samplingModeOf(row: EvalJob) {
  return String(valueOf(row, "samplingMode", "sampling_mode") || "rate");
}

export function statusOf(row: EvalJob) {
  return row.status || "draft";
}

export function scorerRefId(ref: EvalJobScorerRef) {
  return typeof ref === "string" ? ref : ref.id;
}

export function scorerRefVersion(ref: EvalJobScorerRef) {
  return typeof ref === "string" ? null : (ref.version ?? null);
}
