import type { Ref } from "vue";

export interface Shortcut {
  key: string;
  handler: () => void;
  description?: string;
  scope?: string;
  whenFocused?: Ref<HTMLElement | null> | HTMLElement | null;
}

export interface ShortcutManagerOptions {
  preventDefault?: boolean;
  stopPropagation?: boolean;
}

export interface RegisteredShortcut extends Shortcut {
  id: string;
}

export type ChangeListener = () => void;
