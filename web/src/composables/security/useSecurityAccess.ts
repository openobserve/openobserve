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

import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import config from "@/aws-exports";
import { queryClient } from "@/composables/query/queryClient";
import { securityAccessQuery } from "@/services/security.queries";
import type { SecurityAccess } from "@/services/security";
import {
  featureState,
  licenseDeniedFeatures,
  type FeatureState,
  type FeatureStates,
} from "@/utils/featureGate";
import type { AccessDenial } from "@/composables/useAccessStore";

const NO_ACCESS: SecurityAccess = { read: false, triage: false, author: false, admin: false };

/** Security ships only in enterprise and cloud builds; OSS never shows it. */
export const isSecurityGated = (): boolean =>
  config.isEnterprise === "true" || config.isCloud === "true";

export const securityFeatureState = (features: FeatureStates | undefined): FeatureState =>
  isSecurityGated() ? featureState(features, "security") : "hidden";

/** Role presets a Security denial points at, by the job that holds the missing grant. */
export type SecurityPresetId =
  "security_viewer" | "soc_analyst" | "detection_engineer" | "security_admin";

const SECURITY_PRESET_BY_PERMISSION: Partial<Record<AccessDenial["permission"], SecurityPresetId>> =
  {
    list: "security_viewer",
    get: "security_viewer",
    update: "soc_analyst",
    create: "detection_engineer",
    delete: "security_admin",
  };

// The pages read these alongside Security, and the viewer preset grants each of them.
const SECURITY_READ_COMPANIONS = new Set(["streams", "alerts", "alert_folders", "incidents"]);
// Intel reads threat-intel lists, which the viewer preset leaves out and the analyst preset grants.
const SECURITY_ANALYST_COMPANIONS = new Set(["enrichment_tables"]);

/** The preset that lifts the first denial it can name, or null when none of the denials is a Security one. */
export const securityPresetFor = (denials: AccessDenial[]): SecurityPresetId | null => {
  for (const { resource, permission } of denials) {
    if (resource.key === "security") return SECURITY_PRESET_BY_PERMISSION[permission] ?? null;
    if (
      SECURITY_READ_COMPANIONS.has(resource.key) &&
      (permission === "list" || permission === "get")
    )
      return "security_viewer";
    if (
      SECURITY_ANALYST_COMPANIONS.has(resource.key) &&
      (permission === "list" || permission === "get")
    )
      return "soc_analyst";
  }
  return null;
};

/** Whether the signed-in user can edit roles, so a lock can link to a preset instead of saying who to ask. */
export const canManageRoles = (state: { currentuser?: { role?: string } | null }): boolean =>
  ["admin", "root"].includes(String(state.currentuser?.role ?? "").toLowerCase());

/** Whether a request failed for lack of a grant, which a page shows as a lock rather than an error. */
export const isForbiddenError = (error: unknown): boolean =>
  (error as { response?: { status?: number } } | null)?.response?.status === 403 &&
  licenseDeniedFeatures(error) === null;

/** The server's own reason for a 403, such as the streams it could not read; empty when it names nothing. */
export const forbiddenReason = (error: unknown): string => {
  if (!isForbiddenError(error)) return "";
  const data = (error as { response?: { data?: { message?: unknown } } }).response?.data;
  const message = typeof data?.message === "string" ? data.message.trim() : "";
  return /^unauthorized access\.?$/i.test(message) ? "" : message;
};

/** The org's access; a request that still fails after the query's retries answers no access, so Security fails closed. */
export const loadSecurityAccess = async (org: string): Promise<SecurityAccess> => {
  if (!isSecurityGated()) return NO_ACCESS;
  try {
    return await queryClient.fetchQuery(securityAccessQuery(org));
  } catch {
    return NO_ACCESS;
  }
};

/** Whether the caller may enter, triage in, author detections in and administer Security in the selected org. */
export function useSecurityAccess() {
  const store = useStore();
  const gated = isSecurityGated();
  const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
  const query = useQuery(() => ({
    ...securityAccessQuery(org.value),
    enabled: gated && !!org.value,
  }));

  const feature = computed(() => securityFeatureState(store.state.zoConfig?.features));
  const access = computed<SecurityAccess>(() => {
    if (!gated || query.isError.value) return NO_ACCESS;
    return query.data.value ?? NO_ACCESS;
  });
  const loaded = computed(() => !gated || query.isSuccess.value || query.isError.value);
  // A refusal is an answer; anything else (offline, 5xx) leaves access unknown, so the page offers a retry.
  const failed = computed(() => {
    if (!gated || !query.isError.value) return false;
    const status = (query.error.value as { response?: { status?: number } } | null)?.response
      ?.status;
    return status !== 401 && status !== 403;
  });
  const canEnter = computed(() => access.value.read && feature.value !== "hidden");
  const licenseLocked = computed(() => feature.value === "locked");

  return {
    loaded,
    canEnter,
    /** Enter, or reach the locked upsell that every member of a locked license sees. */
    canOpen: computed(() => canEnter.value || licenseLocked.value),
    canTriage: computed(() => canEnter.value && access.value.triage),
    canAuthor: computed(() => canEnter.value && access.value.author),
    canAdmin: computed(() => canEnter.value && access.value.admin),
    licenseLocked,
    feature,
    failed,
    retry: () => query.refetch(),
  };
}
