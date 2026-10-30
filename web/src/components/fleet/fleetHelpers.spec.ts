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

import { describe, it, expect } from "vitest";
import { load } from "js-yaml";
import { planPhases } from "@/services/fleet.mock";
import { splitSystemSections } from "./effectiveConfig";
import { fromForm, makeSettingsSchema, toForm } from "./FleetSettingsForm.schema";
import { yamlToGraph } from "./editor/editorGraph";

const t = ((key: string) => key) as any;

describe("splitSystemSections", () => {
  it("moves the OpAMP extension and service telemetry out of the user's configuration", () => {
    const { user, system } = splitSystemSections(`receivers:
  otlp: {}
extensions:
  health_check: {}
  opamp:
    server: {}
service:
  pipelines:
    logs:
      receivers: [otlp]
  telemetry:
    logs:
      level: info
`);
    expect(load(user)).toEqual({
      receivers: { otlp: {} },
      extensions: { health_check: {} },
      service: { pipelines: { logs: { receivers: ["otlp"] } } },
    });
    expect(load(system!)).toEqual({
      extensions: { opamp: { server: {} } },
      service: { telemetry: { logs: { level: "info" } } },
    });
  });

  it("leaves a configuration without system sections, or one that does not parse, as is", () => {
    expect(splitSystemSections("receivers: {}\n")).toEqual({
      user: "receivers: {}\n",
      system: null,
    });
    expect(splitSystemSections("a: [")).toEqual({ user: "a: [", system: null });
  });
});

describe("planPhases", () => {
  it("expands each batching kind to phase sizes", () => {
    expect(planPhases({ kind: "one" }, 40).phases).toEqual([40]);
    expect(planPhases({ kind: "canary", first: 3 }, 40).phases).toEqual([3, 37]);
    expect(
      planPhases({ kind: "progressive", initial: 3, multiplier: 3, max: 50 }, 100).phases,
    ).toEqual([3, 9, 27, 61]);
  });

  it("collapses a first batch at or above the fleet size", () => {
    expect(planPhases({ kind: "canary", first: 50 }, 40)).toEqual({
      phases: [40],
      collapsed: true,
    });
  });

  it("merges a tail below a quarter of the previous phase into it", () => {
    expect(
      planPhases({ kind: "progressive", initial: 3, multiplier: 3, max: 50 }, 40).phases,
    ).toEqual([3, 9, 28]);
  });
});

describe("fleet settings form", () => {
  it("shows seconds as minutes where the label says minutes, and round-trips", () => {
    const settings = {
      heartbeat_interval_secs: 30,
      offline_heartbeats: 3,
      retention_days: 0,
      offline_ratio_percent: 20,
      phase_timeout_secs: 1800,
      gate: { observe_secs: 600, window_secs: 300, pass_percent: 95 },
    };
    const form = toForm(settings);
    expect(form.phaseTimeoutSecs).toBe("1800");
    expect(form.retentionDays).toBe("0");
    expect(fromForm(form, null)).toEqual(settings);
  });

  it("sends null for a blank field so the fleet inherits it, and a whole gate when any part is set", () => {
    const defaults = {
      heartbeat_interval_secs: 30,
      offline_heartbeats: 3,
      retention_days: 30,
      offline_ratio_percent: 20,
      phase_timeout_secs: 1800,
      gate: { observe_secs: 600, window_secs: 300, pass_percent: 95 },
    };
    const body = fromForm({ ...toForm(null), passPercent: "90" }, defaults);
    expect(body.heartbeat_interval_secs).toBeNull();
    expect(body.gate).toEqual({ observe_secs: 600, window_secs: 300, pass_percent: 90 });
    expect(fromForm(toForm(null), defaults).gate).toBeNull();
  });

  it("requires every value on the organization form only", () => {
    const blank = toForm(null);
    expect(makeSettingsSchema(t, false).safeParse(blank).success).toBe(true);
    expect(makeSettingsSchema(t, true).safeParse(blank).success).toBe(false);
    expect(makeSettingsSchema(t, false).safeParse({ ...blank, offlineRatio: "150" }).success).toBe(
      false,
    );
  });
});

describe("visual editor and environment variables", () => {
  it("keeps the visual view for a configuration that uses ${env:} references", () => {
    const graph = yamlToGraph(`receivers:
  otlp: {}
exporters:
  otlphttp/openobserve:
    endpoint: \${env:O2_ENDPOINT}
    headers:
      Authorization: "Basic \${env:O2_TOKEN}"
service:
  pipelines:
    logs:
      receivers: [otlp]
      exporters: [otlphttp/openobserve]
`);
    expect(graph).not.toBeNull();
    expect(graph!.components["exporter:otlphttp/openobserve"].settings.endpoint).toBe(
      "${env:O2_ENDPOINT}",
    );
  });
});
