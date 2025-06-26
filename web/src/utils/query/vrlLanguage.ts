import { LanguageSupport, StreamLanguage } from '@codemirror/language'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

// VRL language definition using StreamLanguage
export const vrlLanguage = StreamLanguage.define({
  name: 'vrl',
  
  token(stream, state) {
    // Comments
    if (stream.match(/###[\s\S]*?###/)) return 'comment'
    if (stream.match(/#[^\n]*/)) return 'comment'
    
    // Strings
    if (stream.match(/r'[^']*'/)) return 'regexp'
    if (stream.match(/r"[^"]*"/)) return 'regexp'
    if (stream.match(/s'[^']*'/)) return 'string'
    if (stream.match(/s"[^"]*"/)) return 'string'
    if (stream.match(/t'[^']*'/)) return 'string'
    if (stream.match(/t"[^"]*"/)) return 'string'
    if (stream.match(/'[^']*'/)) return 'string'
    if (stream.match(/"[^"]*"/)) return 'string'
    
    // Regular expressions
    if (stream.match(/\/\/\/[^\/]*\/\/\/[igm]*/)) return 'regexp'
    if (stream.match(/\/[^\/]*\/[igm]*/)) return 'regexp'
    
    // Numbers
    if (stream.match(/0x[0-9a-fA-F]+/)) return 'number'
    if (stream.match(/0o[0-7]+/)) return 'number'
    if (stream.match(/\d+\.\d+([eE][+-]?\d+)?/)) return 'number'
    if (stream.match(/\d+[eE][+-]?\d+/)) return 'number'
    if (stream.match(/\d+/)) return 'number'
    
    // Keywords
    // if (stream.match(/(?<![a-zA-Z0-9_])(if|else|for|while|loop|break|continue|return|let|in|as|use|impl|type|abort|until|then|self|std)(?![a-zA-Z0-9_])/)) return 'keyword'
       // List of keywords
    const keywords = [
        "if", "else", "for", "while", "loop", "break", "continue", "return",
        "let", "in", "as", "use", "impl", "type", "abort", "until", "then", "self", "std"
    ];

    // In your tokenizer:
    if (stream.match(/[a-zA-Z_][\w]*/)) {
        const word = stream.current();
        if (keywords.includes(word)) return 'keyword';
        // ... (function check, etc.)
        return 'variableName';
    }

    // Literals
    if (stream.match(/\b(true|false|null)\b/)) return 'literal'
    
    // Special identifiers
    if (stream.match(/@[a-zA-Z_]\w*/)) return 'variableName'
    
    // Function calls (fallible)
    if (stream.match(/[a-zA-Z_!]+\!\(/)) return 'function'

    
    if (stream.match(/[a-zA-Z_!]+\(/)) return 'function'; 
    
    // Field access
    if (stream.match(/\.[a-zA-Z_]\w*/)) return 'propertyName'
    
    // Operators
    if (stream.match(/[=><!~?&%|+\-*\/\^\.,\:;()[\]{}]+/)) return 'operator'
    

    // // Identifiers and function names
    // if (stream.match(/[a-zA-Z_][\w]*/)) {
    //   const word = stream.current();
    //   if (vrlFunctions.includes(word)) return 'function';
    //   return 'variableName';
    // }
    
    if (stream.match(/\s+/)) return null; // whitespace

    
    // Advance stream
    stream.next()
    return null
  },
  
  languageData: {
    commentTokens: { line: '#' },
    closeBrackets: { brackets: ['(', '[', '{', '"', "'", 'r"', 's"', 't"', 'r\'', 's\'', 't\''] },
    indentOnInput: /^\s*[})\]]$/
  }
})

// VRL theme colors (matching the provided image)
export const vrlHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: '#4CAF50' }, // green
  { tag: t.keyword, color: '#0000ff' }, // purple
  { tag: t.number, color: '#4078f2' }, // blue
  { tag: t.bool, color: '#4078f2' }, // blue
  { tag: t.null, color: '#4078f2' }, // blue
  { tag: t.string, color: '#a31515' }, // red
  { tag: t.regexp, color: '#a31515' }, // red (for VRL regex strings)
  { tag: t.variableName, color: '#383a42' }, // black
  { tag: t.definition(t.variableName), color: '#0000ff' }, // black
  { tag: t.propertyName, color: '#383a42' }, // black
  { tag: t.operator, color: '#383a42' }, // black
  { tag: t.punctuation, color: '#383a42' }, // black
  { tag: t.function(t.propertyName), color: '#0000ff'}, // blue
  { tag: t.function(t.variableName), color: '#0000ff'}, // blue
], 
{
    themeType: "light"
})

// Language support for VRL
export function vrl() {
  return new LanguageSupport(vrlLanguage, [
    syntaxHighlighting(vrlHighlightStyle)
  ])
} 