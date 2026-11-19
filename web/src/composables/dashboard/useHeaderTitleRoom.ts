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

import { computed, getCurrentScope, onScopeDispose, ref, watch, type Ref } from "vue";

export const TITLE_MIN_PX = 160;
/** Must equal Tailwind's `xl` screen, the breakpoint the header template switches rows at. */
export const HEADER_TIME_ROW_QUERY = "(min-width: 80rem)";
/** The header actions that take their icon-only form, one at a time, in this order. */
export const HEADER_COLLAPSE_ORDER = ["share", "edit", "auto"] as const;

export type HeaderCollapseKey = (typeof HEADER_COLLAPSE_ORDER)[number];
export type HeaderIconOnly = Record<HeaderCollapseKey, boolean>;

export interface HeaderCollapseInput {
  /** Width the title is short of with every label shown; zero or less means everything fits. */
  deficit: number;
  /** Width the trigger can give by walking its own label forms. */
  triggerSave: number;
  /** Width each action gives when it drops its label. */
  savings: Record<HeaderCollapseKey, number>;
}

export interface HeaderCollapse {
  /** How much narrower the trigger's slot gets; the trigger then shows the widest form that fits. */
  triggerSqueeze: number;
  iconOnly: HeaderIconOnly;
}

export interface HeaderActionEls {
  trigger: Ref<HTMLElement | null>;
  share: Ref<HTMLElement | null>;
  edit: Ref<HTMLElement | null>;
  auto: Ref<HTMLElement | null>;
}

export interface HeaderActionsRoomOptions {
  minPx?: number;
  /** Width of the trigger in its shortest form; null when the picker cannot tell. */
  shortestTriggerWidth?: () => number | null;
  /** Off on a phone, in kiosk and in print, where the actions have their own forms. */
  enabled?: Ref<boolean>;
}

const FIT_SLACK_PX = 0.5;
const NO_COLLAPSE: HeaderCollapse = {
  triggerSqueeze: 0,
  iconOnly: { share: false, edit: false, auto: false },
};

/** Room taken in order: the trigger's own forms, then Share, Edit and Auto go icon-only one at a time. */
export const headerCollapse = ({
  deficit,
  triggerSave,
  savings,
}: HeaderCollapseInput): HeaderCollapse => {
  if (deficit <= FIT_SLACK_PX) return NO_COLLAPSE;
  const triggerSqueeze = Math.min(deficit, Math.max(0, triggerSave));
  let left = deficit - triggerSqueeze;
  const iconOnly: HeaderIconOnly = { share: false, edit: false, auto: false };
  for (const key of HEADER_COLLAPSE_ORDER) {
    if (left <= FIT_SLACK_PX) break;
    iconOnly[key] = true;
    left -= Math.max(0, savings[key]);
  }
  return { triggerSqueeze, iconOnly };
};

const sameCollapse = (a: HeaderCollapse, b: HeaderCollapse) =>
  Math.abs(a.triggerSqueeze - b.triggerSqueeze) < 1 &&
  HEADER_COLLAPSE_ORDER.every((key) => a.iconOnly[key] === b.iconOnly[key]);

const buttonOf = (el: HTMLElement | null): HTMLElement | null =>
  !el ? null : el.matches("button") ? el : el.querySelector("button");

// The title block is the header's flex-1 column; the space after its content is room the title still has.
const titleSlack = (title: HTMLElement, minPx: number): number | null => {
  const box = title.parentElement;
  const block = box?.parentElement?.closest<HTMLElement>(".flex-1");
  if (!box || !block) return null;
  let column: HTMLElement = box;
  while (column.parentElement && column.parentElement !== block) column = column.parentElement;
  const need = Math.min(title.getBoundingClientRect().width, minPx);
  const after = block.getBoundingClientRect().right - column.getBoundingClientRect().right;
  return box.clientWidth - need + Math.max(0, after);
};

