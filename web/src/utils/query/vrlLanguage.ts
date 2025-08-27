import { LanguageSupport, StreamLanguage } from '@codemirror/language'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

// VRL keywords for testing and language definition
export const vrlKeywords = [
  "if", "else", "for", "while", "loop", "break", "continue", "return",
  "let", "in", "as", "use", "impl", "type", "abort", "until", "then", "self", "std"
];

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
    

    // Booleans
    if (stream.match(/\b(true|false)\b/)) return 'bool'

    // Null
    if (stream.match(/\bnull\b/)) return 'null'
    
    // Keywords
    // if (stream.match(/(?<![a-zA-Z0-9_])(if|else|for|while|loop|break|continue|return|let|in|as|use|impl|type|abort|until|then|self|std)(?![a-zA-Z0-9_])/)) return 'keyword'
       // List of keywords
    const keywords = vrlKeywords;

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
  { tag: t.comment, color: '#4CAF50', class: 'cm-vrl-comment' }, // green
  { tag: t.keyword, color: '#569cd6', class: 'cm-vrl-keyword' }, // purple
  { tag: t.number, color: '#b5cea8', class: 'cm-vrl-number' }, // blue
  { tag: t.bool, color: '#0000ff', class: 'cm-vrl-bool' }, // blue
  { tag: t.null, color: '#b5cea8', class: 'cm-vrl-null' }, // blue
  { tag: t.string, color: '#a31515', class: 'cm-vrl-string' }, // red
  { tag: t.regexp, color: '#ce9178', class: 'cm-vrl-regexp' }, // red (for VRL regex strings)
  { tag: t.variableName, color: '#d4d4d4', class: 'cm-vrl-variableName' }, // black
  { tag: t.definition(t.variableName), color: '#569cd6', class: 'cm-vrl-definition' }, // black
  { tag: t.propertyName, color: '#d4d4d4', class: 'cm-vrl-propertyName' }, // black
  { tag: t.operator, color: '#d4d4d4', class: 'cm-vrl-operator' }, // black
  { tag: t.punctuation, color: '#d4d4d4', class: 'cm-vrl-punctuation' }, // black
  { tag: t.function(t.propertyName), color: '#569cd6'}, // blue
  { tag: t.function(t.variableName), color: '#569cd6'}, // blue
], 
{
    themeType: "light"
})

// VRL theme colors (matching the provided image)
export const vrlHighDarkStyle = HighlightStyle.define([
    { tag: t.comment, color: '#608b4e', class: 'cm-vrl-comment' }, // green
    { tag: t.keyword, color: '#569cd6', class: 'cm-vrl-keyword' }, // purple
    { tag: t.number, color: '#b5cea8', class: 'cm-vrl-number' }, // blue
    { tag: t.bool, color: '#b5cea8', class: 'cm-vrl-bool' }, // blue
    { tag: t.null, color: '#b5cea8', class: 'cm-vrl-null' }, // blue
    { tag: t.string, color: '#ce9178', class: 'cm-vrl-string' }, // red
    { tag: t.regexp, color: '#ce9178', class: 'cm-vrl-regexp' }, // red (for VRL regex strings)
    { tag: t.variableName, color: '#d4d4d4', class: 'cm-vrl-variableName' }, // black
    { tag: t.definition(t.variableName), color: '#569cd6', class: 'cm-vrl-definition' }, // black
    { tag: t.propertyName, color: '#d4d4d4', class: 'cm-vrl-propertyName' }, // black
    { tag: t.operator, color: '#d4d4d4', class: 'cm-vrl-operator' }, // black
    { tag: t.punctuation, color: '#d4d4d4', class: 'cm-vrl-punctuation' }, // black
    { tag: t.function(t.propertyName), color: '#569cd6', class: 'cm-vrl-function' }, // blue
    { tag: t.function(t.variableName), color: '#569cd6', class: 'cm-vrl-function' }, // blue
  ], 
  {
      themeType: "dark",
  })

// Language support for VRL
export function vrl() {
  return new LanguageSupport(vrlLanguage, [
    syntaxHighlighting(vrlHighlightStyle),
    syntaxHighlighting(vrlHighDarkStyle),
  ])
} 