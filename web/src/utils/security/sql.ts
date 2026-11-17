// Copyright 2026 OpenObserve Inc.

// A backslash before a quote pairs with it in the tokenizer, so such runs are written as chr(92).

/** Splits before a quote that follows another; the server's re-print would not double it again. */
const literals = (text: string) =>
  text.split(/(?<=')(?=')/).map((piece) => `'${piece.replace(/'/g, "''")}'`);

/** A backslash run that ends the value or meets a quote, the only unsafe place for one. */
const UNSAFE_BACKSLASHES = /\\+(?='|$)/g;

export function quoteString(value: string): string {
  const pieces: string[] = [];
  let at = 0;
  for (const match of value.matchAll(UNSAFE_BACKSLASHES)) {
    if (match.index > at) pieces.push(...literals(value.slice(at, match.index)));
    pieces.push(match[0].length === 1 ? "chr(92)" : `repeat(chr(92), ${match[0].length})`);
    at = match.index + match[0].length;
  }
  if (at < value.length || at === 0) pieces.push(...literals(value.slice(at)));
  return pieces.length === 1 && at === 0 ? pieces[0] : `(${pieces.join(" || ")})`;
}

export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
