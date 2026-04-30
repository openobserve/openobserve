import { onMounted, onUnmounted, ref } from "vue";
import { getManager } from "./manager";
import type { Shortcut, RegisteredShortcut } from "./types";

// ---------- useShortcut ----------

export function useShortcut(
  key: string,
  handler: () => void,
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

export function useShortcuts(shortcuts: Shortcut[]): void {
  const ids: string[] = [];

  onMounted(() => {
    const manager = getManager();
    if (!manager) return;
    shortcuts.forEach((s) => ids.push(manager.register(s)));
  });

  onUnmounted(() => {
    const manager = getManager();
    if (!manager) return;
    ids.forEach((id) => manager.unregisterById(id));
  });
}

// ---------- useShortcutScope ----------

export function useShortcutScope(scope: string): void {
  let previousScope: string;

  onMounted(() => {
    const manager = getManager();
    if (!manager) return;
    previousScope = manager.getScope();
    manager.setScope(scope);
  });

  onUnmounted(() => {
    getManager()?.setScope(previousScope ?? "global");
  });
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
