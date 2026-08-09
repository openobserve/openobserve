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
//
// i18n RULE: a value entry that renders user-facing PROSE must carry a
// `labelKey`. Without one the badge falls back to the humanised raw value
// ("real_time" → "Real Time"), which is English in every locale. Only three
// kinds of entry may skip it, and each is commented where it appears:
//   • protocol / spec tokens and acronyms (GET, OK, SSO, LDAP, HTTP, P95, 2xx,
//     OTel SpanKind) and product names (Slack, Stripe) — identical everywhere;
//   • style / intent selectors whose "value" is a colour choice, never text
//     (countChip, fieldTag, logsResultChip, diffCategory, dimensionKey, …);
//   • entries whose text is always supplied by the caller as a slot or `label`
//     prop, so the registry text never reaches the screen.
// ─────────────────────────────────────────────────────────────────────────

import { raw, type I18nKey, I18nText } from "@/types/i18n";

import type { BadgeVariant, BadgeSize, BadgeShape } from "./OBadge.types";
import { statusVariant } from "@/lib/core/Table/cells/statusVariant";
import { translateBadgeLabel } from "./badgeI18n";

/** How a badge presents its leading affordance. */
export type BadgeRenderMode = "icon" | "dot" | "plain";

export interface BadgeValueConfig {
  /** Colour variant (soft family reads best at table density). */
  variant: BadgeVariant;
  /** OIcon name — shown when the effective mode is "icon". */
  icon?: string;
  /** Display text. Defaults to the humanised value. */
  label?: I18nText;
  /**
   * i18n key for the label. Resolved by `OTag` via `t(labelKey)` (the registry
   * is a plain module with no i18n context, so the key is stored as DATA and
   * translated at render time — never `t()` here, that would freeze the locale
   * at import time). Use this instead of `label` for any user-facing prose;
   * `label` is reserved for text that is the same in every locale (protocol
   * tokens, acronyms, product names).
   *
   * Precedence in `OTag`: per-call `label` prop → `labelKey` → literal `label`
   * → humanised value. Note `labelKey` beats a literal `label` in the registry;
   * only the per-call prop outranks it.
   */
  labelKey?: I18nKey;
  /** Force the leading dot on/off regardless of group mode. */
  dot?: boolean;
  /** Per-value size override (wins over the group `size`). For groups whose
   *  values legitimately render at different sizes (e.g. a sm chip vs an md one). */
  size?: BadgeSize;
}

