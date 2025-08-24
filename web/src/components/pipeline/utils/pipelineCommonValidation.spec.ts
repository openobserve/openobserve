// Copyright 2023 OpenObserve Inc.
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
import { sanitizeStreamName, sanitizeStaticPart } from "./pipelineCommonValidation";

describe("pipelineCommonValidation", () => {

  describe("sanitizeStreamName", () => {
    describe("Basic functionality", () => {
      it("should sanitize simple alphanumeric string", () => {
        const result = sanitizeStreamName("test123");
        expect(result).toBe("test123");
      });

      it("should sanitize string with special characters", () => {
        const result = sanitizeStreamName("test@#$%");
        expect(result).toBe("test____");
      });

      it("should handle empty string", () => {
        const result = sanitizeStreamName("");
        expect(result).toBe("");
      });

      it("should handle single character", () => {
        const result = sanitizeStreamName("a");
        expect(result).toBe("a");
      });

      it("should handle single special character", () => {
        const result = sanitizeStreamName("@");
        expect(result).toBe("_");
      });
    });

    describe("Length validation", () => {
      it("should return empty string for input longer than 100 characters", () => {
        const longInput = "a".repeat(101);
        const result = sanitizeStreamName(longInput);
        expect(result).toBe("");
      });

      it("should handle input exactly 100 characters", () => {
        const input = "a".repeat(100);
        const result = sanitizeStreamName(input);
        expect(result).toBe("a".repeat(100));
      });

      it("should handle input with 99 characters", () => {
        const input = "a".repeat(99);
        const result = sanitizeStreamName(input);
        expect(result).toBe("a".repeat(99));
      });

      it("should return empty string for very long input with special characters", () => {
        const longInput = "test@#$%".repeat(20); // > 100 chars
        const result = sanitizeStreamName(longInput);
        expect(result).toBe("");
      });
    });

    describe("Dynamic parts handling", () => {
      it("should preserve single dynamic part", () => {
        const result = sanitizeStreamName("test{field}data");
        expect(result).toBe("test{field}data");
      });

      it("should preserve multiple dynamic parts", () => {
        const result = sanitizeStreamName("prefix{field1}middle{field2}suffix");
        expect(result).toBe("prefix{field1}middle{field2}suffix");
      });

      it("should preserve dynamic part at start", () => {
        const result = sanitizeStreamName("{field}suffix");
        expect(result).toBe("{field}suffix");
      });

      it("should preserve dynamic part at end", () => {
        const result = sanitizeStreamName("prefix{field}");
        expect(result).toBe("prefix{field}");
      });

      it("should handle only dynamic part", () => {
        const result = sanitizeStreamName("{field}");
        expect(result).toBe("{field}");
      });

      it("should handle consecutive dynamic parts", () => {
        const result = sanitizeStreamName("{field1}{field2}");
        expect(result).toBe("{field1}{field2}");
      });

      it("should sanitize static parts between dynamic parts", () => {
        const result = sanitizeStreamName("{field1}@#$%{field2}");
        expect(result).toBe("{field1}____{field2}");
      });
    });

    describe("Complex dynamic patterns", () => {
      it("should handle dynamic parts with special characters inside", () => {
        const result = sanitizeStreamName("test{field@#$%}data");
        expect(result).toBe("test{field@#$%}data");
      });

      it("should handle nested-looking brackets", () => {
        const result = sanitizeStreamName("test{field{nested}}data");
        // The regex only matches the first complete {content} pattern
        expect(result).toBe("test_field{nested}_data");
      });

      it("should handle dynamic parts with spaces", () => {
        const result = sanitizeStreamName("test{field name}data");
        expect(result).toBe("test{field name}data");
      });

      it("should handle dynamic parts with numbers", () => {
        const result = sanitizeStreamName("test{field123}data");
        expect(result).toBe("test{field123}data");
      });
    });

    describe("Mixed content scenarios", () => {
      it("should handle mix of alphanumeric, special chars, and dynamic parts", () => {
        const result = sanitizeStreamName("abc@#$%{field}xyz!@#");
        expect(result).toBe("abc____{field}xyz___");
      });

      it("should handle underscores in static parts", () => {
        const result = sanitizeStreamName("test_name{field}data_end");
        expect(result).toBe("test_name{field}data_end");
      });

      it("should handle numbers in static parts", () => {
        const result = sanitizeStreamName("test123{field}data456");
        expect(result).toBe("test123{field}data456");
      });

      it("should handle spaces in static parts", () => {
        const result = sanitizeStreamName("test name{field}data end");
        expect(result).toBe("test_name{field}data_end");
      });
    });

    describe("Edge cases", () => {
      it("should handle incomplete dynamic part at end", () => {
        const result = sanitizeStreamName("test{field");
        expect(result).toBe("test_field");
      });

      it("should handle incomplete dynamic part at start", () => {
        const result = sanitizeStreamName("field}test");
        expect(result).toBe("field_test");
      });

      it("should handle empty dynamic part", () => {
        const result = sanitizeStreamName("test{}data");
        // Empty {} gets treated as static part and braces become underscores
        expect(result).toBe("test__data");
      });

      it("should handle multiple empty dynamic parts", () => {
        const result = sanitizeStreamName("test{}middle{}end");
        // Empty {} gets treated as static parts and braces become underscores
        expect(result).toBe("test__middle__end");
      });

      it("should handle string with only special characters", () => {
        const result = sanitizeStreamName("@#$%^&*()");
        // Input has 9 characters: @#$%^&*()
        expect(result).toBe("_________");
      });
    });
  });

  describe("sanitizeStaticPart", () => {
    describe("Basic functionality", () => {
      it("should return array of characters for alphanumeric string", () => {
        const result = sanitizeStaticPart("abc123");
        expect(result).toEqual(["a", "b", "c", "1", "2", "3"]);
      });

      it("should convert special characters to underscores", () => {
        const result = sanitizeStaticPart("a@b#c");
        expect(result).toEqual(["a", "_", "b", "_", "c"]);
      });

      it("should handle empty string", () => {
        const result = sanitizeStaticPart("");
        expect(result).toEqual([]);
      });

      it("should handle single character", () => {
        const result = sanitizeStaticPart("a");
        expect(result).toEqual(["a"]);
      });

      it("should handle single special character", () => {
        const result = sanitizeStaticPart("@");
        expect(result).toEqual(["_"]);
      });
    });

    describe("Character type handling", () => {
      it("should preserve lowercase letters", () => {
        const result = sanitizeStaticPart("abcdefg");
        expect(result).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
      });

      it("should preserve uppercase letters", () => {
        const result = sanitizeStaticPart("ABCDEFG");
        expect(result).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
      });

      it("should preserve numbers", () => {
        const result = sanitizeStaticPart("0123456789");
        expect(result).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
      });

      it("should convert spaces to underscores", () => {
        const result = sanitizeStaticPart("a b c");
        expect(result).toEqual(["a", "_", "b", "_", "c"]);
      });

      it("should convert punctuation to underscores", () => {
        const result = sanitizeStaticPart("a.b,c;d:e");
        expect(result).toEqual(["a", "_", "b", "_", "c", "_", "d", "_", "e"]);
      });

      it("should convert symbols to underscores", () => {
        const result = sanitizeStaticPart("a@b#c$d%e");
        expect(result).toEqual(["a", "_", "b", "_", "c", "_", "d", "_", "e"]);
      });
    });

    describe("Mixed content", () => {
      it("should handle mixed alphanumeric and special characters", () => {
        const result = sanitizeStaticPart("Test@123#Data");
        expect(result).toEqual(["T", "e", "s", "t", "_", "1", "2", "3", "_", "D", "a", "t", "a"]);
      });

      it("should handle string with multiple consecutive special characters", () => {
        const result = sanitizeStaticPart("a@#$%b");
        expect(result).toEqual(["a", "_", "_", "_", "_", "b"]);
      });

      it("should handle string starting with special characters", () => {
        const result = sanitizeStaticPart("@#$abc");
        expect(result).toEqual(["_", "_", "_", "a", "b", "c"]);
      });

      it("should handle string ending with special characters", () => {
        const result = sanitizeStaticPart("abc@#$");
        expect(result).toEqual(["a", "b", "c", "_", "_", "_"]);
      });

      it("should handle string with only special characters", () => {
        const result = sanitizeStaticPart("@#$%^&*");
        expect(result).toEqual(["_", "_", "_", "_", "_", "_", "_"]);
      });
    });

    describe("Return type validation", () => {
      it("should return array type", () => {
        const result = sanitizeStaticPart("test");
        expect(Array.isArray(result)).toBe(true);
      });

      it("should return array with correct length", () => {
        const input = "test123";
        const result = sanitizeStaticPart(input);
        expect(result.length).toBe(input.length);
      });

      it("should return empty array for empty input", () => {
        const result = sanitizeStaticPart("");
        expect(result).toEqual([]);
        expect(result.length).toBe(0);
      });
    });
  });

  describe("Integration tests", () => {
    it("should work correctly when sanitizeStreamName uses sanitizeStaticPart internally", () => {
      const result = sanitizeStreamName("test@name");
      expect(result).toBe("test_name");
    });

    it("should preserve dynamic parts while sanitizing static parts", () => {
      const result = sanitizeStreamName("test@{field}#name");
      expect(result).toBe("test_{field}_name");
    });

    it("should handle complex integration scenario", () => {
      const result = sanitizeStreamName("app@logs#{timestamp}$data%stream");
      expect(result).toBe("app_logs_{timestamp}_data_stream");
    });
  });
});