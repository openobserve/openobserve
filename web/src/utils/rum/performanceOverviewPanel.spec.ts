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

import { describe, expect, it } from "vitest";
import { toZonedTime } from "date-fns-tz";
import { raw } from "@/types/i18n";
import { buildOverviewChartPanel } from "./performanceOverviewPanel";

const labels = {
  title: raw("Chart"),
  time: raw("Time"),
  sessions: raw("Sessions"),
  errors: raw("Errors"),
};
const MS = Date.UTC(2026, 0, 15, 12, 0);

describe("buildOverviewChartPanel", () => {
  it("builds a custom-SQL line panel over _rumdata with sessions and errors on y", () => {
    const panel = buildOverviewChartPanel("SELECT 1", labels, null, "UTC") as Record<string, any>;
    const q = panel.queries[0];
    expect(panel.type).toBe("line");
    expect(panel.queryType).toBe("sql");
    expect(q.customQuery).toBe(true);
    expect(q.query).toBe("SELECT 1");
    expect(q.fields.stream).toBe("_rumdata");
    expect(q.fields.x.map((f: any) => f.alias)).toEqual(["x_axis_1"]);
    expect(q.fields.y.map((f: any) => f.alias)).toEqual(["y_axis_1", "y_axis_2"]);
    expect(panel.config.show_legends).toBe(true);
  });

  it("has no mark line without a marker", () => {
    const panel = buildOverviewChartPanel("SELECT 1", labels, null, "UTC") as Record<string, any>;
    expect(panel.config.mark_line).toEqual([]);
  });

  it("converts the marker time into the chart's zone, so different zones place it differently", () => {
    const at = (tz: string) =>
      (
        (
          buildOverviewChartPanel("s", labels, { version: "2.0", ms: MS }, tz) as Record<
            string,
            any
          >
        ).config.mark_line[0].value as Date
      ).getTime();
    expect(at("Asia/Tokyo")).toBe(toZonedTime(new Date(MS), "Asia/Tokyo").getTime());
    expect(at("America/New_York")).toBe(toZonedTime(new Date(MS), "America/New_York").getTime());
    expect(at("Asia/Tokyo")).not.toBe(at("America/New_York"));
  });

  it("keeps the label off, naming the line by version", () => {
    const panel = buildOverviewChartPanel("s", labels, { version: "2.0", ms: MS }, "UTC") as Record<
      string,
      any
    >;
    expect(panel.config.mark_line[0]).toMatchObject({
      name: "2.0",
      type: "xAxis",
      show_label: false,
    });
  });
});
