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
import { gt } from "@/types/i18n";
import {
  dimensionDisplay,
  findingFacts,
  chipDimensionKeys,
  findingLabels,
  isFindingIncident,
  orderedDimensionKeys,
} from "./findingDimensions";

const F = { autoobserve_finding: "stream_silence", stream_type: "logs", stream_name: "checkout" };
const T = (at: number) => ({
  alert_kind: "autoobserve",
  alert_name: "checkout (logs) stopped sending data",
  alert_fired_at: at,
  labels: undefined,
});
const RAW = /autoobserve_finding|stream_name|stream_type|stream_silence/;

describe("findingDimensions", () => {
  it("finding dimensions read as words, never keys", () => {
    const shown = Object.entries(F).map(([key, value]) => dimensionDisplay(gt, F, key, value));
    expect(shown.map((d) => d.label)).toEqual(["Finding", "Stream Type", "Stream Name"]);
    expect(shown.map((d) => d.value)).toEqual(["Stopped sending data", "logs", "checkout"]);
    const kind = (k: string) =>
      dimensionDisplay(gt, { ...F, autoobserve_finding: k }, "autoobserve_finding", k).value;
    expect(kind("stream_drop")).toBe("Volume dropped sharply");
    expect(kind("stream_rise")).toBe("Volume rose sharply");
    expect(kind("stream_gap")).toBe("Stream finding");
    const all = [
      ...shown.flatMap((d) => [d.label, d.value]),
      kind("stream_drop"),
      kind("stream_rise"),
      kind("stream_gap"),
    ];
    for (const text of all) expect(text).not.toMatch(RAW);
  });

  it("a non-finding incident keeps its own keys", () => {
    const gv = { service: "api", stream_name: "s1" };
    expect(isFindingIncident(gv)).toBe(false);
    expect(dimensionDisplay(gt, gv, "service", "api")).toEqual({ label: null, value: "api" });
    expect(dimensionDisplay(gt, gv, "stream_name", "s1")).toEqual({ label: null, value: "s1" });
  });

  it("finding facts come from the incident and its earliest trigger", () => {
    expect(findingFacts(gt, F, [T(1762300600000000), T(1762300000000000)])).toEqual({
      what: "Stopped sending data",
      streamType: "logs",
      streamName: "checkout",
      startedAt: 1762300000000000,
    });

    const { stream_name: _dropped, ...noName } = F;
    expect(findingFacts(gt, noName, [T(1)])).toBeNull();
    expect(isFindingIncident(noName, [T(1)])).toBe(true);

    expect(findingFacts(gt, {}, [T(1)])).toBeNull();
    expect(isFindingIncident({}, [T(1)])).toBe(true);

    const internal = [{ alert_kind: "internal", alert_fired_at: 5 }];
    expect(isFindingIncident(F, internal)).toBe(true);
    expect(findingFacts(gt, F, internal)).toMatchObject({
      what: "Stopped sending data",
      streamName: "checkout",
      startedAt: null,
    });
  });

  it("a finding trigger's labels are the finding in words, in order", () => {
    const labels = findingLabels(gt, F);
    expect(Object.keys(labels!)).toEqual(["Finding", "Stream Name", "Stream Type"]);
    expect(Object.values(labels!)).toEqual(["Stopped sending data", "checkout", "logs"]);
    expect(findingLabels(gt, { service: "api" })).toBeNull();
  });

  it("a finding's dimensions read in display order, whatever order they arrive in", () => {
    const served = {
      env: "prod",
      stream_name: "checkout",
      stream_type: "logs",
      autoobserve_finding: "stream_silence",
    };
    expect(orderedDimensionKeys(served)).toEqual([
      "autoobserve_finding",
      "stream_name",
      "stream_type",
      "env",
    ]);
    expect(orderedDimensionKeys({ stream_name: "checkout", service: "api" })).toEqual([
      "stream_name",
      "service",
    ]);
    expect(orderedDimensionKeys(null)).toEqual([]);
  });

  it("a finding's chips read what, name, type everywhere", () => {
    const served = { env: "prod", stream_type: "logs", stream_name: "checkout", ...F };
    expect(chipDimensionKeys(served)).toEqual([
      "autoobserve_finding",
      "stream_name",
      "stream_type",
      "env",
    ]);
  });

  it("another incident keeps the alphabetical chips", () => {
    expect(chipDimensionKeys({ service: "api", env: "prod", cluster: "eu" })).toEqual([
      "cluster",
      "env",
      "service",
    ]);
    expect(chipDimensionKeys(null)).toEqual([]);
  });
});
