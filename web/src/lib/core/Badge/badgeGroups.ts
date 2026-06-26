// Copyright 2026 OpenObserve Inc.
//
// ─────────────────────────────────────────────────────────────────────────
// BADGE GROUP REGISTRY — the single source of truth for every typed badge /
// tag / status chip in the app.
//
// Motivation: a status string ("realtime", "active", "failed", "logs") should
// look IDENTICAL everywhere it appears. Instead of each table hand-picking a
// colour + icon, you declare the mapping ONCE here, then render it anywhere
// with two props:
//
//     <OTag type="alertType"   value="realtime" />   → blue badge + bolt icon
//     <OTag type="alertStatus" value="active"   />   → green badge + leading dot
//     <OTag type="logLevel"    value="error"    />   → red badge, colour only
//
// A "group" is a family of related values (e.g. all alert statuses). Each
// group declares:
//   • mode  — how the whole family renders: "icon" | "dot" | "plain"
//   • values — per-value { variant, icon?, label?, dot? } overrides
//   • fallback — what to show for an unrecognised value
//
// Per-value config can override the group mode (e.g. one value forces an icon
// in an otherwise dot-only group). Values are matched case-insensitively and
// separator-insensitively, so "real_time", "realTime", "Real-Time" all resolve
// to the same entry.
// ─────────────────────────────────────────────────────────────────────────

import type { BadgeVariant, BadgeSize } from "./OBadge.types";
import { statusVariant } from "@/lib/core/Table/cells/statusVariant";

/** How a badge presents its leading affordance. */
export type BadgeRenderMode = "icon" | "dot" | "plain";

export interface BadgeValueConfig {
  /** Colour variant (soft family reads best at table density). */
  variant: BadgeVariant;
  /** OIcon name — shown when the effective mode is "icon". */
  icon?: string;
  /** Display text. Defaults to the humanised value. */
  label?: string;
  /** Force the leading dot on/off regardless of group mode. */
  dot?: boolean;
}

export interface BadgeGroupConfig {
  /** Default presentation for every value in the group. */
  mode: BadgeRenderMode;
  /** Default size for this group's badges. */
  size?: BadgeSize;
  /** Per-value configuration, keyed by the NORMALISED value (see normalizeKey). */
  values: Record<string, BadgeValueConfig>;
  /** Rendered when a value isn't in `values`. Defaults to a neutral plain badge. */
  fallback?: BadgeValueConfig;
}

/** Lower-case + strip separators so realTime / real_time / Real-Time collapse. */
export function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, "");
}

