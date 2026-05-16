<template>
  <div v-if="visible" :style="styles.overlay">
    <div :style="styles.backdrop" @click="visible = false" />
    <div :style="styles.modal">
      <div :style="styles.header">
        <h2 :style="styles.title">Keyboard Shortcuts</h2>
        <button :style="styles.closeBtn" @click="visible = false">✕</button>
      </div>

      <div v-if="groupedShortcuts.length === 0" :style="styles.empty">
        No shortcuts registered.
      </div>

      <div v-for="group in groupedShortcuts" :key="group.scope">
        <h3 :style="styles.scopeTitle">{{ group.scope }}</h3>
        <ul :style="styles.list">
          <li v-for="s in group.shortcuts" :key="s.id" :style="styles.item">
            <div :style="styles.itemLeft">
              <span :style="styles.desc">{{ s.description ?? s.key }}</span>
              <div :style="styles.badges">
                <span
                  v-if="s.scope && s.scope !== 'global'"
                  :style="styles.badgeScope"
                >
                  {{ s.scope }}
                </span>
                <span v-if="s.whenFocused" :style="styles.badgeFocus">
                  focused
                </span>
              </div>
            </div>

            <!-- Right: key combo -->
            <kbd :style="styles.kbd">{{ formatKey(s.key) }}</kbd>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useShortcutList, useShortcut } from "./composables";

const props = withDefaults(defineProps<{ toggleKey?: string }>(), {
  toggleKey: "shift+?",
});

const visible = ref(false);
const { shortcuts } = useShortcutList();

useShortcut(
  props.toggleKey,
  () => {
    visible.value = !visible.value;
  },
  { description: "Show keyboard shortcuts", scope: "global" },
);

const groupedShortcuts = computed(() => {
  const map = new Map<string, typeof shortcuts.value>();
  shortcuts.value.forEach((s) => {
    const scope = s.scope ?? "global";
    if (!map.has(scope)) map.set(scope, []);
    map.get(scope)!.push(s);
  });
  return Array.from(map.entries()).map(([scope, list]) => ({
    scope,
    shortcuts: list,
  }));
});

function formatKey(key: string): string {
  return key
    .split("+")
    .map((k) => {
      const symbols: Record<string, string> = {
        ctrl: "⌃",
        shift: "⇧",
        alt: "⌥",
        meta: "⌘",
        up: "↑",
        down: "↓",
        left: "←",
        right: "→",
        enter: "↵",
        escape: "Esc",
        backspace: "⌫",
        space: "Space",
        tab: "⇥",
        delete: "⌦",
        home: "Home",
        end: "End",
        pageup: "PgUp",
        pagedown: "PgDn",
      };
      return symbols[k] ?? k.toUpperCase();
    })
    .join(" ");
}

const styles = {
  overlay: { position: "fixed" as const, inset: "0", zIndex: "9999" },
  backdrop: {
    position: "fixed" as const,
    inset: "0",
    background: "rgba(0,0,0,0.5)",
  },
  modal: {
    position: "fixed" as const,
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    background: "#fff",
    borderRadius: "12px",
    padding: "24px",
    minWidth: "360px",
    maxWidth: "520px",
    maxHeight: "70vh",
    overflowY: "auto" as const,
    zIndex: "10000",
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "16px",
  },
  title: { fontSize: "18px", fontWeight: "600", margin: "0", color: "#111" },
  closeBtn: {
    background: "none",
    border: "none",
    fontSize: "16px",
    cursor: "pointer",
    color: "#666",
    padding: "4px 8px",
    borderRadius: "4px",
  },
  scopeTitle: {
    fontSize: "11px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: "#999",
    margin: "16px 0 8px",
    fontWeight: "600",
  },
  list: { listStyle: "none", padding: "0", margin: "0" },
  item: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 0",
    borderBottom: "1px solid #f0f0f0",
    fontSize: "14px",
    gap: "12px",
  },
  itemLeft: { display: "flex", flexDirection: "column" as const, gap: "4px" },
  desc: { color: "#333" },
  badges: { display: "flex", gap: "6px" },
  badgeScope: {
    fontSize: "10px",
    background: "#eff6ff",
    color: "#3b82f6",
    border: "1px solid #bfdbfe",
    borderRadius: "4px",
    padding: "1px 6px",
    fontWeight: "500",
  },
  badgeFocus: {
    fontSize: "10px",
    background: "#f0fdf4",
    color: "#16a34a",
    border: "1px solid #bbf7d0",
    borderRadius: "4px",
    padding: "1px 6px",
    fontWeight: "500",
  },
  kbd: {
    background: "#f4f4f4",
    border: "1px solid #ddd",
    borderRadius: "4px",
    padding: "2px 8px",
    fontFamily: "monospace",
    fontSize: "12px",
    color: "#555",
    whiteSpace: "nowrap" as const,
  },
  empty: {
    color: "#999",
    textAlign: "center" as const,
    padding: "24px 0",
    fontSize: "14px",
  },
};
</script>
