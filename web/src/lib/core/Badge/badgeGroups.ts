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
//     <OTag type="alertType"   value="realtime" />   → neutral chip + bolt icon
//     <OTag type="alertStatus" value="active"   />   → ok chip + leading dot
//     <OTag type="logLevel"    value="error"    />   → err chip (status tones always get a dot)
//
// A "group" is a family of related values (e.g. all alert statuses). Each
// group declares:
//   • mode  — how the whole family renders: "icon" | "dot" | "plain"
//   • values — per-value { tone, icon?, label?, dot? } overrides
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

import type { ChipTone, ChipSize } from "./OBadge.types";
import { statusVariant } from "@/lib/core/Table/cells/statusVariant";
import { translateBadgeLabel } from "./badgeI18n";

/** How a badge presents its leading affordance. */
export type BadgeRenderMode = "icon" | "dot" | "plain";

export interface BadgeValueConfig {
  /** Chip tone; categories stay neutral or outline, status colours mean status only. */
  tone: ChipTone;
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
  size?: ChipSize;
}

export interface BadgeGroupConfig {
  /** Default presentation for every value in the group. */
  mode: BadgeRenderMode;
  /** Default size for this group's badges. */
  size?: ChipSize;
  /** Per-value configuration, keyed by the NORMALISED value (see normalizeKey). */
  values: Record<string, BadgeValueConfig>;
  /** Rendered when a value isn't in `values`. Defaults to a neutral plain badge. */
  fallback?: BadgeValueConfig;
  /** Extra utility classes merged onto every badge in this group, for a group-wide look
   *  that tone and size do not capture (e.g. a bare dot-and-word status). */
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
  versionVerdict: {
    mode: "plain",
    values: {
      ok: { tone: "ok", labelKey: "serviceVersions.verdict.ok" },
      watch: { tone: "warn", labelKey: "serviceVersions.verdict.watch" },
      regressed: { tone: "err", labelKey: "serviceVersions.verdict.regressed" },
      insufficient: { tone: "neutral", labelKey: "serviceVersions.verdict.insufficient" },
      firstversion: { tone: "neutral", labelKey: "serviceVersions.verdict.firstVersion" },
      preexisting: { tone: "neutral", labelKey: "serviceVersions.verdict.preExisting" },
      notserving: { tone: "outline", labelKey: "serviceVersions.verdict.notServing" },
      capped: { tone: "neutral", labelKey: "serviceVersions.verdict.capped" },
      restricted: { tone: "neutral", labelKey: "serviceVersions.verdict.restricted" },
      rollbackrecovered: {
        tone: "ok",
        labelKey: "serviceVersions.verdict.rollbackRecovered",
        icon: "undo",
      },
      rollbackstillworse: {
        tone: "warn",
        labelKey: "serviceVersions.verdict.rollbackStillWorse",
        icon: "undo",
      },
    },
  },
  serviceEnvSource: {
    mode: "plain",
    values: {
      attribute: { tone: "neutral", labelKey: "serviceVersions.env.attribute" },
      rum: { tone: "neutral", labelKey: "serviceVersions.env.rum" },
      override: { tone: "neutral", labelKey: "serviceVersions.env.override" },
      namespace: { tone: "neutral", labelKey: "serviceVersions.env.namespace" },
      cluster: { tone: "neutral", labelKey: "serviceVersions.env.cluster" },
      workload: { tone: "neutral", labelKey: "serviceVersions.env.workload" },
      clustername: { tone: "neutral", labelKey: "serviceVersions.env.clusterName" },
      namespacename: { tone: "neutral", labelKey: "serviceVersions.env.namespaceName" },
      default: { tone: "neutral", labelKey: "serviceVersions.env.default" },
    },
  },
  cwvBand: {
    mode: "plain",
    values: {
      good: { tone: "ok", labelKey: "serviceVersions.compare.cwv.good" },
      needsimprovement: { tone: "warn", labelKey: "serviceVersions.compare.cwv.ni" },
      poor: { tone: "err", labelKey: "serviceVersions.compare.cwv.poor" },
    },
  },
  aliasConfidence: {
    mode: "plain",
    values: {
      high: { tone: "ok", labelKey: "serviceVersions.nameReview.confidence.high" },
      medium: { tone: "warn", labelKey: "serviceVersions.nameReview.confidence.medium" },
      low: { tone: "neutral", labelKey: "serviceVersions.nameReview.confidence.low" },
    },
  },
  aliasStatus: {
    mode: "plain",
    values: {
      proposed: { tone: "info", labelKey: "serviceVersions.nameReview.status.proposed" },
      active: { tone: "ok", labelKey: "serviceVersions.nameReview.status.active" },
      rejected: { tone: "neutral", labelKey: "serviceVersions.nameReview.status.rejected" },
    },
  },

  // Alerts: scheduled vs real-time vs anomaly — a category, so neutral; the icon tells them apart.
  alertType: {
    mode: "icon",
    values: {
      scheduled: {
        tone: "neutral",
        icon: "schedule",
        labelKey: "components.badge.alertType.scheduled",
      },
      realtime: {
        tone: "neutral",
        icon: "bolt",
        labelKey: "components.badge.alertType.realtime",
      },
      anomalydetection: {
        tone: "neutral",
        icon: "query-stats",
        labelKey: "components.badge.alertType.anomalydetection",
      },
      composite: {
        tone: "neutral",
        icon: "account-tree",
        labelKey: "components.badge.alertType.composite",
      },
      slo: {
        tone: "neutral",
        icon: "monitor-heart",
        labelKey: "components.badge.alertType.slo",
      },
    },
  },

  // Alert run status — coloured DOT, no icon.
  alertStatus: {
    mode: "dot",
    values: {
      active: { tone: "ok", labelKey: "components.badge.alertStatus.active" },
      // Every anomaly config starts here and stays until its first model trains.
      waiting: { tone: "neutral", labelKey: "components.badge.alertStatus.waiting" },
      ready: { tone: "ok", labelKey: "components.badge.alertStatus.ready" },
      running: { tone: "info", labelKey: "components.badge.alertStatus.running" },
      training: { tone: "warn", labelKey: "components.badge.alertStatus.training" },
      failed: { tone: "err", labelKey: "components.badge.alertStatus.failed" },
      disabled: { tone: "neutral", labelKey: "components.badge.alertStatus.disabled" },
      // Expected data states of an anomaly config: enabled and re-evaluated, so never error colours.
      waitingfordata: {
        tone: "neutral",
        labelKey: "components.badge.alertStatus.waitingForData",
      },
      notapplicable: {
        tone: "neutral",
        labelKey: "components.badge.alertStatus.notApplicable",
      },
      paused: { tone: "warn", labelKey: "components.badge.alertStatus.paused" },
    },
  },

  // Public dashboard link state, derived server-side; only live is green so exceptions stand out.
  publicLinkStatus: {
    mode: "dot",
    values: {
      live: { tone: "ok", labelKey: "components.badge.publicLinkStatus.live" },
      paused: { tone: "neutral", labelKey: "components.badge.publicLinkStatus.paused" },
      notviewed: {
        tone: "neutral",
        labelKey: "components.badge.publicLinkStatus.notViewed",
      },
      needsattention: {
        tone: "warn",
        labelKey: "components.badge.publicLinkStatus.needsAttention",
      },
      expired: { tone: "neutral", labelKey: "components.badge.publicLinkStatus.expired" },
      dashboarddeleted: {
        tone: "err",
        labelKey: "components.badge.publicLinkStatus.dashboardDeleted",
      },
      // The organization has public links turned off.
      disabled: { tone: "neutral", labelKey: "components.badge.publicLinkStatus.disabled" },
    },
  },

  // One chip per downtime target, plus the shared condition. The caller always supplies the label.
  downtimeTarget: {
    mode: "icon",
    values: {
      condition: { tone: "accent", icon: "tune" },
      group: { tone: "accent", icon: "bar-chart" },
      alerts: { tone: "neutral", icon: "shield-alert-outline" },
      anomalydetections: { tone: "neutral", icon: "query-stats" },
      synthetics: { tone: "neutral", icon: "radar" },
      slos: { tone: "neutral", icon: "target" },
    },
  },

  // Downtime lifecycle. Active is amber, not green: notifications are off while it runs.
  downtimeStatus: {
    mode: "dot",
    values: {
      scheduled: { tone: "info", labelKey: "components.badge.downtimeStatus.scheduled" },
      active: { tone: "warn", labelKey: "components.badge.downtimeStatus.active" },
      ended: { tone: "neutral", labelKey: "components.badge.downtimeStatus.ended" },
      cancelled: {
        tone: "outline",
        labelKey: "components.badge.downtimeStatus.cancelled",
      },
      endedearly: {
        tone: "neutral",
        labelKey: "components.badge.downtimeStatus.endedEarly",
      },
    },
  },

