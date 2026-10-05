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
 * The ONE registry of enterprise/cloud-only features in the app. Every
 * surface that needs to know "is this feature available in this build, and
 * what do I tell the user if not" calls {@link checkFeatureAccess} with a key
 * from here — never re-derives its own `config.isEnterprise == "true"` check.
 *
 * This is also the single place a future backend feature-flag endpoint plugs
 * in: swap a predicate's body to read a server-provided flag instead of
 * `config.isEnterprise`/`isCloud` (e.g. `ctx.remoteFlags?.[key]`) and every
 * caller of `checkFeatureAccess` keeps working unchanged.
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
  | "oncall";

/**
 * The flags every predicate below reads — deliberately EDITION-only (plus the
 * one feature, RBAC, whose backend flag gates it independently of edition).
 *
 * Meta-org restrictions, admin-configured runtime toggles (`*_enabled` from
 * `/config`) and similar are a DIFFERENT, orthogonal concern: they decide
 * whether a section applies at all (e.g. a non-meta org has no cluster-level
 * Nodes page to upgrade into), not whether upgrading the edition would unlock
 * it. Callers keep applying those as a separate `visible`/hide condition, same
 * as before this registry existed — only the edition check moves here.
 */
export interface FeatureGateContext {
  isEnterprise: boolean;
  isCloud: boolean;
  rbac: boolean;
}

/**
 * Builds the context from `config` (build-time, always available) plus
 * whatever `zoConfig`-shaped object the caller already has — their own
 * `store.state.zoConfig` (component) or the raw store singleton's (route
 * table; see useEnterpriseRoutes.ts for the existing precedent of importing
 * it directly there).
 *
 * Deliberately NOT importing the store singleton here: this module needs to
 * stay free of a `@/stores` dependency so it can be imported by any
 * component without pulling the whole store module (and its own
 * `@/utils/zincutils` calls) into unit tests that mock that neighbor.
 */
export function buildFeatureGateContext(
  zoConfig?: { rbac_enabled?: boolean } | null,
): FeatureGateContext {
  return {
    isEnterprise: config.isEnterprise == "true",
    isCloud: config.isCloud == "true",
    rbac: !!zoConfig?.rbac_enabled,
  };
}

interface FeatureGateDefinition {
  predicate: (ctx: FeatureGateContext) => boolean;
  /** An EXISTING menu/settings label key, interpolated into the generic locked message. */
  labelKey: I18nKey;
  /**
   * A full-sentence, benefit-led locked message that REPLACES the generic
   * "{feature} is an Enterprise feature…" one. Reserved for the handful of
   * features people actually discover by browsing the nav (where the point
   * is to make them want to upgrade, not just explain why a click did
   * nothing) — the Settings/IAM admin pages stay on the plain generic copy.
   */
  pitchKey?: I18nKey;
}

const FEATURE_GATES: Record<FeatureKey, FeatureGateDefinition> = {
  // Generic "this needs Enterprise or Cloud" gate — e.g. the Traces Service
  // Graph tab, which has no settings/IAM label of its own to borrow.
  enterprise: {
    predicate: (c) => c.isEnterprise,
    labelKey: "menu.serviceGraph",
    pitchKey: "enterpriseFeature.pitch.serviceGraph",
  },
  // Used for groups/roles AND quota — quota additionally requires meta-org,
  // applied as a separate `visible` hide at the call site (see the doc
  // comment on FeatureGateContext).
  rbac: {
    predicate: (c) => (c.isEnterprise || c.isCloud) && c.rbac,
    labelKey: "iam.sectionPermissions",
    pitchKey: "enterpriseFeature.pitch.rbac",
  },
  cipherKeys: { predicate: (c) => c.isEnterprise, labelKey: "settings.cipherKeys" },
  aiToolsets: { predicate: (c) => c.isEnterprise, labelKey: "aiToolset.header" },
  regexPatterns: { predicate: (c) => c.isEnterprise, labelKey: "regex_patterns.title" },
  domainManagement: {
    predicate: (c) => c.isEnterprise,
    labelKey: "settings.ssoDomainRestrictions",
  },
  passwordPolicy: {
    predicate: (c) => c.isEnterprise,
    labelKey: "settings.passwordPolicy",
  },
  pipelineDestinations: {
    predicate: (c) => c.isEnterprise,
    labelKey: "pipeline_destinations.header",
  },
  storageSettings: { predicate: (c) => c.isEnterprise, labelKey: "storage_settings.tabLabel" },
  queryManagement: {
    predicate: (c) => c.isEnterprise,
    labelKey: "settings.queryManagement",
  },
  nodes: { predicate: (c) => c.isEnterprise, labelKey: "settings.nodes" },
  license: { predicate: (c) => c.isEnterprise, labelKey: "settings.license" },
  correlationSettings: {
    predicate: (c) => c.isEnterprise,
    labelKey: "settings.correlationSettings",
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
};

/** True when `key` names a registered feature gate (vs. some other `gate`/flag string a caller is checking). */
export function isFeatureKey(key: string): key is FeatureKey {
  return Object.prototype.hasOwnProperty.call(FEATURE_GATES, key);
}

export interface FeatureAccess {
  allowed: boolean;
  /** Empty when `allowed` — nothing to tell the user. */
  message: I18nText;
}

/**
 * The one function every surface calls with a feature key to find out
 * whether it's available in this build, and — when it isn't — the message to
 * show instead of letting the user reach it.
 *
 * `context` is required rather than defaulted so every call site is explicit
 * about where its build/runtime state comes from — see
 * {@link buildFeatureGateContext}.
 */
export function checkFeatureAccess(key: FeatureKey, context: FeatureGateContext): FeatureAccess {
  const gate = FEATURE_GATES[key];
  const allowed = gate.predicate(context);
  if (allowed) return { allowed, message: raw("") };
  const message = gate.pitchKey
    ? gt(gate.pitchKey)
    : gt("enterpriseFeature.locked", { feature: gt(gate.labelKey) });
  return { allowed, message };
}
