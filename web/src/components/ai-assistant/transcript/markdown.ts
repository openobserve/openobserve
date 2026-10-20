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

import DOMPurify from "dompurify";
import {
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  type Ref,
  watch,
  type PropType,
  type ShallowRef,
} from "vue";

import { gt } from "@/types/i18n";

import {
  CLASSES,
  contentHash,
  EXTERNAL_REL,
  PART_CHARS,
  PART_LINES,
  parseBlock,
  parseUrl,
  plainResult,
  SAFE_DATA_IMAGE,
  type MarkdownPart,
  type ParseRequest,
  type ParseResult,
} from "./markdownCore";

export { MAX_PARSED_CHARS, type MarkdownPart } from "./markdownCore";

/** Rendered blocks kept for re-renders; a completed block is never parsed twice (HT-08 AC 2). */
export const MEMO_LIMIT = 400;

/** A worker job running longer than this (plus 1 ms per 1k characters) is abandoned: the worker is terminated and the block shown as text. */
export const PARSE_TIMEOUT_MS = 1_500;

/** A worker that has not said it is ready by then counts as a failed load; one failed load is retried. */
export const WORKER_LOAD_TIMEOUT_MS = 10_000;

// Blocks posted to the worker in one message; each one is still timed on its own.
const BATCH_SIZE = 16;

// Hashes of completed blocks that ran out of time twice; content is never stored, only `${length}:${hash}`.
const KNOWN_BAD_KEY = "o2.assistant.markdownPlain";

const KNOWN_BAD_LIMIT = 200;

// Main-thread script per frame for filling parts; a part is at most PART_CHARS, so one never runs far past it.
const MOUNT_SLICE_MS = 8;

// Most characters filled per frame; small parts share a frame and a full part takes one.
const MOUNT_FRAME_CHARS = PART_CHARS;

// The style and layout of a slice's insertions come after it, so the frame-to-frame time sets the next slice's size: a frame over this shrinks it (Q1).
const FRAME_TARGET_MS = 33;

const MIN_FRAME_CHARS = 512;

// A text part is one node, so it weighs a quarter of HTML of the same length, but a full part of short lines weighs a whole frame.
const TEXT_WEIGHT = 0.25;

// Parts of landed blocks re-rendered per frame: each new part is a component, and a history lands many blocks at once.
const BUMP_FRAME_PARTS = 24;

// A code block's component costs more than its characters: its toolbar, copy button and highlight spans.
const CODE_WEIGHT = 2_048;

// Per tab (sessionStorage, which survives the tab's reload after a crash): the block the worker is parsing, and the one in flight at the last crash with its count (Q3).
const PARSING_KEY = "o2.assistant.markdownParsing";

// A block in flight at this many crashes of a tab in a row is shown as text for good.
const CRASH_STRIKES = 2;

const KNOWN_BAD_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

// highlight.js output is only spans with hljs classes around escaped text; anything else is dropped to plain code.
const HIGHLIGHT_PIECE = /<span class="([^"<>]*)">|<\/span>|[^<>]+/y;

// Each class of a highlight span on its own: hljs scopes, a language, or a sub-scope like `function_` (Y6).
const HIGHLIGHT_CLASS = /^(?:hljs-[a-z_-]+|language-[\w-]+|[a-z]+_+)$/;

const ALLOWED_CLASSES: ReadonlySet<string> = new Set(Object.values(CLASSES));

// The renderer writes every tag itself; the sanitiser is the second wall, so it allows only what the renderer emits.
const PURIFY = {
  ALLOWED_TAGS: [
    "a",
    "blockquote",
    "br",
    "code",
    "del",
    "div",
    "em",
    "h2",
    "h3",
    "hr",
    "img",
    "li",
    "ol",
    "p",
    "pre",
    "span",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
    "wbr",
  ],
  ALLOWED_ATTR: ["href", "target", "rel", "class", "alt", "src", "start", "data-claim"],
  ALLOW_DATA_ATTR: false,
  // A slot's value is an index, not a URL, so the URL rule must not drop it.
  ADD_URI_SAFE_ATTR: ["data-claim"],
  ALLOW_ARIA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:https?:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i,
};

/** The worker's parse run in place, for specs; app code never parses on the main thread. */
export const syncMarkdownParserForTests: MarkdownParser = {
  sync: true,
  run(requests, events) {
    requests.forEach((request, index) => {
      events.start(index);
      events.done(index, parseBlock(request));
    });
  },
  reset: () => undefined,
};

