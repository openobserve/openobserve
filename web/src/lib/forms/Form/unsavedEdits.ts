// Copyright 2026 OpenObserve Inc.

import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";

// What precedes a user's edit: autofill, dictation and assistive tech skip the key and pointer events.
const USER_EVENTS = [
  "pointerdown",
  "keydown",
  "click",
  "paste",
  "drop",
  "beforeinput",
  "input",
  "change",
];

// Navigation and modifier keys never edit a value, so they leave the baseline open.
const NON_EDITING_KEYS = new Set(["Escape", "Tab", "Shift", "Control", "Alt", "Meta", "CapsLock"]);

// Several forms in one overlay share its flag, so it holds while any one of them has edits.
const formsReportingTo = new WeakMap<Ref<boolean>, Set<Readonly<Ref<boolean>>>>();

interface TrackedForm {
  state: { values: unknown };
  useStore: (selector: (state: any) => any) => Readonly<Ref<any>>;
  reset: (...args: any[]) => unknown;
}

/** Equal as the user sees them: key order, empty against missing, and 5 against "5" are no edit. */
export function sameFormValues(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (isEmptyValue(a) && isEmptyValue(b)) return true;
  if (typeof a === "number" && typeof b === "string") return sameNumber(a, b);
  if (typeof a === "string" && typeof b === "number") return sameNumber(b, a);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameFormValues(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) if (!sameFormValues(a[key], b[key])) return false;
    return true;
  }
  return false;
}

// Dirty means "differs from what the user first saw": values set before their first keystroke or
// click (an async fill, a normalised default) are that baseline. `active` is the overlay's open state.
export function useUnsavedChanges(read: () => unknown, active: () => boolean = () => true) {
  const baseline = shallowRef<unknown>(undefined);
  const captured = ref(false);
  let disposed = false;

  const rebase = () => {
    baseline.value = snapshot(read());
    captured.value = true;
    listen(false);
  };
  // Window capture runs before the control's own handler, so the model still holds the old value.
  const onUserEvent = (e: Event) => {
    if (e instanceof KeyboardEvent && NON_EDITING_KEYS.has(e.key)) return;
    // Code that sets a value may echo a synthetic input or change event; only the browser's own count.
    if ((e.type === "input" || e.type === "change") && !e.isTrusted) return;
    if (!captured.value) rebase();
  };
  function listen(on: boolean) {
    for (const type of USER_EVENTS) {
      if (on) window.addEventListener(type, onUserEvent, true);
      else window.removeEventListener(type, onUserEvent, true);
    }
  }
  const release = () => {
    captured.value = false;
    listen(!disposed && active());
  };

  watch(active, release, { immediate: true });
  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true;
      listen(false);
    });
  }

  return {
    dirty: computed(() => active() && captured.value && !sameFormValues(read(), baseline.value)),
    /** Takes the current value as the baseline, as after a save. */
    rebase,
    /** Forgets the baseline, as after a re-seed: clean until the user's next keystroke or click. */
    release,
  };
}

/** Mirrors an OForm's unsaved edits into `dirty`; a reset re-seeds what the user sees. */
export function trackUnsavedEdits(form: TrackedForm, dirty: Ref<boolean>) {
  const values = form.useStore((s: any) => s.values);
  const tracker = useUnsavedChanges(() => values.value);

  const originalReset = form.reset;
  const reset = (...args: unknown[]) => {
    const result = originalReset(...args);
    tracker.release();
    return result;
  };
  form.reset = reset;

  const forms = formsReportingTo.get(dirty) ?? new Set();
  formsReportingTo.set(dirty, forms);
  forms.add(tracker.dirty);
  const report = () => (dirty.value = [...forms].some((d) => d.value));
  watch(tracker.dirty, report, { immediate: true });
  if (getCurrentScope()) {
    onScopeDispose(() => {
      if (form.reset === reset) form.reset = originalReset;
      forms.delete(tracker.dirty);
      report();
    });
  }
  return { markSaved: tracker.rebase };
}

function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function sameNumber(n: number, s: string): boolean {
  return s.trim() !== "" && Number(s) === n;
}

// Plain objects and arrays are copied, so an in-place mutation after the snapshot still reads as an edit.
function snapshot<T>(value: T): T {
  if (Array.isArray(value)) return value.map(snapshot) as T;
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, snapshot(v)])) as T;
  }
  return value;
}
