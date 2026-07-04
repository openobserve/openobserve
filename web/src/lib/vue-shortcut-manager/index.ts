export { ShortcutManager, getManager, resetManager } from "./manager";
export { useShortcut, useShortcuts, useShortcutList } from "./composables";
export { default as ShortcutCheatsheet } from "./ShortcutCheatsheet.vue";
export {
  SHORTCUT_REGISTRY,
  SHORTCUT_MODULES,
  getShortcutDef,
  getShortcutDisplay,
  resolveShortcutKeys,
} from "./shortcutRegistry";
export type {
  ShortcutEntry,
  ShortcutGroup,
  ShortcutModule,
  ShortcutDef,
} from "./shortcutRegistry";
export type {
  Shortcut,
  ShortcutById,
  ShortcutInput,
  RegisteredShortcut,
  ShortcutManagerOptions,
} from "./types";
