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
  inheritedRetentionDays,
  retentionKeyFor,
  type ResolvedDataRetention,
} from "./dataRetention";

const resolved: ResolvedDataRetention = {
  default: 10,
  logs: 20,
  metrics: 30,
  traces: 40,
  profiles: 50,
};

describe("retentionKeyFor", () => {
  it("answers each configurable type from its own entry and the rest from the default", () => {
    for (const type of ["logs", "metrics", "traces", "profiles"]) {
      expect(retentionKeyFor(type)).toBe(type);
    }
    for (const type of ["index", "service_graph", "enrichment_tables", "file_list", ""]) {
      expect(retentionKeyFor(type)).toBe("default");
    }
  });
});

describe("inheritedRetentionDays", () => {
  const state = {
    organizationData: { organizationSettings: { resolved_data_retention: resolved } },
    zoConfig: { resolved_data_retention: { ...resolved, logs: 3650 } },
  };

  it("looks the value up by stream type", () => {
    expect(inheritedRetentionDays(state, "metrics")).toBe(30);
    expect(inheritedRetentionDays(state, "metadata")).toBe(10);
    expect(inheritedRetentionDays(state, "service_graph")).toBe(10);
  });

  it("falls back to the org config when org settings can't be read", () => {
    expect(inheritedRetentionDays({ zoConfig: state.zoConfig }, "logs")).toBe(3650);
    expect(inheritedRetentionDays({ zoConfig: state.zoConfig }, "metrics")).toBe(30);
    expect(inheritedRetentionDays({}, "logs")).toBe(0);
  });
});
