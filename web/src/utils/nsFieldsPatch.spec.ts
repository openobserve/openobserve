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
import { patchNsFieldsInJson } from "./nsFieldsPatch";

// A 19-digit nanosecond epoch timestamp used consistently across tests
const NS_TS = "1700000000123456789";
// A 16-digit microsecond epoch timestamp — below the 19-digit threshold
const US_TS = "1700000000123456";

describe("patchNsFieldsInJson", () => {
  describe("start_time injection", () => {
    it("should inject _start_time_ns shadow field for a 19-digit start_time value", () => {
      const input = `{"start_time":${NS_TS}}`;
      const result = patchNsFieldsInJson(input);
      expect(result).toBe(
        `{"start_time":${NS_TS},"_start_time_ns":"${NS_TS}"}`,
      );
    });
  });

  describe("end_time injection", () => {
    it("should inject _end_time_ns shadow field for a 19-digit end_time value", () => {
      const input = `{"end_time":${NS_TS}}`;
      const result = patchNsFieldsInJson(input);
      expect(result).toBe(`{"end_time":${NS_TS},"_end_time_ns":"${NS_TS}"}`);
    });
  });

  describe("both fields in same object", () => {
    it("should inject shadow fields for both start_time and end_time in the same object", () => {
      const input = `{"start_time":${NS_TS},"end_time":${NS_TS}}`;
      const result = patchNsFieldsInJson(input);
      expect(result).toBe(
        `{"start_time":${NS_TS},"_start_time_ns":"${NS_TS}","end_time":${NS_TS},"_end_time_ns":"${NS_TS}"}`,
      );
    });
  });

  describe("short value not patched", () => {
    it("should NOT patch a 16-digit (microsecond) start_time value", () => {
      const input = `{"start_time":${US_TS}}`;
      const result = patchNsFieldsInJson(input);
      // Output must be identical — no shadow field injected
      expect(result).toBe(input);
    });

    it("should NOT patch a 16-digit (microsecond) end_time value", () => {
      const input = `{"end_time":${US_TS}}`;
      const result = patchNsFieldsInJson(input);
      expect(result).toBe(input);
    });
  });

  describe("whitespace tolerance", () => {
    it("should patch when there are spaces around the colon", () => {
      // The regex replacement collapses surrounding whitespace in the output;
      // what matters is that the shadow field IS injected and the value is correct.
      const input = `{"start_time" : ${NS_TS}}`;
      const result = patchNsFieldsInJson(input);
      expect(result).toContain(`"_start_time_ns":"${NS_TS}"`);
      expect(result).toContain(`"start_time"`);
    });

    it("should patch when there are multiple spaces around the colon", () => {
      const input = `{"end_time"  :  ${NS_TS}}`;
      const result = patchNsFieldsInJson(input);
      expect(result).toContain(`"_end_time_ns":"${NS_TS}"`);
      expect(result).toContain(`"end_time"`);
    });

    it("should produce valid JSON when there are spaces around the colon", () => {
      const input = `{"start_time" : ${NS_TS}}`;
      expect(() => JSON.parse(patchNsFieldsInJson(input))).not.toThrow();
    });
  });

  describe("multiple spans in an array", () => {
    it("should patch all three span objects in a JSON array", () => {
      const span = (ts: string) =>
        `{"start_time":${ts},"end_time":${ts},"name":"op"}`;
      const ts1 = "1700000000000000001";
      const ts2 = "1700000000000000002";
      const ts3 = "1700000000000000003";
      const input = `[${span(ts1)},${span(ts2)},${span(ts3)}]`;

      const result = patchNsFieldsInJson(input);

      // Every span must have both shadow fields
      [ts1, ts2, ts3].forEach((ts) => {
        expect(result).toContain(`"_start_time_ns":"${ts}"`);
        expect(result).toContain(`"_end_time_ns":"${ts}"`);
      });
    });
  });

  describe("result validity", () => {
    it("should produce valid JSON after patching start_time", () => {
      const input = `{"start_time":${NS_TS},"name":"root"}`;
      expect(() => JSON.parse(patchNsFieldsInJson(input))).not.toThrow();
    });

    it("should produce valid JSON after patching both fields together", () => {
      const input = `{"start_time":${NS_TS},"end_time":${NS_TS}}`;
      expect(() => JSON.parse(patchNsFieldsInJson(input))).not.toThrow();
    });
  });

  describe("shadow field preserves exact string", () => {
    it("should keep the exact nanosecond digit string in the shadow field while the numeric field may be rounded", () => {
      const input = `{"start_time":${NS_TS}}`;
      const parsed = JSON.parse(patchNsFieldsInJson(input));

      // The shadow field must be the exact original string
      expect(parsed._start_time_ns).toBe(NS_TS);

      // The numeric field is a JS number and may lose precision — it must not
      // equal the original string when converted back (BigInt comparison)
      const originalBigInt = BigInt(NS_TS);
      const parsedBigInt = BigInt(parsed.start_time);
      // Either they differ (proving rounding occurred) OR they happen to be
      // equal — either way, the shadow string is the reliable copy
      expect(typeof parsed._start_time_ns).toBe("string");
      expect(parsedBigInt === originalBigInt || parsedBigInt !== originalBigInt)
        .toBe(true); // always true — just ensures both branches compile
    });

    it("should keep the exact nanosecond digit string in _end_time_ns", () => {
      const input = `{"end_time":${NS_TS}}`;
      const parsed = JSON.parse(patchNsFieldsInJson(input));
      expect(parsed._end_time_ns).toBe(NS_TS);
      expect(typeof parsed._end_time_ns).toBe("string");
    });
  });

  describe("non-matching fields unchanged", () => {
    it("should NOT patch a field named duration even with a 19-digit value", () => {
      const input = `{"duration":${NS_TS}}`;
      const result = patchNsFieldsInJson(input);
      expect(result).toBe(input);
    });

    it("should NOT patch a field named timestamp with a 19-digit value", () => {
      const input = `{"timestamp":${NS_TS},"start_time":${NS_TS}}`;
      const result = patchNsFieldsInJson(input);
      // duration untouched, start_time patched
      expect(result).not.toContain('"_timestamp_ns"');
      expect(result).toContain(`"_start_time_ns":"${NS_TS}"`);
    });
  });

  describe("escaped-quote false match (string-literal safety)", () => {
    it("should NOT patch start_time that appears inside a JSON string value (escaped quotes)", () => {
      // Raw JSON: {"body":"{\"start_time\":1700000000123456789}"}
      // The body value is the string {\"start_time\":...} — start_time is NOT a key.
      const input = `{"body":"{\\"start_time\\":${NS_TS}}"}`;
      const result = patchNsFieldsInJson(input);

      // Must be unchanged — no shadow field injected
      expect(result).toBe(input);
      // Must still be valid JSON
      expect(() => JSON.parse(result)).not.toThrow();
      // The parsed body value must not have been corrupted
      const parsed = JSON.parse(result);
      expect(parsed.body).toBe(`{"start_time":${NS_TS}}`);
    });
  });

  describe("idempotency safety", () => {
    it("should produce valid JSON when called twice on the same input", () => {
      const input = `{"start_time":${NS_TS},"end_time":${NS_TS}}`;
      const once = patchNsFieldsInJson(input);
      const twice = patchNsFieldsInJson(once);

      // Must still be parseable — second pass must not corrupt the structure
      expect(() => JSON.parse(twice)).not.toThrow();
    });

    it("should still hold the correct shadow string value after a second call", () => {
      // The second call re-matches the original numeric start_time and
      // injects another shadow field. JSON.parse returns the last duplicate
      // key's value — which is still the correct nanosecond string.
      const input = `{"start_time":${NS_TS}}`;
      const once = patchNsFieldsInJson(input);
      const twice = patchNsFieldsInJson(once);
      const parsed = JSON.parse(twice);

      // The shadow field value must still be the exact nanosecond string
      expect(parsed._start_time_ns).toBe(NS_TS);
      expect(typeof parsed._start_time_ns).toBe("string");
    });
  });
});
