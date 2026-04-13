// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Primary platform environment segments.
 *
 * These cover the "opinionated" cloud/orchestration platforms (Kubernetes,
 * AWS, Azure, GCP). When any group from getDimensionAnalytics has one of
 * these prefixes AND its field is present in the current stream schema, only
 * those platform-specific resource tabs are shown. Otherwise, the generic
 * fallback tabs (host, container, faas, process, cloud) are shown instead.
 *
 * Shared between ServiceIdentitySetup.vue and ServiceGraphNodeSidePanel.vue.
 */
export const ENV_SEGMENTS: Record<string, { key: string; label: string }> = {
  k8s: { key: "k8s", label: "K8s" },
  aws: { key: "aws", label: "AWS" },
  azure: { key: "azure", label: "Azure" },
  gcp: { key: "gcp", label: "GCP" },
};

/**
 * Returns the environment key for a group_id using its first dash-separated
 * segment, or null if the segment is not a primary platform environment.
 *
 * @example groupEnvKey("k8s-pod")    // → "k8s"
 * @example groupEnvKey("aws-ec2")    // → "aws"
 * @example groupEnvKey("host")       // → null  (fallback env, not primary)
 */
export function groupEnvKey(groupId: string): string | null {
  const seg = groupId.split("-")[0];
  return ENV_SEGMENTS[seg]?.key ?? null;
}
