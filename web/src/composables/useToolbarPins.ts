// Copyright 2026 OpenObserve Inc.
//
// Toolbar "pin" preferences composable.
//
// Lets the user pin items out of the logs "More" (utilities) menu so they render
// as fixed-position toolbar controls. The set of pinned item keys is persisted to
// localStorage and shared reactively across every consumer via a module-level ref.
//
// Usage:
//   const { isPinned, togglePin, pinnedItems } = useToolbarPins();
//   isPinned("sqlMode")        // -> boolean
//   togglePin("sqlMode")       // pin / unpin and persist
//   pinnedItems.value          // -> ordered list of currently pinned keys

import { computed, ref } from "vue";

// Canonical keys for every pinnable item in the logs More menu.
export type ToolbarPinKey =
  | "histogram"
  | "sqlMode"
  | "quickMode"
  | "functionEditor"
  | "savedViews"
  | "syntaxGuide";

// Fixed left-to-right render order for pinned controls. Pinning never changes an
// item's position — it only toggles whether the item is shown outside the menu.
export const TOOLBAR_PIN_ORDER: ToolbarPinKey[] = [
  "histogram",
  "sqlMode",
  "quickMode",
  "functionEditor",
  "savedViews",
  "syntaxGuide",
];

const STORAGE_KEY = "logs_toolbar_pinned_items";

// Histogram was a fixed toolbar control before it became pinnable, so it is
// pinned by default. Its absence from STORAGE_KEY (including arrays persisted
// before histogram existed as a pin key) means "never decided", not "unpinned" —
// this flag records the user's first explicit pin/unpin of histogram, after
// which STORAGE_KEY alone is authoritative.
const HISTOGRAM_PIN_DECIDED_KEY = "logs_toolbar_histogram_pin_decided";

const isValidKey = (key: string): key is ToolbarPinKey =>
  (TOOLBAR_PIN_ORDER as string[]).includes(key);

const readInitial = (): ToolbarPinKey[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const pins: ToolbarPinKey[] = Array.isArray(parsed)
      ? parsed.filter(
          (k): k is ToolbarPinKey => typeof k === "string" && isValidKey(k),
        )
      : [];
    const histogramDecided =
      window.localStorage.getItem(HISTOGRAM_PIN_DECIDED_KEY) === "true";
    if (!histogramDecided && !pins.includes("histogram"))
      pins.push("histogram");
    return pins;
  } catch {
    return ["histogram"];
  }
};

// Module-level state so every component instance stays in sync.
const pinnedSet = ref<Set<ToolbarPinKey>>(new Set(readInitial()));

const persist = () => {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Array.from(pinnedSet.value)),
    );
  } catch (e) {
    // localStorage may be unavailable (private mode / quota) — pins stay in-memory.
    console.log(`Error persisting toolbar pins: ${e}`);
  }
};

export function useToolbarPins() {
  const isPinned = (key: ToolbarPinKey): boolean => pinnedSet.value.has(key);

  const togglePin = (key: ToolbarPinKey): void => {
    const next = new Set(pinnedSet.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    pinnedSet.value = next;
    if (key === "histogram") {
      try {
        window.localStorage.setItem(HISTOGRAM_PIN_DECIDED_KEY, "true");
      } catch {
        // localStorage may be unavailable — the default-pinned fallback reapplies next session.
      }
    }
    persist();
  };

  // Pinned keys in canonical order (not insertion order).
  const pinnedItems = computed<ToolbarPinKey[]>(() =>
    TOOLBAR_PIN_ORDER.filter((key) => pinnedSet.value.has(key)),
  );

  return { isPinned, togglePin, pinnedItems };
}

export default useToolbarPins;
