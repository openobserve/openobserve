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
import { quoteFieldNames } from "@/utils/query/quoteFieldNames";

const fields = ["message", "service", "status", "api"];

describe("quoteFieldNames", () => {
  it("quotes a bare field name", () => {
    expect(quoteFieldNames("status = 500", fields)).toBe('"status" = 500');
  });

  it("leaves words inside a string literal alone", () => {
    expect(quoteFieldNames("message LIKE '%from api status 500%'", fields)).toBe(
      "\"message\" LIKE '%from api status 500%'",
    );
  });

  it("treats a doubled quote as part of the literal", () => {
    expect(quoteFieldNames("message = 'it''s status api' AND status = 1", fields)).toBe(
      "\"message\" = 'it''s status api' AND \"status\" = 1",
    );
  });

  it("quotes fields on both sides of a literal", () => {
    expect(quoteFieldNames("status = 'status' AND api = 'x'", fields)).toBe(
      "\"status\" = 'status' AND \"api\" = 'x'",
    );
  });

  it("keeps an unterminated literal intact", () => {
    expect(quoteFieldNames("message = 'api status", fields)).toBe('"message" = \'api status');
  });

  it("does not re-quote a field that is already quoted", () => {
    expect(quoteFieldNames('"status" = 500', fields)).toBe('"status" = 500');
  });

  it("returns a clause with no fields unchanged", () => {
    expect(quoteFieldNames("x = 1", fields)).toBe("x = 1");
    expect(quoteFieldNames("", fields)).toBe("");
  });

  it("quotes field names adjacent to parentheses, commas, and unspaced operators", () => {
    expect(quoteFieldNames("(status = 500 AND api = 'x')", fields)).toBe(
      '("status" = 500 AND "api" = \'x\')',
    );
    expect(quoteFieldNames("(status=500 AND api!='x')", fields)).toBe(
      '("status"=500 AND "api"!=\'x\')',
    );
    expect(quoteFieldNames("str_match(message, 'err')", fields)).toBe(
      "str_match(\"message\", 'err')",
    );
  });

  it("quotes field names separated by tabs or newlines", () => {
    expect(quoteFieldNames("status\n= 500\tAND\napi = 'x'", fields)).toBe(
      '"status"\n= 500\tAND\n"api" = \'x\'',
    );
  });

  it("leaves double-quoted identifiers untouched", () => {
    expect(quoteFieldNames('"my status" = 500 AND "api""name" = \'x\'', fields)).toBe(
      '"my status" = 500 AND "api""name" = \'x\'',
    );
  });

  it("quotes dotted, hyphenated, and slash-containing field names without partial matches", () => {
    const extended = [...fields, "http.status", "k8s-pod", "k8s.io/app"];
    expect(quoteFieldNames("(http.status=500 AND k8s-pod='a' AND k8s.io/app='b')", extended)).toBe(
      '("http.status"=500 AND "k8s-pod"=\'a\' AND "k8s.io/app"=\'b\')',
    );
    expect(quoteFieldNames("status_code = 500", fields)).toBe("status_code = 500");
  });
});
