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

/** Calls `onMove` whenever `el` may have moved on screen; returns a stop function. */
export const observeMoves = (
  el: Element,
  onMove: () => void,
  options: { subtreeStyles?: boolean } = {},
): (() => void) => {
  const stops: (() => void)[] = [];
  let stopped = false;
  const notify = () => onMove();
  const sizes = typeof ResizeObserver !== "undefined" ? new ResizeObserver(notify) : null;
  // Anything laid out before `el` or one of its ancestors pushes it when it grows, so each of those is watched too.
  const watchSizes = () => {
    // A rewatch queued just before teardown must not reconnect the observer to detached elements.
    if (!sizes || stopped) return;
    sizes.disconnect();
    for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
      sizes.observe(node, { box: "border-box" });
      for (
        let before = node.previousElementSibling;
        before;
        before = before.previousElementSibling
      ) {
        sizes.observe(before, { box: "border-box" });
      }
    }
  };
  watchSizes();
  if (sizes) stops.push(() => sizes.disconnect());
  if (typeof MutationObserver !== "undefined") {
    let rewatchQueued = false;
    const layout = new MutationObserver((records) => {
      if (!rewatchQueued && records.some((record) => record.type === "childList")) {
        rewatchQueued = true;
        queueMicrotask(() => {
          rewatchQueued = false;
          watchSizes();
        });
      }
      onMove();
    });
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      layout.observe(node, {
        attributes: true,
        attributeFilter: ["style", "class"],
        childList: true,
      });
    }
    if (options.subtreeStyles) {
      layout.observe(el, { attributes: true, attributeFilter: ["style"], subtree: true });
    }
    stops.push(() => layout.disconnect());
  }
  const onScroll = (event: Event) => {
    if (event.target instanceof Node && event.target.contains(el)) onMove();
  };
  document.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", notify);
  stops.push(() => {
    document.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", notify);
  });
  return () => {
    stopped = true;
    stops.forEach((stop) => stop());
  };
};
