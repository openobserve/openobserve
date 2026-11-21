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

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import useParser from "@/composables/useParser";

import {
  MAX_UNKNOWN_FIELDS,
  MAX_VALIDATED_CHARS,
  setSqlParserForTests,
  validateProposal,
} from "./queryValidation";

let parser: { astify(sql: string): unknown };

beforeAll(async () => {
  parser = await useParser().sqlParser();
});

afterEach(() => {
  setSqlParserForTests(parser);
});

describe("validateProposal", () => {
  it("lets the server's validated flag win over any client check", async () => {
    setSqlParserForTests(parser);
    expect(await validateProposal("sql", "SELEKT nonsense", [], { validated: true })).toEqual({
      status: "ok",
    });
  });

  it("reports a SQL statement that does not parse with the parser's first line", async () => {
    setSqlParserForTests(parser);
    const result = await validateProposal("sql", "SELECT * FROM");
    expect(result.status).toBe("error");
    expect(String(result.message)).not.toContain("\n");
  });

  it("names fields the stream does not hold, but never aliases, _timestamp or *", async () => {
    setSqlParserForTests(parser);
    const result = await validateProposal(
      "sql",
      'SELECT count(*) AS hits, service FROM "default" WHERE status = 500 AND _timestamp > 0 GROUP BY service ORDER BY hits',
      ["service"],
    );
    expect(result).toEqual({ status: "error", unknownFields: ["status"] });
  });

  it("accepts a query whose fields are all known, case-insensitively", async () => {
    setSqlParserForTests(parser);
    const result = await validateProposal("sql", 'SELECT Level FROM "default"', ["level"]);
    expect(result).toEqual({ status: "ok" });
  });

  it("caps the unknown list", async () => {
    setSqlParserForTests(parser);
    const cols = Array.from({ length: MAX_UNKNOWN_FIELDS + 5 }, (_, i) => `f${i}`).join(", ");
    const result = await validateProposal("sql", `SELECT ${cols} FROM "default"`, ["other"]);
    expect(result.unknownFields).toHaveLength(MAX_UNKNOWN_FIELDS);
  });

  it("is skipped, never an error, when the parser cannot load", async () => {
    setSqlParserForTests(null);
    expect(await validateProposal("sql", "SELECT 1")).toEqual({ status: "skipped" });
  });

  it("checks JSON and regex with the platform parsers", async () => {
    expect((await validateProposal("json", '{"a": 1}')).status).toBe("ok");
    expect((await validateProposal("json", '{"a": }')).status).toBe("error");
    expect((await validateProposal("regex", "^a+$")).status).toBe("ok");
    expect((await validateProposal("regex", "(")).status).toBe("error");
  });

  it("only reports broken brackets or quotes for PromQL and VRL", async () => {
    expect((await validateProposal("promql", "rate(http_requests_total[5m])")).status).toBe(
      "skipped",
    );
    const promql = await validateProposal("promql", "rate(http_requests_total[5m]");
    expect(promql.status).toBe("error");
    expect(String(promql.message)).toContain(")");
    expect((await validateProposal("vrl", '.a = "x" # (unclosed in a comment')).status).toBe(
      "skipped",
    );
  });

  it("parses JavaScript, including a top-level return", async () => {
    expect((await validateProposal("js", "option = { series: [] };\nreturn option;")).status).toBe(
      "ok",
    );
    const broken = await validateProposal("js", 'row.a = "x;');
    expect(broken.status).toBe("error");
    expect(String(broken.message)).toMatch(/\(1:\d+\)/);
  });

  it("skips empty and oversized text", async () => {
    expect(await validateProposal("sql", "   ")).toEqual({ status: "skipped" });
    expect(await validateProposal("json", "1".repeat(MAX_VALIDATED_CHARS + 1))).toEqual({
      status: "skipped",
    });
  });
});
