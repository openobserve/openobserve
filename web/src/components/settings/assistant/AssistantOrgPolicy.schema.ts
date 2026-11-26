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

import { z } from "zod";

import type { OrgAiSettings, OrgAiSettingsUpdate } from "@/services/assistant_settings";

export const assistantOrgPolicySchema = z.object({
  enabled: z.boolean(),
  permission_tier: z.enum(["read", "propose", "act_with_approval"]),
  org_sharing: z.boolean(),
  public_sharing: z.boolean(),
});

export type AssistantOrgPolicyValues = z.infer<typeof assistantOrgPolicySchema>;

/** What the deployment does today when no org setting exists; every value is one the server already enforces. */
export interface DeploymentPolicy {
  aiEnabled: boolean;
  publicLinksAllowed: boolean;
}

/** Controls the admin cannot change right now; their stored values are never rewritten by a save. */
export interface PolicyLocks {
  tier: boolean;
  publicLinks: boolean;
}

const POLICY_KEYS = ["enabled", "permission_tier", "org_sharing", "public_sharing"] as const;

/** The form's starting values: the stored policy, with a tier the agent cannot enforce shown as the one it applies. */
export function policyValues(
  settings: OrgAiSettings | null | undefined,
  deployment: DeploymentPolicy,
  locks: PolicyLocks,
): AssistantOrgPolicyValues {
  if (!settings) {
    return {
      enabled: deployment.aiEnabled,
      permission_tier: "act_with_approval",
      org_sharing: true,
      public_sharing: deployment.publicLinksAllowed,
    };
  }
  return {
    enabled: settings.enabled,
    permission_tier: locks.tier ? "act_with_approval" : settings.permission_tier,
    org_sharing: settings.org_sharing,
    public_sharing: settings.public_sharing,
  };
}

/** Only the keys the admin changed since the form loaded, minus locked ones, so a save never rewrites the rest. */
export function policyUpdate(
  values: AssistantOrgPolicyValues,
  baseline: AssistantOrgPolicyValues,
  locks: PolicyLocks,
): Partial<OrgAiSettingsUpdate> {
  const changes: Partial<OrgAiSettingsUpdate> = {};
  for (const key of POLICY_KEYS) {
    if (key === "permission_tier" && locks.tier) continue;
    if (key === "public_sharing" && locks.publicLinks) continue;
    if (values[key] !== baseline[key]) Object.assign(changes, { [key]: values[key] });
  }
  return changes;
}
