import type { RegisteredShortcut, Shortcut, ShortcutManagerOptions } from "./types";
import { isInputFocused } from "@/utils/keyboardShortcuts";

// ---------------------------------------------------------------------------
// Lazy singleton — no plugin or main.ts setup needed.
// Manager is created on the first composable call and lives for the app lifetime.
// ---------------------------------------------------------------------------

// Store state on window so it survives Vite HMR module replacement.
// Module-level variables reset on every hot-reload, but window persists.
const _KEY = "__vue_shortcut_manager__";

interface ManagerState {
  instance: ShortcutManager | null;
  handler: ((e: KeyboardEvent) => void) | null;
}

function _state(): ManagerState {
  if (typeof window === "undefined") return { instance: null, handler: null };
  if (!(window as any)[_KEY]) {
    (window as any)[_KEY] = { instance: null, handler: null } as ManagerState;
  }
  return (window as any)[_KEY];
}

export function getManager(options?: ShortcutManagerOptions): ShortcutManager | null {
  if (typeof window === "undefined") return null;
  const s = _state();
  if (!s.instance) {
    s.instance = new ShortcutManager(options);
    s.handler = (e) => _state().instance!.handleKeyDown(e);
    window.addEventListener("keydown", s.handler);
  }
  return s.instance;
}

/** Reset singleton — removes the global keydown listener */
export function resetManager(): void {
  if (typeof window === "undefined") return;
  const s = _state();
  if (s.handler) {
    window.removeEventListener("keydown", s.handler);
    s.handler = null;
  }
  s.instance = null;
}

// ---------------------------------------------------------------------------

export class ShortcutManager {
  private shortcuts = new Map<string, RegisteredShortcut[]>();
  private activeScope = "global";
  private sequenceBuffer: string[] = [];
  private sequenceTimeout: ReturnType<typeof setTimeout> | null = null;
  private options: ShortcutManagerOptions;
  private listeners = new Set<() => void>();

  constructor(options: ShortcutManagerOptions = {}) {
    this.options = {
      preventDefault: true,
      stopPropagation: false,
      ...options,
    };
  }

  // ---------- Scope ----------

  setScope(scope: string): void {
    this.activeScope = scope;
  }

  getScope(): string {
    return this.activeScope;
  }

  // ---------- Change listeners (for reactivity) ----------

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  // ---------- Register / Unregister ----------

  register(shortcut: Shortcut): string {
    const id =
      shortcut.id ??
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
    const key = shortcut.key.toLowerCase();
    const existing = this.shortcuts.get(key) ?? [];

    // Conflict detection — warn and overwrite
    const conflict = existing.find((s) => (s.scope ?? "global") === (shortcut.scope ?? "global"));
    if (conflict) {
      console.warn(
        `[vue-shortcut-manager] Conflict: "${key}" already registered in scope "${shortcut.scope ?? "global"}". Overwriting.`,
      );
      this.unregisterById(conflict.id);
    }

    this.shortcuts.set(key, [...(this.shortcuts.get(key) ?? []), { ...shortcut, key, id }]);

    this.notify();
    return id;
  }

  unregister(key: string, scope = "global"): void {
    const list = this.shortcuts.get(key.toLowerCase()) ?? [];
    const filtered = list.filter((s) => (s.scope ?? "global") !== scope);
    if (filtered.length === 0) {
      this.shortcuts.delete(key.toLowerCase());
    } else {
      this.shortcuts.set(key.toLowerCase(), filtered);
    }
  }

  unregisterById(id: string): void {
    for (const [key, list] of this.shortcuts.entries()) {
      const filtered = list.filter((s) => s.id !== id);
      if (filtered.length === 0) {
        this.shortcuts.delete(key);
      } else {
        this.shortcuts.set(key, filtered);
      }
    }
    this.notify();
  }

  // ---------- List (Cheatsheet) ----------

  getAll(): RegisteredShortcut[] {
    return Array.from(this.shortcuts.values()).flat();
  }

  getByScope(scope: string): RegisteredShortcut[] {
    return this.getAll().filter((s) => (s.scope ?? "global") === scope);
  }

  /** Find a registered shortcut by its id (for tests / programmatic triggers). */
  getById(id: string): RegisteredShortcut | undefined {
    for (const list of this.shortcuts.values()) {
      const found = list.find((s) => s.id === id);
      if (found) return found;
    }
    return undefined;
  }

