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

// Invariants for the incident Condition field suggestions — cheap guards that
// catch copy-paste mistakes (duplicate columns, wrong prefix) in the static list.

import { describe, it, expect } from "vitest";
import { INCIDENT_PAYLOAD_FIELDS } from "./incidentFields";

describe("INCIDENT_PAYLOAD_FIELDS", () => {
  it("exposes the flattened `meta_*` columns (event_type discriminator included)", () => {
    const values = INCIDENT_PAYLOAD_FIELDS.map((f) => f.value);
    expect(values).toContain("meta_event_type");
    expect(values.every((v) => v.startsWith("meta_"))).toBe(true);
  });

  it("has no duplicate columns", () => {
    const values = INCIDENT_PAYLOAD_FIELDS.map((f) => f.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("keeps label and value in sync and a non-empty type", () => {
    for (const f of INCIDENT_PAYLOAD_FIELDS) {
      expect(f.label).toBe(f.value);
      expect(f.type).toBeTruthy();
    }
  });
});
