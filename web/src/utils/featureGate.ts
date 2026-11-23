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

import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { LicenseDecision } from "@/utils/licenseWaivers";

export type FeatureState = "enabled" | "locked" | "hidden";

/** The `features` map of the org config response, keyed by snake_case feature name. */
export type FeatureStates = Partial<Record<string, FeatureState>>;

const LICENSE_FEATURE_NOT_ENTITLED = 40001;

/** Daily GB the backend applies to an expired license or one without an ingestion limit. */
export const FREE_LIMIT_GB = 50;

// Icon mirrors each feature's own nav entry.
export const LOCKED_FEATURES: Partial<Record<string, { icon: IconName }>> = {
  ai_assistant: { icon: "auto-awesome" },
};

interface RejectedResponse {
  response?: { status?: number; data?: { code?: unknown; error_detail?: unknown } };
}

/** A key the backend did not send is enabled: older backends and ungated features omit it. */
export const featureState = (features: FeatureStates | undefined, key: string): FeatureState =>
  features?.[key] ?? "enabled";

/** Menu state for a feature whose enabled path still needs its own runtime flag. */
export const menuState = (
  features: FeatureStates | undefined,
  key: string,
  enabledWhen: boolean,
): FeatureState => {
  const state = featureState(features, key);
  if (state !== "enabled") return state;
  return enabledWhen ? "enabled" : "hidden";
};

const SIGNAL_FEATURES: Partial<Record<string, string>> = {
  logs: "logs",
  metrics: "metrics",
  traces: "traces",
};

/** License key of a stream type; the backend reads a missing type as logs, other types have no key. */
export const streamTypeFeature = (streamType?: string | null): string | null =>
  SIGNAL_FEATURES[streamType || "logs"] ?? null;

/** Path of the shared upsell page, for a locked feature that has no page of its own. */
export const featureLockedPath = (key: string): string => `/feature-locked/${key}`;

interface LicensedRoute {
  meta?: Record<string, unknown>;
  children?: LicensedRoute[];
}

/** Tags a route and its children with the license feature their page needs (`meta.licenseFeature`). */
export const withLicenseFeature = <T extends object>(key: string, route: T): T => {
  // `T extends object`, not LicensedRoute: a weak-type constraint rejects inline route literals.
  const { meta, children } = route as LicensedRoute;
  return {
    ...route,
    meta: { ...meta, licenseFeature: key },
    ...(children ? { children: children.map((child) => withLicenseFeature(key, child)) } : {}),
  };
};

/** A denied list's state: false, true for an RBAC 403, or the missing feature keys of a license 403. */
export type ForbiddenState = boolean | string[];

export const forbiddenState = (error: unknown): ForbiddenState =>
  licenseDeniedFeatures(error) ?? (error as RejectedResponse | undefined)?.response?.status === 403;

/** Missing feature keys of a license denial (403 + 40001), or null for any other error. */
export const licenseDeniedFeatures = (error: unknown): string[] | null => {
  const response = (error as RejectedResponse | undefined)?.response;
  if (response?.status !== 403 || response.data?.code !== LICENSE_FEATURE_NOT_ENTITLED) return null;
  const detail = response.data.error_detail;
  if (typeof detail !== "string") return [];
  return detail
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
};

interface FeatureDefinition {
  display_name?: string;
  gate?: boolean;
  plumbing?: boolean;
}

export interface LicenseFeatureSource {
  features?: string[] | null;
  feature_definition?: { features?: Record<string, FeatureDefinition> } | null;
}

/** A license's features as unlocked / missing / free / freeNotIncluded / added keys, or null for a pre-entitlement license. */
export const splitLicenseFeatures = (
  license: LicenseFeatureSource | null | undefined,
  states: FeatureStates,
  evaluatedAt?: number,
) => {
  if (!license?.features) return null;
  const definition = license.feature_definition?.features;
  const gated = definition
    ? Object.keys(definition).filter((key) => definition[key].gate && !definition[key].plumbing)
    : Object.keys(states).filter((key) => states[key] === "locked");
  // The backend reads a list of only "all" as every feature, so the page does the same.
  const listsOnlyAll =
    license.features.length > 0 && license.features.every((key) => key === "all");
  const unlocked = (listsOnlyAll ? [...gated] : [...license.features]).sort();
  // `states`, not featureState(): an absent key means an older backend, not a feature that is on.
  // At evaluated_at 0 the config can still hold the previous key's states.
  const freeNotIncluded =
    evaluatedAt === 0
      ? []
      : gated.filter((key) => !unlocked.includes(key) && states[key] === "enabled").sort();
  // A listed key counts as paid even when ungated, so "unlocked of paid" never exceeds the total.
  const paid = new Set([...gated.filter((key) => !freeNotIncluded.includes(key)), ...unlocked]);
  const missing = [...paid].filter((key) => !unlocked.includes(key)).sort();
  const freeCandidates = definition
    ? Object.keys(definition).filter((key) => !definition[key].gate || definition[key].plumbing)
    : Object.keys(states).filter((key) => states[key] === "enabled");
  const free = freeCandidates
    .filter((key) => !unlocked.includes(key) && featureState(states, key) !== "hidden")
    .sort();
  // Unlocked is excluded too so a listed key missing from its own definition never shows twice.
  const added = definition
    ? Object.keys(states)
        .filter((key) => !(key in definition) && !unlocked.includes(key))
        .filter((key) => featureState(states, key) !== "hidden")
        .sort()
    : [];
  const addedLocked = added.filter((key) => featureState(states, key) === "locked");
  return { unlocked, missing, free, freeNotIncluded, added, addedLocked, paid: paid.size };
};

