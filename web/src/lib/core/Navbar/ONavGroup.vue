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

<script lang="ts">
// Module-scoped single-open coordinator: only one nav flyout is ever open at a
// time. Each instance watches this ref and closes itself when another becomes
// the open one. Shared across all ONavGroup instances on the page.
import { ref as moduleRef } from "vue";
const openGroupKey = moduleRef<string | null>(null);
</script>

<script setup lang="ts">
/**
 * A rail tile with a hover flyout. Two modes:
 *
 *  • Link + subnav (`parentItem` provided) — the tile IS a navigating MenuLink
 *    (e.g. Data → /streams). Hovering reveals its sub-pages; clicking lands on
 *    the main page while the flyout stays open under the pointer (it closes on
 *    mouse-leave / outside click / Escape). No pinning.
 *
 *  • Pure group (no `parentItem`) — the tile is a non-navigating MenuLink
 *    trigger. Hover opens; clicking pins the flyout open until an outside
 *    click / Escape / re-click. (Currently unused — every rail group navigates.)
 *
 * The flyout mirrors the target page's own section nav: same labels, icons and
 * category grouping. Children navigate by route `name` and are gated by
 * `router.hasRoute` so feature-gated sub-pages never show a dead link. It is
 * teleported to <body> (escapes the rail's overflow clip), styled like O2's
 * native dropdown, and positioned flush against the rail's right edge.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import MenuLink from "@/components/MenuLink.vue";
import config from "@/aws-exports";
import { GATE_PREDICATES } from "./navGroups";
import type { SubnavChild, NavGateContext } from "./ONavbar.types";
import { isInputFocused } from "@/utils/keyboardShortcuts";

const props = defineProps<{
  groupKey: string;
  title: string;
  icon: string;
  children: SubnavChild[];
  /** When set, the tile navigates here on click and the flyout is hover-only. */
  parentItem?: { link: string; title: string; icon: string; name: string };
}>();

const store = useStore();
const router: any = useRouter();
const { t } = useI18n();

const isLinkMode = computed(() => !!props.parentItem);

// Submenu text is pure black in light mode (the dropdown-item-text token is
// grey-900, which reads as "not quite black"); dark mode keeps the token so the
// text stays legible on the dark surface.
//
// `!` is REQUIRED: the flyout items are <router-link> (<a>) and the app's global
// `a { color: var(--color-text-link) }` rule (app.scss, unlayered) otherwise wins
// over the layered Tailwind color utility, tinting the link text/icon primary.
const { isDark } = useTheme();
const flyoutTextClass = computed(() => (isDark.value ? "text-dropdown-item-text!" : "text-black!"));
const flyoutIconClass = flyoutTextClass;

const wrapperRef = ref<HTMLElement | null>(null);
const flyoutRef = ref<HTMLElement | null>(null);

const isOpen = ref(false);
const isPinned = ref(false);
const flyoutStyle = ref<Record<string, string>>({});

// Visibility context — mirrors the exact flags the target pages compute, so the
// flyout's gating matches the page's section nav 1:1 (see GATE_PREDICATES).
const gateContext = computed<NavGateContext>(() => {
  const z = store.state.zoConfig ?? {};
  const orgSettings = store.state.organizationData?.organizationSettings ?? {};
  return {
    isEnterprise: config.isEnterprise == "true",
    isCloud: config.isCloud == "true",
    // useIsMetaOrg's logic, made null-safe for early renders.
    isMeta: store.state.selectedOrganization?.identifier === z.meta_org,
    rbac: !!z.rbac_enabled,
    serviceAccount: z.service_account_enabled ?? true,
    orgStorage: orgSettings.org_storage_enabled === true,
    modelPricing: !!z.model_pricing_enabled,
    serviceStreams: z.service_streams_enabled !== false,
    onlineEvals: !!z.online_evals_enabled,
    // Raw split (no trim) to match how pages test custom_hide_menus.
    hiddenMenus: new Set((z.custom_hide_menus ?? "").split(",")),
  };
});

// A child shows only when (a) its route is registered in this build AND (b) its
// visibility gate (if any) passes — exactly as the target page would decide.
const visibleChildren = computed(() =>
  props.children.filter((c) => {
    if (!router.hasRoute(c.name)) return false;
    if (c.gate) {
      const predicate = GATE_PREDICATES[c.gate];
      if (predicate && !predicate(gateContext.value)) return false;
    }
    return true;
  }),
);

// Flatten into render rows, inserting a category header whenever the category
// changes (mirrors the sub-page's grouped section nav). Items with no category
// render flat (e.g. the Data group).
type Row =
  | { kind: "header"; key: string; label: string }
  | { kind: "item"; key: string; child: SubnavChild };
