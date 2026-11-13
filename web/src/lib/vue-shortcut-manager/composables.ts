import { raw } from "@/types/i18n";

import { onMounted, onUnmounted, ref, watch } from "vue";
import { getManager } from "./manager";
import { isMacOS } from "@/utils/keyboardShortcuts";
import { getShortcutDef, resolveShortcutKeys } from "./shortcutRegistry";
import type {
  Shortcut,
  ShortcutById,
  ShortcutInput,
  RegisteredShortcut,
  UseShortcutsOptions,
} from "./types";

// ---------- useShortcut ----------

export function useShortcut(
  key: string,
  handler: (e?: KeyboardEvent) => void,
  options: Pick<Shortcut, "description" | "scope" | "whenFocused" | "allowInDialog"> = {},
): void {
  let id: string;

  onMounted(() => {
    const manager = getManager();
    if (!manager) return;
    id = manager.register({ key, handler, ...options });
  });

  onUnmounted(() => {
    if (!id) return;
    getManager()?.unregisterById(id);
  });
}

// ---------- useShortcuts ----------

/** True for the registry-driven `{ id, handler }` form (no inline key). */
function isById(input: ShortcutInput): input is ShortcutById {
  return !("key" in input) && !("keyForWindows" in input) && !("keyForMac" in input);
}

function resolveShortcuts(
  shortcuts: ShortcutInput[],
  scope: string | undefined,
): { toRegister: Shortcut[]; resolvedScope: string | undefined } {
  const mac = isMacOS();
  const toRegister: Shortcut[] = [];
  let inferredScope: string | undefined;

  for (const input of shortcuts) {
    if (isById(input)) {
      const def = getShortcutDef(input.id);
      if (!def) {
        console.warn(
          `[vue-shortcut-manager] Unknown shortcut id "${input.id}". ` +
            `Add it to shortcutRegistry.ts.`,
        );
        continue;
      }
      if (def.scope && inferredScope === undefined) inferredScope = def.scope;
      const keys = resolveShortcutKeys(def, mac);
      keys.forEach((key, i) => {
        toRegister.push({
          id: keys.length > 1 ? `${def.id}-${i}` : def.id,
          key,
          scope: def.scope,
          description: raw(def.descriptionKey),
          handler: input.handler,
          whenFocused: input.whenFocused,
          allowInInput: def.allowInInput,
          skipInInput: def.skipInInput,
          allowInDialog: def.allowInDialog,
          skipUnderModal: def.skipUnderModal,
        });
      });
      if (def.code) {
        toRegister.push({
          id: `${def.id}-code`,
          key: `code:${def.code}`,
          scope: def.scope,
          description: raw(def.descriptionKey),
          handler: input.handler,
          whenFocused: input.whenFocused,
          hidden: true,
          skipUnderModal: def.skipUnderModal,
        });
      }
    } else {
      if (input.scope && inferredScope === undefined) inferredScope = input.scope;
      const key = (mac ? input.keyForMac : input.keyForWindows) ?? input.key;
      toRegister.push({ ...input, key });
    }
  }

  return { toRegister, resolvedScope: scope ?? inferredScope };
}

/** Registers shortcuts outside a component's lifecycle; returns the release, or null with no manager. */
export function registerShortcuts(shortcuts: ShortcutInput[], scope?: string): (() => void) | null {
  const manager = getManager();
  if (!manager) return null;
  const { toRegister, resolvedScope } = resolveShortcuts(shortcuts, scope);
  const scopeToken = resolvedScope ? manager.acquireScope(resolvedScope) : null;
  const ids = toRegister.map((s) =>
    manager.register(resolvedScope && !s.scope ? { ...s, scope: resolvedScope } : s),
  );
  return () => {
    ids.forEach((id) => manager.unregisterById(id));
    if (scopeToken) manager.releaseScope(scopeToken);
  };
}

/**
 * Register a component's keyboard shortcuts in a single call.
 *
 * Two input forms (you can mix them):
 *   1. Registry-driven (preferred): `{ id, handler }` — the key(s), scope and
 *      description are resolved from `shortcutRegistry.ts`, the single source of
 *      truth. No keys are repeated at the call site.
 *   2. Inline `Shortcut`: a full object with its own `key` (or
 *      `keyForWindows` / `keyForMac`) — for one-off shortcuts not in the registry.
 *
 * Platform handling is explicit: a shortcut's `keyForMac` / `keyForWindows`
 * decide which combo is registered on the current platform (only one is). A
 * registry entry with `keys: [...]` registers every binding.
 *
 * `scope` is normally taken from the registry entry; while the component is
 * mounted that scope is made active (and restored on unmount) so page-level
 * shortcuts only fire on their page. Pass `scope` to override.
 */
export function useShortcuts(
  shortcuts: ShortcutInput[],
  scope?: string,
  options: UseShortcutsOptions = {},
): void {
  let isMounted = false;
  let release: (() => void) | null = null;

  const activate = () => {
    if (release) return;
    release = registerShortcuts(shortcuts, scope);
  };

  const deactivate = () => {
    release?.();
    release = null;
  };

  onMounted(() => {
    isMounted = true;
    if (options.active?.value ?? true) activate();
  });

  onUnmounted(() => {
    isMounted = false;
    deactivate();
  });

  if (options.active) {
    watch(options.active, (on) => {
      if (!isMounted) return;
      if (on) activate();
      else deactivate();
    });
  }
}

// ---------- useShortcutList ----------

export function useShortcutList(scope?: string) {
  const shortcuts = ref<RegisteredShortcut[]>([]);

  const refresh = () => {
    const manager = getManager();
    if (!manager) return;
    shortcuts.value = scope ? manager.getByScope(scope) : manager.getAll();
  };

  onMounted(() => {
    const manager = getManager();
    if (!manager) return;
    refresh();
    const unsubscribe = manager.onChange(refresh);
    onUnmounted(unsubscribe);
  });

  return { shortcuts };
}
