<script setup lang="ts">
import type { ShortcutProps } from "./OShortcut.types";
import { computed } from "vue";
import { isMacOS } from "@/utils/keyboardShortcuts";
import { getShortcutDisplay } from "@/lib/vue-shortcut-manager/shortcutRegistry";

const props = withDefaults(defineProps<ShortcutProps>(), {
  size: "sm",
});

const isMac = isMacOS();

/** Explicit `keys` win; otherwise resolve from the registry by `id`. */
const resolvedKeys = computed<string | string[]>(() => {
  if (props.keys != null) return props.keys;
  if (props.id) return getShortcutDisplay(props.id) ?? "";
  return "";
});

/** Token → display symbol. Modifier glyphs are platform-aware. */
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

/** Symbolise a single token (e.g. "ctrl" → "⌘", "a" → "A"). */
function symbolizeToken(token: string): string {
  const t = token.trim();
  if (!t) return "";
  return SYMBOLS[t.toLowerCase()] ?? (t.length === 1 ? t.toUpperCase() : t);
}

/** Symbolise a combo like "ctrl+shift+a" → "⌘⇧A" (joined into one keycap). */
function symbolizeCombo(combo: string): string {
  return combo.split("+").map(symbolizeToken).filter(Boolean).join("");
}

/**
 * A combo string renders as ONE keycap (matching `⌘⇧A` style); an array
 * renders one keycap per element (each element is itself symbolised).
 */
const caps = computed<string[]>(() => {
  const keys = resolvedKeys.value;
  if (Array.isArray(keys)) {
    return keys.map(symbolizeCombo).filter(Boolean);
  }
  const combo = symbolizeCombo(keys);
  return combo ? [combo] : [];
});

const sizeClasses: Record<NonNullable<ShortcutProps["size"]>, string> = {
  sm: "h-5 min-w-5 px-1.5 text-2xs",
  md: "h-6 min-w-6 px-1.5 text-xs",
};
</script>

<template>
  <span class="inline-flex items-center gap-1" data-test="o-shortcut">
    <kbd
      v-for="(cap, i) in caps"
      :key="i"
      :class="[
        'inline-flex items-center justify-center',
        'rounded-default border-kbd-border bg-kbd-bg text-kbd-text border',
        'leading-none font-medium whitespace-nowrap shadow-md',
        sizeClasses[size],
      ]"
      >{{ cap }}</kbd
    >
  </span>
</template>
