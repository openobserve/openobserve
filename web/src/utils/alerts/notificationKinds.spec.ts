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
  inferAppliesTo,
  resolveEffectiveTemplate,
  templateFitsTransport,
  type ResolvableTemplate,
} from "./notificationKinds";

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

describe("resolveEffectiveTemplate", () => {
  const templates: ResolvableTemplate[] = [
    { name: "hook_all", kind: "custom", type: "http", applies_to: [] },
    { name: "hook_alert", kind: "custom", type: "http", applies_to: ["alert"] },
    { name: "mail", kind: "custom", type: "email", applies_to: [] },
    { name: "card", kind: "content", applies_to: [] },
    { name: "prebuilt_slack", kind: "content", isPrebuilt: true, applies_to: [] },
    { name: "legacy", kind: "content", isDefault: true, applies_to: [] },
  ];
  const resolve = (
    kind: any,
    override: string | null,
    destination: { type?: string; template?: string | null },
    orgDefault: string | null = null,
  ) => resolveEffectiveTemplate({ kind, override, destination, templates, orgDefault });

  it("takes the override when it fits the destination", () => {
    expect(resolve("anomaly", "hook_all", { type: "http", template: "card" })).toEqual({
      name: "hook_all",
      source: "explicit",
    });
  });

  it("skips an override that does not fit and keeps the destination template", () => {
    expect(resolve("anomaly", "mail", { type: "http", template: "card" })).toEqual({
      name: "card",
      source: "destination",
    });
  });

  it("skips a destination template that does not apply to the kind", () => {
    expect(resolve("anomaly", null, { type: "http", template: "hook_alert" }, "card")).toEqual({
      name: "card",
      source: "org_default",
    });
  });

  it("skips a prebuilt destination template for other kinds but keeps it for alerts", () => {
    expect(resolve("synthetics", null, { type: "http", template: "prebuilt_slack" })).toEqual({
      name: null,
      source: "compiled",
    });
    expect(resolve("alert", null, { type: "http", template: "prebuilt_slack" })).toEqual({
      name: "prebuilt_slack",
      source: "destination",
    });
  });

  it("uses the legacy default template only for alerts with no org default", () => {
    expect(resolve("alert", null, { type: "http" })).toEqual({
      name: "legacy",
      source: "org_default",
    });
    expect(resolve("anomaly", null, { type: "http" })).toEqual({ name: null, source: "compiled" });
  });
});
