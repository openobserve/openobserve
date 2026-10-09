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
  options: Pick<Shortcut, "description" | "scope" | "whenFocused"> = {},
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
        });
      });
    } else {
      if (input.scope && inferredScope === undefined) inferredScope = input.scope;
      const key = (mac ? input.keyForMac : input.keyForWindows) ?? input.key;
      toRegister.push({ ...input, key });
    }
  }

  return { toRegister, resolvedScope: scope ?? inferredScope };
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
  let ids: string[] = [];
  let scopeToken: symbol | null = null;
  let isMounted = false;
  let isRegistered = false;

  const activate = () => {
    const manager = getManager();
    if (!manager || isRegistered) return;
    isRegistered = true;
    const { toRegister, resolvedScope } = resolveShortcuts(shortcuts, scope);
    if (resolvedScope) scopeToken = manager.acquireScope(resolvedScope);
    ids = toRegister.map((s) =>
      manager.register(resolvedScope && !s.scope ? { ...s, scope: resolvedScope } : s),
    );
  };

  const deactivate = () => {
    const manager = getManager();
    if (!manager || !isRegistered) return;
    isRegistered = false;
    ids.forEach((id) => manager.unregisterById(id));
    ids = [];
    if (scopeToken) manager.releaseScope(scopeToken);
    scopeToken = null;
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
