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
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useVirtualizer } from "@tanstack/vue-virtual";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import { copyToClipboard } from "@/utils/clipboard";

interface OrgOption {
  label: string;
  identifier: string;
  [key: string]: any;
}

const props = defineProps<{
  /** Full list of organizations to choose from. */
  organizations: OrgOption[];
  /** The currently active organization (drives the trigger label + selection). */
  current?: OrgOption | null;
}>();

const emit = defineEmits<{
  (e: "select", org: OrgOption): void;
}>();

const { t } = useI18n();

const open = ref(false);
const searchQuery = ref("");

// Matches both the display name and the identifier.
const filtered = computed<OrgOption[]>(() => {
  if (!searchQuery.value) return props.organizations;
  const q = searchQuery.value.toLowerCase();
  return props.organizations.filter(
    (o) => o.label?.toLowerCase().includes(q) || o.identifier?.toLowerCase().includes(q),
  );
});

// ── Virtualization ──────────────────────────────────────────────
// One line per org: the name, with the id inline beside it only when it
// differs from the name (an id equal to the name is redundant). Rows are a
// uniform single line, so a fixed height is enough.
const ROW_HEIGHT = 36;
const scrollRef = ref<HTMLElement | null>(null);

const virtualizer = useVirtualizer(
  computed(() => ({
    count: filtered.value.length,
    getScrollElement: () => scrollRef.value,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })),
);

const totalSize = computed(() => virtualizer.value.getTotalSize());

const rows = computed(() =>
  virtualizer.value.getVirtualItems().map((v) => ({
    index: v.index,
    start: v.start,
    size: v.size,
    org: filtered.value[v.index],
  })),
);

// ── Keyboard navigation (mirrors OSelect) ───────────────────────
const highlightedIndex = ref(0);

const scrollHighlightedIntoView = (align: "auto" | "center" = "auto") => {
  if (highlightedIndex.value >= 0) {
    virtualizer.value.scrollToIndex(highlightedIndex.value, { align });
  }
};

const select = (org: OrgOption) => {
  open.value = false;
  emit("select", org);
};

// Copy feedback lives on the button itself (icon flips to a tick) — no toast.
const copiedId = ref<string | null>(null);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const copyId = async (org: OrgOption) => {
  const ok = await copyToClipboard(org.identifier, { silent: true });
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

const onSearchKeydown = (e: KeyboardEvent) => {
  const len = filtered.value.length;
  if (e.key === "Escape") {
    open.value = false;
    return;
  }
  if (!len) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    highlightedIndex.value = highlightedIndex.value < len - 1 ? highlightedIndex.value + 1 : 0;
    nextTick(scrollHighlightedIntoView);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    highlightedIndex.value = highlightedIndex.value > 0 ? highlightedIndex.value - 1 : len - 1;
    nextTick(scrollHighlightedIntoView);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const org = filtered.value[Math.max(0, highlightedIndex.value)];
    if (org) select(org);
  }
};

watch(open, async (isOpen) => {
  if (!isOpen) {
    searchQuery.value = "";
    return;
  }
  await nextTick();
  // Dropdown content (and the scroll element) mounts fresh on every open.
  virtualizer.value.measure();
  // Highlight the current org (fallback to first) and center it in view so it
  // never lands stuck at the bottom edge.
  const activeIdx = filtered.value.findIndex((o) => o.identifier === props.current?.identifier);
  highlightedIndex.value = activeIdx >= 0 ? activeIdx : 0;
  nextTick(() => scrollHighlightedIntoView("center"));
  const input = document.querySelector(
    '[data-test="organization-search-input"] input',
  ) as HTMLInputElement | null;
  input?.focus();
});

// Keep the virtual window in sync, re-aim the highlight at the first match so
// Enter selects the obvious result, and snap the scroll back to the top —
// otherwise a prior scroll offset would hide the first results after a search.
//
// Reset and re-measure synchronously rather than in nextTick: the scroll
// element already exists here (unlike on open), and deferring means rows paint
// at stale offsets for one tick, then shift. A click landing in that window
// hits a row that is about to move out from under the pointer.
watch(filtered, (list) => {
  highlightedIndex.value = list.length ? 0 : -1;
  if (scrollRef.value) scrollRef.value.scrollTop = 0;
  virtualizer.value.measure();
});

const isSelected = (org: OrgOption) => org.identifier === props.current?.identifier;