/** The dashboard header's room plan: how far the trigger narrows and which actions drop their labels. */
export const useHeaderActionsRoom = (
  titleEl: Ref<HTMLElement | null>,
  els: HeaderActionEls,
  { minPx = TITLE_MIN_PX, shortestTriggerWidth, enabled }: HeaderActionsRoomOptions = {},
) => {
  const collapse = ref<HeaderCollapse>(NO_COLLAPSE);
  // Each form's width is kept from when it was last on screen, so the plan never depends on itself.
  const fullWidth: Partial<Record<HeaderCollapseKey, number>> = {};
  const iconWidth: Partial<Record<HeaderCollapseKey, number>> = {};
  let triggerFull: number | null = null;
  let observer: ResizeObserver | null = null;
  let textObserver: MutationObserver | null = null;

  const actionSaving = (key: HeaderCollapseKey, button: HTMLElement | null): number => {
    if (button) {
      const { width, height } = button.getBoundingClientRect();
      if (collapse.value.iconOnly[key]) iconWidth[key] = width;
      else fullWidth[key] = width;
      if (iconWidth[key] === undefined) iconWidth[key] = height;
    }
    const full = fullWidth[key];
    const icon = iconWidth[key];
    return full === undefined || icon === undefined ? 0 : Math.max(0, full - icon);
  };

  const triggerSaving = (header: HTMLElement): { save: number; saved: number } => {
    const trigger = els.trigger.value;
    if (!trigger || !header.contains(trigger)) {
      triggerFull = null;
      return { save: 0, saved: 0 };
    }
    const width = trigger.getBoundingClientRect().width;
    if (collapse.value.triggerSqueeze <= 0 || triggerFull === null) triggerFull = width;
    const shortest = shortestTriggerWidth?.() ?? null;
    return {
      save: shortest === null ? 0 : Math.max(0, triggerFull - shortest),
      saved: Math.max(0, triggerFull - width),
    };
  };

  const check = () => {
    const title = titleEl.value;
    const header = title?.closest("header");
    if (!title || !header || enabled?.value === false) {
      collapse.value = NO_COLLAPSE;
      return;
    }
    const slack = titleSlack(title, minPx);
    if (slack === null) return;
    const savings = {} as Record<HeaderCollapseKey, number>;
    let saved = 0;
    for (const key of HEADER_COLLAPSE_ORDER) {
      savings[key] = actionSaving(key, buttonOf(els[key].value));
      if (collapse.value.iconOnly[key]) saved += savings[key];
    }
    const trigger = triggerSaving(header);
    const next = headerCollapse({
      deficit: trigger.saved + saved - slack,
      triggerSave: trigger.save,
      savings,
    });
    if (!sameCollapse(next, collapse.value)) collapse.value = next;
  };

  const stop = () => {
    observer?.disconnect();
    textObserver?.disconnect();
    observer = null;
    textObserver = null;
  };

  watch(
    [titleEl, els.trigger, els.share, els.edit, els.auto, () => enabled?.value ?? true],
    ([title, ...rest]) => {
      stop();
      const header = title?.closest("header");
      if (!title || !header || typeof ResizeObserver === "undefined") return;
      observer = new ResizeObserver(check);
      observer.observe(header);
      for (const el of rest) if (el instanceof HTMLElement) observer.observe(el);
      // A title that loads into an already squeezed box resizes nothing, so watch its text too.
      textObserver = new MutationObserver(check);
      textObserver.observe(title, { childList: true, characterData: true, subtree: true });
      check();
    },
    { flush: "post" },
  );

  if (getCurrentScope()) onScopeDispose(stop);

  const iconOnly = computed(() => collapse.value.iconOnly);
  const triggerMaxWidth = computed(() => {
    const squeeze = collapse.value.triggerSqueeze;
    if (squeeze <= 0 || triggerFull === null) return null;
    const shortest = shortestTriggerWidth?.() ?? 0;
    return Math.max(triggerFull - squeeze, shortest);
  });

  return { iconOnly, triggerMaxWidth, check };
};

/** True while the viewport is wide enough for the trigger to share the header row. */
export const useHeaderTimeInRow = () => {
  const matches = ref(true);
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return matches;
  const query = window.matchMedia(HEADER_TIME_ROW_QUERY);
  if (!query) return matches;
  matches.value = query.matches;
  const onChange = (event: MediaQueryListEvent) => {
    matches.value = event.matches;
  };
  query.addEventListener?.("change", onChange);
  if (getCurrentScope()) onScopeDispose(() => query.removeEventListener?.("change", onChange));
  return matches;
};
