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
import useStreams from "@/composables/useStreams";
import { switchThemeMode } from "@/utils/theme";
import { focusSearchInput } from "@/utils/keyboardShortcuts";
import PaletteRow from "./PaletteRow.vue";
import PaletteScopeChips from "./PaletteScopeChips.vue";
import { buildPageItems } from "./providers/pages";
import { buildActionItems } from "./providers/actions";
import { createEntityProviders } from "./providers/entities";
import { usePaletteEntities } from "./usePaletteEntities";
import { usePaletteRows } from "./usePaletteRows";
import { useFrecency } from "./useFrecency";
import { usePaletteTelemetry, type PaletteOpenSource } from "./usePaletteTelemetry";
import { SCOPE_ORDER, type PaletteItem, type PaletteScope } from "./types";

const SEARCH_DATA_TEST = "command-palette-search";

const props = defineProps<{
  open: boolean;
  navLinks: NavItem[];
  aiEnabled?: boolean;
  /** How the current open was triggered; reported once per open. */
  openSource?: PaletteOpenSource;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "open-shortcuts"): void;
  (e: "open-docs"): void;
  (e: "open-slack"): void;
  (e: "ask-ai", query: string): void;
  (e: "switch-org", identifier: string): void;
}>();

const store = useStore();
const router = useRouter();
const { t } = useI18nTyped();
const gateContext = useNavGateContext();
const { isDark } = useTheme();
const frecency = useFrecency();
const telemetry = usePaletteTelemetry(store);

const query = ref("");
const scopes = ref<PaletteScope[]>([]);
const showScopes = ref(false);
// Keyboard position on the chip row; null means the keyboard is in the list.
const chipCursor = ref<number | null>(null);
// Frecency is read once per open so rows never reorder under the pointer.
const itemScores = ref(new Map<string, number>());
const activeIndex = ref(0);
const listRef = ref<HTMLElement | null>(null);
const isOpen = computed(() => props.open);

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

// One row per other organisation; switching goes through MainLayout's selector path.
const orgRows = computed<PaletteItem[]>(() => {
  const orgs: Array<{ identifier: string; name: string }> = store.state.organizations ?? [];
  if (orgs.length < 2) return [];
  return orgs
    .filter((o) => o.identifier && o.identifier !== orgId.value)
    .map((o) => ({
      id: `org:${o.identifier}`,
      type: "org",
      label: String(t("palette.switchOrg", { name: o.name || o.identifier })),
      subtitle: o.identifier,
      icon: "domain",
      keywords: ["org", "organization", "switch", o.identifier],
      run: () => emit("switch-org", o.identifier),
    }));
});

const pages = computed(() =>
  buildPageItems({ navLinks: props.navLinks, ctx: gateContext.value, router, t }),
);
const actions = computed(() => [
  ...buildActionItems({
    t,
    handlers,
    hasRoute: (name) => router.hasRoute(name),
    isDark: isDark.value,
  }),
  ...orgRows.value,
]);

const { getPaginatedStreams } = useStreams(t);
const providers = computed(() =>
  createEntityProviders({
    store,
    t,
    org: orgId.value,
    hasRoute: (name) => router.hasRoute(name),
    navNames: new Set(props.navLinks.map((l) => l.name)),
    searchStreams: (type, q, limit) =>
      getPaginatedStreams(type, false, false, 0, limit, q) as Promise<{
        list?: { name: string }[];
      }>,
  }),
);
const { entities, loading } = usePaletteEntities({
  open: isOpen,
  query,
  scopes,
  org: orgId,
  providers,
});

const fallback = (q: string): PaletteItem | null =>
  props.aiEnabled
    ? {
        id: "ai:ask",
        type: "ai",
        label: String(t("palette.askAi", { q })),
        icon: "auto-awesome",
        trailing: { kind: "shortcut", value: "enter" },
        run: () => emit("ask-ai", q),
      }
    : null;

const { rows, itemIndexes } = usePaletteRows({
  query,
  scopes,
  pages,
  actions,
  entities,
  fallback,
  frecency: () => itemScores.value,
  t,
});

// Chips: one per scope that has at least one enabled source, in rail order.
const scopeList = computed(() => {
  const available = new Set<PaletteScope>(["actions", "pages"]);
  for (const p of providers.value) if (p.enabled()) available.add(p.scope);
  return SCOPE_ORDER.filter((s) => available.has(s)).map((id) => ({
    id,
    label: String(t(`palette.scopes.${id}`)),
  }));
});
const scopeLabels = computed(() =>
  scopes.value.map((id) => ({ id, label: scopeList.value.find((s) => s.id === id)?.label ?? id })),
);
// Selecting every scope is no filter, so the plain placeholder is shown; long lists become "…and N more".
const placeholder = computed(() => {
  const labels = scopeLabels.value.map((s) => s.label);
  if (labels.length === 0 || labels.length === scopeList.value.length)
    return t("palette.placeholder");
  if (labels.length <= 3) return t("palette.placeholderScoped", { scope: labels.join(", ") });
  return t("palette.placeholderScopedMore", {
    scope: labels.slice(0, 2).join(", "),
    n: labels.length - 2,
  });
});