// Selection reuses the same tokens OSelect uses, so the menu is visually
// consistent with every other dropdown in the app.
const rowStateClass = (row: { org: OrgOption; index: number }) => {
  if (isSelected(row.org)) {
    return "bg-select-item-selected-bg text-select-item-selected-text";
  }
  if (row.index === highlightedIndex.value) {
    return "bg-select-item-hover-bg text-select-item-text";
  }
  return "text-select-item-text";
};
</script>

<template>
  <div data-test="navbar-organizations-select">
    <ODropdown v-model:open="open" side="bottom" align="end">
      <template #trigger>
        <OButton
          variant="outline-primary"
          size="xs"
          data-test="navbar-organizations-select-trigger"
          class="text-text-body! w-56"
          :class="open ? 'ring-accent/25 ring-2 ring-inset' : ''"
        >
          <template #icon-left>
            <OIcon name="domain" size="sm" class="shrink-0 opacity-60" />
          </template>
          <span class="min-w-0 flex-1 truncate text-left">{{ current?.label || "" }}</span>
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
        <!-- Header: title + count -->
        <div class="flex items-center justify-between gap-2 px-3 pt-2 pb-1.5">
          <span class="text-compact text-text-heading font-semibold">
            {{ t("organization.header") }}
          </span>
          <span
            data-test="organization-menu-count"
            class="text-2xs bg-select-item-hover-bg text-text-secondary shrink-0 rounded-full px-2 py-1 leading-none font-semibold"
          >
            {{
              searchQuery ? `${filtered.length} of ${organizations.length}` : organizations.length
            }}
          </span>
        </div>

        <!-- Search: ↑/↓ move highlight, Enter selects, Esc closes -->
        <div class="px-3 pb-3">
          <OSearchInput
            data-test="organization-search-input"
            v-model="searchQuery"
            clearable
            :debounce="1"
            :placeholder="t('organization.searchByNameOrId')"
            @keydown="onSearchKeydown"
          />
        </div>

        <div v-if="filtered.length" class="bg-select-content-border mx-3 h-px" aria-hidden="true" />

        <!-- Virtualized list -->
        <div
          v-if="filtered.length"
          ref="scrollRef"
          data-test="organization-menu-table"
          class="relative max-h-80 overflow-x-hidden overflow-y-auto pt-2 pb-1"
        >
          <div class="relative w-full" :style="{ height: `${totalSize}px` }">
            <div
              v-for="row in rows"
              :key="row.org.identifier"
              data-test="organization-menu-item-label-item-label"
              :data-test-org-identifier="row.org.identifier"
              class="group rounded-default absolute top-0 right-0 left-0 box-border flex cursor-pointer items-center gap-2 px-3 transition-colors"
              :class="rowStateClass(row)"
              :style="{
                transform: `translateY(${row.start}px)`,
                height: `${row.size}px`,
              }"
              @click="select(row.org)"
              @mousemove="highlightedIndex = row.index"
            >
              <!-- Name with the id inline beside it. The id shows only when it
                   differs from the name (an equal id is just a redundant echo).
                   The name takes priority and is never truncated (it only clips
                   if it alone exceeds the whole row); the id yields, truncating
                   to whatever space is left. -->
              <div class="flex min-w-0 flex-1 items-baseline gap-2">
                <span
                  class="text-compact max-w-full min-w-0 flex-none truncate leading-tight font-medium"
                >
                  {{ row.org.label }}
                </span>
                <span
                  v-if="row.org.identifier && row.org.identifier !== row.org.label"
                  class="text-2xs text-text-secondary min-w-0 shrink truncate font-mono leading-tight"
                >
                  {{ row.org.identifier }}
                </span>
              </div>

              <!-- Copy identifier without selecting the row. Feedback is the
                   tick on the button itself (kept visible during the flash),
                   no toast. -->
              <button
                type="button"
                data-test="organization-menu-item-copy-id"
                :aria-label="`Copy organization ID ${row.org.identifier}`"
                class="rounded-default hover:bg-select-item-selected-bg hover:text-select-item-selected-text inline-flex size-6 shrink-0 items-center justify-center transition"
                :class="
                  copiedId === row.org.identifier
                    ? 'text-accent opacity-100'
                    : row.index === highlightedIndex
                      ? 'text-text-secondary opacity-100'
                      : 'text-text-secondary opacity-0 focus-visible:opacity-100'
                "
                @click.stop="copyId(row.org)"
              >
                <OIcon
                  :name="copiedId === row.org.identifier ? 'check' : 'content-copy'"
                  size="xs"
                />
              </button>
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div
          v-else
          data-test="organization-menu-no-data"
          class="text-compact text-text-secondary w-full py-7 text-center"
        >
          {{ t('organization.noOrganizationsFound') }}
        </div>
      </div>
    </ODropdown>
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