export interface BadgeGroupConfig {
  /** Default presentation for every value in the group. */
  mode: BadgeRenderMode;
  /** Default size for this group's badges. */
  size?: BadgeSize;
  /** Default corner shape for this group's badges (pill | rounded | square).
   *  Omit for the default pill. */
  shape?: BadgeShape;
  /** Per-value configuration, keyed by the NORMALISED value (see normalizeKey). */
  values: Record<string, BadgeValueConfig>;
  /** Rendered when a value isn't in `values`. Defaults to a neutral plain badge. */
  fallback?: BadgeValueConfig;
  /** Extra utility classes merged onto every badge in this group — for group-wide
   *  tweaks that aren't captured by variant/size/shape (e.g. tighter vertical
   *  padding so the chip sits shorter than its row's action buttons). */
  class?: string;
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
    shape: "pill",
    values: {
      scheduled: {
        variant: "teal-soft",
        icon: "schedule",
        labelKey: "components.badge.alertType.scheduled",
      },
      realtime: {
        variant: "blue-soft",
        icon: "bolt",
        labelKey: "components.badge.alertType.realtime",
      },
      anomalydetection: {
        variant: "purple-soft",
        icon: "query-stats",
        labelKey: "components.badge.alertType.anomalydetection",
      },
      composite: {
        variant: "purple-soft",
        icon: "account-tree",
        labelKey: "components.badge.alertType.composite",
      },
      slo: {
        variant: "indigo-soft",
        icon: "monitor-heart",
        labelKey: "components.badge.alertType.slo",
      },
    },
  },

  // Alert run status — coloured DOT, no icon.
  alertStatus: {
    mode: "dot",
    shape: "pill",
    values: {
      active: { variant: "success-soft", labelKey: "components.badge.alertStatus.active" },
      ready: { variant: "success-soft", labelKey: "components.badge.alertStatus.ready" },
      running: { variant: "blue-soft", labelKey: "components.badge.alertStatus.running" },
      training: { variant: "warning-soft", labelKey: "components.badge.alertStatus.training" },
      failed: { variant: "error-soft", labelKey: "components.badge.alertStatus.failed" },
      disabled: { variant: "default-soft", labelKey: "components.badge.alertStatus.disabled" },
      paused: { variant: "warning-soft", labelKey: "components.badge.alertStatus.paused" },
    },
  },

  // Alert PRIORITY (Feature 2, PT-3) — how much humans care about this alert,
  // set at configuration time.
  //
  // A THIRD axis, distinct from both neighbours below: `alertState` is the run
  // outcome ("did it fire?"), `alertLevel` is the evaluated severity right now
  // ("how bad?"), and this is neither — a P1 alert sitting at level Ok is
  // perfectly normal, so these must never share a group.
  //
  // Palette follows the existing `severity` hot→cold ramp so P1–P4 read the
  // same as they do on incidents, extended with a neutral P5 (that scale stops
  // at P4).
  alertPriority: {
    mode: "dot",
    shape: "pill",
    values: {
      p1: { variant: "error-soft", label: raw("P1") },
      p2: { variant: "orange-soft", label: raw("P2") },
      p3: { variant: "amber-soft", label: raw("P3") },
      p4: { variant: "blue-soft", label: raw("P4") },
      p5: { variant: "default-soft", label: raw("P5") },
    },
    fallback: { variant: "default-soft" },
  },

  // Alert severity LEVEL (alerts_2.md Feature 1) — dot, PILL.
  //
  // A separate axis from `alertState` above, which renders the run OUTCOME
  // ("did it fire?"). This renders "how bad?". An alert can be `firing` at
  // `warning`, so the two badges can and do appear side by side.
  alertLevel: {
    mode: "dot",
    shape: "pill",
    values: {
      critical: { variant: "error-soft", labelKey: "components.badge.alertLevel.critical" },
      warning: { variant: "warning-soft", labelKey: "components.badge.alertLevel.warning" },
      ok: { variant: "success-soft", labelKey: "components.badge.alertLevel.ok" },
      // Reserved: the policy that produces it ships in Phase 2. Neutral rather
      // than warning-coloured — "we don't know" is not "we know it's bad".
      nodata: { variant: "default-soft", labelKey: "components.badge.alertLevel.nodata" },
    },
    fallback: { variant: "default-soft" },
  },

  // Incident lifecycle. Labels are i18n keys (resolved by OTag).
  incidentStatus: {
    mode: "dot",
    shape: "pill",
    values: {
      open: { variant: "error-soft", labelKey: "alerts.incidents.statusOpen" },
      firing: { variant: "error-soft", labelKey: "components.badge.incidentStatus.firing" },
      acknowledged: { variant: "warning-soft", labelKey: "alerts.incidents.statusAcknowledged" },
      resolved: { variant: "success-soft", labelKey: "alerts.incidents.statusResolved" },
      closed: { variant: "default-soft", labelKey: "components.badge.incidentStatus.closed" },
    },
  },

  // Severity scale — dot, ordered hot→cold. P1–P4 are aliases so incident
  // severities (P1/P2/P3/P4) resolve to the same colours as critical→low.
  severity: {
    mode: "dot",
    shape: "pill",
    values: {
      critical: { variant: "error-soft", labelKey: "components.badge.severity.critical" },
      high: { variant: "orange-soft", labelKey: "components.badge.severity.high" },
      medium: { variant: "amber-soft", labelKey: "components.badge.severity.medium" },
      low: { variant: "blue-soft", labelKey: "components.badge.severity.low" },
      info: { variant: "default-soft", labelKey: "components.badge.severity.info" },
      p1: { variant: "error-soft", label: raw("P1") },
      p2: { variant: "orange-soft", label: raw("P2") },
      p3: { variant: "amber-soft", label: raw("P3") },
      p4: { variant: "blue-soft", label: raw("P4") },
    },
  },

  // Log levels — colour ONLY (plain), the classic severity tint.
  logLevel: {
    mode: "plain",
    shape: "pill",
    values: {
      trace: { variant: "default-soft", labelKey: "components.badge.logLevel.trace" },
      debug: { variant: "default-soft", labelKey: "components.badge.logLevel.debug" },
      info: { variant: "blue-soft", labelKey: "components.badge.logLevel.info" },
      warn: { variant: "amber-soft", labelKey: "components.badge.logLevel.warn" },
      warning: { variant: "amber-soft", labelKey: "components.badge.logLevel.warn" },
      error: { variant: "error-soft", labelKey: "common.error" },
      fatal: { variant: "purple-soft", labelKey: "components.badge.logLevel.fatal" },
    },
  },

  // Pipelines: realtime vs scheduled — icon.
  pipelineType: {
    mode: "icon",
    shape: "pill",
    values: {
      realtime: {
        variant: "blue-soft",
        icon: "bolt",
        labelKey: "components.badge.pipelineType.realtime",
      },
      scheduled: {
        variant: "teal-soft",
        icon: "schedule",
        labelKey: "components.badge.pipelineType.scheduled",
      },
    },
  },

  // Stream types — icon, mirrors the stream-type filter chips.
  streamType: {
    mode: "icon",
    shape: "pill",
    values: {
      logs: { variant: "blue-soft", icon: "search", labelKey: "settings.correlation.logs" },
      metrics: {
        variant: "purple-soft",
        icon: "bar-chart",
        labelKey: "settings.correlation.metrics",
      },
      traces: {
        variant: "teal-soft",
        icon: "account-tree",
        labelKey: "settings.correlation.traces",
      },
      metadata: {
        variant: "default-soft",
        icon: "info",
        labelKey: "components.badge.streamType.metadata",
      },
      enrichmenttables: {
        variant: "amber-soft",
        icon: "database",
        labelKey: "components.badge.streamType.enrichment",
      },
      index: {
        variant: "cyan-soft",
        icon: "database",
        labelKey: "components.badge.streamType.index",
      },
    },
  },

  // Invoice status (Stripe) — dot. "open" is informational here, not a warning.
  invoiceStatus: {
    mode: "dot",
    shape: "pill",
    values: {
      paid: { variant: "success-soft", labelKey: "components.badge.invoiceStatus.paid" },
      open: { variant: "blue-soft", labelKey: "components.badge.invoiceStatus.open" },
      draft: { variant: "default-soft", labelKey: "components.badge.invoiceStatus.draft" },
      void: { variant: "default-soft", labelKey: "components.badge.invoiceStatus.void" },
      uncollectible: {
        variant: "error-soft",
        labelKey: "components.badge.invoiceStatus.uncollectible",
      },
      pending: { variant: "warning-soft", labelKey: "components.badge.invoiceStatus.pending" },
    },
  },

  // Online-eval job status — dot.
  evalStatus: {
    mode: "dot",
    shape: "pill",
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
    shape: "pill",
    values: {
      running: { variant: "blue-soft", labelKey: "components.badge.queryStatus.running" },
      processing: { variant: "blue-soft", labelKey: "components.badge.queryStatus.processing" },
      pending: { variant: "warning-soft", labelKey: "components.badge.queryStatus.pending" },
      queued: { variant: "warning-soft", labelKey: "components.badge.queryStatus.queued" },
      waiting: { variant: "warning-soft", labelKey: "components.badge.queryStatus.waiting" },
      completed: { variant: "success-soft", labelKey: "components.badge.queryStatus.completed" },
      finished: { variant: "success-soft", labelKey: "components.badge.queryStatus.finished" },
      failed: { variant: "error-soft", labelKey: "components.badge.queryStatus.failed" },
      // Both spellings are in the wild; each keeps the exact word it renders today.
      cancelled: { variant: "default-soft", labelKey: "components.badge.queryStatus.cancelled" },
      canceled: { variant: "default-soft", labelKey: "components.badge.queryStatus.canceled" },
    },
  },

  // Pipeline execution outcome — dot.
  //
  // `RunOutcome` replaced the legacy trigger status vocabulary for every
  // scheduler-backed module. Pipeline history must accept both generations
  // while old rows remain in the triggers stream.
  pipelineRunOutcome: {
    mode: "dot",
    shape: "pill",
    values: {
      // Current RunOutcome vocabulary.
      firing: { variant: "success-soft", labelKey: "components.badge.pipelineRunOutcome.firing" },
      normal: { variant: "success-soft", labelKey: "components.badge.pipelineRunOutcome.normal" },
      succeeded: {
        variant: "success-soft",
        labelKey: "components.badge.pipelineRunOutcome.succeeded",
      },
      error: { variant: "error-soft", labelKey: "common.error" },
      // Shares the `alertState` wording so the same outcome reads identically in
      // pipeline history and alert history.
      notifyfailed: { variant: "error-soft", labelKey: "components.badge.alertState.notifyfailed" },
      skipped: { variant: "warning-soft", labelKey: "components.badge.pipelineRunOutcome.skipped" },
      // Legacy trigger status vocabulary and older UI aliases.
      completed: {
        variant: "success-soft",
        labelKey: "components.badge.pipelineRunOutcome.completed",
      },
      conditionnotsatisfied: {
        variant: "success-soft",
        labelKey: "components.badge.pipelineRunOutcome.conditionnotsatisfied",
      },
      failed: { variant: "error-soft", labelKey: "components.badge.pipelineRunOutcome.failed" },
      success: { variant: "success-soft", labelKey: "common.success" },
      ok: { variant: "success-soft", labelKey: "components.badge.pipelineRunOutcome.ok" },
      warning: { variant: "warning-soft", labelKey: "components.badge.pipelineRunOutcome.warning" },
    },
    fallback: { variant: "default-soft" },
  },

  // Service / node health — dot.
  serviceStatus: {
    mode: "dot",
    shape: "pill",
    values: {
      up: { variant: "success-soft", labelKey: "components.badge.serviceStatus.up" },
      passed: { variant: "success-soft", labelKey: "components.badge.serviceStatus.passed" },
      healthy: { variant: "success-soft", labelKey: "components.badge.serviceStatus.healthy" },
      online: { variant: "success-soft", labelKey: "components.badge.serviceStatus.online" },
      degraded: { variant: "warning-soft", labelKey: "components.badge.serviceStatus.degraded" },
      warning: { variant: "amber-soft", labelKey: "components.badge.serviceStatus.warning" },
      // A cluster node that is starting up but not yet serving.
      prepare: { variant: "warning-soft", labelKey: "components.badge.serviceStatus.prepare" },
      critical: { variant: "error-soft", labelKey: "components.badge.serviceStatus.critical" },
      offline: { variant: "error-soft", labelKey: "components.badge.serviceStatus.offline" },
      failed: { variant: "error-soft", labelKey: "components.badge.serviceStatus.failed" },
      down: { variant: "error-soft", labelKey: "components.badge.serviceStatus.down" },
      unknown: { variant: "default-soft", labelKey: "common.unknown" },
    },
  },

  // Cluster node roles — plain (a role is a category, not a severity), one stable
  // colour per role so the same node type reads the same everywhere.
  nodeRole: {
    mode: "plain",
    shape: "pill",
    values: {
      all: { variant: "primary-soft", labelKey: "components.badge.nodeRole.all" },
      ingester: { variant: "teal-soft", labelKey: "components.badge.nodeRole.ingester" },
      querier: { variant: "blue-soft", labelKey: "components.badge.nodeRole.querier" },
      compactor: { variant: "purple-soft", labelKey: "components.badge.nodeRole.compactor" },
      flattencompactor: {
        variant: "purple-soft",
        labelKey: "components.badge.nodeRole.flattencompactor",
      },
      router: { variant: "orange-soft", labelKey: "components.badge.nodeRole.router" },
      scheduler: { variant: "amber-soft", labelKey: "components.badge.nodeRole.scheduler" },
      actionserver: { variant: "lime-soft", labelKey: "components.badge.nodeRole.actionserver" },
      script: { variant: "default-soft", labelKey: "components.badge.nodeRole.script" },
    },
  },

  // IAM roles — colour only (plain). Privileged roles run hot.
  userRole: {
    mode: "plain",
    shape: "pill",
    values: {
      root: { variant: "error-soft", labelKey: "components.badge.userRole.root" },
      admin: { variant: "orange-soft", labelKey: "components.badge.userRole.admin" },
      editor: { variant: "blue-soft", labelKey: "components.badge.userRole.editor" },
      member: { variant: "blue-soft", labelKey: "components.badge.userRole.member" },
      viewer: { variant: "default-soft", labelKey: "components.badge.userRole.viewer" },
      user: { variant: "default-soft", labelKey: "components.badge.userRole.user" },
      serviceaccount: {
        variant: "teal-soft",
        labelKey: "components.badge.userRole.serviceaccount",
      },
    },
  },

  // Authentication method — plain.
  // SSO / LDAP are protocol acronyms: identical in every locale, so they stay
  // literal (no labelKey).
  authType: {
    mode: "plain",
    shape: "pill",
    values: {
      sso: { variant: "blue-soft", label: raw("SSO") },
      native: { variant: "default-soft", labelKey: "components.badge.authType.native" },
      ldap: { variant: "purple-soft", label: raw("LDAP") },
    },
  },

  // HTTP methods — plain, REST-conventional colours. Deliberately NOT translated:
  // the verbs are HTTP spec tokens, identical in every locale.
  httpMethod: {
    mode: "plain",
    shape: "pill",
    values: {
      get: { variant: "blue-soft", label: raw("GET") },
      post: { variant: "success-soft", label: raw("POST") },
      put: { variant: "warning-soft", label: raw("PUT") },
      patch: { variant: "purple-soft", label: raw("PATCH") },
      delete: { variant: "error-soft", label: raw("DELETE") },
    },
  },

  // Schema field data types — plain.
  fieldType: {
    mode: "plain",
    shape: "rounded",
    values: {
      utf8: { variant: "blue-soft", labelKey: "common.typeString" },
      string: { variant: "blue-soft", labelKey: "common.typeString" },
      int64: { variant: "purple-soft", labelKey: "components.badge.fieldType.int" },
      integer: { variant: "purple-soft", labelKey: "components.badge.fieldType.int" },
      float64: { variant: "cyan-soft", labelKey: "components.badge.fieldType.float" },
      float: { variant: "cyan-soft", labelKey: "components.badge.fieldType.float" },
      boolean: { variant: "teal-soft", labelKey: "components.badge.fieldType.bool" },
      bool: { variant: "teal-soft", labelKey: "components.badge.fieldType.bool" },
      object: { variant: "default-soft", labelKey: "components.badge.fieldType.object" },
      array: { variant: "default-soft", labelKey: "components.badge.fieldType.array" },
    },
  },

  // Alert destinations — icon.
  destinationType: {
    mode: "icon",
    shape: "pill",
    values: {
      email: {
        variant: "blue-soft",
        icon: "mail",
        labelKey: "components.badge.destinationType.email",
      },
      webhook: {
        variant: "teal-soft",
        icon: "webhook",
        labelKey: "components.badge.destinationType.webhook",
      },
      // Product name — never translated.
      slack: { variant: "purple-soft", icon: "webhook" },
      http: { variant: "teal-soft", icon: "webhook", label: raw("HTTP") },
      sns: { variant: "orange-soft", icon: "cloud", label: raw("SNS") },
      remotepipeline: {
        variant: "cyan-soft",
        icon: "hub",
        labelKey: "components.badge.destinationType.remotepipeline",
      },
    },
  },

  // CLI command presets (AddAiToolset) — every preset shares ONE colour via a
  // fallback-only entry (the list is data-driven via CLI_PRESETS). The `value` is
  // passed for semantics but always resolves to the fallback. Add per-preset
  // colours under `values` if ever needed.
  cliPreset: {
    mode: "plain",
    shape: "pill",
    size: "md",
    values: {},
    fallback: { variant: "primary-soft" },
  },

  // Count chip — numeric count/total badges, keyed by colour INTENT (the number
  // itself is the slot). pill + sm; the leading `dot` (where present) stays a
  // per-call decorative prop.
  countChip: {
    mode: "plain",
    shape: "pill",
    size: "sm",
    values: {
      neutral: { variant: "default-soft" },
      primary: { variant: "primary-soft" },
      success: { variant: "success-soft" },
      warning: { variant: "warning-soft" },
      error: { variant: "error-soft" },
      info: { variant: "blue-soft" },
      // primary count with a leading status dot (e.g. the "N Alerts" summary).
      alerts: { variant: "primary-soft", dot: true },
      // solid-primary prominent count (e.g. "N / M selected").
      accent: { variant: "primary" },
      errorstrong: { variant: "error" },
    },
    fallback: { variant: "default-soft" },
  },

  // Integration card meta (AIIntegrationCard) — category vs runtime chips.
  // category→primary-soft, runtime→default. pill + sm; the actual text is the slot.
  integrationMeta: {
    mode: "plain",
    shape: "pill",
    size: "sm",
    values: {
      category: { variant: "primary-soft" },
      runtime: { variant: "default" },
    },
    fallback: { variant: "default" },
  },

  // Setup-card provider meta (SetupCardRenderer) — runtime/setup-time/cost/meta
  // chips with leading icons. mode icon so icon + colour come from the registry.
  // pill + md; the text is the slot.
  setupCardMeta: {
    mode: "icon",
    shape: "pill",
    size: "md",
    values: {
      runtime: { variant: "default-outline", icon: "code" },
      setuptime: { variant: "primary-soft", icon: "schedule" },
      cost: {
        variant: "default-outline",
        icon: "attach-money",
        labelKey: "components.badge.setupCardMeta.cost",
      },
      meta: { variant: "default-outline" },
    },
    fallback: { variant: "default-outline" },
  },

  // Index-field type (PerformanceFieldsDialog) — removable field tokens coloured
  // by index kind: fts→primary-soft, secondary index→success-soft. pill + sm; the
  // field name + remove button are slots.
  indexFieldType: {
    mode: "plain",
    shape: "pill",
    size: "sm",
    values: {
      fts: { variant: "primary-soft" },
      secondaryindex: { variant: "success-soft" },
    },
    fallback: { variant: "default-soft" },
  },

  billingTag: {
    mode: "plain",
    shape: "pill",
    size: "md",
    class: "px-2 py-3",
    values: {
      discount: { variant: "primary-soft", labelKey: "billing.discountTag" },
      subscribed: { variant: "primary-soft", labelKey: "billing.subscribed" },
    },
    fallback: { variant: "primary-soft" },
  },

  correlationChip: {
    mode: "plain",
    shape: "pill",
    size: "md",
    values: {
      overflow: { variant: "default-soft" },
      subject: { variant: "amber-outline", dot: true },
    },
    fallback: { variant: "default-soft" },
  },

  tabChip: {
    mode: "plain",
    shape: "pill",
    size: "sm",
    values: {
      active: { variant: "primary" },
      inactive: { variant: "default" },
    },
    fallback: { variant: "default" },
  },

  userStatus: {
    mode: "plain",
    shape: "pill",
    size: "md",
    values: {
      invited: { variant: "warning-soft", labelKey: "components.badge.userStatus.invited" },
    },
    fallback: { variant: "default-soft" },
  },

  evalBadge: {
    mode: "plain",
    shape: "pill",
    size: "md",
    values: {
      weakest: { variant: "warning", labelKey: "components.badge.evalBadge.weakest" },
      template: { variant: "primary-outline", labelKey: "traces.evaluations.templateBadge" },
    },
    fallback: { variant: "default" },
  },

  featureStatus: {
    mode: "plain",
    shape: "pill",
    size: "sm",
    values: {
      enabled: { variant: "success", labelKey: "components.badge.featureStatus.enabled" },
      disabled: { variant: "error", labelKey: "components.badge.featureStatus.disabled" },
    },
    fallback: { variant: "default" },
  },

  wildcardChip: {
    mode: "plain",
    shape: "rounded",
    size: "sm",
    values: {},
    fallback: { variant: "default" },
  },

  toolMeta: {
    mode: "plain",
    shape: "pill",
    size: "md",
    values: {
      tool: { variant: "warning" },
      callid: { variant: "default" },
    },
    fallback: { variant: "default" },
  },

  exampleChip: {
    mode: "plain",
    shape: "pill",
    size: "sm",
    values: {
      dim: { variant: "primary" },
      value: { variant: "success" },
    },
    fallback: { variant: "primary" },
  },

  // Prometheus metric TYPE — the classifying badge on the Metrics Explorer's
  // cards, the ⚙ function dialog and anywhere else a metric's kind is shown.
  // One hue per kind, matching the explorer's palette (metricPalette.ts):
  // Counter blue, Gauge green, Histogram purple, Summary orange, Other grey.
  metricType: {
    mode: "plain",
    shape: "rounded",
    // xs: this badge lives in dense card footers and dialog headers.
    size: "xs",
    values: {
      counter: { variant: "blue-soft", labelKey: "metrics.badge.counter" },
      gauge: { variant: "success-soft", labelKey: "metrics.badge.gauge" },
      histogram: { variant: "purple-soft", labelKey: "metrics.badge.histogram" },
      summary: { variant: "orange-soft", labelKey: "metrics.badge.summary" },
      other: { variant: "default-soft", labelKey: "metrics.badge.other" },
    },
    fallback: { variant: "default-soft", labelKey: "metrics.badge.other" },
  },

  // Metric/info chip — trace & thread toolbar chips (Service/Duration/Cost/Steps…)
  // that carry icon + label + value in the slot and get their accent from scoped
  // CSS (.toolbar-chip/.thread-chip/.llm-chip). Uniform neutral base; pill + sm.
  metricChip: {
    mode: "plain",
    shape: "pill",
    size: "sm",
    values: {},
    fallback: { variant: "default" },
  },

  logsResultChip: {
    mode: "plain",
    shape: "rounded",
    size: "md",
    values: {
      neutral: { variant: "default-soft" },
      info: { variant: "blue-soft" },
      warn: { variant: "warning-soft" },
      error: { variant: "error-soft" },
    },
    fallback: { variant: "default-soft" },
  },

  // Neutral field/value tag — plain chips that just display a field or value name
  // (CrossLinkManager fields, PipelinesDestinationList type/format, …). `soft` =
  // the lighter default-soft variant; bare (fallback) = solid default. pill + md.
  fieldTag: {
    mode: "plain",
    shape: "pill",
    size: "md",
    values: {
      soft: { variant: "default-soft" },
      // compact (sm) variants for denser chip lists (setup-card pills, regions…).
      softsm: { variant: "default-soft", size: "sm" },
      primarysm: { variant: "primary", size: "sm" },
      primarysoft: { variant: "primary-soft" },
      primarysoftsm: { variant: "primary-soft", size: "sm" },
      primary: { variant: "primary" },
      outlinesm: { variant: "default-outline", size: "sm" },
    },
    fallback: { variant: "default" },
  },

  // Latency percentile row labels (ServiceGraphEdgeSidePanel baseline table) —
  // fixed P50/P95/P99 markers. Registry-driven so the component needs no slot.
  percentileTag: {
    mode: "plain",
    shape: "pill",
    size: "md",
    values: {
      p50: { variant: "default-soft", label: raw("P50") },
      p95: { variant: "default-soft", label: raw("P95") },
      p99: { variant: "default-soft", label: raw("P99") },
    },
    fallback: { variant: "default-soft" },
  },

  // Alert template origin — prebuilt vs custom. i18n labels via labelKey so the
  // component needs no slot.
  templateOrigin: {
    mode: "plain",
    shape: "pill",
    size: "sm",
    values: {
      prebuilt: { variant: "blue-soft", labelKey: "alert_templates.prebuiltBadge" },
      custom: { variant: "default-soft", labelKey: "alert_templates.customBadge" },
    },
    fallback: { variant: "default-soft" },
  },

  reportTag: {
    mode: "plain",
    shape: "pill",
    size: "md",
    values: {
      png: { variant: "primary-outline", label: raw("PNG") },
      preview: { variant: "default-outline", labelKey: "components.badge.reportTag.preview" },
    },
    fallback: { variant: "default-outline" },
  },

  // "Active" marker (OrgStorageSettings configured provider, …) — fixed solid
  // success + check icon. mode icon so the icon comes from the registry; the
  // i18n label is the slot. pill.
  activeFlag: {
    mode: "icon",
    shape: "pill",
    size: "sm",
    values: {},
    fallback: { variant: "success", icon: "check-circle", labelKey: "storage_settings.active" },
  },

  // Setup-card step chip (SetupCardRenderer) — required vs optional, with a
  // per-step dynamic icon (kept as the :icon prop). required→primary-soft,
  // optional→default-outline. mode icon, sm, pill.
  stepChip: {
    mode: "icon",
    shape: "pill",
    size: "sm",
    values: {
      required: { variant: "primary-soft" },
      optional: { variant: "default-outline" },
    },
    fallback: { variant: "default-outline" },
  },

  // Service-account kind (ServiceAccountsList) — system vs system-managed.
  // system→primary-outline (sm), managed→default-outline (md). pill.
  serviceAccountKind: {
    mode: "plain",
    shape: "pill",
    values: {
      system: {
        variant: "primary-outline",
        size: "sm",
        labelKey: "components.badge.serviceAccountKind.system",
      },
      managed: {
        variant: "default-outline",
        size: "md",
        labelKey: "serviceAccounts.row.managedBy",
      },
    },
    fallback: { variant: "default-outline" },
  },

  // Dashboard variable SCOPE (VariableSettings) — global vs tabs vs panels.
  // global→primary-soft, tabs/panels→primary-outline. pill; the count/label is
  // the slot (e.g. "3 Tabs").
  variableScope: {
    mode: "plain",
    shape: "pill",
    size: "sm",
    values: {
      global: { variant: "primary-soft", labelKey: "components.badge.variableScope.global" },
      // `tabs` / `panels` always render a caller-supplied count slot ("3 Tabs"),
      // so they carry colour only — no registry text to translate.
      tabs: { variant: "primary-outline" },
      panels: { variant: "primary-outline" },
    },
    fallback: { variant: "primary-outline" },
  },

  // Inline warning note (DashboardQueryEditor multi-query warning, …) — fixed
  // warning-soft + info icon; the message text is the slot. mode icon so the icon
  // comes from the registry. pill + sm.
  warningNote: {
    mode: "icon",
    shape: "rounded",
    size: "sm",
    values: {},
    fallback: { variant: "warning-soft", icon: "info-outline" },
  },

  // Selection token — removable chips in multi-select "selected-item" slots
  // (AnomalyAlerting destinations, etc.). Uniform neutral; the item name + remove
  // button are slots, styling comes from here. SOLID default + pill + sm to match
  // the old manual chips. Reusable across every multi-select token.
  selectionChip: {
    mode: "plain",
    shape: "pill",
    size: "sm",
    values: {},
    fallback: { variant: "default" },
  },

  // Field-name chips (ImportSemanticGroups dialogs) — decorative chips listing
  // field names. `highlight` = a group's member fields (primary), `muted` = the
  // "current/old" side of a compare (light grey). pill + sm.
  fieldNameChip: {
    mode: "plain",
    shape: "pill",
    size: "sm",
    values: {
      highlight: { variant: "primary" },
      muted: { variant: "default-soft" },
    },
    fallback: { variant: "default-soft" },
  },

  // Normalize state (ImportSemanticGroups) — boolean → colour + label.
  // true → primary "Normalized", false → default "Not Normalized". SOLID + pill + md.
  normalizeState: {
    mode: "plain",
    shape: "pill",
    size: "md",
    values: {
      true: { variant: "primary", labelKey: "components.badge.normalizeState.true" },
      false: { variant: "default", labelKey: "components.badge.normalizeState.false" },
    },
    fallback: { variant: "default", labelKey: "components.badge.normalizeState.fallback" },
  },

  // Field diff status (ImportSemanticGroups modification compare) — a proposed
  // field is either NEW (success) or already EXISTING (default). Plain colour
  // only; the leading field name + trailing "add" icon stay as slots. SOLID + pill + sm.
  fieldDiffStatus: {
    mode: "plain",
    shape: "pill",
    size: "sm",
    values: {
      new: { variant: "success" },
      existing: { variant: "default" },
    },
    fallback: { variant: "default" },
  },

  // Import diff summary categories (ImportSemanticGroups + …Drawer) — the diff
  // CATEGORY drives the colour (new→green, modified→amber, unchanged→grey); the
  // count + label are the slot. SOLID + pill + md; the count text sizing stays
  // per-call (`.summary-chip` font-size on the list page).
  diffCategory: {
    mode: "plain",
    shape: "pill",
    size: "md",
    values: {
      new: { variant: "success" },
      modified: { variant: "warning" },
      unchanged: { variant: "default" },
    },
    fallback: { variant: "default" },
  },

  // "Default" template marker (AlertsDestinationList) — fixed neutral flag.
  // SOLID `default` + pill + md. Label stays an i18n slot at the call site.
  templateDefaultFlag: {
    mode: "plain",
    shape: "pill",
    size: "md",
    values: {
      default: { variant: "default", labelKey: "alert_destinations.templateDefaultBadge" },
    },
    fallback: { variant: "default" },
  },

  // "Active version" marker in scorer / score-config version lists — dot +
  // success. i18n label lives in the registry (labelKey) so the component needs
  // no slot or per-instance :label.
  activeVersionFlag: {
    mode: "dot",
    shape: "pill",
    values: {
      active: {
        variant: "success-soft",
        labelKey: "onlineEvals.scoreConfig.detail.activeVersionChip",
      },
    },
    fallback: { variant: "success-soft" },
  },

  // Default LLM-provider marker (LlmProvidersSettings) — dot + success, i18n
  // label via labelKey.
  providerDefaultFlag: {
    mode: "dot",
    shape: "pill",
    values: {
      default: { variant: "success-soft", labelKey: "llmProviders.defaultBadge" },
    },
    fallback: { variant: "success-soft" },
  },

  // Readonly marker (AddDestination) — single fixed neutral flag. SOLID `default`
  // + pill + sm. Label stays an i18n slot at the call site.
  readonlyFlag: {
    mode: "plain",
    shape: "pill",
    size: "sm",
    values: {
      readonly: { variant: "default" },
    },
    fallback: { variant: "default" },
  },

  // Destination ORIGIN — prebuilt vs custom (AlertsDestinationList). Colour is the
  // prebuilt/custom distinction (NOT the specific type — that's `destinationType`);
  // the type NAME is passed as the slot label. SOLID variants + pill.
  destinationKind: {
    mode: "plain",
    shape: "pill",
    class: "text-xs",
    values: {
      prebuilt: { variant: "primary" },
      custom: { variant: "default" },
    },
    fallback: { variant: "default" },
  },

  // LLM provider type (LlmProvidersSettings) — anthropic/openai/… all share one
  // info-tint colour. rounded + sm; the (lowercased) type string is the slot.
  providerType: {
    mode: "plain",
    shape: "rounded",
    size: "sm",
    values: {},
    fallback: { variant: "blue-soft" },
  },

  // Enrichment table source — icon.
  enrichmentType: {
    mode: "icon",
    shape: "pill",
    values: {
      file: {
        variant: "blue-soft",
        icon: "description",
        labelKey: "components.badge.enrichmentType.file",
      },
      url: { variant: "teal-soft", icon: "cloud", labelKey: "components.badge.enrichmentType.url" },
    },
  },

  // Incident / correlation DIMENSION keys — colour a dimension chip by its key
  // name (k8s-cluster, k8s-namespace, service, env, …). Plain mode: the chip
  // draws its own key|value layout, only the colour is sourced from here.
  // Callers match exact-normalised first, then substring (so "k8s-cluster"
  // resolves via "cluster"), then hash for variety. Keep specific keys BEFORE
  // generic ones so substring matching favours the longer token.
  dimensionKey: {
    mode: "plain",
    shape: "rounded",
    values: {
      deployment: { variant: "blue-soft" },
      namespace: { variant: "orange-soft" },
      environment: { variant: "success-soft" },
      env: { variant: "success-soft" },
      hostname: { variant: "purple-soft" },
      host: { variant: "purple-soft" },
      servicename: { variant: "cyan-soft" },
      service: { variant: "cyan-soft" },
      region: { variant: "error-soft" },
      zone: { variant: "error-soft" },
      cluster: { variant: "indigo-soft" },
      pod: { variant: "teal-soft" },
      container: { variant: "error-soft" },
      application: { variant: "amber-soft" },
      app: { variant: "amber-soft" },
    },
  },

  // Generic enabled/yes/true vs disabled/no/false — dot.
  booleanState: {
    mode: "dot",
    shape: "pill",
    values: {
      true: { variant: "success-soft", labelKey: "components.badge.booleanState.yes" },
      yes: { variant: "success-soft", labelKey: "components.badge.booleanState.yes" },
      enabled: { variant: "success-soft", labelKey: "components.badge.booleanState.enabled" },
      on: { variant: "success-soft", labelKey: "components.badge.booleanState.on" },
      false: { variant: "default-soft", labelKey: "components.badge.booleanState.no" },
      no: { variant: "default-soft", labelKey: "components.badge.booleanState.no" },
      disabled: { variant: "default-soft", labelKey: "components.badge.booleanState.disabled" },
      off: { variant: "default-soft", labelKey: "components.badge.booleanState.off" },
    },
  },

  // ── Tracing ───────────────────────────────────────────────────────────────

  // Span / trace status — dot.
  // `OK` is the OTel status-code spec token and stays literal; the other two are
  // display words.
  spanStatus: {
    mode: "dot",
    shape: "pill",
    values: {
      ok: { variant: "success-soft", label: raw("OK") },
      success: { variant: "success-soft", labelKey: "common.success" },
      error: { variant: "error-soft", labelKey: "common.error" },
      unset: { variant: "default-soft", labelKey: "components.badge.spanStatus.unset" },
    },
  },

  // OpenTelemetry span kind — plain. Labels are the full words; consumers that
  // want the C/S/P/CO/I abbreviation should pass an explicit `label`.
  // Deliberately NOT translated: these are the OTel SpanKind spec terms.
  spanKind: {
    mode: "plain",
    shape: "rounded",
    size: "xs",
    values: {
      client: { variant: "blue-soft", label: raw("Client") },
      server: { variant: "purple-soft", label: raw("Server") },
      producer: { variant: "teal-soft", label: raw("Producer") },
      consumer: { variant: "amber-soft", label: raw("Consumer") },
      internal: { variant: "default-soft", label: raw("Internal") },
    },
  },

  // HTTP status CLASS — plain, ROUNDED (code/identifier chips read as
  // rectangles, not pills). NOTE: keys are buckets, not raw codes. Callers
  // must bucket a numeric code first via `httpStatusBucket(code)` (registry
  // keys are exact strings — they can't express the 200–599 ranges).
  httpStatus: {
    mode: "plain",
    shape: "rounded",
    values: {
      "2xx": { variant: "success-soft" },
      "3xx": { variant: "blue-soft" },
      "4xx": { variant: "warning-soft" },
      "5xx": { variant: "error-soft" },
    },
    fallback: { variant: "default-soft" },
  },

  // ── Online evals ────────────────────────────────────────────────────────

  // Scorer type — plain.
  scorerType: {
    mode: "plain",
    shape: "pill",
    size: "sm",
    values: {
      remote: { variant: "teal-soft", labelKey: "components.badge.scorerType.remote" },
      code: { variant: "purple-soft", labelKey: "components.badge.scorerType.code" },
      llmjudge: { variant: "blue-soft", labelKey: "components.badge.scorerType.llmjudge" },
      llm: { variant: "blue-soft", labelKey: "components.badge.scorerType.llm" },
    },
  },

  // Eval data type — plain.
  evalDataType: {
    mode: "plain",
    shape: "pill",
    values: {
      categorical: {
        variant: "purple-soft",
        labelKey: "components.badge.evalDataType.categorical",
      },
      boolean: { variant: "teal-soft", labelKey: "common.typeBoolean" },
      numeric: { variant: "blue-soft", labelKey: "components.badge.evalDataType.numeric" },
    },
  },

  // Threshold-declaration flag (Score Config detail → Healthy threshold section).
  // Muted, its own group so the label mapping stays scoped and never leaks into
  // the shared `fieldTag` chips.
  thresholdFlag: {
    mode: "plain",
    shape: "pill",
    values: {
      notdeclared: {
        variant: "default-soft",
        labelKey: "onlineEvals.scoreConfig.detail.noThreshold",
      },
    },
    fallback: { variant: "default-soft" },
  },

  // LLM observation type — plain, PILL. Many distinct semantic colours collapse
  // to SOLID success/primary/warning/error/default. Keys are normalised (no
  // underscores). NOTE: `getObservationTypeColor` still drives TraceDAG graph-node
  // fills — that is not a badge and is intentionally untouched.
  observationType: {
    mode: "plain",
    shape: "pill",
    values: {
      chat: { variant: "success" },
      textcompletion: { variant: "success" },
      generatecontent: { variant: "success" },
      embeddings: { variant: "primary" },
      invokeagent: { variant: "primary" },
      createagent: { variant: "primary" },
      executetool: { variant: "warning" },
      chain: { variant: "primary" },
      retrieval: { variant: "primary" },
      task: { variant: "primary" },
      evaluator: { variant: "primary" },
      invokeworkflow: { variant: "primary" },
      rerank: { variant: "primary" },
      guardrail: { variant: "error" },
      span: { variant: "default" },
      event: { variant: "warning" },
    },
    fallback: { variant: "default" },
  },

  // Enrichment URL-job status — dot, SOLID variants (completed→success,
  // failed→error, processing→primary).
  enrichmentJobStatus: {
    mode: "dot",
    shape: "pill",
    values: {
      completed: { variant: "success", labelKey: "components.badge.enrichmentJobStatus.completed" },
      failed: { variant: "error", labelKey: "components.badge.enrichmentJobStatus.failed" },
      processing: {
        variant: "primary",
        labelKey: "components.badge.enrichmentJobStatus.processing",
      },
    },
    fallback: { variant: "default" },
  },

  // Backfill job status — plain (no dot), SOLID variants. `deletionfailed` is the
  // deletion-overlay state the caller passes when deletion_status.failed is set.
  backfillJobStatus: {
    mode: "plain",
    shape: "pill",
    values: {
      running: { variant: "success" },
      completed: { variant: "success" },
      failed: { variant: "error" },
      pending: { variant: "warning" },
      canceled: { variant: "default" },
      deletionfailed: { variant: "error" },
    },
    fallback: { variant: "default" },
  },

  // Model source (TestModelMatchDialog) — plain. org → primary, meta_org →
  // default-outline, anything else (built-in) → default.
  modelSource: {
    mode: "plain",
    shape: "pill",
    values: {
      org: { variant: "primary" },
      metaorg: { variant: "default-outline" },
    },
    fallback: { variant: "default" },
  },

  // Evaluation verdict — icon.
  evaluationVerdict: {
    mode: "icon",
    shape: "pill",
    values: {
      pass: {
        variant: "success-soft",
        icon: "check-circle",
        labelKey: "components.badge.evaluationVerdict.pass",
      },
      fail: {
        variant: "error-soft",
        icon: "cancel",
        labelKey: "components.badge.evaluationVerdict.fail",
      },
      unknown: {
        variant: "default-soft",
        icon: "help-outline",
        labelKey: "components.badge.evaluationVerdict.unknown",
      },
    },
    fallback: { variant: "default-soft", icon: "help-outline" },
  },

  // ── Anomaly detection ─────────────────────────────────────────────────────

  // Anomaly-detection job status — dot (soft variants for table density).
  anomalyStatus: {
    mode: "dot",
    shape: "pill",
    values: {
      active: { variant: "success-soft", labelKey: "components.badge.anomalyStatus.active" },
      ready: { variant: "success-soft", labelKey: "components.badge.anomalyStatus.ready" },
      training: { variant: "blue-soft", labelKey: "components.badge.anomalyStatus.training" },
      failed: { variant: "error-soft", labelKey: "components.badge.anomalyStatus.failed" },
      waiting: { variant: "default-soft", labelKey: "components.badge.anomalyStatus.waiting" },
      disabled: { variant: "default-soft", labelKey: "components.badge.anomalyStatus.disabled" },
    },
  },

  // ── Misc lifecycle ────────────────────────────────────────────────────────

  // Backfill / async deletion job status — dot.
  deletionStatus: {
    mode: "dot",
    shape: "pill",
    values: {
      completed: { variant: "success-soft", labelKey: "components.badge.deletionStatus.completed" },
      inprogress: { variant: "blue-soft", labelKey: "components.badge.deletionStatus.inprogress" },
      pending: { variant: "warning-soft", labelKey: "components.badge.deletionStatus.pending" },
      failed: { variant: "error-soft", labelKey: "components.badge.deletionStatus.failed" },
    },
    fallback: { variant: "default-soft" },
  },

  // License validity — dot. Labels are i18n keys (resolved by OTag).
  licenseStatus: {
    mode: "dot",
    shape: "pill",
    values: {
      active: { variant: "success-soft", labelKey: "about.active_lbl" },
      valid: { variant: "success-soft", labelKey: "about.active_lbl" },
      expired: { variant: "error-soft", labelKey: "about.expired_lbl" },
    },
  },

  // RUM frustration EVENT type — plain.
  // (Frustration SEVERITY is count-derived → bucket the count yourself, then
  //  use the `severity` group; it can't be a value→variant entry.)
  frustrationEventType: {
    mode: "plain",
    shape: "pill",
    values: {
      rageclick: {
        variant: "warning-soft",
        labelKey: "components.badge.frustrationEventType.rageclick",
      },
      deadclick: {
        variant: "default-soft",
        labelKey: "components.badge.frustrationEventType.deadclick",
      },
      errorclick: {
        variant: "error-soft",
        labelKey: "components.badge.frustrationEventType.errorclick",
      },
      ragetap: {
        variant: "warning-soft",
        labelKey: "components.badge.frustrationEventType.ragetap",
      },
      errortap: {
        variant: "error-soft",
        labelKey: "components.badge.frustrationEventType.errortap",
      },
    },
  },

  // RUM frustration SEVERITY — dot. Component buckets the count → none/low/
  // medium/high, then passes it here.
  frustrationSeverity: {
    mode: "dot",
    shape: "pill",
    values: {
      none: { variant: "default-soft" },
      low: { variant: "warning-soft" },
      medium: { variant: "orange-soft" },
      high: { variant: "error-soft" },
    },
  },

  // Alert run state (alert history) — icon, PILL (status badge).
  //
  // The backend vocabulary is `firing | normal | succeeded | error |
  // notify_failed | skipped` (RunOutcome). The legacy values below
  // (`completed`, `condition_not_satisfied`, `failed`, `ok`, `success`) are kept
  // so history rows written before the rename still render, and can be dropped
  // once those rows age out of the triggers stream's retention window.
  alertState: {
    mode: "icon",
    shape: "pill",
    values: {
      // ── firing states ──
      firing: {
        variant: "error-soft",
        icon: "error-outline",
        labelKey: "components.badge.alertState.firing",
      },
      anomaly: {
        variant: "error-soft",
        icon: "error-outline",
        labelKey: "components.badge.alertState.anomaly",
      },
      // Condition matched but delivery failed — still a firing state, flagged
      // distinctly so a broken destination is visible.
      notifyfailed: {
        variant: "error-soft",
        icon: "sync-problem",
        labelKey: "components.badge.alertState.notifyfailed",
      },
      // LEGACY: `completed` meant "the alert fired" for condition-bearing
      // modules. It is a firing state — the previous green rendering
      // contradicted both the backend and the timeline aggregation.
      completed: {
        variant: "error-soft",
        icon: "error-outline",
        labelKey: "components.badge.alertState.firing",
      },

      // ── non-firing states ──
      // Explicit key, not the humanised (English-only) fallback: `conditionnotsatisfied`
      // below is the same state and must resolve the same key in every locale.
      normal: {
        variant: "success-soft",
        icon: "check-circle-outline",
        labelKey: "components.badge.alertState.normal",
      },
      succeeded: {
        variant: "success-soft",
        icon: "check-circle-outline",
        labelKey: "components.badge.alertState.succeeded",
      },
      // LEGACY aliases for `normal`.
      ok: {
        variant: "success-soft",
        icon: "check-circle-outline",
        labelKey: "components.badge.alertState.ok",
      },
      success: {
        variant: "success-soft",
        icon: "check-circle-outline",
        labelKey: "common.success",
      },
      conditionnotsatisfied: {
        variant: "success-soft",
        icon: "check-circle-outline",
        labelKey: "components.badge.alertState.normal",
      },

      // ── evaluation problems ──
      error: { variant: "error-soft", icon: "cancel", labelKey: "common.error" },
      failed: {
        variant: "error-soft",
        icon: "cancel",
        labelKey: "components.badge.alertState.failed",
      },

      // ── neither ──
      skipped: {
        variant: "warning-soft",
        icon: "block",
        labelKey: "components.badge.alertState.skipped",
      },
      flapping: {
        variant: "warning-soft",
        icon: "bolt",
        labelKey: "components.badge.alertState.flapping",
      },
      pending: {
        variant: "blue-soft",
        icon: "schedule",
        labelKey: "components.badge.alertState.pending",
      },
    },
    fallback: { variant: "default-soft", icon: "help-outline" },
  },

  // Recent-event result (overview) — plain. Failed/Firing run hot (red), Error
  // is the milder amber.
  eventStatus: {
    mode: "plain",
    shape: "pill",
    values: {
      failed: { variant: "error-soft", labelKey: "components.badge.eventStatus.failed" },
      firing: { variant: "error-soft", labelKey: "components.badge.eventStatus.firing" },
      error: { variant: "warning-soft", labelKey: "common.error" },
      // Same neutral tone the fallback gave it — declared explicitly so the word
      // is translated rather than humanised from the raw value.
      anomaly: { variant: "default-soft", labelKey: "components.badge.eventStatus.anomaly" },
    },
    fallback: { variant: "default-soft" },
  },

  // Incident correlation reason — plain. i18n labels.
  correlationReason: {
    mode: "plain",
    shape: "pill",
    values: {
      servicediscovery: {
        variant: "primary-soft",
        labelKey: "alerts.incidents.correlationServiceDiscovery",
      },
      primarymatch: {
        variant: "primary-soft",
        labelKey: "alerts.incidents.correlationPrimaryMatch",
      },
      secondarymatch: {
        variant: "warning-soft",
        labelKey: "alerts.incidents.correlationSecondaryMatch",
      },
      alertid: { variant: "default-soft", labelKey: "alerts.incidents.correlationAlertId" },
    },
    fallback: { variant: "default-soft" },
  },

  // AI toolset kind — plain.
  aiToolsetKind: {
    mode: "plain",
    shape: "pill",
    values: {
      // MCP / CLI are acronyms — identical in every locale.
      mcp: { variant: "primary-soft", label: raw("MCP") },
      cli: { variant: "success-soft", label: raw("CLI") },
      skill: { variant: "warning-soft", labelKey: "components.badge.aiToolsetKind.skill" },
      generic: { variant: "default-soft", labelKey: "components.badge.aiToolsetKind.generic" },
    },
    fallback: { variant: "default-soft" },
  },

  // Dimension cardinality class — dot, low→high heat.
  cardinalityClass: {
    mode: "dot",
    shape: "pill",
    values: {
      verylow: { variant: "success-soft", labelKey: "components.badge.cardinalityClass.verylow" },
      low: { variant: "success-soft", labelKey: "components.badge.cardinalityClass.low" },
      medium: { variant: "warning-soft", labelKey: "components.badge.cardinalityClass.medium" },
      high: { variant: "error-soft", labelKey: "components.badge.cardinalityClass.high" },
      veryhigh: { variant: "error-soft", labelKey: "components.badge.cardinalityClass.veryhigh" },
      unknown: { variant: "default-soft", labelKey: "common.unknown" },
    },
    fallback: { variant: "default-soft" },
  },

  // The two window-over-window states that are NOT a percentage. A fingerprint
  // absent from the previous window has no delta at all, and rendering it as
  // -100% would invert its meaning — so it gets a chip instead of a number.
  // Both stay neutral: an arrival is not itself an alarm.
  dbmDelta: {
    mode: "plain",
    shape: "rounded",
    size: "xs",
    values: {
      new: { variant: "blue-soft" },
      gone: { variant: "default-soft" },
    },
    fallback: { variant: "default-soft" },
  },

  // Database engine, from the OTel `db.system` value. Identity colour, not
  // severity — an engine is never "bad", so the palette is decorative-soft and
  // each engine keeps one colour everywhere it appears. Unregistered engines
  // fall through to the humanised generic chip, which is correct: `db.system`
  // is an open vocabulary and a new engine must still render.
  dbSystem: {
    mode: "plain",
    shape: "rounded",
    size: "xs",
    values: {
      postgresql: { variant: "blue-soft", label: raw("PostgreSQL") },
      mysql: { variant: "orange-soft", label: raw("MySQL") },
      mariadb: { variant: "orange-soft", label: raw("MariaDB") },
      mssql: { variant: "error-soft", label: raw("SQL Server") },
      oracle: { variant: "error-soft", label: raw("Oracle") },
      mongodb: { variant: "success-soft", label: raw("MongoDB") },
      redis: { variant: "error-soft", label: raw("Redis") },
      elasticsearch: { variant: "amber-soft", label: raw("Elasticsearch") },
      cassandra: { variant: "indigo-soft", label: raw("Cassandra") },
      clickhouse: { variant: "amber-soft", label: raw("ClickHouse") },
      cockroachdb: { variant: "teal-soft", label: raw("CockroachDB") },
      dynamodb: { variant: "blue-soft", label: raw("DynamoDB") },
      sqlite: { variant: "default-soft", label: raw("SQLite") },
      snowflake: { variant: "teal-soft", label: raw("Snowflake") },
      spanner: { variant: "indigo-soft", label: raw("Spanner") },
    },
    fallback: { variant: "default-soft" },
  },

  // Service-graph latency/error delta vs baseline — plain.
  // How far a shown number can be trusted. Only `gap` is red — it is the one
  // state that means data is MISSING rather than approximate, and a tinted chip
  // on every view would signal nothing.
  dataConfidence: {
    mode: "plain",
    shape: "rounded",
    size: "xs",
    values: {
      estimated: {
        variant: "default-soft",
        labelKey: "components.badge.dataConfidence.estimated",
      },
      topnsubset: {
        variant: "amber-soft",
        labelKey: "components.badge.dataConfidence.topNSubset",
      },
      live: { variant: "blue-soft", labelKey: "components.badge.dataConfidence.live" },
      belowtopn: {
        variant: "default-soft",
        labelKey: "components.badge.dataConfidence.belowTopN",
      },
      truncated: {
        variant: "amber-soft",
        labelKey: "components.badge.dataConfidence.truncated",
      },
      gap: { variant: "error-soft", labelKey: "components.badge.dataConfidence.gap" },
    },
    fallback: { variant: "default-soft" },
  },

  deltaTrend: {
    mode: "plain",
    shape: "rounded",
    values: {
      improved: { variant: "success-soft" },
      slight: { variant: "teal-soft" },
      neutral: { variant: "default-soft" },
      warning: { variant: "warning-soft" },
      critical: { variant: "error-soft" },
    },
    fallback: { variant: "default-soft" },
  },

  // Online-eval RUN status (per-record) — dot, PILL.
  evalRunStatus: {
    mode: "dot",
    shape: "pill",
    values: {
      success: { variant: "success-soft", labelKey: "common.success" },
      // `OK` is a protocol token — same in every locale.
      ok: { variant: "success-soft", label: raw("OK") },
      error: { variant: "error-soft", labelKey: "common.error" },
      timeout: { variant: "warning-soft", labelKey: "components.badge.evalRunStatus.timeout" },
      skipped: { variant: "default-soft", labelKey: "components.badge.evalRunStatus.skipped" },
      warn: { variant: "warning-soft", labelKey: "components.badge.evalRunStatus.warn" },
      bad: { variant: "error-soft", labelKey: "components.badge.evalRunStatus.bad" },
    },
    fallback: { variant: "default-soft" },
  },

  // LLM session outcome (derived from error_count) — dot + soft colour.
  sessionStatus: {
    mode: "dot",
    shape: "pill",
    values: {
      ok: { variant: "success-soft", labelKey: "components.badge.sessionStatus.ok" },
      error: { variant: "error-soft", labelKey: "components.badge.sessionStatus.error" },
    },
    fallback: { variant: "default-soft" },
  },

  qualityStatus: {
    mode: "dot",
    shape: "pill",
    class: "!bg-transparent !p-0 !ring-0",
    values: {
      healthy: { variant: "success-soft", labelKey: "components.badge.qualityStatus.healthy" },
      warn: { variant: "warning-soft", labelKey: "components.badge.qualityStatus.warn" },
      unhealthy: { variant: "error-soft", labelKey: "components.badge.qualityStatus.unhealthy" },
      nothreshold: {
        variant: "default-soft",
        labelKey: "components.badge.qualityStatus.nothreshold",
      },
      nodata: { variant: "default-soft", labelKey: "components.badge.qualityStatus.nodata" },
    },
    fallback: { variant: "default-soft" },
  },

  // Eval job preview mode — plain.
  jobPreviewState: {
    mode: "plain",
    shape: "pill",
    values: {
      draft: {
        variant: "default-soft",
        labelKey: "onlineEvals.job.preview.statusDraft",
      },
      editing: {
        variant: "blue-soft",
        labelKey: "onlineEvals.job.preview.statusEditing",
      },
    },
    fallback: { variant: "default-soft" },
  },

  // RUM event type — plain.
  rumEventType: {
    mode: "plain",
    shape: "rounded",
    values: {
      view: { variant: "blue-soft", labelKey: "components.badge.rumEventType.view" },
      action: { variant: "purple-soft", labelKey: "components.badge.rumEventType.action" },
      error: { variant: "error-soft", labelKey: "common.error" },
      resource: { variant: "teal-soft", labelKey: "components.badge.rumEventType.resource" },
      longtask: { variant: "warning-soft", labelKey: "components.badge.rumEventType.longtask" },
    },
    fallback: { variant: "default-soft" },
  },

  // Cross-link source — plain.
  crossLinkSource: {
    mode: "plain",
    shape: "pill",
    values: {
      stream: { variant: "primary-soft", labelKey: "components.badge.crossLinkSource.stream" },
      global: { variant: "default-soft", labelKey: "components.badge.crossLinkSource.global" },
    },
    fallback: { variant: "default-soft" },
  },

  // Subscription plan — PILL (plan/marketing badge).
  subscriptionPlan: {
    mode: "plain",
    shape: "pill",
    values: {
      free: { variant: "default-soft", labelKey: "components.badge.subscriptionPlan.free" },
      payasyougo: {
        variant: "blue-soft",
        labelKey: "components.badge.subscriptionPlan.payasyougo",
      },
      enterprise: {
        variant: "purple-soft",
        labelKey: "components.badge.subscriptionPlan.enterprise",
      },
    },
    fallback: { variant: "default-soft" },
  },

  // Synthetic monitor type — plain, PILL.
  syntheticType: {
    mode: "plain",
    shape: "pill",
    size: "sm",
    values: {
      // HTTP / API / TCP / DNS are protocol acronyms — identical in every locale.
      http: { variant: "blue-soft", label: raw("HTTP") },
      browser: { variant: "purple-soft", labelKey: "components.badge.syntheticType.browser" },
      api: { variant: "success-soft", label: raw("API") },
      tcp: { variant: "orange-soft", label: raw("TCP") },
      ping: { variant: "default-soft", labelKey: "components.badge.syntheticType.ping" },
      dns: { variant: "amber-soft", label: raw("DNS") },
    },
  },

  // Billing AI usage mode — PILL. i18n labels.
  aiMode: {
    mode: "plain",
    shape: "pill",
    values: {
      payasyougo: { variant: "primary-soft", labelKey: "billing.aiModePayAsYouGo" },
      exhausted: { variant: "error-soft", labelKey: "billing.aiModeExhausted" },
      free: { variant: "success-soft", labelKey: "billing.aiModeFree" },
    },
    fallback: { variant: "success-soft", labelKey: "billing.aiModeFree" },
  },

  // Billing-group member status — dot, PILL. i18n labels.
  billingGroupMemberStatus: {
    mode: "dot",
    shape: "pill",
    values: {
      active: { variant: "success-soft", labelKey: "billing.billingGroup.statusActive" },
      pending: { variant: "warning-soft", labelKey: "billing.billingGroup.statusPending" },
    },
    fallback: { variant: "warning-soft", labelKey: "billing.billingGroup.statusPending" },
  },

  // Billing management channel — PILL.
  billingManagement: {
    mode: "plain",
    shape: "pill",
    class: "px-3 py-2",
    values: {
      aws: { variant: "success-soft", labelKey: "components.badge.billingManagement.aws" },
      azure: { variant: "success-soft", labelKey: "components.badge.billingManagement.azure" },
      stripe: { variant: "default-soft", label: raw("Stripe") },
      contract: {
        variant: "default-soft",
        labelKey: "components.badge.billingManagement.contract",
      },
    },
    fallback: { variant: "default-soft" },
  },

  // "Applied" indicator (e.g. the active predefined theme) — icon + PILL.
  themeApplied: {
    mode: "icon",
    shape: "pill",
    size: "sm",
    values: {
      applied: {
        variant: "success-soft",
        icon: "check-circle",
        labelKey: "components.badge.themeApplied.applied",
      },
    },
    fallback: {
      variant: "success-soft",
      icon: "check-circle",
      labelKey: "components.badge.themeApplied.fallback",
    },
  },

  // Feature flags — PILL, extra-small (compact BETA / HA / Coming Soon chips).
  featureFlag: {
    mode: "plain",
    shape: "pill",
    size: "xs",
    values: {
      beta: { variant: "primary-soft", label: raw("BETA") },
      ha: { variant: "primary-soft", label: raw("HA") },
      comingsoon: { variant: "default-soft", labelKey: "components.badge.featureFlag.comingsoon" },
    },
    fallback: { variant: "default-soft" },
  },
} satisfies Record<string, BadgeGroupConfig>;

