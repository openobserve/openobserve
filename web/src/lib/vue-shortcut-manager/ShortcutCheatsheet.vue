// Copyright 2026 OpenObserve Inc.
<template>
  <ODialog
    v-model:open="open"
    size="xl"
    :show-close="false"
    :max-height="85"
    data-test="shortcut-cheatsheet-dialog"
  >
    <!-- ── Sticky header ── -->
    <template #header>
      <div class="flex w-full flex-col gap-2.5">
        <!-- Row 1: icon + title | search | close -->
        <div class="flex items-center gap-3">
          <div class="flex shrink-0 items-center gap-2.5">
            <div
              class="rounded-default flex h-8 w-8 shrink-0 items-center justify-center bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]"
            >
              <OIcon name="key" class="text-accent h-4 w-4" />
            </div>
            <div>
              <div class="text-text-heading text-sm leading-tight font-semibold">
                {{ t("shortcuts.title") }}
              </div>
              <div class="text-2xs text-text-secondary mt-0.5">
                {{ t("shortcuts.subtitle") }}
              </div>
            </div>
          </div>

          <div class="flex-1" />

          <div class="w-56 shrink-0">
            <OSearchInput
              v-model="search"
              :placeholder="t('shortcuts.search')"
              data-test="shortcut-cheatsheet-search"
            />
          </div>

          <OButton
            variant="ghost"
            icon-left="close"
            size="icon"
            class="shrink-0"
            data-test="shortcut-cheatsheet-close-btn"
            @click="open = false"
          />
        </div>

        <!-- Row 2: a chip per module -->
        <div
          v-if="filteredModules.length"
          class="flex flex-wrap items-center gap-1.5"
          data-test="shortcut-cheatsheet-chips"
        >
          <OButton
            v-for="m in filteredModules"
            :key="m.title"
            variant="outline"
            size="chip"
            class="shrink-0"
            :data-test="`shortcut-cheatsheet-chip-${m.title.toLowerCase().replace(/[\s()—/]+/g, '-')}`"
            @click="onModuleClick(m.title)"
          >
            {{ m.title }}
          </OButton>
        </div>
      </div>
    </template>

    <!-- ── Scrollable body ── -->
    <div class="contents">
      <div
        v-if="!hasResults"
        class="text-compact text-text-secondary py-10 text-center"
        data-test="shortcut-cheatsheet-no-results"
      >
        {{ t("shortcuts.noResults") }}
      </div>

      <div v-else class="grid grid-cols-2 gap-x-8 gap-y-0">
        <!-- Left column -->
        <div class="flex flex-col">
          <div
            v-for="(m, idx) in filteredColumns[0]"
            :key="m.title"
            :ref="(el) => registerModuleRef(m.title, el)"
            :data-module="m.title"
            class="rounded-default bg-transparent px-1 pb-2 transition-colors"
          >
            <!-- Module header (partition line above the title) -->
            <div
              class="pb-1.5"
              :class="idx === 0 ? 'pt-1' : 'border-border-default mt-2 border-t pt-3'"
              data-test="shortcut-cheatsheet-module"
            >
              <span class="text-accent text-xs font-semibold tracking-wide">
                {{ m.title }}
              </span>
            </div>

            <!-- Sub-sections (page groups within the module) -->
            <template v-for="sec in m.sections" :key="sec.title">
              <div
                v-if="m.sections.length > 1"
                class="text-3xs text-accent px-1 pt-2 pb-1 font-semibold tracking-wider uppercase"
                data-test="shortcut-cheatsheet-category"
              >
                {{ sec.title }}
              </div>
              <ul class="m-0 list-none p-0">
                <li
                  v-for="entry in sec.entries"
                  :key="entry.id"
                  class="rounded-default hover:bg-surface-base flex items-center justify-between px-2 py-1.5 transition-colors duration-100"
                  :data-test="`shortcut-cheatsheet-row-${entry.id}`"
                >
                  <span class="text-compact text-text-body truncate leading-snug">{{
                    entry.label
                  }}</span>
                  <div class="ml-4 flex shrink-0 items-center gap-1">
                    <template v-for="(part, idx) in formatKey(entry.display)" :key="idx">
                      <span v-if="part === 'then'" class="text-3xs text-text-secondary mx-0.5">{{
                        t("shortcuts.then")
                      }}</span>
                      <kbd
                        v-else
                        class="bg-surface-base border-border-default rounded-default text-2xs text-text-secondary inline-flex h-6 min-w-6 items-center justify-center border px-1.5 font-mono font-medium whitespace-nowrap shadow-[0_1px_0_0_var(--color-border-default)]"
                        >{{ part }}</kbd
                      >
                    </template>
                  </div>
                </li>
              </ul>
            </template>
          </div>
        </div>

        <!-- Right column -->
        <div class="border-border-default flex flex-col border-l pl-8">
          <div
            v-for="(m, idx) in filteredColumns[1]"
            :key="m.title"
            :ref="(el) => registerModuleRef(m.title, el)"
            :data-module="m.title"
            class="rounded-default bg-transparent px-1 pb-2 transition-colors"
          >
            <!-- Module header (partition line above the title) -->
            <div
              class="pb-1.5"
              :class="idx === 0 ? 'pt-1' : 'border-border-default mt-2 border-t pt-3'"
              data-test="shortcut-cheatsheet-module"
            >
              <span class="text-accent text-xs font-semibold tracking-wide">
                {{ m.title }}
              </span>
            </div>

            <!-- Sub-sections (page groups within the module) -->
            <template v-for="sec in m.sections" :key="sec.title">
              <div
                v-if="m.sections.length > 1"
                class="text-3xs text-accent px-1 pt-2 pb-1 font-semibold tracking-wider uppercase"
                data-test="shortcut-cheatsheet-category"
              >
                {{ sec.title }}
              </div>
              <ul class="m-0 list-none p-0">
                <li
                  v-for="entry in sec.entries"
                  :key="entry.id"
                  class="rounded-default hover:bg-surface-base flex items-center justify-between px-2 py-1.5 transition-colors duration-100"
                  :data-test="`shortcut-cheatsheet-row-${entry.id}`"
                >
                  <span class="text-compact text-text-body truncate leading-snug">{{
                    entry.label
                  }}</span>
                  <div class="ml-4 flex shrink-0 items-center gap-1">
                    <template v-for="(part, idx) in formatKey(entry.display)" :key="idx">
                      <span v-if="part === 'then'" class="text-3xs text-text-secondary mx-0.5">{{
                        t("shortcuts.then")
                      }}</span>
                      <kbd
                        v-else
                        class="bg-surface-base border-border-default rounded-default text-2xs text-text-secondary inline-flex h-6 min-w-6 items-center justify-center border px-1.5 font-mono font-medium whitespace-nowrap shadow-[0_1px_0_0_var(--color-border-default)]"
                        >{{ part }}</kbd
                      >
                    </template>
                  </div>
                </li>
              </ul>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Sticky footer ── -->
    <template #footer>
      <div class="text-2xs text-text-secondary flex items-center justify-between">
        <div class="flex flex-wrap items-center gap-1.5">
          <kbd
            class="bg-surface-base border-border-default rounded-default text-2xs inline-flex h-5 items-center justify-center border px-1.5 font-mono shadow-[0_1px_0_0_var(--color-border-default)]"
            >{{ t("shortcuts.escKey") }}</kbd
          >
          <span>{{ t("shortcuts.footerClose") }}</span>
          <span class="opacity-40">·</span>
          <kbd
            class="bg-surface-base border-border-default rounded-default text-2xs inline-flex h-5 items-center justify-center border px-1.5 font-mono shadow-[0_1px_0_0_var(--color-border-default)]"
            >?</kbd
          >
          <span>{{ t("shortcuts.footerReopen") }}</span>
        </div>
        <div class="opacity-60">{{ t("shortcuts.footerMacHint") }}</div>
      </div>
    </template>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useShortcut } from "./composables";
