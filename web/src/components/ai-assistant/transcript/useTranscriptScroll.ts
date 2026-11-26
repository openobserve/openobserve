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

import { nextTick, onBeforeUnmount, onMounted, watch, type Ref, type WatchSource } from "vue";

import { MARKDOWN_FILL_EVENT } from "./markdown";

/** What the scroll model reads and writes; the store owns the values (`30` §1.3, `00` §4.1). */
export interface TranscriptScrollOptions {
  container: Ref<HTMLElement | null>;
  follow: () => boolean;
  setFollow(follow: boolean): void;
  /** The saved position of this session, restored when a container shows it again (SH-03). */
  savedTop: () => number | "bottom";
  saveTop(top: number | "bottom"): void;
  /** Changes on every committed frame batch; the scroll follows inside the same frame. */
  content: WatchSource<unknown>;
  /** The newest turn's id; a new one scrolls its top into view (HT-08 AC 5). */
  latestTurn: WatchSource<string | null>;
  /** The session shown; a switch re-arms follow (rule 6). */
  session: WatchSource<string | null>;
  reducedMotion?: () => boolean;
}

export interface TranscriptScroll {
  /** Jump to latest, End, and an own send: follow again and land at the bottom (rule 3). */
  jumpToLatest(): void;
  /** While following, brings a block's top into view when it starts above the viewport (an outcome's title before its action). */
  reveal(target: HTMLElement): void;
  /** Keeps the first visible block where the reader had it while `grow` adds content above (rule 5). */
  preserveAnchor(grow: () => void | Promise<void>): Promise<void>;
  onKeydown(event: KeyboardEvent): void;
}

// Within this of the bottom the reader is at the latest line; the only threshold, and only for restoring.
const AT_BOTTOM_PX = 2;

// A scroll this soon after wheel, touch, key or pointer input is the reader's; layout clamps come without input.
const READER_INPUT_MS = 1_000;

const ANCHOR_SELECTOR = "[data-scroll-anchor]";

