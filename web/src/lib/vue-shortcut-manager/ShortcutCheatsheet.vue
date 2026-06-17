// Copyright 2026 OpenObserve Inc.
<template>
  <ODialog
    v-model:open="open"
    size="xl"
    :show-close="false"
    :max-height="85"
    data-test="shortcut-cheatsheet-dialog"
  >
    <!-- ── Sticky header: title row + search ── -->
    <template #header>
      <div class="tw:flex tw:flex-col tw:gap-3 tw:w-full">
        <!-- Title row -->
        <div class="tw:flex tw:items-center tw:justify-between">
          <div class="tw:flex tw:items-center tw:gap-2.5">
            <div
              class="tw:flex tw:items-center tw:justify-center tw:w-8 tw:h-8 tw:rounded-lg tw:shrink-0"
              style="background: color-mix(in srgb, var(--o2-primary-color) 12%, transparent)"
            >
              <OIcon
                name="key"
                class="tw:text-[var(--o2-primary-color)] tw:w-4 tw:h-4"
              />
            </div>
            <div>
              <div class="tw:text-[15px] tw:font-semibold tw:leading-tight tw:text-[var(--o2-text-primary)]">
                {{ t("shortcuts.title") }}
              </div>
              <div class="tw:text-[11px] tw:text-[var(--o2-text-secondary)] tw:mt-0.5">
                {{ t("shortcuts.subtitle") }}
              </div>
            </div>
          </div>
          <OButton
            variant="ghost"
            icon-left="close"
            size="icon"
            data-test="shortcut-cheatsheet-close-btn"
            @click="open = false"
          />
        </div>

        <!-- Sticky search -->
        <OSearchInput
          v-model="search"
          :placeholder="t('shortcuts.search')"
          class="tw:w-full"
          data-test="shortcut-cheatsheet-search"
        />
      </div>
    </template>

    <!-- ── Scrollable body ── -->
    <!-- No results -->
    <div
      v-if="filteredColumns[0].length === 0 && filteredColumns[1].length === 0"
      class="tw:text-center tw:py-10 tw:text-[13px] tw:text-[var(--o2-text-secondary)]"
      data-test="shortcut-cheatsheet-no-results"
    >
      {{ t("shortcuts.noResults") }}
    </div>

    <!-- Two-column layout -->
    <div
      v-else
      class="tw:grid tw:grid-cols-2 tw:gap-x-8 tw:gap-y-0"
    >
      <!-- Left column -->
      <div class="tw:flex tw:flex-col">
        <template v-for="group in filteredColumns[0]" :key="group.title">
          <!-- Section header -->
          <div
            class="tw:flex tw:items-center tw:gap-2 tw:pt-4 tw:pb-1.5 tw:px-1"
            data-test="shortcut-cheatsheet-category"
          >
            <span
              class="tw:text-[10px] tw:font-bold tw:uppercase tw:tracking-widest tw:text-[var(--o2-primary-color)]"
            >{{ group.title }}</span>
            <div class="tw:flex-1 tw:h-px tw:bg-[var(--o2-border)]" />
          </div>
          <!-- Shortcut rows -->
          <ul class="tw:list-none tw:p-0 tw:m-0">
            <li
              v-for="entry in group.entries"
              :key="entry.key + entry.label"
              class="tw:group tw:flex tw:justify-between tw:items-center tw:py-1.5 tw:px-2 tw:rounded-md tw:cursor-pointer tw:transition-colors tw:duration-100 hover:tw:bg-[var(--o2-primary-background)]"
              :data-test="`shortcut-cheatsheet-row-${entry.label.toLowerCase().replace(/\s+/g, '-')}`"
              @click="triggerEntry(entry)"
            >
              <span class="tw:text-[13px] tw:text-[var(--o2-text-primary)] tw:truncate tw:leading-snug">
                {{ entry.label }}
              </span>
              <div class="tw:flex tw:items-center tw:gap-1 tw:shrink-0 tw:ml-4">
                <template v-for="(part, idx) in formatKey(entry.key)" :key="idx">
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

      <!-- Right column -->
      <div class="tw:flex tw:flex-col tw:border-l tw:border-[var(--o2-border)] tw:pl-8">
        <template v-for="group in filteredColumns[1]" :key="group.title">
          <!-- Section header -->
          <div
            class="tw:flex tw:items-center tw:gap-2 tw:pt-4 tw:pb-1.5 tw:px-1"
            data-test="shortcut-cheatsheet-category"
          >
            <span
              class="tw:text-[10px] tw:font-bold tw:uppercase tw:tracking-widest tw:text-[var(--o2-primary-color)]"
            >{{ group.title }}</span>
            <div class="tw:flex-1 tw:h-px tw:bg-[var(--o2-border)]" />
          </div>
          <!-- Shortcut rows -->
          <ul class="tw:list-none tw:p-0 tw:m-0">
            <li
              v-for="entry in group.entries"
              :key="entry.key + entry.label"
              class="tw:group tw:flex tw:justify-between tw:items-center tw:py-1.5 tw:px-2 tw:rounded-md tw:cursor-pointer tw:transition-colors tw:duration-100 hover:tw:bg-[var(--o2-primary-background)]"
              :data-test="`shortcut-cheatsheet-row-${entry.label.toLowerCase().replace(/\s+/g, '-')}`"
              @click="triggerEntry(entry)"
            >
              <span class="tw:text-[13px] tw:text-[var(--o2-text-primary)] tw:truncate tw:leading-snug">
                {{ entry.label }}
              </span>
              <div class="tw:flex tw:items-center tw:gap-1 tw:shrink-0 tw:ml-4">
                <template v-for="(part, idx) in formatKey(entry.key)" :key="idx">
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

    <!-- ── Sticky footer ── -->
    <template #footer>
      <div class="tw:flex tw:justify-between tw:items-center tw:text-[11px] tw:text-[var(--o2-text-secondary)]">
        <div class="tw:flex tw:items-center tw:gap-1.5 tw:flex-wrap">
          <kbd class="tw:inline-flex tw:items-center tw:justify-center tw:h-5 tw:px-1.5 tw:bg-[var(--o2-card-background)] tw:border tw:border-[var(--o2-border)] tw:rounded tw:font-mono tw:text-[11px] tw:shadow-[0_1px_0_0_var(--o2-border)]">Esc</kbd>
          <span>{{ t("shortcuts.footerClose") }}</span>
          <span class="tw:text-[var(--o2-border)]">·</span>
          <kbd class="tw:inline-flex tw:items-center tw:justify-center tw:h-5 tw:px-1.5 tw:bg-[var(--o2-card-background)] tw:border tw:border-[var(--o2-border)] tw:rounded tw:font-mono tw:text-[11px] tw:shadow-[0_1px_0_0_var(--o2-border)]">?</kbd>
          <span>{{ t("shortcuts.footerReopen") }}</span>
          <span class="tw:text-[var(--o2-border)]">·</span>
          <kbd class="tw:inline-flex tw:items-center tw:justify-center tw:h-5 tw:px-1.5 tw:bg-[var(--o2-card-background)] tw:border tw:border-[var(--o2-border)] tw:rounded tw:font-mono tw:text-[11px] tw:shadow-[0_1px_0_0_var(--o2-border)]">↵</kbd>
          <span>{{ t("shortcuts.footerRun") }}</span>
        </div>
        <div class="tw:text-[var(--o2-text-secondary)] tw:opacity-70">{{ t("shortcuts.footerMacHint") }}</div>
      </div>
    </template>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useShortcut } from "./composables";
