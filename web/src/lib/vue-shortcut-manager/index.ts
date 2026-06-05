export { ShortcutManager, getManager, resetManager } from "./manager";
export {
  useShortcut,
  useShortcuts,
  useShortcutScope,
  useShortcutList,
} from "./composables";
export { default as ShortcutCheatsheet } from "./ShortcutCheatsheet.vue";
export { SHORTCUT_REGISTRY } from "./shortcutRegistry";
export type { ShortcutEntry, ShortcutGroup } from "./shortcutRegistry";
export type {
  Shortcut,
  RegisteredShortcut,
  ShortcutManagerOptions,
} from "./types";
