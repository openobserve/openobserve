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

import {
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
  visit,
  type Document,
  type Pair,
  type Range,
  type Scalar,
  type YAMLMap,
} from "yaml";
import { SECRET_KEY_PATTERN } from "@/utils/drafts/redactDraftSecrets";

export interface RedactedYaml {
  text: string;
  /** Ids of the blanked secrets (see `yamlSecretLabel`); only `YAML_NOT_STORED` when the text was dropped. */
  ids: string[];
}

/** The id of a whole YAML text left out of a draft because it did not parse and may hold a secret. */
export const YAML_NOT_STORED = "yaml";

// A path or file setting names where the secret lives, not the secret itself.
const REFERENCE_KEY = /_(file|path)$/i;
// A list item is matched by the first of these fields it has, else by its first plain field, never by position.
const ITEM_LABEL_KEYS = ["job_name", "name", "key", "id"];
// Kept under a secret key so its list items can still be matched; `key` is left out since it often holds the secret there.
const KEPT_IDENTITY_KEYS = ["job_name", "name", "id"];
const BLOCK_HEADER = /^[|>][0-9+-]*/;
// For a commented-out line that is not YAML: the text after a secret-looking word and its `:` or `=`.
const COMMENT_SECRET = new RegExp(
  `((?:${SECRET_KEY_PATTERN.source})[^\\s:=]*["']?\\s*[:=]\\s*)(\\S.*?)\\s*$`,
  "i",
);

/** A map key, a list item matched by its label, or a list item with no unique label (1-based). */
type Segment = string | { l: string } | { i: number };

