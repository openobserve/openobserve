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

// The trigger registry is the single source of truth every workflow trigger
// consumer reads (picker, node/drawer titles, condition fields, function sample,
// and the create/update `trigger_type`). These guard the pure logic + the
// backend contract (the PascalCase `trigger_type` enum values).

import { describe, it, expect } from "vitest";
import {
  WORKFLOW_TRIGGERS,
  DEFAULT_TRIGGER_KIND,
  triggerDef,
  triggerTypeForKind,
  enabledTriggers,
  buildTriggerSampleText,
} from "./triggers";
import { INCIDENT_EVENT_TYPES, INCIDENT_COMMON_KEYS } from "./incidentSample";
import { ALERT_PAYLOAD_FIELDS } from "./alertFields";
import { INCIDENT_PAYLOAD_FIELDS } from "./incidentFields";

describe("trigger registry", () => {
  describe("triggerTypeForKind — backend contract", () => {
    it("maps the known kinds to their PascalCase enum values", () => {
      expect(triggerTypeForKind("alert_fired")).toBe("AlertFired");
      expect(triggerTypeForKind("incident_event")).toBe("IncidentEvent");
    });

    it("defaults to AlertFired for an unset or unknown kind", () => {
      expect(triggerTypeForKind(undefined)).toBe("AlertFired");
      expect(triggerTypeForKind("")).toBe("AlertFired");
      expect(triggerTypeForKind("not_a_kind")).toBe("AlertFired");
    });

    it("agrees with each registry entry's own triggerType", () => {
      for (const tr of WORKFLOW_TRIGGERS) {
        expect(triggerTypeForKind(tr.kind)).toBe(tr.triggerType);
      }
    });
  });

  describe("triggerDef", () => {
    it("returns the matching definition", () => {
      expect(triggerDef("incident_event").kind).toBe("incident_event");
    });

    it("falls back to the default kind for undefined/unknown", () => {
      expect(triggerDef(undefined).kind).toBe(DEFAULT_TRIGGER_KIND);
      expect(triggerDef("nope").kind).toBe(DEFAULT_TRIGGER_KIND);
      expect(DEFAULT_TRIGGER_KIND).toBe("alert_fired");
    });
  });

  describe("enabledTriggers", () => {
    it("returns only enabled kinds", () => {
      const kinds = enabledTriggers().map((t) => t.kind);
      expect(kinds).toContain("alert_fired");
      expect(kinds).toContain("incident_event");
      expect(enabledTriggers().every((t) => t.enabled)).toBe(true);
    });
  });

  describe("registry integrity", () => {
    it("every entry carries the required copy + sample", () => {
      for (const tr of WORKFLOW_TRIGGERS) {
        expect(tr.labelKey).toBeTruthy();
        expect(tr.nodeTitleKey).toBeTruthy();
        expect(tr.descKey).toBeTruthy();
        expect(tr.introKey).toBeTruthy();
        expect(tr.icon).toBeTruthy();
        expect(Array.isArray(tr.buildSample())).toBe(true);
        expect(Array.isArray(tr.conditionFields)).toBe(true);
      }
    });

    it("buildTriggerSampleText returns valid, pretty-printed JSON", () => {
      for (const tr of WORKFLOW_TRIGGERS) {
        const text = buildTriggerSampleText(tr.kind);
        expect(() => JSON.parse(text)).not.toThrow();
        expect(text).toContain("\n"); // pretty-printed
      }
    });

    it("only Alert Fired associates with alerts", () => {
      expect(triggerDef("alert_fired").linksAlerts).toBe(true);
      expect(triggerDef("incident_event").linksAlerts).toBeFalsy();
    });
  });

  describe("alert_fired wiring", () => {
    const alert = triggerDef("alert_fired");
    it("uses the alert condition fields and has no split / variants", () => {
      expect(alert.conditionFields).toBe(ALERT_PAYLOAD_FIELDS);
      expect(alert.sampleVariants).toBeUndefined();
      expect(alert.commonMetaKeys).toBeUndefined();
    });
  });

  describe("incident_event wiring", () => {
    const incident = triggerDef("incident_event");
    it("uses the incident condition fields", () => {
      expect(incident.conditionFields).toBe(INCIDENT_PAYLOAD_FIELDS);
    });

    it("exposes one sample variant per lifecycle event_type", () => {
      expect(incident.sampleVariants?.map((v) => v.key)).toEqual(INCIDENT_EVENT_TYPES);
    });

    it("splits on the incident common keys", () => {
      expect(incident.commonMetaKeys).toBe(INCIDENT_COMMON_KEYS);
      expect(incident.sampleVariantLabelKey).toBeTruthy();
    });

    it("each variant builds a non-empty sample for its event_type", () => {
      for (const v of incident.sampleVariants ?? []) {
        const [{ meta }] = v.build() as [{ meta: Record<string, unknown> }];
        expect(meta.event_type).toBe(v.key);
      }
    });
  });
});
