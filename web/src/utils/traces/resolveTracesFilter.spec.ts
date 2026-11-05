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

import { beforeAll, describe, expect, it } from "vitest";
import { resolveTracesFilter } from "./resolveTracesFilter";

describe("resolveTracesFilter", () => {
  let parser: unknown;

  beforeAll(async () => {
    const mod = await import("@openobserve/node-sql-parser/build/datafusionsql");
    parser = new mod.default.Parser();
  });

  it("returns an empty string for blank or missing text", () => {
    expect(resolveTracesFilter("", parser, "default")).toBe("");
    expect(resolveTracesFilter("   ", parser, "default")).toBe("");
    expect(resolveTracesFilter(undefined, parser, "default")).toBe("");
  });

  it("turns a duration with a unit into microseconds", () => {
    expect(resolveTracesFilter("duration > '500ms'", parser, "default")).toBe("duration > 500000");
    expect(resolveTracesFilter("duration > '1.50ms'", parser, "default")).toBe("duration > 1500");
  });

  it("turns span kind labels into their numeric keys", () => {
    expect(resolveTracesFilter("span_kind = 'Server'", parser, "default")).toBe("span_kind = '2'");
  });

  it("resolves duration and span kind in one filter", () => {
    expect(
      resolveTracesFilter("duration >= '2s' AND span_kind = 'Client'", parser, "default"),
    ).toBe("duration >= 2000000 AND span_kind = '3'");
  });

  it("keeps the trimmed text when the duration unit is unknown", () => {
    expect(resolveTracesFilter("  duration > '5parsecs'  ", parser, "default")).toBe(
      "duration > '5parsecs'",
    );
  });

  it("passes the text through untouched without a parser", () => {
    expect(resolveTracesFilter(" service_name = 'api' ", null, "default")).toBe(
      "service_name = 'api'",
    );
  });
});
