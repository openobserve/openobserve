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

  Styling is pure Tailwind (tw: prefix) + semantic design tokens — selected
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
    (o) =>
      o.label?.toLowerCase().includes(q) ||
      o.identifier?.toLowerCase().includes(q),
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
    key: v.key,
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
    highlightedIndex.value =
      highlightedIndex.value < len - 1 ? highlightedIndex.value + 1 : 0;
    nextTick(scrollHighlightedIntoView);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    highlightedIndex.value =
      highlightedIndex.value > 0 ? highlightedIndex.value - 1 : len - 1;
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
  const activeIdx = filtered.value.findIndex(
    (o) => o.identifier === props.current?.identifier,
  );
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
watch(filtered, (list) => {
  highlightedIndex.value = list.length ? 0 : -1;
  nextTick(() => {
    if (scrollRef.value) scrollRef.value.scrollTop = 0;
    virtualizer.value.measure();
  });
});

const isSelected = (org: OrgOption) =>
  org.identifier === props.current?.identifier;

// Selection reuses the same tokens OSelect uses, so the menu is visually
// consistent with every other dropdown in the app.
const rowStateClass = (row: { org: OrgOption; index: number }) => {
  if (isSelected(row.org)) {
    return "tw:bg-select-item-selected-bg tw:text-select-item-selected-text";
  }
  if (row.index === highlightedIndex.value) {
    return "tw:bg-select-item-hover-bg tw:text-select-item-text";
  }
  return "tw:text-select-item-text";
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
          class="tw:w-56 tw:text-text-primary!"
          :class="open ? 'tw:ring-1 tw:ring-inset tw:ring-primary-300' : ''"
        >
          <template #icon-left>
            <OIcon
              name="domain"
              size="sm"
              class="tw:opacity-60 tw:shrink-0"
            />
          </template>
          <span class="tw:truncate tw:flex-1 tw:min-w-0 tw:text-left">{{
            current?.label || ""
          }}</span>
          <template #icon-right>
            <OIcon
              name="arrow-drop-down"
              size="sm"
              class="tw:opacity-70 tw:shrink-0 tw:transition-transform"
              :class="open ? 'tw:rotate-180' : ''"
            />
          </template>
        </OButton>
      </template>

      <div
        data-test="organization-menu-list"
        class="tw:flex tw:flex-col tw:w-94 tw:max-w-[98vw]"
      >
        <!-- Header: title + count -->
        <div
          class="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:px-3 tw:pt-2 tw:pb-1.5"
        >
          <span class="tw:text-[13px] tw:font-semibold tw:text-text-primary">
            {{ t("organization.header") }}
          </span>
          <span
            data-test="organization-menu-count"
            class="tw:shrink-0 tw:text-[11px] tw:font-semibold tw:leading-none tw:px-2 tw:py-1 tw:rounded-full tw:bg-select-item-hover-bg tw:text-text-secondary"
          >
            {{
              searchQuery
                ? `${filtered.length} of ${organizations.length}`
                : organizations.length
            }}
          </span>
        </div>

        <!-- Search: ↑/↓ move highlight, Enter selects, Esc closes -->
        <div class="tw:px-3 tw:pb-3">
          <OSearchInput
            data-test="organization-search-input"
            v-model="searchQuery"
            clearable
            :debounce="1"
            placeholder="Search by name or ID"
            @keydown="onSearchKeydown"
          />
        </div>

        <div
          v-if="filtered.length"
          class="tw:mx-3 tw:h-px tw:bg-select-content-border"
          aria-hidden="true"
        />

        <!-- Virtualized list -->
        <div
          v-if="filtered.length"
          ref="scrollRef"
          data-test="organization-menu-table"
          class="tw:relative tw:max-h-80 tw:overflow-y-auto tw:overflow-x-hidden tw:pt-2 tw:pb-1"
        >
          <div class="tw:relative tw:w-full" :style="{ height: `${totalSize}px` }">
            <div
              v-for="row in rows"
              :key="row.key"
              data-test="organization-menu-item-label-item-label"
              :data-test-org-identifier="row.org.identifier"
              class="tw:group tw:absolute tw:left-0 tw:right-0 tw:top-0 tw:box-border tw:flex tw:items-center tw:gap-2 tw:px-3 tw:rounded-md tw:cursor-pointer tw:transition-colors"
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
              <div class="tw:flex tw:items-baseline tw:gap-2 tw:min-w-0 tw:flex-1">
                <span
                  class="tw:flex-none tw:max-w-full tw:min-w-0 tw:truncate tw:text-[13px] tw:font-medium tw:leading-tight"
                >
                  {{ row.org.label }}
                </span>
                <span
                  v-if="row.org.identifier && row.org.identifier !== row.org.label"
                  class="tw:shrink tw:min-w-0 tw:truncate tw:text-[11px] tw:font-mono tw:leading-tight tw:text-text-secondary"
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
                class="tw:shrink-0 tw:inline-flex tw:items-center tw:justify-center tw:size-6 tw:rounded-md tw:transition tw:hover:bg-primary-200 tw:hover:text-select-item-selected-text"
                :class="
                  copiedId === row.org.identifier
                    ? 'tw:opacity-100 tw:text-primary-600'
                    : row.index === highlightedIndex
                      ? 'tw:text-text-secondary tw:opacity-100'
                      : 'tw:text-text-secondary tw:opacity-0 tw:focus-visible:opacity-100'
                "
                @click.stop="copyId(row.org)"
              >
                <OIcon
                  :name="
                    copiedId === row.org.identifier ? 'check' : 'content-copy'
                  "
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
          class="tw:w-full tw:text-center tw:py-7 tw:text-[13px] tw:text-text-secondary"
        >
          No organizations found
        </div>
      </div>
    </ODropdown>
  </div>
</template>
