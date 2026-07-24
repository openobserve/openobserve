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

import { describe, it, expect } from "vitest";
import {
  buildUsageCombinedSql,
  buildUsageCombinedLinePanelSchema,
  USAGE_STREAM_NAME,
} from "./usageDailyPanelSchema";

describe("usageDailyPanelSchema", () => {
  describe("buildUsageCombinedSql", () => {
    it("buckets both metrics in one query, broken down by event", () => {
      const sql = buildUsageCombinedSql({ orgId: "org-x", dataType: "mb" });
      expect(sql).toContain("histogram(_timestamp, '1 day')");
      expect(sql).toContain(`FROM "${USAGE_STREAM_NAME}"`);
      expect(sql).toContain("org_id = 'org-x'");
      expect(sql).toContain('event as "breakdown_1"');
      expect(sql).toContain("event IN ('Ingestion', 'Search', 'Pipeline', 'RemotePipeline')");
      expect(sql).toContain("GROUP BY x_axis_1, breakdown_1");
      expect(sql).toContain("ORDER BY x_axis_1 ASC");
    });

    it("divides size by 1024 for GB, raw MB otherwise", () => {
      const gb = buildUsageCombinedSql({ orgId: "o", dataType: "gb" });
      expect(gb).toContain("sum(size) / 1024");
      const mb = buildUsageCombinedSql({ orgId: "o", dataType: "mb" });
      expect(mb).toContain("sum(size)");
      expect(mb).not.toContain("/ 1024");
    });

    it("escapes single quotes in the org id", () => {
      const sql = buildUsageCombinedSql({ orgId: "o'x", dataType: "mb" });
      expect(sql).toContain("org_id = 'o''x'");
    });
  });

  describe("buildUsageCombinedLinePanelSchema", () => {
    it("produces a version-2 line panel with an event breakdown (one query)", () => {
      const schema = buildUsageCombinedLinePanelSchema({
        orgId: "org-x",
        dataType: "gb",
      });
      expect(schema.version).toBe(2);
      expect(schema.type).toBe("line");
      expect(schema.queryType).toBe("sql");
      expect(schema.queries).toHaveLength(1);
      expect(schema.queries[0].customQuery).toBe(true);
      expect(schema.queries[0].fields.stream).toBe(USAGE_STREAM_NAME);
      expect(schema.queries[0].fields.breakdown).toHaveLength(1);
    });

    it("labels the axis in the selected unit", () => {
      const gb = buildUsageCombinedLinePanelSchema({ orgId: "o", dataType: "gb" });
      expect(gb.config.unit_custom).toBe("GB");
      const mb = buildUsageCombinedLinePanelSchema({ orgId: "o", dataType: "mb" });
      expect(mb.config.unit_custom).toBe("MB");
    });

    it("silences the renderer's own error text (no custom message)", () => {
      // error handling ON + no custom_error_message => both of the renderer's
      // error blocks are suppressed, so usage.vue can overlay its own graphic.
      const schema = buildUsageCombinedLinePanelSchema({
        orgId: "o",
        dataType: "gb",
      });
      expect(schema.error_config.custom_error_handeling).toBe(true);
      expect(schema.error_config.custom_error_message).toBeUndefined();
    });
  });
});
