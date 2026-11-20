// Copyright 2026 OpenObserve Inc.

import { ref } from "vue";

interface DismissGuardOptions {
  /** Unsaved edits: a dismiss asks "Discard changes?" first (guideline V5). */
  dirty: () => boolean;
  /** A forced flow or a busy action: dismissing does nothing. */
  locked: () => boolean;
  close: () => void;
}

/** Escape, ✕ and an outside click go through `requestDismiss`; a programmatic close does not. */
export function useDismissGuard(options: DismissGuardOptions) {
  const asking = ref(false);

  function requestDismiss() {
    if (options.locked()) return;
    if (asking.value) {
      asking.value = false;
      return;
    }
    if (options.dirty()) {
      asking.value = true;
      return;
    }
    options.close();
  }

  function keepEditing() {
    asking.value = false;
  }

  function discard() {
    asking.value = false;
    options.close();
  }

  return { asking, requestDismiss, keepEditing, discard };
}

/** What reka's outside interaction asks of a modal overlay: a press outside dismisses it. */
export function outsideInteraction(e: Event): "dismiss" | "refocus" | "ignore" {
  const target = (e as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent?.target;
  // A portaled popup opened from inside the overlay sits outside its DOM but belongs to it.
  if (target instanceof Element && target.closest("[data-reka-popper-content-wrapper]")) {
    return "ignore";
  }
  // A menu that opened the overlay hands focus back to its trigger as it closes; that is no request to leave.
  return e.type === "dismissableLayer.focusOutside" ? "refocus" : "dismiss";
}

const FIELD_SELECTOR = [
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="range"]):not([type="color"]):not([disabled])',
  "textarea:not([disabled])",
  "select:not([disabled])",
  '[role="combobox"]:not([aria-disabled="true"])',
].join(", ");

const countFields = (form: HTMLFormElement): number =>
  Array.from(form.querySelectorAll<HTMLElement>(FIELD_SELECTOR)).filter(
    (el) => !el.closest('[aria-hidden="true"]') && !el.parentElement?.closest('[role="combobox"]'),
  ).length;

/** Enter in a text field submits only a single-field form; in a longer form it never saves (guideline V7). */
export function blockMultiFieldEnter(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.isComposing) return;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.form) return;
  if (countFields(target.form) > 1) event.preventDefault();
}
