// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import config from "@/aws-exports";
import { gt, raw, type I18nKey, type I18nText } from "@/types/i18n";

/**
 * The ONE registry of enterprise/cloud-only features in the app — every
 * surface calls {@link checkFeatureAccess} with a key from here instead of
 * re-deriving its own `config.isEnterprise == "true"` check. A future backend
 * flag endpoint only has to change a predicate's body here.
 */
export type FeatureKey =
  | "enterprise"
  | "rbac"
  | "cipherKeys"
  | "aiToolsets"
  | "regexPatterns"
  | "domainManagement"
  | "passwordPolicy"
  | "pipelineDestinations"
  | "storageSettings"
  | "queryManagement"
  | "nodes"
  | "license"
  | "correlationSettings"
  | "modelPricing"
  | "llmProviders"
  | "genAiAgentMapping"
  | "incidents"
  | "workflows"
  | "oncall"
  | "logPatterns"
  | "correlation"
  | "aiAssistant"
  | "alertInsights";

/**
 * The flags every predicate below reads — EDITION-only, plus RBAC's own
 * backend toggle. Meta-org restrictions and other runtime `*_enabled` flags
 * are a separate, orthogonal `visible`/hide condition callers apply on top —
 * only the edition (+ RBAC toggle) check lives here.
 */
export interface FeatureGateContext {
  isEnterprise: boolean;
  isCloud: boolean;
  /**
   * `rbac_enabled` defaults OPEN (`!== false`, not `!!`) so a cold load with
   * `zoConfig` still `{}` doesn't lock out a real Enterprise/Cloud user with
   * RBAC on — same `=== false` convention the other runtime-flag route
   * guards in this codebase already use (see useEnterpriseRoutes.ts).
   */
  rbac: boolean;
}

/**
 * Builds the context from `config` (build-time) plus whatever
 * `zoConfig`-shaped object the caller has — their own `store.state.zoConfig`
 * or the route table's store singleton. Not importing the store singleton
 * here directly keeps this module `@/stores`-free for callers whose tests
 * mock that neighbor.
 */
export function buildFeatureGateContext(
  zoConfig?: { rbac_enabled?: boolean } | null,
): FeatureGateContext {
  return {
    isEnterprise: config.isEnterprise == "true",
    isCloud: config.isCloud == "true",
    rbac: zoConfig?.rbac_enabled !== false,
  };
}

interface FeatureGateDefinition {
  predicate: (ctx: FeatureGateContext) => boolean;
  /** An EXISTING menu/settings label key, interpolated into the generic locked message. */
  labelKey: I18nKey;
  /** A full-sentence, benefit-led message that replaces the generic one — for features discovered by browsing the nav. */
  pitchKey?: I18nKey;
  /**
   * False for a feature Cloud never offers at all (self-hosted-only, e.g.
   * cipher keys). A pure-Cloud build then reports `visible: false` instead of
   * locked, so callers hide it rather than showing a false upsell. Omit for a
   * predicate that already includes `isCloud` — nothing extra to hide there.
   */
  cloudOffers?: false;
}

