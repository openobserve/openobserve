<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { useNavGateContext } from "@/lib/core/Navbar/useNavGateContext";
import type { NavItem } from "@/lib/core/Navbar/ONavbar.types";
import { useTheme } from "@/composables/useTheme";
import { switchThemeMode } from "@/utils/theme";
import { focusSearchInput } from "@/utils/keyboardShortcuts";
import PaletteRow from "./PaletteRow.vue";
import { buildPageItems } from "./providers/pages";
import { buildActionItems } from "./providers/actions";
import { usePaletteRows } from "./usePaletteRows";
import { useFrecency } from "./useFrecency";
import type { PaletteItem } from "./types";

const SEARCH_DATA_TEST = "command-palette-search";

const props = defineProps<{
  open: boolean;
  navLinks: NavItem[];
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "open-shortcuts"): void;
  (e: "open-docs"): void;
  (e: "open-slack"): void;
}>();

const store = useStore();
const router = useRouter();
const { t } = useI18nTyped();
const gateContext = useNavGateContext();
const { isDark } = useTheme();
const frecency = useFrecency();

const query = ref("");
const activeIndex = ref(0);
const listRef = ref<HTMLElement | null>(null);

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const userId = computed<string>(() => store.state.userInfo?.email ?? "");
watch(
  [orgId, userId],
  ([org, user]) => {
    if (org && user) void frecency.load(org, user);
  },
  { immediate: true },
);

// Mirrors ThemeSwitcher.setTheme so the header toggle stays in sync through the store.
function applyTheme(mode: "light" | "dark"): void {
  try {
    localStorage.setItem("theme", mode);
  } catch {
    // Storage unavailable: the in-memory theme still flips for this session.
  }
  switchThemeMode(mode, () => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    store.dispatch("appTheme", mode);
  });
}

const handlers = {
  toggleTheme: () => applyTheme(isDark.value ? "light" : "dark"),
  openShortcuts: () => emit("open-shortcuts"),
  openDocs: () => emit("open-docs"),
  openSlack: () => emit("open-slack"),
};

const pages = computed(() =>
  buildPageItems({ navLinks: props.navLinks, ctx: gateContext.value, router, t }),
);
const actions = computed(() =>
  buildActionItems({
    t,
    handlers,
    hasRoute: (name) => router.hasRoute(name),
    isDark: isDark.value,
  }),
);

const { rows, itemIndexes } = usePaletteRows({
  query,
  pages,
  actions,
  frecency: () => frecency.scores("palette_item"),
  t,
});

const activeOptionId = computed(() => `command-palette-option-${activeIndex.value}`);

function scrollActiveIntoView(): void {
  void nextTick(() => {
    listRef.value?.querySelector(`#${activeOptionId.value}`)?.scrollIntoView({ block: "nearest" });
  });
}

function moveActive(delta: number): void {
  const idx = itemIndexes.value;
  if (idx.length === 0) return;
  const pos = idx.indexOf(activeIndex.value);
  const next = pos < 0 ? 0 : (pos + delta + idx.length) % idx.length;
  activeIndex.value = idx[next];
  scrollActiveIntoView();
}

function withOrg(route: RouteLocationRaw): RouteLocationRaw {
  const base = typeof route === "string" ? { path: route } : route;
  const query = "query" in base && base.query ? base.query : {};
  return { ...base, query: { ...query, org_identifier: orgId.value } } as RouteLocationRaw;
}

async function select(item: PaletteItem, newTab = false): Promise<void> {
  frecency.record("palette_item", item.id);
  emit("update:open", false);
  if (item.run) {
    await item.run();
    return;
  }
  if (item.href) {
    window.open(item.href, "_blank", "noopener");
    return;
  }
  if (!item.route) return;
  const location = withOrg(item.route);
  if (newTab) {
    window.open(router.resolve(location).href, "_blank", "noopener");
    return;
  }
  await router.push(location);
}

// Capture phase so the global shortcut manager never sees the keys the palette consumes.
function onKeydown(e: KeyboardEvent): void {
  if (!props.open) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    e.stopPropagation();
    moveActive(e.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (e.key === "Enter") {
    const row = rows.value[activeIndex.value];
    if (row?.kind !== "item") return;
    e.preventDefault();
    e.stopPropagation();
    void select(row.item, e.metaKey || e.ctrlKey);
  }
}

function resetActive(): void {
  activeIndex.value = itemIndexes.value[0] ?? 0;
}

watch(rows, resetActive);

watch(
  () => props.open,
  (open) => {
    if (open) {
      query.value = "";
      resetActive();
      window.addEventListener("keydown", onKeydown, true);
      void nextTick(() => setTimeout(() => focusSearchInput(SEARCH_DATA_TEST), 0));
    } else {
      window.removeEventListener("keydown", onKeydown, true);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown, true));
</script>

<template>
  <ODialog
    :open="open"
    position="top"
    size="lg"
    :show-close="false"
    :max-height="70"
    :title="t('palette.title')"
    data-test="command-palette"
    @update:open="emit('update:open', $event)"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <OSearchInput
          v-model="query"
          size="md"
          class="min-w-0 flex-1"
          :placeholder="t('palette.placeholder')"
          :clearable="false"
          :data-test="SEARCH_DATA_TEST"
        />
        <OShortcut keys="esc" />
      </div>
    </template>

    <div
      ref="listRef"
      role="listbox"
      tabindex="-1"
      :aria-label="t('palette.title')"
      :aria-activedescendant="activeOptionId"
      class="flex flex-col outline-none"
      data-test="command-palette-list"
    >
      <template v-for="(row, i) in rows" :key="row.key">
        <div
          v-if="row.kind === 'header'"
          role="presentation"
          class="text-3xs text-text-secondary px-2 pt-3 pb-1 font-semibold tracking-wider uppercase first:pt-0"
          :data-test="`command-palette-group-${row.key}`"
        >
          {{ row.label }}
        </div>
        <PaletteRow
          v-else
          :item="row.item"
          :index="i"
          :active="i === activeIndex"
          @hover="activeIndex = i"
          @select="select(row.item, $event)"
        />
      </template>
      <OEmptyState
        v-if="itemIndexes.length === 0"
        preset="no-search-results"
        size="inline"
        :description="t('palette.noResults', { q: query })"
        hide-action
        data-test="command-palette-empty"
      />
    </div>

    <template #footer>
      <div class="text-2xs text-text-secondary flex items-center gap-4">
        <span class="flex items-center gap-1">
          <OShortcut :keys="['up', 'down']" />
          {{ t("palette.hint.navigate") }}
        </span>
        <span class="flex items-center gap-1">
          <OShortcut keys="enter" />
          {{ t("palette.hint.open") }}
        </span>
        <span class="flex items-center gap-1">
          <OShortcut keys="ctrl+enter" />
          {{ t("palette.hint.newTab") }}
        </span>
      </div>
    </template>
  </ODialog>
</template>
