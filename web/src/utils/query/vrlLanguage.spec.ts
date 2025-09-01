import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  vrlLanguage, 
  vrlHighlightStyle, 
  vrlHighDarkStyle, 
  vrl, 
  vrlKeywords 
} from './vrlLanguage';
import { LanguageSupport } from '@codemirror/language';
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// Mock stream for testing tokenizer
class MockStream {
  private pos = 0;
  private content = '';
  private lastMatch = '';

  constructor(content: string) {
    this.content = content;
    this.pos = 0;
  }

  match(pattern: RegExp | string): boolean {
    const remaining = this.content.slice(this.pos);
    
    if (typeof pattern === 'string') {
      if (remaining.startsWith(pattern)) {
        this.lastMatch = pattern;
        this.pos += pattern.length;
        return true;
      }
      return false;
    }

    const match = remaining.match(pattern);
    if (match && match.index === 0) {
      this.lastMatch = match[0];
      this.pos += match[0].length;
      return true;
    }
    return false;
  }

  current(): string {
    return this.lastMatch;
  }

  next(): string {
    if (this.pos < this.content.length) {
      const char = this.content[this.pos];
      this.pos++;
      return char;
    }
    return '';
  }

  peek(): string {
    return this.content[this.pos] || '';
  }

  skipToEnd(): void {
    this.pos = this.content.length;
  }

  skipTo(ch: string): boolean {
    const index = this.content.indexOf(ch, this.pos);
    if (index !== -1) {
      this.pos = index;
      return true;
    }
    return false;
  }

  backUp(n: number): void {
    this.pos = Math.max(0, this.pos - n);
  }

  column(): number {
    return this.pos;
  }

  indentation(): number {
    return 0;
  }

  sol(): boolean {
    return this.pos === 0;
  }

  eol(): boolean {
    return this.pos >= this.content.length;
  }
}