const FEATURE_GATES: Record<FeatureKey, FeatureGateDefinition> = {
  // Generic "this needs Enterprise" gate — e.g. the Traces Service Graph tab,
  // which has no settings/IAM label of its own to borrow. Self-hosted only,
  // same as the Settings batch below — Cloud doesn't offer it either.
  enterprise: {
    predicate: (c) => c.isEnterprise,
    labelKey: "menu.serviceGraph",
    pitchKey: "enterpriseFeature.pitch.serviceGraph",
    cloudOffers: false,
  },
  // Used for groups/roles AND quota — quota additionally requires meta-org,
  // applied as a separate `visible` hide at the call site (see the doc
  // comment on FeatureGateContext). Cloud DOES offer RBAC, so no
  // `cloudOffers: false` here — a locked-but-visible state is correct.
  rbac: {
    predicate: (c) => (c.isEnterprise || c.isCloud) && c.rbac,
    labelKey: "iam.sectionPermissions",
    pitchKey: "enterpriseFeature.pitch.rbac",
  },
  // This whole batch is self-hosted-only: no self-serve "upgrade" story on
  // Cloud exists for managing your own nodes, cipher keys, or license.
  cipherKeys: {
    predicate: (c) => c.isEnterprise,
    labelKey: "settings.cipherKeys",
    cloudOffers: false,
  },
  aiToolsets: {
    predicate: (c) => c.isEnterprise,
    labelKey: "aiToolset.header",
    cloudOffers: false,
  },
  regexPatterns: {
    predicate: (c) => c.isEnterprise,
    labelKey: "regex_patterns.title",
    cloudOffers: false,
  },
  domainManagement: {
    predicate: (c) => c.isEnterprise,
    labelKey: "settings.ssoDomainRestrictions",
    cloudOffers: false,
  },
  passwordPolicy: {
    predicate: (c) => c.isEnterprise,
    labelKey: "settings.passwordPolicy",
    cloudOffers: false,
  },
  pipelineDestinations: {
    predicate: (c) => c.isEnterprise,
    labelKey: "pipeline_destinations.header",
    cloudOffers: false,
  },
  storageSettings: {
    predicate: (c) => c.isEnterprise,
    labelKey: "storage_settings.tabLabel",
    cloudOffers: false,
  },
  queryManagement: {
    predicate: (c) => c.isEnterprise,
    labelKey: "settings.queryManagement",
    cloudOffers: false,
  },
  nodes: { predicate: (c) => c.isEnterprise, labelKey: "settings.nodes", cloudOffers: false },
  license: { predicate: (c) => c.isEnterprise, labelKey: "settings.license", cloudOffers: false },
  correlationSettings: {
    predicate: (c) => c.isEnterprise,
    labelKey: "settings.correlationSettings",
    cloudOffers: false,
  },
  modelPricing: {
    predicate: (c) => c.isEnterprise || c.isCloud,
    labelKey: "settings.llmModelPricing",
  },
  llmProviders: {
    predicate: (c) => c.isEnterprise || c.isCloud,
    labelKey: "llmProviders.tabLabel",
  },
  genAiAgentMapping: {
    predicate: (c) => c.isEnterprise || c.isCloud,
    labelKey: "settings.genAiAgentMapping.tabLabel",
  },
  incidents: {
    predicate: (c) => c.isEnterprise || c.isCloud,
    labelKey: "menu.incidents",
    pitchKey: "enterpriseFeature.pitch.incidents",
  },
  workflows: {
    predicate: (c) => c.isEnterprise || c.isCloud,
    labelKey: "menu.workflows",
    pitchKey: "enterpriseFeature.pitch.workflows",
  },
  oncall: {
    predicate: (c) => c.isEnterprise || c.isCloud,
    labelKey: "menu.onCall",
    pitchKey: "enterpriseFeature.pitch.oncall",
  },
  // Log-pattern mining — the Logs search "Patterns" toggle AND the stream
  // Schema page's per-field pattern-association picker are the same
  // capability surfaced in two places, so they share this one gate.
  logPatterns: {
    predicate: (c) => c.isEnterprise,
    labelKey: "search.showPatternsLabel",
    pitchKey: "enterpriseFeature.pitch.logPatterns",
    cloudOffers: false,
  },
  // Service-stream correlation — the Logs row drawer's View Related button
  // and its Logs/Metrics/Traces tabs.
  correlation: {
    predicate: (c) => c.isEnterprise,
    labelKey: "search.viewRelated",
    pitchKey: "enterpriseFeature.pitch.correlation",
    cloudOffers: false,
  },
  // The AI assistant family (header chat panel, query-editor "Ask AI" bar).
  // Cloud is always built with isEnterprise=true too, so `isEnterprise ||
  // isCloud` matches today's real-world behavior while following the same
  // dual-predicate convention as rbac/workflows/oncall above.
  aiAssistant: {
    predicate: (c) => c.isEnterprise || c.isCloud,
    labelKey: "menu.aiAssistant",
    pitchKey: "enterpriseFeature.pitch.aiAssistant",
  },
  alertInsights: {
    predicate: (c) => c.isEnterprise,
    labelKey: "alerts.insights.title",
    pitchKey: "enterpriseFeature.pitch.alertInsights",
    cloudOffers: false,
  },
};

