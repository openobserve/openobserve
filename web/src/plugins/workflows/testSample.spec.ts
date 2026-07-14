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

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  buildTestSample,
  buildTestSampleText,
  buildFlatTestSample,
} from "@/plugins/workflows/testSample";
import { TRIGGER_META_VARS } from "@/plugins/workflows/alertFields";

const SAMPLE_TS = 1700000000000000;

type Envelope = {
  meta: Record<string, unknown>;
  data: Record<string, unknown>[];
};

describe("buildTestSample", () => {
  it("returns a single-firing envelope array", () => {
    const sample = buildTestSample();
    expect(Array.isArray(sample)).toBe(true);
    expect(sample).toHaveLength(1);
  });

  it("returns an envelope with exactly a `meta` block and a `data` array", () => {
    const [firing] = buildTestSample() as [Envelope];
    expect(Object.keys(firing).sort()).toEqual(["data", "meta"]);
    expect(Array.isArray(firing.data)).toBe(true);
  });

  it("prefills every meta field the Alert Trigger schema declares, in schema order", () => {
    const [firing] = buildTestSample() as [Envelope];
    const expectedKeys = TRIGGER_META_VARS.map((v) =>
      v.ref.replace(/^meta\./, ""),
    );
    expect(Object.keys(firing.meta)).toEqual(expectedKeys);
  });

  it("prefills the documented named defaults", () => {
    const [firing] = buildTestSample() as [Envelope];
    expect(firing.meta).toEqual({
      org_name: "default",
      stream_type: "logs",
      stream_name: "default",
      alert_name: "High Error Rate",
      alert_type: "scheduled",
      alert_period: 10,
      alert_operator: ">=",
      alert_threshold: 100,
      alert_count: 137,
      alert_start_time: SAMPLE_TS,
      alert_end_time: SAMPLE_TS + 600000000,
    });
  });

  it("uses microsecond-epoch timestamps 10 minutes apart", () => {
    const [firing] = buildTestSample() as [Envelope];
    expect(firing.meta.alert_start_time).toBe(SAMPLE_TS);
    expect(
      (firing.meta.alert_end_time as number) -
        (firing.meta.alert_start_time as number),
    ).toBe(600000000);
  });

  it("keeps numeric meta fields as numbers (not stringified) in the envelope sample", () => {
    const [firing] = buildTestSample() as [Envelope];
    expect(typeof firing.meta.alert_period).toBe("number");
    expect(typeof firing.meta.alert_threshold).toBe("number");
    expect(typeof firing.meta.alert_count).toBe("number");
  });

  it("uses a valid enum member for alert_type", () => {
    const [firing] = buildTestSample() as [Envelope];
    const enumValues = TRIGGER_META_VARS.find(
      (v) => v.ref === "meta.alert_type",
    )?.enumValues;
    expect(enumValues).toContain(firing.meta.alert_type);
  });

  it("seeds a single sample result row on data[]", () => {
    const [firing] = buildTestSample() as [Envelope];
    expect(firing.data).toHaveLength(1);
    expect(firing.data[0]).toEqual({
      _timestamp: SAMPLE_TS,
      host: "web-01",
      status_code: 500,
    });
  });

  it("returns a fresh object graph on each call (editor mutations must not leak)", () => {
    const a = buildTestSample() as [Envelope];
    const b = buildTestSample() as [Envelope];
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    expect(a[0].meta).not.toBe(b[0].meta);
    expect(a[0].data).not.toBe(b[0].data);

    a[0].meta.alert_name = "mutated";
    expect((buildTestSample() as [Envelope])[0].meta.alert_name).toBe(
      "High Error Rate",
    );
  });
});

describe("buildTestSampleText", () => {
  it("is the pretty-printed JSON of buildTestSample()", () => {
    expect(buildTestSampleText()).toBe(
      JSON.stringify(buildTestSample(), null, 2),
    );
  });

  it("round-trips back to the sample object", () => {
    expect(JSON.parse(buildTestSampleText())).toEqual(buildTestSample());
  });

  it("is indented with 2 spaces", () => {
    const text = buildTestSampleText();
    expect(text.split("\n").length).toBeGreaterThan(1);
    expect(text).toContain('\n  {\n    "meta": {');
  });

  it("is deterministic", () => {
    expect(buildTestSampleText()).toBe(buildTestSampleText());
  });
});

