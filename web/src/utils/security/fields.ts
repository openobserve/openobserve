// Copyright 2026 OpenObserve Inc.

// Definitions keep vendor field spelling; this mirrors ingest's `format_key` (src/config/src/utils/flatten.rs).

/** ZO_INGEST_FLATTEN_LEVEL: nesting depth flattened into columns; 3 unless the server overrides it. */
export const INGEST_FLATTEN_LEVEL = 3;

/** A producer's field path as the ingested column name. */
export function toColumnName(path: string): string {
  let out = "";
  for (const char of path) {
    if (char >= "a" && char <= "z") out += char;
    else if (char >= "0" && char <= "9") out += char;
    else if (char === "_") out += char;
    else if (char >= "A" && char <= "Z") out += char.toLowerCase();
    else {
      // Non-ASCII is lower-cased where possible and replaced otherwise, in the ingester's order.
      const lowered = char.toLowerCase();
      out += /\p{Ll}|\p{N}/u.test(lowered) ? lowered : "_";
    }
  }
  return out;
}

/** Finds a column by its stored, case-insensitive, or pre-ingest producer spelling. */
export class FieldIndex {
  private readonly byExact: Set<string>;
  private readonly byLower = new Map<string, string>();
  private readonly byColumn = new Map<string, string>();

  constructor(fields: Iterable<string>) {
    this.byExact = new Set(fields);
    for (const field of this.byExact) {
      // First spelling wins, so an exact column is never displaced by one that merely normalizes the same.
      if (!this.byLower.has(field.toLowerCase())) this.byLower.set(field.toLowerCase(), field);
      const column = toColumnName(field);
      if (!this.byColumn.has(column)) this.byColumn.set(column, field);
    }
  }

  /** The real column for a field path, or null when the stream has no such field. */
  resolve(path: string): string | null {
    if (this.byExact.has(path)) return path;
    return this.byLower.get(path.toLowerCase()) ?? this.byColumn.get(toColumnName(path)) ?? null;
  }

  has(path: string): boolean {
    return this.resolve(path) !== null;
  }

  /** Past the flatten depth the rest is JSON text in the deepest column; keys inside keep producer spelling. */
  resolveNested(path: string): { column: string; keys: string[] } | null {
    // Only the column at exactly the flatten depth holds a JSON remainder; a shallower one is a plain value.
    const parts = path.split(".");
    if (parts.length <= INGEST_FLATTEN_LEVEL) return null;
    const column = this.resolve(parts.slice(0, INGEST_FLATTEN_LEVEL).join("."));
    return column ? { column, keys: parts.slice(INGEST_FLATTEN_LEVEL) } : null;
  }
}

/**
 * Reads a field out of a row by its producer's path: as written, as the column
 * ingest rewrote it into, or down the nested objects of a row never flattened.
 */
export function readPath(row: Record<string, unknown> | null | undefined, path: string): unknown {
  if (!row) return undefined;
  if (Object.prototype.hasOwnProperty.call(row, path)) return row[path];

  const column = toColumnName(path);
  if (column !== path && Object.prototype.hasOwnProperty.call(row, column)) return row[column];

  let node: unknown = row;
  for (const part of path.split(".")) {
    if (node == null || typeof node !== "object") return readFlattenedJson(row, path);
    node = (node as Record<string, unknown>)[part];
  }
  return node === undefined ? readFlattenedJson(row, path) : node;
}

/** A path deeper than ingest flattened: the remainder sits as JSON text in the deepest column. */
function readFlattenedJson(row: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  if (parts.length <= INGEST_FLATTEN_LEVEL) return undefined;
  const text = row[toColumnName(parts.slice(0, INGEST_FLATTEN_LEVEL).join("."))];
  if (typeof text !== "string" || !text.startsWith("{")) return undefined;
  try {
    let node: unknown = JSON.parse(text);
    for (const key of parts.slice(INGEST_FLATTEN_LEVEL)) {
      if (node == null || typeof node !== "object") return undefined;
      node = (node as Record<string, unknown>)[key];
    }
    return node;
  } catch {
    return undefined;
  }
}