export type BadgeGroupName = keyof typeof BADGE_GROUPS;

export interface ResolvedBadge {
  variant: BadgeVariant;
  label: I18nText;
  /** i18n key for the label, if the matched value declared one. `OTag`
   *  translates this when no explicit `label` is supplied. */
  labelKey?: I18nKey;
  icon?: string;
  dot: boolean;
  mode: BadgeRenderMode;
  /** Group-declared size. May be undefined — the caller then falls back to its
   *  own default. */
  size?: BadgeSize;
  /** Group-declared shape (pill | rounded | square). May be undefined → the
   *  caller falls back to its own default ("pill"). */
  shape?: BadgeShape;
  /** Group-declared extra utility classes, merged onto the badge by `OTag`. */
  class?: string;
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
  // `raw` is the imported i18n opt-out, so the local value keeps a distinct name.
  const rawValue = String(value ?? "").trim();
  const key = normalizeKey(value);
  const cfg = group ? (BADGE_GROUPS as Record<string, BadgeGroupConfig>)[group] : undefined;

  // No registered group → generic semantic mapping, dot presentation.
  if (!cfg) {
    const generic = statusVariant(value);
    return {
      variant: generic.variant,
      label: raw(rawValue ? humanize(rawValue) : "—"),
      dot: true,
      mode: "dot",
    };
  }

