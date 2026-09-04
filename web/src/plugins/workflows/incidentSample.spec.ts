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

// The incident sample feeds the trigger drawer (split common/event-specific view)
// and the Function node's Events panel. The split view relies on
// INCIDENT_COMMON_KEYS matching the real common block exactly, so these guard
// that contract (drift there would mislabel fields in the UI).

import { describe, it, expect } from "vitest";
import {
  buildIncidentSample,
  INCIDENT_EVENTS,
  INCIDENT_EVENT_TYPES,
  INCIDENT_COMMON_KEYS,
  DEFAULT_INCIDENT_EVENT,
  buildIncidentDisplaySample,
} from "./incidentSample";

const metaOf = (eventType?: string) =>
  (buildIncidentSample(eventType) as [{ meta: Record<string, unknown> }])[0].meta;

describe("buildIncidentSample", () => {
  it("returns a one-element array with an empty data[] envelope", () => {
    const sample = buildIncidentSample() as [{ data: unknown[] }];
    expect(sample).toHaveLength(1);
    expect(sample[0].data).toEqual([]);
  });

  it("defaults to the first event_type when none is given", () => {
    expect(metaOf().event_type).toBe(DEFAULT_INCIDENT_EVENT);
    expect(DEFAULT_INCIDENT_EVENT).toBe("created");
  });

  it("falls back to the default for an unknown event_type (never empty)", () => {
    expect(metaOf("does_not_exist").event_type).toBe(DEFAULT_INCIDENT_EVENT);
  });

  it("carries the event-specific fields for the requested event", () => {
    const resolved = metaOf("resolved");
    expect(resolved.event_type).toBe("resolved");
    expect(resolved.status).toBe("resolved");
    expect(resolved.user_id).toBeTruthy();

    const sev = metaOf("severity_upgrade");
    expect(sev.old_severity).toBeTruthy();
    expect(sev.new_severity).toBeTruthy();
    expect(sev.reason).toBeTruthy();
  });

  it("INCIDENT_EVENT_TYPES mirrors the catalog order", () => {
    expect(INCIDENT_EVENT_TYPES).toEqual(INCIDENT_EVENTS.map((e) => e.type));
  });
});

describe("INCIDENT_COMMON_KEYS ↔ common block (drift guard)", () => {
  // The first event ("created") has NO extras, so its meta keys ARE exactly the
  // common block. This fails loudly if commonMeta() and INCIDENT_COMMON_KEYS
  // drift (order or membership) — which would mislabel the split view.
  it("equals the meta keys of an extra-less event, in order", () => {
    const noExtrasEvent = INCIDENT_EVENTS.find((e) => Object.keys(e.extras).length === 0)!;
    expect(Object.keys(metaOf(noExtrasEvent.type))).toEqual(INCIDENT_COMMON_KEYS);
  });

  it("every event includes the full common block", () => {
    for (const e of INCIDENT_EVENTS) {
      const keys = Object.keys(metaOf(e.type));
      for (const k of INCIDENT_COMMON_KEYS) expect(keys).toContain(k);
    }
  });

  it("an event's extras never collide with a common key", () => {
    const common = new Set(INCIDENT_COMMON_KEYS);
    for (const e of INCIDENT_EVENTS) {
      for (const k of Object.keys(e.extras)) {
        expect(common.has(k)).toBe(false);
      }
    }
  });
});

// F8b(c): incidents pass `&[]` as data (src/core/src/incidents.rs:211), so `data` is
// ALWAYS empty on the wire. Showing it invites `row.data[0]`, so the DISPLAY payload
// drops the key. The wire shape (buildIncidentSample) is unchanged.
describe("buildIncidentDisplaySample — display payload drops the always-empty data[]", () => {
  it("returns a single event object, not the batch array", () => {
    const shown = buildIncidentDisplaySample();
    expect(Array.isArray(shown)).toBe(false);
    expect(shown).toHaveProperty("meta");
  });

  it("has no `data` key at all", () => {
    const shown = buildIncidentDisplaySample() as Record<string, unknown>;
    expect(shown).not.toHaveProperty("data");
    expect(Object.keys(shown)).toEqual(["meta"]);
  });

  it("keeps the full meta block byte-for-byte from the wire sample", () => {
    const wire = (buildIncidentSample() as [{ meta: Record<string, unknown> }])[0].meta;
    expect((buildIncidentDisplaySample() as { meta: unknown }).meta).toEqual(wire);
  });

  it("honours the requested event_type", () => {
    const shown = buildIncidentDisplaySample("resolved") as { meta: Record<string, unknown> };
    expect(shown.meta.event_type).toBe("resolved");
    expect(shown.meta.status).toBe("resolved");
  });

  it("leaves the wire sample untouched — data[] still present there", () => {
    const wire = buildIncidentSample() as [{ data: unknown[] }];
    expect(wire[0]).toHaveProperty("data");
    expect(wire[0].data).toEqual([]);
  });
});