  // ---------- Key Parsing ----------

  private static KEY_ALIASES: Record<string, string> = {
    " ": "space",
    arrowup: "up",
    arrowdown: "down",
    arrowleft: "left",
    arrowright: "right",
    escape: "escape",
    enter: "enter",
    backspace: "backspace",
    tab: "tab",
    delete: "delete",
    home: "home",
    end: "end",
    pageup: "pageup",
    pagedown: "pagedown",
  };

  private parseEvent(e: KeyboardEvent): string {
    const parts: string[] = [];
    if (e.ctrlKey) parts.push("ctrl");
    if (e.shiftKey) parts.push("shift");
    if (e.altKey) parts.push("alt");
    if (e.metaKey) parts.push("meta");

    const raw = e.key.toLowerCase();
    if (["control", "shift", "alt", "meta"].includes(raw)) {
      return parts.join("+");
    }

    const key = ShortcutManager.KEY_ALIASES[raw] ?? raw;
    parts.push(key);

    return parts.join("+");
  }

  // ---------- Event Handler ----------

  handleKeyDown(e: KeyboardEvent): void {
    const key = this.parseEvent(e);

    if (!key || key === "") return;

    this.sequenceBuffer.push(key);
    if (this.sequenceTimeout) clearTimeout(this.sequenceTimeout);

    const sequenceKey = this.sequenceBuffer.join(" ");

    const sequenceMatch = this.findMatch(sequenceKey);
    if (sequenceMatch) {
      this.sequenceBuffer = [];
      this.triggerShortcut(sequenceMatch, e);
      return;
    }

    if (this.hasSequenceStartingWith(sequenceKey)) {
      this.sequenceTimeout = setTimeout(() => {
        this.sequenceBuffer = [];
      }, 1000);
      return;
    }

    this.sequenceBuffer = [];

    const match = this.findMatch(key);
    if (match) {
      this.triggerShortcut(match, e);
    }
  }

  private hasSequenceStartingWith(prefix: string): boolean {
    for (const key of this.shortcuts.keys()) {
      if (key.includes(" ") && key.startsWith(prefix) && key !== prefix) {
        return true;
      }
    }
    return false;
  }

  private findMatch(key: string): RegisteredShortcut | undefined {
    const list = this.shortcuts.get(key) ?? [];
    return (
      list.find((s) => (s.scope ?? "global") === this.activeScope) ??
      list.find((s) => (s.scope ?? "global") === "global")
    );
  }

  /**
   * Returns true when the shortcut key string contains a command modifier
   * (ctrl, meta, alt). `shift` is intentionally excluded: on most keyboards it
   * only produces a printable character (e.g. `shift+?` → "?"), so a shift-only
   * combo behaves like a plain key and must still be suppressed while the user
   * is typing in an input. Pure single-letter keys have no modifier.
   */
  private static hasModifier(key: string): boolean {
    return key.includes("ctrl+") || key.includes("meta+") || key.includes("alt+");
  }

  private triggerShortcut(shortcut: RegisteredShortcut, e: KeyboardEvent): void {
    // Guard: never intercept single-letter shortcuts while the user is typing
    // in an input/textarea/contenteditable. Modifier-key shortcuts (Ctrl+S,
    // ⌘+Enter, etc.) are always allowed through regardless of focus, and a
    // shortcut can opt out with `allowInInput` (e.g. Escape closing a panel).
    // The event's composed target (not document.activeElement) is checked so
    // inputs inside shadow DOM are detected too.
    if (
      !shortcut.allowInInput &&
      !ShortcutManager.hasModifier(shortcut.key) &&
      isInputFocused(e.composedPath?.()[0] ?? e.target)
    ) {
      return;
    }

    if (shortcut.whenFocused !== undefined && shortcut.whenFocused !== null) {
      const isRef =
        shortcut.whenFocused !== null &&
        typeof shortcut.whenFocused === "object" &&
        !(shortcut.whenFocused instanceof Element) &&
        "value" in (shortcut.whenFocused as object);

      const el = isRef
        ? (shortcut.whenFocused as { value: HTMLElement | null }).value
        : (shortcut.whenFocused as HTMLElement);

      if (!el || document.activeElement !== el) return;
    }

    if (this.options.preventDefault && e.key !== "Escape") e.preventDefault();
    if (this.options.stopPropagation) e.stopPropagation();
    shortcut.handler();
  }
}
