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
  computed,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  type ComputedRef,
  type ShallowRef,
} from "vue";

import { useShortcuts } from "@/lib/vue-shortcut-manager/composables";
import { trackAssistant } from "@/services/assistantAnalytics";

import type { GateCode } from "./assistantStore.types";
import { openAssistant } from "./openAssistant";
import { getAssistantRuntime } from "./runtime";

/** The Escape ladder's rungs, innermost first (`10` §6.3); `e` is retired and never asked. */
export const ESCAPE_RUNGS = ["a", "b", "c", "d", "f", "g", "h"] as const;

/** The assistant's focus scope: `assistantClose` is bound only while focus is inside it. */
export const ASSISTANT_ROOT_SELECTOR = "[data-assistant-root]";

// No chord on these gates (constraint 36; SH-01 AC 8).
const UNREGISTERED_GATES: ReadonlySet<GateCode> = new Set([
  "loading",
  "not_entitled",
  "not_configured",
]);

/** An open popover, menu or listbox that owns this Escape (rung a); it closes itself. */
const OPEN_OVERLAY_SELECTOR =
  "[data-o-popover-content][data-state='open'], [role='menu'][data-state='open'], [role='listbox'][data-state='open']";

/** The trigger of an open select, menu or popover; focus stays on it while its popup is open. */
const EXPANDED_TRIGGER_SELECTOR =
  "[role='combobox'][aria-expanded='true'], [aria-haspopup]:not([aria-haspopup='false'])[aria-expanded='true']";

// Rung handlers return true when they handled the key, which stops the ladder there.
const rungs = new Map<EscapeRung, Set<(event: KeyboardEvent) => boolean>>();

// `card` (a pending approval or consent card) is asked before `composer` (`10` §6.2).
const focusTargets = new Map<FocusTarget, Set<() => boolean>>();

// Mounted instances in mount order; the first binds, and the binding passes on when it unmounts.
const instances: symbol[] = [];

// The sidebar and sheet hosts register how they close; rung f asks them for the focused root.
const closers = new Set<() => void>();

let ownerRef: ShallowRef<symbol | undefined> | null = null;

// Mounted header buttons in mount order; the first binds the open chord, and the binding passes on when it unmounts.
const openChordInstances: symbol[] = [];

let openChordOwnerRef: ShallowRef<symbol | undefined> | null = null;

// Mounted history triggers answer the `assistantHistory` chord, the rail before any header.
const historyTargets: HistoryTarget[] = [];

export type EscapeRung = (typeof ESCAPE_RUNGS)[number];

/** `answer` is the latest assistant article, the target of `assistantGoToAnswer` (`30` §1.6). */
export type FocusTarget = "card" | "composer" | "answer";

/** A history trigger: the thread header's Chats (toggles its list) or the full view's rail (focuses its search). */
export interface HistoryTarget {
  el(): HTMLElement | null;
  /** The rail outranks a header on the same page. */
  priority: number;
  run(): void;
}

export interface AssistantShortcutsOptions {
  /** Overrides the runtime's gate, for specs. */
  gate?: ComputedRef<GateCode>;
  assistantCanChat?: ComputedRef<boolean>;
}

/** Binds the history and close chords once per tab for the host; the open chord binds with the header button. */
export function useAssistantShortcuts(options: AssistantShortcutsOptions = {}): void {
  const capability = options.gate ? null : getAssistantRuntime().capability;
  const gate = options.gate ?? capability!.gate;
  const focusInside = ref(false);
  const token = Symbol("assistantShortcuts");
  instances.push(token);
  owner().value ??= token;
  const registered = computed(() => owner().value === token && !UNREGISTERED_GATES.has(gate.value));
  const syncFocus = () => {
    focusInside.value = !!document.activeElement?.closest(ASSISTANT_ROOT_SELECTOR);
  };

  useShortcuts([{ id: "assistantHistory", handler: runHistoryTarget }], undefined, {
    active: registered,
  });
  // The `assistant` scope is acquired only while focus is inside, so global `closeDialog` never fires with it.
  useShortcuts([{ id: "assistantClose", handler: runEscapeLadder }], undefined, {
    active: computed(() => registered.value && focusInside.value),
  });

  let unregisterRungs: (() => void) | null = null;
  onMounted(() => {
    document.addEventListener("focusin", syncFocus);
    document.addEventListener("focusout", syncFocus);
    syncFocus();
    unregisterRungs = registerContainerRungs();
  });
  onUnmounted(() => {
    unregisterRungs?.();
    instances.splice(instances.indexOf(token), 1);
    if (owner().value === token) owner().value = instances[0];
    document.removeEventListener("focusin", syncFocus);
    document.removeEventListener("focusout", syncFocus);
  });
}

