import type { EvalTargetScope } from "@/services/online-evals.service";

export interface SystemProvidedVariable {
  name: "input" | "output" | "statistics" | "spans" | "steps" | "tool_calls";
}

const TRACE_VIEW_COMPONENTS: SystemProvidedVariable[] = [
  { name: "input" },
  { name: "output" },
  { name: "statistics" },
  { name: "spans" },
  { name: "steps" },
  { name: "tool_calls" },
];

const SESSION_VIEW_COMPONENTS: SystemProvidedVariable[] = [
  { name: "input" },
  { name: "output" },
  { name: "statistics" },
  { name: "steps" },
  { name: "tool_calls" },
];

export function systemProvidedVariablesForScope(
  targetScope: EvalTargetScope,
): SystemProvidedVariable[] {
  if (targetScope === "trace") return TRACE_VIEW_COMPONENTS;
  if (targetScope === "session") return SESSION_VIEW_COMPONENTS;
  return [];
}