const flyoutRows = computed<Row[]>(() => {
  const rows: Row[] = [];
  let lastCat: string | undefined;
  for (const child of visibleChildren.value) {
    if (child.category && child.category !== lastCat) {
      rows.push({ kind: "header", key: `h-${child.category}`, label: child.category });
      lastCat = child.category;
    } else if (!child.category) {
      lastCat = undefined;
    }
    rows.push({ kind: "item", key: `i-${child.name}-${child.tab ?? ""}`, child });
  }
  return rows;
});

// Hover open/close are debounced so brushing past the tile or crossing the
// (zero-width) seam between tile and flyout doesn't flicker it.
const OPEN_DELAY = 120;
const CLOSE_DELAY = 220;
let openTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimers() {
  if (openTimer) {
    clearTimeout(openTimer);
    openTimer = null;
  }
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

// ── Active state ──────────────────────────────────────────────────────────
// Active by route name (and tab, for query-param sub-views like AI evals).
// Resolve a child's route name to its canonical path (for sub-route matching).
function childPath(name: string): string | null {
  if (!router.hasRoute(name)) return null;
  try {
    return router.resolve({ name }).path || null;
  } catch {
    return null;
  }
}

function isChildActive(child: SubnavChild): boolean {
  const route = router.currentRoute.value;
  // Exact route-name match — precise for query-tab routes (AI evals).
  if (route.name === child.name) {
    return !child.tab || route.query.tab === child.tab;
  }
  // Otherwise the section is still "active" when the current route is nested
  // under it — drill-down editors, the ingestion ("Data sources") tab routes
  // (e.g. ingestLogs under /ingestion), pipeline editors, etc.
  if (child.tab) return false; // query-tab children only match by exact name
  const base = childPath(child.name);
  if (!base || base === "/") return false;
  return route.path === base || route.path.startsWith(`${base}/`);
}
const isGroupActive = computed(() => props.children.some(isChildActive));

const orgIdentifier = computed(() => store.state.selectedOrganization?.identifier);

function childTo(child: SubnavChild) {
  const query: Record<string, string> = {};
  if (orgIdentifier.value) query.org_identifier = orgIdentifier.value;
  if (child.tab) query.tab = child.tab;
  return { name: child.name, query };
}

function focusTile() {
  wrapperRef.value?.querySelector<HTMLElement>("a, button")?.focus();
}

// ── Open / close ──────────────────────────────────────────────────────────
async function positionFlyout() {
  const wrapper = wrapperRef.value;
  if (!wrapper) return;
  const rect = wrapper.getBoundingClientRect();
  // Small breathing gap between the rail and the flyout so they don't touch.
  const GAP = 4;
  const left = rect.right + GAP;
  flyoutStyle.value = {
    position: "fixed",
    left: `${left}px`,
    top: `${rect.top}px`,
    zIndex: "6000",
  };
  await nextTick();
  const flyoutH = flyoutRef.value?.offsetHeight ?? 0;
  const maxTop = window.innerHeight - flyoutH - 8;
  flyoutStyle.value = {
    ...flyoutStyle.value,
    top: `${Math.max(8, Math.min(rect.top, maxTop))}px`,
  };
}

async function open() {
  if (visibleChildren.value.length === 0) return;
  clearTimers();
  isOpen.value = true;
  openGroupKey.value = props.groupKey;
  await positionFlyout();
}

function close() {
  clearTimers();
  isOpen.value = false;
  isPinned.value = false;
  if (openGroupKey.value === props.groupKey) openGroupKey.value = null;
}

function scheduleOpen() {
  clearTimers();
  openTimer = setTimeout(() => open(), OPEN_DELAY);
}

function scheduleClose() {
  if (isPinned.value) return;
  clearTimers();
  closeTimer = setTimeout(() => close(), CLOSE_DELAY);
}

function onTriggerClick() {
  if (isPinned.value) {
    close();
  } else {
    isPinned.value = true;
    open();
  }
}

function onLinkClick() {
  open();
}

function onTileKeydown(event: KeyboardEvent) {
  // ArrowRight opens the flyout; Up/Down are left to the rail's own navigation.
  if (event.key === "ArrowRight") {
    event.preventDefault();
    event.stopPropagation();
    if (!isOpen.value) open();
    nextTick(() => {
      flyoutRef.value?.querySelector<HTMLElement>("a[data-test^='nav-group-item-']")?.focus();
    });
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    if (isOpen.value) close();
  } else if (event.key === "Escape") {
    close();
  }
}

watch(openGroupKey, (key) => {
  if (key !== props.groupKey && isOpen.value) close();
});

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node;
  if (wrapperRef.value?.contains(target) || flyoutRef.value?.contains(target)) {
    return;
  }
  close();
}

function onScrollOrResize() {
  if (isOpen.value) close();
}

watch(isOpen, (open) => {
  if (open) {
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
  } else {
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    window.removeEventListener("resize", onScrollOrResize);
    window.removeEventListener("scroll", onScrollOrResize, true);
  }
});

