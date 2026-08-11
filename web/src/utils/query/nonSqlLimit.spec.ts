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
import { hasLimitClause } from "./nonSqlLimit";

describe("hasLimitClause", () => {
  describe("filters that carry a LIMIT clause", () => {
    it("detects the trailing LIMIT from the reported query", () => {
      expect(hasLimitClause("k8s_namespace_name = 'nginx-ingress' LIMIT 10")).toBe(true);
    });

    it("is case-insensitive", () => {
      expect(hasLimitClause("code = 200 limit 5")).toBe(true);
      expect(hasLimitClause("code = 200 LiMiT 5")).toBe(true);
    });

    it("detects a LIMIT with extra whitespace or a newline before the number", () => {
      expect(hasLimitClause("code = 200 LIMIT   25")).toBe(true);
      expect(hasLimitClause("code = 200\nLIMIT\n25")).toBe(true);
    });

    it("detects a bare LIMIT with no other filter", () => {
      expect(hasLimitClause("LIMIT 100")).toBe(true);
    });
  });

  describe("filters that only look like they carry one", () => {
    it("ignores a field named limit", () => {
      expect(hasLimitClause("limit = 5")).toBe(false);
    });

    it("ignores a field whose name ends in limit", () => {
      expect(hasLimitClause("rate_limit >= 100")).toBe(false);
    });

    it("ignores the word inside a string literal", () => {
      expect(hasLimitClause("msg = 'rate limit 500 exceeded'")).toBe(false);
    });

    it("ignores the word inside a literal containing an escaped quote", () => {
      expect(hasLimitClause("msg = 'it''s over the limit 5 mark'")).toBe(false);
    });

    it("ignores LIMIT when not followed by a number", () => {
      expect(hasLimitClause("limit = 'none'")).toBe(false);
    });
  });

  describe("ordinary filters", () => {
    it("passes a plain equality filter", () => {
      expect(hasLimitClause("code = 200")).toBe(false);
    });

    it("passes a compound filter", () => {
      expect(hasLimitClause("code = 200 AND method = 'GET'")).toBe(false);
    });

    it("passes an empty filter", () => {
      expect(hasLimitClause("")).toBe(false);
    });
  });

  describe("comments", () => {
    it("ignores a LIMIT in a trailing line comment", () => {
      expect(hasLimitClause("code = 200 -- limit 10")).toBe(false);
    });

    it("ignores a LIMIT in a leading line comment", () => {
      expect(hasLimitClause("-- LIMIT 10\ncode = 200")).toBe(false);
    });

    it("ignores a LIMIT in a block comment", () => {
      expect(hasLimitClause("code = 200 /* LIMIT 10 */")).toBe(false);
    });

    it("still detects a real LIMIT alongside a comment", () => {
      expect(hasLimitClause("code = 200 LIMIT 5 -- why not")).toBe(true);
    });

    it("does not treat a dash sequence inside a literal as a comment", () => {
      expect(hasLimitClause("msg = 'a -- b' LIMIT 5")).toBe(true);
    });
  });
});