/** True when `key` names a registered feature gate (vs. some other `gate`/flag string a caller is checking). */
export function isFeatureKey(key: string): key is FeatureKey {
  return Object.prototype.hasOwnProperty.call(FEATURE_GATES, key);
}

export interface FeatureAccess {
  allowed: boolean;
  /** False means hide this feature ENTIRELY — not locked, not shown at all. Always true when `allowed` is true. */
  visible: boolean;
  /** Empty when `allowed` (or not `visible`) — nothing to tell the user. */
  message: I18nText;
  /**
   * False only for the one case where upgrading wouldn't help: an edition
   * that already supports the feature, but an admin-configured flag (RBAC)
   * is off. Callers that render an "Upgrade" CTA next to `message` should
   * suppress it when this is false. Always true otherwise.
   */
  ctaRelevant: boolean;
}

/**
 * The one function every surface calls with a feature key to find out
 * whether it's available in this build, and what to tell the user if not.
 * `context` is required (not defaulted) so every call site is explicit about
 * where its state comes from — see {@link buildFeatureGateContext}.
 */
export function checkFeatureAccess(key: FeatureKey, context: FeatureGateContext): FeatureAccess {
  const gate = FEATURE_GATES[key];
  const allowed = gate.predicate(context);
  if (allowed) return { allowed: true, visible: true, message: raw(""), ctaRelevant: true };
  const pureCloud = context.isCloud && !context.isEnterprise;
  if (gate.cloudOffers === false && pureCloud) {
    return { allowed: false, visible: false, message: raw(""), ctaRelevant: true };
  }
  // RBAC alone depends on an admin toggle, not just edition — an edition
  // that already supports it just needs the toggle on, so "upgrade" is a
  // false, confusing CTA here.
  if (key === "rbac" && (context.isEnterprise || context.isCloud) && !context.rbac) {
    return {
      allowed: false,
      visible: true,
      message: gt("enterpriseFeature.rbacDisabled"),
      ctaRelevant: false,
    };
  }
  const message = gate.pitchKey
    ? gt(gate.pitchKey)
    : gt("enterpriseFeature.locked", { feature: gt(gate.labelKey) });
  return { allowed: false, visible: true, message, ctaRelevant: true };
}

/**
 * Wraps a route guard so navigation redirects to the shared locked-feature
 * page instead of proceeding, when `key` isn't unlocked. Must be a GUARD, not
 * a choice of `component:` — vue-router permanently caches a route's first-
 * resolved lazy component (`extractComponentsGuards`:
 * `record.components[name] = resolvedComponent`), so picking between two
 * components would freeze at whichever resolved first. A guard re-runs every
 * navigation, so it can safely depend on state that's still loading.
 *
 * `getContext` defaults to the edition-only context (no `rbac` dependency);
 * pass one that reads `store.state.zoConfig` for a route whose key needs it.
 */
export function withFeatureGate(
  key: FeatureKey,
  guard: (to: any, from: any, next: any) => void,
  getContext: () => FeatureGateContext = () => buildFeatureGateContext(),
) {
  return (to: any, from: any, next: any) => {
    if (!checkFeatureAccess(key, getContext()).allowed) {
      next({
        name: "enterpriseFeatureLocked",
        query: { feature: key, org_identifier: to.query?.org_identifier, redirect: to.fullPath },
      });
      return;
    }
    guard(to, from, next);
  };
}
