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

// DOM-free so it can run in `markdown.worker.ts`; its HTML is unsanitised until `markdown.ts` cleans it on the main thread.
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { Marked, type Token, type Tokens } from "marked";

/** The fence languages WP-08 renders as query blocks once the fence is closed (`30` §2.3). */
export const QUERY_LANGUAGES: ReadonlySet<string> = new Set(["sql", "promql", "vrl"]);

/** Only a block up to this size is formatted; a longer one is shown as text, so no render can outgrow the main thread's budget. */
export const MAX_PARSED_CHARS = 20_000;

/** The worker hands over HTML and text in parts no larger than this, so each one mounts within one frame's slice. */
export const PART_CHARS = 8_192;

/** An HTML part holds at most this many tags: sanitising, styling and laying out cost per element, and a part of 600 list items or cells took a frame 50-66 ms in the app on a desktop (Q1). */
export const PART_TAGS = 400;

/** Fences past this many in a block render as plain `<pre>` inside the HTML parts, so a block never creates more code components (Z2). */
export const MAX_CODE_PARTS = 40;

/** Highlighted HTML per block past this is dropped; the fences show plain (Z2). */
export const MAX_HIGHLIGHT_CHARS = 100_000;

// An open tag longer than this is never reopened in the next part; a link continues as a span, so every cut makes progress (Z1).
const MAX_REOPEN_CHARS = PART_CHARS / 4;

/** A text part holds at most this many lines: Chrome lays out a text node of many short lines at about 25 µs a line. */
export const PART_LINES = 400;

/** Fence code longer than this is shown unhighlighted; highlighting runs in the worker under the parse timeout. */
export const HIGHLIGHT_MAX_CHARS = 20_000;

/** A link or image URL longer than this renders as plain text, so one reference cannot multiply into megabytes. */
export const MAX_URL_CHARS = 2_048;

/** Image alt text past this is cut with "…": a broken image lays its alt out as one unbreakable run inside a tag no part can cut (Q7). */
export const MAX_ALT_CHARS = 300;

/** A render larger than max(8× its input, 1 MB) is replaced by the plain text, so output cannot outgrow input. */
export const MAX_OUTPUT_FACTOR = 8;

const MIN_OUTPUT_CAP = 1_000_000;

/** Wrapping a run of non-space characters is quadratic in Chrome (20k in 0.5 s); longer runs get a break opportunity this often. */
export const MAX_RUN_CHARS = 64;

/** Wider tables make the block text: marked pads every row to the header, so width multiplies memory. */
export const MAX_TABLE_COLUMNS = 64;

/** Header plus body cells of all the block's tables past this make the block text; counted as marked tokenises. */
export const MAX_TABLE_CELLS = 2_000;

// Twenty list levels is far past any real answer; each one is a recursion in marked.
const MAX_INDENT = 40;

// Marked recurses once per list or quote marker and per open emphasis, so a single line can overflow the stack.
const MAX_NESTING = 8;

// Marked's fence: a run of three or more, and a backtick fence's info string holds no backtick (```x``` is inline code).
const FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})(.*)$/;

const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)/;

const NESTING_PREFIX = /^(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t]))[ \t]*)+/;

const NESTING_MARKER = /[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t]))[ \t]*/g;

const DELIMITER_RUN = /\*+|_+|~+/g;

// A fence rendered into the HTML is one piece, so a part never cuts it into two boxes (Q6); its code is escaped, so `</pre>` only ends it.
const HTML_PIECE = /<pre[ >][\s\S]*?<\/pre>|<[^>]*>|[^<]+/g;

// A run of characters continues through these; any other tag starts a new line or cell.
const INLINE_TAGS: ReadonlySet<string> = new Set([
  "a",
  "code",
  "del",
  "em",
  "img",
  "span",
  "strong",
  "wbr",
]);

const VOID_TAGS: ReadonlySet<string> = new Set(["br", "hr", "img", "input", "wbr"]);

const BLOCK_END: ReadonlySet<string> = new Set([
  "blockquote",
  "div",
  "h2",
  "h3",
  "li",
  "ol",
  "p",
  "table",
  "tr",
  "ul",
]);

const BLOCK_START = /^[ \t]*(?:[-*+][ \t]|\d{1,9}[.)][ \t]|#{1,6}[ \t]|\|)/;

const MAX_LINKS = 10;

// The whitespace before a marker goes with it, so a chip sits against its word and never before punctuation.
const CLAIM_MARKER = /[ \t]*\[\^([A-Za-z0-9_-]{1,64})\]/g;

// Private-use characters hold a claim's place through escaping until the renderer writes its slot.
const CLAIM_SLOT = /\uE000(\d{1,3})\uE001/g;