interface Child {
  segment: Segment;
  node: unknown;
  /** For a scalar: it is a secret; for a collection: everything under it is. */
  secret: boolean;
  label: string | null;
  /** Where a map value's key ends, so comments between the key and its value count as under it. */
  keyEnd: number | null;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

interface Found {
  secrets: { node: Scalar; path: Segment[] }[];
  /** Source spans whose every scalar is a secret, for commented-out lines inside them. */
  spans: [number, number][];
}

interface CommentLine {
  /** Offset of the `#`. */
  start: number;
  /** Offset of the line end, before any `\r`. */
  end: number;
  column: number;
  line: number;
  ownLine: boolean;
}

const rangeOf = (node: { range?: Range | null }): Range => node.range ?? [0, 0, 0];

const parse = (text: string): Document | null => {
  const doc = parseDocument(text);
  return doc.errors.length ? null : doc;
};

const keyOf = (pair: Pair): string | null => (isScalar(pair.key) ? String(pair.key.value) : null);

// An entry such as `key: Authorization` + `value: …` (headers_setter, attributes processor) holds its secret in `value`.
const namesSecret = (map: YAMLMap): boolean =>
  map.items.some((pair) => {
    const key = keyOf(pair);
    return (
      (key === "key" || key === "name") &&
      isScalar(pair.value) &&
      typeof pair.value.value === "string" &&
      SECRET_KEY_PATTERN.test(pair.value.value)
    );
  });

const fieldIsSecret = (key: string | null, inSecret: boolean, pairSecret: boolean): boolean => {
  if (key === null) return inSecret;
  if (REFERENCE_KEY.test(key)) return false;
  if (SECRET_KEY_PATTERN.test(key) || (pairSecret && key === "value")) return true;
  return inSecret && !KEPT_IDENTITY_KEYS.includes(key);
};

const isBlockScalar = (node: Scalar) =>
  node.type === "BLOCK_LITERAL" || node.type === "BLOCK_FOLDED";

const isLabelValue = (node: unknown): node is Scalar =>
  isScalar(node) && node.value !== null && node.value !== "" && !isBlockScalar(node);

const isLiteralSecret = (node: Scalar) =>
  node.value !== null &&
  node.value !== "" &&
  typeof node.value !== "boolean" &&
  // An env reference is resolved on the collector, so it is not a secret in the text.
  !String(node.value).includes("${");

const itemLabel = (item: unknown, inSecret: boolean): string | null => {
  if (isScalar(item)) return !inSecret && isLabelValue(item) ? `=${String(item.value)}` : null;
  if (!isMap(item)) return null;
  const pairSecret = namesSecret(item);
  const fields = new Map<string, string>();
  for (const pair of item.items) {
    const key = keyOf(pair);
    if (key === null || fields.has(key) || fieldIsSecret(key, inSecret, pairSecret)) continue;
    if (isLabelValue(pair.value)) fields.set(key, String(pair.value.value));
  }
  const key = ITEM_LABEL_KEYS.find((name) => fields.has(name)) ?? fields.keys().next().value;
  return key === undefined ? null : `${key}=${fields.get(key)}`;
};

const childrenOf = (node: unknown, inSecret: boolean): Child[] => {
  if (isMap(node)) {
    const pairSecret = namesSecret(node);
    return node.items.map((pair, index) => {
      const key = keyOf(pair);
      return {
        segment: key ?? { i: index + 1 },
        node: pair.value,
        secret: fieldIsSecret(key, inSecret, pairSecret),
        label: null,
        keyEnd: isScalar(pair.key) ? rangeOf(pair.key)[1] : null,
      };
    });
  }
  if (!isSeq(node)) return [];
  const labels = node.items.map((item) => itemLabel(item, inSecret));
  return node.items.map((item, index) => {
    const label = labels[index];
    const unique = label !== null && labels.indexOf(label) === labels.lastIndexOf(label);
    return {
      segment: unique ? { l: label } : { i: index + 1 },
      node: item,
      secret: inSecret,
      label,
      keyEnd: null,
    };
  });
};

const collectSecrets = (doc: Document, rootSecret: boolean): Found => {
  const pathOf = new Map<unknown, Segment[]>();
  const secrets = new Map<Scalar, Segment[]>();
  const spans: [number, number][] = [];
  const walkedSecret = new Set<unknown>();
  const aliased: unknown[] = [];
  const visitNode = (node: unknown, path: Segment[], secret: boolean, keyEnd: number | null) => {
    if (isAlias(node)) {
      if (secret) aliased.push(node.resolve(doc));
      return;
    }
    if (!pathOf.has(node)) pathOf.set(node, path);
    if (isScalar(node)) {
      if (secret && isLiteralSecret(node)) secrets.set(node, path);
      return;
    }
    if (!isMap(node) && !isSeq(node)) return;
    if (secret) {
      if (walkedSecret.has(node)) return;
      walkedSecret.add(node);
      spans.push([keyEnd ?? rangeOf(node)[0], rangeOf(node)[2]]);
    }
    for (const child of childrenOf(node, secret)) {
      visitNode(child.node, [...path, child.segment], child.secret, child.keyEnd);
    }
  };
  visitNode(doc.contents, [], rootSecret, null);
  // An alias under a secret key exposes the node it points to, wherever that is anchored.
  for (let index = 0; index < aliased.length; index++) {
    const path = pathOf.get(aliased[index]);
    if (path) visitNode(aliased[index], path, true, null);
  }
  return {
    secrets: [...secrets]
      .map(([node, path]) => ({ node, path }))
      .sort((a, b) => rangeOf(a.node)[0] - rangeOf(b.node)[0]),
    spans,
  };
};

/** Where a block scalar's header line ends, so a comment on it is kept apart from the body. */
const headerEnd = (text: string, node: Scalar): number => {
  const [start, end] = rangeOf(node);
  const lineBreak = text.slice(start, end).search(/\r?\n/);
  return lineBreak < 0 ? end : start + lineBreak;
};

// Only the scalar's own text is replaced, so its anchor, tag, comment and line breaks stay.
const blankEdits = (text: string, node: Scalar): Edit[] => {
  const [start, end] = rangeOf(node);
  if (!isBlockScalar(node)) return [{ start, end, text: '""' }];
  const header = BLOCK_HEADER.exec(text.slice(start, end))?.[0] ?? "";
  const bodyStart = headerEnd(text, node);
  const bodyEnd = start + text.slice(start, end).trimEnd().length;
  const edits = [{ start, end: start + header.length, text: '""' }];
  if (bodyEnd > bodyStart) edits.push({ start: bodyStart, end: bodyEnd, text: "" });
  return edits;
};

const scalarSpans = (text: string, doc: Document): [number, number][] => {
  const spans: [number, number][] = [];
  visit(doc, {
    Scalar(_key, node) {
      const [start, end] = rangeOf(node);
      spans.push([isBlockScalar(node) ? headerEnd(text, node) : start, end]);
    },
  });
  return spans;
};

const commentLines = (text: string, doc: Document): CommentLine[] => {
  const scalars = scalarSpans(text, doc);
  const inScalar = (pos: number) => scalars.some(([start, end]) => pos >= start && pos < end);
  const comments: CommentLine[] = [];
  let lineStart = 0;
  text.split("\n").forEach((raw, line) => {
    const body = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    for (let column = body.indexOf("#"); column >= 0; column = body.indexOf("#", column + 1)) {
      const start = lineStart + column;
      if ((column > 0 && !/\s/.test(body[column - 1])) || inScalar(start)) continue;
      const ownLine = body.slice(0, column).trim() === "";
      comments.push({ start, end: lineStart + body.length, column, line, ownLine });
      break;
    }
    lineStart += raw.length + 1;
  });
  return comments;
};

/** Runs of whole-line comments at one column, read together so a commented-out block keeps its nesting. */
const commentBlocks = (comments: CommentLine[]): CommentLine[][] => {
  const blocks: CommentLine[][] = [];
  for (const comment of comments) {
    const block = blocks[blocks.length - 1];
    const last = block?.[block.length - 1];
    const joins =
      last?.ownLine &&
      comment.ownLine &&
      last.line + 1 === comment.line &&
      last.column === comment.column;
    if (joins) block.push(comment);
    else blocks.push([comment]);
  }
  return blocks;
};

const fallbackCommentEdits = (lines: string[], starts: number[], inSecret: boolean): Edit[] =>
  lines.flatMap((line, index) => {
    if (inSecret) {
      const value = line.trim();
      const start = starts[index] + line.indexOf(value);
      return value ? [{ start, end: start + value.length, text: '""' }] : [];
    }
    const match = COMMENT_SECRET.exec(line);
    if (!match || match[2].includes("${")) return [];
    const start = starts[index] + match.index + match[1].length;
    return [{ start, end: start + match[2].length, text: '""' }];
  });

/** Blanks secrets in commented-out YAML, read as YAML where it parses and by `key: value` where it does not. */
const commentEdits = (text: string, doc: Document, spans: [number, number][]): Edit[] =>
  commentBlocks(commentLines(text, doc)).flatMap((block) => {
    const lines = block.map((comment) => text.slice(comment.start + 1, comment.end));
    const starts: number[] = [];
    lines.reduce((offset, line) => {
      starts.push(offset);
      return offset + line.length + 1;
    }, 0);
    const inSecret = spans.some(([start, end]) => block[0].start >= start && block[0].start < end);
    const inner = secretEdits(lines.join("\n"), inSecret);
    const edits = inner ? inner.edits : fallbackCommentEdits(lines, starts, inSecret);
    const toSource = (pos: number) => {
      let index = starts.length - 1;
      while (index > 0 && starts[index] > pos) index--;
      return block[index].start + 1 + pos - starts[index];
    };
    return edits.map((edit) => ({ ...edit, start: toSource(edit.start), end: toSource(edit.end) }));
  });

function secretEdits(text: string, rootSecret: boolean): { edits: Edit[]; ids: string[] } | null {
  const doc = parse(text);
  if (!doc) return null;
  // Under a secret key, a commented-out list or map is a secret, while a line of prose is not.
  const contentIsSecret = rootSecret && (isMap(doc.contents) || isSeq(doc.contents));
  const { secrets, spans } = collectSecrets(doc, contentIsSecret);
  return {
    edits: [
      ...secrets.flatMap(({ node }) => blankEdits(text, node)),
      ...commentEdits(text, doc, spans),
    ],
    ids: secrets.map(({ path }) => JSON.stringify(path)),
  };
}

const applyEdits = (text: string, edits: Edit[]): string => {
  let out = "";
  let from = 0;
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    // Overlapping edits widen the blanked span rather than let a byte of either through.
    if (edit.start < from) {
      from = Math.max(from, edit.end);
      continue;
    }
    out += text.slice(from, edit.start) + edit.text;
    from = edit.end;
  }
  return out + text.slice(from);
};

