<script setup lang="ts">
import type { ShortcutProps } from "./OShortcut.types";
import { computed } from "vue";

const props = withDefaults(defineProps<ShortcutProps>(), {
  size: "sm",
});

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform);

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
  return combo
    .split("+")
    .map(symbolizeToken)
    .filter(Boolean)
    .join("");
}

/**
 * A combo string renders as ONE keycap (matching `⌘⇧A` style); an array
 * renders one keycap per element (each element is itself symbolised).
 */
const caps = computed<string[]>(() => {
  if (Array.isArray(props.keys)) {
    return props.keys.map(symbolizeCombo).filter(Boolean);
  }
  const combo = symbolizeCombo(props.keys);
  return combo ? [combo] : [];
});

const sizeClasses: Record<NonNullable<ShortcutProps["size"]>, string> = {
  sm: "tw:h-5 tw:min-w-5 tw:px-1.5 tw:text-[11px]",
  md: "tw:h-6 tw:min-w-6 tw:px-1.5 tw:text-xs",
};
</script>

<template>
  <span
    class="tw:inline-flex tw:items-center tw:gap-1"
    data-test="o-shortcut"
  >
    <kbd
      v-for="(cap, i) in caps"
      :key="i"
      :class="[
        'tw:inline-flex tw:items-center tw:justify-center',
        'tw:rounded tw:border tw:border-kbd-border tw:bg-kbd-bg tw:text-kbd-text',
        'tw:font-medium tw:leading-none tw:whitespace-nowrap tw:shadow-xs',
        sizeClasses[size],
      ]"
      >{{ cap }}</kbd
    >
  </span>
</template>
