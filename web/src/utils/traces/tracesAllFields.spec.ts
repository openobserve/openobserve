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
import { allFieldRef, fieldsStoredInAll, withAllFieldInserts } from "./tracesAllFields";

describe("fieldsStoredInAll", () => {
  const schema = [
    { name: "_timestamp", type: "Int64" },
    { name: "_all", type: "Utf8" },
    { name: "_o2_ingest_ts", type: "Int64" },
    { name: "trace_id", type: "Utf8" },
    { name: "service_name", type: "Utf8" },
    { name: "http_status_code", type: "Int64" },
    { name: "infer_service_name", type: "Utf8" },
    { name: "o2_db_system", type: "Utf8" },
    { name: "gen_ai_agent_name", type: "Utf8" },
    { name: "k8s_pod", type: "Utf8" },
  ];

  it("lists every field outside the saved schema, however few, except the columns ingestion restores", () => {
    const inAll = fieldsStoredInAll(schema, ["trace_id", "service_name", "k8s_pod"]);
    expect([...inAll.entries()]).toEqual([["http_status_code", "Int64"]]);
  });

  it("lists one defined field with three extras as three fields in _all", () => {
    const inAll = fieldsStoredInAll(
      [
        { name: "k8s_pod", type: "Utf8" },
        { name: "http_route", type: "Utf8" },
        { name: "http_status_code", type: "Int64" },
        { name: "sampled", type: "Boolean" },
      ],
      ["k8s_pod"],
    );
    expect(Object.fromEntries(inAll)).toEqual({
      http_route: "Utf8",
      http_status_code: "Int64",
      sampled: "Boolean",
    });
  });

  it("lists a gen_ai_ or session field the saved schema does not name", () => {
    const inAll = fieldsStoredInAll(
      [
        { name: "trace_id", type: "Utf8" },
        { name: "gen_ai_response_model", type: "Utf8" },
        { name: "session_id", type: "Utf8" },
      ],
      ["trace_id"],
    );
    expect([...inAll.keys()]).toEqual(["gen_ai_response_model", "session_id"]);
  });

  it("is empty without a user-defined schema", () => {
    expect(fieldsStoredInAll(schema, []).size).toBe(0);
  });
});

describe("allFieldRef", () => {
  it("reads the field from the _all column with the json_get function of its type", () => {
    expect(allFieldRef("http_route", "Utf8", "_all")).toBe("json_get_str(_all, 'http_route')");
    expect(allFieldRef("http_status_code", "Int64", "_all")).toBe(
      "json_get_int(_all, 'http_status_code')",
    );
    expect(allFieldRef("ratio", "Float64", "_all")).toBe("json_get_float(_all, 'ratio')");
    expect(allFieldRef("sampled", "Boolean", "_all")).toBe("json_get_bool(_all, 'sampled')");
    expect(allFieldRef("o'k", undefined, "all_x")).toBe("json_get_str(all_x, 'o''k')");
  });
});

describe("withAllFieldInserts", () => {
  it("marks _all fields for autocomplete and inserts their json_get expression", () => {
    expect(
      withAllFieldInserts(
        [
          { name: "service_name", dataType: "Utf8" },
          { name: "http_status_code", dataType: "Int64" },
          { name: "duration", dataType: "Int64", type: "Int64 · µs" },
        ],
        { http_status_code: "Int64" },
        "_all",
        "in _all",
      ),
    ).toEqual([
      { name: "service_name", dataType: "Utf8" },
      {
        name: "http_status_code",
        dataType: "Int64",
        type: "Int64 · in _all",
        insertText: "json_get_int(_all, 'http_status_code')",
      },
      { name: "duration", dataType: "Int64", type: "Int64 · µs" },
    ]);
  });
});
