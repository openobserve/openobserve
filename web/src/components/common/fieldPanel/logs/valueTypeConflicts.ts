// Copyright 2026 OpenObserve Inc.

export interface SchemaStream {
  name: string;
  schema?: { name: string; type: string }[];
}

const STRING_TYPES = new Set(["string", "utf8", "largeutf8", "utf8view"]);

const NUMERIC_TYPE = /^(u?int|float|decimal)/;

// A value literal is written per kind, so types of one kind (Int64 and Float64) compare fine together.
const typeKind = (type: string): string => {
  const lower = type.toLowerCase();
  if (STRING_TYPES.has(lower)) return "string";
  if (lower === "boolean" || lower === "bool") return "boolean";
  if (NUMERIC_TYPE.test(lower)) return "number";
  return lower;
};

/** Fields the selected streams type as different kinds, so one value literal cannot match them all. */
export function mixedTypeFields(streams: SchemaStream[], selected: string[]): Set<string> {
  const kinds = new Map<string, Set<string>>();
  for (const stream of streams) {
    if (!selected.includes(stream.name)) continue;
    for (const field of stream.schema ?? []) {
      if (!field.type) continue;
      const seen = kinds.get(field.name) ?? new Set<string>();
      seen.add(typeKind(field.type));
      kinds.set(field.name, seen);
    }
  }
  return new Set([...kinds].filter(([, seen]) => seen.size > 1).map(([name]) => name));
}
