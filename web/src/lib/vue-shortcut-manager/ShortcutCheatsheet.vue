<template>
  <div v-if="visible" style="position: fixed; inset: 0; z-index: 9999">
    <div
      style="position: fixed; inset: 0; background: rgba(0,0,0,0.5)"
      @click="visible = false"
    />
    <div :style="modalStyle">
      <!-- Header -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px">
        <div>
          <div style="font-size: 16px; font-weight: 700; color: var(--o2-text-primary, #111)">
            {{ t("shortcuts.title") }}
          </div>
          <div style="font-size: 11px; color: var(--o2-text-secondary, #888); margin-top: 2px">
            {{ isMac ? t("shortcuts.mac") : t("shortcuts.windowsLinux") }}
          </div>
        </div>
        <button :style="closeBtnStyle" @click="visible = false" :aria-label="t('common.close')">✕</button>
      </div>

      <!-- Groups -->
      <div v-for="group in SHORTCUT_REGISTRY" :key="group.pageKey" style="margin-bottom: 20px">
        <div :style="groupHeaderStyle">{{ t(group.pageKey) }}</div>
        <ul style="list-style: none; padding: 0; margin: 0">
          <li
            v-for="s in group.shortcuts"
            :key="s.descriptionKey"
            :style="rowStyle"
          >
            <span style="font-size: 13px; color: var(--o2-text-primary, #333)">
              {{ t(s.descriptionKey) }}
            </span>
            <div style="display: flex; gap: 4px; flex-shrink: 0">
              <kbd v-for="part in formatKey(s.key)" :key="part" :style="kbdStyle">{{ part }}</kbd>
            </div>
          </li>
        </ul>
      </div>

      <!-- Footer -->
      <div style="margin-top: 8px; font-size: 11px; color: var(--o2-text-secondary, #aaa); text-align: center; border-top: 1px solid var(--o2-border, #eee); padding-top: 12px">
        Press <kbd :style="kbdStyle">⇧</kbd>&nbsp;<kbd :style="kbdStyle">?</kbd> {{ t("shortcuts.toggleHint") }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useShortcut } from "./composables";
import { SHORTCUT_REGISTRY } from "./shortcutRegistry";

const props = withDefaults(defineProps<{ toggleKey?: string }>(), {
  toggleKey: "shift+?",
});

const { t } = useI18n();
const visible = ref(false);

useShortcut(props.toggleKey, () => { visible.value = !visible.value; }, {
  description: "shortcuts.actions.openCheatsheet",
  scope: "global",
});

const isMac = computed(() =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform),
);

const KEY_SYMBOLS: Record<string, string> = {
  ctrl: "Ctrl",
  shift: "⇧",
  alt: "Alt",
  meta: "⌘",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  enter: "↵",
  escape: "Esc",
  backspace: "⌫",
  delete: "Del",
  space: "Space",
  tab: "⇥",
  home: "Home",
  end: "End",
  pageup: "PgUp",
  pagedown: "PgDn",
};

function formatKey(key: string): string[] {
  return key.split("+").map((k) => {
    if (k === "ctrl" && isMac.value) return "⌘";
    return KEY_SYMBOLS[k] ?? k.toUpperCase();
  });
}

const modalStyle = {
  position: "fixed" as const,
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  background: "var(--o2-card-background, #fff)",
  borderRadius: "12px",
  padding: "24px",
  width: "min(500px, 92vw)",
  maxHeight: "78vh",
  overflowY: "auto" as const,
  zIndex: "10000",
  boxShadow: "0 20px 60px rgba(0,0,0,0.22)",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const groupHeaderStyle = {
  fontSize: "10px",
  fontWeight: "700",
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  color: "var(--o2-primary-color, #3b82f6)",
  marginBottom: "6px",
  paddingBottom: "4px",
  borderBottom: "1px solid var(--o2-border, #eee)",
};

const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "7px 2px",
  borderBottom: "1px solid var(--o2-border, #f5f5f5)",
  gap: "12px",
};

const closeBtnStyle = {
  background: "none",
  border: "none",
  fontSize: "16px",
  cursor: "pointer",
  color: "var(--o2-text-secondary, #666)",
  padding: "4px 8px",
  borderRadius: "4px",
};

const kbdStyle = {
  background: "var(--o2-primary-background, #f4f4f4)",
  border: "1px solid var(--o2-border, #ddd)",
  borderRadius: "4px",
  padding: "2px 7px",
  fontFamily: "monospace",
  fontSize: "12px",
  color: "var(--o2-text-primary, #444)",
  whiteSpace: "nowrap" as const,
};
</script>
