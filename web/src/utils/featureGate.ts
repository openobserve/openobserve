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

export type FeatureState = "enabled" | "locked" | "hidden";

/** The `features` map of the org config response, keyed by snake_case feature name. */
export type FeatureStates = Partial<Record<string, FeatureState>>;

const LICENSE_FEATURE_NOT_ENTITLED = 40001;

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
