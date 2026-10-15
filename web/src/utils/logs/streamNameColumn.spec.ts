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
import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";
import {
  STREAM_NAME_FIELD,
  buildStreamNameColumn,
  isFilterableLogField,
  referencesStreamName,
  replaceStreamNameRefsInWhere,
  shouldShowStreamNameColumn,
} from "./streamNameColumn";

const parser = new Parser();

// Parse, rewrite for one stream and print back the WHERE the backend receives.
const rewriteWhere = (where: string, stream: string): string => {
  const ast: any = parser.astify(`select * from "${stream}" where ${where}`);
  ast.where = replaceStreamNameRefsInWhere(ast.where, stream);
  return parser.sqlify(ast).split(/ WHERE /i)[1];
};

describe("referencesStreamName", () => {
  it("matches the column as a whole word only", () => {
    expect(referencesStreamName("_stream_name = 'a'")).toBe(true);
    expect(referencesStreamName(`"_stream_name" != 'a'`)).toBe(true);
    expect(referencesStreamName("my_stream_name_x = 'a'")).toBe(false);
    expect(referencesStreamName("level = 'error'")).toBe(false);
  });
});

describe("replaceStreamNameRefsInWhere", () => {
  it("replaces an equality with the stream's own name", () => {
    expect(rewriteWhere("_stream_name = 'app'", "app")).toBe("'app' = 'app'");
    expect(rewriteWhere("_stream_name = 'app'", "rum")).toBe("'rum' = 'app'");
  });

  it("replaces the column inside IN, NOT and combined conditions", () => {
    const where = "level = 'error' AND (_stream_name IN ('a', 'b') OR NOT (_stream_name != 'c'))";
    const sql = rewriteWhere(where, "b");

    expect(sql).not.toContain(STREAM_NAME_FIELD);
    expect(sql).toContain("'b' IN ('a', 'b')");
    expect(sql).toContain("'b' != 'c'");
    expect(sql).toContain("level");
  });

  it("replaces a quoted column reference", () => {
    expect(rewriteWhere(`"_stream_name" = 'app'`, "app")).toBe("'app' = 'app'");
  });

  it("leaves other columns alone", () => {
    const sql = rewriteWhere("stream_name = 'x' AND level = 'error'", "app");
    expect(sql).toContain("stream_name");
    expect(sql).not.toContain("'app'");
  });
});

describe("shouldShowStreamNameColumn", () => {
  const hits = [{ _timestamp: 1, _stream_name: "a" }];

  it("shows the column for a multi-stream result that carries the stream name", () => {
    expect(shouldShowStreamNameColumn(["a", "b"], hits, [])).toBe(true);
  });

  it("hides it for a single stream, missing tags, or an explicitly selected field", () => {
    expect(shouldShowStreamNameColumn(["a"], hits, [])).toBe(false);
    expect(shouldShowStreamNameColumn(["a", "b"], [{ _timestamp: 1 }], [])).toBe(false);
    expect(shouldShowStreamNameColumn(["a", "b"], undefined, [])).toBe(false);
    expect(shouldShowStreamNameColumn(["a", "b"], hits, [STREAM_NAME_FIELD])).toBe(false);
  });
});

describe("buildStreamNameColumn", () => {
  it("is a closable, unsortable column that reads the stream name", () => {
    const column = buildStreamNameColumn();

    expect(column.id).toBe(STREAM_NAME_FIELD);
    expect(column.meta.closable).toBe(true);
    expect(column.sortable).toBe(false);
    expect(column.accessorFn({ _stream_name: "app" })).toBe("app");
    expect(column.accessorFn({})).toBe("");
  });
});

describe("isFilterableLogField", () => {
  const fields = [
    { name: "status", isSchemaField: true },
    { name: "message", isSchemaField: false },
  ];

  it("allows schema fields and the stream name, which is in no schema", () => {
    expect(isFilterableLogField("status", fields)).toBe(true);
    expect(isFilterableLogField(STREAM_NAME_FIELD, fields)).toBe(true);
    expect(isFilterableLogField(STREAM_NAME_FIELD, undefined)).toBe(true);
  });

  it("rejects non-schema and unknown fields", () => {
    expect(isFilterableLogField("message", fields)).toBe(false);
    expect(isFilterableLogField("unknown", fields)).toBe(false);
    expect(isFilterableLogField("status", undefined)).toBe(false);
  });
});