/** Title-case a raw value for display: "real_time" → "Real Time". */
function humanize(value: unknown): string {
  return String(value ?? "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── The registry ──────────────────────────────────────────────────────────
// NOTE: keys inside `values` MUST be normalised (lowercase, no separators).

export const BADGE_GROUPS = {
  // Alerts: scheduled vs real-time vs anomaly — distinct colour + icon.
  alertType: {
    mode: "icon",
    values: {
      scheduled: { variant: "teal-soft", icon: "schedule" },
      realtime: { variant: "blue-soft", icon: "bolt", label: "Real-time" },
      anomalydetection: { variant: "purple-soft", icon: "query-stats", label: "Anomaly Detection" },
    },
  },

  // Alert run status — coloured DOT, no icon.
  alertStatus: {
    mode: "dot",
    values: {
      active: { variant: "success-soft" },
      ready: { variant: "success-soft" },
      running: { variant: "blue-soft" },
      training: { variant: "warning-soft" },
      failed: { variant: "error-soft" },
      disabled: { variant: "default-soft" },
      paused: { variant: "warning-soft" },
    },
  },

  // Incident lifecycle.
  incidentStatus: {
    mode: "dot",
    values: {
      open: { variant: "error-soft" },
      firing: { variant: "error-soft" },
      acknowledged: { variant: "warning-soft" },
      resolved: { variant: "success-soft" },
      closed: { variant: "default-soft" },
    },
  },

  // Severity scale — dot, ordered hot→cold.
  severity: {
    mode: "dot",
    values: {
      critical: { variant: "error-soft" },
      high: { variant: "orange-soft" },
      medium: { variant: "amber-soft" },
      low: { variant: "blue-soft" },
      info: { variant: "default-soft" },
    },
  },

  // Log levels — colour ONLY (plain), the classic severity tint.
  logLevel: {
    mode: "plain",
    values: {
      trace: { variant: "default-soft" },
      debug: { variant: "default-soft" },
      info: { variant: "blue-soft" },
      warn: { variant: "amber-soft", label: "WARN" },
      warning: { variant: "amber-soft", label: "WARN" },
      error: { variant: "error-soft" },
      fatal: { variant: "purple-soft" },
    },
  },

  // Pipelines: realtime vs scheduled — icon.
  pipelineType: {
    mode: "icon",
    values: {
      realtime: { variant: "blue-soft", icon: "bolt", label: "Real-time" },
      scheduled: { variant: "teal-soft", icon: "schedule" },
    },
  },

  // Stream types — icon, mirrors the stream-type filter chips.
  streamType: {
    mode: "icon",
    values: {
      logs: { variant: "blue-soft", icon: "search" },
      metrics: { variant: "purple-soft", icon: "bar-chart" },
      traces: { variant: "teal-soft", icon: "account-tree" },
      metadata: { variant: "default-soft", icon: "info" },
      enrichmenttables: { variant: "amber-soft", icon: "database", label: "Enrichment" },
      index: { variant: "cyan-soft", icon: "database" },
    },
  },

  // Invoice status (Stripe) — dot. "open" is informational here, not a warning.
  invoiceStatus: {
    mode: "dot",
    values: {
      paid: { variant: "success-soft" },
      open: { variant: "blue-soft" },
      draft: { variant: "default-soft" },
      void: { variant: "default-soft" },
      uncollectible: { variant: "error-soft" },
      pending: { variant: "warning-soft" },
    },
  },

  // Online-eval job status — dot.
  evalStatus: {
    mode: "dot",
    values: {
      active: { variant: "success-soft" },
      draft: { variant: "default-soft" },
      paused: { variant: "warning-soft" },
      degraded: { variant: "orange-soft" },
      archived: { variant: "default-soft" },
    },
  },

  // Running-query status — dot.
  queryStatus: {
    mode: "dot",
    values: {
      running: { variant: "blue-soft" },
      processing: { variant: "blue-soft" },
      pending: { variant: "warning-soft" },
      queued: { variant: "warning-soft" },
      waiting: { variant: "warning-soft" },
      completed: { variant: "success-soft" },
      finished: { variant: "success-soft" },
      failed: { variant: "error-soft" },
      cancelled: { variant: "default-soft" },
      canceled: { variant: "default-soft" },
    },
  },

  // Service / node health — dot.
  serviceStatus: {
    mode: "dot",
    values: {
      healthy: { variant: "success-soft" },
      online: { variant: "success-soft" },
      degraded: { variant: "warning-soft" },
      warning: { variant: "amber-soft" },
      critical: { variant: "error-soft" },
      offline: { variant: "error-soft" },
      down: { variant: "error-soft" },
    },
  },

  // IAM roles — colour only (plain). Privileged roles run hot.
  userRole: {
    mode: "plain",
    values: {
      root: { variant: "error-soft" },
      admin: { variant: "orange-soft" },
      editor: { variant: "blue-soft" },
      member: { variant: "blue-soft" },
      viewer: { variant: "default-soft" },
      user: { variant: "default-soft" },
      serviceaccount: { variant: "teal-soft", label: "Service Account" },
    },
  },

  // Authentication method — plain.
  authType: {
    mode: "plain",
    values: {
      sso: { variant: "blue-soft", label: "SSO" },
      native: { variant: "default-soft" },
      ldap: { variant: "purple-soft", label: "LDAP" },
    },
  },

  // HTTP methods — plain, REST-conventional colours.
  httpMethod: {
    mode: "plain",
    values: {
      get: { variant: "blue-soft", label: "GET" },
      post: { variant: "success-soft", label: "POST" },
      put: { variant: "warning-soft", label: "PUT" },
      patch: { variant: "purple-soft", label: "PATCH" },
      delete: { variant: "error-soft", label: "DELETE" },
    },
  },

  // Schema field data types — plain.
  fieldType: {
    mode: "plain",
    values: {
      utf8: { variant: "blue-soft", label: "String" },
      string: { variant: "blue-soft" },
      int64: { variant: "purple-soft", label: "Int" },
      integer: { variant: "purple-soft", label: "Int" },
      float64: { variant: "cyan-soft", label: "Float" },
      float: { variant: "cyan-soft" },
      boolean: { variant: "teal-soft", label: "Bool" },
      bool: { variant: "teal-soft", label: "Bool" },
      object: { variant: "default-soft" },
      array: { variant: "default-soft" },
    },
  },

  // Alert destinations — icon.
  destinationType: {
    mode: "icon",
    values: {
      email: { variant: "blue-soft", icon: "mail" },
      webhook: { variant: "teal-soft", icon: "webhook" },
      slack: { variant: "purple-soft", icon: "webhook" },
      http: { variant: "teal-soft", icon: "webhook", label: "HTTP" },
      sns: { variant: "orange-soft", icon: "cloud", label: "SNS" },
      remote_pipeline: { variant: "cyan-soft", icon: "hub", label: "Remote Pipeline" },
    },
  },

  // Enrichment table source — icon.
  enrichmentType: {
    mode: "icon",
    values: {
      file: { variant: "blue-soft", icon: "description" },
      url: { variant: "teal-soft", icon: "cloud" },
    },
  },

  // Generic enabled/yes/true vs disabled/no/false — dot.
  booleanState: {
    mode: "dot",
    values: {
      true: { variant: "success-soft", label: "Yes" },
      yes: { variant: "success-soft" },
      enabled: { variant: "success-soft" },
      on: { variant: "success-soft", label: "On" },
      false: { variant: "default-soft", label: "No" },
      no: { variant: "default-soft" },
      disabled: { variant: "default-soft" },
      off: { variant: "default-soft", label: "Off" },
    },
  },
} satisfies Record<string, BadgeGroupConfig>;

export type BadgeGroupName = keyof typeof BADGE_GROUPS;

export interface ResolvedBadge {
  variant: BadgeVariant;
  label: string;
  icon?: string;
  dot: boolean;
  mode: BadgeRenderMode;
}

/**
 * Resolve a (group, value) pair to a concrete render config.
 *
 * - Unknown `group` → fall back to the generic semantic `statusVariant` engine
 *   (so `<OTag>` still does something sensible without a registered group).
 * - Unknown `value` within a known group → the group's `fallback`, else the
 *   generic engine, presented in the group's mode.
 */
export function resolveBadge(
  group: BadgeGroupName | string | undefined,
  value: unknown,
): ResolvedBadge {
  const raw = String(value ?? "").trim();
  const key = normalizeKey(value);
  const cfg = group ? (BADGE_GROUPS as Record<string, BadgeGroupConfig>)[group] : undefined;

  // No registered group → generic semantic mapping, dot presentation.
  if (!cfg) {
    const generic = statusVariant(value);
    return {
      variant: generic.variant,
      label: raw ? humanize(raw) : "—",
      dot: true,
      mode: "dot",
    };
  }

  const entry = cfg.values[key] ?? cfg.fallback ?? genericEntry(value);
  const mode = entry.dot === true ? "dot" : cfg.mode;

  return {
    variant: entry.variant,
    label: entry.label ?? (raw ? humanize(raw) : "—"),
    icon: mode === "icon" ? entry.icon : undefined,
    dot: entry.dot ?? mode === "dot",
    mode,
  };
}

/** Generic single-value fallback derived from the semantic engine. */
function genericEntry(value: unknown): BadgeValueConfig {
  return { variant: statusVariant(value).variant };
}
