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

import type { BadgeVariant, BadgeSize, BadgeShape } from "./OBadge.types";
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
  /**
   * i18n key for the label. Resolved by `OTag` via `t(labelKey)` (the registry
   * is a plain module with no i18n context). Use this instead of `label` when
   * the text must be translated. A literal `label` (or a per-call `label` prop)
   * still wins over `labelKey`.
   */
  labelKey?: string;
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
      scheduled: { variant: "teal-soft", icon: "schedule" },
      realtime: { variant: "blue-soft", icon: "bolt", label: "Real-time" },
      anomalydetection: { variant: "purple-soft", icon: "query-stats", label: "Anomaly Detection" },
    },
  },

  // Alert run status — coloured DOT, no icon.
  alertStatus: {
    mode: "dot",
    shape: "pill",
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

  // Incident lifecycle. Labels are i18n keys (resolved by OTag).
  incidentStatus: {
    mode: "dot",
    shape: "pill",
    values: {
      open: { variant: "error-soft", labelKey: "alerts.incidents.statusOpen" },
      firing: { variant: "error-soft" },
      acknowledged: { variant: "warning-soft", labelKey: "alerts.incidents.statusAcknowledged" },
      resolved: { variant: "success-soft", labelKey: "alerts.incidents.statusResolved" },
      closed: { variant: "default-soft" },
    },
  },

  // Severity scale — dot, ordered hot→cold. P1–P4 are aliases so incident
  // severities (P1/P2/P3/P4) resolve to the same colours as critical→low.
  severity: {
    mode: "dot",
    shape: "pill",
    values: {
      critical: { variant: "error-soft" },
      high: { variant: "orange-soft" },
      medium: { variant: "amber-soft" },
      low: { variant: "blue-soft" },
      info: { variant: "default-soft" },
      p1: { variant: "error-soft", label: "P1" },
      p2: { variant: "orange-soft", label: "P2" },
      p3: { variant: "amber-soft", label: "P3" },
      p4: { variant: "blue-soft", label: "P4" },
    },
  },

  // Log levels — colour ONLY (plain), the classic severity tint.
  logLevel: {
    mode: "plain",
    shape: "pill",
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
    shape: "pill",
    values: {
      realtime: { variant: "blue-soft", icon: "bolt", label: "Real-time" },
      scheduled: { variant: "teal-soft", icon: "schedule" },
    },
  },

  // Stream types — icon, mirrors the stream-type filter chips.
  streamType: {
    mode: "icon",
    shape: "pill",
    values: {
      logs: { variant: "blue-soft", icon: "search", labelKey: "settings.correlation.logs" },
      metrics: { variant: "purple-soft", icon: "bar-chart", labelKey: "settings.correlation.metrics" },
      traces: { variant: "teal-soft", icon: "account-tree", labelKey: "settings.correlation.traces" },
      metadata: { variant: "default-soft", icon: "info" },
      enrichmenttables: { variant: "amber-soft", icon: "database", label: "Enrichment" },
      index: { variant: "cyan-soft", icon: "database" },
    },
  },

  // Invoice status (Stripe) — dot. "open" is informational here, not a warning.
  invoiceStatus: {
    mode: "dot",
    shape: "pill",
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
    shape: "pill",
    values: {
      up: { variant: "success-soft" },
      passed: { variant: "success-soft" },
      healthy: { variant: "success-soft" },
      online: { variant: "success-soft" },
      degraded: { variant: "warning-soft" },
      warning: { variant: "amber-soft" },
      critical: { variant: "error-soft" },
      offline: { variant: "error-soft" },
      failed: { variant: "error-soft" },
      down: { variant: "error-soft" },
      unknown: { variant: "default-soft" },
    },
  },

  // IAM roles — colour only (plain). Privileged roles run hot.
  userRole: {
    mode: "plain",
    shape: "pill",
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
    shape: "pill",
    values: {
      sso: { variant: "blue-soft", label: "SSO" },
      native: { variant: "default-soft" },
      ldap: { variant: "purple-soft", label: "LDAP" },
    },
  },

  // HTTP methods — plain, REST-conventional colours.
  httpMethod: {
    mode: "plain",
    shape: "pill",
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
    shape: "rounded",
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
    shape: "pill",
    values: {
      email: { variant: "blue-soft", icon: "mail" },
      webhook: { variant: "teal-soft", icon: "webhook" },
      slack: { variant: "purple-soft", icon: "webhook" },
      http: { variant: "teal-soft", icon: "webhook", label: "HTTP" },
      sns: { variant: "orange-soft", icon: "cloud", label: "SNS" },
      remotepipeline: { variant: "cyan-soft", icon: "hub", label: "Remote Pipeline" },
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
      cost: { variant: "default-outline", icon: "attach-money", label: "Cost & Tokens Captured" },
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
      invited: { variant: "warning-soft", label: "Invited" },
    },
    fallback: { variant: "default-soft" },
  },

  evalBadge: {
    mode: "plain",
    shape: "pill",
    size: "md",
    values: {
      weakest: { variant: "warning" },
      template: { variant: "primary-outline", labelKey: "traces.evaluations.templateBadge" },
    },
    fallback: { variant: "default" },
  },

  featureStatus: {
    mode: "plain",
    shape: "pill",
    size: "md",
    values: {
      enabled: { variant: "success" },
      disabled: { variant: "error" },
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
      counter: { variant: "blue-soft", label: "Counter" },
      gauge: { variant: "success-soft", label: "Gauge" },
      histogram: { variant: "purple-soft", label: "Histogram" },
      summary: { variant: "orange-soft", label: "Summary" },
      other: { variant: "default-soft", label: "Other" },
    },
    fallback: { variant: "default-soft", label: "Other" },
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
      p50: { variant: "default-soft", label: "P50" },
      p95: { variant: "default-soft", label: "P95" },
      p99: { variant: "default-soft", label: "P99" },
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
      png: { variant: "primary-outline", label: "PNG" },
      preview: { variant: "default-outline", label: "Preview" },
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
      system: { variant: "primary-outline", size: "sm", label: "system" },
      managed: { variant: "default-outline", size: "md", labelKey: "serviceAccounts.row.managedBy" },
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
      global: { variant: "primary-soft" },
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
      true: { variant: "primary", label: "Normalized" },
      false: { variant: "default", label: "Not Normalized" },
    },
    fallback: { variant: "default", label: "Not Normalized" },
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
      file: { variant: "blue-soft", icon: "description" },
      url: { variant: "teal-soft", icon: "cloud" },
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

  // ── Tracing ───────────────────────────────────────────────────────────────

  // Span / trace status — dot.
  spanStatus: {
    mode: "dot",
    shape: "pill",
    values: {
      ok: { variant: "success-soft", label: "OK" },
      success: { variant: "success-soft" },
      error: { variant: "error-soft", label: "Error" },
      unset: { variant: "default-soft", label: "Unset" },
    },
  },

  // OpenTelemetry span kind — plain. Labels are the full words; consumers that
  // want the C/S/P/CO/I abbreviation should pass an explicit `label`.
  spanKind: {
    mode: "plain",
    shape: "rounded",
    size: "xs",
    values: {
      client: { variant: "blue-soft", label: "Client" },
      server: { variant: "purple-soft", label: "Server" },
      producer: { variant: "teal-soft", label: "Producer" },
      consumer: { variant: "amber-soft", label: "Consumer" },
      internal: { variant: "default-soft", label: "Internal" },
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
      remote: { variant: "teal-soft" },
      code: { variant: "purple-soft" },
      llmjudge: { variant: "blue-soft", label: "LLM Judge" },
      llm: { variant: "blue-soft", label: "LLM Judge" },
    },
  },

  // Eval data type — plain.
  evalDataType: {
    mode: "plain",
    shape: "pill",
    values: {
      categorical: { variant: "purple-soft" },
      boolean: { variant: "teal-soft" },
      numeric: { variant: "blue-soft" },
    },
  },

  // Threshold-declaration flag (Score Config detail → Healthy threshold section).
  // Muted, its own group so the label mapping stays scoped and never leaks into
  // the shared `fieldTag` chips.
  thresholdFlag: {
    mode: "plain",
    shape: "pill",
    values: {
      notdeclared: { variant: "default-soft", labelKey: "onlineEvals.scoreConfig.detail.noThreshold" },
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
      completed: { variant: "success" },
      failed: { variant: "error" },
      processing: { variant: "primary" },
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
      pass: { variant: "success-soft", icon: "check-circle", label: "PASS" },
      fail: { variant: "error-soft", icon: "cancel", label: "FAIL" },
      unknown: { variant: "default-soft", icon: "help-outline", label: "Unknown" },
    },
    fallback: { variant: "default-soft", icon: "help-outline" },
  },

  // ── Anomaly detection ─────────────────────────────────────────────────────

  // Anomaly-detection job status — dot (soft variants for table density).
  anomalyStatus: {
    mode: "dot",
    shape: "pill",
    values: {
      active: { variant: "success-soft" },
      ready: { variant: "success-soft" },
      training: { variant: "blue-soft" },
      failed: { variant: "error-soft" },
      waiting: { variant: "default-soft" },
      disabled: { variant: "default-soft" },
    },
  },

  // ── Misc lifecycle ────────────────────────────────────────────────────────

  // Backfill / async deletion job status — dot.
  deletionStatus: {
    mode: "dot",
    shape: "pill",
    values: {
      completed: { variant: "success-soft" },
      inprogress: { variant: "blue-soft", label: "In Progress" },
      pending: { variant: "warning-soft" },
      failed: { variant: "error-soft" },
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
      rageclick: { variant: "warning-soft", label: "Rage Click" },
      deadclick: { variant: "default-soft", label: "Dead Click" },
      errorclick: { variant: "error-soft", label: "Error Click" },
      ragetap: { variant: "warning-soft", label: "Rage Tap" },
      errortap: { variant: "error-soft", label: "Error Tap" },
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
  alertState: {
    mode: "icon",
    shape: "pill",
    values: {
      firing: { variant: "error-soft", icon: "error-outline" },
      error: { variant: "error-soft", icon: "error-outline" },
      anomaly: { variant: "error-soft", icon: "error-outline" },
      // `completed` = a finished/OK run → GREEN. It is NOT a firing state for the
      // badge (the timeline aggregates it under firing separately, but the per-row
      // badge reads as Ok).
      completed: { variant: "success-soft", icon: "check-circle-outline" },
      ok: { variant: "success-soft", icon: "check-circle-outline", label: "Ok" },
      success: { variant: "success-soft", icon: "check-circle-outline" },
      normal: { variant: "success-soft", icon: "check-circle-outline" },
      // A non-firing/passed evaluation. The histogram counts these as "Ok", so
      // the badge shows "Ok" too. Key MUST be normalised (no separators) so
      // "condition_not_satisfied", "Condition Not Satisfied", etc. all resolve here.
      conditionnotsatisfied: { variant: "success-soft", icon: "check-circle-outline", label: "Ok" },
      skipped: { variant: "warning-soft", icon: "block" },
      flapping: { variant: "warning-soft", icon: "bolt", label: "Flapping" },
      failed: { variant: "error-soft", icon: "cancel" },
      pending: { variant: "blue-soft", icon: "schedule" },
    },
    fallback: { variant: "default-soft", icon: "help-outline" },
  },

  // Recent-event result (overview) — plain. Failed/Firing run hot (red), Error
  // is the milder amber.
  eventStatus: {
    mode: "plain",
    shape: "pill",
    values: {
      failed: { variant: "error-soft" },
      firing: { variant: "error-soft" },
      error: { variant: "warning-soft" },
    },
    fallback: { variant: "default-soft" },
  },

  // Incident correlation reason — plain. i18n labels.
  correlationReason: {
    mode: "plain",
    shape: "pill",
    values: {
      servicediscovery: { variant: "primary-soft", labelKey: "alerts.incidents.correlationServiceDiscovery" },
      primarymatch: { variant: "primary-soft", labelKey: "alerts.incidents.correlationPrimaryMatch" },
      secondarymatch: { variant: "warning-soft", labelKey: "alerts.incidents.correlationSecondaryMatch" },
      alertid: { variant: "default-soft", labelKey: "alerts.incidents.correlationAlertId" },
    },
    fallback: { variant: "default-soft" },
  },

  // AI toolset kind — plain.
  aiToolsetKind: {
    mode: "plain",
    shape: "pill",
    values: {
      mcp: { variant: "primary-soft", label: "MCP" },
      cli: { variant: "success-soft", label: "CLI" },
      skill: { variant: "warning-soft" },
      generic: { variant: "default-soft" },
    },
    fallback: { variant: "default-soft" },
  },

  // Dimension cardinality class — dot, low→high heat.
  cardinalityClass: {
    mode: "dot",
    shape: "pill",
    values: {
      verylow: { variant: "success-soft", label: "Very Low" },
      low: { variant: "success-soft" },
      medium: { variant: "warning-soft" },
      high: { variant: "error-soft" },
      veryhigh: { variant: "error-soft", label: "Very High" },
      unknown: { variant: "default-soft" },
    },
    fallback: { variant: "default-soft" },
  },

  // Service-graph latency/error delta vs baseline — plain.
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
      success: { variant: "success-soft" },
      ok: { variant: "success-soft", label: "OK" },
      error: { variant: "error-soft" },
      timeout: { variant: "warning-soft" },
      skipped: { variant: "default-soft" },
      warn: { variant: "warning-soft" },
      bad: { variant: "error-soft" },
    },
    fallback: { variant: "default-soft" },
  },

  // LLM session outcome (derived from error_count) — dot + soft colour.
  sessionStatus: {
    mode: "dot",
    shape: "pill",
    values: {
      ok: { variant: "success-soft", label: "Ok" },
      error: { variant: "error-soft", label: "Error" },
    },
    fallback: { variant: "default-soft" },
  },

  qualityStatus: {
    mode: "dot",
    shape: "pill",
    class: "!bg-transparent !p-0 !ring-0",
    values: {
      healthy: { variant: "success-soft" },
      warn: { variant: "warning-soft" },
      unhealthy: { variant: "error-soft" },
      nothreshold: { variant: "default-soft", label: "No Threshold" },
      nodata: { variant: "default-soft", label: "No Data" },
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
      view: { variant: "blue-soft" },
      action: { variant: "purple-soft" },
      error: { variant: "error-soft" },
      resource: { variant: "teal-soft" },
      longtask: { variant: "warning-soft", label: "Long Task" },
    },
    fallback: { variant: "default-soft" },
  },

  // Cross-link source — plain.
  crossLinkSource: {
    mode: "plain",
    shape: "pill",
    values: {
      stream: { variant: "primary-soft", label: "Stream" },
      global: { variant: "default-soft", label: "Global" },
    },
    fallback: { variant: "default-soft" },
  },

  // Subscription plan — PILL (plan/marketing badge).
  subscriptionPlan: {
    mode: "plain",
    shape: "pill",
    values: {
      free: { variant: "default-soft" },
      payasyougo: { variant: "blue-soft", label: "Pay as you go" },
      enterprise: { variant: "purple-soft" },
    },
    fallback: { variant: "default-soft" },
  },

  // Synthetic monitor type — plain, PILL.
  syntheticType: {
    mode: "plain",
    shape: "pill",
    size: "sm",
    values: {
      http:    { variant: "blue-soft",    label: "HTTP" },
      browser: { variant: "purple-soft",  label: "Browser" },
      api:     { variant: "success-soft", label: "API" },
      tcp:     { variant: "orange-soft",  label: "TCP" },
      ping:    { variant: "default-soft", label: "Ping" },
      dns:     { variant: "amber-soft",   label: "DNS" },
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
      aws: { variant: "success-soft", label: "AWS Marketplace" },
      azure: { variant: "success-soft", label: "Azure Marketplace" },
      stripe: { variant: "default-soft", label: "Stripe" },
      contract: { variant: "default-soft", label: "Contract" },
    },
    fallback: { variant: "default-soft" },
  },

  // "Applied" indicator (e.g. the active predefined theme) — icon + PILL.
  themeApplied: {
    mode: "icon",
    shape: "pill",
    size: "sm",
    values: {
      applied: { variant: "success-soft", icon: "check-circle", label: "Applied" },
    },
    fallback: { variant: "success-soft", icon: "check-circle", label: "Applied" },
  },

  // Feature flags — PILL, extra-small (compact BETA / HA / Coming Soon chips).
  featureFlag: {
    mode: "plain",
    shape: "pill",
    size: "xs",
    values: {
      beta: { variant: "primary-soft", label: "BETA" },
      ha: { variant: "primary-soft", label: "HA" },
      comingsoon: { variant: "default-soft", label: "Coming Soon" },
    },
    fallback: { variant: "default-soft" },
  },
} satisfies Record<string, BadgeGroupConfig>;

export type BadgeGroupName = keyof typeof BADGE_GROUPS;

export interface ResolvedBadge {
  variant: BadgeVariant;
  label: string;
  /** i18n key for the label, if the matched value declared one. `OTag`
   *  translates this when no explicit `label` is supplied. */
  labelKey?: string;
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

/** Generic single-value fallback derived from the semantic engine. */
function genericEntry(value: unknown): BadgeValueConfig {
  return { variant: statusVariant(value).variant };
}

/** Soft fallback palette for dimension keys not present in the registry. */
const DIMENSION_FALLBACK_VARIANTS: BadgeVariant[] = [
  "default-soft", "amber-soft", "purple-soft", "blue-soft", "teal-soft", "indigo-soft",
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
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
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
