// Copyright 2026 OpenObserve Inc.

import { normalizeKey } from "./badgeGroups";
import type { SeverityLevel } from "./OSeverity.types";

const LEVEL_ALIASES: Record<string, SeverityLevel> = {
  fatal: "fatal",
  panic: "fatal",
  emergency: "fatal",
  emerg: "fatal",
  critical: "fatal",
  crit: "fatal",
  alert: "fatal",
  error: "error",
  err: "error",
  warn: "warn",
  warning: "warn",
  info: "info",
  information: "info",
  notice: "info",
  debug: "debug",
  trace: "debug",
};

/** Maps a raw log level (any case, syslog or OTel words) to an OSeverity level; unknown reads as info. */
export function toSeverityLevel(value: unknown): SeverityLevel {
  return LEVEL_ALIASES[normalizeKey(value)] ?? "info";
}