// No worker to be had (none in this environment, or it failed to load twice): every block stays text (X9).
const plainParser: MarkdownParser = {
  sync: true,
  run(requests, events) {
    requests.forEach((request, index) => {
      events.start(index);
      events.done(index, plainResult(request.blockId, request.text));
    });
  },
  reset: () => undefined,
};

const memo = new Map<string, RenderedBlock>();

// The last render of each block, so a part a delta did not change keeps its object and its components never update.
const latest = new Map<string, RenderedBlock>();

const latestKeys = new Map<string, string>();

const placeholders = new Map<string, { key: string; block: RenderedBlock }>();

const keys = new Map<string, string>();

// Copy answer reads the plain text the render already produced, keyed by the block's text.
const plainCache = new Map<string, string>();

// Timeouts per block: a streaming block parses only with none, a completed one gets one retry (X6).
const failures = new Map<string, number>();

// One version per block a mounted message shows; it lives while any message holds the block, so none is ever orphaned (F16).
const versions = new Map<string, ShallowRef<number>>();

const holds = new Map<string, number>();

const fills = new Set<Fill>();

const bumps = new Set<string>();

// One observer per scroll container, released with its last part, so an unmounted transcript is never kept (F18).
const observers = new Map<Element | null, { observer: IntersectionObserver; count: number }>();

const targets = new WeakMap<Element, Fill>();

const rootOf = new WeakMap<Element, Element | null>();

let mountFrame = false;

let frameChars = MOUNT_FRAME_CHARS;

let lastFrameAt: number | null = null;

let fillSeq = 0;

const queue = new Map<string, Job>();

const waiters = new Map<string, ((plain: string) => void)[]>();

let batch: { jobs: Job[]; next: number } | null = null;

let timer: ReturnType<typeof setTimeout> | null = null;

let pumpQueued = false;

// A result that lands inside a render is returned by that render; one that lands later re-renders its block.
let rendering = false;

let active: MarkdownParser | null = null;

// Key to the time it was marked; entries older than KNOWN_BAD_TTL_MS are dropped on load.
let knownBad: Map<string, number> | null = null;

let parseCount = 0;

let crashMarker: CrashMarker | null = null;

export interface RenderedBlock {
  blockId: string;
  parts: MarkdownPart[];
  /** `[^call_id]` markers in order of first citation; WP-08 renders them as claim chips (EB-05). */
  claims: string[];
  /** Same-origin link targets the answer named; link cards only for allowlisted routes. */
  links: string[];
  /** A completed block shown as text for good: its shape or output was rejected, or it ran out of time twice. */
  plain: boolean;
}

/** What the worker reports per job; the scheduler times a job from its `start`. */
export interface ParserEvents {
  start(index: number): void;
  done(index: number, result: ParseResult): void;
  fail(reason: "unavailable" | "crashed"): void;
}

/** Where blocks are parsed: the Web Worker in the app; specs inject `syncMarkdownParserForTests`. */
export interface MarkdownParser {
  /** Answers within the call, so a render can use its result at once (specs and the text-only fallback). */
  sync?: boolean;
  run(requests: ParseRequest[], events: ParserEvents): void;
  /** Abandons the jobs in flight; a worker is terminated and the next run starts a fresh one. */
  reset(): void;
}

type SlicedPart = Extract<MarkdownPart, { kind: "html" | "text" }>;

// One part's pending fill: every part fills once, the live answer first, then the nearest, then the newest.
interface Fill {
  run(): void;
  weight: number;
  live: boolean;
  distance: number;
  seq: number;
}

interface CrashMarker {
  // The block the worker is parsing now; a crash leaves it set.
  key: string | null;
  // The block in flight at the last crash, and at how many crashes in a row.
  suspect: string | null;
  strikes: number;
}

interface Job {
  blockId: string;
  text: string;
  state: "open" | "closed";
  key: string;
}

/** Renders blocks for one mounted message and keeps their versions until it unmounts. */
export function useRenderedMarkdown(): typeof renderMarkdown {
  const held = new Set<string>();
  onBeforeUnmount(() => {
    for (const blockId of held) release(blockId);
    held.clear();
  });
  return (blockId, text, state) => {
    if (!held.has(blockId)) {
      held.add(blockId);
      holds.set(blockId, (holds.get(blockId) ?? 0) + 1);
    }
    return renderMarkdown(blockId, text, state);
  };
}

