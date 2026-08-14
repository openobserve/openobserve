// Copyright 2026 OpenObserve Inc.
//
// useAutoName — the "smart default name" state machine shared by every editor
// whose header title is a name the user would otherwise have to invent.
//
// The rule it encodes: a name is AUTO until the user touches it, then it is
// THEIRS forever. While auto, the name tracks a reactive suggestion derived from
// what the user is actually configuring (the query, the stream, the condition),
// so by the time they reach Save the field is already filled with something
// meaningful. The first keystroke flips it to manual and the suggestion stops
// writing — no editor ever overwrites text a human typed.
//
// Clearing the field back to empty and blurring re-arms auto, which is the
// discoverable "give me the suggestion back" gesture (and why `onCommit` exists
// separately from `markManual`: re-arming on every keystroke would refill the
// input the instant the user selected-all and hit Backspace to retype).

import { computed, ref, watch, type ComputedRef, type Ref } from "vue";

export interface UseAutoNameOptions {
  /** Reactive suggested name. `""` means "nothing worth suggesting yet". */
  suggestion: Ref<string> | ComputedRef<string>;
  /** Reads the field's current value (the form is the single source of truth). */
  currentValue: () => string;
  /** Writes a generated name into the field. */
  apply: (_name: string) => void;
  /**
   * Auto-naming only runs while this returns true — pass `() => !editMode` so an
   * existing object's saved name is never rewritten. Defaults to always on.
   */
  enabled?: () => boolean;
}

export interface UseAutoNameResult {
  /** True while the name is system-generated — drives the "Auto" badge. */
  isAuto: ComputedRef<boolean>;
  /** The user typed: stop tracking the suggestion. Idempotent. */
  markManual: () => void;
  /** The user finished editing. A blank value re-arms auto. */
  onCommit: (_value: string) => void;
  /** Explicitly hand the name back to the generator. */
  resetToAuto: () => void;
}

export function useAutoName(options: UseAutoNameOptions): UseAutoNameResult {
  const isEnabled = () => options.enabled?.() ?? true;

  // Seed: only claim a name that isn't already set. An edit-mode prefill that
  // arrives later is handled by the watch below (enabled flips false, or the
  // value is non-empty so nothing was ever applied).
  const auto = ref(isEnabled() && options.currentValue().trim() === "");

  // The last value this composable wrote. Used to tell "the field still holds my
  // suggestion" from "something else changed it", so a suggestion going empty
  // only clears a name we actually own.
  let lastApplied = "";

  // lastApplied is recorded even when the write is a no-op: it is the record of
  // "what the generator currently claims", which onCommit compares against to
  // decide whether the user actually changed anything.
  const applySuggestion = (next: string) => {
    lastApplied = next;
    if (next === options.currentValue()) return;
    options.apply(next);
  };

  watch(
    [options.suggestion, () => isEnabled()],
    ([next, enabled]) => {
      if (!enabled) {
        auto.value = false;
        return;
      }
      if (!auto.value) return;
      // Only ever overwrite a value this composable put there. Anything else in
      // the field — an edit-mode prefill landing late, a JSON import, a
      // programmatic write — belongs to someone who meant it, and auto-naming
      // steps aside for good rather than clobbering it on the next suggestion.
      const current = options.currentValue();
      if (current !== "" && current !== lastApplied) {
        auto.value = false;
        return;
      }
      if (next) applySuggestion(next);
      else if (current === lastApplied) applySuggestion("");
    },
    { immediate: true },
  );

  const markManual = () => {
    auto.value = false;
  };

  const onCommit = (value: string) => {
    if (!isEnabled()) return;
    const committed = value.trim();

    // Opening the editor and leaving without changing a thing is NOT taking
    // over. Neither is typing something and putting the generated name back.
    // Only a value that differs from what the generator last wrote counts —
    // otherwise merely clicking the name to read it would freeze it forever.
    if (committed === "" || committed === lastApplied) {
      auto.value = true;
      // The suggestion may have moved on while the editor was open; re-sync to
      // the current one rather than to whatever was there when it opened.
      if (options.suggestion.value) applySuggestion(options.suggestion.value);
      return;
    }
    auto.value = false;
  };

  const resetToAuto = () => {
    if (!isEnabled()) return;
    auto.value = true;
    applySuggestion(options.suggestion.value);
  };

  return {
    isAuto: computed(() => auto.value),
    markManual,
    onCommit,
    resetToAuto,
  };
}
