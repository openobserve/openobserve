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

<!--
  OrganizationSelector
  ────────────────────
  Trigger button + searchable, virtualized organization menu.

  Why a custom virtualized list instead of OTable: OTable's virtualizer
  hardcodes overscan:100, so a few hundred orgs mount ~200 heavy rows at
  once and the menu hangs. Here we drive @tanstack/vue-virtual directly
  with a small overscan and plain markup.

  Styling is pure Tailwind ( prefix) + semantic design tokens — selected
  / hover states reuse the same select-item-* tokens as OSelect so the menu
  matches the rest of the app. No SCSS, no scoped classes.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch } from "vue";
import { isNavigationFailure, useRouter } from "vue-router";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { useVirtualizer } from "@tanstack/vue-virtual";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { copyToClipboard } from "@/utils/clipboard";
import { orgCreatePending } from "@/utils/orgScopedRoutes";
import { ORG_SWITCHER_MAX_FAVORITES, useOrgSwitcherPrefs } from "@/composables/useOrgSwitcherPrefs";
import {
  buildSections,
  rankSearch,
  type OrgSection,
  type SwitcherRow,
} from "@/utils/orgSwitcherList";

interface OrgOption {
  label: I18nText;
  identifier: string;
  [key: string]: any;
}

type GridCell = "name" | "star" | "copy";

const props = defineProps<{
  /** Full list of organizations to choose from. */
  organizations: OrgOption[];
  /** The currently active organization (drives the trigger label + selection). */
  current?: OrgOption | null;
}>();

const emit = defineEmits<{
  (e: "select", org: OrgOption): void;
}>();

const { t } = useI18nTyped();
const router = useRouter();
const { isFavorite, canAddFavorite, canStore, favorites, recents, toggleFavorite } =
  useOrgSwitcherPrefs();

const open = ref(false);
const searchQuery = ref("");
const gridId = `org-switcher-grid-${useId()}`;
const searchWrapRef = ref<HTMLElement | null>(null);

// Sections are computed from this snapshot so an open menu never regroups under the pointer.
const openSnapshot = shallowRef<{
  favorites: readonly string[];
  recents: readonly string[];
  currentId: string | undefined;
}>({ favorites: [], recents: [], currentId: undefined });

const takeSnapshot = () => {
  openSnapshot.value = {
    favorites: [...favorites.value],
    recents: [...recents.value],
    currentId: props.current?.identifier,
  };
};

const listRows = computed<SwitcherRow<OrgOption>[]>(() =>
  searchQuery.value.trim()
    ? rankSearch(props.organizations, openSnapshot.value, searchQuery.value)
    : buildSections(props.organizations, openSnapshot.value, openSnapshot.value.currentId),
);

const orgRowCount = computed(() => listRows.value.filter((r) => r.kind === "row").length);

const SECTION_LABEL_KEYS = {
  favorites: "organization.favorites",
  recent: "organization.recent",
  all: "organization.allOrganizations",
} as const satisfies Record<OrgSection, string>;

// ── Virtualization ──────────────────────────────────────────────
// Headings are shorter than org rows, so estimateSize switches on row kind.
const ROW_HEIGHT = 36;
const HEADING_HEIGHT = 28;
const scrollRef = ref<HTMLElement | null>(null);

const virtualizer = useVirtualizer(
  computed(() => ({
    count: listRows.value.length,
    getScrollElement: () => scrollRef.value,
    estimateSize: (i: number) =>
      listRows.value[i]?.kind === "heading" ? HEADING_HEIGHT : ROW_HEIGHT,
    getItemKey: (i: number) => listRows.value[i]?.key ?? i,
    overscan: 8,
  })),
);

const totalSize = computed(() => virtualizer.value.getTotalSize());

const virtualRows = computed(() =>
  virtualizer.value.getVirtualItems().map((v) => ({
    index: v.index,
    start: v.start,
    size: v.size,
    row: listRows.value[v.index],
  })),
);