/** One text block of an answer: the last render (or the text) at once, upgraded when the worker answers. */
export function renderMarkdown(
  blockId: string,
  text: string,
  state: "open" | "closed",
): RenderedBlock {
  void versionOf(blockId).value;
  // The hash guards a reused block id: a restored stream or another chat may reach the same length with other text.
  const key = `${blockId}\u0000${plainKey(text)}\u0000${state}`;
  const done = lookup(blockId, key, state);
  if (done) return done;
  const job = { blockId, text, state, key };
  if (state === "closed" && isKnownBad(text))
    return store(job, plainResult(blockId, text), { final: true });
  if (!allowed(blockId, state)) return store(job, plainResult(blockId, text), { final: false });
  rendering = true;
  try {
    schedule(job);
  } finally {
    rendering = false;
  }
  return lookup(blockId, key, state) ?? latest.get(blockId) ?? placeholder(job);
}

/** The answer as a reader would paste it (EB-09 AC 5), from the worker's parse; raw text when no parse can be had. */
export function markdownToPlainText(text: string): string | Promise<string> {
  const cached = plainCache.get(plainKey(text));
  if (cached !== undefined) return cached;
  if (isKnownBad(text)) return text;
  const key = plainKey(text);
  const job: Job = {
    blockId: `copy:${key}`,
    text,
    state: "closed",
    key: `copy:${key}\u0000closed`,
  };
  if (parser().sync) {
    schedule(job);
    return plainCache.get(key) ?? text;
  }
  return new Promise((resolve) => {
    waiters.set(key, [...(waiters.get(key) ?? []), resolve]);
    schedule(job);
  });
}

/** Parses landed since the last reset; the render-budget specs count it (EB-01 AC 4, PERF-02). */
export function markdownParseCount(): number {
  return parseCount;
}

/** Lets a spec choose the parser (usually `syncMarkdownParserForTests`), or `null` for the app's default; never called by app code. */
export function setMarkdownParserForTests(parser: MarkdownParser | null): void {
  active?.reset();
  active = parser;
}

/** Lets a spec start from an empty memo and queue; `reload` keeps the stored known-bad list, as a page reload does. Never called by app code. */
export function resetMarkdownForTests(opts: { reload?: boolean } = {}): void {
  for (const map of [
    memo,
    latest,
    latestKeys,
    placeholders,
    plainCache,
    keys,
    failures,
    versions,
    holds,
    queue,
    waiters,
  ])
    map.clear();
  fills.clear();
  bumps.clear();
  observers.clear();
  mountFrame = false;
  frameChars = MOUNT_FRAME_CHARS;
  lastFrameAt = null;
  if (timer) clearTimeout(timer);
  timer = null;
  batch = null;
  knownBad = null;
  crashMarker = null;
  parseCount = 0;
  if (opts.reload) return;
  localStorage.removeItem(KNOWN_BAD_KEY);
  sessionStorage.removeItem(PARSING_KEY);
}

/** Fired (bubbling) by a part whose content just changed in a slice, so a transcript that follows the bottom can keep up. */
export const MARKDOWN_FILL_EVENT = "o2-markdown-fill";

/** The one element allowed to take sanitised HTML in the assistant (`00` §15; the `v-html` lint): an HTML or text part, sanitised and filled once, in priority order, in a frame slice. */
export const AssistantMarkdownPart = defineComponent({
  name: "AssistantMarkdownPart",
  props: {
    part: { type: Object as PropType<SlicedPart>, required: true },
    htmlClass: { type: String, default: "" },
    textClass: { type: String, default: "" },
    /** The part belongs to the streaming answer, which fills before anything else. */
    live: { type: Boolean, default: false },
  },
  setup(props) {
    const el = ref<HTMLElement | null>(null);
    useSlicedFill(el, {
      live: () => props.live,
      source: () => props.part,
      weight: () =>
        props.part.kind === "html" ? props.part.html.length : textWeight(props.part.text),
      fill: (node, announce) => {
        const part = props.part;
        delete node.dataset.pending;
        if (part.kind === "text") {
          node.className = props.textClass;
          node.dataset.test = "assistant-block-plain";
          node.replaceChildren(...textNodes(part.text, part.segments));
        } else {
          node.className = props.htmlClass;
          delete node.dataset.test;
          node.replaceChildren(sanitize(part.html));
        }
        if (announce) announceFill(node);
      },
    });
    return () => h("div", { ref: el });
  },
});