const SLOT_CHARS = /[\uE000\uE001]/g;

const PARTIAL_CLAIM = /\[(\^[A-Za-z0-9_-]{0,64})?$/;

export const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

export const EXTERNAL_REL = "noopener noreferrer nofollow";

export const CLASSES = {
  h2: "text-base font-semibold text-text-heading leading-6 mt-4 mb-1.5 first:mt-0",
  h3: "text-sm font-semibold text-text-heading leading-5 mt-3 mb-1 first:mt-0",
  code: "rounded-default border-code-border bg-code-bg text-code-text border px-1 py-px font-mono text-xs",
  link: "text-text-link-hover underline underline-offset-2 hover:no-underline",
  host: "text-text-secondary ms-1 text-xs",
  meta: "text-text-secondary text-xs",
  image: "rounded-default my-1 max-h-80 max-w-full",
  tableWrap: "my-2 min-w-0 overflow-x-auto",
  table:
    "w-full border-collapse text-sm [&_td]:border-b [&_td]:border-border-default [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_th]:border-b [&_th]:border-border-default [&_th]:px-2 [&_th]:py-1 [&_th]:font-semibold [&_th]:text-text-heading",
  tableSplit:
    "w-max min-w-full table-fixed border-collapse text-sm [&_td]:w-32 [&_td]:border-b [&_td]:border-border-default [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_th]:w-32 [&_th]:border-b [&_th]:border-border-default [&_th]:px-2 [&_th]:py-1 [&_th]:font-semibold [&_th]:text-text-heading",
  cellStart: "text-start",
  cellEnd: "text-end",
  cellCenter: "text-center",
  itemContinued: "list-none",
  pre: "rounded-default border-code-border bg-code-bg text-code-text my-2 overflow-x-auto border p-2 font-mono text-xs whitespace-pre",
} as const;

// Only the grammars the assistant's answers use; an unknown fence language is plain text (round 5 X4).
const GRAMMARS = {
  bash,
  go,
  ini,
  javascript,
  json,
  plaintext,
  python,
  rust,
  shell,
  sql,
  typescript,
  xml,
  yaml,
};

let parser: Marked | null = null;

let grammarsReady = false;

// The running budget of the parse in progress; renderers spend from it and throw once it is gone (Y7).
let budget = { left: 0, cells: 0, highlight: 0 };

// What the renderer needs from the page; the worker has no `window` and no i18n.
let page: { origin: string; imageRemoved: string } = {
  origin: "http://localhost",
  imageRemoved: "",
};

// Same-origin hrefs of the block being rendered; the main thread allowlists them into link cards.
let sameOrigin: string[] = [];

/** A piece of a rendered block: prose HTML of at most PART_CHARS (sanitised as it mounts), a fence, or text. */
export type MarkdownPart =
  | { kind: "html"; key: string; html: string }
  /** Text shown as text nodes: a placeholder, or a block that is not parsed; `segments` split long runs for `<wbr>`. */
  | { kind: "text"; key: string; text: string; segments?: string[] }
  | {
      kind: "code";
      key: string;
      lang: string;
      code: string;
      open: boolean;
      query: boolean;
      /** highlight.js output from the worker, for a closed fence of a known language. */
      highlighted?: string;
    };

// A tag open at a cut; a list also tracks its first item's number and the items opened since.
interface OpenTag {
  name: string;
  html: string;
  start: number;
  items: number;
  // Set once a long tag continues as a span: its end tag is written as this.
  close?: string;
}

/** One block to parse, with what the renderer needs from the page. */
export interface ParseRequest {
  blockId: string;
  text: string;
  state: "open" | "closed";
  origin: string;
  /** `assistant.message.imageRemoved`, translated on the main thread. */
  imageRemoved: string;
}

/** A parsed block; `html` parts are not yet sanitised. */
export interface ParseResult {
  /** Why the block was not parsed but shown as plain text; absent for a parsed block. */
  rejected?: ShapeRisk;
  parts: MarkdownPart[];
  /** `[^call_id]` markers in order of first citation; each sits in the HTML as `<wbr data-claim="index">`. */
  claims: string[];
  /** Same-origin link targets (path and query), at most MAX_LINKS; never rendered as anchors. */
  links?: string[];
  /** The block as a reader would paste it (Copy answer). */
  plain: string;
}

function instance(): Marked {
  if (parser) return parser;
  parser = new Marked({ gfm: true, breaks: true, async: false });
  parser.use({
    tokenizer: {
      // Measured with marked's own table rule before it builds a cell, in any container; over the caps the block is text (Y1).
      table(src) {
        const cap = this.rules.block.table.exec(src);
        if (!cap || !this.rules.other.tableDelimiter.test(cap[2])) return false;
        const columns = cap[2].replace(this.rules.other.tableAlignChars, "").split("|").length;
        const rows = cap[3]?.trim()
          ? cap[3].replace(this.rules.other.tableRowBlankLine, "").split("\n").length
          : 0;
        budget.cells += columns * (rows + 1);
        if (columns > MAX_TABLE_COLUMNS || budget.cells > MAX_TABLE_CELLS)
          throw new OverBudget("table");
        return false;
      },
    },
    renderer: {
      heading({ tokens, depth }) {
        const tag = depth <= 2 ? "h2" : "h3";
        return `<${tag} class="${CLASSES[tag]}">${this.parser.parseInline(tokens)}</${tag}>`;
      },
      // Marked keeps a code span's raw text, so `&lt;b&gt;` shows as typed.
      codespan({ text }) {
        return spend(`<code class="${CLASSES.code}">${escapeHtml(text)}</code>`);
      },
      text(token) {
        if ("tokens" in token && token.tokens) return this.parser.parseInline(token.tokens);
        return spend(
          slots("escaped" in token && token.escaped ? token.text : escapeHtml(token.text)),
        );
      },
      // Raw HTML from the model is stripped; the text between its tags stays (EB-01 AC 3, SEC-04).
      html({ text, block }) {
        const kept = block ? htmlText(text) : "";
        return kept ? spend(`<p>${escapeHtml(kept).replace(/\n/g, "<br>")}</p>`) : "";
      },
      link({ href, tokens }) {
        return spend(linkHtml(href, this.parser.parseInline(tokens)));
      },
      image({ href, text }) {
        if (escapeAttr(href).length <= MAX_URL_CHARS && SAFE_DATA_IMAGE.test(href ?? ""))
          return spend(
            `<img src="${escapeAttr(href)}" alt="${escapeAttr(capAlt(text))}" class="${CLASSES.image}">`,
          );
        return spend(`<span class="${CLASSES.meta}">${escapeHtml(page.imageRemoved)}</span>`);
      },
      // A fence inside a list or quote, or past MAX_CODE_PARTS, is plain text in a `<pre>`, never a component.
      code({ text }) {
        return spend(`<pre class="${CLASSES.pre}"><code>${escapeHtml(text)}</code></pre>`);
      },
      // Text cells only: a table is plain HTML, never a component per cell (Y3).
      table(token) {
        const cell = (tag: "th" | "td", item: Tokens.TableCell) => {
          // A th centres by default, so a left or unaligned header cell says start itself.
          const align =
            item.align === "right"
              ? CLASSES.cellEnd
              : item.align === "center"
                ? CLASSES.cellCenter
                : tag === "th"
                  ? CLASSES.cellStart
                  : "";
          return spend(
            `<${tag}${align && ` class="${align}"`}>${slots(escapeHtml(inlinePlain(item.tokens, true)))}</${tag}>`,
          );
        };
        const head = `<thead><tr>${token.header.map((item) => cell("th", item)).join("")}</tr></thead>`;
        const body = token.rows
          .map((row) => `<tr>${row.map((item) => cell("td", item)).join("")}</tr>`)
          .join("");
        // A table cut into parts keeps its columns aligned only with a fixed layout of equal columns.
        const cls =
          head.length + body.length > PART_CHARS * 0.75 ? CLASSES.tableSplit : CLASSES.table;
        return `<div class="${CLASSES.tableWrap}"><table class="${cls}">${head}<tbody>${body}</tbody></table></div>`;
      },
      checkbox({ checked }) {
        return checked ? "☑ " : "☐ ";
      },
    },
  });
  return parser;
}

/** Why a block is shown as plain text without parsing. */
export type ShapeRisk = "size" | "nesting" | "emphasis" | "output" | "table";

// Thrown by a renderer or the table rule once the block is over a budget; the parse then returns the block as text.
class OverBudget extends Error {
  constructor(readonly risk: ShapeRisk) {
    super(risk);
  }
}

/** Guard, lex and render one block; an unsafe shape or any throw falls back to the escaped text (`markdown_bomb`). */
export function parseBlock(request: ParseRequest): ParseResult {
  page = { origin: request.origin, imageRemoved: request.imageRemoved };
  sameOrigin = [];
  const claims: string[] = [];
  const risk = riskOf(request.text);
  if (risk) return { ...plainResult(request.blockId, request.text), rejected: risk };
  budget = {
    left: Math.max(request.text.length * MAX_OUTPUT_FACTOR, MIN_OUTPUT_CAP),
    cells: 0,
    highlight: MAX_HIGHLIGHT_CHARS,
  };
  try {
    const open = request.state === "open";
    // Only a streaming block closes its own unterminated fence; a completed one is lexed exactly as sent (X11).
    // The model's own slot characters go before lexing, so no code span or alt text can forge a slot.
    const source = request.text.replace(SLOT_CHARS, "");
    const repaired = open ? repairFence(source) : { text: source, open: false };
    const tokens = instance().lexer(repaired.text);
    // Markers come out of prose only; code keeps `[^0-9]` and every other bracket as written.
    stripClaims(tokens, claims, open);
    spend(claims.join(""));
    const parts = partsOf(request.blockId, tokens, repaired.open);
    const plain = spend(
      tokens.map(plainOf).filter(Boolean).join("\n\n").replace(CLAIM_SLOT, "").trim(),
    );
    // Highlighting spends only what the render left over, so it is dropped before a block is ever rejected (Y5).
    return { parts: parts.map(highlightPart), claims, links: [...sameOrigin], plain };
  } catch (error) {
    const rejected = error instanceof OverBudget ? error.risk : undefined;
    return { ...plainResult(request.blockId, request.text), ...(rejected && { rejected }) };
  }
}

function spend(text: string): string {
  budget.left -= text.length;
  if (budget.left < 0) throw new OverBudget("output");
  return text;
}

/** The block as text, in parts of at most PART_CHARS split at line ends: the fallback for a parse that failed, was rejected or ran out of time. */
export function plainResult(blockId: string, text: string): ParseResult {
  const parts: MarkdownPart[] = [];
  let start = 0;
  while (start < text.length || parts.length === 0) {
    let end = Math.min(text.length, start + PART_CHARS);
    const newline = text.lastIndexOf("\n", end - 1);
    if (end < text.length && newline > start) end = newline + 1;
    end = Math.min(end, lineEnd(text, start, PART_LINES));
    parts.push(textPart(`${blockId}:${parts.length}`, text.slice(start, end)));
    start = end;
  }
  return { parts, claims: [], plain: text };
}

/** A text part; runs longer than MAX_RUN_CHARS are split into segments the message joins with `<wbr>`. */
export function textPart(key: string, text: string): Extract<MarkdownPart, { kind: "text" }> {
  const segments = runSegments(text);
  return segments ? { kind: "text", key, text, segments } : { kind: "text", key, text };
}

// One pass over the characters: the regex for a 65-character run retried at every position and cost a history's first render 18 ms at 4x.
function runSegments(text: string): string[] | undefined {
  let segments: string[] | undefined;
  let start = 0;
  let run = 0;
  for (let i = 0; i < text.length; i++) {
    if (isBreak(text.charCodeAt(i))) {
      run = 0;
      continue;
    }
    run += 1;
    if (run <= MAX_RUN_CHARS) continue;
    (segments ??= []).push(text.slice(start, i));
    start = i;
    run = 1;
  }
  segments?.push(text.slice(start));
  return segments;
}

// Only ASCII whitespace breaks a run: Chrome glues U+00A0 to its neighbours (Y8).
function isBreak(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 12 || code === 13;
}

// Where the `lines`-th line after `start` ends, or the end of the text.
function lineEnd(text: string, start: number, lines: number): number {
  let at = start;
  for (let n = 0; n < lines; n++) {
    const newline = text.indexOf("\n", at);
    if (newline < 0) return text.length;
    at = newline + 1;
  }
  return at;
}

// A `<wbr>` after every MAX_RUN_CHARS visible characters without ASCII whitespace, counted across inline tags and never inside a tag or an entity (Y8).
function breakHtmlRuns(html: string): string {
  let out = "";
  let run = 0;
  let last = 0;
  let i = 0;
  while (i < html.length) {
    const char = html[i];
    if (char === "<") {
      const close = html.indexOf(">", i);
      const name = /^<\/?([a-z0-9]+)/.exec(html.slice(i, i + 12))?.[1] ?? "";
      if (!INLINE_TAGS.has(name)) run = 0;
      i = close < 0 ? html.length : close + 1;
      continue;
    }
    const entity = char === "&" ? html.indexOf(";", i) : -1;
    const next = entity > i && entity - i <= 10 ? entity + 1 : i + 1;
    run = /[\t\n\f\r ]/.test(char) ? 0 : run + 1;
    if (run > MAX_RUN_CHARS) {
      out += html.slice(last, i) + "<wbr>";
      last = i;
      run = 1;
    }
    i = next;
  }
  return out + html.slice(last);
}

// Collects `[^id]` markers from text leaves in order; while streaming, a marker split at the very end is held back.
function stripClaims(tokens: Token[], claims: string[], open: boolean): void {
  const leaves: Token[] = [];
  collectLeaves(tokens, leaves);
  for (const leaf of leaves) {
    if (leaf.type !== "text") continue;
    const textLeaf = leaf as Tokens.Text;
    textLeaf.text = textLeaf.text.replace(CLAIM_MARKER, (_all, id: string) => {
      if (!claims.includes(id)) claims.push(id);
      return `\uE000${claims.indexOf(id)}\uE001`;
    });
  }
  const last = leaves[leaves.length - 1] as Tokens.Text | undefined;
  if (open && last?.type === "text") last.text = last.text.replace(PARTIAL_CLAIM, "");
}

function collectLeaves(tokens: Token[], out: Token[]): void {
  for (const token of tokens) {
    if (token.type === "table") {
      const table = token as Tokens.Table;
      for (const cell of [...table.header, ...table.rows.flat()]) collectLeaves(cell.tokens, out);
      continue;
    }
    if (token.type === "list") {
      collectLeaves((token as Tokens.List).items, out);
      continue;
    }
    const nested = (token as { tokens?: Token[] }).tokens;
    if (token.type !== "code" && token.type !== "codespan" && nested?.length)
      collectLeaves(nested, out);
    else out.push(token);
  }
}

function partsOf(blockId: string, tokens: Token[], lastFenceOpen: boolean): MarkdownPart[] {
  const parts: MarkdownPart[] = [];
  let pending: Token[] = [];
  const flush = () => {
    if (!pending.length) return;
    for (const html of splitHtml(breakHtmlRuns(instance().parser(pending))))
      if (html.trim()) parts.push({ kind: "html", key: `${blockId}:${parts.length}`, html });
    pending = [];
  };
  const lastCode = findLastIndex(tokens, (token) => token.type === "code");
  let codeParts = 0;
  tokens.forEach((token, index) => {
    if (token.type !== "code" || codeParts >= MAX_CODE_PARTS) return void pending.push(token);
    codeParts += 1;
    flush();
    const open = lastFenceOpen && index === lastCode;
    parts.push(codePart(`${blockId}:${parts.length}`, token as Tokens.Code, open));
  });
  flush();
  return parts;
}

function codePart(key: string, token: Tokens.Code, open: boolean): MarkdownPart {
  const lang = (token.lang ?? "").trim().split(/\s+/)[0].toLowerCase();
  spend(token.text);
  return {
    kind: "code",
    key,
    lang: lang || "plaintext",
    code: token.text,
    open,
    query: !open && QUERY_LANGUAGES.has(lang),
  };
}

function highlightPart(part: MarkdownPart): MarkdownPart {
  if (part.kind !== "code" || part.open || part.lang === "plaintext") return part;
  const highlighted = highlight(part.code, part.lang);
  const size = highlighted?.length ?? 0;
  if (highlighted === undefined || size > budget.left || size > budget.highlight) return part;
  budget.left -= size;
  budget.highlight -= size;
  return { ...part, highlighted };
}

// Cuts rendered HTML into parts of at most PART_CHARS and about PART_TAGS tags, preferably after a block element, closing the open tags and reopening them in the next part (Y2).
function splitHtml(html: string): string[] {
  if (html.length <= PART_CHARS && (html.match(/<[a-z]/g)?.length ?? 0) <= PART_TAGS) return [html];
  const parts: string[] = [];
  const stack: OpenTag[] = [];
  let out = "";
  let tags = 0;
  // Nothing but reopened tags since the last cut: the next piece goes in whatever its size, so the loop always consumes input.
  let fresh = true;
  const closer = (tag: OpenTag) => `</${tag.close ?? tag.name}>`;
  // Room left in the part once the open tags are closed.
  const room = () => PART_CHARS - out.length - stack.reduce((n, tag) => n + closer(tag).length, 0);
  const cut = () => {
    tags = 0;
    const closing = stack.map(closer).reverse().join("");
    parts.push(out + closing);
    out = stack.map(reopen).join("");
    fresh = true;
    // Closing and reopening repeat markup, so each cut spends from the block's output budget.
    spend(closing + out);
  };
  for (const [piece] of html.matchAll(HTML_PIECE)) {
    if (piece[0] !== "<") {
      let rest = piece;
      while (rest.length > room()) {
        // The reopened tags alone may leave negative room; once the text is all placed the loop is done (Q9).
        if (!rest) break;
        // A fresh part always takes some text, at least MAX_REOPEN_CHARS, even if the reopened tags leave no room.
        const space = fresh ? Math.max(room(), MAX_REOPEN_CHARS) : room();
        const at = textCut(rest, space);
        // An entity or a surrogate pair that does not fit moves whole to the next part.
        if (fresh || at <= space) {
          out += rest.slice(0, at);
          rest = rest.slice(at);
          fresh = false;
        }
        if (rest) cut();
      }
      out += rest;
      if (rest) fresh = false;
      continue;
    }
    if (piece.startsWith("<pre")) {
      // Kept whole even past PART_CHARS: one text node in one box, never cut mid-line into two (Q6).
      const inner = piece.match(/<[a-z]/g)?.length ?? 1;
      if ((piece.length > room() || tags + inner > PART_TAGS) && !fresh) cut();
      tags += inner;
      out += piece;
      fresh = false;
      if (out.length >= PART_CHARS * 0.75) cut();
      continue;
    }
    const close = /^<\/([a-z0-9]+)/.exec(piece);
    if (close) {
      const top = stack[stack.length - 1];
      if (top?.name === close[1]) stack.pop();
      out += top?.name === close[1] ? closer(top) : piece;
      fresh = false;
      // A part nearly full of characters or tags ends at a block's end, so a table row is never cut in two.
      if (BLOCK_END.has(close[1]) && (out.length >= PART_CHARS * 0.75 || tags >= PART_TAGS * 0.75))
        cut();
      continue;
    }
    const name = /^<([a-z0-9]+)/.exec(piece)?.[1] ?? "";
    const closes = !VOID_TAGS.has(name);
    if ((piece.length + (closes ? name.length + 3 : 0) > room() || tags >= PART_TAGS) && !fresh)
      cut();
    tags += 1;
    out += piece;
    fresh = false;
    if (name === "li" && stack.length) stack[stack.length - 1].items += 1;
    if (closes) stack.push(openTag(name, piece));
  }
  if (out) parts.push(out);
  return parts;
}

function openTag(name: string, html: string): OpenTag {
  const start = name === "ol" ? Number(/ start="(\d+)"/.exec(html)?.[1] ?? 1) : 1;
  return { name, html, start, items: 0 };
}

// A list reopens numbered after the items already shown; an item cut in two continues without a second marker.
function reopen(tag: OpenTag, index: number, stack: OpenTag[]): string {
  if (tag.name === "li") return `<li class="${CLASSES.itemContinued}">`;
  if (tag.html.length > MAX_REOPEN_CHARS) {
    tag.close = "span";
    return "<span>";
  }
  if (tag.name !== "ol") return tag.html;
  const inItem = stack[index + 1]?.name === "li";
  tag.start += tag.items - (inItem ? 1 : 0);
  tag.items = inItem ? 1 : 0;
  return `<ol start="${tag.start}">`;
}

function capAlt(text: string): string {
  const chars = Array.from(text);
  return chars.length > MAX_ALT_CHARS ? `${chars.slice(0, MAX_ALT_CHARS).join("")}…` : text;
}

// Where to cut a text run to fit `room`: never inside an entity or a surrogate pair, and at least one character.
function textCut(text: string, room: number): number {
  let at = Math.max(1, Math.min(room, text.length));
  const amp = text.lastIndexOf("&", at - 1);
  if (amp >= 0 && at - amp < 10 && text.indexOf(";", amp) >= at)
    at = amp || text.indexOf(";", amp) + 1;
  const code = text.charCodeAt(at - 1);
  if (code >= 0xd800 && code <= 0xdbff) at = at > 1 ? at - 1 : at + 1;
  return at;
}

// Only http(s) leaves the app, in a new tab; a same-origin route becomes a link card once WP-08 allowlists it, until then plain text (round 1 E-06).
function linkHtml(href: string | null | undefined, label: string): string {
  if ((href ?? "").length > MAX_URL_CHARS) return `<span>${label}</span>`;
  const url = parseUrl(href);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:"))
    return `<span>${label}</span>`;
  if (url.origin === page.origin) {
    const path = url.pathname + url.search;
    if (sameOrigin.length < MAX_LINKS && !sameOrigin.includes(path)) sameOrigin.push(path);
    return `<span>${label}</span>`;
  }
  // `&` and `'` survive URL parsing and escape to five characters each, so the cap applies to the attribute as written (Z1).
  const attr = escapeAttr(url.href);
  if (attr.length > MAX_URL_CHARS) return `<span>${label}</span>`;
  const host = escapeHtml(url.host);
  return `<a href="${attr}" target="_blank" rel="${EXTERNAL_REL}" class="${CLASSES.link}">${label}</a><span class="${CLASSES.host}">${host}</span>`;
}

/** An href as a URL against the page origin, or `null`; the sanitiser re-checks links with it. */
export function parseUrl(href: string | null | undefined, origin = page.origin): URL | null {
  if (!href) return null;
  // Control characters and spaces inside a scheme are how `java\tscript:` slips past naive checks.
  const cleaned = href.replace(/[\p{Cc}\s]+/gu, "");
  try {
    return new URL(cleaned, origin);
  } catch {
    return null;
  }
}

function highlight(code: string, lang: string): string | undefined {
  if (!grammarsReady) {
    for (const [name, grammar] of Object.entries(GRAMMARS)) hljs.registerLanguage(name, grammar);
    grammarsReady = true;
  }
  if (!lang || code.length > HIGHLIGHT_MAX_CHARS || !hljs.getLanguage(lang)) return undefined;
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return undefined;
  }
}