/** The transcript's follow model: follow until the reader scrolls up, re-armed only by the reader (HT-08). */
export function useTranscriptScroll(opts: TranscriptScrollOptions): TranscriptScroll {
  let lastTop = 0;
  let lastSize = "";
  // The position our own write left; an event elsewhere is not ours, even when coalesced with it.
  let ownTop: number | null = null;
  let inputAt = Number.NEGATIVE_INFINITY;
  let pointerDown = false;
  // A smooth scroll of ours: its frames move toward the target until it lands or the reader takes over.
  let smoothTo: { target: number; at: number } | null = null;
  // A block that reveal or a new turn brought into view; re-pins keep its top in view until the next batch.
  let held: HTMLElement | null = null;

  const el = () => opts.container.value;
  const behavior = (): ScrollBehavior => (opts.reducedMotion?.() ? "auto" : "smooth");
  const sizeOf = (node: HTMLElement) => `${node.scrollHeight}:${node.clientHeight}`;
  const readerActive = () => pointerDown || Date.now() - inputAt < READER_INPUT_MS;

  const setTop = (top: number, smooth = false) => {
    const node = el();
    if (!node) return;
    lastSize = sizeOf(node);
    if (smooth && typeof node.scrollTo === "function") {
      const max = Math.max(0, node.scrollHeight - node.clientHeight);
      smoothTo = { target: Math.min(Math.max(0, top), max), at: Date.now() };
      ownTop = null;
      lastTop = node.scrollTop;
      node.scrollTo({ top, behavior: behavior() });
      return;
    }
    smoothTo = null;
    node.scrollTop = top;
    ownTop = node.scrollTop;
    lastTop = ownTop;
    // An unchanged position fires no event; the marker must not outlive this frame.
    const written = ownTop;
    nextFrame(() => {
      if (ownTop === written) ownTop = null;
    });
  };

  const toBottom = (smooth = false) => {
    const node = el();
    if (node) setTop(node.scrollHeight, smooth);
  };

  const pin = () => {
    const node = el();
    if (!node) return;
    if (held?.isConnected)
      setTop(Math.min(node.scrollHeight, node.scrollTop + offsetIn(held, node)));
    else toBottom();
  };

  // Parts fill in after their commit, many per frame, so one queued scroll keeps a following transcript at the bottom.
  let fillQueued = false;
  const onFill = () => {
    if (fillQueued) return;
    fillQueued = true;
    queueMicrotask(() => {
      fillQueued = false;
      if (opts.follow() && !smoothTo) pin();
    });
  };

  // The log shrinking under a growing strip, or a row growing with no batch (a lazy action bar), fires no scroll event.
  let resizes: ResizeObserver | null = null;
  // The last height each observed box reported; null until its first report, which only records it.
  const heights = new Map<Element, number | null>();
  const onResize = (entries: ResizeObserverEntry[]) => {
    let changed = false;
    for (const entry of entries) {
      const before = heights.get(entry.target);
      if (before !== undefined && before !== null && before !== entry.contentRect.height)
        changed = true;
      heights.set(entry.target, entry.contentRect.height);
    }
    if (changed) onFill();
  };

  const observe = (box: Element) => {
    if (!resizes || heights.has(box)) return;
    heights.set(box, null);
    resizes.observe(box);
  };

  const observeRows = () => {
    const node = el();
    if (!node || !resizes) return;
    for (const box of heights.keys())
      if (!box.isConnected) {
        resizes.unobserve(box);
        heights.delete(box);
      }
    for (const row of Array.from(node.children)) observe(row);
  };

  const endFollow = () => {
    if (opts.follow()) opts.setFollow(false);
  };

  // Any upward move by the reader, however small, ends following for this turn (rule 2).
  const onScroll = () => {
    const node = el();
    if (!node) return;
    const top = node.scrollTop;
    const size = sizeOf(node);
    const bottom = atBottom(node);
    if (smoothTo && ownSmoothStep(smoothTo, top, bottom)) {
      lastTop = top;
      lastSize = size;
      return;
    }
    smoothTo = null;
    const own = ownTop !== null && Math.abs(top - ownTop) < 1;
    const resized = size !== lastSize;
    // A resize that lands on the bottom is a clamp (a sheet snap, the strip's own row), never the reader.
    const readerUp = top < lastTop && !(resized && bottom) && (readerActive() || !resized);
    if (!own && readerUp) endFollow();
    else if (!own && !opts.follow() && bottom) {
      held = null;
      opts.setFollow(true);
    }
    lastTop = top;
    lastSize = size;
  };

  // A frame of our smooth scroll moves toward its target with no reader input since it started.
  const ownSmoothStep = (smooth: { target: number; at: number }, top: number, bottom: boolean) => {
    if (pointerDown || inputAt > smooth.at) return false;
    if (Math.abs(smooth.target - top) > Math.abs(smooth.target - lastTop) + 1) return false;
    if (Math.abs(top - smooth.target) < 1 || bottom) {
      smoothTo = null;
      // Rows that mounted during the animation sit past its fixed target, so a following reader lands on the real bottom.
      if (!bottom) onFill();
    }
    return true;
  };

  const onWheel = (event: WheelEvent) => {
    inputAt = Date.now();
    const node = el();
    if (event.deltaY < 0 && node && node.scrollTop > 0) endFollow();
  };

  const onInput = () => {
    inputAt = Date.now();
  };

  const onPointerDown = () => {
    pointerDown = true;
    inputAt = Date.now();
  };

  const onPointerUp = () => {
    if (pointerDown) inputAt = Date.now();
    pointerDown = false;
  };

  const reveal = (target: HTMLElement) => {
    const node = el();
    if (!node || !opts.follow()) return;
    const offset = offsetIn(target, node);
    if (offset >= 0) return;
    held = target;
    setTop(Math.max(0, node.scrollTop + offset));
  };

  const jumpToLatest = () => {
    held = null;
    opts.setFollow(true);
    toBottom(true);
  };

  const onKeydown = (event: KeyboardEvent) => {
    const node = el();
    if (node?.contains(event.target as Node | null)) inputAt = Date.now();
    if (!node || event.target !== node) return;
    const page = node.clientHeight * 0.9;
    if (event.key === "End") {
      event.preventDefault();
      jumpToLatest();
    } else if (event.key === "Home") {
      event.preventDefault();
      opts.setFollow(false);
      setTop(0);
    } else if (event.key === "PageUp") {
      event.preventDefault();
      opts.setFollow(false);
      setTop(Math.max(0, node.scrollTop - page));
    } else if (event.key === "PageDown") {
      event.preventDefault();
      setTop(Math.min(node.scrollHeight, node.scrollTop + page));
    }
  };

  const preserveAnchor = async (grow: () => void | Promise<void>) => {
    const node = el();
    const anchor = node ? firstVisible(node) : null;
    const offset = anchor && node ? offsetIn(anchor, node) : 0;
    await grow();
    await nextTick();
    if (!node || !anchor || !anchor.isConnected) return;
    setTop(node.scrollTop + (offsetIn(anchor, node) - offset));
  };

  watch(
    opts.content,
    () => {
      held = null;
      observeRows();
      if (opts.follow()) toBottom();
    },
    { flush: "post" },
  );

  watch(
    opts.latestTurn,
    (turn, previous) => {
      const node = el();
      if (!turn || !previous || turn === previous || !node || !opts.follow()) return;
      const article = Array.from(node.querySelectorAll<HTMLElement>("[data-turn-id]")).find(
        (el) => el.dataset.turnId === turn,
      );
      if (!article) return;
      held = article;
      setTop(Math.max(0, offsetIn(article, node) + node.scrollTop));
    },
    { flush: "post" },
  );

  watch(opts.session, (sid, previous) => {
    if (sid && previous && sid !== previous) opts.setFollow(true);
  });

  onMounted(() => {
    const node = el();
    if (!node) return;
    node.addEventListener("scroll", onScroll, { passive: true });
    node.addEventListener(MARKDOWN_FILL_EVENT, onFill);
    resizes = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
    observe(node);
    observeRows();
    node.addEventListener("wheel", onWheel, { passive: true });
    node.addEventListener("touchmove", onInput, { passive: true });
    node.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerUp, { passive: true });
    lastSize = sizeOf(node);
    const saved = opts.savedTop();
    if (saved === "bottom" || opts.follow()) toBottom();
    else setTop(saved);
  });

  onBeforeUnmount(() => {
    resizes?.disconnect();
    resizes = null;
    heights.clear();
    const node = el();
    if (!node) return;
    node.removeEventListener("scroll", onScroll);
    node.removeEventListener(MARKDOWN_FILL_EVENT, onFill);
    node.removeEventListener("wheel", onWheel);
    node.removeEventListener("touchmove", onInput);
    node.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    opts.saveTop(atBottom(node) ? "bottom" : node.scrollTop);
  });

  return { jumpToLatest, reveal, preserveAnchor, onKeydown };
}

function atBottom(node: HTMLElement): boolean {
  return node.scrollHeight - node.scrollTop - node.clientHeight <= AT_BOTTOM_PX;
}

function nextFrame(cb: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(cb);
  else setTimeout(cb, 16);
}

function offsetIn(child: HTMLElement, container: HTMLElement): number {
  return child.getBoundingClientRect().top - container.getBoundingClientRect().top;
}

function firstVisible(container: HTMLElement): HTMLElement | null {
  for (const node of Array.from(container.querySelectorAll<HTMLElement>(ANCHOR_SELECTOR)))
    if (offsetIn(node, container) + node.offsetHeight > 0) return node;
  return null;
}
