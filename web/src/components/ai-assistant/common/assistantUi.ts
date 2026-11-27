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

import { provideOverlayScope } from "@/lib/overlay/overlayScope";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import type { I18nText } from "@/types/i18n";
import { inject } from "vue";
import { DIALOG_DEPTH_KEY } from "@/lib/overlay/Dialog/dialogStacking";

/** The attribute that scopes the assistant colour roles (component.css `[data-assistant-surface]`). */
export const ASSISTANT_SURFACE = { "data-assistant-surface": "" } as const;

/** Every popover, dialog, sheet and menu the caller opens, nested ones included, takes the assistant roles in `body`. */
export function provideAssistantSurface(): void {
  provideOverlayScope(ASSISTANT_SURFACE);
}

/** Every control inside the assistant is a 2.75 rem target on touch and below md (`95` §6). */
export const TOUCH_TARGET_CLASS =
  "max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11";

export type AssistantSignal = "working" | "attention" | "failed" | "unread";

export type AssistantSignalShape = "ring" | "dot-count" | "glyph" | "dot";

/** One shape per signal so colour is never the only cue: ring, dot + count, glyph, neutral dot. */
export const assistantSignalShape: Record<AssistantSignal, AssistantSignalShape> = {
  working: "ring",
  attention: "dot-count",
  failed: "glyph",
  unread: "dot",
};

export interface AssistantStatusDotProps {
  state: AssistantSignal;
  /** Needs-you count; assistive tech reads it at every width, and it shows visually from md up. */
  count?: number;
  /** Position relative to a positioned parent. */
  placement?: "corner" | "inline";
}

export interface AssistantIconButtonProps {
  /** Accessible name and tooltip; an icon-only control has no visible text to repeat. */
  label: I18nText;
  icon: IconName;
  /** Registry id whose keycaps the tooltip renders (OTooltip `shortcut-id`). */
  shortcutId?: string;
  variant?: "ghost" | "outline" | "secondary" | "primary";
  /** `sm` → OButton `icon-xs-sq`, `toolbar` → `icon-toolbar`, `md` → `icon-sm`; 2.75 rem below md and on coarse pointers. */
  size?: "sm" | "toolbar" | "md";
  /** The busy spinner of an action in flight (Stop while stopping). */
  loading?: boolean;
  /** Renders `aria-pressed`. */
  pressed?: boolean;
  disabled?: boolean;
  /** Shown as the tooltip and `aria-describedby`; keeps the disabled button focusable so the reason can be read. */
  disabledReason?: I18nText;
  /** A small state glyph at the icon's corner (a locked door keeps its verb glyph). */
  badge?: IconName;
  /** Touch has no hover: a tooltip opened by a tap would stay over the page. */
  noTooltip?: boolean;
  /** A trailing chevron for a control that opens a menu of its own value, such as the agent picker. */
  chevron?: boolean;
  /** An action that is running now: the primary fill, and `data-on`. */
  on?: boolean;
  /** Confirms a finished action in place ("Link copied"): a check, this text and the success colour, with `data-done`. */
  done?: I18nText;
  /** Set on a button that will show `done`, so its announcement region is in place before the text arrives. */
  confirms?: boolean;
  dataTest: string;
}

export interface AssistantIconButtonSlots {
  /** Tooltip content that says more than the name, such as what a door sends; the name stays `label`. */
  tooltip?: () => unknown;
}

export interface AssistantIconButtonEmits {
  (e: "click", event: MouseEvent): void;
}

const FOCUSABLE =
  "button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** OPopover's `z-index` one layer above the dialog, sheet or drawer the caller sits in, as ODropdown stacks. */
export function usePopoverZIndex(): number {
  const depth = Math.max(inject<number>(DIALOG_DEPTH_KEY, 0), inject<number>("o2DrawerDepth", 0));
  return 6000 + depth * 1000;
}

/**
 * Focus return for an OPopover placed by its `anchor` prop, which has no trigger for reka to refocus.
 * Bind `onPointerDownOutside` to `pointer-down-outside`, and call `onClose` on every close.
 */
export function useAnchorFocusReturn(anchor: () => Element | null | undefined) {
  let clickedAway = false;
  return {
    onPointerDownOutside(event: Event): void {
      if (!event.defaultPrevented) clickedAway = true;
    },
    onClose(): void {
      const away = clickedAway;
      clickedAway = false;
      const active = document.activeElement;
      // A click away, or a focus the user or caller already moved elsewhere, keeps its place.
      if (
        away ||
        (active && active !== document.body && !active.closest("[data-o-popover-content]"))
      )
        return;
      const el = anchor();
      const control = el?.matches(FOCUSABLE) ? el : el?.querySelector(FOCUSABLE);
      if (control instanceof HTMLElement) control.focus();
    },
  };
}