// An unterminated fence mid-stream closes at the end, so the rest of the answer never renders as code (constraint 4).
function repairFence(text: string): { text: string; open: boolean } {
  const marker = scanFences(text.split("\n")).open;
  if (marker === null) return { text, open: false };
  return { text: `${text}\n${marker}`, open: true };
}

// Which lines are code fences (opener, body, closer), by marked's rules, including fences nested in list items.
function scanFences(lines: string[]): { inFence: boolean[]; open: string | null } {
  const inFence: boolean[] = [];
  let marker: string | null = null;
  let closerIndent = 3;
  let listIndent = 0;
  let previousBlank = true;
  for (const line of lines) {
    if (marker !== null) {
      inFence.push(true);
      if (closesFence(marker, line, closerIndent)) marker = null;
      continue;
    }
    const blank = !line.trim();
    const item = LIST_ITEM.exec(line);
    if (item) listIndent = width(item[1]) + item[2].length + Math.min(width(item[3]), 4);
    else if (!blank && previousBlank && width(/^[ \t]*/.exec(line)?.[0] ?? "") === 0)
      listIndent = 0;
    marker =
      fenceOpen(line, 3 + listIndent) ?? (item ? fenceOpen(line.slice(item[0].length), 3) : null);
    closerIndent = 3 + (item ? width(item[0]) : listIndent);
    inFence.push(marker !== null);
    previousBlank = blank;
  }
  return { inFence, open: marker };
}