onBeforeUnmount(() => {
  clearTimers();
  document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  window.removeEventListener("resize", onScrollOrResize);
  window.removeEventListener("scroll", onScrollOrResize, true);
  if (openGroupKey.value === props.groupKey) openGroupKey.value = null;
});

function onFlyoutKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" || event.key === "ArrowLeft") {
    event.preventDefault();
    close();
    focusTile();
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const items = Array.from(
    flyoutRef.value?.querySelectorAll<HTMLElement>("a[data-test^='nav-group-item-']") ?? [],
  );
  if (items.length === 0) return;
  const idx = items.indexOf(document.activeElement as HTMLElement);
  const nextIdx =
    event.key === "ArrowDown"
      ? idx + 1 >= items.length
        ? 0
        : idx + 1
      : idx - 1 < 0
        ? items.length - 1
        : idx - 1;
  items[nextIdx]?.focus();
}

function onChildClick() {
  close();
}

// Focus the hovered item so Enter activates it natively — but never yank
// focus away from an input the user is typing in.
function onChildMouseenter(event: MouseEvent) {
  if (isInputFocused()) return;
  (event.currentTarget as HTMLElement)?.focus();
}
</script>

<template>
  <div
    ref="wrapperRef"
    :data-test="`nav-group-${groupKey}`"
    class="nav-group relative shrink-0"
    @mouseenter="scheduleOpen"
    @mouseleave="scheduleClose"
  >
    <!-- Link mode: a navigating MenuLink that also reveals sub-pages on hover.
         `active` is driven by "is any child active" so a group tile (e.g. Data,
         whose children span several path roots) highlights on all its pages. -->
    <MenuLink
      v-if="isLinkMode && parentItem"
      submenu
      :title="title"
      :icon="icon"
      :link="parentItem.link"
      :active="isGroupActive"
      :expanded="isOpen"
      @click="onLinkClick"
      @keydown="onTileKeydown"
    />
    <!-- Pure-group mode: a non-navigating trigger; identical look to a link. -->
    <MenuLink
      v-else
      as-trigger
      :title="title"
      :icon="icon"
      :link="`group-${groupKey}`"
      :active="isGroupActive"
      :expanded="isOpen"
      @click="onTriggerClick"
      @keydown="onTileKeydown"
    />

    <!-- Flyout submenu — teleported to escape the rail's overflow clip; styled
         exactly like O2's native dropdown for consistency. -->
    <Teleport to="body">
      <div
        v-if="isOpen"
        ref="flyoutRef"
        :data-test="`nav-group-flyout-${groupKey}`"
        role="menu"
        :aria-label="title"
        class="nav-group-flyout min-w-52 p-1 rounded-default border border-dropdown-border bg-dropdown-bg shadow-md"
        :style="flyoutStyle"
        @mouseenter="clearTimers"
        @mouseleave="scheduleClose"
        @keydown="onFlyoutKeydown"
      >
        <div class="px-3 pt-1.5 pb-1 text-2xs font-semibold" :class="flyoutTextClass">
          {{ title }}
        </div>
        <template v-for="(row, rowIndex) in flyoutRows" :key="row.key">
          <div
            v-if="row.kind === 'header'"
            class="px-3 pb-1 text-2xs font-medium text-tabs-inactive-text"
            :class="rowIndex === 0 ? 'pt-2' : 'pt-4'"
          >
            {{ row.label }}
          </div>
          <router-link
            v-else
            :data-test="`nav-group-item-${row.child.name}`"
            role="menuitem"
            :to="childTo(row.child)"
            class="nav-group-item flex items-center gap-2.5 px-3 py-1.5 rounded-default text-sm [text-decoration:none]! cursor-pointer select-none outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary-500"
            :class="[
              flyoutTextClass,
              isChildActive(row.child)
                ? 'bg-select-item-selected-bg font-medium'
                : 'hover:bg-dropdown-item-hover-bg',
            ]"
            :aria-current="isChildActive(row.child) ? 'page' : undefined"
            @click="onChildClick"
            @mouseenter="onChildMouseenter"
          >
            <!-- Icon color is locked to the text color so it never picks up a
                 primary tint via currentColor inheritance. -->
            <OIcon :name="row.child.icon" size="sm" class="shrink-0" :class="flyoutIconClass" />
            <span class="leading-none">{{ t(row.child.titleKey) }}</span>
          </router-link>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* keep(keyframes): reveal animation for the flyout — a quick fade + slight slide
   from the rail. A @keyframes body cannot be expressed as a utility. The
   `animation:` declaration is co-located here on purpose: Vue rewrites the
   keyframe name and the animation shorthand together only when both live in the
   same scoped block — moving either out (e.g. to a template `[animation:…]`
   arbitrary value) would break the rename and the animation would not resolve. */
.nav-group-flyout {
  animation: nav-group-flyout-in 140ms cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes nav-group-flyout-in {
  from {
    opacity: 0;
    transform: translateX(-0.25rem);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
</style>