  const entry = cfg.values[key] ?? cfg.fallback ?? genericEntry(value);
  const mode = entry.dot === true ? "dot" : cfg.mode;

  return {
    variant: entry.variant,
    label: entry.label ?? raw(rawValue ? humanize(rawValue) : "—"),
    labelKey: entry.labelKey,
    icon: mode === "icon" ? entry.icon : undefined,
    dot: entry.dot ?? mode === "dot",
    mode,
    // Per-value size wins over group size; both may be undefined → caller default.
    size: entry.size ?? cfg.size,
    shape: cfg.shape,
    class: cfg.class,
  };
}

/**
 * The label `OTag` would render, for callers that use `<OBadge>` directly.
 *
 * `resolveBadge().label` deliberately does NOT resolve `labelKey` — it returns
 * the literal label or the humanised value. Reading `.label` straight from it
 * therefore renders English even when the entry has a `labelKey`. This applies
 * the same precedence OTag does (labelKey → literal label → humanised), so the
 * two paths cannot drift.
 */
export function resolveBadgeLabel(group: string, value: unknown): I18nText {
  const resolved = resolveBadge(group, value);
  return resolved.labelKey ? (translateBadgeLabel(resolved.labelKey) as I18nText) : resolved.label;
}

/** Generic single-value fallback derived from the semantic engine. */
function genericEntry(value: unknown): BadgeValueConfig {
  return { variant: statusVariant(value).variant };
}