function fenceOpen(line: string, maxIndent: number): string | null {
  const match = FENCE_OPEN.exec(line);
  if (!match || width(match[1]) > maxIndent) return null;
  if (match[2][0] === "`" && match[3].includes("`")) return null;
  return match[2];
}

// Marked closes a fence only on a run of the opener's character, at least as long, indented at most 3 within its container.
function closesFence(marker: string, line: string, maxIndent: number): boolean {
  const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
  if (width(indent) > maxIndent) return false;
  const run = line.slice(indent.length).replace(/[ \t]+$/, "");
  return run.length >= marker.length && /^(`+|~+)$/.test(run) && run[0] === marker[0];
}

function width(indent: string): number {
  return indent.replace(/\t/g, "    ").length;
}

/** Decides parse or plain text from the block's shape; it never rewrites the text, so code stays exactly as sent. */
export function riskOf(text: string): ShapeRisk | null {
  if (text.length > MAX_PARSED_CHARS) return "size";
  const lines = text.split("\n");
  const code = codeLines(lines);
  let paragraph: string[] = [];
  for (let i = 0; i <= lines.length; i++) {
    const line = lines[i];
    if (line === undefined || code[i] || !line.trim()) {
      if (openEmphasis(paragraph) > MAX_NESTING) return "emphasis";
      paragraph = [];
      continue;
    }
    if (nestingTooDeep(line)) return "nesting";
    paragraph.push(line);
  }
  return null;
}

// Fenced (also inside quotes) and indented code: what the shape check never counts, so code alone never makes a block plain.
function codeLines(lines: string[]): boolean[] {
  const inner = lines.map((line) => line.replace(/^(?: {0,3}>[ \t]?)+/, ""));
  const { inFence } = scanFences(inner);
  let previous = { blank: true, code: false };
  return inner.map((line, i) => {
    const blank = !line.trim();
    const indented =
      !blank && width(/^[ \t]*/.exec(line)?.[0] ?? "") >= 4 && (previous.blank || previous.code);
    const code = inFence[i] || indented;
    previous = { blank, code };
    return code;
  });
}

function nestingTooDeep(line: string): boolean {
  const indent = width(/^[ \t]*/.exec(line)?.[0] ?? "");
  if (indent > MAX_INDENT && LIST_ITEM.test(line)) return true;
  const prefix = NESTING_PREFIX.exec(line)?.[0] ?? "";
  return (prefix.match(NESTING_MARKER) ?? []).length > MAX_NESTING;
}

// The most delimiter runs open at once; a list item, heading or table row starts its own inline context. A guess at marked: the worker's timeout bounds it.
function openEmphasis(lines: string[]): number {
  // Code spans may run across lines, so they are blanked over the whole paragraph before counting.
  const prose = outsideCodespans(
    lines.join("\n"),
    (part) => part,
    (span) => span.replace(/[^\n]/g, " "),
  );
  let open: Record<string, number> = {};
  let max = 0;
  for (const line of prose.split("\n")) {
    if (BLOCK_START.test(line)) open = {};
    for (const run of line.matchAll(DELIMITER_RUN)) {
      const char = run[0][0];
      const before = line[run.index - 1] ?? " ";
      const after = line[run.index + run[0].length] ?? " ";
      if (!/\s/.test(before) && (open[char] ?? 0) > 0) open[char] -= 1;
      else if (!/\s/.test(after)) open[char] = (open[char] ?? 0) + 1;
      max = Math.max(max, (open["*"] ?? 0) + (open._ ?? 0) + (open["~"] ?? 0));
    }
  }
  return max;
}

// Applies `edit` to the text between inline code spans; a span's backticks pair only with a run of the same length.
function outsideCodespans(
  text: string,
  edit: (part: string) => string,
  code: (span: string) => string = (span) => span,
): string {
  let out = "";
  let start = 0;
  let i = 0;
  while (i < text.length) {
    // An escaped backtick is a literal to marked, never the start of a code span.
    if (text[i] !== "`" || escaped(text, i)) {
      i += 1;
      continue;
    }
    let run = i;
    while (text[run] === "`") run += 1;
    const ticks = text.slice(i, run);
    const close = findTicks(text, ticks, run);
    if (close < 0) {
      i = run;
      continue;
    }
    out += edit(text.slice(start, i)) + code(text.slice(i, close + ticks.length));
    start = close + ticks.length;
    i = start;
  }
  return out + edit(text.slice(start));
}

