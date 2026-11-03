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
import { inferAppliesTo, templateFitsTransport } from "./notificationKinds";

describe("inferAppliesTo", () => {
  it("returns all kinds ([]) for a body with no kind specific variable", () => {
    expect(inferAppliesTo("{alert_name} fired in {stream_name}")).toEqual([]);
  });

  it("picks anomaly for an anomaly variable", () => {
    expect(inferAppliesTo("{anomaly_count} anomalies")).toEqual(["anomaly"]);
    expect(inferAppliesTo("worst {worst_actual_value} vs {threshold}")).toEqual(["anomaly"]);
  });

  it("adds synthetics when a check variable appears, in chip order", () => {
    expect(inferAppliesTo("{check_name} {anomaly_count}")).toEqual(["anomaly", "synthetics"]);
  });

  it("maps incident, downtime and on-call variables", () => {
    expect(inferAppliesTo("{oncall_team} {runbook_url} {downtime_name} {incident_id}")).toEqual([
      "incident",
      "downtime",
      "on_call",
    ]);
  });

  it("reads variables inside a serialized content spec", () => {
    const spec = JSON.stringify({ title: "{incident_title}", body: "x" });
    expect(inferAppliesTo(spec)).toEqual(["incident"]);
  });
});

describe("templateFitsTransport", () => {
  it("matches a Custom template only to its own transport", () => {
    expect(templateFitsTransport("http", "http")).toBe(true);
    expect(templateFitsTransport("http", "email")).toBe(false);
    expect(templateFitsTransport("email", "email")).toBe(true);
    expect(templateFitsTransport("sns", "http")).toBe(false);
  });
});
