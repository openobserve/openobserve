import type { ScoreConfig } from "@/services/online-evals.service";
import { valueOf } from "./evalEntity";

/** The configured healthy value of a boolean Score Config, or null without one. */
export function healthyBooleanValue(config: ScoreConfig): boolean | null {
  const threshold = valueOf<any>(config, "healthyThreshold", "healthy_threshold");
  const healthy = threshold?.healthy_value ?? threshold?.healthyValue;
  if (healthy === true || healthy === "true") return true;
  if (healthy === false || healthy === "false") return false;
  return null;
}
