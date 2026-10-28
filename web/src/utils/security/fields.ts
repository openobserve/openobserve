// Copyright 2026 OpenObserve Inc.
//
// fields.ts — what a field is actually called once it has been ingested.
//
// Every source type, OCSF mapping and Sigma rule in this directory names fields
// the way the PRODUCER writes them: `userIdentity.type`, `outcome.result`,
// `CommandLine`. That is the right thing to write down, because it is what the
// vendor documents and what a rule from the public corpus will say.
//
// It is not what the column is called. OpenObserve flattens nested JSON and
// rewrites every key on ingest: nesting collapses to `_`, ASCII letters are
// lower-cased, and anything that is not a letter, a digit or an underscore
// becomes an underscore. So `userIdentity.type` is stored as
// `useridentity_type`, and `alert.severity` as `alert_severity`.
//
// That transformation is lossy and one-way, which is why it is applied here at
// lookup time rather than being baked into the source definitions. A definition
// written in the vendor's spelling stays readable and stays checkable against
// the vendor's documentation; this file is the single place that knows how to
// find the column it turned into.
//
// Mirrors `format_key` in src/config/src/utils/flatten.rs.

/**
 * How many levels of nesting ingest flattens into columns before storing the
 * rest as JSON text: ZO_INGEST_FLATTEN_LEVEL, 3 unless the server overrides it.
 */
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
      // Non-ASCII is lower-cased where it can be and replaced where it cannot,
      // which is the same order the ingester applies.
      const lowered = char.toLowerCase();
      out += /\p{Ll}|\p{N}/u.test(lowered) ? lowered : "_";
    }
  }
  return out;
}

/**
 * Indexes a stream's columns so a field can be found by any of the spellings it
 * might be written in: exactly as stored, ignoring case, or as the producer
 * wrote it before ingest rewrote it.
 */
export class FieldIndex {
  private readonly byExact: Set<string>;
  private readonly byLower = new Map<string, string>();
  private readonly byColumn = new Map<string, string>();

  constructor(fields: Iterable<string>) {
    this.byExact = new Set(fields);
    for (const field of this.byExact) {
      // First spelling wins, so a column stored exactly as written is never
      // displaced by another that merely normalizes to the same thing.
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

  /**
   * A path that ingest did not flatten all the way. Past ZO_INGEST_FLATTEN_LEVEL
   * (3 by default) the rest of an object is stored as JSON text in the deepest
   * column it reached, so OCSF's `process.parent_process.file.path` lives in
   * `process_parent_process_file` as `{"path": ...}`. Returns that column and
   * the keys still to read inside it, in the producer's own spelling because
   * JSON keys are not rewritten. Null when no prefix of the path is a column.
   */
  resolveNested(path: string): { column: string; keys: string[] } | null {
    // Only the column at exactly the flatten depth holds a JSON remainder. A
    // shallower column with a matching name is a plain value, and reading a
    // path into it would claim a field the stream does not have.
    const parts = path.split(".");
    if (parts.length <= INGEST_FLATTEN_LEVEL) return null;
    const column = this.resolve(parts.slice(0, INGEST_FLATTEN_LEVEL).join("."));
    return column ? { column, keys: parts.slice(INGEST_FLATTEN_LEVEL) } : null;
  }
}
