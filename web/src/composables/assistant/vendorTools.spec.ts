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

import { vendorToolLabel } from "./vendorTools";

describe("vendorToolLabel", () => {
  const toolsets = new Set(["datadog", "my-mcp", "o2", "update"]);

  it("splits at the first underscore when the prefix is a known toolset", () => {
    expect(vendorToolLabel("datadog_search_logs", toolsets)).toBe("datadog · search_logs");
    expect(vendorToolLabel("my-mcp_list", toolsets)).toBe("my-mcp · list");
  });

  it("never labels a first-party tool, a reserved prefix, an unknown prefix or a bare name", () => {
    expect(vendorToolLabel("update_memory", toolsets)).toBeNull();
    expect(vendorToolLabel("o2_search", toolsets)).toBeNull();
    expect(vendorToolLabel("grafana_query", toolsets)).toBeNull();
    expect(vendorToolLabel("datadog_", toolsets)).toBeNull();
    expect(vendorToolLabel("SearchSQL", toolsets)).toBeNull();
    expect(vendorToolLabel("datadog_search_logs", undefined)).toBeNull();
  });
});