/** A code block: plain `<pre>` text first, the highlighted `OCodeBlock` in its own slice of the same queue (Z2). */
export const AssistantMarkdownCode = defineComponent({
  name: "AssistantMarkdownCode",
  props: {
    code: { type: String, required: true },
    weight: { type: Number, required: true },
    live: { type: Boolean, default: false },
  },
  setup(props, { slots }) {
    const el = ref<HTMLElement | null>(null);
    const ready = ref(!sliced());
    useSlicedFill(el, {
      live: () => props.live,
      source: () => "",
      weight: () => CODE_WEIGHT + props.weight,
      fill: (node, announce) => {
        const parent = node.parentElement;
        ready.value = true;
        if (announce) void nextTick(() => parent && announceFill(parent));
      },
      once: true,
    });
    return () =>
      ready.value ? slots.default?.() : h("pre", { ref: el, class: CLASSES.pre }, props.code);
  },
});

// Queues a fill on mount and on each change; a new part is empty and a changed one keeps its old content until its slice.
function useSlicedFill(
  el: Ref<HTMLElement | null>,
  opts: {
    live: () => boolean;
    source: () => unknown;
    weight: () => number;
    // `announce`: the part is live or in view, so a following transcript must scroll after it; a fill off screen is kept in place by scroll anchoring, and announcing it would lay out the page once more.
    fill: (node: HTMLElement, announce: boolean) => void;
    // The fill happens once; the element is no longer watched after it.
    once?: boolean;
  },
): void {
  let observed: HTMLElement | null = null;
  const release = () => {
    if (observed) unobserve(observed);
    observed = null;
  };
  const entry: Fill = {
    run: () => {
      if (el.value) opts.fill(el.value, entry.live || entry.distance === 0);
      if (opts.once) release();
    },
    weight: 0,
    live: false,
    distance: Infinity,
    seq: 0,
  };
  const queue = () => {
    entry.weight = opts.weight();
    entry.live = opts.live();
    if (!sliced()) return entry.run();
    fills.add(entry);
    scheduleFill();
  };
  onMounted(() => {
    const node = el.value;
    entry.seq = fillSeq++;
    if (node && sliced()) {
      // Empty until its slice: no text is laid out outside the budget, so opening a long history costs little (Q1).
      node.dataset.pending = "";
      observed = observe(node, entry);
    }
    queue();
  });
  watch(opts.source, queue);
  watch(opts.live, (live) => {
    entry.live = live;
  });
  onBeforeUnmount(() => {
    fills.delete(entry);
    release();
  });
}

function sliced(): boolean {
  return typeof Worker !== "undefined" && typeof requestAnimationFrame !== "undefined";
}

// The observer only orders the fills by distance from the visible area; it gates none.
function observe(node: HTMLElement, entry: Fill): HTMLElement | null {
  if (typeof IntersectionObserver === "undefined") return null;
  const root = node.closest("[data-transcript-scroll]");
  let held = observers.get(root);
  if (!held) {
    held = { observer: new IntersectionObserver(onIntersect, { root }), count: 0 };
    observers.set(root, held);
  }
  held.count += 1;
  targets.set(node, entry);
  rootOf.set(node, root);
  held.observer.observe(node);
  return node;
}

function unobserve(node: HTMLElement): void {
  const root = rootOf.get(node) ?? null;
  const held = observers.get(root);
  if (!held) return;
  held.observer.unobserve(node);
  held.count -= 1;
  if (held.count > 0) return;
  held.observer.disconnect();
  observers.delete(root);
}

function onIntersect(entries: IntersectionObserverEntry[]): void {
  for (const seen of entries) {
    const entry = targets.get(seen.target);
    if (entry) entry.distance = distanceOf(seen);
  }
}

function distanceOf(seen: IntersectionObserverEntry): number {
  const bounds = seen.rootBounds;
  if (!bounds) return 0;
  const box = seen.boundingClientRect;
  return Math.max(0, box.top - bounds.bottom, bounds.top - box.bottom);
}

function scheduleFill(): void {
  if (mountFrame) return;
  mountFrame = true;
  requestAnimationFrame(fillSlice);
}

