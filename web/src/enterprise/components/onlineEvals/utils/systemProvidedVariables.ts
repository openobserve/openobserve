import type { EvalTargetScope } from "@/services/online-evals.service";

export interface SystemProvidedVariable {
  name: "input" | "output" | "statistics" | "spans" | "steps";
}

const TRACE_VIEW_COMPONENTS: SystemProvidedVariable[] = [
  { name: "input" },
  { name: "output" },
  { name: "statistics" },
  { name: "spans" },
  { name: "steps" },
];

const SESSION_VIEW_COMPONENTS: SystemProvidedVariable[] = [
  { name: "statistics" },
  { name: "steps" },
];

export function systemProvidedVariablesForScope(
  targetScope: EvalTargetScope,
): SystemProvidedVariable[] {
  if (targetScope === "trace") return TRACE_VIEW_COMPONENTS;
  if (targetScope === "session") return SESSION_VIEW_COMPONENTS;
  return [];
}

export function isSystemProvidedVariable(targetScope: EvalTargetScope, variable: string): boolean {
  return systemProvidedVariablesForScope(targetScope).some(({ name }) => name === variable.trim());
}
