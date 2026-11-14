<script setup lang="ts">
import type { ShortcutProps } from "./OShortcut.types";
import { computed } from "vue";
import { isMacOS } from "@/utils/keyboardShortcuts";
import { getShortcutDisplay } from "@/lib/vue-shortcut-manager/shortcutRegistry";

const props = defineProps<ShortcutProps>();

const isMac = isMacOS();

const resolvedKeys = computed<string | string[]>(() => {
  if (props.keys != null) return props.keys;
  if (props.id) return getShortcutDisplay(props.id) ?? "";
  return "";
});

const SYMBOLS: Record<string, string> = {
  ctrl: isMac ? "⌘" : "Ctrl",
  cmd: "⌘",
  meta: isMac ? "⌘" : "Win",
  shift: isMac ? "⇧" : "Shift",
  alt: isMac ? "⌥" : "Alt",
  option: "⌥",
  enter: "↵",
  return: "↵",
  escape: "Esc",
  esc: "Esc",
  backspace: "⌫",
  delete: isMac ? "⌫" : "Del",
  del: isMac ? "⌫" : "Del",
  space: "Space",
  tab: "⇥",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  home: "Home",
  end: "End",
  pageup: "PgUp",
  pagedown: "PgDn",
};

function symbolizeToken(token: string): string {
  const t = token.trim();
  if (!t) return "";
  return SYMBOLS[t.toLowerCase()] ?? (t.length === 1 ? t.toUpperCase() : t);
}

// A lone "+" is a key, not a separator, so only split combos longer than one character.
function splitCombo(combo: string): string[] {
  return combo.length > 1 ? combo.split("+") : [combo];
}

const caps = computed<string[]>(() => {
  const keys = resolvedKeys.value;
  const combos = Array.isArray(keys) ? keys : [keys];
  return combos.flatMap(splitCombo).map(symbolizeToken).filter(Boolean);
});
</script>

<template>
  <span v-if="caps.length" class="inline-flex items-center gap-0.75" data-test="o-shortcut">
    <kbd
      v-for="(cap, i) in caps"
      :key="i"
      class="rounded-chip border-kbd-border bg-kbd-bg text-kbd-text text-2xs inline-flex h-4.5 min-w-4.5 items-center justify-center border border-b-2 px-1 font-mono leading-none font-medium whitespace-nowrap"
      >{{ cap }}</kbd
    >
  </span>
</template>