// The live answer first, then the nearest parts, then the newest, until the frame's script time or characters are spent; the first fill of a frame always runs.
function fillSlice(now: number): void {
  mountFrame = false;
  // The time since the last slice's frame began holds that slice's style and layout too, so a costly frame makes the next slice smaller (Q1).
  if (lastFrameAt !== null && now > lastFrameAt) {
    const scale = Math.min(FRAME_TARGET_MS / (now - lastFrameAt), 1.5);
    frameChars = Math.min(MOUNT_FRAME_CHARS, Math.max(MIN_FRAME_CHARS, frameChars * scale));
  }
  const start = performance.now();
  const ready = [...fills].sort(
    (a, b) => Number(b.live) - Number(a.live) || a.distance - b.distance || b.seq - a.seq,
  );
  let spent = 0;
  for (const entry of ready) {
    const over = performance.now() - start >= MOUNT_SLICE_MS || spent + entry.weight > frameChars;
    if (spent > 0 && over) break;
    fills.delete(entry);
    entry.run();
    spent += Math.max(entry.weight, 1);
  }
  lastFrameAt = fills.size ? now : null;
  if (fills.size) scheduleFill();
}

function announceFill(node: Element): void {
  if (node.isConnected) node.dispatchEvent(new Event(MARKDOWN_FILL_EVENT, { bubbles: true }));
}

function textWeight(text: string): number {
  const lines = text.split("\n").length;
  return Math.max(text.length * TEXT_WEIGHT, (lines * MOUNT_FRAME_CHARS) / PART_LINES);
}

function textNodes(text: string, segments: string[] | undefined): Node[] {
  if (!segments) return [document.createTextNode(text)];
  return segments.flatMap((segment, index) => {
    const node = document.createTextNode(segment);
    return index ? [document.createElement("wbr"), node] : [node];
  });
}

function versionOf(blockId: string): ShallowRef<number> {
  let version = versions.get(blockId);
  if (!version) {
    version = shallowRef(0);
    versions.set(blockId, version);
  }
  return version;
}

function release(blockId: string): void {
  const count = (holds.get(blockId) ?? 1) - 1;
  if (count > 0) return void holds.set(blockId, count);
  holds.delete(blockId);
  versions.delete(blockId);
}

function lookup(blockId: string, key: string, state: "open" | "closed"): RenderedBlock | undefined {
  // A streamed prefix is never asked for again, so only the latest one is kept, in `latest`.
  if (state === "open") return latestKeys.get(blockId) === key ? latest.get(blockId) : undefined;
  const hit = memo.get(key);
  if (hit) {
    memo.delete(key);
    memo.set(key, hit);
  }
  return hit;
}

function allowed(blockId: string, state: "open" | "closed"): boolean {
  const count = failures.get(blockId) ?? 0;
  return state === "open" ? count === 0 : count < 2;
}

// Until the worker answers, the block is its text in parts, filled in slices like any other; it costs no parse and no sanitising.
function placeholder(job: Job): RenderedBlock {
  const cached = placeholders.get(job.blockId);
  if (cached?.key === job.key) return cached.block;
  const parts = plainResult(job.blockId, job.text).parts;
  const block = { blockId: job.blockId, parts, claims: [], links: [], plain: false };
  placeholders.delete(job.blockId);
  placeholders.set(job.blockId, { key: job.key, block });
  if (placeholders.size > MEMO_LIMIT)
    placeholders.delete(placeholders.keys().next().value as string);
  return block;
}

function request(job: Job): ParseRequest {
  return {
    blockId: job.blockId,
    text: job.text,
    state: job.state,
    origin: typeof window !== "undefined" ? window.location.origin : "http://localhost",
    imageRemoved: gt("assistant.message.imageRemoved"),
  };
}

// Every render, post, answer and Copy asks for a block's key; the engine hashes a string key once, so the lookup is cheap where the FNV pass over 20k characters is not.
function plainKey(text: string): string {
  let key = keys.get(text);
  if (key === undefined) {
    key = `${text.length}:${contentHash(text)}`;
    keys.set(text, key);
    if (keys.size > MEMO_LIMIT * 2) keys.delete(keys.keys().next().value as string);
  }
  return key;
}

// The newest text per block waits behind the jobs in flight; posts go out once per flush (`30` §2.4).
function schedule(job: Job): void {
  if (batch?.jobs.slice(batch.next).some((queued) => queued.key === job.key)) return;
  queue.set(job.blockId, job);
  if (parser().sync) return pump();
  if (pumpQueued) return;
  pumpQueued = true;
  queueMicrotask(() => {
    pumpQueued = false;
    pump();
  });
}