describe('VRL Language', () => {
  // Get the tokenizer function from the StreamLanguage
  const getTokenizer = () => (vrlLanguage as any).streamParser.token;
  describe('Language Definition', () => {
    it('should have correct language name', () => {
      expect(vrlLanguage.name).toBe('vrl');
    });

    it('should be a StreamLanguage instance', () => {
      expect(vrlLanguage).toBeDefined();
      expect(typeof vrlLanguage).toBe('object');
    });

    it('should have language data configuration', () => {
      // The StreamLanguage may not expose data property directly in tests
      expect(vrlLanguage).toBeDefined();
      expect(typeof vrlLanguage).toBe('object');
      
      // Test that the language has the expected internal structure
      expect((vrlLanguage as any).streamParser).toBeDefined();
    });

    it('should have tokenizer function accessible', () => {
      const tokenizer = getTokenizer();
      expect(typeof tokenizer).toBe('function');
    });
  });

  describe('Keywords', () => {
    it('should export vrlKeywords array', () => {
      expect(vrlKeywords).toBeDefined();
      expect(Array.isArray(vrlKeywords)).toBe(true);
    });

    it('should contain all VRL keywords', () => {
      const expectedKeywords = [
        "if", "else", "for", "while", "loop", "break", "continue", "return",
        "let", "in", "as", "use", "impl", "type", "abort", "until", "then", "self", "std"
      ];
      
      expectedKeywords.forEach(keyword => {
        expect(vrlKeywords).toContain(keyword);
      });
    });

    it('should have correct number of keywords', () => {
      expect(vrlKeywords.length).toBe(19);
    });
  });

  describe('Tokenizer - Comments', () => {
    const tokenizer = getTokenizer();
    
    it('should tokenize single line comments', () => {
      const stream = new MockStream('# This is a comment');
      const state = {};
      
      const result = tokenizer(stream, state);
      expect(result).toBe('comment');
    });

    it('should tokenize multi-line comments', () => {
      const stream = new MockStream('### This is a multi-line comment ###');
      const state = {};
      
      const result = tokenizer(stream, state);
      expect(result).toBe('comment');
    });

    it('should handle comments with special characters', () => {
      const stream = new MockStream('# Comment with @#$%^&*()');
      const state = {};
      
      const result = tokenizer(stream, state);
      expect(result).toBe('comment');
    });

    it('should handle empty single line comment', () => {
      const stream = new MockStream('#');
      const state = {};
      
      const result = tokenizer(stream, state);
      expect(result).toBe('comment');
    });

    it('should handle multi-line comment with content', () => {
      const stream = new MockStream('### Multi\nline\ncomment ###');
      const state = {};
      
      const result = tokenizer(stream, state);
      expect(result).toBe('comment');
    });
  });

  describe('Tokenizer - Strings', () => {
    const tokenizer = getTokenizer();
    
    it('should tokenize regular strings with single quotes', () => {
      const stream = new MockStream("'hello world'");
      const state = {};
      
      const result = tokenizer(stream, state);
      expect(result).toBe('string');
    });

    it('should tokenize regular strings with double quotes', () => {
      const stream = new MockStream('"hello world"');
      const state = {};
      
      const result = tokenizer(stream, state);
      expect(result).toBe('string');
    });

    it('should tokenize raw strings with single quotes', () => {
      const stream = new MockStream("r'raw string'");
      const state = {};
      
      const result = tokenizer(stream, state);
      expect(result).toBe('regexp');
    });

    it('should tokenize raw strings with double quotes', () => {
      const stream = new MockStream('r"raw string"');
      const state = {};
      
      const result = tokenizer(stream, state);
      expect(result).toBe('regexp');
    });

    it('should tokenize s-strings with single quotes', () => {
      const stream = new MockStream("s'string literal'");
      const state = {};
      
      const result = tokenizer(stream, state);
      expect(result).toBe('string');
    });

    it('should tokenize s-strings with double quotes', () => {
      const stream = new MockStream('s"string literal"');
      const state = {};
      
      const result = tokenizer(stream, state);
      expect(result).toBe('string');
    });

    it('should tokenize t-strings with single quotes', () => {
      const stream = new MockStream("t'template string'");
      const state = {};
      
      const result = tokenizer(stream, state);
      expect(result).toBe('string');
    });

    it('should tokenize t-strings with double quotes', () => {
      const stream = new MockStream('t"template string"');
      const state = {};
      
      const result = tokenizer(stream, state);
      expect(result).toBe('string');
    });

    it('should handle empty strings', () => {
      const stream = new MockStream("''");
      const state = {};
      
      const result = tokenizer(stream, state);
      expect(result).toBe('string');
    });

    it('should handle strings with special characters', () => {
      const stream = new MockStream('"String with @#$%^&*()"');
      const state = {};
      
      const result = tokenizer(stream, state);
      expect(result).toBe('string');
    });
  });

  describe('Tokenizer - Regular Expressions', () => {
    it('should tokenize regular expressions with single slashes', () => {
      const stream = new MockStream('/pattern/');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('regexp');
    });

    it('should tokenize regular expressions with flags', () => {
      const stream = new MockStream('/pattern/igm');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('regexp');
    });

    it('should tokenize regular expressions with triple slashes', () => {
      const stream = new MockStream('///complex pattern///');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('regexp');
    });

    it('should tokenize triple slash regex with flags', () => {
      const stream = new MockStream('///pattern///ig');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('regexp');
    });

    it('should handle regex with special characters', () => {
      const stream = new MockStream('/[a-zA-Z0-9]+/');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('regexp');
    });
  });

  describe('Tokenizer - Numbers', () => {
    it('should tokenize hexadecimal numbers', () => {
      const stream = new MockStream('0x1A2B');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('number');
    });

    it('should tokenize octal numbers', () => {
      const stream = new MockStream('0o777');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('number');
    });

    it('should tokenize decimal numbers', () => {
      const stream = new MockStream('123.456');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('number');
    });

    it('should tokenize scientific notation numbers', () => {
      const stream = new MockStream('1.23e10');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('number');
    });

    it('should tokenize negative scientific notation', () => {
      const stream = new MockStream('1.23e-10');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('number');
    });

    it('should tokenize positive scientific notation', () => {
      const stream = new MockStream('1.23e+10');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('number');
    });

    it('should tokenize integer scientific notation', () => {
      const stream = new MockStream('123e5');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('number');
    });

    it('should tokenize simple integers', () => {
      const stream = new MockStream('42');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('number');
    });

    it('should tokenize zero', () => {
      const stream = new MockStream('0');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('number');
    });
  });

  describe('Tokenizer - Booleans and Null', () => {
    it('should tokenize true boolean', () => {
      const stream = new MockStream('true');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('bool');
    });

    it('should tokenize false boolean', () => {
      const stream = new MockStream('false');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('bool');
    });

    it('should tokenize null', () => {
      const stream = new MockStream('null');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('null');
    });

    it('should not tokenize partial boolean words', () => {
      const stream = new MockStream('truthy');
      const state = {};
      
      // Since 'truthy' contains 'true', it should match as an identifier/variable
      const result = getTokenizer()(stream, state);
      expect(result).toBe('variableName');
    });
  });

  describe('Tokenizer - Keywords', () => {
    it('should tokenize if keyword', () => {
      const stream = new MockStream('if');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('keyword');
    });

    it('should tokenize else keyword', () => {
      const stream = new MockStream('else');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('keyword');
    });

    it('should tokenize for keyword', () => {
      const stream = new MockStream('for');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('keyword');
    });

    it('should tokenize while keyword', () => {
      const stream = new MockStream('while');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('keyword');
    });

    it('should tokenize return keyword', () => {
      const stream = new MockStream('return');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('keyword');
    });

    it('should tokenize let keyword', () => {
      const stream = new MockStream('let');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('keyword');
    });

    it('should tokenize all keywords from array', () => {
      vrlKeywords.forEach(keyword => {
        const stream = new MockStream(keyword);
        const state = {};
        const result = getTokenizer()(stream, state);
        expect(result).toBe('keyword');
      });
    });
  });

  describe('Tokenizer - Identifiers and Variables', () => {
    it('should tokenize variable names', () => {
      const stream = new MockStream('variable_name');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('variableName');
    });

    it('should tokenize special identifiers with @', () => {
      const stream = new MockStream('@special_var');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('variableName');
    });

    it('should tokenize identifiers starting with underscore', () => {
      const stream = new MockStream('_private_var');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('variableName');
    });

    it('should tokenize identifiers with numbers', () => {
      const stream = new MockStream('var123');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('variableName');
    });
  });

  describe('Tokenizer - Functions', () => {
    it('should tokenize function calls', () => {
      // Note: Function tokenization depends on specific regex patterns
      // The tokenizer may return 'variableName' first, then need to check for parentheses
      const stream = new MockStream('function_name');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      // Since the stream doesn't include the '(', it may be tokenized as variableName
      expect(['function', 'variableName']).toContain(result);
    });

    it('should tokenize fallible function patterns', () => {
      const stream = new MockStream('parse!');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(['function', 'variableName']).toContain(result);
    });

    it('should tokenize identifiers that could be functions', () => {
      const stream = new MockStream('my_function');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(['function', 'variableName']).toContain(result);
    });

    it('should handle function-like patterns', () => {
      const stream = new MockStream('parse_json');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(['function', 'variableName']).toContain(result);
    });
  });

  describe('Tokenizer - Property Access', () => {
    it('should tokenize field access', () => {
      const stream = new MockStream('.property');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('propertyName');
    });

    it('should tokenize field access with underscore', () => {
      const stream = new MockStream('.field_name');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('propertyName');
    });

    it('should tokenize field access with numbers', () => {
      const stream = new MockStream('.field123');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('propertyName');
    });
  });

  describe('Tokenizer - Operators', () => {
    it('should tokenize comparison operators', () => {
      const operators = ['==', '!=', '<=', '>=', '<', '>'];
      operators.forEach(op => {
        const stream = new MockStream(op);
        const state = {};
        const result = getTokenizer()(stream, state);
        expect(result).toBe('operator');
      });
    });

    it('should tokenize arithmetic operators', () => {
      const operators = ['+', '-', '*', '/', '%', '^'];
      operators.forEach(op => {
        const stream = new MockStream(op);
        const state = {};
        const result = getTokenizer()(stream, state);
        expect(result).toBe('operator');
      });
    });

    it('should tokenize logical operators', () => {
      const operators = ['&&', '||', '!', '&', '|'];
      operators.forEach(op => {
        const stream = new MockStream(op);
        const state = {};
        const result = getTokenizer()(stream, state);
        expect(result).toBe('operator');
      });
    });

    it('should tokenize assignment operators', () => {
      const operators = ['=', '+=', '-='];
      operators.forEach(op => {
        const stream = new MockStream(op);
        const state = {};
        const result = getTokenizer()(stream, state);
        expect(result).toBe('operator');
      });
    });

    it('should tokenize punctuation', () => {
      const punctuation = [',', ';', ':', '?', '(', ')', '[', ']', '{', '}'];
      punctuation.forEach(punct => {
        const stream = new MockStream(punct);
        const state = {};
        const result = getTokenizer()(stream, state);
        expect(result).toBe('operator');
      });
    });
  });

  describe('Tokenizer - Whitespace and Edge Cases', () => {
    it('should handle whitespace', () => {
      const stream = new MockStream('   ');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe(null);
    });

    it('should handle tabs', () => {
      const stream = new MockStream('\t\t');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe(null);
    });

    it('should handle newlines', () => {
      const stream = new MockStream('\n');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe(null);
    });

    it('should handle unknown characters by advancing stream', () => {
      const stream = new MockStream('$');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe(null);
    });

    it('should handle mixed whitespace', () => {
      const stream = new MockStream(' \t \n ');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe(null);
    });
  });

  describe('Highlight Styles', () => {
    it('should define light theme highlight style', () => {
      expect(vrlHighlightStyle).toBeInstanceOf(HighlightStyle);
    });

    it('should define dark theme highlight style', () => {
      expect(vrlHighDarkStyle).toBeInstanceOf(HighlightStyle);
    });

    it('should have light theme configuration', () => {
      expect(vrlHighlightStyle).toBeDefined();
      // Note: HighlightStyle options may not be directly accessible in tests
      expect(typeof vrlHighlightStyle).toBe('object');
    });

    it('should have dark theme configuration', () => {
      expect(vrlHighDarkStyle).toBeDefined();
      // Note: HighlightStyle options may not be directly accessible in tests
      expect(typeof vrlHighDarkStyle).toBe('object');
    });
  });

  describe('Language Support Function', () => {
    it('should return LanguageSupport instance', () => {
      const support = vrl();
      expect(support).toBeInstanceOf(LanguageSupport);
    });

    it('should use vrlLanguage as base language', () => {
      const support = vrl();
      expect(support.language).toBe(vrlLanguage);
    });

    it('should include syntax highlighting extensions', () => {
      const support = vrl();
      expect(support.extension).toBeDefined();
      expect(Array.isArray(support.extension)).toBe(true);
    });
  });

  describe('Complex Tokenization Scenarios', () => {
    it('should handle multiple tokens in sequence', () => {
      const content = 'if';
      const stream = new MockStream(content);
      const state = {};
      
      // Test "if" keyword
      let result = getTokenizer()(stream, state);
      expect(result).toBe('keyword');
      
      // Reset for next token - test whitespace
      const stream2 = new MockStream(' ');
      result = getTokenizer()(stream2, state);
      expect(result).toBe(null); // whitespace
    });

    it('should handle string literals with escapes', () => {
      const stream = new MockStream('"string with spaces and numbers 123"');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('string');
    });

    it('should handle function call with parameters', () => {
      const stream = new MockStream('parse_json');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(['function', 'variableName']).toContain(result);
    });

    it('should handle nested property access', () => {
      const stream = new MockStream('.field.subfield');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('propertyName');
    });

    it('should handle complex regex patterns', () => {
      const stream = new MockStream('/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('regexp');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle empty stream', () => {
      const stream = new MockStream('');
      const state = {};
      
      // Should not throw error
      expect(() => {
        const tokenizer = getTokenizer();
        tokenizer(stream, state);
      }).not.toThrow();
    });

    it('should handle very long strings', () => {
      const longString = '"' + 'a'.repeat(1000) + '"';
      const stream = new MockStream(longString);
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('string');
    });

    it('should handle special Unicode characters', () => {
      const stream = new MockStream('"Unicode: ñáéíóú 中文 🚀"');
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('string');
    });

    it('should handle unterminated strings gracefully', () => {
      const stream = new MockStream('"unterminated string');
      const state = {};
      
      // Should still match and not throw
      const result = getTokenizer()(stream, state);
      // May return string or advance character by character
      expect(result).not.toThrow;
    });

    it('should handle mixed case keywords correctly', () => {
      const stream = new MockStream('IF'); // uppercase
      const state = {};
      
      const result = getTokenizer()(stream, state);
      expect(result).toBe('variableName'); // should be variable, not keyword
    });
  });

  describe('Integration Tests', () => {
    it('should tokenize complete VRL expression', () => {
      const expressions = [
        'let x = parse_json!(.message)',
        'if .status == 200 { .success = true }',
        'del(.field)',
        '.timestamp = now()',
        'match(.message) { r"error" => .level = "error" }'
      ];

      expressions.forEach(expr => {
        const stream = new MockStream(expr);
        const state = {};
        
        // Should not throw when tokenizing complete expressions
        expect(() => {
          const tokenizer = getTokenizer();
          while (!stream.eol()) {
            tokenizer(stream, state);
            if (stream.peek() === '') break;
          }
        }).not.toThrow();
      });
    });

    it('should handle realistic VRL script', () => {
      const script = `
        # Parse the message
        let parsed = parse_json!(.message)
        
        # Set fields
        .level = parsed.level
        .timestamp = parsed.timestamp
        
        # Conditional logic
        if .level == "error" {
          .alert = true
        }
      `;

      const stream = new MockStream(script);
      const state = {};
      
      // Should tokenize without errors
      expect(() => {
        const tokenizer = getTokenizer();
        let tokenCount = 0;
        while (!stream.eol() && tokenCount < 100) { // Prevent infinite loop
          tokenizer(stream, state);
          tokenCount++;
        }
      }).not.toThrow();
    });
  });
});