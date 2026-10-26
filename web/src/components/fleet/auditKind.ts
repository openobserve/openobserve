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

/** What an audit action acted on, derived from the action key the server stores. */
export type AuditKind =
  "fleet" | "collector" | "configuration" | "rollout" | "token" | "settings" | "other";

export const AUDIT_KINDS: AuditKind[] = [
  "fleet",
  "collector",
  "configuration",
  "rollout",
  "token",
  "settings",
];

const KIND_OF: Record<string, AuditKind> = {
  createdFleet: "fleet",
  renamedFleet: "fleet",
  deletedFleet: "fleet",
  updatedFleetSettings: "fleet",
  enrolledCollector: "collector",
  movedByToken: "collector",
  movedCollectors: "collector",
  removedCollector: "collector",
  renamedCollector: "collector",
  restartedCollector: "collector",
  redeliveredCollector: "collector",
  assignedFleetConfig: "collector",
  createdConfig: "configuration",
  editedConfig: "configuration",
  publishedVersion: "configuration",
  deletedConfig: "configuration",
  setDesired: "rollout",
  rolloutHalted: "rollout",
  autoRollback: "rollout",
  resumedRollout: "rollout",
  skippedInRollout: "rollout",
  rolledBackRollout: "rollout",
  createdToken: "token",
  revokedToken: "token",
  updatedSettings: "settings",
};

export function auditKind(action: string): AuditKind {
  return KIND_OF[action.replace(/^fleet\.audit\./, "")] ?? "other";
}
