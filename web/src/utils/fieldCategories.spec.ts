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
import type { FieldAlias } from "@/services/service_streams";
import {
  buildSemanticIndex,
  discoverPrefixes,
  resolveFieldGroup,
  applyFieldGrouping,
  applyStreamGrouping,
  CATEGORY,
} from "@/utils/fieldCategories";

// ---- resolveFieldGroup tests ------------------------------------------------

describe("resolveFieldGroup", () => {
  const aliases: FieldAlias[] = [
    { id: "http_alias", display: "HTTP", fields: ["http_method", "http_status"], group: "http" },
    { id: "k8s_alias", display: "Kubernetes", fields: ["k8s_pod", "k8s_namespace"], group: "k8s" },
  ];
  const index = buildSemanticIndex(aliases);
  const allFields = [
    "http_method",
    "http_status",
    "k8s_pod",
    "k8s_namespace",
    "body_raw",
    "body_size",
    "plain",
  ];
  const prefixes = discoverPrefixes(allFields);

  it("tier 1: returns semantic group for known alias field", () => {
    expect(resolveFieldGroup("http_method", "Utf8", index, prefixes)).toBe("http");
  });

  it("tier 2a: dot-namespace prefix", () => {
    expect(resolveFieldGroup("aws.region", "Utf8", index, prefixes)).toBe("aws");
  });

  it("tier 2b: dynamic underscore prefix with ≥2 fields", () => {
    // body_raw and body_size → "body" qualifies
    expect(resolveFieldGroup("body_raw", "Utf8", index, prefixes)).toBe("body");
  });

  it("tier 3: falls back to data-type bucket when no prefix qualifies", () => {
    expect(resolveFieldGroup("plain", "Utf8", index, prefixes)).toBe(CATEGORY.TYPE_STRING);
  });

  it("tier 3: numeric data type bucket", () => {
    expect(resolveFieldGroup("unknown_field", "Int64", index, null)).toBe(CATEGORY.TYPE_NUMBER);
  });

  it("tier 3: boolean data type bucket", () => {
    expect(resolveFieldGroup("flag_field", "Boolean", index, null)).toBe(CATEGORY.TYPE_BOOLEAN);
  });

  it("handles null index gracefully", () => {
    expect(resolveFieldGroup("http_method", "Utf8", null, null)).toBe(CATEGORY.TYPE_STRING);
  });

  it("single underscore-field prefix does NOT qualify (below MIN_PREFIX_FIELDS=2)", () => {
    // only one "solo_*" field, so it falls to data-type bucket
    const solo = discoverPrefixes(["solo_only", "other"]);
    expect(solo.has("solo")).toBe(false);
    expect(resolveFieldGroup("solo_only", "Utf8", null, solo)).toBe(CATEGORY.TYPE_STRING);
  });
});

// ---- discoverPrefixes tests --------------------------------------------------

describe("discoverPrefixes", () => {
  it("discovers prefix with ≥2 fields", () => {
    const result = discoverPrefixes(["http_method", "http_status", "body_raw"]);
    expect(result.has("http")).toBe(true);
  });

  it("skips prefix with only 1 field", () => {
    const result = discoverPrefixes(["http_method", "http_status", "lone_field"]);
    expect(result.has("lone")).toBe(false);
  });

  it("excludes dot-namespaced fields", () => {
    const result = discoverPrefixes(["aws.region", "aws.zone"]);
    expect(result.has("aws")).toBe(false);
  });

  it("returns empty set for empty input", () => {
    expect(discoverPrefixes([]).size).toBe(0);
  });
});

// ---- applyFieldGrouping tests -----------------------------------------------

