// Copyright 2026 OpenObserve Inc.
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

export interface RedactedDraft<T> {
  data: T;
  /** JSON pointers (RFC 6901) of the string values that were blanked. */
  paths: string[];
}

// Matched against the key's words joined, so `api_key`, `apiKey` and `X-Api-Key` read alike.
const SECRET_NAME =
  /password|passwd|passphrase|secret|credential|authorization|bearer|cookie|(?:api|access|private|session|signing|encryption|master|license|subscription|account|client|app|auth|ssh)key/;

// "token" also names an LLM count or an OAuth setting, so it is a secret only without one of these words.
const TOKEN_QUALIFIERS = new Set([
  "count",
  "max",
  "min",
  "limit",
  "usage",
  "total",
  "num",
  "number",
  "budget",
  "length",
  "size",
  "cost",
  "price",
  "rate",
  "per",
  "input",
  "output",
  "prompt",
  "completion",
  "cached",
  "reasoning",
  "used",
  "remaining",
  "type",
  "url",
  "uri",
  "endpoint",
]);

type Container = Record<string, unknown> | unknown[];

const keyWords = (key: string): string[] =>
  key
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z\d]+/)
    .filter(Boolean);

const isContainer = (value: unknown): value is Container =>
  value !== null && typeof value === "object";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  isContainer(value) && !Array.isArray(value);