const isSegment = (segment: unknown): segment is Segment =>
  typeof segment === "string" ||
  (typeof segment === "object" &&
    segment !== null &&
    (("l" in segment && typeof segment.l === "string") ||
      ("i" in segment && typeof segment.i === "number")));

const pathOfId = (id: string): Segment[] | null => {
  try {
    const path: unknown = JSON.parse(id);
    return Array.isArray(path) && path.every(isSegment) ? path : null;
  } catch {
    return null;
  }
};

const sameSegment = (a: Segment, b: Segment) => JSON.stringify(a) === JSON.stringify(b);

/** With `anyItem`, an unlabelled item segment matches every item of its list, and a label every item carrying it. */
const segmentMatches = (child: Child, segment: Segment, anyItem: boolean): boolean => {
  if (!anyItem || typeof segment === "string") return sameSegment(child.segment, segment);
  if (typeof child.segment === "string") return false;
  return "i" in segment || child.label === segment.l;
};

const findNodes = (doc: Document, path: Segment[], anyItem: boolean): unknown[] => {
  let level: { node: unknown; secret: boolean }[] = [{ node: doc.contents, secret: false }];
  for (const segment of path) {
    level = level.flatMap(({ node, secret }) =>
      childrenOf(node, secret).filter((child) => segmentMatches(child, segment, anyItem)),
    );
  }
  return level.map(({ node }) => node);
};

