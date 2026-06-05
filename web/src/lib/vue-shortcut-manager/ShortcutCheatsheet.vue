<template>
  <ODialog
    v-model:open="open"
    :title="t('shortcuts.title')"
    size="md"
    data-test="shortcut-cheatsheet-dialog"
  >
    <!-- Platform label -->
    <div
      style="font-size: 11px; margin-bottom: 16px"
      class="tw:text-[var(--o2-text-secondary)]"
    >
      {{ isMac ? t("shortcuts.mac") : t("shortcuts.windowsLinux") }}
    </div>

    <!-- Shortcut groups -->
    <div
      v-for="group in SHORTCUT_REGISTRY"
      :key="group.pageKey"
      class="tw:mb-5"
    >
      <!-- Page section header -->
      <div
        class="tw:text-[10px] tw:font-bold tw:uppercase tw:tracking-widest tw:mb-1.5 tw:pb-1 tw:border-b tw:border-[var(--o2-border)]"
        style="color: var(--o2-primary-color)"
      >
        {{ t(group.pageKey) }}
      </div>

      <!-- Shortcut rows -->
      <ul class="tw:list-none tw:p-0 tw:m-0">
        <li
          v-for="s in group.shortcuts"
          :key="s.descriptionKey"
          class="tw:flex tw:justify-between tw:items-center tw:py-1.5 tw:border-b tw:border-[var(--o2-border)] tw:gap-3"
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

    <!-- Sticky footer via ODialog's #footer slot -->
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
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
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

// Two-way binding
const open = computed({
  get: () => props.open,
  set: (val) => emit("update:open", val),
});

// Keyboard shortcut to toggle
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