describe("applyFieldGrouping", () => {
  const aliases: FieldAlias[] = [
    { id: "http_alias", display: "HTTP", fields: ["http_method", "http_status"], group: "http" },
  ];
  const semanticIndex = buildSemanticIndex(aliases);
  const keyFieldSet = new Set<string>();
  const keyGroupSet = new Set<string>();

  function makeField(name: string, dataType = "Utf8", isInteresting = false) {
    return {
      name,
      dataType,
      ftsKey: false,
      isSchemaField: true,
      showValues: true,
      isInterestingField: isInteresting,
      group: "",
      streams: [],
    };
  }

  it("returns labeled ordered list with group header rows injected", () => {
    const fields = [makeField("http_method"), makeField("http_status")];
    const result = applyFieldGrouping(fields, semanticIndex, keyFieldSet, keyGroupSet);

    expect(result[0].label).toBe(true);
    expect(result[0].group).toBe("http");
    expect(result[1].name).toBe("http_method");
    expect(result[2].name).toBe("http_status");
  });

  it("PINNED group comes first when key field is in the list", () => {
    const pinnedSet = new Set(["http_method"]);
    const fields = [makeField("http_method"), makeField("http_status"), makeField("plain_field")];
    const result = applyFieldGrouping(fields, semanticIndex, pinnedSet, keyGroupSet);

    const firstGroup = result[0];
    expect(firstGroup.label).toBe(true);
    expect(firstGroup.group).toBe(CATEGORY.PINNED);
  });

  it("data-type buckets appear after semantic groups", () => {
    const fields = [makeField("http_method"), makeField("plain_string", "Utf8")];
    const result = applyFieldGrouping(fields, semanticIndex, keyFieldSet, keyGroupSet);

    const groupKeys = result.filter((r: any) => r.label).map((r: any) => r.group);
    const httpIdx = groupKeys.indexOf("http");
    const stringIdx = groupKeys.indexOf(CATEGORY.TYPE_STRING);
    expect(httpIdx).toBeLessThan(stringIdx);
  });

  it("returns flat list unchanged when index is null", () => {
    const fields = [makeField("http_method"), makeField("other_field")];
    const result = applyFieldGrouping(fields, null, keyFieldSet, keyGroupSet);
    // No label rows injected when index is null
    expect(result.every((r: any) => !r.label)).toBe(true);
  });

  it("skips label rows that are already in the input (no double-injection)", () => {
    const labelRow = {
      name: "HTTP",
      label: true,
      group: "http",
      dataType: "",
      ftsKey: false,
      isSchemaField: false,
      showValues: false,
      isInterestingField: false,
      streams: [],
    };
    const fields = [labelRow, makeField("http_method")];
    const result = applyFieldGrouping(fields, semanticIndex, keyFieldSet, keyGroupSet);
    const labelRows = result.filter((r: any) => r.label);
    expect(labelRows.length).toBe(1);
  });

  it("empty input returns empty array", () => {
    expect(applyFieldGrouping([], semanticIndex, keyFieldSet, keyGroupSet)).toEqual([]);
  });
});

// ---- applyStreamGrouping tests ----------------------------------------------

describe("applyStreamGrouping", () => {
  const labels = { common: "Common fields", stream: (name: string) => name.toUpperCase() };

  function makeField(name: string, streams: string[]) {
    return {
      name,
      dataType: "Utf8",
      ftsKey: false,
      isSchemaField: true,
      showValues: true,
      isInterestingField: false,
      group: "",
      streams,
    };
  }

  const rows = (result: { label?: boolean; group: string; name: string }[]) =>
    result.map((r) => (r.label ? `#${r.group}:${r.name}` : `${r.group}/${r.name}`));

  it("lists the fields every stream has first, key fields on top, then each stream's own fields", () => {
    const result = applyStreamGrouping(
      [
        makeField("a", ["s1", "s2"]),
        makeField("host", ["s1", "s2"]),
        makeField("b", ["s1"]),
        makeField("c", ["s2"]),
      ],
      ["s1", "s2"],
      new Set(["host"]),
      new Set(),
      labels,
    );
    expect(rows(result)).toEqual([
      "#common:Common fields",
      "common/host",
      "common/a",
      "#s1:S1",
      "s1/b",
      "#s2:S2",
      "s2/c",
    ]);
  });

  it("renders no header for a stream without own fields and no common header without common fields (B1, B2)", () => {
    const result = applyStreamGrouping(
      [makeField("a", ["s1"]), makeField("b", ["s2"])],
      ["s1", "s2", "s3"],
      new Set(),
      new Set(),
      labels,
    );
    expect(rows(result)).toEqual(["#s1:S1", "s1/a", "#s2:S2", "s2/b"]);
  });

  it("lists a field shared by some streams once, under the first stream that has it", () => {
    const result = applyStreamGrouping(
      [makeField("x", ["s2", "s3"]), makeField("y", ["s1", "s2", "s3"])],
      ["s1", "s2", "s3"],
      new Set(),
      new Set(),
      labels,
    );
    expect(rows(result)).toEqual(["#common:Common fields", "common/y", "#s2:S2", "s2/x"]);
  });

  it("pins a field whose prefix names a key group and skips header rows in the input", () => {
    const header = { ...makeField("S1", ["s1"]), label: true, group: "s1", isSchemaField: false };
    const result = applyStreamGrouping(
      [header, makeField("k8s_pod", ["s1", "s2"]), makeField("a", ["s1", "s2"])],
      ["s1", "s2"],
      new Set(),
      new Set(["k8s"]),
      labels,
    );
    expect(rows(result)).toEqual(["#common:Common fields", "common/k8s_pod", "common/a"]);
  });
});
