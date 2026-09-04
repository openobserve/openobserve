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
import { isCustomDestination } from "./destinationType";

describe("isCustomDestination", () => {
  it("accepts an explicit custom type", () => {
    expect(isCustomDestination({ destination_type_name: "custom" })).toBe(true);
    expect(isCustomDestination({ destination_type: "custom" })).toBe(true);
  });

  it("matches the type case-insensitively and ignores padding", () => {
    expect(isCustomDestination({ destination_type_name: " CUSTOM " })).toBe(true);
  });

  it("rejects a prebuilt provider type", () => {
    for (const t of [
      "openobserve",
      "splunk",
      "elasticsearch",
      "datadog",
      "dynatrace",
      "newrelic",
    ]) {
      expect(isCustomDestination({ destination_type_name: t })).toBe(false);
    }
  });

  // `destination_type_name` is Option<String> with skip_serializing_if on the backend,
  // so every destination created through the plain API arrives with the field ABSENT.
  // Absent is "untyped", which a workflow executes exactly like a custom webhook — it
  // is not evidence of a prebuilt provider.
  it("treats a missing type as custom", () => {
    expect(isCustomDestination({})).toBe(true);
    expect(isCustomDestination({ name: "audit", url: "http://x/audit" } as any)).toBe(true);
  });

  it("treats an empty or whitespace type as custom", () => {
    expect(isCustomDestination({ destination_type_name: "" })).toBe(true);
    expect(isCustomDestination({ destination_type_name: "   " })).toBe(true);
  });

  it("treats an unrecognised type as custom rather than excluding it", () => {
    expect(isCustomDestination({ destination_type_name: "some_future_type" })).toBe(true);
  });

  it("survives a null/undefined record", () => {
    expect(isCustomDestination(undefined as any)).toBe(true);
    expect(isCustomDestination(null as any)).toBe(true);
  });
});
