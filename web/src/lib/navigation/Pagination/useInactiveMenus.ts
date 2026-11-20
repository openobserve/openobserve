// Copyright 2026 OpenObserve Inc.

import { onBeforeUnmount, watch } from "vue";
import { activates } from "@/lib/core/Button/activation";

const MENU_EVENTS = ["pointerdown", "pointerup", "mousedown", "click", "keydown"] as const;

// Reka fills a dropdown's aria-controls only after its trigger rendered, so the menu is also found by its aria-labelledby.
function openMenus(root: HTMLElement | null): Element[] {
  if (!root) return [];
  const triggers = Array.from(root.querySelectorAll('[aria-expanded="true"]'));
  if (!triggers.length) return [];
  const triggerIds = new Set(triggers.map((trigger) => trigger.id).filter(Boolean));
  const controlled = triggers.flatMap((trigger) =>
    (trigger.getAttribute("aria-controls") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)),
  );
  const labelled = Array.from(document.querySelectorAll("[aria-labelledby]")).filter((el) =>
    (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).some((id) => triggerIds.has(id)),
  );
  return [...new Set([...controlled, ...labelled])].filter(
    (menu): menu is Element => !!menu && !root.contains(menu),
  );
}

/** While `active`, menus opened from `root` are closed and their portaled items ignore input. */
export function useInactiveMenus(root: () => HTMLElement | null, active: () => boolean): void {
  let menus: Element[] = [];
  const block = (event: Event): void => {
    if (!activates(event)) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (![...menus, ...openMenus(root())].some((menu) => menu.contains(target))) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const stop = (): void => {
    MENU_EVENTS.forEach((type) => document.removeEventListener(type, block, true));
    menus = [];
  };
  watch(active, (on) => {
    if (!on) {
      stop();
      return;
    }
    menus = openMenus(root());
    MENU_EVENTS.forEach((type) => document.addEventListener(type, block, true));
    // Escape is the menus' own dismiss path and only reaches the topmost layer, which an open menu is.
    menus.forEach((menu) =>
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
  });
  onBeforeUnmount(stop);
}
