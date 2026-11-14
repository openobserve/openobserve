import type { I18nText } from "@/types/i18n";

/** Fill colour by meaning: accent for plain progress, ok / warn / err for a status reading. */
export type ProgressBarTone = "accent" | "ok" | "warn" | "err";

export const PROGRESS_BAR_TONES = [
  "accent",
  "ok",
  "warn",
  "err",
] as const satisfies readonly ProgressBarTone[];

export interface ProgressBarProps {
  /** Percent done, 0-100; null is work with no known end and animates the fill. */
  value: number | null;
  /** Left edge of the fill, 0-100, so a row of bars on one scale reads as a timeline. Default: 0 */
  start?: number;
  /** Fill colour. Default: "accent" */
  tone?: ProgressBarTone;
  /** Accessible name of the bar. */
  label?: I18nText;
}
