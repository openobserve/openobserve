// Copyright 2026 OpenObserve Inc.
//
// severity.ts — one severity vocabulary for every SIEM surface.
//
// Events carry an OCSF severity_id and detections carry a Sigma level. They are
// two spellings of the same question, so both are folded onto five tones here and every chip, rail, tile and chart series reads
// its colour from the tone. A "high" is then the same orange on the Overview,
// in the event table and in the drawer.

import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { StatTone } from "@/lib/data/StatStrip/OStatStrip.types";
import type { SigmaLevel } from "./sigma";

export const SEVERITY_TONES = ["critical", "high", "medium", "low", "info"] as const;
export type SeverityTone = (typeof SEVERITY_TONES)[number] | "unknown";

/** OCSF severity_id → tone. 6 (Fatal) reads as critical; 0 and 99 are unknown. */
export function toneOfSeverityId(id: number | null | undefined): SeverityTone {
  const n = Number(id);
  if (n === 5 || n === 6) return "critical";
  if (n === 4) return "high";
  if (n === 3) return "medium";
  if (n === 2) return "low";
  if (n === 1) return "info";
  return "unknown";
}

export function toneOfSigmaLevel(level: SigmaLevel | string | null | undefined): SeverityTone {
  switch (String(level ?? "").toLowerCase()) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
    case "informational":
    case "info":
      return "info";
    default:
      return "unknown";
  }
}

/** Value for `<OTag type="severity">`; the registry has no "unknown" entry. */
export function severityTagValue(tone: SeverityTone): string {
  return tone === "unknown" ? "info" : tone;
}

export const TONE_STAT: Record<SeverityTone, StatTone> = {
  critical: "error",
  high: "orange",
  medium: "warning",
  low: "blue",
  info: "neutral",
  unknown: "neutral",
};

export const TONE_ICON: Record<SeverityTone, IconName> = {
  critical: "emergency",
  high: "warning",
  medium: "report-problem",
  low: "info",
  info: "info",
  unknown: "help",
};

/**
 * Solid token per tone, for marks that need a resolved colour: the table row
 * rail and chart series (ECharts), which take a colour string rather than a
 * class. The solid shade of each severity chip's colour family.
 */
export const TONE_TOKEN: Record<SeverityTone, `--color-${string}`> = {
  critical: "--color-badge-error-solid-bg",
  high: "--color-badge-orange-solid-bg",
  medium: "--color-badge-amber-solid-bg",
  low: "--color-badge-blue-solid-bg",
  info: "--color-badge-default-solid-bg",
  unknown: "--color-border-default",
};

/** Row rail colour for OTable's getRowStatusColor. */
export function severityRailColor(tone: SeverityTone): string {
  return `var(${TONE_TOKEN[tone]})`;
}

/** i18n key for a tone's display name. */
export function toneLabelKey(tone: SeverityTone): string {
  return `siem.severity.${tone}`;
}
