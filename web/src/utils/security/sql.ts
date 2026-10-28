// Copyright 2026 OpenObserve Inc.
//
// sql.ts — a value as an OpenObserve SQL string literal.
//
// The search SQL tokenizer keeps backslashes as written, but a backslash in
// front of a quote still pairs with it. `'C:\Windows'` reaches the engine
// intact; a value with a quote right after a backslash (a regex's `\'`, which
// is written `\''` once the quote is doubled) leaves the literal unterminated.
// A trailing backslash is accepted by today's tokenizer, but it is the same
// pairing one character away, so it is not relied on either.
//
// Those backslashes are written as chr(92) and concatenated, a spelling no
// escape rule can misread. Every other value is a plain literal.

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
