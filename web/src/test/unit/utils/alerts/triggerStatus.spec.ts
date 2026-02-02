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

import { describe, it, expect } from "vitest";
import {
  TriggerDataStatus,
  TriggerStatusLabel,
  TRIGGER_STATUS_DISPLAY_MAP,
  getStatusDisplayLabel,
  getStatusMappingSQL,
  getBackendStatusFromLabel,
} from "@/utils/alerts/triggerStatus";

describe("triggerStatus.ts", () => {
  describe("TriggerDataStatus enum", () => {
    it("should have correct backend status values", () => {
      expect(TriggerDataStatus.Completed).toBe("completed");
      expect(TriggerDataStatus.Failed).toBe("failed");
      expect(TriggerDataStatus.ConditionNotSatisfied).toBe("condition_not_satisfied");
      expect(TriggerDataStatus.Skipped).toBe("skipped");
    });
  });

  describe("TriggerStatusLabel enum", () => {
    it("should have correct UI display labels", () => {
      expect(TriggerStatusLabel.Firing).toBe("Firing");
      expect(TriggerStatusLabel.Errored).toBe("Errored");
      expect(TriggerStatusLabel.Resolved).toBe("Resolved");
      expect(TriggerStatusLabel.Skipped).toBe("Skipped");
    });
  });

  describe("TRIGGER_STATUS_DISPLAY_MAP", () => {
    it("should map backend statuses to UI labels correctly", () => {
      expect(TRIGGER_STATUS_DISPLAY_MAP[TriggerDataStatus.Completed]).toBe(
        TriggerStatusLabel.Firing
      );
      expect(TRIGGER_STATUS_DISPLAY_MAP[TriggerDataStatus.Failed]).toBe(
        TriggerStatusLabel.Errored
      );
      expect(TRIGGER_STATUS_DISPLAY_MAP[TriggerDataStatus.ConditionNotSatisfied]).toBe(
        TriggerStatusLabel.Resolved
      );
      expect(TRIGGER_STATUS_DISPLAY_MAP[TriggerDataStatus.Skipped]).toBe(
        TriggerStatusLabel.Skipped
      );
    });

    it("should have all enum values mapped", () => {
      const enumValues = Object.values(TriggerDataStatus);
      const mappedValues = Object.keys(TRIGGER_STATUS_DISPLAY_MAP);
      expect(mappedValues.length).toBe(enumValues.length);
    });
  });

  describe("getStatusDisplayLabel", () => {
    it("should return correct UI label for completed status", () => {
      expect(getStatusDisplayLabel("completed")).toBe("Firing");
    });

    it("should return correct UI label for failed status", () => {
      expect(getStatusDisplayLabel("failed")).toBe("Errored");
    });

    it("should return correct UI label for condition not satisfied status", () => {
      expect(getStatusDisplayLabel("condition_not_satisfied")).toBe("Resolved");
    });

    it("should return correct UI label for skipped status", () => {
      expect(getStatusDisplayLabel("skipped")).toBe("Skipped");
    });

    it("should return original status for unknown values", () => {
      expect(getStatusDisplayLabel("unknown_status")).toBe("unknown_status");
    });

    it("should handle empty string", () => {
      expect(getStatusDisplayLabel("")).toBe("");
    });
  });

  describe("getStatusMappingSQL", () => {
    it("should generate correct SQL CASE statement with default column name", () => {
      const sql = getStatusMappingSQL();
      expect(sql).toContain("CASE");
      expect(sql).toContain("WHEN status = 'completed' THEN 'Firing'");
      expect(sql).toContain("WHEN status = 'failed' THEN 'Errored'");
      expect(sql).toContain("WHEN status = 'condition_not_satisfied' THEN 'Resolved'");
      expect(sql).toContain("WHEN status = 'skipped' THEN 'Skipped'");
      expect(sql).toContain("ELSE status");
      expect(sql).toContain("END");
    });

    it("should generate correct SQL CASE statement with custom column name", () => {
      const sql = getStatusMappingSQL("trigger_status");
      expect(sql).toContain("WHEN trigger_status = 'completed' THEN 'Firing'");
      expect(sql).toContain("WHEN trigger_status = 'failed' THEN 'Errored'");
      expect(sql).toContain("WHEN trigger_status = 'condition_not_satisfied' THEN 'Resolved'");
      expect(sql).toContain("WHEN trigger_status = 'skipped' THEN 'Skipped'");
      expect(sql).toContain("ELSE trigger_status");
    });

    it("should handle column name with special characters", () => {
      const sql = getStatusMappingSQL("alert.status");
      expect(sql).toContain("WHEN alert.status = 'completed'");
      expect(sql).toContain("ELSE alert.status");
    });
  });

  describe("getBackendStatusFromLabel", () => {
    it("should return correct backend status for Firing label", () => {
      expect(getBackendStatusFromLabel("Firing")).toBe("completed");
    });

    it("should return correct backend status for Errored label", () => {
      expect(getBackendStatusFromLabel("Errored")).toBe("failed");
    });

    it("should return correct backend status for Resolved label", () => {
      expect(getBackendStatusFromLabel("Resolved")).toBe("condition_not_satisfied");
    });

    it("should return correct backend status for Skipped label", () => {
      expect(getBackendStatusFromLabel("Skipped")).toBe("skipped");
    });

    it("should return undefined for unknown labels", () => {
      expect(getBackendStatusFromLabel("Unknown Label")).toBeUndefined();
    });

    it("should return undefined for empty string", () => {
      expect(getBackendStatusFromLabel("")).toBeUndefined();
    });

    it("should be case sensitive", () => {
      expect(getBackendStatusFromLabel("firing")).toBeUndefined();
      expect(getBackendStatusFromLabel("FIRING")).toBeUndefined();
    });
  });

  describe("bidirectional mapping consistency", () => {
    it("should maintain consistency between forward and reverse mappings", () => {
      Object.entries(TRIGGER_STATUS_DISPLAY_MAP).forEach(([backendStatus, displayLabel]) => {
        expect(getStatusDisplayLabel(backendStatus)).toBe(displayLabel);
        expect(getBackendStatusFromLabel(displayLabel)).toBe(backendStatus);
      });
    });
  });
});