import { SHORTCUT_REGISTRY, SHORTCUT_MODULES } from "./shortcutRegistry";
import type { ShortcutEntry } from "./shortcutRegistry";
import { isMacOS } from "@/utils/keyboardShortcuts";

const props = withDefaults(
  defineProps<{
    open?: boolean;
    toggleKey?: string;
  }>(),
  {
    open: false,
    toggleKey: "shift+?",
  },
);

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const { t } = useI18n();

const open = computed({
  get: () => props.open,
  set: (val) => emit("update:open", val),
});

const search = ref("");

// ── Module-grouped display data ─────────────────────────────────────────────
interface DisplayEntry {
  id: string;
  /** Combo string rendered as keycaps (e.g. "ctrl+enter", "del / ⌫"). */
  display: string;
  label: string;
}
interface DisplaySection {
  title: string;
  entries: DisplayEntry[];
}
interface DisplayModule {
  title: string;
  sections: DisplaySection[];
}

const groupByPage = new Map(SHORTCUT_REGISTRY.map((g) => [g.pageKey, g]));

/**
 * Cheatsheet display combo. Always the Windows/common form — `sym()` renders
 * `ctrl`→`⌘` on Mac, so we never need the explicit `keyForMac` here.
 */
function entryDisplay(e: ShortcutEntry): string {
  return e.display ?? e.keyForWindows ?? e.key ?? "";
}

const allModules = computed<DisplayModule[]>(() => {
  return SHORTCUT_MODULES.map((m) => ({
    title: t(m.titleKey),
    sections: m.pages.flatMap((pageKey) => {
      const group = groupByPage.get(pageKey);
      if (!group) return [];
      return [
        {
          title: t(group.pageKey),
          entries: group.shortcuts.map((s) => ({
            id: s.id,
            display: entryDisplay(s),
            label: t(s.descriptionKey),
          })),
        },
      ];
    }),
  }));
});

