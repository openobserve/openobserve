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

import { ref } from "vue";

/** Query param a dashboard notice adds to the panel-editor link to land on the setting that fixes it. */
export const PANEL_EDITOR_FOCUS_PARAM = "focus";

export type PanelEditorFocusTarget = "top-n" | "vrl";

const TARGETS: PanelEditorFocusTarget[] = ["top-n", "vrl"];

// One editor is open at a time; the section that owns the target consumes the request when it mounts.
const pendingFocus = ref<PanelEditorFocusTarget | null>(null);

export const parsePanelEditorFocus = (value: unknown): PanelEditorFocusTarget | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  return TARGETS.includes(raw as PanelEditorFocusTarget) ? (raw as PanelEditorFocusTarget) : null;
};

/** The route query without the focus param, so back/forward or a reload never re-focus. */
export const withoutFocusParam = <T extends Record<string, unknown>>(query: T): T => {
  const { [PANEL_EDITOR_FOCUS_PARAM]: _used, ...rest } = query;
  return rest as T;
};

export const waitForElement = (
  find: () => HTMLElement | null | undefined,
  timeoutMs = 4000,
): Promise<HTMLElement | null> =>
  new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const el = find();
      if (el) return resolve(el);
      if (Date.now() - started >= timeoutMs) return resolve(null);
      setTimeout(tick, 50);
    };
    tick();
  });

/** Laid out and visible; where the browser cannot tell (no `checkVisibility`), assume it is. */
export const isShown = (el: HTMLElement | null | undefined): el is HTMLElement =>
  !!el &&
  (typeof el.checkVisibility !== "function" || (el.checkVisibility() && el.offsetWidth > 0));

const scrollerOf = (el: HTMLElement): HTMLElement | null => {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === "auto" || overflowY === "scroll") && p.scrollHeight > p.clientHeight)
      return p;
  }
  return null;
};

/** Scrolls only the element's own scroll container; `scrollIntoView` also scrolled the editor body and pushed the chart preview out of view. */
export const scrollIntoOwnScroller = (el: HTMLElement) => {
  const scroller = scrollerOf(el);
  if (!scroller) return;
  const box = el.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  if (box.top < view.top) scroller.scrollTop -= view.top - box.top;
  else if (box.bottom > view.bottom) scroller.scrollTop += box.bottom - view.bottom;
};

/** Focuses the element's first editable child; `scroll` also brings it into its scroll container's view. The control's own focus style is the highlight, so no extra ring is added. */
export const revealAndFocus = (el: HTMLElement, { scroll = true }: { scroll?: boolean } = {}) => {
  if (scroll) scrollIntoOwnScroller(el);
  const editable = el.matches("input, textarea, [contenteditable='true']")
    ? el
    : el.querySelector<HTMLElement>("input, textarea, [contenteditable='true']");
  editable?.focus({ preventScroll: true });
};

export const usePanelEditorFocus = () => {
  const requestFocus = (target: PanelEditorFocusTarget | null) => {
    pendingFocus.value = target;
  };

  /** Opens the pane that owns the target, then asks it to focus; the editor's own notice actions use this in place. */
  const focusInEditor = (
    layout: { isConfigPanelOpen?: boolean; showQueryBar?: boolean; vrlFunctionToggle?: boolean },
    target: PanelEditorFocusTarget,
  ) => {
    if (target === "top-n") layout.isConfigPanelOpen = true;
    if (target === "vrl") {
      layout.showQueryBar = true;
      layout.vrlFunctionToggle = true;
    }
    requestFocus(target);
  };

  /** Hands the pending request to its owner exactly once. */
  const takeFocus = (target: PanelEditorFocusTarget): boolean => {
    if (pendingFocus.value !== target) return false;
    pendingFocus.value = null;
    return true;
  };

  return { pendingFocus, requestFocus, focusInEditor, takeFocus };
};
