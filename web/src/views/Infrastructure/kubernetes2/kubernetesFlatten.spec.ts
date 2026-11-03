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

import { afterEach, describe, expect, it } from "vitest";
import { col, selectAs, selectObject, setStreamColumns } from "./kubernetesFlatten";
import { SCHEMAS } from "./__fixtures__/flattenSchemas";

describe("kubernetesFlatten col", () => {
  afterEach(() => setStreamColumns(null));

  it("emits the level 3 form while the schema is unknown", () => {
    expect(col(["type"])).toBe("body_object_type");
    expect(col(["metadata", "uid"])).toBe("json_get_str(body_object_metadata,'uid')");
    expect(col(["spec", "template", "spec", "nodeSelector"], "json")).toBe(
      "json_get_json(body_object_spec,'template','spec','nodeSelector')",
    );
  });

  it("emits the level 3 form on a level 3 schema", () => {
    setStreamColumns(SCHEMAS["level 3"]);
    expect(col(["status", "qosClass"])).toBe("json_get_str(body_object_status,'qosClass')");
    expect(col(["metadata"], "json")).toBe("body_object_metadata");
  });

  it("is NULL on a level 3 stream that lacks an optional column", () => {
    setStreamColumns(SCHEMAS["level 3"].filter((c) => c !== "body_object_series"));
    expect(col(["series"], "json")).toBe("NULL");
    expect(selectObject(["series"], "body_object_series", ["count"])).toEqual([
      "NULL AS body_object_series",
    ]);
  });

  it("prefers a flattened column at level 0 and lowercases its name", () => {
    setStreamColumns(SCHEMAS["level 0"]);
    expect(col(["status", "qosClass"])).toBe("body_object_status_qosclass");
    expect(col(["spec", "unschedulable"], "bool")).toBe("body_object_spec_unschedulable");
  });

  it("is NULL at level 0 for a nested value with no flattened column", () => {
    setStreamColumns(SCHEMAS["level 0"]);
    expect(col(["metadata", "labels"], "json")).toBe("NULL");
  });

  it("walks to body_object at level 2 and body at level 1", () => {
    setStreamColumns(SCHEMAS["level 2"]);
    expect(col(["metadata", "uid"])).toBe("json_get_str(body_object,'metadata','uid')");
    expect(col(["kind"])).toBe("json_get_str(body_object,'kind')");
    setStreamColumns(SCHEMAS["level 1"]);
    expect(col(["metadata", "uid"])).toBe("json_get_str(body,'object','metadata','uid')");
  });

  it("escapes quotes in path segments", () => {
    setStreamColumns(SCHEMAS["level 2"]);
    expect(col(["a'b"])).toBe("json_get_str(body_object,'a''b')");
  });

  it("aliases only when the expression differs from the alias", () => {
    expect(selectAs("body_object_type", "body_object_type")).toBe("body_object_type");
    expect(selectAs("x", "y")).toBe("x AS y");
  });

  it("coalesces the level 3 and level 2 layouts on a mixed 3+2 schema", () => {
    setStreamColumns(SCHEMAS["mixed 3+2"]);
    expect(col(["kind"])).toBe("COALESCE(body_object_kind,json_get_str(body_object,'kind'))");
    expect(col(["metadata", "uid"])).toBe(
      "COALESCE(json_get_str(body_object_metadata,'uid'),json_get_str(body_object,'metadata','uid'))",
    );
  });

  it("coalesces the level 3 and level 0 layouts on a mixed 3+0 schema", () => {
    setStreamColumns(SCHEMAS["mixed 3+0"]);
    expect(col(["kind"])).toBe("body_object_kind");
    expect(col(["metadata", "uid"])).toBe(
      "COALESCE(body_object_metadata_uid,json_get_str(body_object_metadata,'uid'))",
    );
  });

  it("selects the flattened children of an object column at level 0", () => {
    setStreamColumns(SCHEMAS["level 0"]);
    expect(selectObject(["regarding"], "body_object_regarding", ["kind", "uid"])).toEqual([
      "body_object_regarding_kind",
      "body_object_regarding_uid",
    ]);
  });
});