/** Soft fallback palette for dimension keys not present in the registry. */
const DIMENSION_FALLBACK_VARIANTS: BadgeVariant[] = [
  "default-soft",
  "amber-soft",
  "purple-soft",
  "blue-soft",
  "teal-soft",
  "indigo-soft",
];

/**
 * Resolve a correlation/incident DIMENSION key (k8s-cluster, service, env, …)
 * to a soft colour variant. Exact-normalised match first, then substring (so
 * "k8s-cluster" resolves via "cluster"), then a stable hash over the palette so
 * unknown keys still get a consistent colour. Single source of truth for the
 * key|value dimension chip rendered in the incident list AND the correlation
 * "Correlated by:" chips, so the same dimension is the same colour in both.
 */
export function dimensionVariant(key: string): BadgeVariant {
  const values = BADGE_GROUPS.dimensionKey.values as Record<string, BadgeValueConfig>;
  const nk = normalizeKey(key);
  if (values[nk]) return values[nk].variant;
  for (const [pattern, cfg] of Object.entries(values)) {
    if (nk.includes(pattern)) return cfg.variant;
  }
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash = hash & hash;
  }
  return DIMENSION_FALLBACK_VARIANTS[Math.abs(hash) % DIMENSION_FALLBACK_VARIANTS.length];
}

/**
 * Bucket a numeric HTTP status code into the registry key the `httpStatus`
 * group expects ("2xx" | "3xx" | "4xx" | "5xx"). The registry matches exact
 * strings, so a RANGE (200–299 → success) can't be a value entry — bucket
 * first, then render:  <OTag type="httpStatus" :value="httpStatusBucket(code)" :label="String(code)" />
 * Returns "" for missing / out-of-range codes (→ the group's neutral fallback).
 */
export function httpStatusBucket(code: unknown): string {
  const n = typeof code === "number" ? code : parseInt(String(code ?? ""), 10);
  if (!Number.isFinite(n) || n < 100 || n > 599) return "";
  return `${Math.floor(n / 100)}xx`;
}

/**
 * gRPC status: 0 = OK, anything else = error. Returns the `spanStatus` key.
 *   <OTag type="spanStatus" :value="grpcStatusKey(code)" />
 */
export function grpcStatusKey(code: unknown): "ok" | "error" {
  const n = typeof code === "number" ? code : parseInt(String(code ?? ""), 10);
  return n === 0 ? "ok" : "error";
}
