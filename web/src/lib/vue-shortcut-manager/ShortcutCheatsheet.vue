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
      <div class="tw:flex tw:flex-col tw:gap-2.5 tw:w-full">
        <!-- Row 1: icon + title | search | close -->
        <div class="tw:flex tw:items-center tw:gap-3">
          <div class="tw:flex tw:items-center tw:gap-2.5 tw:shrink-0">
            <div
              class="tw:flex tw:items-center tw:justify-center tw:w-8 tw:h-8 tw:rounded-lg tw:shrink-0"
              style="
                background: color-mix(
                  in srgb,
                  var(--o2-primary-color) 12%,
                  transparent
                );
              "
            >
              <OIcon
                name="key"
                class="tw:text-[var(--o2-primary-color)] tw:w-4 tw:h-4"
              />
            </div>
            <div>
              <div
                class="tw:text-[15px] tw:font-semibold tw:leading-tight tw:text-[var(--o2-text-primary)]"
              >
                {{ t("shortcuts.title") }}
              </div>
              <div
                class="tw:text-[11px] tw:text-[var(--o2-text-secondary)] tw:mt-0.5"
              >
                {{ t("shortcuts.subtitle") }}
              </div>
            </div>
          </div>

          <div class="tw:flex-1" />

          <div class="tw:w-56 tw:shrink-0">
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
            class="tw:shrink-0"
            data-test="shortcut-cheatsheet-close-btn"
            @click="open = false"
          />
        </div>

        <!-- Row 2: a chip per module -->
        <div
          v-if="filteredModules.length"
          class="tw:flex tw:items-center tw:gap-1.5 tw:flex-wrap"
          data-test="shortcut-cheatsheet-chips"
        >
          <button
            v-for="m in filteredModules"
            :key="m.title"
            type="button"
            class="tw:inline-flex tw:items-center tw:shrink-0 tw:h-6 tw:px-2.5 tw:rounded-full tw:border tw:bg-transparent tw:border-[var(--o2-border)] tw:text-[var(--o2-text-secondary)] tw:text-[11px] tw:font-medium tw:whitespace-nowrap tw:select-none tw:cursor-pointer tw:outline-none tw:transition-colors tw:duration-200 hover:tw:text-[var(--o2-text-primary)] hover:tw:border-[var(--o2-primary-color)]"
            :data-test="`shortcut-cheatsheet-chip-${m.title.toLowerCase().replace(/[\s()—/]+/g, '-')}`"
            @click="onModuleClick(m.title)"
          >
            {{ m.title }}
          </button>
        </div>
      </div>
    </template>

    <!-- ── Scrollable body ── -->
    <div class="tw:contents">
      <div
        v-if="!hasResults"
        class="tw:text-center tw:py-10 tw:text-[13px] tw:text-[var(--o2-text-secondary)]"
        data-test="shortcut-cheatsheet-no-results"
      >
        {{ t("shortcuts.noResults") }}
      </div>

      <div v-else class="tw:grid tw:grid-cols-2 tw:gap-x-8 tw:gap-y-0">
        <!-- Left column -->
        <div class="tw:flex tw:flex-col">
          <div
            v-for="(m, idx) in filteredColumns[0]"
            :key="m.title"
            :ref="(el) => registerModuleRef(m.title, el)"
            :data-module="m.title"
            class="tw:px-1 tw:pb-2 tw:rounded-md tw:bg-transparent tw:transition-colors"
          >
            <!-- Module header (partition line above the title) -->
            <div
              class="tw:pb-1.5"
              :class="
                idx === 0
                  ? 'tw:pt-1'
                  : 'tw:mt-2 tw:pt-3 tw:border-t tw:border-[var(--o2-border)]'
              "
              data-test="shortcut-cheatsheet-module"
            >
              <span
                class="tw:text-[12px] tw:font-semibold tw:tracking-wide tw:text-[var(--o2-primary-color)]"
              >
                {{ m.title }}
              </span>
            </div>

            <!-- Sub-sections (page groups within the module) -->
            <template v-for="sec in m.sections" :key="sec.title">
              <div
                v-if="m.sections.length > 1"
                class="tw:text-[10px] tw:font-semibold tw:uppercase tw:tracking-wider tw:text-[var(--o2-primary-color)] tw:pt-2 tw:pb-1 tw:px-1"
                data-test="shortcut-cheatsheet-category"
              >
                {{ sec.title }}
              </div>
              <ul class="tw:list-none tw:p-0 tw:m-0">
                <li
                  v-for="entry in sec.entries"
                  :key="entry.key + entry.label"
                  class="tw:flex tw:justify-between tw:items-center tw:py-1.5 tw:px-2 tw:rounded-md tw:cursor-pointer tw:transition-colors tw:duration-100 hover:tw:bg-[var(--o2-primary-background)]"
                  :data-test="`shortcut-cheatsheet-row-${entry.label.toLowerCase().replace(/\s+/g, '-')}`"
                  @click="triggerEntry(entry)"
                >
                  <span
                    class="tw:text-[13px] tw:text-[var(--o2-text-primary)] tw:truncate tw:leading-snug"
                    >{{ entry.label }}</span
                  >
                  <div
                    class="tw:flex tw:items-center tw:gap-1 tw:shrink-0 tw:ml-4"
                  >
                    <template
                      v-for="(part, idx) in formatKey(entry.key)"
                      :key="idx"
                    >
                      <span
                        v-if="part === 'then'"
                        class="tw:text-[10px] tw:text-[var(--o2-text-secondary)] tw:mx-0.5"
                        >then</span
                      >
                      <kbd
                        v-else
                        class="tw:inline-flex tw:items-center tw:justify-center tw:min-w-[1.5rem] tw:h-6 tw:px-1.5 tw:bg-[var(--o2-card-background)] tw:border tw:border-[var(--o2-border)] tw:rounded tw:font-mono tw:text-[11px] tw:font-medium tw:text-[var(--o2-text-secondary)] tw:whitespace-nowrap tw:shadow-[0_1px_0_0_var(--o2-border)]"
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
        <div
          class="tw:flex tw:flex-col tw:border-l tw:border-[var(--o2-border)] tw:pl-8"
        >
          <div
            v-for="(m, idx) in filteredColumns[1]"
            :key="m.title"
            :ref="(el) => registerModuleRef(m.title, el)"
            :data-module="m.title"
            class="tw:px-1 tw:pb-2 tw:rounded-md tw:bg-transparent tw:transition-colors"
          >
            <!-- Module header (partition line above the title) -->
            <div
              class="tw:pb-1.5"
              :class="
                idx === 0
                  ? 'tw:pt-1'
                  : 'tw:mt-2 tw:pt-3 tw:border-t tw:border-[var(--o2-border)]'
              "
              data-test="shortcut-cheatsheet-module"
            >
              <span
                class="tw:text-[12px] tw:font-semibold tw:tracking-wide tw:text-[var(--o2-primary-color)]"
              >
                {{ m.title }}
              </span>
            </div>

            <!-- Sub-sections (page groups within the module) -->
            <template v-for="sec in m.sections" :key="sec.title">
              <div
                v-if="m.sections.length > 1"
                class="tw:text-[10px] tw:font-semibold tw:uppercase tw:tracking-wider tw:text-[var(--o2-primary-color)] tw:pt-2 tw:pb-1 tw:px-1"
                data-test="shortcut-cheatsheet-category"
              >
                {{ sec.title }}
              </div>
              <ul class="tw:list-none tw:p-0 tw:m-0">
                <li
                  v-for="entry in sec.entries"
                  :key="entry.key + entry.label"
                  class="tw:flex tw:justify-between tw:items-center tw:py-1.5 tw:px-2 tw:rounded-md tw:cursor-pointer tw:transition-colors tw:duration-100 hover:tw:bg-[var(--o2-primary-background)]"
                  :data-test="`shortcut-cheatsheet-row-${entry.label.toLowerCase().replace(/\s+/g, '-')}`"
                  @click="triggerEntry(entry)"
                >
                  <span
                    class="tw:text-[13px] tw:text-[var(--o2-text-primary)] tw:truncate tw:leading-snug"
                    >{{ entry.label }}</span
                  >
                  <div
                    class="tw:flex tw:items-center tw:gap-1 tw:shrink-0 tw:ml-4"
                  >
                    <template
                      v-for="(part, idx) in formatKey(entry.key)"
                      :key="idx"
                    >
                      <span
                        v-if="part === 'then'"
                        class="tw:text-[10px] tw:text-[var(--o2-text-secondary)] tw:mx-0.5"
                        >then</span
                      >
                      <kbd
                        v-else
                        class="tw:inline-flex tw:items-center tw:justify-center tw:min-w-[1.5rem] tw:h-6 tw:px-1.5 tw:bg-[var(--o2-card-background)] tw:border tw:border-[var(--o2-border)] tw:rounded tw:font-mono tw:text-[11px] tw:font-medium tw:text-[var(--o2-text-secondary)] tw:whitespace-nowrap tw:shadow-[0_1px_0_0_var(--o2-border)]"
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
      <div
        class="tw:flex tw:justify-between tw:items-center tw:text-[11px] tw:text-[var(--o2-text-secondary)]"
      >
        <div class="tw:flex tw:items-center tw:gap-1.5 tw:flex-wrap">
          <kbd
            class="tw:inline-flex tw:items-center tw:justify-center tw:h-5 tw:px-1.5 tw:bg-[var(--o2-card-background)] tw:border tw:border-[var(--o2-border)] tw:rounded tw:font-mono tw:text-[11px] tw:shadow-[0_1px_0_0_var(--o2-border)]"
            >Esc</kbd
          >
          <span>{{ t("shortcuts.footerClose") }}</span>
          <span class="tw:opacity-40">·</span>
          <kbd
            class="tw:inline-flex tw:items-center tw:justify-center tw:h-5 tw:px-1.5 tw:bg-[var(--o2-card-background)] tw:border tw:border-[var(--o2-border)] tw:rounded tw:font-mono tw:text-[11px] tw:shadow-[0_1px_0_0_var(--o2-border)]"
            >?</kbd
          >
          <span>{{ t("shortcuts.footerReopen") }}</span>
          <span class="tw:opacity-40">·</span>
          <kbd
            class="tw:inline-flex tw:items-center tw:justify-center tw:h-5 tw:px-1.5 tw:bg-[var(--o2-card-background)] tw:border tw:border-[var(--o2-border)] tw:rounded tw:font-mono tw:text-[11px] tw:shadow-[0_1px_0_0_var(--o2-border)]"
            >↵</kbd
          >
          <span>{{ t("shortcuts.footerRun") }}</span>
        </div>
        <div class="tw:opacity-60">{{ t("shortcuts.footerMacHint") }}</div>
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
  key: string;
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

