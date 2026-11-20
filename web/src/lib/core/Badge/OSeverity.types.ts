/**
 * OSeverity.types.ts — public types of OSeverity.
 * No types should be defined inline in OSeverity.vue.
 */

import type { I18nText } from "@/types/i18n";

/** Log severity, most to least severe. */
export type SeverityLevel = "fatal" | "error" | "warn" | "info" | "debug";

export const SEVERITY_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
] as const satisfies readonly SeverityLevel[];

export interface SeverityProps {
  /** Drives the colour of the text and the mark. */
  level: SeverityLevel;
  /** Leading 3 px bar in the solid colour. */
  mark?: boolean;
  /** Text override; defaults to the level word. */
  label?: I18nText;
}
