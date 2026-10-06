// Copyright 2026 OpenObserve Inc.
//
// Toolbar "pin" preferences composable.
//
// Lets the user pin items out of a toolbar "More" menu so they render as fixed-position
// toolbar controls. Each scope (logs, traces) persists its own set of pinned item keys to
// localStorage and shares it reactively across every consumer via module-level state.
//
// Usage:
//   const { isPinned, togglePin, pinnedItems } = useToolbarPins();          // logs
//   const { isPinned, togglePin } = useToolbarPins("traces");
//   isPinned("sqlMode")        // -> boolean
//   togglePin("sqlMode")       // pin / unpin and persist
//   pinnedItems.value          // -> ordered list of currently pinned keys

import { computed, ref, type Ref } from "vue";

// Canonical keys for every pinnable item across all scopes.
export type ToolbarPinKey =
  "histogram" | "sqlMode" | "quickMode" | "functionEditor" | "savedViews" | "syntaxGuide";

export type ToolbarPinScope = "logs" | "traces";

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

interface ToolbarPinScopeConfig {
  storageKey: string;
  keys: ToolbarPinKey[];
  // A default pin's absence from storageKey means "never decided" until its decided flag is set.
  defaultPins: Partial<Record<ToolbarPinKey, string>>;
}

const SCOPES: Record<ToolbarPinScope, ToolbarPinScopeConfig> = {
  logs: {
    storageKey: "logs_toolbar_pinned_items",
    keys: TOOLBAR_PIN_ORDER,
    defaultPins: { histogram: "logs_toolbar_histogram_pin_decided" },
  },
  traces: {
    storageKey: "traces_toolbar_pinned_items",
    keys: ["savedViews"],
    defaultPins: { savedViews: "traces_toolbar_saved_views_pin_decided" },
  },
};

const scopeStates = new Map<ToolbarPinScope, Ref<Set<ToolbarPinKey>>>();

const isDecided = (decidedKey: string): boolean => {
  try {
    return window.localStorage.getItem(decidedKey) === "true";
  } catch {
    return false;
  }
};

const readStoredPins = (config: ToolbarPinScopeConfig): ToolbarPinKey[] => {
  try {
    const raw = window.localStorage.getItem(config.storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (k): k is ToolbarPinKey => typeof k === "string" && (config.keys as string[]).includes(k),
        )
      : [];
  } catch {
    return [];
  }
};

const readInitial = (config: ToolbarPinScopeConfig): ToolbarPinKey[] => {
  const pins = readStoredPins(config);
  for (const [key, decidedKey] of Object.entries(config.defaultPins) as [ToolbarPinKey, string][]) {
    if (!isDecided(decidedKey) && !pins.includes(key)) pins.push(key);
  }
  return pins;
};

const getScopeState = (scope: ToolbarPinScope): Ref<Set<ToolbarPinKey>> => {
  let state = scopeStates.get(scope);
  if (!state) {
    state = ref(new Set(readInitial(SCOPES[scope]))) as Ref<Set<ToolbarPinKey>>;
    scopeStates.set(scope, state);
  }
  return state;
};

export function useToolbarPins(scope: ToolbarPinScope = "logs") {
  const config = SCOPES[scope];
  const pinnedSet = getScopeState(scope);

  const persist = () => {
    try {
      window.localStorage.setItem(config.storageKey, JSON.stringify(Array.from(pinnedSet.value)));
    } catch (e) {
      // localStorage may be unavailable (private mode / quota) — pins stay in-memory.
      console.log(`Error persisting toolbar pins: ${e}`);
    }
  };

  const isPinned = (key: ToolbarPinKey): boolean => pinnedSet.value.has(key);

  const togglePin = (key: ToolbarPinKey): void => {
    const next = new Set(pinnedSet.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    pinnedSet.value = next;
    const decidedKey = config.defaultPins[key];
    if (decidedKey) {
      try {
        window.localStorage.setItem(decidedKey, "true");
      } catch {
        // localStorage may be unavailable — the default-pinned fallback reapplies next session.
      }
    }
    persist();
  };

  // Pinned keys in canonical order (not insertion order).
  const pinnedItems = computed<ToolbarPinKey[]>(() =>
    TOOLBAR_PIN_ORDER.filter((key) => config.keys.includes(key) && pinnedSet.value.has(key)),
  );

  return { isPinned, togglePin, pinnedItems };
}

export default useToolbarPins;
