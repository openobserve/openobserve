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

// Rung handlers return true when they handled the key, which stops the ladder there.
const rungs = new Map<EscapeRung, Set<(event: KeyboardEvent) => boolean>>();

// `card` (a pending approval or consent card) is asked before `composer` (`10` §6.2).
const focusTargets = new Map<FocusTarget, Set<() => boolean>>();

// Mounted instances in mount order; the first binds, and the binding passes on when it unmounts.
const instances: symbol[] = [];

// The sidebar and sheet hosts register how they close; rung f asks them for the focused root.
const closers = new Set<() => void>();

let ownerRef: ShallowRef<symbol | undefined> | null = null;

export type EscapeRung = (typeof ESCAPE_RUNGS)[number];

export type FocusTarget = "card" | "composer";

export interface AssistantShortcutsOptions {
  /** Overrides the runtime's gate, for specs. */
  gate?: ComputedRef<GateCode>;
  assistantCanChat?: ComputedRef<boolean>;
}

/** Binds the assistant chords once per tab; called by the layout that mounts the assistant. */
export function useAssistantShortcuts(options: AssistantShortcutsOptions = {}): void {
  const capability = options.gate ? null : getAssistantRuntime().capability;
  const gate = options.gate ?? capability!.gate;
  const canChat = options.assistantCanChat ?? capability!.assistantCanChat;
  const focusInside = ref(false);
  const token = Symbol("assistantShortcuts");
  instances.push(token);
  owner().value ??= token;
  const registered = computed(() => owner().value === token && !UNREGISTERED_GATES.has(gate.value));
  const syncFocus = () => {
    focusInside.value = !!document.activeElement?.closest(ASSISTANT_ROOT_SELECTOR);
  };

  // G2 and off_for_org leave the chord unbound so the key is not swallowed (`10` §6.2).
  useShortcuts([{ id: "assistantOpen", handler: onAssistantOpen }], undefined, {
    active: computed(() => registered.value && canChat.value),
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
}

// Rung f closes the sidebar or sheet (the turn keeps running); rung h keeps the full view and swallows the key.
function registerContainerRungs(): () => void {
  const off = [
    registerEscapeRung("f", (event) => {
      if (focusedPlacement(event) !== "sidebar" || closers.size === 0) return false;
      for (const close of closers) close();
      return true;
    }),
    registerEscapeRung("h", (event) => focusedPlacement(event) === "full"),
  ];
  return () => off.forEach((unregister) => unregister());
}

function focusedPlacement(event: KeyboardEvent): string | null {
  const from = event.target instanceof Element ? event.target : document.activeElement;
  return from?.closest<HTMLElement>(ASSISTANT_ROOT_SELECTOR)?.dataset.placement ?? null;
}

function owner(): ShallowRef<symbol | undefined> {
  ownerRef ??= shallowRef<symbol | undefined>(undefined);
  return ownerRef;
}

function focusFirst(): boolean {
  for (const target of ["card", "composer"] as const) {
    for (const focus of focusTargets.get(target) ?? []) {
      if (focus()) return true;
    }
  }
  return false;
}
