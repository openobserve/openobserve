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

import {
  ANSWER_LINE_CHARS,
  extractProposal,
  firstAnswerLine,
  helperRequest,
  questionOf,
  readsAsPlainLanguage,
} from "./helperText";

describe("readsAsPlainLanguage", () => {
  it.each([
    "show me errors per service",
    "count logs by status code today",
    "¿cuántos errores hubo ayer?",
  ])("reads %j as a sentence", (text) => {
    expect(readsAsPlainLanguage(text)).toBe(true);
  });

  it.each([
    "# parse msg into fields",
    "// drop debug lines please",
    "-- top services by errors",
    "/* summarise this */",
    "abort",
    "two words",
    '.status = "active"',
    "parse_json!(.message) here",
    "if .level == error do it",
    "SELECT count from logs",
    "with errors as the base",
    "level:error service:api please",
    "show me errors\nper service",
    "x".repeat(401),
  ])("never reads %j as a sentence", (text) => {
    expect(readsAsPlainLanguage(text)).toBe(false);
  });
});

describe("extractProposal", () => {
  it("prefers the fence tagged with the editor's language", () => {
    const answer = "Here:\n```text\nnope\n```\n```sql\nSELECT 1\n```";
    expect(extractProposal(answer, "sql")).toBe("SELECT 1");
  });

  it("falls back to the first fence, then to a bare SQL statement", () => {
    expect(extractProposal("```\nrate(x[5m])\n```", "promql")).toBe("rate(x[5m])");
    expect(extractProposal("Try this:\nSELECT a\nFROM b\n\nIt counts rows.", "sql")).toBe(
      "SELECT a\nFROM b",
    );
    expect(extractProposal("No query here.", "promql")).toBeNull();
  });

  it("keeps lower-case SQL continuation lines and stops at prose or a list", () => {
    expect(
      extractProposal(
        "Here:\nSELECT a\nfrom b\nwhere c > 1\norder by a\nthis keeps the newest rows.",
        "sql",
      ),
    ).toBe("SELECT a\nfrom b\nwhere c > 1\norder by a");
    expect(extractProposal("SELECT a FROM b\n- counts rows", "sql")).toBe("SELECT a FROM b");
  });

  it("turns VRL line comments into VRL's own comment marker, never inside a string", () => {
    const answer = '```vrl\n// parse it\n.a = "http://x" // keep\n.b = "a // b\n```';
    expect(extractProposal(answer, "vrl")).toBe('# parse it\n.a = "http://x" # keep\n.b = "a // b');
  });
});

describe("questionOf and firstAnswerLine", () => {
  it("finds the clarifying question an answer ends on", () => {
    expect(questionOf("I can help. Which stream should I use?")).toBe("Which stream should I use?");
    expect(questionOf("I need the organization name first.")).toBe(
      "I need the organization name first.",
    );
    expect(questionOf("Done.")).toBeNull();
  });

  it("cuts the first line for the status row", () => {
    const line = firstAnswerLine(`## ${"a".repeat(200)}\nmore`);
    expect(line.length).toBe(ANSWER_LINE_CHARS);
    expect(line.startsWith("a")).toBe(true);
  });
});

describe("helperRequest", () => {
  it("sends the generate form for an empty editor and the modify form for a query", () => {
    expect(helperRequest(" errors per service ", "sql", "")).toBe(
      "Generate SQL query : errors per service",
    );
    expect(helperRequest("only errors", "promql", "rate(x[5m])")).toBe(
      "Generate PromQL query : Modify this PROMQL query to only errors:\n\nrate(x[5m])",
    );
    expect(helperRequest("drop debug", "js", "row.a = 1;")).toContain(
      "Modify this JAVASCRIPT query",
    );
  });
});