/** Binds the open chord from the header button, which mounts before the async host, so the chord works once the button shows. */
export function useAssistantOpenChord(options: AssistantShortcutsOptions = {}): void {
  const capability = options.gate ? null : getAssistantRuntime().capability;
  const gate = options.gate ?? capability!.gate;
  const canChat = options.assistantCanChat ?? capability!.assistantCanChat;
  const token = Symbol("assistantOpenChord");
  openChordInstances.push(token);
  openChordOwner().value ??= token;
  // G2 and off_for_org leave the chord unbound so the key is not swallowed (`10` §6.2).
  useShortcuts([{ id: "assistantOpen", handler: onAssistantOpen }], undefined, {
    active: computed(
      () =>
        openChordOwner().value === token && !UNREGISTERED_GATES.has(gate.value) && canChat.value,
    ),
  });
  onUnmounted(() => {
    openChordInstances.splice(openChordInstances.indexOf(token), 1);
    if (openChordOwner().value === token) openChordOwner().value = openChordInstances[0];
  });
}

/** A mounted history trigger registers for the chord; returns the unregister. */
export function registerHistoryTarget(target: HistoryTarget): () => void {
  historyTargets.push(target);
  return () => {
    const index = historyTargets.indexOf(target);
    if (index >= 0) historyTargets.splice(index, 1);
  };
}

/** Whether a mounted trigger outranks this one, so a header's Chats hands over to the rail. */
export function historyTargetAbove(priority: number): boolean {
  return historyTargets.some((target) => target.priority > priority && target.el()?.isConnected);
}

/** Runs the chord on the highest-priority trigger; among equals the one next to focus, else the newest. */
export function runHistoryTarget(): boolean {
  const live = historyTargets.filter((target) => target.el()?.isConnected);
  if (live.length === 0) return false;
  const top = Math.max(...live.map((target) => target.priority));
  const ranked = live.filter((target) => target.priority === top);
  const root = document.activeElement?.closest(ASSISTANT_ROOT_SELECTOR);
  const focused = root ? ranked.find((target) => root.contains(target.el())) : undefined;
  (focused ?? ranked.at(-1)!).run();
  return true;
}

/** A component that owns a ladder rung registers it while mounted; returns the unregister. */
export function registerEscapeRung(
  rung: EscapeRung,
  handler: (event: KeyboardEvent) => boolean,
): () => void {
  const set = rungs.get(rung) ?? new Set();
  set.add(handler);
  rungs.set(rung, set);
  return () => set.delete(handler);
}

/** The sidebar host registers how it closes, so rung f closes whatever the focused root shows. */
export function registerContainerCloser(close: () => void): () => void {
  closers.add(close);
  return () => closers.delete(close);
}

/** A card's default button or the composer registers how to take focus for `assistantOpen`. */
export function registerAssistantFocusTarget(
  target: FocusTarget,
  focus: () => boolean,
): () => void {
  const set = focusTargets.get(target) ?? new Set();
  set.add(focus);
  focusTargets.set(target, set);
  return () => set.delete(focus);
}

/** Asks the rungs a→h in order and stops at the first that handles the key. */
export function runEscapeLadder(event?: KeyboardEvent): boolean {
  // Cancelling an IME candidate list must never close, deny or cancel anything (round 1 X-01).
  if (!event || event.isComposing || event.keyCode === 229) return false;
  for (const rung of ESCAPE_RUNGS) {
    for (const handler of rungs.get(rung) ?? []) {
      if (handler(event)) return true;
    }
  }
  return false;
}