import { SHORTCUT_REGISTRY } from "./shortcutRegistry";

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

watch(open, (val) => {
  if (!val) search.value = "";
});

interface DisplayEntry {
  key: string;
  label: string;
}

interface DisplayGroup {
  title: string;
  entries: DisplayEntry[];
}

const allGroups = computed<DisplayGroup[]>(() =>
  SHORTCUT_REGISTRY.map((group) => ({
    title: t(group.pageKey),
    entries: group.shortcuts.map((s) => ({
      key: s.key,
      label: t(s.descriptionKey),
    })),
  })),
);

const filteredGroups = computed<DisplayGroup[]>(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return allGroups.value;
  return allGroups.value.flatMap((group) => {
    const entries = group.entries.filter(
      (e) =>
        e.label.toLowerCase().includes(q) || e.key.toLowerCase().includes(q),
    );
    return entries.length ? [{ ...group, entries }] : [];
  });
});

/** Split groups into two columns balanced by total entry count, not group count. */
const filteredColumns = computed<[DisplayGroup[], DisplayGroup[]]>(() => {
  const groups = filteredGroups.value;
  const totalEntries = groups.reduce((sum, g) => sum + g.entries.length, 0);
  const target = totalEntries / 2;
  let accumulated = 0;
  let splitAt = groups.length; // default: everything left
  for (let i = 0; i < groups.length; i++) {
    accumulated += groups[i].entries.length;
    if (accumulated >= target) {
      splitAt = i + 1;
      break;
    }
  }
  return [groups.slice(0, splitAt), groups.slice(splitAt)];
});

function triggerEntry(entry: DisplayEntry): void {
  const parts = entry.key.split("+");
  const mainKey = parts[parts.length - 1];
  const ctrlKey = parts.includes("ctrl");
  const shiftKey = parts.includes("shift");
  const altKey = parts.includes("alt");
  const metaKey = parts.includes("meta");

  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key:
        mainKey.length === 1
          ? mainKey
          : mainKey.charAt(0).toUpperCase() + mainKey.slice(1),
      ctrlKey,
      shiftKey,
      altKey,
      metaKey,
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
  { description: "shortcuts.actions.openCheatsheet", scope: "global" },
);

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
  if (key.includes(" ") || (key.includes("/") && !key.includes("ctrl+"))) {
    return [key];
  }
  if (key.includes(">")) {
    const result: string[] = [];
    key.split(">").forEach((part, i) => {
      if (i > 0) result.push("then");
      result.push(symbolize(part));
    });
    return result;
  }
  return key.split("+").map((k) => symbolize(k));
}

function symbolize(k: string): string {
  if (k === "ctrl" && isMac.value) return "⌘";
  if (k === "alt" && isMac.value) return "⌥";
  if ((k === "delete" || k === "del") && isMac.value) return "⌫";
  return KEY_SYMBOLS[k] ?? k.toUpperCase();
}
</script>
