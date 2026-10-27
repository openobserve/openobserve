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

import { SECRET_KEY_PATTERN } from "@/utils/drafts/redactDraftSecrets";

export interface RedactedYaml {
  text: string;
  /** Zero-based line numbers, in the redacted text, whose value was blanked. */
  lines: number[];
}

const KEY_LINE = /^(\s*(?:-\s+)?)(["']?)([^"'\s:#][^"':#]*?)\2(\s*:)(?:(\s+)(.*))?$/;
const BLOCK_SCALAR = /^[|>][0-9+-]*$/;
// A path or file setting names where the secret lives, not the secret itself.
const REFERENCE_KEY = /_(file|path)$/i;
// The part of a line that is a flow collection, after an optional list dash and key.
const FLOW_LINE = /^(\s*(?:-\s+)?(?:[^{}[\]#]*?:\s+)?)([{[].*)$/;
const FLOW_PAIR =
  /([{,]\s*)(["']?)([^"'{}[\],:\s][^"'{}[\],:]*?)\2(\s*:\s*)("(?:\\.|[^"\\])*"|'(?:''|[^'])*'|(?:\$\{[^}]*\}|[^,{}[\]])*)/g;
const LIST_ITEM = /^-(\s+|$)/;
// A list item is matched by the first of these keys it has, else by its first scalar, never by position.
const ITEM_LABEL_KEYS = ["job_name", "name", "key", "id"];
// Marks a list item with no identity; a secret inside one is never refilled.
const UNLABELLED_ITEM = "[#";

interface Frame {
  indent: number;
  key: string;
  item: boolean;
  items: number;
}

const indentOf = (line: string) => line.length - line.trimStart().length;

const splitComment = (value: string): { scalar: string; comment: string } => {
  if (value.startsWith("#")) return { scalar: "", comment: ` ${value}` };
  const quoted = /^(["'])(?:\\.|(?!\1).)*\1/.exec(value);
  const end = quoted ? quoted[0].length : value.search(/\s#/);
  if (end < 0) return { scalar: value, comment: "" };
  return { scalar: value.slice(0, end), comment: value.slice(end) };
};

const isSecretKey = (key: string) => SECRET_KEY_PATTERN.test(key) && !REFERENCE_KEY.test(key);

const keepsValue = (key: string, scalar: string) =>
  !isSecretKey(key) ||
  scalar.trim() === "" ||
  scalar.trim() === '""' ||
  scalar.trim() === "''" ||
  // An env reference is resolved on the collector, so it is not a secret in the text.
  scalar.includes("${");

const isBlankScalar = (scalar: string) => scalar === '""' || scalar === "''";

/** How many lines after `from` continue a plain multi-line scalar whose key line has no value; 0 when they do not. */
const plainContinuation = (lines: string[], from: number): number => {
  const keyIndent = indentOf(lines[from]);
  let last = 0;
  for (let i = from + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    if (indentOf(lines[i]) <= keyIndent) break;
    if (KEY_LINE.test(lines[i]) || LIST_ITEM.test(trimmed) || trimmed.startsWith("#")) return 0;
    last = i - from;
  }
  return last;
};

/** Calls `visit` for each pair of a flow collection; its return replaces the pair's value. */
const mapFlowPairs = (flow: string, visit: (key: string, value: string) => string): string =>
  flow.replace(
    FLOW_PAIR,
    (_m, lead: string, quote: string, key: string, sep: string, value: string) => {
      const scalar = value.trimEnd();
      return `${lead}${quote}${key}${quote}${sep}${visit(key, scalar)}${value.slice(scalar.length)}`;
    },
  );

const redactFlow = (flow: string): string =>
  mapFlowPairs(flow, (key, value) => (keepsValue(key, value) ? value : '""'));

/** Each key's value in a flow collection; null for a key that occurs more than once, at any depth. */
const flowValues = (flow: string): Map<string, string | null> => {
  const values = new Map<string, string | null>();
  mapFlowPairs(flow, (key, value) => {
    values.set(key, values.has(key) ? null : value);
    return value;
  });
  return values;
};

const pathOf = (stack: Frame[]) =>
  stack
    .slice(1)
    .map((frame) => frame.key)
    .join("/");

const isIdentityValue = (key: string, value: string) =>
  value !== "" &&
  !isBlankScalar(value) &&
  !BLOCK_SCALAR.test(value) &&
  !/^[{[]/.test(value) &&
  !SECRET_KEY_PATTERN.test(key);

/** The identity of the list item opening at `start`: an identity key's value, else its first scalar. */
const itemLabel = (lines: string[], start: number): string | null => {
  const first = KEY_LINE.exec(lines[start]);
  if (!first) {
    const bare = splitComment(lines[start].trim().replace(LIST_ITEM, "")).scalar.trim();
    return bare && !isBlankScalar(bare) ? `=${bare}` : null;
  }
  const dashIndent = indentOf(lines[start]);
  const keyIndent = first[1].length;
  const fields = new Map<string, string>();
  for (let i = start; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (i > start && trimmed === "") continue;
    if (i > start && indentOf(lines[i]) <= dashIndent) break;
    if (i > start && (indentOf(lines[i]) !== keyIndent || LIST_ITEM.test(trimmed))) continue;
    const match = KEY_LINE.exec(lines[i]);
    const value = match ? splitComment(match[6] ?? "").scalar.trim() : "";
    if (match && isIdentityValue(match[3], value) && !fields.has(match[3])) {
      fields.set(match[3], value);
    }
  }
  const key = ITEM_LABEL_KEYS.find((name) => fields.has(name)) ?? fields.keys().next().value;
  return key === undefined ? null : `${key}=${fields.get(key)}`;
};

const openListItem = (stack: Frame[], lines: string[], index: number) => {
  const indent = indentOf(lines[index]);
  let top = stack[stack.length - 1];
  while (top.indent > indent || (top.indent === indent && top.item)) {
    stack.pop();
    top = stack[stack.length - 1];
  }
  const label = itemLabel(lines, index);
  top.items++;
  stack.push({
    indent,
    key: label === null ? `${UNLABELLED_ITEM}${top.items}]` : `[${label}]`,
    item: true,
    items: 0,
  });
};

/** The key path of each line (null for comments, blanks, block scalar bodies and bare values). */
const keyPaths = (lines: string[]): (string | null)[] => {
  const stack: Frame[] = [{ indent: -1, key: "", item: false, items: 0 }];
  const paths: (string | null)[] = [];
  let blockIndent: number | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    const indent = indentOf(line);
    if (blockIndent !== null && (trimmed === "" || indent > blockIndent)) {
      paths.push(null);
      continue;
    }
    blockIndent = null;
    if (trimmed === "" || trimmed.startsWith("#")) {
      paths.push(null);
      continue;
    }
    const dash = LIST_ITEM.exec(trimmed);
    if (dash) openListItem(stack, lines, index);
    const match = KEY_LINE.exec(line);
    if (!match) {
      paths.push(dash ? pathOf(stack) : null);
      continue;
    }
    const keyIndent = match[1].length;
    while (stack[stack.length - 1].indent >= keyIndent) stack.pop();
    stack.push({ indent: keyIndent, key: match[3], item: false, items: 0 });
    paths.push(pathOf(stack));
    if (BLOCK_SCALAR.test(splitComment(match[6] ?? "").scalar.trim())) blockIndent = indent;
  }
  return paths;
};

/** The lines of a block scalar that starts at `from`, without the key line. */
const blockBody = (lines: string[], from: number): string[] => {
  const keyIndent = indentOf(lines[from]);
  const body: string[] = [];
  for (let i = from + 1; i < lines.length; i++) {
    if (lines[i].trim() !== "" && indentOf(lines[i]) <= keyIndent) break;
    body.push(lines[i]);
  }
  return body;
};

const shiftIndent = (line: string, delta: number): string => {
  if (line.trim() === "") return line;
  return delta >= 0 ? " ".repeat(delta) + line : line.slice(Math.min(-delta, indentOf(line)));
};

const refillFlow = (draftLine: string, sourceLine: string): string[] | null => {
  const draft = FLOW_LINE.exec(draftLine);
  const source = FLOW_LINE.exec(sourceLine);
  if (!draft || !source) return null;
  const sourceValues = flowValues(source[2]);
  const draftValues = flowValues(draft[2]);
  // A key that repeats on either side cannot say which nested map or item its secret belongs to.
  const flow = mapFlowPairs(draft[2], (key, value) =>
    isBlankScalar(value) && SECRET_KEY_PATTERN.test(key) && draftValues.get(key) !== null
      ? (sourceValues.get(key) ?? value)
      : value,
  );
  return [draft[1] + flow];
};

/** Rebuilds one blanked draft line from the source line at the same key path; null when it cannot. */
const refillLine = (draftLine: string, sourceLines: string[], from: number): string[] | null => {
  const draft = KEY_LINE.exec(draftLine);
  const source = KEY_LINE.exec(sourceLines[from]);
  if (!draft || !source) return null;
  const { scalar, comment } = splitComment(draft[6] ?? "");
  if (!isBlankScalar(scalar.trim())) return refillFlow(draftLine, sourceLines[from]);
  const sourceScalar = splitComment(source[6] ?? "").scalar;
  const delta = indentOf(draftLine) - indentOf(sourceLines[from]);
  if (sourceScalar.trim() === "") {
    const continued = plainContinuation(sourceLines, from);
    if (!continued) return null;
    const body = sourceLines.slice(from + 1, from + 1 + continued);
    return [
      `${draft[1]}${draft[2]}${draft[3]}${draft[2]}${draft[4]}${comment}`,
      ...body.map((line) => shiftIndent(line, delta)),
    ];
  }
  const head = `${draft[1]}${draft[2]}${draft[3]}${draft[2]}${draft[4]} ${sourceScalar}${comment}`;
  if (!BLOCK_SCALAR.test(sourceScalar.trim())) return [head];
  return [head, ...blockBody(sourceLines, from).map((line) => shiftIndent(line, delta))];
};

/** Refills the lines `redactYamlSecrets` blanked from the line at the same key path in `source`; unmatched lines stay blank. */
export const restoreYamlSecrets = (redacted: string, lines: number[], source: string): string => {
  const draftLines = redacted.split("\n");
  const sourceLines = source.split("\n");
  const draftPaths = keyPaths(draftLines);
  // A path that occurs twice in the source cannot say which of its values is the draft's.
  const sourceAt = new Map<string, number | null>();
  keyPaths(sourceLines).forEach((path, index) => {
    if (path !== null) sourceAt.set(path, sourceAt.has(path) ? null : index);
  });
  const refilled = new Map<number, string[]>();
  for (const line of lines) {
    const path = draftPaths[line];
    if (!path || path.includes(UNLABELLED_ITEM)) continue;
    const from = sourceAt.get(path);
    if (from === undefined || from === null) continue;
    const next = refillLine(draftLines[line], sourceLines, from);
    if (next) refilled.set(line, next);
  }
  return draftLines.flatMap((line, index) => refilled.get(index) ?? [line]).join("\n");
};

/** The key paths (e.g. `exporters/otlphttp/headers/Authorization`) of the given lines; lines with no key path are skipped. */
export const yamlLineKeyPaths = (text: string, lines: number[]): string[] => {
  const paths = keyPaths(text.split("\n"));
  return lines.flatMap((line) => {
    const path = paths[line];
    return path ? [path] : [];
  });
};

const hasBlankSecret = (line: string): boolean => {
  const match = KEY_LINE.exec(line);
  const { scalar } = splitComment(match?.[6] ?? "");
  if (match && isSecretKey(match[3]) && isBlankScalar(scalar.trim())) return true;
  const flow = FLOW_LINE.exec(line);
  let blank = false;
  if (flow) {
    mapFlowPairs(flow[2], (key, value) => {
      if (isSecretKey(key) && isBlankScalar(value)) blank = true;
      return value;
    });
  }
  return blank;
};

/** Of `keyPaths`, the ones whose line in `text` still holds a blank secret; a path no longer in the text counts as resolved. */
export const blankYamlSecretKeys = (text: string, keyPathsToCheck: string[]): string[] => {
  const lines = text.split("\n");
  const paths = keyPaths(lines);
  return keyPathsToCheck.filter((path) =>
    paths.some((linePath, index) => linePath === path && hasBlankSecret(lines[index])),
  );
};

/** Blanked lines whose value in `original` differs from `saved` at the same key path, i.e. the ones the user changed. */
export const changedYamlSecretLines = (
  redacted: RedactedYaml,
  original: string,
  saved: string,
): number[] =>
  redacted.lines.filter(
    (line) =>
      restoreYamlSecrets(redacted.text, [line], original) !==
      restoreYamlSecrets(redacted.text, [line], saved),
  );

/** Blanks literal values under secret-looking YAML keys, including block scalars and flow maps, line by line. */
export const redactYamlSecrets = (yaml: string): RedactedYaml => {
  const out: string[] = [];
  const lines: number[] = [];
  const source = yaml.split("\n");
  for (let i = 0; i < source.length; i++) {
    const line = source[i];
    const match = KEY_LINE.exec(line);
    const { scalar, comment } = splitComment(match?.[6] ?? "");
    const continued =
      match && scalar.trim() === "" && isSecretKey(match[3]) ? plainContinuation(source, i) : 0;
    const continuation = source.slice(i + 1, i + 1 + continued).join("\n");
    if (match && continued && !continuation.includes("${")) {
      lines.push(out.length);
      out.push(`${match[1]}${match[2]}${match[3]}${match[2]}${match[4]} ""${comment}`);
      i += continued;
      continue;
    }
    if (!match || keepsValue(match[3], scalar)) {
      const flow = FLOW_LINE.exec(line);
      const redactedFlow = flow ? flow[1] + redactFlow(flow[2]) : line;
      if (redactedFlow !== line) lines.push(out.length);
      out.push(redactedFlow);
      continue;
    }
    lines.push(out.length);
    out.push(`${match[1]}${match[2]}${match[3]}${match[2]}${match[4]} ""${comment}`);
    if (!BLOCK_SCALAR.test(scalar.trim())) continue;
    const keyIndent = indentOf(line);
    while (
      i + 1 < source.length &&
      (source[i + 1].trim() === "" || indentOf(source[i + 1]) > keyIndent)
    ) {
      i++;
    }
  }
  return { text: out.join("\n"), lines };
};