/** A keydown listener for a box inside a host's drawer or dialog: an Escape the ladder handled never reaches the host. */
export function stopLadderEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !runEscapeLadder(event)) return;
  event.preventDefault();
  event.stopPropagation();
}

/** `Ctrl+↑`/`⌘↑` from the composer's first line: focuses the latest answer of the visible container (round 2 X-28). */
export function assistantGoToAnswer(): boolean {
  for (const focus of focusTargets.get("answer") ?? []) if (focus()) return true;
  return false;
}

/** Focuses the pending card of the visible container, as leaving Reply mode does. */
export function assistantFocusCard(): boolean {
  for (const focus of focusTargets.get("card") ?? []) if (focus()) return true;
  return false;
}

/** Opens or focuses; the chord never closes (`10` §6.2). */
export function onAssistantOpen(): void {
  const { store } = getAssistantRuntime();
  if (store.state.shell.placement.kind !== "hidden" && focusFirst()) {
    trackAssistant("ai_shortcut", { shortcut_id: "assistantOpen", effect: "focus" });
    return;
  }
  trackAssistant("ai_shortcut", { shortcut_id: "assistantOpen", effect: "open" });
  void openAssistant({
    entryKind: "shortcut",
    entryVerb: "ask",
    objectKind: "none",
    intent: "open",
    container: "auto",
  });
}

/** Lets a spec start from an empty ladder; never called by app code. */
export function resetAssistantShortcutsForTests(): void {
  rungs.clear();
  closers.clear();
  focusTargets.clear();
  instances.length = 0;
  owner().value = undefined;
  openChordInstances.length = 0;
  openChordOwner().value = undefined;
}

// Rung a lets an open overlay take the key; rung f closes the sidebar or sheet (the turn keeps running); rung g closes only a docked chat, never its host; rung h keeps the full view.
function registerContainerRungs(): () => void {
  const off = [
    // Reka closes the overlay on the same keydown; the DOM still shows it open while the ladder runs.
    registerEscapeRung("a", (event) => assistantOverlayOpen(event)),
    registerEscapeRung("f", (event) => {
      if (focusedPlacement(event) !== "sidebar" || closers.size === 0) return false;
      for (const close of closers) close();
      return true;
    }),
    registerEscapeRung("g", (event) => {
      if (focusedPlacement(event) !== "docked") return false;
      const { store } = getAssistantRuntime();
      if (store.state.shell.placement.kind !== "docked") return true;
      trackAssistant("ai_container_closed", { reason: "escape" });
      store.close("escape");
      return true;
    }),
    registerEscapeRung("h", (event) => focusedPlacement(event) === "full"),
  ];
  return () => off.forEach((unregister) => unregister());
}

// Only an overlay the key came from, or one of the assistant's own, takes the key; a page's open menu does not.
function assistantOverlayOpen(event: KeyboardEvent): boolean {
  const target = event.target instanceof Node ? event.target : document.activeElement;
  // A select inside a card portals its list out of the card, so its focused trigger is what says it is open.
  if (target instanceof Element && target.matches(EXPANDED_TRIGGER_SELECTOR)) return true;
  return Array.from(document.querySelectorAll(OPEN_OVERLAY_SELECTOR)).some(
    (overlay) =>
      (!!target && overlay.contains(target)) ||
      !!overlay.querySelector('[data-test^="assistant-"]'),
  );
}

function focusedPlacement(event: KeyboardEvent): string | null {
  const from = event.target instanceof Element ? event.target : document.activeElement;
  return from?.closest<HTMLElement>(ASSISTANT_ROOT_SELECTOR)?.dataset.placement ?? null;
}

function owner(): ShallowRef<symbol | undefined> {
  ownerRef ??= shallowRef<symbol | undefined>(undefined);
  return ownerRef;
}

function openChordOwner(): ShallowRef<symbol | undefined> {
  openChordOwnerRef ??= shallowRef<symbol | undefined>(undefined);
  return openChordOwnerRef;
}

function focusFirst(): boolean {
  for (const target of ["card", "composer"] as const) {
    for (const focus of focusTargets.get(target) ?? []) {
      if (focus()) return true;
    }
  }
  return false;
}