// ── Active cell (combobox + grid; DOM focus stays in the search input) ──
// Without a storage key there is nowhere to keep a favorite, so the star cell is not rendered.
const cellOrder = computed<GridCell[]>(() =>
  canStore.value ? ["name", "star", "copy"] : ["name", "copy"],
);
const activeIndex = ref(-1);
const activeCol = ref<GridCell>("name");

const cellId = (index: number, col: GridCell) => `${gridId}-${index}-${col}`;
const activeRendered = computed(
  () => activeIndex.value >= 0 && virtualRows.value.some((v) => v.index === activeIndex.value),
);
const activeDescendant = computed(() =>
  activeRendered.value ? cellId(activeIndex.value, activeCol.value) : undefined,
);
const isActiveCell = (index: number, col: GridCell) =>
  activeIndex.value === index && activeCol.value === col;

const firstOrgRowIndex = () => listRows.value.findIndex((r) => r.kind === "row");

const scrollActiveIntoView = () => {
  if (activeIndex.value >= 0) virtualizer.value.scrollToIndex(activeIndex.value);
};

// A wheel scroll can unmount the active row; a grid key brings it back so its cell id resolves again.
const revealActiveRow = () => {
  if (activeIndex.value >= 0 && !activeRendered.value) scrollActiveIntoView();
};

const moveRow = (step: 1 | -1) => {
  const list = listRows.value;
  const len = list.length;
  let i = activeIndex.value < 0 ? (step === 1 ? -1 : len) : activeIndex.value;
  for (let n = 0; n < len; n++) {
    i = (i + step + len) % len;
    if (list[i].kind === "row") {
      activeIndex.value = i;
      activeCol.value = "name";
      return;
    }
  }
};

const moveCol = (step: 1 | -1) => {
  const order = cellOrder.value;
  const next = order.indexOf(activeCol.value) + step;
  if (next >= 0 && next < order.length) activeCol.value = order[next];
};

const select = (org: OrgOption) => {
  open.value = false;
  emit("select", org);
};

// Copy feedback lives on the button itself (icon flips to a tick) — no toast.
const copiedId = ref<string | null>(null);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const copyId = async (org: OrgOption) => {
  const ok = await copyToClipboard(org.identifier, t, { silent: true });
  if (!ok) return;
  copiedId.value = org.identifier;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copiedId.value = null;
  }, 1500);
};

onBeforeUnmount(() => {
  if (copyTimer) clearTimeout(copyTimer);
});

const starBlocked = (org: OrgOption) => !isFavorite(org.identifier) && !canAddFavorite.value;
const starLabel = (org: OrgOption) =>
  isFavorite(org.identifier)
    ? t("organization.removeNamedFromFavorites", { name: org.label })
    : t("organization.addNamedToFavorites", { name: org.label });
const starTooltip = (org: OrgOption) => {
  if (starBlocked(org)) {
    return t("organization.favoritesLimitReached", { max: ORG_SWITCHER_MAX_FAVORITES });
  }
  return isFavorite(org.identifier)
    ? t("organization.removeFromFavorites")
    : t("organization.addToFavorites");
};

const actOnActiveCell = () => {
  const row = listRows.value[activeIndex.value];
  if (!row || row.kind !== "row") return;
  const org = row.org;
  if (activeCol.value === "star") toggleFavorite(org.identifier);
  else if (activeCol.value === "copy") void copyId(org);
  else select(org);
};

const caretAtEnd = (e: KeyboardEvent) => {
  const input = e.target instanceof HTMLInputElement ? e.target : null;
  return !input || input.selectionStart === input.value.length;
};

const onSearchKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    open.value = false;
    return;
  }
  if (e.isComposing) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!orgRowCount.value) return;
    e.preventDefault();
    moveRow(e.key === "ArrowDown" ? 1 : -1);
    nextTick(scrollActiveIntoView);
  } else if (e.key === "ArrowRight") {
    if (activeIndex.value < 0 || activeCol.value === "copy" || !caretAtEnd(e)) return;
    e.preventDefault();
    moveCol(1);
    revealActiveRow();
  } else if (e.key === "ArrowLeft") {
    if (activeIndex.value < 0 || activeCol.value === "name") return;
    e.preventDefault();
    moveCol(-1);
    revealActiveRow();
  } else if (e.key === "Enter") {
    e.preventDefault();
    revealActiveRow();
    actOnActiveCell();
  } else if (e.key === " " && activeIndex.value >= 0 && activeCol.value === "star") {
    e.preventDefault();
    revealActiveRow();
    actOnActiveCell();
  }
};