function clearScopes(): void {
  scopes.value = [];
  void nextTick(() => focusSearchInput(SEARCH_DATA_TEST));
}

function toggleScope(id: PaletteScope): void {
  if (scopes.value.includes(id)) {
    scopes.value = scopes.value.filter((s) => s !== id);
  } else {
    scopes.value = [...scopes.value, id];
  }
  void nextTick(() => focusSearchInput(SEARCH_DATA_TEST));
}

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
  const routeQuery = "query" in base && base.query ? base.query : {};
  return { ...base, query: { ...routeQuery, org_identifier: orgId.value } } as RouteLocationRaw;
}

async function select(item: PaletteItem, newTab = false): Promise<void> {
  if (item.type !== "ai") frecency.record("palette_item", item.id);
  telemetry.trackSelect({
    type: item.type,
    position: itemIndexes.value.indexOf(activeIndex.value),
    queryLength: query.value.length,
    scopes: scopes.value,
  });
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

function consume(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopPropagation();
}

// Capture phase so the global shortcut manager never sees the keys the palette consumes.
function onKeydown(e: KeyboardEvent): void {
  if (!props.open) return;
  switch (e.key) {
    case "ArrowDown":
    case "ArrowUp":
      consume(e);
      chipCursor.value = null;
      moveActive(e.key === "ArrowDown" ? 1 : -1);
      return;
    case "Tab":
      consume(e);
      showScopes.value = !showScopes.value;
      chipCursor.value = null;
      return;
    case "ArrowLeft":
    case "ArrowRight": {
      if (!showScopes.value && scopes.value.length === 0) return;
      consume(e);
      const n = scopeList.value.length;
      if (n === 0) return;
      // The first arrow press only lands on an end chip; nothing is ringed until then.
      if (chipCursor.value === null) {
        chipCursor.value = e.key === "ArrowRight" ? 0 : n - 1;
        return;
      }
      chipCursor.value = (chipCursor.value + (e.key === "ArrowRight" ? 1 : -1) + n) % n;
      return;
    }
    case "Backspace":
      if (query.value !== "" || scopes.value.length === 0) return;
      consume(e);
      scopes.value = scopes.value.slice(0, -1);
      return;
    case "Enter": {
      if (chipCursor.value !== null) {
        consume(e);
        const chip = scopeList.value[chipCursor.value];
        if (chip) toggleScope(chip.id);
        return;
      }
      const row = rows.value[activeIndex.value];
      if (row?.kind !== "item") return;
      consume(e);
      void select(row.item, e.metaKey || e.ctrlKey);
      return;
    }
    default:
      if (e.key.length === 1) chipCursor.value = null;
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
      scopes.value = [];
      showScopes.value = false;
      chipCursor.value = null;
      itemScores.value = frecency.scores("palette_item");
      telemetry.trackOpen(props.openSource ?? "shortcut");
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
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <OSearchInput
            v-model="query"
            size="md"
            class="min-w-0 flex-1"
            :placeholder="placeholder"
            :clearable="false"
            :data-test="SEARCH_DATA_TEST"
          />
          <OShortcut keys="esc" />
        </div>
        <PaletteScopeChips
          v-if="showScopes || scopes.length > 0"
          :scopes="scopeList"
          :selected="scopes"
          :cursor="chipCursor"
          @toggle="toggleScope"
          @clear="clearScopes"
        />
      </div>
    </template>

    <div
      ref="listRef"
      role="listbox"
      tabindex="-1"
      :aria-label="t('palette.title')"
      :aria-activedescendant="activeOptionId"
      :aria-busy="loading"
      class="flex flex-col outline-none"
      data-test="command-palette-list"
    >
      <template v-for="(row, i) in rows" :key="row.key">
        <div
          v-if="row.kind === 'header'"
          role="presentation"
          class="text-accent border-border-default mt-3 border-t px-2 pt-3 pb-1.5 text-xs font-semibold tracking-wide first:mt-0 first:border-t-0 first:pt-0"
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
        <span class="flex items-center gap-1">
          <OShortcut keys="tab" />
          {{ showScopes ? t("palette.hint.hideScopes") : t("palette.hint.showScopes") }}
        </span>
      </div>
    </template>
  </ODialog>
</template>
