import type {
  CompletionWindowConfig,
  EvalJob,
  EvalTargetScope,
} from "@/services/online-evals.service";
import { valueOf } from "./evalEntity";

export interface CompletionWindowDefaults {
  idleWindowSecs: number;
  maxAgeSecs: number;
}

// LLM Observability Phase 2.6 §8 Parameter Baselines.
export const MIN_COMPLETION_IDLE_WINDOW_SECS = 45;

export const TRACE_COMPLETION_WINDOW_DEFAULTS: CompletionWindowDefaults = {
  idleWindowSecs: 2 * 60,
  maxAgeSecs: 30 * 60,
};

export const SESSION_COMPLETION_WINDOW_DEFAULTS: CompletionWindowDefaults = {
  idleWindowSecs: 2 * 60,
  maxAgeSecs: 4 * 60 * 60,
};

export function completionWindowDefaultsForScope(
  targetScope: EvalTargetScope,
): CompletionWindowDefaults | null {
  if (targetScope === "trace") return TRACE_COMPLETION_WINDOW_DEFAULTS;
  if (targetScope === "session") return SESSION_COMPLETION_WINDOW_DEFAULTS;
  return null;
}

/** Read a scope's completion config from either API casing, with defaults. */
export function completionWindowConfigFromJob(
  row: EvalJob,
  targetScope: EvalTargetScope,
): CompletionWindowConfig | null {
  const defaults = completionWindowDefaultsForScope(targetScope);
  if (!defaults) return null;

  const config =
    targetScope === "trace"
      ? valueOf<any>(row, "traceConfig", "trace_config")
      : valueOf<any>(row, "sessionConfig", "session_config");

  return {
    idleWindowSecs: Number(
      valueOf<any>(config, "idleWindowSecs", "idle_window_secs") ??
        defaults.idleWindowSecs,
    ),
    maxAgeSecs: Number(
      valueOf<any>(config, "maxAgeSecs", "max_age_secs") ?? defaults.maxAgeSecs,
    ),
    endSignal: valueOf(config, "endSignal", "end_signal") ?? null,
  };
}

/** Emit only the completion config that belongs to the selected target scope. */
export function buildCompletionConfigPayloads(
  targetScope: EvalTargetScope,
  values: CompletionWindowDefaults,
  endSignal: unknown | null,
): {
  traceConfig: CompletionWindowConfig | null;
  sessionConfig: CompletionWindowConfig | null;
} {
  const config: CompletionWindowConfig | null =
    targetScope === "span"
      ? null
      : {
          idleWindowSecs: Number(values.idleWindowSecs),
          maxAgeSecs: Number(values.maxAgeSecs),
          endSignal: endSignal ?? null,
        };

  return {
    traceConfig: targetScope === "trace" ? config : null,
    sessionConfig: targetScope === "session" ? config : null,
  };
}
