// Copyright 2025 OpenObserve Inc.
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
 * Backend TriggerDataStatus enum values
 * These match the Rust enum in src/config/src/meta/self_reporting/usage.rs
 */
export enum TriggerDataStatus {
  Completed = "completed",
  Failed = "failed",
  ConditionNotSatisfied = "condition_not_satisfied",
  Skipped = "skipped",
}

/**
 * UI-friendly display labels for trigger statuses
 */
export enum TriggerStatusLabel {
  Firing = "Firing",
  Errored = "Errored",
  Resolved = "Resolved",
  Skipped = "Skipped",
}

/**
 * Mapping from backend status to UI display label
 */
export const TRIGGER_STATUS_DISPLAY_MAP: Record<TriggerDataStatus, TriggerStatusLabel> = {
  [TriggerDataStatus.Completed]: TriggerStatusLabel.Firing,
  [TriggerDataStatus.Failed]: TriggerStatusLabel.Errored,
  [TriggerDataStatus.ConditionNotSatisfied]: TriggerStatusLabel.Resolved,
  [TriggerDataStatus.Skipped]: TriggerStatusLabel.Skipped,
};

/**
 * Get UI display label for a backend status value
 */
export function getStatusDisplayLabel(status: string): string {
  return TRIGGER_STATUS_DISPLAY_MAP[status as TriggerDataStatus] || status;
}

/**
 * Generate SQL CASE statement to map backend statuses to UI labels
 * Usage: SELECT ${getStatusMappingSQL('status')} as display_status FROM triggers
 */
export function getStatusMappingSQL(columnName: string = 'status'): string {
  return `CASE
    WHEN ${columnName} = '${TriggerDataStatus.Completed}' THEN '${TriggerStatusLabel.Firing}'
    WHEN ${columnName} = '${TriggerDataStatus.Failed}' THEN '${TriggerStatusLabel.Errored}'
    WHEN ${columnName} = '${TriggerDataStatus.ConditionNotSatisfied}' THEN '${TriggerStatusLabel.Resolved}'
    WHEN ${columnName} = '${TriggerDataStatus.Skipped}' THEN '${TriggerStatusLabel.Skipped}'
    ELSE ${columnName}
  END`;
}

/**
 * Get the backend status value from a UI display label (reverse mapping)
 */
export function getBackendStatusFromLabel(label: string): string | undefined {
  for (const [backendStatus, displayLabel] of Object.entries(TRIGGER_STATUS_DISPLAY_MAP)) {
    if (displayLabel === label) {
      return backendStatus;
    }
  }
  return undefined;
}