const allModules = computed<DisplayModule[]>(() =>
  SHORTCUT_MODULES.map((m) => ({
    title: t(m.titleKey),
    sections: m.pages.flatMap((pageKey) => {
      const group = groupByPage.get(pageKey);
      if (!group) return [];
      return [
        {
          title: t(group.pageKey),
          entries: group.shortcuts.map((s) => ({
            key: s.key,
            label: t(s.descriptionKey),
          })),
        },
      ];
    }),
  })),
);

const filteredModules = computed<DisplayModule[]>(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return allModules.value;
  return allModules.value.flatMap((m) => {
    const sections = m.sections.flatMap((sec) => {
      const entries = sec.entries.filter(
        (e) =>
          e.label.toLowerCase().includes(q) || e.key.toLowerCase().includes(q),
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
  const count = (m: DisplayModule) =>
    m.sections.reduce((s, sec) => s + sec.entries.length, 0);
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
const HIGHLIGHT_BG = "tw:bg-shortcut-highlight-bg"; // light tint / dark reversed
const FADE_IN = "tw:duration-700"; // quick, visible fade-in
const FADE_OUT = "tw:duration-[1600ms]"; // slow, gradual fade-out

function fadeOutModule(title: string) {
  const el = moduleRefs.get(title);
  if (el && el.classList.contains(HIGHLIGHT_BG)) {
    el.classList.remove(FADE_IN, HIGHLIGHT_BG);
    el.classList.add(FADE_OUT, "tw:bg-transparent");
  }
}

function pulseModule(title: string) {
  const el = moduleRefs.get(title);
  if (!el) return;
  el.classList.remove(FADE_OUT, "tw:bg-transparent");
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
    el.classList.add("tw:bg-transparent");
  });
}

watch(open, (val) => {
  if (!val) {
    search.value = "";
    teardown();
  }
});

onUnmounted(teardown);

// ── Shortcut trigger ──────────────────────────────────────────────────────────
function triggerEntry(entry: DisplayEntry) {
  const parts = entry.key.split("+");
  const mainKey = parts[parts.length - 1];
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key:
        mainKey.length === 1
          ? mainKey
          : mainKey.charAt(0).toUpperCase() + mainKey.slice(1),
      ctrlKey: parts.includes("ctrl"),
      shiftKey: parts.includes("shift"),
      altKey: parts.includes("alt"),
      metaKey: parts.includes("meta"),
      bubbles: true,
      cancelable: true,
    }),
  );
}

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
const isMac = computed(
  () =>
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform),
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
  if (key.includes(" ") || (key.includes("/") && !key.includes("ctrl+")))
    return [key];
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
  if (k === "ctrl" && isMac.value) return "⌘";
  if (k === "alt" && isMac.value) return "⌥";
  if ((k === "delete" || k === "del") && isMac.value) return "⌫";
  return KEY_SYMBOLS[k] ?? k.toUpperCase();
}
</script>