const findUnique = (doc: Document, path: Segment[]): unknown => {
  const nodes = findNodes(doc, path, false);
  return nodes.length === 1 ? nodes[0] : null;
};

/** The column of the block collection a node sits in, which its continuation lines must stay indented past. */
const blockIndent = (text: string, doc: Document, target: Scalar): number => {
  let indent = 0;
  visit(doc, {
    Scalar(_key, node, path) {
      if (node !== target) return;
      const parent = [...path].reverse().find((n) => (isMap(n) || isSeq(n)) && !n.flow);
      if (parent && (isMap(parent) || isSeq(parent))) {
        const start = rangeOf(parent)[0];
        indent = start - (text.lastIndexOf("\n", start - 1) + 1);
      }
      return visit.BREAK;
    },
  });
  return indent;
};

const shiftLine = (line: string, delta: number): string => {
  if (line.trim() === "") return line;
  if (delta >= 0) return " ".repeat(delta) + line;
  return line.slice(Math.min(-delta, line.length - line.trimStart().length));
};

/** The draft text with `target`'s blank replaced by the saved scalar's own source, re-indented to the draft. */
const withSavedScalar = (
  text: string,
  doc: Document,
  target: Scalar,
  source: string,
  sourceDoc: Document,
  saved: Scalar,
): string => {
  const [start, end] = rangeOf(target);
  const [savedStart, savedEnd] = rangeOf(saved);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const delta = blockIndent(text, doc, target) - blockIndent(source, sourceDoc, saved);
  const [first, ...rest] = source.slice(savedStart, savedEnd).split(/\r?\n/);
  const shifted = rest.map((line) => shiftLine(line, delta));
  if (!isBlockScalar(saved))
    return text.slice(0, start) + [first, ...shifted].join(eol) + text.slice(end);
  const header = BLOCK_HEADER.exec(first)?.[0] ?? "";
  const lineEnd = end + text.slice(end).search(/\r?\n|$/);
  const lastContent = shifted.findLastIndex((line) => line.trim() !== "");
  // Its trailing line breaks are the ones redaction left after the blank, so only the content goes back.
  const body = shifted.slice(0, lastContent + 1);
  const tail = lineEnd === text.length && body.length < shifted.length ? eol : "";
  return `${text.slice(0, start)}${header}${text.slice(end, lineEnd)}${["", ...body].join(eol)}${tail}${text.slice(lineEnd)}`;
};

const scalarKey = (value: unknown) => JSON.stringify([typeof value, String(value)]);

/** Every node in document order, scalars by value, and where `target` sits among them. */
const shapeOf = (doc: Document, target: unknown): { shape: string[]; at: number } => {
  const shape: string[] = [];
  let at = -1;
  visit(doc, (_key, node) => {
    if (node === target) at = shape.length;
    if (isScalar(node)) shape.push(scalarKey(node.value));
    else if (isAlias(node)) shape.push(`*${node.source}`);
    else shape.push(isPair(node) ? ":" : isMap(node) ? "{" : "[");
  });
  return { shape, at };
};

