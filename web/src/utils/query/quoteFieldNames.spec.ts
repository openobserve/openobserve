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
});