function escaped(text: string, at: number): boolean {
  let slashes = 0;
  for (let i = at - 1; i >= 0 && text[i] === "\\"; i--) slashes += 1;
  return slashes % 2 === 1;
}

function findTicks(text: string, ticks: string, from: number): number {
  let at = text.indexOf(ticks, from);
  while (at >= 0) {
    const end = at + ticks.length;
    if (text[at - 1] !== "`" && text[end] !== "`") return at;
    let next = end;
    while (text[next] === "`") next += 1;
    at = text.indexOf(ticks, next);
  }
  return -1;
}

function plainOf(token: Token): string {
  switch (token.type) {
    case "code":
      return (token as Tokens.Code).text;
    case "table": {
      const table = token as Tokens.Table;
      const header = table.header.map((cell) => inlinePlain(cell.tokens)).join("\t");
      const rows = table.rows.map((row) => row.map((cell) => inlinePlain(cell.tokens)).join("\t"));
      return [header, ...rows].join("\n");
    }
    case "blockquote":
      return ((token as Tokens.Blockquote).tokens ?? []).map(plainOf).filter(Boolean).join("\n\n");
    case "list":
      return listPlain(token as Tokens.List);
    case "html":
      return htmlText((token as Tokens.HTML).text);
    case "space":
    case "hr":
      return "";
    default: {
      const nested = (token as { tokens?: Token[] }).tokens;
      if (nested) return inlinePlain(nested);
      return (token as { text?: string }).text ?? "";
    }
  }
}

