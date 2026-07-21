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
import {
  ALERT_PAYLOAD_FIELDS,
  TRIGGER_META_VARS,
} from "@/plugins/workflows/alertFields";
import en from "@/locales/languages/en-US.json";

/** Resolve a dotted i18n key against the en.json translation tree. */
const resolveKey = (key: string): unknown =>
  key.split(".").reduce<any>((acc, part) => acc?.[part], en as any);

describe("alertFields", () => {
  describe("TRIGGER_META_VARS", () => {
    it("exposes the 11 fixed meta fields the Alert Trigger emits", () => {
      expect(TRIGGER_META_VARS).toHaveLength(11);
    });

    it("lists exactly the expected refs, in schema order", () => {
      expect(TRIGGER_META_VARS.map((v) => v.ref)).toEqual([
        "meta.org_id",
        "meta.stream_type",
        "meta.stream_name",
        "meta.alert_name",
        "meta.alert_type",
        "meta.alert_period",
        "meta.alert_operator",
        "meta.alert_threshold",
        "meta.alert_count",
        "meta.alert_start_time",
        "meta.alert_end_time",
      ]);
    });

    it("namespaces every ref under `meta.`", () => {
      TRIGGER_META_VARS.forEach((v) => {
        expect(v.ref.startsWith("meta.")).toBe(true);
        expect(v.ref.split(".")).toHaveLength(2);
      });
    });

    it("has no duplicate refs", () => {
      const refs = TRIGGER_META_VARS.map((v) => v.ref);
      expect(new Set(refs).size).toBe(refs.length);
    });

    it("gives every var a non-empty ref, type and descKey", () => {
      TRIGGER_META_VARS.forEach((v) => {
        expect(typeof v.ref).toBe("string");
        expect(v.ref.length).toBeGreaterThan(0);
        expect(typeof v.type).toBe("string");
        expect(v.type.length).toBeGreaterThan(0);
        expect(typeof v.descKey).toBe("string");
        expect(v.descKey.length).toBeGreaterThan(0);
      });
    });

    it("types every meta field as string (the real payload's meta is a string:string map)", () => {
      const types = new Set(TRIGGER_META_VARS.map((v) => v.type));
      expect([...types]).toEqual(["string"]);
    });

    it("declares enumValues only on meta.alert_type", () => {
      const withEnums = TRIGGER_META_VARS.filter((v) => v.enumValues);
      expect(withEnums).toHaveLength(1);
      expect(withEnums[0].ref).toBe("meta.alert_type");
      expect(withEnums[0].enumValues).toEqual(["realtime", "scheduled"]);
    });

    it("scopes every descKey under workflow.triggerMeta", () => {
      TRIGGER_META_VARS.forEach((v) => {
        expect(v.descKey.startsWith("workflow.triggerMeta.")).toBe(true);
      });
    });

    it("resolves every descKey to a real string in en.json", () => {
      TRIGGER_META_VARS.forEach((v) => {
        const translated = resolveKey(v.descKey);
        expect(typeof translated, `missing i18n key: ${v.descKey}`).toBe("string");
        expect((translated as string).length).toBeGreaterThan(0);
      });
    });

    it("has no duplicate descKeys", () => {
      const keys = TRIGGER_META_VARS.map((v) => v.descKey);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  describe("ALERT_PAYLOAD_FIELDS", () => {
    it("exposes the 13 flattened columns a Condition can branch on", () => {
      expect(ALERT_PAYLOAD_FIELDS).toHaveLength(13);
    });

    it("lists exactly the expected column values", () => {
      expect(ALERT_PAYLOAD_FIELDS.map((f) => f.value)).toEqual([
        "meta_alert_name",
        "meta_alert_type",
        "meta_alert_operator",
        "meta_alert_threshold",
        "meta_alert_count",
        "meta_alert_period",
        "meta_stream_name",
        "meta_stream_type",
        "meta_org_id",
        "meta_alert_start_time",
        "meta_alert_end_time",
        "meta_alert_trigger_time",
        "meta_alert_url",
      ]);
    });

    it("uses the column name as its own label (label === value)", () => {
      ALERT_PAYLOAD_FIELDS.forEach((f) => {
        expect(f.label).toBe(f.value);
      });
    });

    it("prefixes every column with `meta_` (the flattened meta envelope)", () => {
      ALERT_PAYLOAD_FIELDS.forEach((f) => {
        expect(f.value.startsWith("meta_")).toBe(true);
        expect(f.value).not.toContain(".");
      });
    });

    it("types every column as Utf8 (meta is a string:string map for now)", () => {
      ALERT_PAYLOAD_FIELDS.forEach((f) => {
        expect(f.type).toBe("Utf8");
      });
    });

    it("has no duplicate values", () => {
      const values = ALERT_PAYLOAD_FIELDS.map((f) => f.value);
      expect(new Set(values).size).toBe(values.length);
    });

    it("covers every TRIGGER_META_VARS field as a flattened `meta_<field>` column", () => {
      const columns = new Set(ALERT_PAYLOAD_FIELDS.map((f) => f.value));
      TRIGGER_META_VARS.forEach((v) => {
        const flat = v.ref.replace(/^meta\./, "meta_");
        expect(columns.has(flat), `missing column: ${flat}`).toBe(true);
      });
    });

    it("carries two runtime-only columns beyond the trigger meta schema", () => {
      const fromSchema = new Set(
        TRIGGER_META_VARS.map((v) => v.ref.replace(/^meta\./, "meta_")),
      );
      const extra = ALERT_PAYLOAD_FIELDS.map((f) => f.value).filter(
        (v) => !fromSchema.has(v),
      );
      expect(extra.sort()).toEqual(["meta_alert_trigger_time", "meta_alert_url"]);
    });

    it("shapes each option as { label, value, type } for the FilterGroup suggestions", () => {
      ALERT_PAYLOAD_FIELDS.forEach((f) => {
        expect(Object.keys(f).sort()).toEqual(["label", "type", "value"]);
      });
    });
  });
});
