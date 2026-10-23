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
import enUS from "@/locales/languages/en-US.json";
import {
  RUN_SOURCE_LABEL_KEYS,
  hasHttpEndpoint,
  isHttpRun,
  runSourceOf,
  workflowHooksEnabled,
} from "./httpEndpoint";

const lookup = (key: string): unknown =>
  key.split(".").reduce<any>((node, part) => (node == null ? undefined : node[part]), enUS);

describe("workflowHooksEnabled", () => {
  it("is on only when the config flag is exactly true", () => {
    expect(workflowHooksEnabled({ workflow_hooks_enabled: true })).toBe(true);
    expect(workflowHooksEnabled({ workflow_hooks_enabled: false })).toBe(false);
    expect(workflowHooksEnabled({ workflow_hooks_enabled: "true" })).toBe(false);
    expect(workflowHooksEnabled({})).toBe(false);
    expect(workflowHooksEnabled(undefined)).toBe(false);
    expect(workflowHooksEnabled(null)).toBe(false);
  });
});

describe("hasHttpEndpoint", () => {
  it("is true only when the list row says http_endpoint_enabled", () => {
    expect(hasHttpEndpoint({ http_endpoint_enabled: true })).toBe(true);
    expect(hasHttpEndpoint({ http_endpoint_enabled: false })).toBe(false);
    expect(hasHttpEndpoint({})).toBe(false);
    expect(hasHttpEndpoint(null)).toBe(false);
  });
});

describe("runSourceOf", () => {
  it("a Webhook run is an HTTP request; every other type keeps its own source", () => {
    expect(runSourceOf({ event_type: "Webhook" })).toBe("http");
    expect(runSourceOf({ event_type: "AlertFired" })).toBe("alert_fired");
    expect(runSourceOf({ event_type: "AlertResolved" })).toBe("alert_fired");
    expect(runSourceOf({ event_type: "IncidentEvent" })).toBe("incident_event");
    expect(runSourceOf({ event_type: "Test" })).toBe("test");
    expect(runSourceOf({ event_type: "Retry" })).toBe("retry");
    expect(runSourceOf({ event_type: "Manual" })).toBe("manual");
    expect(runSourceOf({ event_type: "SomethingNewer" })).toBe("other");
  });

  it("isHttpRun follows the run type, not the request facts", () => {
    expect(isHttpRun({ event_type: "Webhook" })).toBe(true);
    expect(isHttpRun({ event_type: "Retry" })).toBe(false);
  });

  it("every source label key exists in en-US", () => {
    for (const key of Object.values(RUN_SOURCE_LABEL_KEYS)) {
      expect(typeof lookup(key)).toBe("string");
    }
    expect(lookup(RUN_SOURCE_LABEL_KEYS.http)).toBe("HTTP request");
  });
});
