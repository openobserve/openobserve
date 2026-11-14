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

import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

// A strip that just moved to its own line must clear this much room before it comes back, or it flickers.
const HYSTERESIS_PX = 16;

const isContents = (el: Element) => getComputedStyle(el).display === "contents";

/** The element that lays the strip out: page wrappers with `display: contents` do not count. */
export function layoutParentOf(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement;
  while (parent && isContents(parent)) parent = parent.parentElement;
  return parent;
}

/** The flex items of `parent`, looking through `display: contents` wrappers. */
export function flexItemsOf(parent: Element): HTMLElement[] {
  const items: HTMLElement[] = [];
  for (const child of Array.from(parent.children) as HTMLElement[]) {
    const style = getComputedStyle(child);
    if (style.display === "contents") items.push(...flexItemsOf(child));
    else if (style.display !== "none" && style.position !== "absolute") items.push(child);
  }
  return items;
}

// A growing item can shrink to its floor, so that is all it claims from the strip's line.
const claimedWidth = (el: HTMLElement) => {
  const style = getComputedStyle(el);
  if (Number(style.flexGrow) > 0) return parseFloat(style.minWidth) || 0;
  return el.getBoundingClientRect().width;
};

/** Room left for the strip on its toolbar's first line, beside every other item at its narrowest. */
export function roomBeside(strip: HTMLElement): number {
  const parent = layoutParentOf(strip);
  if (!parent) return Infinity;
  const style = getComputedStyle(parent);
  const gap = parseFloat(style.columnGap) || 0;
  const inner =
    parent.clientWidth -
    (parseFloat(style.paddingLeft) || 0) -
    (parseFloat(style.paddingRight) || 0);
  const others = flexItemsOf(parent).filter((el) => el !== strip);
  return inner - others.reduce((sum, el) => sum + claimedWidth(el), 0) - gap * others.length;
}

/**
 * Whether an inline strip should take a line of its own: true once its natural
 * width no longer fits beside the rest of the toolbar.
 */
export function useInlineFit(
  root: Ref<HTMLElement | null>,
  naturalWidth: () => number,
  enabled: () => boolean,
) {
  const ownLine = ref(false);
  let frame = 0;
  let observer: ResizeObserver | null = null;

  const measure = () => {
    frame = 0;
    const el = root.value;
    if (!el || !enabled()) {
      ownLine.value = false;
      return;
    }
    const room = roomBeside(el);
    const natural = naturalWidth();
    ownLine.value = ownLine.value ? natural > room - HYSTERESIS_PX : natural > room;
  };

  // Deferred a frame: a class change inside the observer callback re-triggers it in the same frame.
  const schedule = () => {
    if (frame || typeof requestAnimationFrame === "undefined") return;
    frame = requestAnimationFrame(measure);
  };

  const observe = (targets: (Element | null | undefined)[]) => {
    if (typeof ResizeObserver === "undefined") return;
    observer?.disconnect();
    observer ??= new ResizeObserver(schedule);
    const el = root.value;
    const parent = el && layoutParentOf(el);
    for (const target of [parent, ...targets]) if (target) observer.observe(target);
  };

  onMounted(schedule);
  onBeforeUnmount(() => {
    observer?.disconnect();
    if (frame) cancelAnimationFrame(frame);
  });

  return { ownLine, observe, schedule };
}
