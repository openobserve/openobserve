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
import { suppressedPage } from "./suppressed";

const body = {
  total: 166,
  from: 0,
  size: 500,
  hits: [
    { timestamp: 1, alert_name: "kafka-lag", status: "suppressed", org: "default" },
    { timestamp: 2, alert_name: "kafka-isr", status: "suppressed", org: "default" },
  ],
};

describe("suppressedPage", () => {
  it("reads hits and the server total from a parsed body", () => {
    const page = suppressedPage(body);
    expect(page.total).toBe(166);
    expect(page.hits.map((h) => h.alert_name)).toEqual(["kafka-lag", "kafka-isr"]);
  });

  it("parses a body that arrived as a JSON string", () => {
    const page = suppressedPage(JSON.stringify(body));
    expect(page.total).toBe(166);
    expect(page.hits).toHaveLength(2);
  });

  it("is an empty page for anything else", () => {
    expect(suppressedPage(undefined)).toEqual({ hits: [], total: 0 });
    expect(suppressedPage("<html>")).toEqual({ hits: [], total: 0 });
    expect(suppressedPage({ hits: "nope" })).toEqual({ hits: [], total: 0 });
  });
});
