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
import {
  availableSections,
  averageStreamSizeSql,
  DRILLDOWNS,
  dailyOrgCostSql,
  dailyEntitySql,
  dailyVolumeSql,
  eventVolumeSql,
  meterTotalSql,
  orgVolumeSql,
  searchScanSizeSql,
  trendsCostSql,
} from "./usageQueries";
import { cyclesNewestFirst, parseMeteringResponse, type MeteringDetails } from "./meteringModel";
import { cyclePrices } from "./trendsModel";

const meter = (base: number, divisor: number) => ({
  base_cost: base,
  unit_divisor: divisor,
  metered_amount: 0,
  metered_cost: 0,
  percent_discount: 0,
  discounted_amount: 0,
});

const details = {
  total_cost: 0,
  total_discounted_amount: 0,
  cycle_start: 1_789_046_852,
  cycle_end: 1_791_638_852,
  ingestion: meter(0.5, 1024),
  query: meter(0.01, 1024),
  retention: meter(0, 1024),
  pipeline: meter(0.2, 1024),
  remote_pipeline: meter(0.3, 1024),
  ai: meter(0.5, 1),
  synthetics_browser: meter(0, 1),
  synthetics_protocol: meter(0, 1),
  missing_details: [],
} as MeteringDetails;

describe("usageQueries", () => {
  it("escapes a single quote in the org id", () => {
    const sql = DRILLDOWNS.ingestion![0].sql("ac'me");
    expect(sql).toContain("org_id = 'ac''me'");
  });

  it("returns name and volume from every drilldown, so one table renders them all", () => {
    for (const sections of Object.values(DRILLDOWNS)) {
      for (const section of sections) {
        const sql = section.sql("default");
        expect(sql).toContain("as name");
        expect(sql).toContain("as volume");
        expect(sql).toContain("limit 10");
      }
    }
  });

  it("excludes alert, dashboard and pipeline searches from the by user breakdown", () => {
    const byUser = DRILLDOWNS.query!.find((section) => section.id === "user")!;
    const sql = byUser.sql("default");
    expect(sql).toContain("alert_name is null");
    expect(sql).toContain("dashboard_name is null");
    expect(sql).toContain("derived_stream_key is null");
  });

  it("drops a section whose field is missing from the live schema", () => {
    const sections = DRILLDOWNS.query!;
    const present = new Set(["user_email", "stream_name"]);
    const kept = availableSections(sections, present);
    expect(kept.map((section) => section.id)).toEqual(["stream"]);
    expect(availableSections(sections, new Set()).length).toBe(sections.length);
  });

  it("keeps every section when all fields exist", () => {
    const fields = new Set([
      "user_email",
      "alert_name",
      "dashboard_name",
      "derived_stream_key",
      "stream_name",
    ]);
    expect(availableSections(DRILLDOWNS.query!, fields).length).toBe(DRILLDOWNS.query!.length);
  });

  it("prices the trends query from the API rates, never a hardcoded number", () => {
    const sql = trendsCostSql("default", cyclePrices([details]), "1 day");
    expect(sql).toContain(`when event = 'Ingestion' then ${0.5 / 1024}`);
    expect(sql).toContain("when event = 'Search' then");
    expect(sql).toContain("histogram(_timestamp, '1 day')");
    expect(sql).not.toContain("Functions");
  });

  it("narrows the trends query to one meter's events", () => {
    const sql = trendsCostSql("default", cyclePrices([details]), "1 hour", ["Pipeline"]);
    expect(sql).toContain("event IN ('Pipeline')");
    expect(sql).not.toContain("'Ingestion'");
  });

  it("reads the estimator defaults from ingestion and search rows", () => {
    expect(averageStreamSizeSql("default")).toContain("count(distinct stream_name)");
    // Partitions of one streamed search share its trace id before "-{n}", so they count once.
    expect(searchScanSizeSql("default")).toContain(
      "count(distinct split_part(trace_id, '-', 1)) as searches",
    );
    expect(searchScanSizeSql("default")).not.toContain("response_time");
  });

  it("reads a super org's estimator history across the group, counting each org's streams apart", () => {
    const streams = averageStreamSizeSql(null);
    expect(streams).not.toContain("org_id =");
    expect(streams).toContain("count(distinct concat(org_id, '/', stream_name))");
    expect(searchScanSizeSql(null)).toMatch(/where event = 'Search'$/);
  });

  it("leaves out the zero-length invoice Stripe creates at subscription, so it is never Last Cycle", () => {
    const signup = { ...details, cycle_start: 1_789_000_000, cycle_end: 1_789_000_000 };
    const closed = { ...details, cycle_start: 1_786_000_000, cycle_end: 1_788_600_000 };
    const cycles = cyclesNewestFirst({ upcoming: details, past: [signup, closed] });
    expect(cycles).toEqual([details, closed]);
    // A brand-new subscriber has only the signup invoice behind it: no Last Cycle at all.
    expect(cyclesNewestFirst({ upcoming: details, past: [signup] })).toEqual([details]);
  });

  it("reads the cycles out of the new body and still accepts the old flat one", () => {
    const parsed = parseMeteringResponse({ upcoming: details, past: [details], oldest_ts: 1 });
    expect(parsed?.past).toHaveLength(1);
    expect(cyclesNewestFirst(parsed)).toHaveLength(2);
    const flat = parseMeteringResponse(details);
    expect(flat?.upcoming.cycle_start).toBe(details.cycle_start);
    expect(flat?.past).toEqual([]);
    expect(parseMeteringResponse(null)).toBeNull();
  });

  it("counts AI credits by feature, taking size as the credit count", () => {
    const [chat, incident] = DRILLDOWNS.ai ?? [];
    expect(chat.sql("default")).toContain("json_get_str(request_body, 'feature') = 'ai_chat'");
    expect(chat.sql("default")).toContain("group by user_email");
    expect(incident.sql("default")).toContain(
      "json_get_str(request_body, 'feature') = 'new_incident'",
    );
    expect(incident.sql("default")).toContain("json_get_str(request_body, 'incident_id')");
    // `size` is already the credit count, so no rate or multiplier belongs in the SQL.
    expect(incident.sql("default")).toContain("sum(size) as volume");
    expect(incident.unit).toBe("count");
  });

  it("groups synthetics steps by check, where stream_name holds the check id", () => {
    for (const [key, event] of [
      ["synthetics_browser", "SyntheticsBrowserSteps"],
      ["synthetics_protocol", "SyntheticsProtocolSteps"],
    ] as const) {
      const [byCheck] = DRILLDOWNS[key] ?? [];
      expect(byCheck.sql("default")).toContain(`event = '${event}'`);
      expect(byCheck.sql("default")).toContain("group by stream_name");
      expect(byCheck.unit).toBe("count");
    }
  });

  it("measures a section's share against the same event it counts", () => {
    for (const sections of Object.values(DRILLDOWNS)) {
      for (const section of sections) {
        expect(section.sql("default")).toContain(`event = '${section.event}'`);
      }
    }
    expect(meterTotalSql("default", ["Search"])).toContain("event in ('Search')");
  });

  it("leaves metrics searches with no stream name out of Search by Stream", () => {
    const byStream = DRILLDOWNS.query!.find((section) => section.id === "stream")!;
    expect(byStream.sql("default")).toContain("stream_name != ''");
  });

  it("splits the chart by every entity, leaving the top few to the chart", () => {
    const sql = dailyEntitySql("default", DRILLDOWNS.ingestion![0], 0.001);
    expect(sql).toContain('stream_name as "breakdown_1"');
    expect(sql).not.toContain("case when");
    expect(sql).toContain("sum(size) * 0.001");
    expect(sql).toContain("event = 'Ingestion'");
  });

  it("asks for every day x entity row, past the server's 1,000-row default for a query with no LIMIT", () => {
    // 1,300 streams over a month is far more than 1,000 rows; cut short, 'others' misses most of them.
    const sql = dailyEntitySql("default", DRILLDOWNS.ingestion![0], 0.001, 5);
    expect(sql).toMatch(/ LIMIT (\d+)$/);
    expect(Number(sql.match(/ LIMIT (\d+)$/)![1])).toBeGreaterThanOrEqual(31 * 1_300);
  });

  describe("super org", () => {
    it("reads every org's volume per event, with no per-row price expressions", () => {
      const sql = orgVolumeSql();
      expect(sql).toContain("sum(size) as volume");
      expect(sql).toContain("group by org_id, event");
      expect(sql).not.toContain("org_id =");
      expect(sql).not.toContain("case");
    });

    it("adds each bucket's raw volume to the trends query only when asked", () => {
      expect(trendsCostSql("o", [], "1 day")).not.toContain('sum(size) as "volume"');
      expect(trendsCostSql("o", [], "1 day", undefined, true)).toContain('sum(size) as "volume"');
    });

    it("labels the daily series by org name and folds unknown orgs into Other", () => {
      const sql = dailyOrgCostSql(
        cyclePrices([details]),
        [{ id: "m1", name: "Acme's EU" }],
        "Other",
      );
      expect(sql).toContain("case org_id when 'm1' then 'Acme''s EU' else 'Other' end");
      expect(sql).toContain("histogram(_timestamp, '1 day')");
    });
  });
});

