// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, vi } from "vitest";

// Mock CodeMirror modules
vi.mock("@codemirror/language", () => ({
  LanguageSupport: class LanguageSupport {
    constructor(public language: any, public extension: any[]) {}
  },
  StreamLanguage: {
    define: (spec: any) => ({ ...spec }),
  },
  HighlightStyle: {
    define: (specs: any[], options?: any) => ({ extension: specs, options }),
  },
  syntaxHighlighting: (style: any) => style,
}));

vi.mock("@lezer/highlight", () => ({
  tags: {
    comment: "comment",
    keyword: "keyword",
    number: "number",
    bool: "bool",
    null: "null",
    string: "string",
    regexp: "regexp",
    variableName: "variableName",
    definition: (tag: any) => `definition-${tag}`,
    propertyName: "propertyName",
    operator: "operator",
    punctuation: "punctuation",
    function: (tag: any) => `function-${tag}`,
  },
}));

import {
  vrlKeywords,
  vrlLanguage,
  vrlHighlightStyle,
  vrlHighDarkStyle,
  vrl,
} from "@/utils/query/vrlLanguage";

describe("vrlLanguage.ts", () => {
  describe("vrlKeywords", () => {
    it("should export VRL keywords array", () => {
      expect(Array.isArray(vrlKeywords)).toBe(true);
      expect(vrlKeywords.length).toBeGreaterThan(0);
    });

    it("should contain essential VRL keywords", () => {
      const essentialKeywords = ["if", "else", "let", "return", "for", "while"];
      essentialKeywords.forEach((keyword) => {
        expect(vrlKeywords).toContain(keyword);
      });
    });

    it("should contain control flow keywords", () => {
      expect(vrlKeywords).toContain("break");
      expect(vrlKeywords).toContain("continue");
      expect(vrlKeywords).toContain("return");
      expect(vrlKeywords).toContain("abort");
    });

    it("should contain VRL-specific keywords", () => {
      expect(vrlKeywords).toContain("abort");
      expect(vrlKeywords).toContain("until");
      expect(vrlKeywords).toContain("then");
    });
  });

  describe("vrlLanguage", () => {
    it("should have correct language name", () => {
      expect(vrlLanguage.name).toBe("vrl");
    });

    it("should have languageData with comment tokens", () => {
      expect(vrlLanguage.languageData).toBeDefined();
      expect(vrlLanguage.languageData.commentTokens).toBeDefined();
      expect(vrlLanguage.languageData.commentTokens.line).toBe("#");
    });

    it("should have close brackets configuration", () => {
      expect(vrlLanguage.languageData.closeBrackets).toBeDefined();
      expect(vrlLanguage.languageData.closeBrackets.brackets).toContain("(");
      expect(vrlLanguage.languageData.closeBrackets.brackets).toContain("[");
      expect(vrlLanguage.languageData.closeBrackets.brackets).toContain("{");
      expect(vrlLanguage.languageData.closeBrackets.brackets).toContain('"');
      expect(vrlLanguage.languageData.closeBrackets.brackets).toContain("'");
    });

    it("should have indentOnInput pattern", () => {
      expect(vrlLanguage.languageData.indentOnInput).toBeDefined();
      expect(vrlLanguage.languageData.indentOnInput).toBeInstanceOf(RegExp);
    });

    it("should have token function", () => {
      expect(typeof vrlLanguage.token).toBe("function");
    });
  });

  describe("vrlLanguage tokenizer", () => {
    // Helper to create a mock stream for testing
    const createMockStream = (text: string) => {
      let pos = 0;
      return {
        string: text,
        pos,
        match(pattern: RegExp | string) {
          const match = typeof pattern === "string"
            ? text.substring(pos).startsWith(pattern) ? pattern : null
            : text.substring(pos).match(pattern);
          if (match) {
            const matchStr = typeof match === "string" ? match : match[0];
            pos += matchStr.length;
            this.pos = pos;
            return matchStr;
          }
          return null;
        },
        current() {
          return text.substring(0, pos);
        },
        next() {
          if (pos < text.length) {
            pos++;
            this.pos = pos;
            return text[pos - 1];
          }
          return undefined;
        },
      };
    };

    it("should tokenize single line comments", () => {
      const stream = createMockStream("# This is a comment");
      const token = vrlLanguage.token(stream, {});
      expect(token).toBe("comment");
    });

    it("should tokenize multi-line comments", () => {
      const stream = createMockStream("### Multi\nline\ncomment ###");
      const token = vrlLanguage.token(stream, {});
      expect(token).toBe("comment");
    });

    it("should tokenize regular strings", () => {
      const stream = createMockStream('"hello world"');
      const token = vrlLanguage.token(stream, {});
      expect(token).toBe("string");
    });

    it("should tokenize single-quoted strings", () => {
      const stream = createMockStream("'hello world'");
      const token = vrlLanguage.token(stream, {});
      expect(token).toBe("string");
    });

    it("should tokenize s-prefixed strings", () => {
      const stream = createMockStream('s"string"');
      const token = vrlLanguage.token(stream, {});
      expect(token).toBe("string");
    });

    it("should tokenize r-prefixed regex strings", () => {
      const stream = createMockStream('r"regex"');
      const token = vrlLanguage.token(stream, {});
      expect(token).toBe("regexp");
    });

    it("should tokenize decimal numbers", () => {
      const stream = createMockStream("123");
      const token = vrlLanguage.token(stream, {});
      expect(token).toBe("number");
    });

    it("should tokenize floating point numbers", () => {
      const stream = createMockStream("123.456");
      const token = vrlLanguage.token(stream, {});
      expect(token).toBe("number");
    });

    it("should tokenize hexadecimal numbers", () => {
      const stream = createMockStream("0x1A2B");
      const token = vrlLanguage.token(stream, {});
      expect(token).toBe("number");
    });

    it("should tokenize octal numbers", () => {
      const stream = createMockStream("0o755");
      const token = vrlLanguage.token(stream, {});
      expect(token).toBe("number");
    });

    it("should tokenize boolean true", () => {
      const stream = createMockStream("true");
      const token = vrlLanguage.token(stream, {});
      expect(token).toBe("bool");
    });

    it("should tokenize boolean false", () => {
      const stream = createMockStream("false");
      const token = vrlLanguage.token(stream, {});
      expect(token).toBe("bool");
    });

    it("should tokenize null", () => {
      const stream = createMockStream("null");
      const token = vrlLanguage.token(stream, {});
      expect(token).toBe("null");
    });

    it("should tokenize operators", () => {
      const stream = createMockStream("==");
      const token = vrlLanguage.token(stream, {});
      expect(token).toBe("operator");
    });
  });

  describe("vrlHighlightStyle", () => {
    it("should be defined", () => {
      expect(vrlHighlightStyle).toBeDefined();
    });

    it("should have extension property", () => {
      expect(vrlHighlightStyle.extension).toBeDefined();
    });
  });

  describe("vrlHighDarkStyle", () => {
    it("should be defined", () => {
      expect(vrlHighDarkStyle).toBeDefined();
    });

    it("should have extension property", () => {
      expect(vrlHighDarkStyle.extension).toBeDefined();
    });
  });

  describe("vrl() function", () => {
    it("should return LanguageSupport-like object", () => {
      const support = vrl();
      expect(support).toBeDefined();
      expect(support.language).toBeDefined();
      expect(support.extension).toBeDefined();
    });

    it("should return language support with correct language", () => {
      const support = vrl();
      expect(support.language).toBe(vrlLanguage);
    });

    it("should include syntax highlighting extensions", () => {
      const support = vrl();
      expect(support.extension).toBeDefined();
      expect(Array.isArray(support.extension)).toBe(true);
    });
  });

  describe("language integration", () => {
    it("should handle multiple tokens in sequence", () => {
      const createStream = (text: string) => {
        let pos = 0;
        return {
          string: text,
          pos,
          match(pattern: RegExp | string) {
            const match = typeof pattern === "string"
              ? text.substring(pos).startsWith(pattern) ? pattern : null
              : text.substring(pos).match(pattern);
            if (match) {
              const matchStr = typeof match === "string" ? match : match[0];
              pos += matchStr.length;
              this.pos = pos;
              return matchStr;
            }
            return null;
          },
          current() {
            return text.substring(0, pos);
          },
          next() {
            if (pos < text.length) {
              pos++;
              this.pos = pos;
              return text[pos - 1];
            }
            return undefined;
          },
        };
      };

      // Test comment followed by code
      const stream1 = createStream("# comment\nlet");
      const token1 = vrlLanguage.token(stream1, {});
      expect(token1).toBe("comment");
    });

    it("should preserve keyword list integrity", () => {
      const originalLength = vrlKeywords.length;
      vrl(); // Call the function
      expect(vrlKeywords.length).toBe(originalLength);
    });
  });
});