const escapeSegment = (segment: string) => segment.replace(/~/g, "~0").replace(/\//g, "~1");

const unescapeSegment = (segment: string) => segment.replace(/~1/g, "/").replace(/~0/g, "~");

const pointer = (segments: string[]) => segments.map((s) => `/${escapeSegment(s)}`).join("");

// Fields that name or classify an entry, kept even under a secret key so the entry can still be matched.
const IDENTITY_FIELDS = new Set(["key", "name", "id", "type"]);

// A cookie's name is unique only per domain, so the domain is part of its label.
const labelOf = (node: unknown): string | null => {
  if (!isRecord(node)) return null;
  for (const field of ["key", "name", "id"]) {
    if (typeof node[field] !== "string") continue;
    const label = node[field] as string;
    return typeof node.domain === "string" ? `${label}@${node.domain}` : label;
  }
  return null;
};

const isSecretPair = (node: Record<string, unknown>): boolean => {
  const label = typeof node.key === "string" ? node.key : node.name;
  return typeof label === "string" && isSecretKeyName(label);
};

const blankAt = (node: Container, key: string, segments: string[], paths: string[]) => {
  (node as Record<string, unknown>)[key] = "";
  paths.push(pointer([...segments, key]));
};

interface WalkRules {
  containers: boolean;
  exempt: ReadonlySet<string>;
}

const walk = (
  node: unknown,
  segments: string[],
  paths: string[],
  inSecret: boolean,
  rules: WalkRules,
) => {
  if (!isContainer(node)) return;
  if (Array.isArray(node)) {
    node.forEach((child, index) => {
      const childSegments = [...segments, String(index)];
      if (inSecret && typeof child === "string" && child !== "") {
        node[index] = "";
        paths.push(pointer(childSegments));
      } else walk(child, childSegments, paths, inSecret, rules);
    });
    return;
  }
  const pairIsSecret = isSecretPair(node);
  for (const [key, value] of Object.entries(node)) {
    const exempt = rules.exempt.has(key);
    const keyIsSecret = !exempt && isSecretKeyName(key);
    const blank =
      typeof value === "string" &&
      value !== "" &&
      !exempt &&
      (keyIsSecret || (pairIsSecret && key === "value") || (inSecret && !IDENTITY_FIELDS.has(key)));
    if (blank) blankAt(node, key, segments, paths);
    else
      walk(value, [...segments, key], paths, inSecret || (rules.containers && keyIsSecret), rules);
  }
};

const parsePointer = (path: string): string[] | null => {
  if (!path.startsWith("/")) return null;
  return path.slice(1).split("/").map(unescapeSegment);
};

const childOf = (node: unknown, segment: string): unknown => {
  if (Array.isArray(node)) return node[Number(segment)];
  if (!isRecord(node)) return undefined;
  return Object.prototype.hasOwnProperty.call(node, segment) ? node[segment] : undefined;
};

const setChild = (node: unknown, segment: string, value: unknown) => {
  if (Array.isArray(node)) node[Number(segment)] = value;
  else if (isRecord(node)) node[segment] = value;
};

const valueAt = (root: unknown, segments: string[]): unknown =>
  segments.reduce<unknown>((node, segment) => childOf(node, segment), root);

/** The list entry a path's value sits in directly (`.../<i>/<field>`), or null when it is not in a list. */
const entryOf = (
  root: unknown,
  segments: string[],
): { list: unknown[]; index: number; field: string } | null => {
  if (segments.length < 2) return null;
  const list = valueAt(root, segments.slice(0, -2));
  const index = Number(segments[segments.length - 2]);
  if (!Array.isArray(list) || !Number.isInteger(index)) return null;
  return { list, index, field: segments[segments.length - 1] };
};

/** A list entry is found by its label, not its position, so a deleted or reordered row never takes another's secret. */
const currentEntryValue = (
  currentData: unknown,
  segments: string[],
  label: string | undefined,
): unknown => {
  const target = label === undefined ? null : entryOf(currentData, segments);
  if (!target) return undefined;
  // Two current entries with one label cannot tell which secret is whose, so neither is used.
  const matches = target.list.filter((item) => labelOf(item) === label);
  return matches.length === 1 && isRecord(matches[0]) ? matches[0][target.field] : undefined;
};

/** Whether a field or header named `key` holds a credential (`client_secret`, `X-Api-Key`, `refresh_token`), but not a count such as `max_tokens`. */
export const isSecretKeyName = (key: string): boolean => {
  const words = keyWords(key);
  if (SECRET_NAME.test(words.join(""))) return true;
  return (
    words.some((word) => /tokens?$/.test(word)) && !words.some((word) => TOKEN_QUALIFIERS.has(word))
  );
};

/** Blanks secret string values in a deep copy of `data` and reports where; with `containers`, every string under a secret-looking key too, and never one under an `exemptKeys` key. */
export const redactDraftSecrets = <T>(
  data: T,
  { containers = true, exemptKeys = [] }: { containers?: boolean; exemptKeys?: string[] } = {},
): RedactedDraft<T> => {
  const copy = JSON.parse(JSON.stringify(data ?? null)) as T;
  const paths: string[] = [];
  walk(copy, [], paths, false, { containers, exempt: new Set(exemptKeys) });
  return { data: copy, paths };
};

/** Blanks every entry's `value` in the lists at `pointers` (in place) and reports where, for lists whose values are secrets whatever their names. */
export const blankSecretLists = (data: unknown, pointers: string[]): string[] => {
  const paths: string[] = [];
  for (const listPointer of pointers) {
    const segments = parsePointer(listPointer);
    const list = segments ? valueAt(data, segments) : undefined;
    if (!Array.isArray(list)) continue;
    list.forEach((entry, index) => {
      if (!isRecord(entry) || typeof entry.value !== "string" || entry.value === "") return;
      entry.value = "";
      paths.push(`${listPointer}/${index}/value`);
    });
  }
  return paths;
};

/** The label of the list entry each path sits in, read from the unredacted data; paths outside a list are skipped. */
export const redactedEntryLabels = (data: unknown, paths: string[]): Record<string, string> => {
  const labels: Record<string, string> = {};
  for (const path of paths) {
    const segments = parsePointer(path);
    const target = segments ? entryOf(data, segments) : null;
    const label = target ? labelOf(target.list[target.index]) : null;
    if (label !== null) labels[path] = label;
  }
  return labels;
};

/** The value at `path` in `root`; a list entry's field is found by `label` (unique match) rather than by position. */
const valueByLabel = (
  root: unknown,
  segments: string[],
  label: string | null | undefined,
): unknown => {
  const target = entryOf(root, segments);
  if (!target) return valueAt(root, segments);
  if (label === null || label === undefined) return undefined;
  const matches = target.list.filter((item) => labelOf(item) === label);
  return matches.length === 1 && isRecord(matches[0]) ? matches[0][target.field] : undefined;
};

/** Redacted paths whose value in `data` differs from `baseline` (no baseline: all of them); paths that are not plain values are left to the editor. */
export const changedRedactedPaths = (data: unknown, baseline: unknown, paths: string[]): string[] =>
  paths.filter((path) => {
    const segments = parsePointer(path);
    if (!segments?.length) return false;
    const value = valueAt(data, segments);
    if (typeof value !== "string") return false;
    if (baseline === null || baseline === undefined) return true;
    const entry = entryOf(data, segments);
    const label = entry ? labelOf(entry.list[entry.index]) : null;
    return valueByLabel(baseline, segments, entry ? label : undefined) !== value;
  });

/** Of `paths`, the ones still blank in `currentData`: a list entry is matched by its label, and a deleted one no longer counts. */
export const blankRedactedPaths = (
  currentData: unknown,
  paths: string[],
  labels: Record<string, string> = {},
): string[] =>
  paths.filter((path) => {
    const segments = parsePointer(path);
    if (!segments?.length) return false;
    return valueByLabel(currentData, segments, labels[path]) === "";
  });

/** Fills each blanked path from `currentData` where it holds a string there; a list entry is matched by its label in `labels`, the rest stay blank. */
export const restoreRedacted = <T>(
  draftData: T,
  currentData: unknown,
  paths: string[],
  labels: Record<string, string> = {},
): T => {
  const copy = JSON.parse(JSON.stringify(draftData ?? null)) as T;
  for (const path of paths) {
    const segments = parsePointer(path);
    if (!segments?.length) continue;
    const current = entryOf(copy, segments)
      ? currentEntryValue(currentData, segments, labels[path])
      : valueAt(currentData, segments);
    if (typeof current !== "string") continue;
    const parent = valueAt(copy, segments.slice(0, -1));
    setChild(parent, segments[segments.length - 1], current);
  }
  return copy;
};