export type LicenseFeatureSplit = ReturnType<typeof splitLicenseFeatures>;

interface LicenseLimits {
  limits?: { Ingestion?: { typ?: string; value?: number } } | null;
}

/** The claims of a key that decide whether replacing another key loses something. */
export interface LicenseTerms extends LicenseFeatureSource, LicenseLimits {
  expires_at: number;
}

export interface LicenseKeyLosses {
  expiredAt?: number;
  lost: string[];
  limit?: { from: number | null; to: number };
  expiry?: { from: number; to: number };
}

/** A license's own daily limit in GB, null for Unlimited. */
const licensedLimitGb = (license: LicenseLimits | null | undefined): number | null => {
  const ingestion = license?.limits?.Ingestion;
  return ingestion?.typ === "Unlimited" ? null : ingestion?.value || FREE_LIMIT_GB;
};

/** The daily limit in force in GB, null for Unlimited; a decision the backend has not evaluated has no limit yet. */
export const effectiveLimitGb = (response: {
  license?: LicenseLimits | null;
  decision?: Pick<LicenseDecision, "limit_today_gb"> | null;
  evaluated_at?: number;
  expired?: boolean;
}): number | null => {
  if (response.decision && response.evaluated_at !== 0) {
    return response.decision.limit_today_gb ?? null;
  }
  return response.expired ? FREE_LIMIT_GB : licensedLimitGb(response.license);
};

/** The license server's request form, told what this installation runs and what its license unlocks. */
export const licenseRequestUrl = (
  zoConfig: {
    license_server_url?: string;
    version?: string;
    feature_revision?: number;
    features?: FeatureStates;
  },
  response: { installation_id?: string; license?: LicenseFeatureSource | null },
  baseUrl: string,
): string => {
  const params = new URLSearchParams({
    base_url: baseUrl,
    license_id: response.installation_id ?? "",
  });
  if (zoConfig.version) params.set("o2_version", zoConfig.version);
  if (zoConfig.feature_revision != null) {
    params.set("feature_revision", String(zoConfig.feature_revision));
  }
  const split = splitLicenseFeatures(response.license, zoConfig.features ?? {});
  if (split) params.set("features", split.unlocked.join(","));
  const serverUrl = String(zoConfig.license_server_url ?? "").replace(/\/+$/, "");
  return `${serverUrl}/user/request-license?${params}`;
};

/** Paid keys only `current` unlocks, judged by both keys' definitions so neither revision hides a gate. */
const lostFeatures = (
  current: LicenseTerms,
  pasted: LicenseTerms,
  states: FeatureStates,
): string[] => {
  const hasDefinition = current.feature_definition?.features || pasted.feature_definition?.features;
  const features = {
    ...current.feature_definition?.features,
    ...pasted.feature_definition?.features,
  };
  const unlocked = (license: LicenseTerms) =>
    splitLicenseFeatures(
      {
        features: license.features ?? ["all"],
        feature_definition: hasDefinition ? { features } : null,
      },
      states,
    )?.unlocked ?? [];
  const kept = unlocked(pasted);
  return unlocked(current).filter((key) => {
    const definition = features[key];
    return !kept.includes(key) && (!definition || (definition.gate && !definition.plumbing));
  });
};

/** What applying `pasted` over `current` makes worse, or null when nothing does. */
export const licenseKeyLosses = (
  current: LicenseTerms | null | undefined,
  pasted: LicenseTerms,
  states: FeatureStates,
  nowUs: number,
): LicenseKeyLosses | null => {
  const pastedExpired = pasted.expires_at < nowUs;
  const losses: LicenseKeyLosses = {
    lost: current ? lostFeatures(current, pasted, states) : [],
    ...(pastedExpired ? { expiredAt: pasted.expires_at } : {}),
  };
  // An expired paste already reports its date and the free limit, so it needs no further lines.
  if (current && !pastedExpired) {
    const from = current.expires_at < nowUs ? FREE_LIMIT_GB : licensedLimitGb(current);
    const to = licensedLimitGb(pasted);
    if (to !== null && (from === null || to < from)) losses.limit = { from, to };
    if (pasted.expires_at < current.expires_at) {
      losses.expiry = { from: current.expires_at, to: pasted.expires_at };
    }
  }
  const worse = losses.lost.length || losses.expiredAt || losses.limit || losses.expiry;
  return worse ? losses : null;
};