  licenseWaiverStatus: {
    mode: "dot",
    values: {
      scheduled: {
        tone: "info",
        labelKey: "components.badge.licenseWaiverStatus.scheduled",
      },
      active: { tone: "ok", labelKey: "components.badge.licenseWaiverStatus.active" },
      past: { tone: "neutral", labelKey: "components.badge.licenseWaiverStatus.past" },
      ended: { tone: "neutral", labelKey: "components.badge.licenseWaiverStatus.ended" },
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
    values: {
      p1: { tone: "err", label: raw("P1") },
      p2: { tone: "warn", label: raw("P2") },
      p3: { tone: "warn", label: raw("P3") },
      p4: { tone: "neutral", label: raw("P4") },
      p5: { tone: "neutral", label: raw("P5") },
    },
    fallback: { tone: "neutral" },
  },

  // On-call RESPONSE state — where a page is in its life, not how bad it is.
  //
  // Distinct from `alertState`: an alert can be firing while its page is
  // acknowledged. Triaged is the agent having looked without taking the ball,
  // so it stays warm rather than reading as owned.
  oncallResponseState: {
    mode: "dot",
    values: {
      triggered: { tone: "err", labelKey: "oncall.state_triggered" },
      triaged: { tone: "warn", labelKey: "oncall.state_triaged" },
      acknowledged: { tone: "info", labelKey: "oncall.state_acknowledged" },
      resolved: { tone: "ok", labelKey: "oncall.state_resolved" },
      exhausted: { tone: "err", labelKey: "oncall.state_exhausted" },
    },
    fallback: { tone: "neutral" },
  },

  // Whether a team would reach anybody if something broke right now.
  //
  // Rostered and reachable are two different questions, and a team can pass the
  // first while failing the second — somebody is on the rota, and no transport
  // exists to wake them. A green `Covered` beside "no page can be delivered to
  // anyone" told the reader the team was fine, so the third value exists to say
  // which half is true.
  oncallCoverage: {
    mode: "dot",
    values: {
      covered: { tone: "ok", labelKey: "oncall.coverage_covered" },
      gap: { tone: "err", labelKey: "oncall.coverage_gap" },
      unreachable: { tone: "warn", labelKey: "oncall.coverage_cantReach" },
      allunreachable: { tone: "err", labelKey: "oncall.coverage_unreachable" },
    },
    fallback: { tone: "neutral" },
  },

  // A routing rule's traffic verdict, from `ownership/stats`; never recomputed on the client.
  oncallRuleHealth: {
    mode: "dot",
    values: {
      active: { tone: "ok", labelKey: "oncall.ruleActive" },
      shadowed: { tone: "warn", labelKey: "oncall.ruleShadowed" },
      neverused: { tone: "neutral", labelKey: "oncall.ruleNeverMatchedYet" },
    },
    fallback: { tone: "neutral" },
  },

  // Where an unowned signal landed: the catch-all paged somebody, or nobody was paged at all.
  oncallUnroutedOutcome: {
    mode: "dot",
    values: {
      defaultteam: { tone: "warn", labelKey: "oncall.unroutedFilterDefault" },
      nobody: { tone: "err", labelKey: "oncall.unroutedPagedNobody" },
    },
    fallback: { tone: "neutral" },
  },

  // Alert severity LEVEL (alerts_2.md Feature 1) — dot.
  //
  // A separate axis from `alertState` above, which renders the run OUTCOME
  // ("did it fire?"). This renders "how bad?". An alert can be `firing` at
  // `warning`, so the two badges can and do appear side by side.
  alertLevel: {
    mode: "dot",
    values: {
      critical: { tone: "err", labelKey: "components.badge.alertLevel.critical" },
      warning: { tone: "warn", labelKey: "components.badge.alertLevel.warning" },
      ok: { tone: "ok", labelKey: "components.badge.alertLevel.ok" },
      // Reserved: the policy that produces it ships in Phase 2. Neutral rather
      // than warning-coloured — "we don't know" is not "we know it's bad".
      nodata: { tone: "neutral", labelKey: "components.badge.alertLevel.nodata" },
    },
    fallback: { tone: "neutral" },
  },

  // Incident lifecycle. Labels are i18n keys (resolved by OTag).
  incidentStatus: {
    mode: "dot",
    values: {
      open: { tone: "err", labelKey: "alerts.incidents.statusOpen" },
      firing: { tone: "err", labelKey: "components.badge.incidentStatus.firing" },
      acknowledged: { tone: "warn", labelKey: "alerts.incidents.statusAcknowledged" },
      resolved: { tone: "ok", labelKey: "alerts.incidents.statusResolved" },
      closed: { tone: "neutral", labelKey: "components.badge.incidentStatus.closed" },
    },
  },

  // Severity scale — dot, ordered hot→cold. P1–P4 are aliases so incident
  // severities (P1/P2/P3/P4) resolve to the same colours as critical→low.
  severity: {
    mode: "dot",
    values: {
      critical: { tone: "crit", labelKey: "components.badge.severity.critical" },
      high: { tone: "err", labelKey: "components.badge.severity.high" },
      medium: { tone: "warn", labelKey: "components.badge.severity.medium" },
      low: { tone: "neutral", labelKey: "components.badge.severity.low" },
      info: { tone: "neutral", labelKey: "components.badge.severity.info" },
      p1: { tone: "crit", label: raw("P1") },
      p2: { tone: "err", label: raw("P2") },
      p3: { tone: "warn", label: raw("P3") },
      p4: { tone: "neutral", label: raw("P4") },
    },
  },

  // Log levels — plain; status tones still get their dot from OTag.
  logLevel: {
    mode: "plain",
    values: {
      trace: { tone: "neutral", labelKey: "components.badge.logLevel.trace" },
      debug: { tone: "neutral", labelKey: "components.badge.logLevel.debug" },
      info: { tone: "neutral", labelKey: "components.badge.logLevel.info" },
      warn: { tone: "warn", labelKey: "components.badge.logLevel.warn" },
      warning: { tone: "warn", labelKey: "components.badge.logLevel.warn" },
      error: { tone: "err", labelKey: "common.error" },
      fatal: { tone: "crit", labelKey: "components.badge.logLevel.fatal" },
      emergency: { tone: "crit", labelKey: "components.badge.logLevel.emergency" },
      alert: { tone: "err", labelKey: "components.badge.logLevel.alert" },
      critical: { tone: "crit", labelKey: "components.badge.logLevel.critical" },
      notice: { tone: "neutral", labelKey: "components.badge.logLevel.notice" },
      ok: { tone: "ok", labelKey: "components.badge.logLevel.ok" },
      unknown: { tone: "neutral", labelKey: "components.badge.logLevel.unknown" },
    },
  },

  // Pipelines: realtime vs scheduled — icon.
  pipelineType: {
    mode: "icon",
    values: {
      realtime: {
        tone: "neutral",
        icon: "bolt",
        labelKey: "components.badge.pipelineType.realtime",
      },
      scheduled: {
        tone: "neutral",
        icon: "schedule",
        labelKey: "components.badge.pipelineType.scheduled",
      },
    },
  },

  // Stream types — icon, mirrors the stream-type filter chips.
  streamType: {
    mode: "icon",
    values: {
      logs: { tone: "neutral", icon: "search", labelKey: "settings.correlation.logs" },
      metrics: {
        tone: "neutral",
        icon: "bar-chart",
        labelKey: "settings.correlation.metrics",
      },
      traces: {
        tone: "neutral",
        icon: "account-tree",
        labelKey: "settings.correlation.traces",
      },
      metadata: {
        tone: "neutral",
        icon: "info",
        labelKey: "components.badge.streamType.metadata",
      },
      enrichmenttables: {
        tone: "neutral",
        icon: "database",
        labelKey: "components.badge.streamType.enrichment",
      },
      index: {
        tone: "neutral",
        icon: "database",
        labelKey: "components.badge.streamType.index",
      },
    },
  },

  // Invoice status (Stripe) — dot. "open" is informational here, not a warning.
  invoiceStatus: {
    mode: "dot",
    values: {
      paid: { tone: "ok", labelKey: "components.badge.invoiceStatus.paid" },
      open: { tone: "info", labelKey: "components.badge.invoiceStatus.open" },
      draft: { tone: "neutral", labelKey: "components.badge.invoiceStatus.draft" },
      void: { tone: "neutral", labelKey: "components.badge.invoiceStatus.void" },
      uncollectible: {
        tone: "err",
        labelKey: "components.badge.invoiceStatus.uncollectible",
      },
      pending: { tone: "warn", labelKey: "components.badge.invoiceStatus.pending" },
    },
  },

  // Online-eval job status — dot.
  evalStatus: {
    mode: "dot",
    values: {
      active: { tone: "ok" },
      draft: { tone: "neutral" },
      paused: { tone: "warn" },
      archived: { tone: "neutral" },
    },
  },

  // No labelKeys: EvalJobList always passes the translated `label`.
  evalJobHealth: {
    mode: "dot",
    values: {
      healthy: { tone: "ok" },
      degraded: { tone: "warn" },
      waitingforcredentials: { tone: "err" },
      norecentruns: { tone: "neutral" },
    },
  },

  // Running-query status — dot.
  queryStatus: {
    mode: "dot",
    values: {
      running: { tone: "info", labelKey: "components.badge.queryStatus.running" },
      processing: { tone: "info", labelKey: "components.badge.queryStatus.processing" },
      pending: { tone: "warn", labelKey: "components.badge.queryStatus.pending" },
      queued: { tone: "warn", labelKey: "components.badge.queryStatus.queued" },
      waiting: { tone: "warn", labelKey: "components.badge.queryStatus.waiting" },
      completed: { tone: "ok", labelKey: "components.badge.queryStatus.completed" },
      finished: { tone: "ok", labelKey: "components.badge.queryStatus.finished" },
      failed: { tone: "err", labelKey: "components.badge.queryStatus.failed" },
      // Both spellings are in the wild; each keeps the exact word it renders today.
      cancelled: { tone: "neutral", labelKey: "components.badge.queryStatus.cancelled" },
      canceled: { tone: "neutral", labelKey: "components.badge.queryStatus.canceled" },
    },
  },

  // Pipeline execution outcome — dot.
  //
  // `RunOutcome` replaced the legacy trigger status vocabulary for every
  // scheduler-backed module. Pipeline history must accept both generations
  // while old rows remain in the triggers stream.
  pipelineRunOutcome: {
    mode: "dot",
    values: {
      // Current RunOutcome vocabulary.
      // Derived-stream runs record a successful run as `firing`.
      firing: {
        tone: "ok",
        labelKey: "components.badge.pipelineRunOutcome.succeeded",
      },
      normal: { tone: "ok", labelKey: "components.badge.pipelineRunOutcome.normal" },
      succeeded: {
        tone: "ok",
        labelKey: "components.badge.pipelineRunOutcome.succeeded",
      },
      error: { tone: "err", labelKey: "common.error" },
      // Shares the `alertState` wording so the same outcome reads identically in
      // pipeline history and alert history.
      notifyfailed: { tone: "warn", labelKey: "components.badge.alertState.notifyfailed" },
      skipped: { tone: "warn", labelKey: "components.badge.pipelineRunOutcome.skipped" },
      // Legacy trigger status vocabulary and older UI aliases.
      completed: {
        tone: "ok",
        labelKey: "components.badge.pipelineRunOutcome.completed",
      },
      conditionnotsatisfied: {
        tone: "ok",
        labelKey: "components.badge.pipelineRunOutcome.conditionnotsatisfied",
      },
      failed: { tone: "err", labelKey: "components.badge.pipelineRunOutcome.failed" },
      success: { tone: "ok", labelKey: "common.success" },
      ok: { tone: "ok", labelKey: "components.badge.pipelineRunOutcome.ok" },
      warning: { tone: "warn", labelKey: "components.badge.pipelineRunOutcome.warning" },
    },
    fallback: { tone: "neutral" },
  },

  // Service / node health — dot.
  serviceStatus: {
    mode: "dot",
    values: {
      up: { tone: "ok", labelKey: "components.badge.serviceStatus.up" },
      passed: { tone: "ok", labelKey: "components.badge.serviceStatus.passed" },
      healthy: { tone: "ok", labelKey: "components.badge.serviceStatus.healthy" },
      online: { tone: "ok", labelKey: "components.badge.serviceStatus.online" },
      degraded: { tone: "warn", labelKey: "components.badge.serviceStatus.degraded" },
      warning: { tone: "warn", labelKey: "components.badge.serviceStatus.warning" },
      // A cluster node that is starting up but not yet serving.
      prepare: { tone: "warn", labelKey: "components.badge.serviceStatus.prepare" },
      critical: { tone: "err", labelKey: "components.badge.serviceStatus.critical" },
      offline: { tone: "err", labelKey: "components.badge.serviceStatus.offline" },
      failed: { tone: "err", labelKey: "components.badge.serviceStatus.failed" },
      down: { tone: "err", labelKey: "components.badge.serviceStatus.down" },
      // Synthetics infrastructure error (backend status 4): the probe could not
      // run, which is not the same as the target failing.
      error: { tone: "err", labelKey: "components.badge.serviceStatus.error" },
      // Synthetics run classes: failing below quorum, not tested by us, or a
      // config error the owner must fix.
      partial: { tone: "warn", labelKey: "components.badge.serviceStatus.partial" },
      // Looked up as "not_measured"; keys are stored normalised.
      notmeasured: {
        tone: "neutral",
        labelKey: "components.badge.serviceStatus.notMeasured",
      },
      misconfigured: {
        tone: "err",
        labelKey: "components.badge.serviceStatus.misconfigured",
      },
      unknown: { tone: "neutral", labelKey: "common.unknown" },
    },
  },

  // Cluster node roles — plain and neutral: a role is a category, not a severity.
  nodeRole: {
    mode: "plain",
    values: {
      all: { tone: "neutral", labelKey: "components.badge.nodeRole.all" },
      ingester: { tone: "neutral", labelKey: "components.badge.nodeRole.ingester" },
      querier: { tone: "neutral", labelKey: "components.badge.nodeRole.querier" },
      compactor: { tone: "neutral", labelKey: "components.badge.nodeRole.compactor" },
      flattencompactor: {
        tone: "neutral",
        labelKey: "components.badge.nodeRole.flattencompactor",
      },
      router: { tone: "neutral", labelKey: "components.badge.nodeRole.router" },
      scheduler: { tone: "neutral", labelKey: "components.badge.nodeRole.scheduler" },
      script: { tone: "neutral", labelKey: "components.badge.nodeRole.script" },
    },
  },

  // IAM roles — plain and neutral: a role is a category.
  userRole: {
    mode: "plain",
    values: {
      root: { tone: "neutral", labelKey: "components.badge.userRole.root" },
      admin: { tone: "neutral", labelKey: "components.badge.userRole.admin" },
      editor: { tone: "neutral", labelKey: "components.badge.userRole.editor" },
      member: { tone: "neutral", labelKey: "components.badge.userRole.member" },
      viewer: { tone: "neutral", labelKey: "components.badge.userRole.viewer" },
      user: { tone: "neutral", labelKey: "components.badge.userRole.user" },
      serviceaccount: {
        tone: "neutral",
        labelKey: "components.badge.userRole.serviceaccount",
      },
    },
  },

  // Authentication method — plain.
  // SSO / LDAP are protocol acronyms: identical in every locale, so they stay
  // literal (no labelKey).
  authType: {
    mode: "plain",
    values: {
      sso: { tone: "neutral", label: raw("SSO") },
      native: { tone: "neutral", labelKey: "components.badge.authType.native" },
      ldap: { tone: "neutral", label: raw("LDAP") },
    },
  },

  // HTTP methods — plain and neutral. Deliberately NOT translated:
  // the verbs are HTTP spec tokens, identical in every locale.
  httpMethod: {
    mode: "plain",
    values: {
      get: { tone: "neutral", label: raw("GET") },
      post: { tone: "neutral", label: raw("POST") },
      put: { tone: "neutral", label: raw("PUT") },
      patch: { tone: "neutral", label: raw("PATCH") },
      delete: { tone: "neutral", label: raw("DELETE") },
    },
  },

  // Remote Task auth shape — plain. Says HOW the platform authenticates, never
  // whether a secret is present; that is a separate column.
  remoteTaskAuth: {
    mode: "plain",
    values: {
      none: { tone: "neutral", labelKey: "aiObservability.remoteTasks.auth.none" },
      bearer: { tone: "neutral", labelKey: "aiObservability.remoteTasks.auth.bearer" },
      basic: { tone: "neutral", labelKey: "aiObservability.remoteTasks.auth.basic" },
      apikeyheader: {
        tone: "neutral",
        labelKey: "aiObservability.remoteTasks.auth.apiKeyHeader",
      },
    },
  },

  // Remote Task registry state — dot. This is NOT verification_status: it answers
  // "can an Experiment pin this?", which is the question a reader actually has.
  remoteTaskStatus: {
    mode: "dot",
    values: {
      published: {
        tone: "ok",
        labelKey: "aiObservability.remoteTasks.status.published",
      },
      draft: { tone: "neutral", labelKey: "aiObservability.remoteTasks.status.draft" },
      failed: { tone: "err", labelKey: "aiObservability.remoteTasks.status.failed" },
      retired: { tone: "neutral", labelKey: "aiObservability.remoteTasks.status.retired" },
    },
  },

  // Schema field data types — plain.
  fieldType: {
    mode: "plain",
    values: {
      utf8: { tone: "neutral", labelKey: "common.typeString" },
      string: { tone: "neutral", labelKey: "common.typeString" },
      int64: { tone: "neutral", labelKey: "components.badge.fieldType.int" },
      integer: { tone: "neutral", labelKey: "components.badge.fieldType.int" },
      float64: { tone: "neutral", labelKey: "components.badge.fieldType.float" },
      float: { tone: "neutral", labelKey: "components.badge.fieldType.float" },
      boolean: { tone: "neutral", labelKey: "components.badge.fieldType.bool" },
      bool: { tone: "neutral", labelKey: "components.badge.fieldType.bool" },
      object: { tone: "neutral", labelKey: "components.badge.fieldType.object" },
      array: { tone: "neutral", labelKey: "components.badge.fieldType.array" },
    },
  },

  // Alert destinations — icon.
  destinationType: {
    mode: "icon",
    values: {
      email: {
        tone: "neutral",
        icon: "mail",
        labelKey: "components.badge.destinationType.email",
      },
      webhook: {
        tone: "neutral",
        icon: "webhook",
        labelKey: "components.badge.destinationType.webhook",
      },
      // Product name — never translated.
      slack: { tone: "neutral", icon: "webhook" },
      http: { tone: "neutral", icon: "webhook", label: raw("HTTP") },
      sns: { tone: "neutral", icon: "cloud", label: raw("SNS") },
      remotepipeline: {
        tone: "neutral",
        icon: "hub",
        labelKey: "components.badge.destinationType.remotepipeline",
      },
    },
  },

  // CLI command presets (AddAiToolset) — every preset shares ONE tone via a
  // fallback-only entry (the list is data-driven via CLI_PRESETS). The `value` is
  // passed for semantics but always resolves to the fallback. Add per-preset
  // colours under `values` if ever needed.
  cliPreset: {
    mode: "plain",
    size: "md",
    values: {},
    fallback: { tone: "neutral" },
  },

  // Count chip — numeric count/total badges, keyed by colour INTENT (the number
  // itself is the slot); the leading `dot` (where present) stays a
  // per-call decorative prop.
  countChip: {
    mode: "plain",
    size: "sm",
    values: {
      neutral: { tone: "neutral" },
      primary: { tone: "accent" },
      success: { tone: "ok" },
      warning: { tone: "warn" },
      error: { tone: "err" },
      info: { tone: "info" },
      // primary count with a leading status dot (e.g. the "N Alerts" summary).
      alerts: { tone: "accent", dot: true },
      // solid-primary prominent count (e.g. "N / M selected").
      accent: { tone: "accent" },
      errorstrong: { tone: "err" },
    },
    fallback: { tone: "neutral" },
  },

  // Integration card meta (AIIntegrationCard) — category vs runtime chips.
  // The actual text is the slot.
  integrationMeta: {
    mode: "plain",
    size: "sm",
    values: {
      category: { tone: "neutral" },
      runtime: { tone: "neutral" },
    },
    fallback: { tone: "neutral" },
  },

  // Setup-card provider meta (SetupCardRenderer) — runtime/setup-time/cost/meta
  // chips with leading icons. mode icon so icon + colour come from the registry.
  // The text is the slot.
  setupCardMeta: {
    mode: "icon",
    size: "md",
    values: {
      runtime: { tone: "outline", icon: "code" },
      setuptime: { tone: "accent", icon: "schedule" },
      cost: {
        tone: "outline",
        icon: "attach-money",
        labelKey: "components.badge.setupCardMeta.cost",
      },
      meta: { tone: "outline" },
    },
    fallback: { tone: "outline" },
  },

  // Index-field type (PerformanceFieldsDialog) — removable field tokens; the
  // field name + remove button are slots.
  indexFieldType: {
    mode: "plain",
    size: "sm",
    values: {
      fts: { tone: "neutral" },
      secondaryindex: { tone: "neutral" },
    },
    fallback: { tone: "neutral" },
  },

  billingTag: {
    mode: "plain",
    size: "md",
    values: {
      discount: { tone: "accent", labelKey: "billing.discountTag" },
      subscribed: { tone: "accent", labelKey: "billing.subscribed" },
    },
    fallback: { tone: "accent" },
  },

  correlationChip: {
    mode: "plain",
    size: "md",
    values: {
      overflow: { tone: "neutral" },
      subject: { tone: "outline", dot: true },
    },
    fallback: { tone: "neutral" },
  },

  tabChip: {
    mode: "plain",
    size: "sm",
    values: {
      active: { tone: "accent" },
      inactive: { tone: "neutral" },
    },
    fallback: { tone: "neutral" },
  },

  userStatus: {
    mode: "plain",
    size: "md",
    values: {
      invited: { tone: "warn", labelKey: "components.badge.userStatus.invited" },
    },
    fallback: { tone: "neutral" },
  },

  evalBadge: {
    mode: "plain",
    size: "md",
    values: {
      weakest: { tone: "warn", labelKey: "components.badge.evalBadge.weakest" },
      template: { tone: "outline", labelKey: "traces.evaluations.templateBadge" },
    },
    fallback: { tone: "neutral" },
  },

  featureStatus: {
    mode: "plain",
    size: "sm",
    values: {
      enabled: { tone: "ok", labelKey: "components.badge.featureStatus.enabled" },
      disabled: { tone: "err", labelKey: "components.badge.featureStatus.disabled" },
    },
    fallback: { tone: "neutral" },
  },

  wildcardChip: {
    mode: "plain",
    size: "sm",
    values: {},
    fallback: { tone: "neutral" },
  },

  toolMeta: {
    mode: "plain",
    size: "md",
    values: {
      tool: { tone: "neutral" },
      callid: { tone: "neutral" },
    },
    fallback: { tone: "neutral" },
  },

  exampleChip: {
    mode: "plain",
    size: "sm",
    values: {
      dim: { tone: "accent" },
      value: { tone: "neutral" },
    },
    fallback: { tone: "accent" },
  },

  // Prometheus metric TYPE — the classifying badge on the Metrics Explorer's
  // cards, the ⚙ function dialog and anywhere else a metric's kind is shown.
  // A category, so every kind stays neutral; the label carries the kind.
  metricType: {
    mode: "plain",
    size: "sm",
    values: {
      counter: { tone: "neutral", labelKey: "metrics.badge.counter" },
      gauge: { tone: "neutral", labelKey: "metrics.badge.gauge" },
      histogram: { tone: "neutral", labelKey: "metrics.badge.histogram" },
      summary: { tone: "neutral", labelKey: "metrics.badge.summary" },
      other: { tone: "neutral", labelKey: "metrics.badge.other" },
    },
    fallback: { tone: "neutral", labelKey: "metrics.badge.other" },
  },

  // Metric/info chip — trace & thread toolbar chips (Service/Duration/Cost/Steps…)
  // that carry icon + label + value in the slot and get their accent from scoped
  // CSS (.toolbar-chip/.thread-chip/.llm-chip). Uniform neutral base.
  metricChip: {
    mode: "plain",
    size: "sm",
    values: {},
    fallback: { tone: "neutral" },
  },

  logsResultChip: {
    mode: "plain",
    size: "md",
    values: {
      neutral: { tone: "neutral" },
      info: { tone: "info" },
      warn: { tone: "warn" },
      error: { tone: "err" },
    },
    fallback: { tone: "neutral" },
  },

  // Neutral field/value tag — plain chips that just display a field or value name
  // (CrossLinkManager fields, PipelinesDestinationList type/format, …). `soft` =
  // a neutral chip; `primary*` values mark the accented ones.
  fieldTag: {
    mode: "plain",
    size: "md",
    values: {
      soft: { tone: "neutral" },
      softsm: { tone: "neutral", size: "sm" },
      primarysm: { tone: "accent", size: "sm" },
      primarysoft: { tone: "accent" },
      primarysoftsm: { tone: "accent", size: "sm" },
      primary: { tone: "accent" },
      outlinesm: { tone: "outline", size: "sm" },
    },
    fallback: { tone: "neutral" },
  },

  // Latency percentile row labels (ServiceGraphEdgeSidePanel baseline table) —
  // fixed P50/P95/P99 markers. Registry-driven so the component needs no slot.
  percentileTag: {
    mode: "plain",
    size: "md",
    values: {
      p50: { tone: "neutral", label: raw("P50") },
      p95: { tone: "neutral", label: raw("P95") },
      p99: { tone: "neutral", label: raw("P99") },
    },
    fallback: { tone: "neutral" },
  },

  // Alert template origin — prebuilt vs custom. i18n labels via labelKey so the
  // component needs no slot.
  templateOrigin: {
    mode: "plain",
    size: "sm",
    values: {
      prebuilt: { tone: "neutral", labelKey: "alert_templates.prebuiltBadge" },
      custom: { tone: "neutral", labelKey: "alert_templates.customBadge" },
    },
    fallback: { tone: "neutral" },
  },

  reportTag: {
    mode: "plain",
    size: "md",
    values: {
      png: { tone: "outline", label: raw("PNG") },
      preview: { tone: "outline", labelKey: "components.badge.reportTag.preview" },
    },
    fallback: { tone: "outline" },
  },

  // "Active" marker (OrgStorageSettings configured provider, …) — fixed ok
  // tone + check icon. mode icon so the icon comes from the registry; the
  // i18n label is the slot.
  activeFlag: {
    mode: "icon",
    size: "sm",
    values: {},
    fallback: { tone: "ok", icon: "check-circle", labelKey: "storage_settings.active" },
  },

  // Setup-card step chip (SetupCardRenderer) — required vs optional, with a
  // per-step dynamic icon (kept as the :icon prop).
  stepChip: {
    mode: "icon",
    size: "sm",
    values: {
      required: { tone: "accent" },
      optional: { tone: "outline" },
    },
    fallback: { tone: "outline" },
  },

  // Service-account kind (ServiceAccountsList) — system vs system-managed.
  // Both read as outline chips.
  serviceAccountKind: {
    mode: "plain",
    values: {
      system: {
        tone: "outline",
        size: "sm",
        labelKey: "components.badge.serviceAccountKind.system",
      },
      managed: {
        tone: "outline",
        size: "md",
        labelKey: "serviceAccounts.row.managedBy",
      },
    },
    fallback: { tone: "outline" },
  },

  // Dashboard variable SCOPE (VariableSettings) — global vs tabs vs panels.
  // The count/label is
  // the slot (e.g. "3 Tabs").
  variableScope: {
    mode: "plain",
    size: "sm",
    values: {
      global: { tone: "accent", labelKey: "components.badge.variableScope.global" },
      // `tabs` / `panels` always render a caller-supplied count slot ("3 Tabs"),
      // so they carry colour only — no registry text to translate.
      tabs: { tone: "outline" },
      panels: { tone: "outline" },
    },
    fallback: { tone: "outline" },
  },

  // Inline warning note (DashboardQueryEditor multi-query warning, …) — fixed
  // warn tone + info icon; the message text is the slot. mode icon so the icon
  // comes from the registry.
  warningNote: {
    mode: "icon",
    size: "sm",
    values: {},
    fallback: { tone: "warn", icon: "info-outline" },
  },

  // Selection token — removable chips in multi-select "selected-item" slots
  // (AnomalyAlerting destinations, etc.). Uniform neutral; the item name + remove
  // button are slots, styling comes from here. Reusable across every multi-select token.
  selectionChip: {
    mode: "plain",
    size: "sm",
    values: {},
    fallback: { tone: "neutral" },
  },

  // Field-name chips (ImportSemanticGroups dialogs) — decorative chips listing
  // field names. `highlight` = a group's member fields (accent), `muted` = the
  // "current/old" side of a compare (neutral).
  fieldNameChip: {
    mode: "plain",
    size: "sm",
    values: {
      highlight: { tone: "accent" },
      muted: { tone: "neutral" },
    },
    fallback: { tone: "neutral" },
  },

  // Normalize state (ImportSemanticGroups) — boolean → colour + label.
  // true → accent "Normalized", false → neutral "Not Normalized".
  normalizeState: {
    mode: "plain",
    size: "md",
    values: {
      true: { tone: "accent", labelKey: "components.badge.normalizeState.true" },
      false: { tone: "neutral", labelKey: "components.badge.normalizeState.false" },
    },
    fallback: { tone: "neutral", labelKey: "components.badge.normalizeState.fallback" },
  },

  // Field diff status (ImportSemanticGroups modification compare) — a proposed
  // field is either NEW (ok) or already EXISTING (neutral); the leading field name
  // + trailing "add" icon stay as slots.
  fieldDiffStatus: {
    mode: "plain",
    size: "sm",
    values: {
      new: { tone: "ok" },
      existing: { tone: "neutral" },
    },
    fallback: { tone: "neutral" },
  },

  // Import diff summary categories (ImportSemanticGroups + …Drawer) — the diff
  // CATEGORY drives the tone (new→ok, modified→warn, unchanged→neutral); the
  // count + label are the slot.
  diffCategory: {
    mode: "plain",
    size: "md",
    values: {
      new: { tone: "ok" },
      modified: { tone: "warn" },
      unchanged: { tone: "neutral" },
    },
    fallback: { tone: "neutral" },
  },

  // "Default" template marker (AlertsDestinationList) — fixed neutral flag.
  // Label stays an i18n slot at the call site.
  templateDefaultFlag: {
    mode: "plain",
    size: "md",
    values: {
      default: { tone: "neutral", labelKey: "alert_destinations.templateDefaultBadge" },
    },
    fallback: { tone: "neutral" },
  },

  // "Active version" marker in scorer / score-config version lists — dot +
  // success. i18n label lives in the registry (labelKey) so the component needs
  // no slot or per-instance :label.
  activeVersionFlag: {
    mode: "dot",
    values: {
      active: {
        tone: "ok",
        labelKey: "onlineEvals.scoreConfig.detail.activeVersionChip",
      },
    },
    fallback: { tone: "ok" },
  },

  // Default LLM-provider marker (LlmProvidersSettings) — dot + success, i18n
  // label via labelKey.
  providerDefaultFlag: {
    mode: "dot",
    values: {
      default: { tone: "ok", labelKey: "llmProviders.defaultBadge" },
    },
    fallback: { tone: "ok" },
  },

  // Readonly marker (AddDestination) — single fixed neutral flag.
  // Label stays an i18n slot at the call site.
  readonlyFlag: {
    mode: "plain",
    size: "sm",
    values: {
      readonly: { tone: "neutral" },
    },
    fallback: { tone: "neutral" },
  },

  // Destination ORIGIN — prebuilt vs custom (AlertsDestinationList). Colour is the
  // prebuilt/custom distinction (NOT the specific type — that's `destinationType`);
  // the type NAME is passed as the slot label.
  destinationKind: {
    mode: "plain",
    values: {
      prebuilt: { tone: "accent" },
      custom: { tone: "neutral" },
    },
    fallback: { tone: "neutral" },
  },

  // LLM provider type (LlmProvidersSettings) — anthropic/openai/… all share one
  // neutral tone; the (lowercased) type string is the slot.
  providerType: {
    mode: "plain",
    size: "sm",
    values: {},
    fallback: { tone: "neutral" },
  },

  // Enrichment table source — icon.
  enrichmentType: {
    mode: "icon",
    values: {
      file: {
        tone: "neutral",
        icon: "description",
        labelKey: "components.badge.enrichmentType.file",
      },
      url: { tone: "neutral", icon: "cloud", labelKey: "components.badge.enrichmentType.url" },
    },
  },

  // Incident / correlation DIMENSION keys — a category, so every key stays neutral.
  dimensionKey: {
    mode: "plain",
    values: {
      deployment: { tone: "neutral" },
      namespace: { tone: "neutral" },
      environment: { tone: "neutral" },
      env: { tone: "neutral" },
      hostname: { tone: "neutral" },
      host: { tone: "neutral" },
      servicename: { tone: "neutral" },
      service: { tone: "neutral" },
      region: { tone: "neutral" },
      zone: { tone: "neutral" },
      cluster: { tone: "neutral" },
      pod: { tone: "neutral" },
      container: { tone: "neutral" },
      application: { tone: "neutral" },
      app: { tone: "neutral" },
      where: { tone: "neutral" },
      version: { tone: "neutral" },
    },
  },

  // Generic enabled/yes/true vs disabled/no/false — dot.
  booleanState: {
    mode: "dot",
    values: {
      true: { tone: "ok", labelKey: "components.badge.booleanState.yes" },
      yes: { tone: "ok", labelKey: "components.badge.booleanState.yes" },
      enabled: { tone: "ok", labelKey: "components.badge.booleanState.enabled" },
      on: { tone: "ok", labelKey: "components.badge.booleanState.on" },
      false: { tone: "neutral", labelKey: "components.badge.booleanState.no" },
      no: { tone: "neutral", labelKey: "components.badge.booleanState.no" },
      disabled: { tone: "neutral", labelKey: "components.badge.booleanState.disabled" },
      off: { tone: "neutral", labelKey: "components.badge.booleanState.off" },
    },
  },

  // ── Tracing ───────────────────────────────────────────────────────────────

  // Span / trace status — dot.
  // `OK` is the OTel status-code spec token and stays literal; the other two are
  // display words.
  spanStatus: {
    mode: "dot",
    values: {
      ok: { tone: "ok", label: raw("OK") },
      success: { tone: "ok", labelKey: "common.success" },
      error: { tone: "err", labelKey: "common.error" },
      unset: { tone: "neutral", labelKey: "components.badge.spanStatus.unset" },
    },
  },

  // OpenTelemetry span kind — plain. Labels are the full words; consumers that
  // want the C/S/P/CO/I abbreviation should pass an explicit `label`.
  // Deliberately NOT translated: these are the OTel SpanKind spec terms.
  spanKind: {
    mode: "plain",
    size: "sm",
    values: {
      client: { tone: "neutral", label: raw("Client") },
      server: { tone: "neutral", label: raw("Server") },
      producer: { tone: "neutral", label: raw("Producer") },
      consumer: { tone: "neutral", label: raw("Consumer") },
      internal: { tone: "neutral", label: raw("Internal") },
    },
  },

  // HTTP status CLASS — plain. NOTE: keys are buckets, not raw codes. Callers
  // must bucket a numeric code first via `httpStatusBucket(code)` (registry
  // keys are exact strings — they can't express the 200–599 ranges).
  httpStatus: {
    mode: "plain",
    values: {
      "2xx": { tone: "ok" },
      "3xx": { tone: "info" },
      "4xx": { tone: "warn" },
      "5xx": { tone: "err" },
    },
    fallback: { tone: "neutral" },
  },

  // ── Online evals ────────────────────────────────────────────────────────

  // Scorer type — plain.
  scorerType: {
    mode: "plain",
    size: "sm",
    values: {
      remote: { tone: "neutral", labelKey: "components.badge.scorerType.remote" },
      code: { tone: "neutral", labelKey: "components.badge.scorerType.code" },
      llmjudge: { tone: "neutral", labelKey: "components.badge.scorerType.llmjudge" },
      llm: { tone: "neutral", labelKey: "components.badge.scorerType.llm" },
    },
  },

  // Eval data type — plain.
  evalDataType: {
    mode: "plain",
    values: {
      categorical: {
        tone: "neutral",
        labelKey: "components.badge.evalDataType.categorical",
      },
      boolean: { tone: "neutral", labelKey: "common.typeBoolean" },
      numeric: { tone: "neutral", labelKey: "components.badge.evalDataType.numeric" },
    },
  },

  // Threshold-declaration flag (Score Config detail → Healthy threshold section).
  // Muted, its own group so the label mapping stays scoped and never leaks into
  // the shared `fieldTag` chips.
  thresholdFlag: {
    mode: "plain",
    values: {
      notdeclared: {
        tone: "neutral",
        labelKey: "onlineEvals.scoreConfig.detail.noThreshold",
      },
    },
    fallback: { tone: "neutral" },
  },

  // LLM observation type — plain. A category, so every type stays neutral. Keys are normalised (no
  // underscores). NOTE: `getObservationTypeColor` still drives TraceDAG graph-node
  // fills — that is not a badge and is intentionally untouched.
  observationType: {
    mode: "plain",
    values: {
      chat: { tone: "neutral" },
      textcompletion: { tone: "neutral" },
      generatecontent: { tone: "neutral" },
      embeddings: { tone: "neutral" },
      invokeagent: { tone: "neutral" },
      createagent: { tone: "neutral" },
      executetool: { tone: "neutral" },
      chain: { tone: "neutral" },
      retrieval: { tone: "neutral" },
      task: { tone: "neutral" },
      evaluator: { tone: "neutral" },
      invokeworkflow: { tone: "neutral" },
      rerank: { tone: "neutral" },
      guardrail: { tone: "neutral" },
      span: { tone: "neutral" },
      event: { tone: "neutral" },
    },
    fallback: { tone: "neutral" },
  },

  // Enrichment URL-job status — dot (completed→ok, failed→err, processing→info).
  enrichmentJobStatus: {
    mode: "dot",
    values: {
      completed: { tone: "ok", labelKey: "components.badge.enrichmentJobStatus.completed" },
      failed: { tone: "err", labelKey: "components.badge.enrichmentJobStatus.failed" },
      processing: {
        tone: "info",
        labelKey: "components.badge.enrichmentJobStatus.processing",
      },
    },
    fallback: { tone: "neutral" },
  },

  // Backfill job status — plain (no dot). `deletionfailed` is the
  // deletion-overlay state the caller passes when deletion_status.failed is set.
  backfillJobStatus: {
    mode: "plain",
    values: {
      running: { tone: "ok" },
      completed: { tone: "ok" },
      failed: { tone: "err" },
      pending: { tone: "warn" },
      canceled: { tone: "neutral" },
      deletionfailed: { tone: "err" },
    },
    fallback: { tone: "neutral" },
  },

  // Model source (TestModelMatchDialog) — plain. org → primary, meta_org →
  // default-outline, anything else (built-in) → default.
  modelSource: {
    mode: "plain",
    values: {
      org: { tone: "accent" },
      metaorg: { tone: "outline" },
    },
    fallback: { tone: "neutral" },
  },

  // Evaluation verdict — icon.
  evaluationVerdict: {
    mode: "icon",
    values: {
      pass: {
        tone: "ok",
        icon: "check-circle",
        labelKey: "components.badge.evaluationVerdict.pass",
      },
      fail: {
        tone: "err",
        icon: "cancel",
        labelKey: "components.badge.evaluationVerdict.fail",
      },
      unknown: {
        tone: "neutral",
        icon: "help-outline",
        labelKey: "components.badge.evaluationVerdict.unknown",
      },
    },
    fallback: { tone: "neutral", icon: "help-outline" },
  },

  // ── Anomaly detection ─────────────────────────────────────────────────────

  // Field-value rarity (log-explorer anomaly profile): rarer = hotter colour.
  fieldRarity: {
    mode: "plain",
    size: "sm",
    values: {
      anomalous: { tone: "err" },
      rare: { tone: "err" },
      uncommon: { tone: "warn" },
      common: { tone: "neutral" },
    },
    fallback: { tone: "neutral" },
  },

  // Anomaly-detection job status — dot.
  anomalyStatus: {
    mode: "dot",
    values: {
      active: { tone: "ok", labelKey: "components.badge.anomalyStatus.active" },
      ready: { tone: "ok", labelKey: "components.badge.anomalyStatus.ready" },
      training: { tone: "info", labelKey: "components.badge.anomalyStatus.training" },
      failed: { tone: "err", labelKey: "components.badge.anomalyStatus.failed" },
      waiting: { tone: "neutral", labelKey: "components.badge.anomalyStatus.waiting" },
      disabled: { tone: "neutral", labelKey: "components.badge.anomalyStatus.disabled" },
      waitingfordata: {
        tone: "neutral",
        labelKey: "components.badge.anomalyStatus.waitingForData",
      },
      notapplicable: {
        tone: "neutral",
        labelKey: "components.badge.anomalyStatus.notApplicable",
      },
    },
  },

  // ── Misc lifecycle ────────────────────────────────────────────────────────

  // Backfill / async deletion job status — dot.
  deletionStatus: {
    mode: "dot",
    values: {
      completed: { tone: "ok", labelKey: "components.badge.deletionStatus.completed" },
      inprogress: { tone: "info", labelKey: "components.badge.deletionStatus.inprogress" },
      pending: { tone: "warn", labelKey: "components.badge.deletionStatus.pending" },
      failed: { tone: "err", labelKey: "components.badge.deletionStatus.failed" },
    },
    fallback: { tone: "neutral" },
  },

  // License validity — dot. Labels are i18n keys (resolved by OTag).
  licenseStatus: {
    mode: "dot",
    values: {
      active: { tone: "ok", labelKey: "about.active_lbl" },
      valid: { tone: "ok", labelKey: "about.active_lbl" },
      expired: { tone: "err", labelKey: "about.expired_lbl" },
    },
  },

  // RUM frustration EVENT type — plain.
  // (Frustration SEVERITY is count-derived → bucket the count yourself, then
  //  use the `severity` group; it can't be a value→variant entry.)
  frustrationEventType: {
    mode: "plain",
    values: {
      rageclick: {
        tone: "warn",
        labelKey: "components.badge.frustrationEventType.rageclick",
      },
      deadclick: {
        tone: "neutral",
        labelKey: "components.badge.frustrationEventType.deadclick",
      },
      errorclick: {
        tone: "err",
        labelKey: "components.badge.frustrationEventType.errorclick",
      },
      ragetap: {
        tone: "warn",
        labelKey: "components.badge.frustrationEventType.ragetap",
      },
      errortap: {
        tone: "err",
        labelKey: "components.badge.frustrationEventType.errortap",
      },
    },
  },

  // RUM frustration SEVERITY — dot. Component buckets the count → none/low/
  // medium/high, then passes it here.
  frustrationSeverity: {
    mode: "dot",
    values: {
      none: { tone: "neutral" },
      low: { tone: "warn" },
      medium: { tone: "warn" },
      high: { tone: "err" },
    },
  },

  // Alert run state (alert history) — icon.
  //
  // The backend vocabulary is `firing | normal | succeeded | error |
  // notify_failed | skipped` (RunOutcome). The legacy values below
  // (`completed`, `condition_not_satisfied`, `failed`, `ok`, `success`) are kept
  // so history rows written before the rename still render, and can be dropped
  // once those rows age out of the triggers stream's retention window.
  alertState: {
    mode: "icon",
    values: {
      // ── firing states ──
      firing: {
        tone: "err",
        icon: "error-outline",
        labelKey: "components.badge.alertState.firing",
      },
      anomaly: {
        tone: "err",
        icon: "error-outline",
        labelKey: "components.badge.alertState.anomaly",
      },
      // Condition matched but delivery failed: amber, since red is kept for the
      // firing itself and for destructive actions (R9).
      notifyfailed: {
        tone: "warn",
        icon: "sync-problem",
        labelKey: "components.badge.alertState.notifyfailed",
      },
      // LEGACY: `completed` meant "the alert fired" for condition-bearing
      // modules. It is a firing state — the previous green rendering
      // contradicted both the backend and the timeline aggregation.
      completed: {
        tone: "err",
        icon: "error-outline",
        labelKey: "components.badge.alertState.firing",
      },

      // ── non-firing states ──
      // Explicit key, not the humanised (English-only) fallback: `conditionnotsatisfied`
      // below is the same state and must resolve the same key in every locale.
      normal: {
        tone: "ok",
        icon: "check-circle-outline",
        labelKey: "components.badge.alertState.normal",
      },
      succeeded: {
        tone: "ok",
        icon: "check-circle-outline",
        labelKey: "components.badge.alertState.succeeded",
      },
      // LEGACY aliases for `normal`.
      ok: {
        tone: "ok",
        icon: "check-circle-outline",
        labelKey: "components.badge.alertState.ok",
      },
      success: {
        tone: "ok",
        icon: "check-circle-outline",
        labelKey: "common.success",
      },
      conditionnotsatisfied: {
        tone: "ok",
        icon: "check-circle-outline",
        labelKey: "components.badge.alertState.normal",
      },

      // ── evaluation problems ──
      error: { tone: "err", icon: "cancel", labelKey: "common.error" },
      failed: {
        tone: "err",
        icon: "cancel",
        labelKey: "components.badge.alertState.failed",
      },

      // ── neither ──
      skipped: {
        tone: "warn",
        icon: "block",
        labelKey: "components.badge.alertState.skipped",
      },
      flapping: {
        tone: "warn",
        icon: "bolt",
        labelKey: "components.badge.alertState.flapping",
      },
      pending: {
        tone: "info",
        icon: "schedule",
        labelKey: "components.badge.alertState.pending",
      },

      // ── acknowledged: someone owns a firing; blue keeps it apart from firing red and muted amber ──
      acknowledged: {
        tone: "info",
        icon: "person",
        labelKey: "components.badge.alertState.acknowledged",
      },
      // An ack, unack or take-over recorded as its own history row, not a run.
      ackevent: {
        tone: "neutral",
        icon: "person",
        labelKey: "components.badge.alertState.ackevent",
      },
    },
    fallback: { tone: "neutral", icon: "help-outline" },
  },

  // Report run outcome — dot. "Sent" names the email, not the job; overdue/never/paused are list-only.
  reportRunStatus: {
    mode: "dot",
    values: {
      succeeded: { tone: "ok", labelKey: "components.badge.reportRunStatus.sent" },
      partial: { tone: "ok", labelKey: "components.badge.reportRunStatus.partial" },
      cached: { tone: "info", labelKey: "components.badge.reportRunStatus.cached" },
      error: { tone: "err", labelKey: "components.badge.reportRunStatus.failed" },
      skipped: { tone: "warn", labelKey: "components.badge.reportRunStatus.skipped" },
      overdue: { tone: "warn", labelKey: "components.badge.reportRunStatus.overdue" },
      unrecorded: {
        tone: "neutral",
        labelKey: "components.badge.reportRunStatus.unrecorded",
      },
      paused: { tone: "neutral", labelKey: "components.badge.reportRunStatus.paused" },
    },
    fallback: { tone: "neutral" },
  },

  // Recent-event result (overview) — plain. Failed/Firing run hot (red), Error
  // is the milder amber.
  eventStatus: {
    mode: "plain",
    values: {
      failed: { tone: "err", labelKey: "components.badge.eventStatus.failed" },
      firing: { tone: "err", labelKey: "components.badge.eventStatus.firing" },
      error: { tone: "warn", labelKey: "common.error" },
      // Same neutral tone the fallback gave it — declared explicitly so the word
      // is translated rather than humanised from the raw value.
      anomaly: { tone: "neutral", labelKey: "components.badge.eventStatus.anomaly" },
    },
    fallback: { tone: "neutral" },
  },

  // Incident correlation reason — plain. i18n labels.
  correlationReason: {
    mode: "plain",
    values: {
      servicediscovery: {
        tone: "accent",
        labelKey: "alerts.incidents.correlationServiceDiscovery",
      },
      primarymatch: {
        tone: "accent",
        labelKey: "alerts.incidents.correlationPrimaryMatch",
      },
      secondarymatch: {
        tone: "warn",
        labelKey: "alerts.incidents.correlationSecondaryMatch",
      },
      alertid: { tone: "neutral", labelKey: "alerts.incidents.correlationAlertId" },
    },
    fallback: { tone: "neutral" },
  },

  // AI toolset kind — plain.
  aiToolsetKind: {
    mode: "plain",
    values: {
      // MCP / CLI are acronyms — identical in every locale.
      mcp: { tone: "neutral", label: raw("MCP") },
      cli: { tone: "neutral", label: raw("CLI") },
      skill: { tone: "neutral", labelKey: "components.badge.aiToolsetKind.skill" },
      generic: { tone: "neutral", labelKey: "components.badge.aiToolsetKind.generic" },
    },
    fallback: { tone: "neutral" },
  },

  // Dimension cardinality class — dot, low→high heat.
  cardinalityClass: {
    mode: "dot",
    values: {
      verylow: { tone: "ok", labelKey: "components.badge.cardinalityClass.verylow" },
      low: { tone: "ok", labelKey: "components.badge.cardinalityClass.low" },
      medium: { tone: "warn", labelKey: "components.badge.cardinalityClass.medium" },
      high: { tone: "err", labelKey: "components.badge.cardinalityClass.high" },
      veryhigh: { tone: "err", labelKey: "components.badge.cardinalityClass.veryhigh" },
      unknown: { tone: "neutral", labelKey: "common.unknown" },
    },
    fallback: { tone: "neutral" },
  },

  // The two window-over-window states that are NOT a percentage. A fingerprint
  // absent from the previous window has no delta at all, and rendering it as
  // -100% would invert its meaning — so it gets a chip instead of a number.
  // Both stay neutral: an arrival is not itself an alarm.
  dbmDelta: {
    mode: "plain",
    size: "sm",
    values: {
      new: { tone: "neutral" },
      gone: { tone: "neutral" },
    },
    fallback: { tone: "neutral" },
  },

  // Database engine, from the OTel `db.system` value. Identity colour, not
  // severity — an engine is never "bad", so the palette is decorative-soft and
  // each engine keeps one colour everywhere it appears. Unregistered engines
  // fall through to the humanised generic chip, which is correct: `db.system`
  // is an open vocabulary and a new engine must still render.
  dbSystem: {
    mode: "plain",
    size: "sm",
    values: {
      postgresql: { tone: "neutral", label: raw("PostgreSQL") },
      mysql: { tone: "neutral", label: raw("MySQL") },
      mariadb: { tone: "neutral", label: raw("MariaDB") },
      mssql: { tone: "neutral", label: raw("SQL Server") },
      oracle: { tone: "neutral", label: raw("Oracle") },
      mongodb: { tone: "neutral", label: raw("MongoDB") },
      redis: { tone: "neutral", label: raw("Redis") },
      elasticsearch: { tone: "neutral", label: raw("Elasticsearch") },
      cassandra: { tone: "neutral", label: raw("Cassandra") },
      clickhouse: { tone: "neutral", label: raw("ClickHouse") },
      cockroachdb: { tone: "neutral", label: raw("CockroachDB") },
      dynamodb: { tone: "neutral", label: raw("DynamoDB") },
      sqlite: { tone: "neutral", label: raw("SQLite") },
      snowflake: { tone: "neutral", label: raw("Snowflake") },
      spanner: { tone: "neutral", label: raw("Spanner") },
    },
    fallback: { tone: "neutral" },
  },

  // Service-graph latency/error delta vs baseline — plain.
  // How far a shown number can be trusted. Only `gap` is red — it is the one
  // state that means data is MISSING rather than approximate, and a tinted chip
  // on every view would signal nothing.
  dataConfidence: {
    mode: "plain",
    size: "sm",
    values: {
      estimated: {
        tone: "neutral",
        labelKey: "components.badge.dataConfidence.estimated",
      },
      topnsubset: {
        tone: "warn",
        labelKey: "components.badge.dataConfidence.topNSubset",
      },
      live: { tone: "info", labelKey: "components.badge.dataConfidence.live" },
      belowtopn: {
        tone: "neutral",
        labelKey: "components.badge.dataConfidence.belowTopN",
      },
      truncated: {
        tone: "warn",
        labelKey: "components.badge.dataConfidence.truncated",
      },
      gap: { tone: "err", labelKey: "components.badge.dataConfidence.gap" },
    },
    fallback: { tone: "neutral" },
  },

  deltaTrend: {
    mode: "plain",
    values: {
      improved: { tone: "ok" },
      slight: { tone: "neutral" },
      neutral: { tone: "neutral" },
      warning: { tone: "warn" },
      critical: { tone: "err" },
    },
    fallback: { tone: "neutral" },
  },

  // Online-eval RUN status (per-record) — dot.
  evalRunStatus: {
    mode: "dot",
    values: {
      success: { tone: "ok", labelKey: "common.success" },
      // `OK` is a protocol token — same in every locale.
      ok: { tone: "ok", label: raw("OK") },
      error: { tone: "err", labelKey: "common.error" },
      timeout: { tone: "warn", labelKey: "components.badge.evalRunStatus.timeout" },
      skipped: { tone: "neutral", labelKey: "components.badge.evalRunStatus.skipped" },
      warn: { tone: "warn", labelKey: "components.badge.evalRunStatus.warn" },
      bad: { tone: "err", labelKey: "components.badge.evalRunStatus.bad" },
    },
    fallback: { tone: "neutral" },
  },

  // LLM session outcome (derived from error_count) — dot + soft colour.
  sessionStatus: {
    mode: "dot",
    values: {
      ok: { tone: "ok", labelKey: "components.badge.sessionStatus.ok" },
      error: { tone: "err", labelKey: "components.badge.sessionStatus.error" },
    },
    fallback: { tone: "neutral" },
  },

  qualityStatus: {
    mode: "dot",
    class: "!border-transparent !bg-transparent !px-0",
    // Keys are the Quality API `status` values (`no_data` normalises to `nodata`).
    values: {
      attention: { tone: "err", labelKey: "components.badge.qualityStatus.attention" },
      healthy: { tone: "ok", labelKey: "components.badge.qualityStatus.healthy" },
      unset: { tone: "neutral", labelKey: "components.badge.qualityStatus.unset" },
      nodata: { tone: "neutral", labelKey: "components.badge.qualityStatus.nodata" },
    },
    fallback: { tone: "neutral" },
  },

  // Eval job preview mode — plain.
  jobPreviewState: {
    mode: "plain",
    values: {
      draft: {
        tone: "neutral",
        labelKey: "onlineEvals.job.preview.statusDraft",
      },
      editing: {
        tone: "neutral",
        labelKey: "onlineEvals.job.preview.statusEditing",
      },
    },
    fallback: { tone: "neutral" },
  },

  // RUM event type — plain.
  rumEventType: {
    mode: "plain",
    values: {
      view: { tone: "neutral", labelKey: "components.badge.rumEventType.view" },
      action: { tone: "neutral", labelKey: "components.badge.rumEventType.action" },
      error: { tone: "err", labelKey: "common.error" },
      resource: { tone: "neutral", labelKey: "components.badge.rumEventType.resource" },
      failedrequest: {
        tone: "err",
        labelKey: "components.badge.rumEventType.failedrequest",
      },
      longtask: { tone: "warn", labelKey: "components.badge.rumEventType.longtask" },
    },
    fallback: { tone: "neutral" },
  },

  // Cross-link source — plain.
  crossLinkSource: {
    mode: "plain",
    values: {
      stream: { tone: "accent", labelKey: "components.badge.crossLinkSource.stream" },
      global: { tone: "neutral", labelKey: "components.badge.crossLinkSource.global" },
    },
    fallback: { tone: "neutral" },
  },

  // Subscription plan.
  subscriptionPlan: {
    mode: "plain",
    values: {
      free: { tone: "neutral", labelKey: "components.badge.subscriptionPlan.free" },
      payasyougo: {
        tone: "neutral",
        labelKey: "components.badge.subscriptionPlan.payasyougo",
      },
      enterprise: {
        tone: "neutral",
        labelKey: "components.badge.subscriptionPlan.enterprise",
      },
    },
    fallback: { tone: "neutral" },
  },

  // Synthetic monitor type — plain.
  syntheticType: {
    mode: "plain",
    size: "sm",
    values: {
      // HTTP / API / TCP / DNS are protocol acronyms — identical in every locale.
      http: { tone: "neutral", label: raw("HTTP") },
      browser: { tone: "neutral", labelKey: "components.badge.syntheticType.browser" },
      api: { tone: "neutral", label: raw("API") },
      tcp: { tone: "neutral", label: raw("TCP") },
      ping: { tone: "neutral", labelKey: "components.badge.syntheticType.ping" },
      dns: { tone: "neutral", label: raw("DNS") },
    },
  },

  // Billing AI usage mode. i18n labels.
  aiMode: {
    mode: "plain",
    values: {
      payasyougo: { tone: "accent", labelKey: "paidUsage.modePayAsYouGo" },
      consentrequired: { tone: "warn", labelKey: "paidUsage.modeConsentRequired" },
      exhausted: { tone: "err", labelKey: "paidUsage.modeExhausted" },
      free: { tone: "ok", labelKey: "paidUsage.modeFree" },
    },
    fallback: { tone: "neutral", labelKey: "paidUsage.modeUnknown" },
  },

  // Billing-group member status — dot. i18n labels.
  billingGroupMemberStatus: {
    mode: "dot",
    values: {
      active: { tone: "ok", labelKey: "billing.billingGroup.statusActive" },
      pending: { tone: "warn", labelKey: "billing.billingGroup.statusPending" },
    },
    fallback: { tone: "warn", labelKey: "billing.billingGroup.statusPending" },
  },

  // Billing management channel.
  billingManagement: {
    mode: "plain",
    values: {
      aws: { tone: "neutral", labelKey: "components.badge.billingManagement.aws" },
      azure: { tone: "neutral", labelKey: "components.badge.billingManagement.azure" },
      stripe: { tone: "neutral", label: raw("Stripe") },
      contract: {
        tone: "neutral",
        labelKey: "components.badge.billingManagement.contract",
      },
    },
    fallback: { tone: "neutral" },
  },

  // "Applied" indicator (e.g. the active predefined theme) — icon.
  themeApplied: {
    mode: "icon",
    size: "sm",
    values: {
      applied: {
        tone: "ok",
        icon: "check-circle",
        labelKey: "components.badge.themeApplied.applied",
      },
    },
    fallback: {
      tone: "ok",
      icon: "check-circle",
      labelKey: "components.badge.themeApplied.fallback",
    },
  },

  // Feature flags (BETA / HA / Coming Soon chips).
  featureFlag: {
    mode: "plain",
    size: "sm",
    values: {
      beta: { tone: "accent", label: raw("BETA") },
      ha: { tone: "accent", label: raw("HA") },
      comingsoon: { tone: "neutral", labelKey: "components.badge.featureFlag.comingsoon" },
    },
    fallback: { tone: "neutral" },
  },

  // Fleet Manager rollout lifecycle — dot + soft colour, attention states run hot.
  fleetRolloutStatus: {
    mode: "dot",
    values: {
      scheduled: { tone: "neutral", labelKey: "fleet.badge.scheduled" },
      waiting: { tone: "warn", labelKey: "fleet.badge.waiting" },
      inprogress: { tone: "info", labelKey: "fleet.badge.inProgress" },
      completed: { tone: "ok", labelKey: "fleet.badge.completed" },
      halted: { tone: "err", labelKey: "fleet.badge.halted" },
      superseded: { tone: "neutral", labelKey: "fleet.badge.superseded" },
      rolledback: { tone: "warn", labelKey: "fleet.badge.rolledBack" },
      // A completed rollout of an empty fleet; not a status the server sends.
      empty: { tone: "neutral", labelKey: "fleet.rollouts.noneTargeted" },
    },
    fallback: { tone: "neutral" },
  },

  // Fleet rollout batching — a category, so plain with one hue per kind.
  fleetBatching: {
    mode: "plain",
    values: {
      one: { tone: "neutral", labelKey: "fleet.rollouts.oneBatch" },
      canary: { tone: "neutral", labelKey: "fleet.badge.canary" },
      progressive: { tone: "neutral", labelKey: "fleet.badge.progressive" },
    },
    fallback: { tone: "neutral" },
  },

  // Fleet Manager config delivery — the one vocabulary for a collector's config lifecycle.
  fleetDelivery: {
    mode: "dot",
    values: {
      assigned: { tone: "neutral", labelKey: "fleet.delivery.assigned" },
      sent: { tone: "info", labelKey: "fleet.delivery.sent" },
      accepted: { tone: "neutral", labelKey: "fleet.delivery.accepted" },
      running: { tone: "ok", labelKey: "fleet.delivery.running" },
      rejected: { tone: "err", labelKey: "fleet.delivery.rejected" },
    },
    fallback: { tone: "neutral" },
  },

  slackInstallStatus: {
    mode: "dot",
    values: {
      healthy: { tone: "ok", labelKey: "components.badge.slackInstallStatus.healthy" },
      degraded: {
        tone: "warn",
        labelKey: "components.badge.slackInstallStatus.degraded",
      },
      pending: { tone: "info", labelKey: "components.badge.slackInstallStatus.pending" },
      revoked: { tone: "err", labelKey: "components.badge.slackInstallStatus.revoked" },
    },
    fallback: { tone: "neutral" },
  },
  // Workflow run status as the history API stores it; rendered as given, never derived from `error`.
  hookRunStatus: {
    mode: "dot",
    values: {
      queued: { tone: "warn", labelKey: "workflow.history.statusQueued" },
      running: { tone: "info", labelKey: "workflow.history.statusRunning" },
      succeeded: { tone: "ok", labelKey: "workflow.history.success" },
      failed: { tone: "err", labelKey: "workflow.history.failed" },
      expired: { tone: "neutral", labelKey: "workflow.history.statusExpired" },
    },
    fallback: { tone: "neutral" },
  },
} satisfies Record<string, BadgeGroupConfig>;

export type BadgeGroupName = keyof typeof BADGE_GROUPS;

export interface ResolvedBadge {
  tone: ChipTone;
  label: I18nText;
  /** i18n key for the label, if the matched value declared one. `OTag`
   *  translates this when no explicit `label` is supplied. */
  labelKey?: I18nKey;
  icon?: string;
  dot: boolean;
  mode: BadgeRenderMode;
  /** Group-declared size. May be undefined — the caller then falls back to its
   *  own default. */
  size?: ChipSize;
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
      tone: generic.variant,
      label: raw(rawValue ? humanize(rawValue) : "—"),
      dot: true,
      mode: "dot",
    };
  }

  const entry = cfg.values[key] ?? cfg.fallback ?? genericEntry(value);
  const mode = entry.dot === true ? "dot" : cfg.mode;

  return {
    tone: entry.tone,
    label: entry.label ?? raw(rawValue ? humanize(rawValue) : "—"),
    labelKey: entry.labelKey,
    icon: mode === "icon" ? entry.icon : undefined,
    dot: entry.dot ?? mode === "dot",
    mode,
    // Per-value size wins over group size; both may be undefined → caller default.
    size: entry.size ?? cfg.size,
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
  return { tone: statusVariant(value).variant };
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
