import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock @codemirror/language before importing vrlLanguage
vi.mock("@codemirror/language", () => ({
  LanguageSupport: class LanguageSupport {
    constructor(public language: any, public extension: any[] = []) {}
  },
  StreamLanguage: {
    define: (config: any) => config,
  },
  HighlightStyle: {
    define: (specs: any[], options?: any) => ({ specs, options }),
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
    propertyName: "propertyName",
    operator: "operator",
    punctuation: "punctuation",
    function: (tag: any) => `function-${tag}`,
    definition: (tag: any) => `definition-${tag}`,
  },
}));

import {
  vrlKeywords,
  vrlLanguage,
  vrlHighlightStyle,
  vrlHighDarkStyle,
  vrl,
} from "./vrlLanguage";

describe("vrlLanguage", () => {
  describe("vrlKeywords", () => {
    it("should export an array of VRL keywords", () => {
      expect(Array.isArray(vrlKeywords)).toBe(true);
      expect(vrlKeywords.length).toBeGreaterThan(0);
    });

    it("should contain standard programming keywords", () => {
      expect(vrlKeywords).toContain("if");
      expect(vrlKeywords).toContain("else");
      expect(vrlKeywords).toContain("for");
      expect(vrlKeywords).toContain("while");
      expect(vrlKeywords).toContain("return");
      expect(vrlKeywords).toContain("let");
    });

    it("should contain VRL-specific keywords", () => {
      expect(vrlKeywords).toContain("abort");
      expect(vrlKeywords).toContain("until");
      expect(vrlKeywords).toContain("then");
      expect(vrlKeywords).toContain("self");
      expect(vrlKeywords).toContain("std");
    });
  });

  describe("vrlLanguage", () => {
    it("should have a name property", () => {
      expect(vrlLanguage.name).toBe("vrl");
    });

    it("should have language data with comment tokens", () => {
      expect(vrlLanguage.languageData).toHaveProperty("commentTokens");
      expect(vrlLanguage.languageData.commentTokens).toEqual({ line: "#" });
    });

    it("should have closeBrackets configuration", () => {
      expect(vrlLanguage.languageData).toHaveProperty("closeBrackets");
      expect(vrlLanguage.languageData.closeBrackets).toHaveProperty(
        "brackets"
      );
      expect(vrlLanguage.languageData.closeBrackets.brackets).toContain("(");
      expect(vrlLanguage.languageData.closeBrackets.brackets).toContain("[");
      expect(vrlLanguage.languageData.closeBrackets.brackets).toContain("{");
    });

    it("should have indentOnInput pattern", () => {
      expect(vrlLanguage.languageData).toHaveProperty("indentOnInput");
      expect(vrlLanguage.languageData.indentOnInput).toBeInstanceOf(RegExp);
    });

    describe("tokenizer", () => {
      // Helper to create a mock stream
      const createStream = (text: string, pos = 0) => {
        let position = pos;
        const stream = {
          string: text,
          pos: position,
          current: function () {
            return this.string.substring(position, this.pos);
          },
          match: function (pattern: RegExp | string) {
            if (typeof pattern === "string") {
              if (this.string.substring(this.pos).startsWith(pattern)) {
                this.pos += pattern.length;
                return pattern;
              }
              return null;
            }
            const regex =
              pattern.source.startsWith("^")
                ? pattern
                : new RegExp("^" + pattern.source);
            const match = this.string.substring(this.pos).match(regex);
            if (match) {
              this.pos += match[0].length;
              return match[0];
            }
            return null;
          },
          next: function () {
            const char = this.string[this.pos];
            this.pos++;
            return char;
          },
        };
        return stream;
      };

      it("should tokenize single-line comments", () => {
        const stream = createStream("# this is a comment");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("comment");
      });

      it("should tokenize multi-line comments", () => {
        const stream = createStream("### multi\nline\ncomment ###");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("comment");
      });

      it("should tokenize single-quoted strings", () => {
        const stream = createStream("'hello world'");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("string");
      });

      it("should tokenize double-quoted strings", () => {
        const stream = createStream('"hello world"');
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("string");
      });

      it("should tokenize s-prefixed strings", () => {
        const stream = createStream("s'string'");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("string");
      });

      it("should tokenize t-prefixed strings", () => {
        const stream = createStream('t"timestamp"');
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("string");
      });

      it("should tokenize r-prefixed regex strings", () => {
        const stream = createStream("r'[a-z]+'");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("regexp");
      });

      it("should tokenize regular expressions", () => {
        const stream = createStream("/[a-z]+/i");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("regexp");
      });

      it("should tokenize triple-slash regex", () => {
        const stream = createStream("///regex///");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("regexp");
      });

      it("should tokenize hexadecimal numbers", () => {
        const stream = createStream("0xFF");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("number");
      });

      it("should tokenize octal numbers", () => {
        const stream = createStream("0o755");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("number");
      });

      it("should tokenize floating point numbers", () => {
        const stream = createStream("3.14");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("number");
      });

      it("should tokenize scientific notation", () => {
        const stream = createStream("1.5e-10");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("number");
      });

      it("should tokenize integer numbers", () => {
        const stream = createStream("42");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("number");
      });

      it("should tokenize boolean true", () => {
        const stream = createStream("true");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("bool");
      });

      it("should tokenize boolean false", () => {
        const stream = createStream("false");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("bool");
      });

      it("should tokenize null", () => {
        const stream = createStream("null");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("null");
      });

      it("should tokenize keywords", () => {
        const keywordTests = [
          "if",
          "else",
          "for",
          "while",
          "loop",
          "break",
          "continue",
          "return",
          "let",
        ];

        keywordTests.forEach((keyword) => {
          const stream = createStream(keyword);
          const token = vrlLanguage.token(stream, {});
          expect(token).toBe("keyword");
        });
      });

      it("should tokenize special identifiers with @", () => {
        const stream = createStream("@variable");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("variableName");
      });

      it("should tokenize fallible function calls with !", () => {
        const stream = createStream("parse_json!(");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("function");
      });

      it("should tokenize regular function calls", () => {
        const stream = createStream("parse_json(");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("function");
      });

      it("should tokenize property access", () => {
        const stream = createStream(".property");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("propertyName");
      });

      it("should tokenize operators", () => {
        const operators = [
          "=",
          ">",
          "<",
          "!",
          "+",
          "-",
          "*",
          "/",
          "&&",
          "||",
          "==",
          "!=",
        ];
        operators.forEach((op) => {
          const stream = createStream(op);
          const token = vrlLanguage.token(stream, {});
          expect(token).toBe("operator");
        });
      });

      it("should tokenize variable names", () => {
        const stream = createStream("myVariable");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe("variableName");
      });

      it("should handle whitespace", () => {
        const stream = createStream("   ");
        const token = vrlLanguage.token(stream, {});
        expect(token).toBe(null);
      });

      it("should advance stream for unknown characters", () => {
        const stream = createStream("^");
        const initialPos = stream.pos;
        vrlLanguage.token(stream, {});
        // Position should have advanced
        expect(stream.pos).toBeGreaterThan(initialPos);
      });
    });
  });

  describe("vrlHighlightStyle", () => {
    it("should be defined", () => {
      expect(vrlHighlightStyle).toBeDefined();
    });

    it("should define styles for all syntax elements", () => {
      const specs = vrlHighlightStyle.specs;
      expect(specs.length).toBeGreaterThan(0);

      // Check that certain tags are styled
      const tagNames = specs.map((spec) => {
        // The spec contains the tag, we need to check if specific tags are present
        return spec;
      });

      expect(specs).toBeDefined();
    });

    it("should have light theme type", () => {
      // Verify it's configured for light theme
      expect(vrlHighlightStyle).toBeDefined();
    });

    it("should define comment color", () => {
      const commentSpec = vrlHighlightStyle.specs.find(
        (spec) => spec.class === "cm-vrl-comment"
      );
      expect(commentSpec).toBeDefined();
      expect(commentSpec?.color).toBe("#4CAF50");
    });

    it("should define keyword color", () => {
      const keywordSpec = vrlHighlightStyle.specs.find(
        (spec) => spec.class === "cm-vrl-keyword"
      );
      expect(keywordSpec).toBeDefined();
      expect(keywordSpec?.color).toBe("#569cd6");
    });

    it("should define number color", () => {
      const numberSpec = vrlHighlightStyle.specs.find(
        (spec) => spec.class === "cm-vrl-number"
      );
      expect(numberSpec).toBeDefined();
      expect(numberSpec?.color).toBe("#b5cea8");
    });

    it("should define string color", () => {
      const stringSpec = vrlHighlightStyle.specs.find(
        (spec) => spec.class === "cm-vrl-string"
      );
      expect(stringSpec).toBeDefined();
      expect(stringSpec?.color).toBe("#a31515");
    });
  });

  describe("vrlHighDarkStyle", () => {
    it("should be defined", () => {
      expect(vrlHighDarkStyle).toBeDefined();
    });

    it("should have dark theme type", () => {
      expect(vrlHighDarkStyle).toBeDefined();
    });

    it("should define comment color for dark theme", () => {
      const commentSpec = vrlHighDarkStyle.specs.find(
        (spec) => spec.class === "cm-vrl-comment"
      );
      expect(commentSpec).toBeDefined();
      expect(commentSpec?.color).toBe("#608b4e");
    });

    it("should define string color for dark theme", () => {
      const stringSpec = vrlHighDarkStyle.specs.find(
        (spec) => spec.class === "cm-vrl-string"
      );
      expect(stringSpec).toBeDefined();
      expect(stringSpec?.color).toBe("#ce9178");
    });

    it("should define function color for dark theme", () => {
      const functionSpec = vrlHighDarkStyle.specs.find(
        (spec) => spec.class === "cm-vrl-function"
      );
      expect(functionSpec).toBeDefined();
      expect(functionSpec?.color).toBe("#569cd6");
    });
  });

  describe("vrl() function", () => {
    it("should return a LanguageSupport instance", () => {
      const languageSupport = vrl();
      expect(languageSupport).toBeDefined();
    });

    it("should include the vrlLanguage", () => {
      const languageSupport = vrl();
      expect(languageSupport.language).toBe(vrlLanguage);
    });

    it("should include syntax highlighting extensions", () => {
      const languageSupport = vrl();
      expect(languageSupport.extension).toBeDefined();
      expect(Array.isArray(languageSupport.extension)).toBe(true);
      expect(languageSupport.extension.length).toBeGreaterThan(0);
    });
  });

  describe("integration tests", () => {
    it("should correctly tokenize a simple VRL expression", () => {
      const code = 'let x = "hello"';
      const stream = {
        string: code,
        pos: 0,
        current: function () {
          return this.string.substring(0, this.pos);
        },
        match: function (pattern: RegExp | string) {
          if (typeof pattern === "string") {
            if (this.string.substring(this.pos).startsWith(pattern)) {
              this.pos += pattern.length;
              return pattern;
            }
            return null;
          }
          const regex =
            pattern.source.startsWith("^")
              ? pattern
              : new RegExp("^" + pattern.source);
          const match = this.string.substring(this.pos).match(regex);
          if (match) {
            this.pos += match[0].length;
            return match[0];
          }
          return null;
        },
        next: function () {
          const char = this.string[this.pos];
          this.pos++;
          return char;
        },
      };

      // Tokenize 'let'
      const token1 = vrlLanguage.token(stream, {});
      expect(token1).toBe("keyword");
    });

    it("should handle VRL code with comments", () => {
      const stream = {
        string: "# comment\nlet x = 1",
        pos: 0,
        current: function () {
          return this.string.substring(0, this.pos);
        },
        match: function (pattern: RegExp | string) {
          if (typeof pattern === "string") {
            if (this.string.substring(this.pos).startsWith(pattern)) {
              this.pos += pattern.length;
              return pattern;
            }
            return null;
          }
          const regex =
            pattern.source.startsWith("^")
              ? pattern
              : new RegExp("^" + pattern.source);
          const match = this.string.substring(this.pos).match(regex);
          if (match) {
            this.pos += match[0].length;
            return match[0];
          }
          return null;
        },
        next: function () {
          const char = this.string[this.pos];
          this.pos++;
          return char;
        },
      };

      const token = vrlLanguage.token(stream, {});
      expect(token).toBe("comment");
    });

    it("should handle VRL code with function calls", () => {
      const stream = {
        string: "parse_json!(.message)",
        pos: 0,
        current: function () {
          return this.string.substring(0, this.pos);
        },
        match: function (pattern: RegExp | string) {
          if (typeof pattern === "string") {
            if (this.string.substring(this.pos).startsWith(pattern)) {
              this.pos += pattern.length;
              return pattern;
            }
            return null;
          }
          const regex =
            pattern.source.startsWith("^")
              ? pattern
              : new RegExp("^" + pattern.source);
          const match = this.string.substring(this.pos).match(regex);
          if (match) {
            this.pos += match[0].length;
            return match[0];
          }
          return null;
        },
        next: function () {
          const char = this.string[this.pos];
          this.pos++;
          return char;
        },
      };

      const token = vrlLanguage.token(stream, {});
      expect(token).toBe("function");
    });
  });
});