describe("buildFlatTestSample", () => {
  it("returns one flat row per data[] row", () => {
    const flat = buildFlatTestSample();
    expect(flat).toHaveLength(1);
  });

  it("merges every meta field onto the row as a `meta_<field>` column", () => {
    const [row] = buildFlatTestSample() as [Record<string, unknown>];
    TRIGGER_META_VARS.forEach((v) => {
      const key = v.ref.replace(/^meta\./, "meta_");
      expect(row).toHaveProperty(key);
    });
  });

  it("stringifies every meta value (the flattened meta block is string:string)", () => {
    const [row] = buildFlatTestSample() as [Record<string, unknown>];
    Object.keys(row)
      .filter((k) => k.startsWith("meta_"))
      .forEach((k) => {
        expect(typeof row[k]).toBe("string");
      });
    expect(row.meta_alert_period).toBe("10");
    expect(row.meta_alert_threshold).toBe("100");
    expect(row.meta_alert_count).toBe("137");
    expect(row.meta_alert_start_time).toBe(String(SAMPLE_TS));
  });

  it("preserves the original row columns with their original types", () => {
    const [row] = buildFlatTestSample() as [Record<string, unknown>];
    expect(row._timestamp).toBe(SAMPLE_TS);
    expect(row.host).toBe("web-01");
    expect(row.status_code).toBe(500);
    expect(typeof row.status_code).toBe("number");
  });

  it("produces exactly the meta columns plus the row columns", () => {
    const [row] = buildFlatTestSample() as [Record<string, unknown>];
    expect(Object.keys(row).sort()).toEqual(
      [
        ...TRIGGER_META_VARS.map((v) => v.ref.replace(/^meta\./, "meta_")),
        "_timestamp",
        "host",
        "status_code",
      ].sort(),
    );
  });

  it("uses the same column names the Condition suggestions expose", () => {
    const [row] = buildFlatTestSample() as [Record<string, unknown>];
    expect(row).toHaveProperty("meta_alert_name", "High Error Rate");
    expect(row).toHaveProperty("meta_stream_type", "logs");
    expect(row).toHaveProperty("meta_org_name", "default");
  });

  it("has no nested `meta` key left over", () => {
    const [row] = buildFlatTestSample() as [Record<string, unknown>];
    expect(row).not.toHaveProperty("meta");
    expect(row).not.toHaveProperty("data");
  });

  it("returns a fresh object on each call", () => {
    const a = buildFlatTestSample();
    const b = buildFlatTestSample();
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    expect(a).toEqual(b);
  });
});

// The real TRIGGER_META_VARS has a named default for every field, so the
// type-based fallback never fires with the production schema. Mock the schema to
// exercise it (and to prove the sample stays in sync if a field is ever added).
describe("type-based fallbacks for unmapped meta fields", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/plugins/workflows/alertFields");
  });

  const loadWith = async (vars: any[]) => {
    vi.resetModules();
    vi.doMock("@/plugins/workflows/alertFields", () => ({
      TRIGGER_META_VARS: vars,
      ALERT_PAYLOAD_FIELDS: [],
    }));
    return await import("@/plugins/workflows/testSample");
  };

  it("defaults an unmapped enum field to its first enum value", async () => {
    const { buildTestSample: build } = await loadWith([
      {
        ref: "meta.new_enum",
        type: "string",
        descKey: "x",
        enumValues: ["first", "second"],
      },
    ]);
    expect((build() as any)[0].meta).toEqual({ new_enum: "first" });
  });

  it("ignores an empty enumValues array and falls through to the type default", async () => {
    const { buildTestSample: build } = await loadWith([
      { ref: "meta.new_enum", type: "number", descKey: "x", enumValues: [] },
    ]);
    expect((build() as any)[0].meta).toEqual({ new_enum: 0 });
  });

  it("defaults an unmapped number field to 0", async () => {
    const { buildTestSample: build } = await loadWith([
      { ref: "meta.new_number", type: "number", descKey: "x" },
    ]);
    expect((build() as any)[0].meta).toEqual({ new_number: 0 });
  });

  it("defaults an unmapped datetime field to the sample microsecond timestamp", async () => {
    const { buildTestSample: build } = await loadWith([
      { ref: "meta.new_datetime", type: "datetime", descKey: "x" },
    ]);
    expect((build() as any)[0].meta).toEqual({ new_datetime: SAMPLE_TS });
  });

  it("defaults an unmapped string field to an empty string", async () => {
    const { buildTestSample: build } = await loadWith([
      { ref: "meta.new_string", type: "string", descKey: "x" },
    ]);
    expect((build() as any)[0].meta).toEqual({ new_string: "" });
  });

  it("defaults an unmapped field of an unknown type to an empty string", async () => {
    const { buildTestSample: build } = await loadWith([
      { ref: "meta.mystery", type: "who-knows", descKey: "x" },
    ]);
    expect((build() as any)[0].meta).toEqual({ mystery: "" });
  });

  it("still prefers the named default over the type default when the key is mapped", async () => {
    const { buildTestSample: build } = await loadWith([
      { ref: "meta.alert_count", type: "number", descKey: "x" },
    ]);
    expect((build() as any)[0].meta).toEqual({ alert_count: 137 });
  });

  it("produces an empty meta block when the schema is empty", async () => {
    const { buildTestSample: build, buildFlatTestSample: flat } = await loadWith(
      [],
    );
    expect((build() as any)[0].meta).toEqual({});
    expect(flat()).toEqual([
      { _timestamp: SAMPLE_TS, host: "web-01", status_code: 500 },
    ]);
  });

  it("stringifies the type-defaulted values in the flattened sample", async () => {
    const { buildFlatTestSample: flat } = await loadWith([
      { ref: "meta.new_number", type: "number", descKey: "x" },
      { ref: "meta.new_datetime", type: "datetime", descKey: "x" },
    ]);
    expect(flat()[0]).toEqual({
      meta_new_number: "0",
      meta_new_datetime: String(SAMPLE_TS),
      _timestamp: SAMPLE_TS,
      host: "web-01",
      status_code: 500,
    });
  });
});
