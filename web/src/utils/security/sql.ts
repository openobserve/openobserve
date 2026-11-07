// Copyright 2026 OpenObserve Inc.

// A backslash before a quote pairs with it in the tokenizer, so such runs are written as chr(92).

const literal = (text: string) => `'${text.replace(/'/g, "''")}'`;

/** A backslash run that ends the value or meets a quote, the only unsafe place for one. */
const UNSAFE_BACKSLASHES = /\\+(?='|$)/g;

export function quoteString(value: string): string {
  if (!UNSAFE_BACKSLASHES.test(value)) return literal(value);
  UNSAFE_BACKSLASHES.lastIndex = 0;
  const pieces: string[] = [];
  let at = 0;
  for (const match of value.matchAll(UNSAFE_BACKSLASHES)) {
    if (match.index > at) pieces.push(literal(value.slice(at, match.index)));
    pieces.push(match[0].length === 1 ? "chr(92)" : `repeat(chr(92), ${match[0].length})`);
    at = match.index + match[0].length;
  }
  if (at < value.length) pieces.push(literal(value.slice(at)));
  return `(${pieces.join(" || ")})`;
}

export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