// Copy keeps nesting and numbering: an item's later lines and nested lists are indented under its marker (X10).
function listPlain(list: Tokens.List): string {
  const start = typeof list.start === "number" ? list.start : 1;
  return list.items
    .map((item, index) => {
      const marker = list.ordered ? `${start + index}. ` : "- ";
      const body = (item.tokens ?? []).map(plainOf).filter(Boolean).join("\n").trim();
      const pad = " ".repeat(marker.length);
      return marker + body.split("\n").join(`\n${pad}`);
    })
    .join("\n");
}

function inlinePlain(tokens: Token[] | undefined, keepSlots = false): string {
  const text = (tokens ?? [])
    .map((token) => {
      if (token.type === "image") return (token as Tokens.Image).text;
      if (token.type === "br") return "\n";
      if (token.type === "html") return "";
      if (token.type === "codespan") return (token as Tokens.Codespan).text;
      const nested = (token as { tokens?: Token[] }).tokens;
      if (nested) return inlinePlain(nested, true);
      return decodeEntities((token as { text?: string }).text ?? "");
    })
    .join("");
  return keepSlots ? text : text.replace(CLAIM_SLOT, "");
}

// A void tag is one piece to the splitter, so a cut never repeats a slot in two parts.
function slots(html: string): string {
  return html.replace(CLAIM_SLOT, '<wbr data-claim="$1">');
}

// The text of a raw HTML block: tags, comments and script or style bodies go, the words stay.
function htmlText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(stripped).trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** FNV-1a: cheap next to the parse it saves, and enough to tell two texts of one length apart. */
export function contentHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(text: string | null | undefined): string {
  return escapeHtml(text ?? "");
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (predicate(items[i])) return i;
  return -1;
}