const filteredModules = computed<DisplayModule[]>(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return allModules.value;
  return allModules.value.flatMap((m) => {
    const sections = m.sections.flatMap((sec) => {
      const entries = sec.entries.filter(
        (e) => e.label.toLowerCase().includes(q) || e.display.toLowerCase().includes(q),
      );
      return entries.length ? [{ ...sec, entries }] : [];
    });
    return sections.length ? [{ ...m, sections }] : [];
  });
});

const hasResults = computed(() => filteredModules.value.length > 0);

/** Split modules into two balanced columns by total shortcut count. */
const filteredColumns = computed<[DisplayModule[], DisplayModule[]]>(() => {
  const mods = filteredModules.value;
  const count = (m: DisplayModule) => m.sections.reduce((s, sec) => s + sec.entries.length, 0);
  const total = mods.reduce((s, m) => s + count(m), 0);
  const target = total / 2;
  let acc = 0;
  let splitAt = mods.length;
  for (let i = 0; i < mods.length; i++) {
    acc += count(mods[i]);
    if (acc >= target) {
      splitAt = i + 1;
      break;
    }
  }
  return [mods.slice(0, splitAt), mods.slice(splitAt)];
});

// ── Click-only module highlight ─────────────────────────────────────────────
// Highlight happens ONLY on a chip / dropdown click — never on scroll, and the
// chip itself is never kept highlighted. The clicked module's block fades a
// highlight in (after the scroll lands) then gradually back out. State is applied
// imperatively to the module nodes via theme-aware Tailwind class tokens.
let fadeTimer: ReturnType<typeof setTimeout> | null = null;
let pulseInTimer: ReturnType<typeof setTimeout> | null = null;
let activeModule: string | null = null;

const moduleRefs = new Map<string, HTMLElement>();

function registerModuleRef(title: string, el: unknown) {
  if (el instanceof HTMLElement) moduleRefs.set(title, el);
  else moduleRefs.delete(title);
}

const FADE_DELAY = 1600; // how long a module stays lit before fading out
const CLICK_SCROLL_MS = 280; // wait for the click-scroll to land before fading in
const HIGHLIGHT_BG = "bg-shortcut-highlight-bg"; // light tint / dark reversed
const FADE_IN = "duration-700"; // quick, visible fade-in
const FADE_OUT = "duration-[1600ms]"; // slow, gradual fade-out

function fadeOutModule(title: string) {
  const el = moduleRefs.get(title);
  if (el && el.classList.contains(HIGHLIGHT_BG)) {
    el.classList.remove(FADE_IN, HIGHLIGHT_BG);
    el.classList.add(FADE_OUT, "bg-transparent");
  }
}

function pulseModule(title: string) {
  const el = moduleRefs.get(title);
  if (!el) return;
  el.classList.remove(FADE_OUT, "bg-transparent");
  el.classList.add(FADE_IN, HIGHLIGHT_BG);
  if (fadeTimer) clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => fadeOutModule(title), FADE_DELAY);
}

/** Scroll the module's block into view and fade its highlight in. */
function onModuleClick(title: string) {
  const el = moduleRefs.get(title);
  if (!el) return;

  // Cancel the previous selection's pending fade-in and ease its highlight out
  // so only the newly-clicked module is ever lit.
  if (pulseInTimer) clearTimeout(pulseInTimer);
  if (fadeTimer) clearTimeout(fadeTimer);
  if (activeModule && activeModule !== title) fadeOutModule(activeModule);
  activeModule = title;

  el.scrollIntoView({ behavior: "smooth", block: "start" });
  pulseInTimer = setTimeout(() => pulseModule(title), CLICK_SCROLL_MS);
}

function teardown() {
  if (fadeTimer) clearTimeout(fadeTimer);
  if (pulseInTimer) clearTimeout(pulseInTimer);
  activeModule = null;
  moduleRefs.forEach((el) => {
    el.classList.remove(FADE_IN, FADE_OUT, HIGHLIGHT_BG);
    el.classList.add("bg-transparent");
  });
}

watch(open, (val) => {
  if (!val) {
    search.value = "";
    teardown();
  }
});

onUnmounted(teardown);

useShortcut(
  props.toggleKey,
  () => {
    open.value = !open.value;
  },
  {
    description: "shortcuts.actions.openCheatsheet",
    scope: "global",
  },
);

// ── Key formatting ────────────────────────────────────────────────────────────
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
  if (key.includes(" ") || (key.includes("/") && !key.includes("ctrl+"))) return [key];
  if (key.includes(">")) {
    const r: string[] = [];
    key.split(">").forEach((p, i) => {
      if (i > 0) r.push("then");
      r.push(sym(p));
    });
    return r;
  }
  return key.split("+").map(sym);
}

function sym(k: string): string {
  const mac = isMacOS();
  if (k === "ctrl" && mac) return "⌘";
  if (k === "alt" && mac) return "⌥";
  if ((k === "delete" || k === "del") && mac) return "⌫";
  // ⇧ is a Mac glyph; spell it out on Windows/Linux.
  if (k === "shift") return mac ? "⇧" : "Shift";
  if (k === "meta") return mac ? "⌘" : "Win";
  return KEY_SYMBOLS[k] ?? k.toUpperCase();
}
</script>
