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
  countInheritingStreams,
  inheritedRetentionDays,
  isShorterRetention,
  loweredRetentionKeys,
  retentionKeyFor,
  type ResolvedDataRetention,
} from "./dataRetention";

const resolved: ResolvedDataRetention = {
  default: 10,
  logs: 20,
  metrics: 30,
  traces: 40,
  profiles: 50,
  metadata: 60,
};

describe("retentionKeyFor", () => {
  it("answers each configurable type from its own entry and the rest from the default", () => {
    for (const type of ["logs", "metrics", "traces", "profiles", "metadata"]) {
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
    zoConfig: { data_retention_days: 3650 },
  };

  it("looks the value up by stream type", () => {
    expect(inheritedRetentionDays(state, "metrics")).toBe(30);
    expect(inheritedRetentionDays(state, "metadata")).toBe(60);
    expect(inheritedRetentionDays(state, "service_graph")).toBe(10);
  });

  it("falls back to the global value until org settings have loaded", () => {
    expect(inheritedRetentionDays({ zoConfig: { data_retention_days: 3650 } }, "logs")).toBe(3650);
    expect(inheritedRetentionDays({}, "logs")).toBe(0);
  });
});

describe("isShorterRetention", () => {
  it("treats 0 as forever", () => {
    expect(isShorterRetention(0, 30)).toBe(true);
    expect(isShorterRetention(30, 0)).toBe(false);
    expect(isShorterRetention(0, 0)).toBe(false);
  });

  it("compares finite values", () => {
    expect(isShorterRetention(30, 7)).toBe(true);
    expect(isShorterRetention(7, 30)).toBe(false);
    expect(isShorterRetention(7, 7)).toBe(false);
  });
});

describe("loweredRetentionKeys", () => {
  it("lists only what got shorter", () => {
    expect(loweredRetentionKeys(resolved, { ...resolved, logs: 5, traces: 90 })).toEqual(["logs"]);
    expect(loweredRetentionKeys(resolved, resolved)).toEqual([]);
  });
});

describe("countInheritingStreams", () => {
  const streams = [
    { stream_type: "logs", settings: { data_retention: 0 } },
    { stream_type: "logs", settings: { data_retention: 7 } },
    { stream_type: "metrics", settings: {} },
    { stream_type: "metadata", settings: null },
    { stream_type: "enrichment_tables", settings: {} },
    { stream_type: "file_list", settings: {} },
    { stream_type: "index", settings: {} },
  ];

  it("skips streams with their own value and types retention never touches", () => {
    expect(countInheritingStreams(streams, ["logs"])).toBe(1);
    expect(countInheritingStreams(streams, ["logs", "metrics", "metadata"])).toBe(3);
    expect(countInheritingStreams(streams, ["default"])).toBe(0);
  });
});