describe("usage volume queries for an org with no bill", () => {
  it("reads raw volume per event, for this org only, with the org id escaped", () => {
    const totals = eventVolumeSql("o'rg", ["Ingestion", "Search"]);
    expect(totals).toContain("sum(size) as volume");
    expect(totals).toContain("org_id = 'o''rg'");
    expect(totals).toContain("event in ('Ingestion', 'Search') group by event");

    const daily = dailyVolumeSql("org", ["Ingestion"]);
    expect(daily).toContain(`histogram(_timestamp, '1 day') as "x_axis_1"`);
    expect(daily).toContain(`sum(size) as "y_axis_1"`);
    expect(daily).not.toContain("case");
  });
});

describe("usage chart queries counting from a moment", () => {
  it("adds the time condition only when asked, so other callers are unchanged", () => {
    const [byStream] = DRILLDOWNS.ingestion!;
    expect(dailyEntitySql("org", byStream, 1)).not.toContain("_timestamp >=");
    expect(dailyEntitySql("org", byStream, 1, 1_700_000_000_000_000)).toContain(
      "AND _timestamp >= 1700000000000000",
    );
    expect(trendsCostSql("org", [], "1 day")).not.toContain("_timestamp >=");
    expect(trendsCostSql("org", [], "1 day", undefined, false, 5)).toContain("_timestamp >= 5");
    expect(dailyOrgCostSql([], [], "Other", undefined, 5)).toContain("_timestamp >= 5");
  });
});