const onRowHover = (index: number) => {
  if (activeIndex.value === index) return;
  activeIndex.value = index;
  activeCol.value = "name";
};

const focusSearch = () => {
  searchWrapRef.value?.querySelector("input")?.focus();
};

// The first tabbable in the panel is "+", so focus is sent to the search instead.
const onOpenAutoFocus = (e: Event) => {
  e.preventDefault();
  focusSearch();
};

watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    takeSnapshot();
    activeIndex.value = -1;
    activeCol.value = "name";
  },
  { flush: "sync" },
);

watch(open, async (isOpen) => {
  if (!isOpen) {
    searchQuery.value = "";
    return;
  }
  await nextTick();
  // Popover content (and the scroll element) mounts fresh on every open.
  virtualizer.value.measure();
  if (scrollRef.value) scrollRef.value.scrollTop = 0;
  focusSearch();
});

// The active row follows its key across list changes; a new query makes Enter pick the top
// result, and an empty one keeps nothing active.
let rowsQuery = "";
watch(listRows, (rows, previous) => {
  const query = searchQuery.value.trim();
  const previousQuery = rowsQuery;
  const activeKey = query === previousQuery ? previous?.[activeIndex.value]?.key : undefined;
  rowsQuery = query;
  const kept = activeKey ? rows.findIndex((r) => r.key === activeKey) : -1;
  if (kept < 0) activeCol.value = "name";
  if (query !== previousQuery && scrollRef.value) scrollRef.value.scrollTop = 0;
  activeIndex.value = kept >= 0 ? kept : query ? firstOrgRowIndex() : -1;
  virtualizer.value.measure();
});

const isSelected = (org: OrgOption) => org.identifier === props.current?.identifier;

// Selection reuses the same tokens OSelect uses, so the menu is visually
// consistent with every other dropdown in the app.
const rowStateClass = (org: OrgOption, index: number) => {
  if (isSelected(org)) {
    return "bg-select-item-selected-bg text-select-item-selected-text";
  }
  if (index === activeIndex.value) {
    return "bg-select-item-hover-bg text-select-item-text";
  }
  return "text-select-item-text";
};

// Reserved slots: `invisible` keeps the box, so the name never shifts when the buttons appear.
const slotVisibility = (index: number, alwaysShown: boolean) =>
  alwaysShown || index === activeIndex.value
    ? "visible"
    : "invisible group-hover:visible max-md:visible";

const openCreate = async () => {
  open.value = false;
  orgCreatePending.value = true;
  if (router.currentRoute.value.name === "organizations") return;
  try {
    const failure = await router.push({
      name: "organizations",
      query: { org_identifier: props.current?.identifier, action: "add" },
    });
    if (isNavigationFailure(failure)) orgCreatePending.value = false;
  } catch {
    orgCreatePending.value = false;
  }
};

const openManage = () => {
  open.value = false;
  void router.push({
    name: "organizations",
    query: { org_identifier: props.current?.identifier },
  });
};

useShortcuts([
  {
    id: "openOrgSwitcher",
    handler: () => {
      open.value = true;
    },
  },
]);
</script>

