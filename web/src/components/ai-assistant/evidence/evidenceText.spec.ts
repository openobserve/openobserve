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

import { queryFragments } from "./evidenceText";

describe("queryFragments", () => {
  it("shows what tells each query from its siblings, verbatim", () => {
    expect(
      queryFragments([
        "SELECT status, count(*) FROM app_logs WHERE service='cart' AND status>=500 GROUP BY status",
        "SELECT msg, count(*) FROM app_logs WHERE service='cart' AND msg LIKE '%redis%'",
        "SELECT region, count(*) FROM app_logs WHERE service='cart' AND status>=500 GROUP BY region",
        "SELECT count(*) FROM app_logs WHERE service='redis'",
        "SELECT p99(latency) FROM app_logs WHERE service='cart'",
      ]),
    ).toEqual([
      "status>=500 GROUP BY status",
      "msg LIKE '%redis%'",
      "status>=500 GROUP BY region",
      "service='redis'",
      "p99(latency)",
    ]);
  });

  it("keeps a lone query's whole filter, and an AND inside quotes or brackets", () => {
    expect(queryFragments(["SELECT * FROM t WHERE a=1 AND b=2"])).toEqual(["a=1 AND b=2"]);
    expect(queryFragments(["SELECT * FROM t WHERE (a AND b) AND msg='x AND y'"])).toEqual([
      "(a AND b) AND msg='x AND y'",
    ]);
  });

  it("leaves text it cannot read as SQL alone", () => {
    expect(queryFragments(["rate(http_requests_total[5m])"])).toEqual([
      "rate(http_requests_total[5m])",
    ]);
  });
});