function pump(): void {
  if (batch || !queue.size) return;
  // Newest first: a transcript opens at its bottom, so the last blocks queued are the ones in view (Z3).
  const jobs = [...queue.values()].reverse().slice(0, BATCH_SIZE);
  for (const job of jobs) queue.delete(job.blockId);
  const mine = { jobs, next: 0 };
  batch = mine;
  const sync = !!parser().sync;
  parser().run(jobs.map(request), {
    start(index) {
      if (batch !== mine) return;
      // Only the job the worker has started is in flight; the rest of the batch is not blamed for a crash (Q3).
      markParsing(jobs[index]);
      if (sync) return;
      clearTimer();
      const job = jobs[index];
      timer = setTimeout(() => expire(mine, index), PARSE_TIMEOUT_MS + job.text.length / 1_000);
    },
    done(index, result) {
      if (batch !== mine) return;
      clearTimer();
      mine.next = index + 1;
      land(jobs[index], result);
      if (mine.next < jobs.length) return;
      batch = null;
      pump();
    },
    fail(reason) {
      if (batch !== mine) return;
      clearTimer();
      if (reason === "unavailable") {
        active = plainParser;
        requeue(jobs.slice(mine.next));
        batch = null;
        return pump();
      }
      expire(mine, mine.next);
    },
  });
}

// Past the timeout (or a crash) the worker is killed with whatever it holds; the job's block shows as text.
function expire(mine: { jobs: Job[]; next: number }, index: number): void {
  if (batch !== mine) return;
  clearTimer();
  parser().reset();
  batch = null;
  const job = mine.jobs[index];
  unmarkParsing(job);
  const count = (failures.get(job.blockId) ?? 0) + 1;
  failures.set(job.blockId, count);
  const final = job.state === "closed" && count >= 2;
  if (final) rememberBad(job.text);
  store(job, plainResult(job.blockId, job.text), { final });
  if (!rendering) bump(job);
  requeue(mine.jobs.slice(index + 1));
  pump();
}

function requeue(jobs: Job[]): void {
  for (const job of jobs) if (!queue.has(job.blockId)) queue.set(job.blockId, job);
}

function land(job: Job, result: ParseResult): void {
  unmarkParsing(job);
  if (job.state === "closed" && !result.rejected) failures.delete(job.blockId);
  store(job, result, { final: !!result.rejected && job.state === "closed", parsed: true });
  if (!rendering) bump(job);
}

// Only a block someone renders has a version; a Copy job or a released block has none to create.
function bump(job: Job): void {
  if (!versions.has(job.blockId)) return;
  // A streaming block re-renders at once; completed blocks that land together (a history) re-render a few per frame.
  if (job.state === "open" || !sliced()) return void (versions.get(job.blockId)!.value += 1);
  bumps.add(job.blockId);
  if (bumps.size === 1) requestAnimationFrame(bumpSlice);
}

function bumpSlice(): void {
  let parts = 0;
  for (const blockId of bumps) {
    const weight = latest.get(blockId)?.parts.length ?? 1;
    if (parts > 0 && parts + weight > BUMP_FRAME_PARTS) break;
    bumps.delete(blockId);
    parts += weight;
    const version = versions.get(blockId);
    if (version) version.value += 1;
  }
  if (bumps.size) requestAnimationFrame(bumpSlice);
}

function clearTimer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

function store(
  job: Job,
  result: ParseResult,
  opts: { final: boolean; parsed?: boolean },
): RenderedBlock {
  if (opts.parsed) parseCount += 1;
  const previous = latest.get(job.blockId);
  const parts = result.parts.map(cleanPart).map((part, index) => {
    const before = previous?.parts[index];
    return before && samePart(before, part) ? before : part;
  });
  const rendered = {
    blockId: job.blockId,
    parts,
    claims: result.claims,
    links: result.links ?? [],
    plain: opts.final,
  };
  plainCache.set(plainKey(job.text), result.plain);
  if (plainCache.size > MEMO_LIMIT) plainCache.delete(plainCache.keys().next().value as string);
  for (const resolve of waiters.get(plainKey(job.text)) ?? []) resolve(result.plain);
  waiters.delete(plainKey(job.text));
  latest.delete(job.blockId);
  latest.set(job.blockId, rendered);
  latestKeys.set(job.blockId, job.key);
  if (latest.size > MEMO_LIMIT) {
    const oldest = latest.keys().next().value as string;
    latest.delete(oldest);
    latestKeys.delete(oldest);
  }
  // A completed block is memoised once it parsed or is plain for good; a first timeout leaves room for its retry.
  if (job.state === "closed" && (opts.parsed || opts.final)) {
    memo.set(job.key, rendered);
    if (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value as string);
  }
  return rendered;
}

