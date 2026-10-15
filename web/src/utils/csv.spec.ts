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
import { csv2json } from "json-2-csv";
import { toCsv } from "@/utils/csv";

describe("toCsv", () => {
  it("keeps a JSON string holding quotes and commas in one cell", () => {
    const events = '[{"name":"exception","attrs":{"msg":"a, b \\"c\\""}}]';
    const csv = toCsv([{ span_id: "s1", events, duration: 5 }]);

    expect(csv).toBe(
      'span_id,events,duration\r\ns1,"[{""name"":""exception"",""attrs"":{""msg"":""a, b \\""c\\""""}}]",5',
    );
    expect(csv2json(csv, { delimiter: { eol: "\r\n" }, parseValue: (v) => v })).toEqual([
      { span_id: "s1", events, duration: "5" },
    ]);
  });

  it("writes an object value as one JSON cell", () => {
    const services = { "svc-a": { count: 1, duration: 0 }, "svc-b": { count: 2, duration: 3 } };
    const csv = toCsv([{ trace_id: "t1", services, spans: 3 }]);

    expect(csv).toBe(
      'trace_id,services,spans\r\nt1,"{""svc-a"":{""count"":1,""duration"":0},""svc-b"":{""count"":2,""duration"":3}}",3',
    );
  });

  it("uses the union of keys as header and leaves missing cells empty", () => {
    const csv = toCsv([{ a: 1 }, { b: 2 }, { a: 3, c: 4 }]);

    expect(csv).toBe("a,b,c\r\n1,,\r\n,2,\r\n3,,4");
  });

  it("writes null and undefined as empty cells", () => {
    expect(toCsv([{ a: null, b: undefined, c: 1 }])).toBe("a,b,c\r\n,,1");
  });

  it("keeps line breaks inside a quoted cell", () => {
    const csv = toCsv([{ msg: "l1\nl2\r\nl3", n: 1 }]);

    expect(csv).toBe('msg,n\r\n"l1\nl2\r\nl3",1');
  });

  it("quotes a header key containing a comma", () => {
    expect(toCsv([{ "a,b": 1 }])).toBe('"a,b"\r\n1');
  });

  it("does not escape a dotted header key", () => {
    expect(toCsv([{ "a.b": "v" }])).toBe("a.b\r\nv");
  });

  it("separates rows with CRLF", () => {
    const csv = toCsv([{ a: 1 }, { a: 2 }]);

    expect(csv).toBe("a\r\n1\r\n2");
    expect(csv.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("returns an empty string for no rows", () => {
    expect(() => toCsv([])).not.toThrow();
    expect(toCsv([])).toBe("");
  });
});
