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

import { describe, it, expect, beforeEach } from "vitest";
import { vrlLanguageDefinition, vrlThemeDefinition } from "./vrlLanguageDefinition";
import store from "../../test/unit/helpers/store";

describe("vrlLanguageDefinition.ts", () => {
  beforeEach(() => {
    // Reset store state if needed for tests
    store.state.theme = "dark";
  });

  describe("vrlLanguageDefinition - Basic Structure", () => {
    it("should be defined and be an object", () => {
      expect(vrlLanguageDefinition).toBeDefined();
      expect(typeof vrlLanguageDefinition).toBe("object");
    });

    it("should have correct defaultToken", () => {
      expect(vrlLanguageDefinition.defaultToken).toBe("invalid");
    });

    it("should have correct ignoreCase setting", () => {
      expect(vrlLanguageDefinition.ignoreCase).toBe(true);
    });

    it("should have correct tokenPostfix", () => {
      expect(vrlLanguageDefinition.tokenPostfix).toBe(".vrl");
    });

    it("should have all required top-level properties", () => {
      const requiredProps = [
        "defaultToken",
        "ignoreCase", 
        "tokenPostfix",
        "brackets",
        "regEx",
        "keywords",
        "symbols",
        "escapes",
        "tokenizer"
      ];
      
      requiredProps.forEach(prop => {
        expect(vrlLanguageDefinition).toHaveProperty(prop);
      });
    });
  });

  describe("vrlLanguageDefinition - Brackets", () => {
    it("should have brackets array defined", () => {
      expect(Array.isArray(vrlLanguageDefinition.brackets)).toBe(true);
    });

    it("should have exactly 3 bracket definitions", () => {
      expect(vrlLanguageDefinition.brackets).toHaveLength(3);
    });

    it("should have curly bracket definition", () => {
      const curlyBracket = vrlLanguageDefinition.brackets.find(
        (b: any) => b.open === "{" && b.close === "}"
      );
      expect(curlyBracket).toBeDefined();
      expect(curlyBracket.token).toBe("delimiter.curly");
    });

    it("should have square bracket definition", () => {
      const squareBracket = vrlLanguageDefinition.brackets.find(
        (b: any) => b.open === "[" && b.close === "]"
      );
      expect(squareBracket).toBeDefined();
      expect(squareBracket.token).toBe("delimiter.square");
    });

    it("should have parenthesis definition", () => {
      const parenthesis = vrlLanguageDefinition.brackets.find(
        (b: any) => b.open === "(" && b.close === ")"
      );
      expect(parenthesis).toBeDefined();
      expect(parenthesis.token).toBe("delimiter.parenthesis");
    });

    it("should have all bracket objects with required properties", () => {
      vrlLanguageDefinition.brackets.forEach((bracket: any) => {
        expect(bracket).toHaveProperty("open");
        expect(bracket).toHaveProperty("close");
        expect(bracket).toHaveProperty("token");
        expect(typeof bracket.open).toBe("string");
        expect(typeof bracket.close).toBe("string");
        expect(typeof bracket.token).toBe("string");
      });
    });
  });

  describe("vrlLanguageDefinition - Regular Expressions", () => {
    it("should have regEx defined as RegExp", () => {
      expect(vrlLanguageDefinition.regEx).toBeInstanceOf(RegExp);
    });

    it("should have correct regEx pattern", () => {
      const expectedPattern = /\/(?!\/\/)(?:[^\/\\]|\\.)*\/[igm]*/;
      expect(vrlLanguageDefinition.regEx.toString()).toBe(expectedPattern.toString());
    });

    it("should match valid regex patterns", () => {
      const testCases = ["/test/", "/test/g", "/test/ig", "/test/igm"];
      testCases.forEach(testCase => {
        expect(vrlLanguageDefinition.regEx.test(testCase)).toBe(true);
      });
    });

    it("should not match invalid regex patterns", () => {
      const testCases = ["test", "abc123"];
      testCases.forEach(testCase => {
        expect(vrlLanguageDefinition.regEx.test(testCase)).toBe(false);
      });
    });
  });

  describe("vrlLanguageDefinition - Keywords", () => {
    it("should have keywords array defined", () => {
      expect(Array.isArray(vrlLanguageDefinition.keywords)).toBe(true);
    });

    it("should have expected number of keywords", () => {
      expect(vrlLanguageDefinition.keywords.length).toBeGreaterThan(0);
    });

    it("should contain essential VRL keywords", () => {
      const expectedKeywords = [
        "abort", "as", "break", "continue", "else", "false", 
        "for", "if", "impl", "in", "let", "loop", "null", 
        "return", "self", "std", "then", "this", "true", 
        "type", "until", "use", "while"
      ];
      
      expectedKeywords.forEach(keyword => {
        expect(vrlLanguageDefinition.keywords).toContain(keyword);
      });
    });

    it("should have all keywords as strings", () => {
      vrlLanguageDefinition.keywords.forEach((keyword: any) => {
        expect(typeof keyword).toBe("string");
      });
    });

    it("should not have duplicate keywords", () => {
      const uniqueKeywords = [...new Set(vrlLanguageDefinition.keywords)];
      expect(uniqueKeywords.length).toBe(vrlLanguageDefinition.keywords.length);
    });

    it("should have keywords in expected format", () => {
      vrlLanguageDefinition.keywords.forEach((keyword: any) => {
        expect(keyword).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
      });
    });
  });

  describe("vrlLanguageDefinition - Symbols and Escapes", () => {
    it("should have symbols regex defined", () => {
      expect(vrlLanguageDefinition.symbols).toBeInstanceOf(RegExp);
    });

    it("should have correct symbols pattern", () => {
      const expectedSymbols = /[=><!~?&%|+\-*\/\^\.,\:]+/;
      expect(vrlLanguageDefinition.symbols.toString()).toBe(expectedSymbols.toString());
    });

    it("should have escapes regex defined", () => {
      expect(vrlLanguageDefinition.escapes).toBeInstanceOf(RegExp);
    });

    it("should match valid escape sequences", () => {
      const testCases = ["\\n", "\\t", "\\r", "\\\"", "\\'", "\\x1A", "\\u1234"];
      testCases.forEach(testCase => {
        expect(vrlLanguageDefinition.escapes.test(testCase)).toBe(true);
      });
    });

    it("should match symbol patterns", () => {
      const testCases = ["=>", "!=", "<=", ">=", "&&", "||", "++", "--"];
      testCases.forEach(testCase => {
        expect(vrlLanguageDefinition.symbols.test(testCase)).toBe(true);
      });
    });
  });

  describe("vrlLanguageDefinition - Tokenizer Structure", () => {
    it("should have tokenizer object defined", () => {
      expect(typeof vrlLanguageDefinition.tokenizer).toBe("object");
      expect(vrlLanguageDefinition.tokenizer).not.toBeNull();
    });

    it("should have all required tokenizer states", () => {
      const requiredStates = [
        "root", "string", "herestring", "comment", "hereregexp", "function_arg"
      ];
      
      requiredStates.forEach(state => {
        expect(vrlLanguageDefinition.tokenizer).toHaveProperty(state);
        expect(Array.isArray(vrlLanguageDefinition.tokenizer[state])).toBe(true);
      });
    });

    it("should have non-empty rule arrays for all states", () => {
      const states = ["root", "string", "herestring", "comment", "hereregexp", "function_arg"];
      
      states.forEach(state => {
        expect(vrlLanguageDefinition.tokenizer[state].length).toBeGreaterThan(0);
      });
    });
  });

  describe("vrlLanguageDefinition - Root Tokenizer Rules", () => {
    it("should have function invoke rules", () => {
      const rootRules = vrlLanguageDefinition.tokenizer.root;
      const functionInvokeRule = rootRules.find((rule: any) => 
        rule[0] instanceof RegExp && rule[0].toString().includes("([a-zA-Z_!]+)(\\!)(\\()")
      );
      expect(functionInvokeRule).toBeDefined();
    });

    it("should have string literal rules", () => {
      const rootRules = vrlLanguageDefinition.tokenizer.root;
      const stringRules = rootRules.filter((rule: any) => 
        typeof rule[1] === "object" && rule[1].token === "string"
      );
      expect(stringRules.length).toBeGreaterThan(0);
    });

    it("should have comment rules", () => {
      const rootRules = vrlLanguageDefinition.tokenizer.root;
      const commentRule = rootRules.find((rule: any) => 
        rule[0] instanceof RegExp && rule[0].toString().includes("###")
      );
      expect(commentRule).toBeDefined();
    });

    it("should have number matching rules", () => {
      const rootRules = vrlLanguageDefinition.tokenizer.root;
      const numberRules = rootRules.filter((rule: any) => 
        typeof rule[1] === "string" && rule[1].startsWith("number")
      );
      expect(numberRules.length).toBeGreaterThan(0);
    });

    it("should have field access rules", () => {
      const rootRules = vrlLanguageDefinition.tokenizer.root;
      const fieldAccessRule = rootRules.find((rule: any) => 
        rule[0] instanceof RegExp && rule[0].toString().includes("(\\.[^\\ \\=]+)")
      );
      expect(fieldAccessRule).toBeDefined();
    });
  });

  describe("vrlLanguageDefinition - String Tokenizer Rules", () => {
    it("should have string content rule", () => {
      const stringRules = vrlLanguageDefinition.tokenizer.string;
      const contentRule = stringRules.find((rule: any) => 
        rule[0] instanceof RegExp && rule[1] === "string"
      );
      expect(contentRule).toBeDefined();
    });

    it("should have escape sequence rule", () => {
      const stringRules = vrlLanguageDefinition.tokenizer.string;
      const escapeRule = stringRules.find((rule: any) => 
        rule[0] instanceof RegExp && rule[0].source === "@escapes" && rule[1] === "string.escape"
      );
      expect(escapeRule).toBeDefined();
    });

    it("should have string interpolation rule", () => {
      const stringRules = vrlLanguageDefinition.tokenizer.string;
      const interpolationRule = stringRules.find((rule: any) => 
        rule[0] instanceof RegExp && rule[0].toString().includes("#{")
      );
      expect(interpolationRule).toBeDefined();
    });
  });

  describe("vrlLanguageDefinition - Comment Tokenizer Rules", () => {
    it("should have comment content rule", () => {
      const commentRules = vrlLanguageDefinition.tokenizer.comment;
      expect(commentRules).toBeDefined();
      expect(commentRules.length).toBeGreaterThan(0);
    });

    it("should have comment end rule", () => {
      const commentRules = vrlLanguageDefinition.tokenizer.comment;
      const endRule = commentRules.find((rule: any) => 
        rule[0] instanceof RegExp && rule[0].source === "###" && rule[2] === "@pop"
      );
      expect(endRule).toBeDefined();
    });
  });

  describe("vrlLanguageDefinition - Function Argument Tokenizer Rules", () => {
    it("should have function argument rules array", () => {
      const funcArgRules = vrlLanguageDefinition.tokenizer.function_arg;
      expect(Array.isArray(funcArgRules)).toBe(true);
      expect(funcArgRules.length).toBeGreaterThan(0);
    });

    it("should have nested function call rule", () => {
      const funcArgRules = vrlLanguageDefinition.tokenizer.function_arg;
      const nestedRule = funcArgRules.find((rule: any) => 
        rule[0] instanceof RegExp && rule[0].toString().includes("([a-zA-Z_!]+)\\(")
      );
      expect(nestedRule).toBeDefined();
    });

    it("should have function end rule", () => {
      const funcArgRules = vrlLanguageDefinition.tokenizer.function_arg;
      const endRule = funcArgRules.find((rule: any) => 
        rule[0] instanceof RegExp && rule[0].toString().includes("\\)")
      );
      expect(endRule).toBeDefined();
    });
  });

  describe("vrlThemeDefinition - Basic Structure", () => {
    it("should be defined and be an object", () => {
      expect(vrlThemeDefinition).toBeDefined();
      expect(typeof vrlThemeDefinition).toBe("object");
    });

    it("should have correct base theme", () => {
      expect(vrlThemeDefinition.base).toBe("vs");
    });

    it("should have inherit set to true", () => {
      expect(vrlThemeDefinition.inherit).toBe(true);
    });

    it("should have all required top-level properties", () => {
      const requiredProps = ["base", "inherit", "rules", "colors"];
      requiredProps.forEach(prop => {
        expect(vrlThemeDefinition).toHaveProperty(prop);
      });
    });
  });

  describe("vrlThemeDefinition - Theme Rules", () => {
    it("should have rules array defined", () => {
      expect(Array.isArray(vrlThemeDefinition.rules)).toBe(true);
    });

    it("should have multiple theme rules", () => {
      expect(vrlThemeDefinition.rules.length).toBeGreaterThan(10);
    });

    it("should have background rule", () => {
      const backgroundRule = vrlThemeDefinition.rules.find((rule: any) => 
        rule.token === "" && rule.background === "ffffff"
      );
      expect(backgroundRule).toBeDefined();
    });

    it("should have comment styling rules", () => {
      const commentRules = vrlThemeDefinition.rules.filter((rule: any) => 
        rule.token.includes("comment")
      );
      expect(commentRules.length).toBeGreaterThan(0);
    });

    it("should have keyword styling rules", () => {
      const keywordRule = vrlThemeDefinition.rules.find((rule: any) => 
        rule.token === "keyword"
      );
      expect(keywordRule).toBeDefined();
      expect(keywordRule.foreground).toBe("d73a49");
    });

    it("should have string styling rules", () => {
      const stringRule = vrlThemeDefinition.rules.find((rule: any) => 
        rule.token === "string"
      );
      expect(stringRule).toBeDefined();
      expect(stringRule.foreground).toBe("032f62");
    });

    it("should have entity styling rules", () => {
      const entityRule = vrlThemeDefinition.rules.find((rule: any) => 
        rule.token === "entity"
      );
      expect(entityRule).toBeDefined();
      expect(entityRule.foreground).toBe("6f42c1");
    });

    it("should have function invoke styling rules", () => {
      const functionRules = vrlThemeDefinition.rules.filter((rule: any) => 
        rule.token.includes("vrl-function-invokes")
      );
      expect(functionRules.length).toBeGreaterThan(0);
    });

    it("should have all rules with valid structure", () => {
      vrlThemeDefinition.rules.forEach((rule: any) => {
        expect(rule).toHaveProperty("token");
        expect(typeof rule.token).toBe("string");
        
        if (rule.foreground) {
          expect(typeof rule.foreground).toBe("string");
          expect(rule.foreground).toMatch(/^[0-9a-f]{6}$/i);
        }
        
        if (rule.background) {
          expect(typeof rule.background).toBe("string");
          expect(rule.background).toMatch(/^[0-9a-f]{6}$/i);
        }
      });
    });
  });

  describe("vrlThemeDefinition - Color Definitions", () => {
    it("should have colors object defined", () => {
      expect(typeof vrlThemeDefinition.colors).toBe("object");
      expect(vrlThemeDefinition.colors).not.toBeNull();
    });

    it("should have editor foreground color", () => {
      expect(vrlThemeDefinition.colors).toHaveProperty("editor.foreground");
      expect(vrlThemeDefinition.colors["editor.foreground"]).toBe("#24292e");
    });

    it("should have editor background color", () => {
      expect(vrlThemeDefinition.colors).toHaveProperty("editor.background");
      expect(vrlThemeDefinition.colors["editor.background"]).toBe("#ffffff");
    });

    it("should have selection colors", () => {
      expect(vrlThemeDefinition.colors).toHaveProperty("editor.selectionBackground");
      expect(vrlThemeDefinition.colors).toHaveProperty("editor.inactiveSelectionBackground");
    });

    it("should have cursor color", () => {
      expect(vrlThemeDefinition.colors).toHaveProperty("editorCursor.foreground");
      expect(vrlThemeDefinition.colors["editorCursor.foreground"]).toBe("#24292e");
    });

    it("should have whitespace color", () => {
      expect(vrlThemeDefinition.colors).toHaveProperty("editorWhitespace.foreground");
      expect(vrlThemeDefinition.colors["editorWhitespace.foreground"]).toBe("#959da5");
    });

    it("should have indent guide colors", () => {
      expect(vrlThemeDefinition.colors).toHaveProperty("editorIndentGuide.background");
      expect(vrlThemeDefinition.colors).toHaveProperty("editorIndentGuide.activeBackground");
    });

    it("should have all color values in valid hex format", () => {
      Object.values(vrlThemeDefinition.colors).forEach((color: any) => {
        expect(typeof color).toBe("string");
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });
  });

  describe("vrlLanguageDefinition - Advanced Tokenizer Features", () => {
    it("should handle regex patterns in different contexts", () => {
      const rootRules = vrlLanguageDefinition.tokenizer.root;
      const regexRules = rootRules.filter((rule: any) => 
        Array.isArray(rule) && rule.length >= 2 && 
        (rule[1] === "regexp" || (typeof rule[1] === "object" && rule[1].token === "regexp"))
      );
      expect(regexRules.length).toBeGreaterThan(0);
    });

    it("should have proper bracket handling", () => {
      const rootRules = vrlLanguageDefinition.tokenizer.root;
      const bracketRule = rootRules.find((rule: any) => 
        rule[0] instanceof RegExp && rule[0].toString().includes("{}()") && rule[1] === "@brackets"
      );
      expect(bracketRule).toBeDefined();
    });

    it("should have symbol delimiter handling", () => {
      const rootRules = vrlLanguageDefinition.tokenizer.root;
      const symbolRule = rootRules.find((rule: any) => 
        rule[0] instanceof RegExp && rule[0].source === "@symbols" && rule[1] === "delimiter"
      );
      expect(symbolRule).toBeDefined();
    });

    it("should handle different number formats", () => {
      const rootRules = vrlLanguageDefinition.tokenizer.root;
      const numberFormats = [
        "number.float", "number.hex", "number.octal", "number"
      ];
      
      numberFormats.forEach(format => {
        const rule = rootRules.find((rule: any) => rule[1] === format);
        expect(rule).toBeDefined();
      });
    });
  });

  describe("vrlLanguageDefinition - String Handling", () => {
    it("should handle r-strings (raw strings)", () => {
      const rootRules = vrlLanguageDefinition.tokenizer.root;
      const rstringRule = rootRules.find((rule: any) => 
        rule[0] instanceof RegExp && rule[0].toString().includes("r'[^']+")
      );
      expect(rstringRule).toBeDefined();
    });

    it("should handle s-strings", () => {
      const rootRules = vrlLanguageDefinition.tokenizer.root;
      const sstringRule = rootRules.find((rule: any) => 
        rule[0] instanceof RegExp && rule[0].toString().includes("s'[^']+")
      );
      expect(sstringRule).toBeDefined();
    });

    it("should handle timestamp strings", () => {
      const rootRules = vrlLanguageDefinition.tokenizer.root;
      const timestampRule = rootRules.find((rule: any) => 
        rule[0] instanceof RegExp && rule[0].toString().includes("t'[^']+")
      );
      expect(timestampRule).toBeDefined();
    });

    it("should handle multiline strings", () => {
      const rootRules = vrlLanguageDefinition.tokenizer.root;
      const multilineRules = rootRules.filter((rule: any) => 
        rule[0] instanceof RegExp && (rule[0].source === '"""' || rule[0].source === "'''") && rule[1] === "string"
      );
      expect(multilineRules.length).toBe(2);
    });
  });

  describe("vrlThemeDefinition - Markup and Special Tokens", () => {
    it("should have markup styling rules", () => {
      const markupRules = vrlThemeDefinition.rules.filter((rule: any) => 
        rule.token.startsWith("markup.")
      );
      expect(markupRules.length).toBeGreaterThan(5);
    });

    it("should have invalid token styling", () => {
      const invalidRules = vrlThemeDefinition.rules.filter((rule: any) => 
        rule.token.includes("invalid")
      );
      expect(invalidRules.length).toBeGreaterThan(0);
    });

    it("should have bracket highlighter rules", () => {
      const bracketRules = vrlThemeDefinition.rules.filter((rule: any) => 
        rule.token.includes("brackethighlighter")
      );
      expect(bracketRules.length).toBeGreaterThan(5);
    });

    it("should have support token styling", () => {
      const supportRules = vrlThemeDefinition.rules.filter((rule: any) => 
        rule.token.includes("support")
      );
      expect(supportRules.length).toBeGreaterThan(0);
    });
  });

  describe("vrlLanguageDefinition - Integration with Store", () => {
    it("should work with dark theme from store", () => {
      store.state.theme = "dark";
      expect(vrlLanguageDefinition).toBeDefined();
      expect(vrlThemeDefinition).toBeDefined();
    });

    it("should work with light theme from store", () => {
      store.state.theme = "light";
      expect(vrlLanguageDefinition).toBeDefined();
      expect(vrlThemeDefinition).toBeDefined();
    });

    it("should maintain structure regardless of store state", () => {
      const originalTheme = store.state.theme;
      
      store.state.theme = "custom";
      expect(vrlLanguageDefinition.keywords.length).toBeGreaterThan(0);
      expect(vrlThemeDefinition.rules.length).toBeGreaterThan(0);
      
      store.state.theme = originalTheme;
    });
  });

  describe("vrlLanguageDefinition - Edge Cases and Validation", () => {
    it("should handle empty patterns gracefully", () => {
      expect(() => {
        const regex = vrlLanguageDefinition.regEx;
        regex.test("");
      }).not.toThrow();
    });

    it("should have valid regex patterns in tokenizer", () => {
      const validateRegexInRules = (rules: any[]) => {
        rules.forEach(rule => {
          if (rule[0] instanceof RegExp) {
            expect(() => rule[0].test("")).not.toThrow();
          }
        });
      };

      validateRegexInRules(vrlLanguageDefinition.tokenizer.root);
      validateRegexInRules(vrlLanguageDefinition.tokenizer.string);
      validateRegexInRules(vrlLanguageDefinition.tokenizer.function_arg);
    });

    it("should have consistent color format in theme", () => {
      const hexColorRegex = /^#[0-9a-f]{6}$/i;
      Object.values(vrlThemeDefinition.colors).forEach(color => {
        expect(color).toMatch(hexColorRegex);
      });
    });

    it("should handle special characters in keywords", () => {
      vrlLanguageDefinition.keywords.forEach(keyword => {
        expect(typeof keyword).toBe("string");
        expect(keyword.length).toBeGreaterThan(0);
      });
    });

    it("should have proper tokenizer state transitions", () => {
      const hasValidTransitions = (rules: any[]) => {
        return rules.some(rule => {
          if (typeof rule[1] === "object" && rule[1].next) {
            return typeof rule[1].next === "string";
          }
          return true;
        });
      };

      expect(hasValidTransitions(vrlLanguageDefinition.tokenizer.root)).toBe(true);
      expect(hasValidTransitions(vrlLanguageDefinition.tokenizer.string)).toBe(true);
    });
  });
});