// HTML parts are sanitised as they mount (`AssistantMarkdownPart`), so a landing block costs no sanitising here (Y2).
function cleanPart(part: MarkdownPart): MarkdownPart {
  if (part.kind === "code" && part.highlighted !== undefined && !safeHighlight(part.highlighted))
    return { ...part, highlighted: undefined };
  return part;
}

function safeHighlight(html: string): boolean {
  HIGHLIGHT_PIECE.lastIndex = 0;
  while (HIGHLIGHT_PIECE.lastIndex < html.length) {
    const piece = HIGHLIGHT_PIECE.exec(html);
    if (!piece) return false;
    if (piece[1] !== undefined && !piece[1].split(" ").every((cls) => HIGHLIGHT_CLASS.test(cls)))
      return false;
  }
  return true;
}

function samePart(a: MarkdownPart, b: MarkdownPart): boolean {
  if (a.kind !== b.kind || a.key !== b.key) return false;
  if (a.kind === "html") return a.html === (b as typeof a).html;
  if (a.kind === "text") return a.text === (b as typeof a).text;
  const other = b as typeof a;
  return (
    a.code === other.code &&
    a.open === other.open &&
    a.lang === other.lang &&
    a.highlighted === other.highlighted
  );
}

// The renderer's own rules again, on whatever came back: http(s) to other origins only, and only the renderer's classes (X8).
function sanitize(html: string): DocumentFragment {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const fragment = DOMPurify.sanitize(html, { ...PURIFY, RETURN_DOM_FRAGMENT: true });
  fragment.querySelectorAll("a").forEach((link) => {
    const url = parseUrl(link.getAttribute("href"), origin);
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || url.origin === origin) {
      link.replaceWith(...Array.from(link.childNodes));
      return;
    }
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", EXTERNAL_REL);
  });
  // A claim slot becomes an empty inert span the message mounts its chip into; any other carrier loses the attribute.
  fragment.querySelectorAll("[data-claim]").forEach((node) => {
    const index = node.getAttribute("data-claim") ?? "";
    if (node.tagName !== "WBR" || !/^\d{1,3}$/.test(index)) {
      node.removeAttribute("data-claim");
      return;
    }
    const slot = document.createElement("span");
    slot.setAttribute("data-claim", index);
    node.replaceWith(slot);
  });
  fragment.querySelectorAll("img").forEach((img) => {
    if (!SAFE_DATA_IMAGE.test(img.getAttribute("src") ?? "")) img.remove();
  });
  fragment.querySelectorAll("[class]").forEach((node) => {
    if (!ALLOWED_CLASSES.has(node.getAttribute("class") ?? "")) node.removeAttribute("class");
  });
  // A wide table scrolls, so its region takes keyboard focus and a name.
  fragment.querySelectorAll(`div[class="${CLASSES.tableWrap}"]`).forEach((wrap) => {
    wrap.setAttribute("role", "region");
    wrap.setAttribute("tabindex", "0");
    wrap.setAttribute("aria-label", gt("assistant.message.tableName"));
  });
  return fragment;
}

function isKnownBad(text: string): boolean {
  return loadKnownBad().has(plainKey(text));
}

function rememberBad(text: string): void {
  loadKnownBad();
  rememberKey(plainKey(text));
}

function rememberKey(key: string): void {
  const list = knownBad ?? new Map<string, number>();
  list.delete(key);
  list.set(key, Date.now());
  while (list.size > KNOWN_BAD_LIMIT) list.delete(list.keys().next().value as string);
  knownBad = list;
  try {
    localStorage.setItem(KNOWN_BAD_KEY, JSON.stringify([...list]));
  } catch {
    // Storage blocked or full: the list lives for this page only.
  }
}

function loadKnownBad(): Map<string, number> {
  if (knownBad) return knownBad;
  knownBad = new Map();
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KNOWN_BAD_KEY) ?? "[]");
    const since = Date.now() - KNOWN_BAD_TTL_MS;
    for (const item of Array.isArray(parsed) ? parsed : [])
      if (Array.isArray(item) && typeof item[0] === "string" && Number(item[1]) > since)
        knownBad.set(item[0], Number(item[1]));
  } catch {
    // Unreadable: start empty.
  }
  loadCrashMarker();
  return knownBad;
}

