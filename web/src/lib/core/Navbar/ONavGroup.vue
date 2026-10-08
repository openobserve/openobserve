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
 * `router.hasRoute` plus their `gate` predicate so feature-gated sub-pages never
 * show a dead link — and when NO child survives that filtering, the tile itself
 * does not render (see `hasVisibleChildren`), so a fully-gated section leaves no
 * empty tile behind. It is
 * teleported to <body> (escapes the rail's overflow clip), styled like O2's
 * native dropdown, and positioned flush against the rail's right edge.
 */
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import { useRouter, type LocationQueryRaw } from "vue-router";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import MenuLink from "@/components/MenuLink.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import { isGateOpen, useNavGateContext } from "./useNavGateContext";
import { RailNavigationMarkKey, type SubnavChild } from "./ONavbar.types";
import {
  AIM_IDLE,
  REST_TOLERANCE,
  aim,
  isAimingAtOpenFlyout,
  releasePointerTracking,
  retainPointerTracking,
} from "./hoverIntent";
import type { Point } from "./hoverIntent";
import { findContentFocusTarget } from "./railFocus";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import useBreakpoint from "@/composables/useBreakpoint";
import { useTrialPaywall } from "@/composables/useTrialPaywall";

const props = defineProps<{
  groupKey: string;
  title: I18nText;
  icon: string;
  children: SubnavChild[];
  /** Children that `requires`/`gate` removed upstream: they still light and retarget the tile. */
  filteredChildren?: SubnavChild[];
  /** When set, the tile navigates here on click and the flyout is hover-only. */
  parentItem?: { link: string; title: string; icon: string; name: string };
}>();

const store = useStore();
const router: any = useRouter();
const { t } = useI18nTyped();

const isLinkMode = computed(() => !!props.parentItem);

const { isMobile } = useBreakpoint();

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
// Shared with ONavbar, which applies the same gates when deciding whether a
// group is worth collapsing into at all.
const gateContext = useNavGateContext();

// A child shows only when (a) its route is registered in this build, (b)
// custom_hide_menus does not name it, AND (c) its visibility gate (if any)
// passes — exactly as the target page would decide.
//
// The custom_hide_menus check is by route NAME so a child with no top-level
// rail entry of its own is hideable at all: `requires` only tracks the parent,
// and MainLayout's filter only ever sees top-level links.
const visibleChildren = computed(() =>
  props.children.filter((c) => {
    if (!router.hasRoute(c.name)) return false;
    if (gateContext.value.hiddenMenus.has(c.name)) return false;
    if (c.gate && !isGateOpen(gateContext.value, c.gate)) return false;
    return true;
  }),
);

// A group with no surviving child is not a group — it is an empty tile that
// opens nothing. `open()` already refuses to show an empty flyout, which on its
// own leaves a dead tile the user can click into a page they are not entitled
// to. Suppressing the whole tile is what makes a `gate` on the LAST child gate
// the section itself: Infra holds only Database Monitoring, so on a build with
// `database_monitoring_enabled` off, Infra must vanish rather than sit there
// inert. Collapsing groups reach this too — every child hidden means the tile
// has nothing left to offer.
const hasVisibleChildren = computed(() => visibleChildren.value.length > 0);

/**
 * Blocks, not a flat row list, so the grouping is real to assistive tech.
 *
 * A bare heading <div> is not a valid child of `role="menu"` — AT drops or
 * mis-places it — so a screen-reader user arrowing down heard all seven
 * Reliability items as one flat list: exactly the structure the header exists
 * to convey. Each headed run is now a `role="group"` labelled by its heading,
 * and the heading itself is `role="presentation"` (it is named via
 * aria-labelledby, not walked as a menu child).
 */
type Block =
  | { kind: "group"; key: string; labelId: string; labelKey: I18nKey; children: SubnavChild[] }
  | { kind: "item"; key: string; child: SubnavChild; spaced: boolean };

const childKey = (child: SubnavChild) => `${child.name}-${child.tab ?? ""}`;

const flyoutBlocks = computed<Block[]>(() => {
  const blocks: Block[] = [];
  let open: Extract<Block, { kind: "group" }> | null = null;

  for (const child of visibleChildren.value) {
    if (child.categoryKey) {
      if (!open || open.labelKey !== child.categoryKey) {
        // Indexed, so two non-adjacent runs sharing a key cannot collide on
        // the same `:key` within one v-for.
        const key: string = `h-${child.categoryKey}-${blocks.length}`;
        open = {
          kind: "group",
          key,
          labelId: `${props.groupKey}-${key}`,
          labelKey: child.categoryKey,
          children: [],
        };
        blocks.push(open);
      }
      open.children.push(child);
      continue;
    }
    // An item that LEAVES a headed run needs a gap, or it reads as the last
    // member of that run: a header owns everything below it until something
    // says otherwise, and at the same indent nothing else does.
    blocks.push({ kind: "item", key: `i-${childKey(child)}`, child, spaced: open !== null });
    open = null;
  }
  return blocks;
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
// Active by route name and tab for query-param sub-views.
// Resolve a child's route name to its canonical path (for sub-route matching).
function childPath(name: string): string | null {
  if (!router.hasRoute(name)) return null;
  try {
    return router.resolve({ name }).path || null;
  } catch {
    return null;
  }
}

// At most ONE child is active, resolved for the whole flyout rather than per
// child. Deciding per child lit up ancestors too: any section whose path is a
// prefix of another's matched both, which is right for a drill-down like
// /alerts/detail/:id but wrong for a sibling that merely sits underneath.
//
// Exact route-name match wins outright; otherwise the DEEPEST path prefix wins,
// so a nested route is attributed to its own section, not a shallower sibling.
function resolveActiveChild(children: SubnavChild[]): SubnavChild | null {
  const route = router.currentRoute.value;

  const exactTab = children.find(
    (c) => c.tab && route.name === c.name && route.query.tab === c.tab,
  );
  if (exactTab) return exactTab;

  // A route alias, same idea for a section whose sub-views are sibling ROUTES
  // rendered as in-page tabs (Databases owns dbmQueries / dbmQueryDetail).
  // Checked before the prefix pass below, which would otherwise attribute a
  // detail route to whichever child has the longest matching path.
  const routeAlias = children.find((c) => c.activeOnRoutes?.includes(route.name as string));
  if (routeAlias) return routeAlias;

  const exact = children.find((c) => route.name === c.name && !c.tab);
  if (exact) return exact;

  const routeDefault = children.find((c) => c.defaultForRoute && route.name === c.name);
  if (routeDefault) return routeDefault;

  let best: SubnavChild | null = null;
  let bestLen = 0;
  for (const child of children) {
    if (child.tab) continue; // query-tab children only match by exact name
    const base = childPath(child.name);
    if (!base || base === "/") continue;
    if (route.path !== base && !route.path.startsWith(`${base}/`)) continue;
    if (base.length > bestLen) {
      best = child;
      bestLen = base.length;
    }
  }
  return best;
}

// A page reached by URL still lights its group when its child was filtered out.
const activeChild = computed<SubnavChild | null>(
  () => resolveActiveChild(props.children) ?? resolveActiveChild(props.filteredChildren ?? []),
);

function isChildActive(child: SubnavChild): boolean {
  return activeChild.value === child;
}
const isGroupActive = computed(() => activeChild.value !== null);

const orgIdentifier = computed(() => store.state.selectedOrganization?.identifier);

function childTo(child: SubnavChild) {
  const route = router.currentRoute.value;
  const query: LocationQueryRaw = route.name === child.name ? { ...route.query } : {};
  if (orgIdentifier.value) query.org_identifier = orgIdentifier.value;
  if (child.tab) {
    delete query.search_mode;
    query.tab = child.tab;
  }
  return { name: child.name, query };
}

function childLabel(child: SubnavChild): I18nText {
  return child.title ? raw(child.title) : t(child.titleKey);
}

// Anchor-child rule (design 4.7): parentLink holds unless the child resolving to it is not visible — then first visible child, so a DBM-off Infra tile can't bounce onto Traces.
const tileLink = computed(() => {
  const parent = props.parentItem;
  if (!parent) return "";
  const declared = [...props.children, ...(props.filteredChildren ?? [])];
  const anchor = declared.find((c) => childPath(c.name) === parent.link);
  if (!anchor || visibleChildren.value.includes(anchor)) return parent.link;
  const first = visibleChildren.value[0];
  return first ? (childPath(first.name) ?? parent.link) : parent.link;
});

// ── Trial paywall ─────────────────────────────────────────────────────────
const { isPaywalled } = useTrialPaywall();

function isChildPaywalled(child: SubnavChild): boolean {
  return isPaywalled(childTo(child));
}

// A pure-group trigger has no route of its own, so only a link-mode tile can be muted.
const tilePaywalled = computed(
  () => isLinkMode.value && tileLink.value !== "" && isPaywalled(tileLink.value),
);

const showTrialNote = computed(() => visibleChildren.value.some((c) => isChildPaywalled(c)));

const trialNoteId = computed(() => `${props.groupKey}-trial-note`);

function itemDescriptionId(child: SubnavChild, prefix = ""): string {
  return `${prefix}${props.groupKey}-${childKey(child)}-paywall`;
}

function childDataTest(child: SubnavChild): string {
  return `nav-group-item-${child.name}${child.tab ? `-${child.tab}` : ""}`;
}

function tileElement(): HTMLElement | null {
  return wrapperRef.value?.querySelector<HTMLElement>("a, button") ?? null;
}

function focusTile() {
  tileElement()?.focus();
}

// ── Open / close ──────────────────────────────────────────────────────────
async function positionFlyout() {
  const wrapper = wrapperRef.value;
  if (!wrapper) return;
  const rect = wrapper.getBoundingClientRect();
  // Small breathing gap between the rail and the flyout so they don't touch.
  const GAP = 4;
  const isRtl = document.documentElement.dir === "rtl";
  const horizontalPosition: Record<string, string> = isRtl
    ? { right: `${document.documentElement.clientWidth - rect.left + GAP}px` }
    : { left: `${rect.right + GAP}px` };
  flyoutStyle.value = {
    position: "fixed",
    ...horizontalPosition,
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

/**
 * Send any open dropdown away before the flyout appears.
 *
 * Both are page menus, but a dropdown is portaled after this flyout AND sits on
 * a higher layer, so it paints over the menu the pointer is actually on.
 * Raising the flyout is the wrong lever: it would have to clear 10001, which is
 * above the modal layer, and a nav menu floating over a dialog is worse than
 * the overlap it would fix. One menu at a time is the behaviour anyway.
 *
 * Escape is what reka's dismissable layers listen for. It is scoped to the case
 * where a popper is the topmost layer — with a dialog or drawer open the same
 * key would close that instead, and the rail is reachable beside a drawer.
 */
function dismissOpenDropdowns() {
  if (!document.querySelector("[data-reka-popper-content-wrapper]")) return;
  if (document.querySelector('[data-test="o-dialog-overlay"], [data-test="o-drawer-overlay"]')) {
    return;
  }
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

async function open() {
  if (visibleChildren.value.length === 0) return;
  dismissOpenDropdowns();
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

// Where the pointer last came to rest on the tile; the open timer counts from here.
let restAnchor: Point | null = null;

function scheduleOpen(event?: MouseEvent) {
  // Some touch browsers emit a synthetic mouseenter, which would open a group the user only scrolled past.
  if (isMobile.value) return;
  restAnchor = event ? { x: event.clientX, y: event.clientY } : null;
  clearTimers();
  // A neighbour whose flyout the pointer is still travelling towards keeps its turn.
  const tryOpen = () => {
    if (openGroupKey.value && openGroupKey.value !== props.groupKey && isAimingAtOpenFlyout()) {
      openTimer = setTimeout(tryOpen, AIM_IDLE);
      return;
    }
    open();
  };
  openTimer = setTimeout(tryOpen, OPEN_DELAY);
}

// A pointer still moving across the tile is scanning, not choosing: re-arm until it rests.
function onTileMousemove(event: MouseEvent) {
  if (isMobile.value || isOpen.value || !openTimer) return;
  const here = { x: event.clientX, y: event.clientY };
  if (restAnchor && Math.hypot(here.x - restAnchor.x, here.y - restAnchor.y) <= REST_TOLERANCE) {
    return;
  }
  scheduleOpen(event);
}

function scheduleClose(event?: MouseEvent) {
  restAnchor = null;
  if (isPinned.value || isMobile.value) return;
  clearTimers();
  if (isOpen.value) {
    const leftTile = !!event && !!wrapperRef.value?.contains(event.target as Node);
    aim.exit = leftTile && event ? { x: event.clientX, y: event.clientY } : null;
    aim.flyout = leftTile ? flyoutRef.value : null;
  }
  const tryClose = () => {
    if (aim.flyout === flyoutRef.value && isAimingAtOpenFlyout()) {
      closeTimer = setTimeout(tryClose, AIM_IDLE);
      return;
    }
    close();
  };
  closeTimer = setTimeout(tryClose, CLOSE_DELAY);
}

function onTriggerClick() {
  if (isPinned.value) {
    close();
  } else {
    isPinned.value = true;
    open();
  }
}

// detail 0 is a keyboard activation: Enter navigates, so nothing should stay open.
function onLinkClick(event?: MouseEvent) {
  if (event?.detail === 0) {
    close();
    return;
  }
  open();
}

function isRtl(): boolean {
  return document.documentElement.dir === "rtl";
}

function focusFirstItem() {
  nextTick(() => {
    flyoutRef.value?.querySelector<HTMLElement>("a[data-test^='nav-group-item-']")?.focus();
  });
}

function onTileKeydown(event: KeyboardEvent) {
  // The arrow towards the flyout opens it; Up/Down are left to the rail's own navigation.
  const openKey = isRtl() ? "ArrowLeft" : "ArrowRight";
  if (event.key === openKey) {
    event.preventDefault();
    event.stopPropagation();
    if (!isOpen.value) open();
    focusFirstItem();
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

// Only a scroll that moves the tile (the rail or an ancestor) detaches the flyout from it.
function onScroll(event: Event) {
  if (isMobile.value) return;
  const target = event.target;
  if (target instanceof Node && target !== document && !target.contains(wrapperRef.value)) return;
  onScrollOrResize();
}

let openedAt = { w: 0, h: 0 };
let tracksPointer = false;

// Pages dispatch synthetic resize events to reflow charts; only a real viewport change moves the tile.
function onResize() {
  if (window.innerWidth !== openedAt.w || window.innerHeight !== openedAt.h) onScrollOrResize();
}

function removeOpenListeners() {
  document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  window.removeEventListener("resize", onResize);
  window.removeEventListener("scroll", onScroll, true);
  if (tracksPointer) releasePointerTracking();
  tracksPointer = false;
}

watch(isOpen, (open) => {
  if (open) {
    openedAt = { w: window.innerWidth, h: window.innerHeight };
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    if (!tracksPointer) retainPointerTracking();
    tracksPointer = true;
  } else {
    removeOpenListeners();
  }
});

onBeforeUnmount(() => {
  clearTimers();
  removeOpenListeners();
  if (openGroupKey.value === props.groupKey) openGroupKey.value = null;
});

// Tab leaves the menu the way Tab from the tile would; Shift+Tab returns to the tile.
function onFlyoutTab(event: KeyboardEvent) {
  event.preventDefault();
  close();
  if (event.shiftKey) {
    focusTile();
    return;
  }
  (findContentFocusTarget() ?? tileElement())?.focus();
}

function onFlyoutKeydown(event: KeyboardEvent) {
  if (event.key === "Tab") {
    onFlyoutTab(event);
    return;
  }
  // Links do not activate on Space natively; route it through click so detail stays 0.
  if (event.key === " ") {
    event.preventDefault();
    (event.target as HTMLElement | null)
      ?.closest<HTMLElement>("a[data-test^='nav-group-item-']")
      ?.click();
    return;
  }
  const closeKey = isRtl() ? "ArrowRight" : "ArrowLeft";
  if (event.key === "Escape" || event.key === closeKey) {
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

// The flyout is teleported, so the rail's capture listener never sees this click.
const markRailNavigation = inject(RailNavigationMarkKey, null);

// Keyboard choice (detail 0) returns focus to the tile; a mouse choice leaves it to the page.
function onChildClick(event: MouseEvent) {
  markRailNavigation?.(event);
  close();
  if (event.detail === 0) nextTick(() => focusTile());
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
    v-if="hasVisibleChildren"
    ref="wrapperRef"
    :data-test="`nav-group-${groupKey}`"
    class="nav-group relative shrink-0"
    @mouseenter="scheduleOpen"
    @mouseleave="scheduleClose"
    @mousemove="onTileMousemove"
  >
    <!-- Link mode: a navigating MenuLink that also reveals sub-pages on hover.
         `active` is driven by "is any child active" so a group tile (e.g. Data,
         whose children span several path roots) highlights on all its pages. -->
    <!-- < md a tap toggles instead of routing away and closing the drawer; each group lists its own page as a child. -->
    <MenuLink
      v-if="isLinkMode && parentItem && !isMobile"
      submenu
      :title="title"
      :icon="icon"
      :link="tileLink"
      :active="isGroupActive"
      :expanded="isOpen"
      :paywalled="tilePaywalled"
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
      :paywalled="tilePaywalled"
      @click="onTriggerClick"
      @keydown="onTileKeydown"
    />

    <!-- A teleported flyout anchored to the rail is unreachable on a phone, so < md the rows render inline. -->
    <div
      v-if="isMobile && isOpen"
      :data-test="`nav-group-inline-${groupKey}`"
      role="menu"
      :aria-label="title"
      :aria-describedby="showTrialNote ? `inline-${trialNoteId}` : undefined"
      class="border-border-default ms-3 mt-0.5 mb-1 flex flex-col gap-0.5 border-s ps-2"
    >
      <div
        v-if="showTrialNote"
        :id="`inline-${trialNoteId}`"
        :data-test="`nav-group-inline-${groupKey}-trial-note`"
        class="text-text-secondary px-2 pt-1 pb-1 text-xs"
      >
        {{ t("menu.trialFlyoutNote") }}
      </div>
      <template v-for="block in flyoutBlocks" :key="`inline-${block.key}`">
        <div
          v-if="block.kind === 'group'"
          role="group"
          :aria-labelledby="`inline-${block.labelId}`"
          :data-test="`nav-group-inline-section-${block.key}`"
        >
          <div
            :id="`inline-${block.labelId}`"
            role="presentation"
            class="text-2xs text-tabs-inactive-text px-2 pt-2 pb-0.5 font-medium"
          >
            {{ t(block.labelKey) }}
          </div>
          <router-link
            v-for="child in block.children"
            :key="childKey(child)"
            :data-test="childDataTest(child)"
            role="menuitem"
            :to="childTo(child)"
            class="nav-group-item rounded-default flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs transition-colors duration-150 outline-none select-none [text-decoration:none]!"
            :class="[
              flyoutTextClass,
              isChildActive(child) ? 'bg-select-item-selected-bg font-medium' : '',
            ]"
            :aria-current="isChildActive(child) ? 'page' : undefined"
            :data-paywalled="isChildPaywalled(child) ? 'true' : undefined"
            :aria-describedby="
              isChildPaywalled(child) ? itemDescriptionId(child, 'inline-') : undefined
            "
            @click="onChildClick"
          >
            <OIcon
              :name="child.icon"
              size="sm"
              class="shrink-0"
              :class="isChildPaywalled(child) ? 'text-text-secondary!' : flyoutIconClass"
            />
            <span class="leading-tight">{{ childLabel(child) }}</span>
            <BetaBadge v-if="child.beta" size="xs" />
            <OIcon
              v-if="isChildPaywalled(child)"
              name="lock"
              size="xs"
              class="text-text-secondary ms-auto shrink-0"
              :data-test="`${childDataTest(child)}-lock`"
              aria-hidden="true"
            />
            <span
              v-if="isChildPaywalled(child)"
              :id="itemDescriptionId(child, 'inline-')"
              class="sr-only"
            >
              {{ t("menu.trialPageNeedsPlan", { page: childLabel(child) }) }}
            </span>
          </router-link>
        </div>

        <router-link
          v-else
          :data-test="childDataTest(block.child)"
          role="menuitem"
          :to="childTo(block.child)"
          class="nav-group-item rounded-default flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs transition-colors duration-150 outline-none select-none [text-decoration:none]!"
          :class="[
            flyoutTextClass,
            block.spaced ? 'mt-2' : '',
            isChildActive(block.child) ? 'bg-select-item-selected-bg font-medium' : '',
          ]"
          :aria-current="isChildActive(block.child) ? 'page' : undefined"
          :data-paywalled="isChildPaywalled(block.child) ? 'true' : undefined"
          :aria-describedby="
            isChildPaywalled(block.child) ? itemDescriptionId(block.child, 'inline-') : undefined
          "
          @click="onChildClick"
        >
          <OIcon
            :name="block.child.icon"
            size="sm"
            class="shrink-0"
            :class="isChildPaywalled(block.child) ? 'text-text-secondary!' : flyoutIconClass"
          />
          <span class="leading-tight">{{ childLabel(block.child) }}</span>
          <BetaBadge v-if="block.child.beta" size="xs" />
          <OIcon
            v-if="isChildPaywalled(block.child)"
            name="lock"
            size="xs"
            class="text-text-secondary ms-auto shrink-0"
            :data-test="`${childDataTest(block.child)}-lock`"
            aria-hidden="true"
          />
          <span
            v-if="isChildPaywalled(block.child)"
            :id="itemDescriptionId(block.child, 'inline-')"
            class="sr-only"
          >
            {{ t("menu.trialPageNeedsPlan", { page: childLabel(block.child) }) }}
          </span>
        </router-link>
      </template>
    </div>

    <!-- Flyout submenu — teleported to escape the rail's overflow clip; styled
         exactly like O2's native dropdown for consistency. -->
    <Teleport to="body">
      <div
        v-if="isOpen && !isMobile"
        ref="flyoutRef"
        :data-test="`nav-group-flyout-${groupKey}`"
        role="menu"
        :aria-label="title"
        :aria-describedby="showTrialNote ? trialNoteId : undefined"
        class="nav-group-flyout rounded-default border-dropdown-border bg-dropdown-bg min-w-52 border p-1 shadow-md"
        :style="flyoutStyle"
        @mouseenter="clearTimers"
        @mouseleave="scheduleClose"
        @keydown="onFlyoutKeydown"
      >
        <!-- Three levels, and the type says so: group (sm/semibold) → section
             (xs/semibold, secondary) → item (sm/normal). It used to run 11px →
             11px → 14px, which put the most emphasis on the deepest level and
             left the group title and its section headers indistinguishable.

             The group sits at body size rather than a step above it: 16px read
             as a page title inside a 217px menu. It outranks the items it sits
             over by weight, and the section header by both size and colour. The
             scale has no 15px step and raw px is barred, so this is the only
             move between the two. -->
        <div class="px-3 pt-1.5 pb-1 text-sm font-semibold" :class="flyoutTextClass">
          {{ title }}
        </div>
        <div
          v-if="showTrialNote"
          :id="trialNoteId"
          :data-test="`nav-group-flyout-${groupKey}-trial-note`"
          class="text-text-secondary max-w-56 px-3 pb-1.5 text-xs"
        >
          {{ t("menu.trialFlyoutNote") }}
        </div>
        <template v-for="(block, blockIndex) in flyoutBlocks" :key="block.key">
          <!-- A labelled group: the heading names it via aria-labelledby and is
               itself presentational, because a bare <div> is not a valid child
               of role="menu" and AT drops it. -->
          <div
            v-if="block.kind === 'group'"
            role="group"
            :aria-labelledby="block.labelId"
            :data-test="`nav-group-section-${block.key}`"
          >
            <div
              :id="block.labelId"
              role="presentation"
              :data-test="`nav-group-section-label-${block.key}`"
              class="text-text-secondary px-3 pb-1 text-xs font-semibold"
              :class="blockIndex === 0 ? 'pt-2' : 'pt-4'"
            >
              {{ t(block.labelKey) }}
            </div>
            <router-link
              v-for="(child, childIndex) in block.children"
              :key="childKey(child)"
              :data-test="childDataTest(child)"
              role="menuitem"
              :to="childTo(child)"
              class="nav-group-item rounded-default focus-visible:ring-accent flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm transition-colors duration-150 outline-none select-none [text-decoration:none]! focus-visible:ring-2 focus-visible:ring-inset"
              :class="[
                flyoutTextClass,
                childIndex > 0 ? 'mt-0.5' : '',
                isChildActive(child)
                  ? 'bg-select-item-selected-bg font-medium'
                  : 'hover:bg-dropdown-item-hover-bg',
              ]"
              :aria-current="isChildActive(child) ? 'page' : undefined"
              :data-paywalled="isChildPaywalled(child) ? 'true' : undefined"
              :aria-describedby="isChildPaywalled(child) ? itemDescriptionId(child) : undefined"
              @click="onChildClick"
              @mouseenter="onChildMouseenter"
            >
              <!-- Icon color is locked to the text color so it never picks up a
                   primary tint via currentColor inheritance. -->
              <OIcon
                :name="child.icon"
                size="sm"
                class="shrink-0"
                :class="isChildPaywalled(child) ? 'text-text-secondary!' : flyoutIconClass"
              />
              <span class="leading-none">{{ childLabel(child) }}</span>
              <BetaBadge v-if="child.beta" size="xs" />
              <OIcon
                v-if="isChildPaywalled(child)"
                name="lock"
                size="xs"
                class="text-text-secondary ms-auto shrink-0"
                :data-test="`${childDataTest(child)}-lock`"
                aria-hidden="true"
              />
              <span v-if="isChildPaywalled(child)" :id="itemDescriptionId(child)" class="sr-only">
                {{ t("menu.trialPageNeedsPlan", { page: childLabel(child) }) }}
              </span>
            </router-link>
          </div>

          <router-link
            v-else
            :data-test="childDataTest(block.child)"
            role="menuitem"
            :to="childTo(block.child)"
            class="nav-group-item rounded-default focus-visible:ring-accent flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm transition-colors duration-150 outline-none select-none [text-decoration:none]! focus-visible:ring-2 focus-visible:ring-inset"
            :class="[
              flyoutTextClass,
              // Matches the pt-4 a header gets, so leaving a run and starting
              // one look like the same size of break.
              block.spaced ? 'mt-3' : '',
              isChildActive(block.child)
                ? 'bg-select-item-selected-bg font-medium'
                : 'hover:bg-dropdown-item-hover-bg',
            ]"
            :aria-current="isChildActive(block.child) ? 'page' : undefined"
            :data-paywalled="isChildPaywalled(block.child) ? 'true' : undefined"
            :aria-describedby="
              isChildPaywalled(block.child) ? itemDescriptionId(block.child) : undefined
            "
            @click="onChildClick"
            @mouseenter="onChildMouseenter"
          >
            <OIcon
              :name="block.child.icon"
              size="sm"
              class="shrink-0"
              :class="isChildPaywalled(block.child) ? 'text-text-secondary!' : flyoutIconClass"
            />
            <span class="leading-none">{{ childLabel(block.child) }}</span>
            <BetaBadge v-if="block.child.beta" size="xs" />
            <OIcon
              v-if="isChildPaywalled(block.child)"
              name="lock"
              size="xs"
              class="text-text-secondary ms-auto shrink-0"
              :data-test="`${childDataTest(block.child)}-lock`"
              aria-hidden="true"
            />
            <span
              v-if="isChildPaywalled(block.child)"
              :id="itemDescriptionId(block.child)"
              class="sr-only"
            >
              {{ t("menu.trialPageNeedsPlan", { page: childLabel(block.child) }) }}
            </span>
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
