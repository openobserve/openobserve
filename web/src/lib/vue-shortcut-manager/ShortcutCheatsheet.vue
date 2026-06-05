// Copyright 2026 OpenObserve Inc.
<template>
  <ODialog
    v-model:open="open"
    :title="t('shortcuts.title')"
    size="xl"
    data-test="shortcut-cheatsheet-dialog"
  >
    <!-- Search + platform label row -->
    <div class="tw:flex tw:items-center tw:gap-3 tw:mb-3">
      <OSearchInput
        v-model="search"
        :placeholder="t('shortcuts.search')"
        class="tw:flex-1"
        data-test="shortcut-cheatsheet-search"
      />
      <span
        style="font-size: 11px; white-space: nowrap"
        class="tw:text-[var(--o2-text-secondary)]"
      >
        {{ isMac ? t("shortcuts.mac") : t("shortcuts.windowsLinux") }}
      </span>
    </div>

    <!-- No results -->
    <div
      v-if="filteredRegistry.length === 0"
      class="tw:text-center tw:py-8 tw:text-[13px] tw:text-[var(--o2-text-secondary)]"
      data-test="shortcut-cheatsheet-no-results"
    >
      {{ t("shortcuts.noResults") }}
    </div>

    <!-- Shortcut groups -->
    <div
      v-for="group in filteredRegistry"
      :key="group.pageKey"
      class="tw:mb-2"
    >
      <!-- Page section header -->
      <div
        class="tw:text-[10px] tw:font-bold tw:uppercase tw:tracking-widest tw:mb-0.5 tw:pb-0.5 tw:border-b tw:border-[var(--o2-border)]"
        style="color: var(--o2-primary-color)"
      >
        {{ t(group.pageKey) }}
      </div>

      <!-- Shortcut rows -->
      <ul class="tw:list-none tw:p-0 tw:m-0">
        <li
          v-for="s in group.shortcuts"
          :key="s.descriptionKey"
          class="tw:flex tw:justify-between tw:items-center tw:py-1 tw:border-b tw:border-[var(--o2-border)] tw:gap-3"
        >
          <span class="tw:text-[13px] tw:text-[var(--o2-text-primary)]">
            {{ t(s.descriptionKey) }}
          </span>
          <div class="tw:flex tw:gap-1 tw:shrink-0">
            <kbd
              v-for="part in formatKey(s.key)"
              :key="part"
              class="tw:bg-[var(--o2-primary-background)] tw:border tw:border-[var(--o2-border)] tw:rounded tw:px-1.5 tw:py-0.5 tw:font-mono tw:text-[12px] tw:text-[var(--o2-text-primary)] tw:whitespace-nowrap"
              >{{ part }}</kbd
            >
          </div>
        </li>
      </ul>
    </div>

    <!-- Sticky footer -->
    <template #footer>
      <div
        class="tw:text-[11px] tw:text-center tw:text-[var(--o2-text-secondary)]"
      >
        {{ t("shortcuts.toggleHint") }}
        <kbd
          class="tw:bg-[var(--o2-primary-background)] tw:border tw:border-[var(--o2-border)] tw:rounded tw:px-1.5 tw:py-0.5 tw:font-mono tw:text-[11px] tw:mx-0.5"
          >⇧</kbd
        >
        <kbd
          class="tw:bg-[var(--o2-primary-background)] tw:border tw:border-[var(--o2-border)] tw:rounded tw:px-1.5 tw:py-0.5 tw:font-mono tw:text-[11px] tw:mx-0.5"
          >?</kbd
        >
      </div>
    </template>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
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

// Clear search when dialog closes
watch(open, (val) => {
  if (!val) search.value = "";
});

const filteredRegistry = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return SHORTCUT_REGISTRY;
  return SHORTCUT_REGISTRY.flatMap((group) => {
    const shortcuts = group.shortcuts.filter(
      (s) =>
        t(s.descriptionKey).toLowerCase().includes(q) ||
        s.key.toLowerCase().includes(q),
    );
    return shortcuts.length ? [{ ...group, shortcuts }] : [];
  });
});

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
  return key.split("+").map((k) => {
    if (k === "ctrl" && isMac.value) return "⌘";
    return KEY_SYMBOLS[k] ?? k.toUpperCase();
  });
}
</script>