// Read once per page, before this page writes: a block still in flight means the tab died parsing it.
function loadCrashMarker(): CrashMarker {
  if (crashMarker) return crashMarker;
  let last: Partial<CrashMarker> = {};
  try {
    last = (JSON.parse(sessionStorage.getItem(PARSING_KEY) ?? "null") as CrashMarker | null) ?? {};
  } catch {
    // Unreadable: no crash known.
  }
  const crashed = typeof last.key === "string" ? last.key : null;
  // A load without a crash breaks the run: the count is of crashes in a row.
  const strikes = crashed ? (crashed === last.suspect ? Number(last.strikes) || 0 : 0) + 1 : 0;
  crashMarker = { key: null, suspect: crashed, strikes };
  if (crashed && strikes >= CRASH_STRIKES) {
    crashMarker = { key: null, suspect: null, strikes: 0 };
    rememberKey(crashed);
  }
  if (typeof window !== "undefined")
    // A page closed or reloaded normally is no crash: its in-flight block goes with it.
    window.addEventListener("pagehide", () => writeCrashMarker(null));
  writeCrashMarker(null);
  return crashMarker;
}

function markParsing(job: Job): void {
  loadKnownBad();
  writeCrashMarker(plainKey(job.text));
}

function unmarkParsing(job: Job): void {
  loadKnownBad();
  const marker = loadCrashMarker();
  const key = plainKey(job.text);
  // A suspect that parsed without a crash is cleared.
  const cleared = marker.suspect === key;
  if (marker.key !== key && !cleared) return;
  if (cleared) crashMarker = { key: marker.key, suspect: null, strikes: 0 };
  writeCrashMarker(marker.key === key ? null : marker.key);
}

function writeCrashMarker(key: string | null): void {
  if (!crashMarker) return;
  crashMarker = { ...crashMarker, key };
  try {
    sessionStorage.setItem(PARSING_KEY, JSON.stringify(crashMarker));
  } catch {
    // Storage blocked or full: the guard is off for this page.
  }
}

function parser(): MarkdownParser {
  active ??= typeof Worker !== "undefined" ? workerParser() : plainParser;
  return active;
}

// One worker for every block; `reset` terminates it, which also frees whatever memory a hostile input took.
function workerParser(): MarkdownParser {
  let worker: Worker | null = null;
  let ready = false;
  let loadFailures = 0;
  let loadTimer: ReturnType<typeof setTimeout> | null = null;
  let pending: { requests: ParseRequest[]; events: ParserEvents } | null = null;
  const stop = () => {
    worker?.terminate();
    worker = null;
    ready = false;
    if (loadTimer) clearTimeout(loadTimer);
    loadTimer = null;
  };
  // A worker that does not load is retried once; a second failure (or a constructor refused by policy) is final.
  const loadFailed = () => {
    stop();
    loadFailures += 1;
    if (loadFailures >= 2) return pending?.events.fail("unavailable");
    start();
  };
  const start = () => {
    let created: Worker;
    try {
      created = new Worker(new URL("./markdown.worker.ts", import.meta.url), { type: "module" });
    } catch {
      loadFailures = 2;
      return pending?.events.fail("unavailable");
    }
    worker = created;
    loadTimer = setTimeout(loadFailed, WORKER_LOAD_TIMEOUT_MS);
    created.onmessage = (event: MessageEvent) => {
      const data = event.data as { type: string; index: number; result: ParseResult };
      if (data.type === "ready") {
        ready = true;
        loadFailures = 0;
        if (loadTimer) clearTimeout(loadTimer);
        loadTimer = null;
        if (pending) created.postMessage({ requests: pending.requests });
      } else if (data.type === "start") pending?.events.start(data.index);
      else if (data.type === "done") pending?.events.done(data.index, data.result);
    };
    created.onerror = () => {
      if (worker !== created) return;
      if (!ready) return loadFailed();
      stop();
      pending?.events.fail("crashed");
    };
  };
  return {
    run(requests, events) {
      pending = { requests, events };
      if (!worker) start();
      else if (ready) worker.postMessage({ requests });
    },
    reset() {
      stop();
      pending = null;
    },
  };
}