<template>
  <div
    data-test="navbar-organizations-select"
    class="max-md:min-w-10 md:max-xl:w-56 md:max-xl:min-w-20"
  >
    <OPopover
      v-model:open="open"
      side="bottom"
      align="end"
      content-class="min-w-40 p-1 text-sm text-dropdown-item-text"
      @open-auto-focus="onOpenAutoFocus"
    >
      <template #trigger>
        <OButton
          variant="outline-primary"
          size="xs"
          data-test="navbar-organizations-select-trigger"
          class="text-text-body! w-56 max-md:w-full max-md:max-w-28 md:max-xl:w-full"
          :class="open ? 'ring-focus-ring-accent ring-2 ring-inset' : ''"
        >
          <template #icon-left>
            <OIcon name="domain" size="sm" class="shrink-0 opacity-60" />
          </template>
          <OTruncatedText v-if="current?.label" class="flex-1 text-left">{{
            current.label
          }}</OTruncatedText>
          <OSkeleton
            v-else
            type="text"
            class="h-3 flex-1"
            data-test="navbar-organizations-select-placeholder"
          />
          <template #icon-right>
            <OIcon
              name="arrow-drop-down"
              size="sm"
              class="shrink-0 opacity-70 transition-transform"
              :class="open ? 'rotate-180' : ''"
            />
          </template>
        </OButton>
      </template>

      <div data-test="organization-menu-list" class="flex w-94 max-w-[98vw] flex-col">
        <div class="flex items-center gap-2 px-3 pt-2 pb-1.5">
          <span class="text-compact text-text-heading flex-1 font-semibold">
            {{ t("organization.header") }}
          </span>
          <span
            data-test="organization-menu-count"
            class="text-2xs bg-select-item-hover-bg text-text-secondary shrink-0 rounded-full px-2 py-1 leading-none font-semibold"
          >
            {{
              searchQuery
                ? t("common.countOfTotal", { count: orgRowCount, total: organizations.length })
                : organizations.length
            }}
          </span>
          <OButton
            variant="ghost"
            size="icon-xs-sq"
            icon-left="add"
            :aria-label="t('organization.add')"
            data-test="organization-menu-create-btn"
            @click="openCreate"
          >
            <OTooltip :content="t('organization.add')" />
          </OButton>
        </div>

        <div ref="searchWrapRef" class="px-3 pb-3">
          <OSearchInput
            data-test="organization-search-input"
            v-model="searchQuery"
            clearable
            :debounce="1"
            :placeholder="t('organization.searchByNameOrId')"
            role="combobox"
            :aria-expanded="orgRowCount > 0"
            aria-haspopup="grid"
            aria-autocomplete="list"
            :aria-controls="orgRowCount ? gridId : undefined"
            :aria-activedescendant="activeDescendant"
            @keydown="onSearchKeydown"
          />
        </div>

        <div v-if="orgRowCount" class="bg-select-content-border mx-3 h-px" aria-hidden="true" />

        <div
          v-if="orgRowCount"
          :id="gridId"
          ref="scrollRef"
          role="grid"
          :aria-rowcount="listRows.length"
          :aria-label="t('organization.header')"
          data-test="organization-menu-table"
          class="relative max-h-96 overflow-x-hidden overflow-y-auto pt-2 pb-1"
        >
          <div class="relative w-full" :style="{ height: `${totalSize}px` }">
            <template v-for="v in virtualRows" :key="v.row.key">
              <div
                v-if="v.row.kind === 'heading'"
                role="row"
                :aria-rowindex="v.index + 1"
                :data-test="`organization-menu-section-${v.row.section}`"
                class="absolute top-0 right-0 left-0 box-border flex h-7 items-end px-3 pb-1"
                :style="{ transform: `translateY(${v.start}px)` }"
              >
                <span role="columnheader" class="text-2xs text-text-secondary font-medium">
                  {{ t(SECTION_LABEL_KEYS[v.row.section]) }}
                </span>
              </div>
              <div
                v-else
                role="row"
                :aria-rowindex="v.index + 1"
                :aria-selected="isSelected(v.row.org)"
                data-test="organization-menu-item-label-item-label"
                :data-test-org-identifier="v.row.org.identifier"
                class="group rounded-default absolute top-0 right-0 left-0 box-border flex cursor-pointer items-center gap-1 px-3 transition-colors"
                :class="rowStateClass(v.row.org, v.index)"
                :style="{
                  transform: `translateY(${v.start}px)`,
                  height: `${v.size}px`,
                }"
                @click="select(v.row.org)"
                @mousemove="onRowHover(v.index)"
              >
                <!-- The ID appears only when it adds information and yields to keep the name readable. -->
                <div
                  :id="cellId(v.index, 'name')"
                  role="gridcell"
                  class="flex min-w-0 flex-1 items-baseline gap-2"
                >
                  <OTruncatedText
                    class="text-compact max-w-full flex-none leading-tight font-medium"
                  >
                    {{ v.row.org.label }}
                  </OTruncatedText>
                  <OTruncatedText
                    v-if="v.row.org.identifier && v.row.org.identifier !== v.row.org.label"
                    class="text-2xs text-text-secondary shrink font-mono leading-tight"
                  >
                    {{ v.row.org.identifier }}
                  </OTruncatedText>
                </div>

                <div
                  v-if="canStore"
                  :id="cellId(v.index, 'star')"
                  role="gridcell"
                  class="shrink-0"
                  :class="slotVisibility(v.index, isFavorite(v.row.org.identifier))"
                >
                  <OButton
                    variant="ghost"
                    size="icon-xs-sq"
                    tabindex="-1"
                    :icon-left="isFavorite(v.row.org.identifier) ? 'star' : 'star-outline'"
                    :class="[
                      isFavorite(v.row.org.identifier) ? 'text-favorite' : 'text-text-secondary',
                      isActiveCell(v.index, 'star') ? 'ring-focus-ring-accent ring-2' : '',
                    ]"
                    :aria-pressed="isFavorite(v.row.org.identifier)"
                    :aria-label="starLabel(v.row.org)"
                    :disabled="starBlocked(v.row.org)"
                    focusable-unavailable
                    data-test="organization-menu-item-favorite"
                    :data-test-org-identifier="v.row.org.identifier"
                    @click.stop="toggleFavorite(v.row.org.identifier)"
                  >
                    <OTooltip side="bottom" :content="starTooltip(v.row.org)" />
                    <template #unavailable-reason>{{ starTooltip(v.row.org) }}</template>
                  </OButton>
                </div>

                <!-- Copying leaves the selection in place, so the button tick is the only confirmation. -->
                <div
                  :id="cellId(v.index, 'copy')"
                  role="gridcell"
                  class="shrink-0"
                  :class="slotVisibility(v.index, copiedId === v.row.org.identifier)"
                >
                  <OButton
                    variant="ghost"
                    size="icon-xs-sq"
                    tabindex="-1"
                    :icon-left="copiedId === v.row.org.identifier ? 'check' : 'content-copy'"
                    :class="[
                      copiedId === v.row.org.identifier ? 'text-accent' : 'text-text-secondary',
                      isActiveCell(v.index, 'copy') ? 'ring-focus-ring-accent ring-2' : '',
                    ]"
                    :aria-label="t('common.copyOrganizationId', { id: v.row.org.identifier })"
                    data-test="organization-menu-item-copy-id"
                    @click.stop="copyId(v.row.org)"
                  />
                </div>
              </div>
            </template>
          </div>
        </div>

        <div
          v-else
          data-test="organization-menu-no-data"
          class="text-compact text-text-secondary w-full py-7 text-center"
        >
          {{ t("organization.noOrganizationsFound") }}
        </div>

        <div class="border-select-content-border flex border-t px-3 py-2">
          <OButton
            variant="link"
            size="xs"
            data-test="organization-menu-manage-link"
            @click="openManage"
          >
            {{ t("organization.manageOrganizations") }}
          </OButton>
        </div>
      </div>
    </OPopover>
  </div>
</template>

<style scoped>
/* keep(lib-override:o2-button): dark-only, element-scoped re-point of OButton's
   ghost-primary tokens for the navbar organization switcher trigger. The custom properties are READ by OButton's
   own internal DOM, so they have to be declared on the button element itself —
   there is no utility that sets them. Scoping appends [data-v] to the
   [data-test] compound, which is OButton's root and therefore carries this
   component's scope id. Was a global in styles/utilities.css (W1.d). */
.dark [data-test="navbar-organizations-select-trigger"] {
  --color-button-ghost-primary-active-bg: var(--color-primary-900);
  --color-button-ghost-primary-text: var(--color-primary-200);
}
</style>
