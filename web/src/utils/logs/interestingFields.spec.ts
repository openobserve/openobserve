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
  isSchemaBackedField,
  schemaBackedFieldNames,
  selectableInterestingFields,
  pruneInterestingFields,
} from "./interestingFields";

const SCHEMA_FIELD = { name: "level", isSchemaField: true };
// extractFields() marks the fields it finds only on the result hits this way.
const VRL_FIELD = { name: "vrl_field", isSchemaField: false };
// Raw stream schema objects carry no isSchemaField property at all.
const RAW_SCHEMA_FIELD = { name: "message" };

describe("isSchemaBackedField", () => {
  it("accepts an explicit schema field", () => {
    expect(isSchemaBackedField(SCHEMA_FIELD)).toBe(true);
  });

  it("accepts a field with no isSchemaField property", () => {
    expect(isSchemaBackedField(RAW_SCHEMA_FIELD)).toBe(true);
  });

  it("rejects a field explicitly marked as not schema-backed", () => {
    expect(isSchemaBackedField(VRL_FIELD)).toBe(false);
  });

  it("accepts undefined rather than throwing", () => {
    expect(isSchemaBackedField(undefined)).toBe(true);
  });
});

describe("schemaBackedFieldNames", () => {
  it("keeps schema fields and drops the hit-only ones", () => {
    expect(schemaBackedFieldNames([SCHEMA_FIELD, VRL_FIELD, RAW_SCHEMA_FIELD])).toEqual([
      "level",
      "message",
    ]);
  });

  it("returns an empty list for undefined", () => {
    expect(schemaBackedFieldNames(undefined)).toEqual([]);
  });
});

describe("selectableInterestingFields", () => {
  it("drops a VRL-derived field", () => {
    expect(selectableInterestingFields(["level", "vrl_field"], [SCHEMA_FIELD, VRL_FIELD])).toEqual([
      "level",
    ]);
  });

  it("drops a field the stream does not have at all", () => {
    expect(selectableInterestingFields(["level", "gone"], [SCHEMA_FIELD])).toEqual(["level"]);
  });

  it("preserves the interesting-field order", () => {
    expect(
      selectableInterestingFields(["message", "level"], [SCHEMA_FIELD, RAW_SCHEMA_FIELD]),
    ).toEqual(["message", "level"]);
  });

  it("does not mutate the input", () => {
    const interesting = ["level", "vrl_field"];
    selectableInterestingFields(interesting, [SCHEMA_FIELD, VRL_FIELD]);
    expect(interesting).toEqual(["level", "vrl_field"]);
  });

  it("returns an empty list when nothing is selectable", () => {
    expect(selectableInterestingFields(["vrl_field"], [VRL_FIELD])).toEqual([]);
  });
});

describe("pruneInterestingFields", () => {
  it("removes the non-selectable entries in place, keeping the same array", () => {
    const interesting = ["level", "vrl_field", "message"];
    const result = pruneInterestingFields(interesting, [SCHEMA_FIELD, VRL_FIELD, RAW_SCHEMA_FIELD]);

    // Callers hold this array by reference (and Vue tracks it), so it must be the same one.
    expect(result).toBe(interesting);
    expect(interesting).toEqual(["level", "message"]);
  });

  it("leaves an already-clean list untouched", () => {
    const interesting = ["level", "message"];
    pruneInterestingFields(interesting, [SCHEMA_FIELD, RAW_SCHEMA_FIELD]);
    expect(interesting).toEqual(["level", "message"]);
  });

  it("empties the list when no field is selectable", () => {
    const interesting = ["vrl_field"];
    pruneInterestingFields(interesting, [VRL_FIELD]);
    expect(interesting).toEqual([]);
  });

  it("empties the list when the stream fields are not loaded yet", () => {
    const interesting = ["level"];
    pruneInterestingFields(interesting, undefined);
    expect(interesting).toEqual([]);
  });
});