// A refill must change the blank's value to the saved one and nothing else, or it is not used.
const onlyTargetChanged = (
  before: Document,
  target: Scalar,
  after: Document,
  value: unknown,
): boolean => {
  const { shape, at } = shapeOf(before, target);
  const next = shapeOf(after, null).shape;
  return (
    at >= 0 &&
    next.length === shape.length &&
    next.every((entry, index) =>
      index === at ? entry === scalarKey(value) : entry === shape[index],
    )
  );
};

const refillOne = (
  text: string,
  path: Segment[],
  source: string,
  sourceDoc: Document,
): string | null => {
  const doc = parse(text);
  const target = doc ? findUnique(doc, path) : null;
  const saved = findUnique(sourceDoc, path);
  if (!doc || !isScalar(target) || target.value !== "" || !isScalar(saved)) return null;
  if (saved.value === null || saved.value === "") return null;
  const candidate = withSavedScalar(text, doc, target, source, sourceDoc, saved);
  const after = parse(candidate);
  return after && onlyTargetChanged(doc, target, after, saved.value) ? candidate : null;
};

/** Refills the blanked secrets `ids` from the scalar at the same path in `source`; any it cannot match unambiguously stays `""`. */
export const restoreYamlSecrets = (redacted: string, ids: string[], source: string): string => {
  const sourceDoc = parse(source);
  const draftDoc = parse(redacted);
  if (!sourceDoc || !draftDoc) return redacted;
  const offset = (path: Segment[]) => {
    const node = findUnique(draftDoc, path);
    return isScalar(node) ? rangeOf(node)[0] : -1;
  };
  // An item with no unique label has no identity to match, so its secrets are never refilled.
  const paths = ids
    .flatMap((id) => {
      const path = pathOfId(id);
      return path && path.every((s) => typeof s === "string" || "l" in s) ? [path] : [];
    })
    .sort((a, b) => offset(b) - offset(a));
  let text = redacted;
  for (const path of paths) text = refillOne(text, path, source, sourceDoc) ?? text;
  return text;
};

/** Of `ids`, the secrets still blank in `text`; one no longer in the text counts as resolved, and all count while it does not parse. */
export const blankYamlSecretKeys = (text: string, ids: string[]): string[] => {
  const doc = parse(text);
  return ids.filter((id) => {
    const path = pathOfId(id);
    if (!path) return false;
    if (!doc) return true;
    return findNodes(doc, path, true).some((node) => isScalar(node) && node.value === "");
  });
};

/** Blanked secrets that refilling from `saved` would not bring back as they are in `original`: changed, or not matchable at all. */
export const changedYamlSecrets = (
  redacted: RedactedYaml,
  original: string,
  saved: string,
): string[] => {
  const restored = parse(restoreYamlSecrets(redacted.text, redacted.ids, saved));
  const originalDoc = parse(original);
  return redacted.ids.filter((id) => {
    const path = pathOfId(id);
    const now = path && restored ? findUnique(restored, path) : null;
    const was = path && originalDoc ? findUnique(originalDoc, path) : null;
    return !(
      isScalar(now) &&
      isScalar(was) &&
      now.value !== "" &&
      scalarKey(now.value) === scalarKey(was.value)
    );
  });
};

/** A secret's id as shown to the user, e.g. `auth.api_keys[2]` or `auth.tokens[prod].value`. */
export const yamlSecretLabel = (id: string): string =>
  (pathOfId(id) ?? [])
    .map((segment) => {
      if (typeof segment === "string") return `.${segment}`;
      if ("i" in segment) return `[${segment.i}]`;
      return `[${segment.l.slice(segment.l.indexOf("=") + 1)}]`;
    })
    .join("")
    .replace(/^\./, "");

/** Blanks every secret scalar in place (by key name, anywhere under a secret key, or as the `value` of a secret-named entry) and secrets in commented-out lines; every other byte is kept. */
export const redactYamlSecrets = (yaml: string): RedactedYaml => {
  const redacted = secretEdits(yaml, false);
  if (redacted) return { text: applyEdits(yaml, redacted.edits), ids: redacted.ids };
  // Every secret is found through a secret-looking word, so unreadable text without one has nothing to blank.
  return SECRET_KEY_PATTERN.test(yaml)
    ? { text: "", ids: [YAML_NOT_STORED] }
    : { text: yaml, ids: [] };
};
