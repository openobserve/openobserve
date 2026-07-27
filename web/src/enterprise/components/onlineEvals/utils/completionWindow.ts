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

export interface DurationParts {
  hours: number;
  minutes: number;
  seconds: number;
}

/**
 * Split a seconds field into display units: `1800` → 30 minutes, `14400` → 4
 * hours, `90` → 1 minute 30 seconds. Session max-age defaults to 4 hours,
 * which is where a raw `14400` stops being readable at all.
 *
 * Returns `null` when the field isn't a usable duration yet (empty,
 * non-numeric, or non-positive) so the caller can fall back to a generic hint
 * rather than describing a nonsense window.
 *
 * Deliberately returns NUMBERS, not a formatted string — the unit labels are
 * user-facing text and belong in i18n (`common.hr` / `common.min` /
 * `common.sec`), so only the component may assemble the final wording.
 */
export function durationPartsFromSecs(value: string | number): DurationParts | null {
  const input = String(value).trim();
  if (!input) return null;

  const secs = Math.floor(Number(input));
  if (!Number.isFinite(secs) || secs <= 0) return null;

  return {
    hours: Math.floor(secs / 3600),
    minutes: Math.floor((secs % 3600) / 60),
    seconds: secs % 60,
  };
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
      valueOf<any>(config, "idleWindowSecs", "idle_window_secs") ?? defaults.idleWindowSecs,
    ),
    maxAgeSecs: Number(valueOf<any>(config, "maxAgeSecs", "max_age_secs") ?? defaults.maxAgeSecs),
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
