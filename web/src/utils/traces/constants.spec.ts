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

import { describe, expect, it, beforeAll } from "vitest";
import {
  SPAN_KIND_MAP,
  SPAN_KIND_LABEL_TO_KEY,
  SPAN_KIND_UNSPECIFIED,
  parseSpanKindWhereClause,
} from "./constants";

describe("traces/constants", () => {
  describe("SPAN_KIND_MAP", () => {
    it("should contain all 6 OTEL span kind entries", () => {
      expect(Object.keys(SPAN_KIND_MAP)).toHaveLength(6);
    });

    it('should map "0" to "Unspecified"', () => {
      expect(SPAN_KIND_MAP["0"]).toBe("Unspecified");
    });

    it('should map "1" to "Internal"', () => {
      expect(SPAN_KIND_MAP["1"]).toBe("Internal");
    });

    it('should map "2" to "Server"', () => {
      expect(SPAN_KIND_MAP["2"]).toBe("Server");
    });

    it('should map "3" to "Client"', () => {
      expect(SPAN_KIND_MAP["3"]).toBe("Client");
    });

    it('should map "4" to "Producer"', () => {
      expect(SPAN_KIND_MAP["4"]).toBe("Producer");
    });

    it('should map "5" to "Consumer"', () => {
      expect(SPAN_KIND_MAP["5"]).toBe("Consumer");
    });
  });

  describe("SPAN_KIND_LABEL_TO_KEY", () => {
    it("should be the exact reverse of SPAN_KIND_MAP with lowercase keys", () => {
      const expected = Object.fromEntries(
        Object.entries(SPAN_KIND_MAP).map(([key, label]) => [
          label.toLowerCase(),
          key,
        ]),
      );
      expect(SPAN_KIND_LABEL_TO_KEY).toEqual(expected);
    });

    it('should map "unspecified" to "0"', () => {
      expect(SPAN_KIND_LABEL_TO_KEY["unspecified"]).toBe("0");
    });

    it('should map "internal" to "1"', () => {
      expect(SPAN_KIND_LABEL_TO_KEY["internal"]).toBe("1");
    });

    it('should map "server" to "2"', () => {
      expect(SPAN_KIND_LABEL_TO_KEY["server"]).toBe("2");
    });

    it('should map "client" to "3"', () => {
      expect(SPAN_KIND_LABEL_TO_KEY["client"]).toBe("3");
    });

    it('should map "producer" to "4"', () => {
      expect(SPAN_KIND_LABEL_TO_KEY["producer"]).toBe("4");
    });

    it('should map "consumer" to "5"', () => {
      expect(SPAN_KIND_LABEL_TO_KEY["consumer"]).toBe("5");
    });

    it("should contain exactly 6 entries", () => {
      expect(Object.keys(SPAN_KIND_LABEL_TO_KEY)).toHaveLength(6);
    });
  });

  describe("SPAN_KIND_UNSPECIFIED", () => {
    it('should equal "0"', () => {
      expect(SPAN_KIND_UNSPECIFIED).toBe("0");
    });
  });

  describe("parseSpanKindWhereClause", () => {
    it("should replace span_kind='Server' with the numeric key", () => {
      expect(parseSpanKindWhereClause("span_kind='Server'")).toBe(
        "span_kind='2'",
      );
    });

    it("should replace span_kind='server' case-insensitively", () => {
      expect(parseSpanKindWhereClause("span_kind='server'")).toBe(
        "span_kind='2'",
      );
    });

    it("should replace span_kind!='Client' preserving the != operator", () => {
      expect(parseSpanKindWhereClause("span_kind!='Client'")).toBe(
        "span_kind!='3'",
      );
    });

    it("should replace multiple span_kind tokens in a compound clause", () => {
      expect(
        parseSpanKindWhereClause(
          "(span_kind='SERVER' or span_kind='internal')",
        ),
      ).toBe("(span_kind='2' or span_kind='1')");
    });

    it("should leave an unknown label unchanged", () => {
      const clause = "span_kind='Unknown'";
      expect(parseSpanKindWhereClause(clause)).toBe(clause);
    });

    it("should return a clause without span_kind unchanged", () => {
      const clause = "duration > 500ms";
      expect(parseSpanKindWhereClause(clause)).toBe(clause);
    });

    it("should handle spaces around the = operator", () => {
      expect(parseSpanKindWhereClause("span_kind = 'Consumer'")).toBe(
        "span_kind='5'",
      );
    });

    it("should handle spaces around the != operator", () => {
      expect(parseSpanKindWhereClause("span_kind != 'Producer'")).toBe(
        "span_kind!='4'",
      );
    });

    it("should replace span_kind='Unspecified' with '0'", () => {
      expect(parseSpanKindWhereClause("span_kind='Unspecified'")).toBe(
        "span_kind='0'",
      );
    });

    it("should return an empty string unchanged", () => {
      expect(parseSpanKindWhereClause("")).toBe("");
    });

    it("should handle a mixed clause with both span_kind and unrelated conditions", () => {
      const input = "service='api' and span_kind='Client' and duration > 100";
      const output = parseSpanKindWhereClause(input);
      expect(output).toBe("service='api' and span_kind='3' and duration > 100");
    });

    describe("with SQL parser", () => {
      let parser: any;

      beforeAll(async () => {
        const mod = await import("@openobserve/node-sql-parser/build/datafusionsql");
        parser = new mod.default.Parser();
      });

      it("should replace span_kind='Server' with the numeric key using AST path", () => {
        const result = parseSpanKindWhereClause("span_kind='Server'", parser);
        // sqlify adds spaces around the operator
        expect(result).toBe("span_kind = '2'");
      });

      it("should replace label case-insensitively when parser is provided", () => {
        const result = parseSpanKindWhereClause("span_kind='server'", parser);
        expect(result).toBe("span_kind = '2'");
      });

      it("should preserve the != operator and replace the label with the numeric key", () => {
        const result = parseSpanKindWhereClause("span_kind!='Client'", parser);
        expect(result).toBe("span_kind != '3'");
      });

      it("should replace both sides of a compound OR clause", () => {
        const result = parseSpanKindWhereClause(
          "(span_kind='SERVER' OR span_kind='internal')",
          parser,
        );
        expect(result).toBe("(span_kind = '2' OR span_kind = '1')");
      });

      it("should leave an unknown label value unchanged", () => {
        const result = parseSpanKindWhereClause("span_kind='Unknown'", parser);
        // sqlify normalises spacing but preserves the unrecognised value
        expect(result).toBe("span_kind = 'Unknown'");
      });

      it("should return an empty string unchanged", () => {
        const result = parseSpanKindWhereClause("", parser);
        expect(result).toBe("");
      });

      it("should return the original whereClause when the parser throws on malformed SQL", () => {
        const badClause = "span_kind='";
        const result = parseSpanKindWhereClause(badClause, parser);
        expect(result).toBe(badClause);
      });

      it("should replace all labels in an IN clause with their numeric keys", () => {
        const result = parseSpanKindWhereClause(
          "span_kind IN ('Server', 'Client')",
          parser,
        );
        expect(result).toBe("span_kind IN ('2', '3')");
      });
    });
  });
});
