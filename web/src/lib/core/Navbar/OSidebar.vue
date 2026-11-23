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
/** Grouped one-row sidebar for the modern skin; same entries and gates as the classic rail. */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import { useTrialPaywall } from "@/composables/useTrialPaywall";
import { useTheme } from "@/composables/useTheme";
import { getImageURL } from "@/utils/zincutils";
import config from "@/aws-exports";
import type { NavItem, RailEntry, SubnavChild } from "./ONavbar.types";
import { groupNavLinks } from "./navGroups";
import { isGateOpen, useNavGateContext } from "./useNavGateContext";
import {
  childKey,
  childLocation,
  resolveActiveChild,
  sectionNavChildren,
  visibleNavChildren,
  type ChildSection,
} from "./navChildren";
import {
  SIDEBAR_ICONS,
  buildSidebarSections,
  groupContainsActive,
  sidebarIcon,
  type SidebarEntry,
  type SidebarSection,
} from "./sidebarModel";
import OSidebarItem from "./OSidebarItem.vue";
import {
  AIM_IDLE,
  aim,
  isAimingAtOpenFlyout,
  releasePointerTracking,
  retainPointerTracking,
} from "./hoverIntent";
import { flyoutColumns, flyoutTop } from "./flyoutLayout";

const props = withDefaults(
  defineProps<{
    linksList: NavItem[];
    flat?: boolean;
    loading?: boolean;
    /** The mobile drawer passes false: always expanded. */
    collapsible?: boolean;
  }>(),
  { flat: false, loading: false, collapsible: true },
);

const { t } = useI18nTyped();
const router: any = useRouter();
const store = useStore();
const gateContext = useNavGateContext();
const { isPaywalled } = useTrialPaywall();

const COLLAPSE_KEY = "o2-sidebar-collapsed";
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "true";
  } catch {
    return false;
  }
}
const collapsedPref = ref(readCollapsed());
const collapsed = computed(() => props.collapsible && collapsedPref.value);
const toggleLabel = computed(() =>
  collapsed.value ? t("components.sidebar.expand") : t("components.sidebar.collapse"),
);

// `[` toggles the sidebar, except while typing or with a modifier held.
function onKeydown(e: KeyboardEvent) {
  if (!props.collapsible || e.key !== "[" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)
    return;
  const target = e.target as Element | null;
  if (target?.closest?.("input,textarea,[contenteditable],.monaco-editor")) return;
  e.preventDefault();
  toggleCollapsed();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

function toggleCollapsed() {
  collapsedPref.value = !collapsedPref.value;
  try {
    localStorage.setItem(COLLAPSE_KEY, String(collapsedPref.value));
  } catch {
    // storage blocked: the choice still holds for this session
  }
}

const orgIdentifier = computed(() => store.state.selectedOrganization?.identifier);
const route = computed(() => router.currentRoute.value);

const railEntries = computed<RailEntry[]>(() =>
  props.flat
    ? props.linksList.map((item): RailEntry => ({ type: "link", item }))
    : groupNavLinks(props.linksList, t, (gate) => isGateOpen(gateContext.value, gate)),
);

function childPath(name: string): string | null {
  if (!router.hasRoute(name)) return null;
  try {
    return router.resolve({ name }).path || null;
  } catch {
    return null;
  }
}

interface GroupView {
  children: SubnavChild[];
  sections: ChildSection[];
  activeKey: string | null;
  tileLink: string;
}

function viewOf(entry: Extract<SidebarEntry, { type: "linkGroup" }>): GroupView {
  const children = visibleNavChildren(
    entry.children,
    gateContext.value,
    (name) => router.hasRoute(name),
    store.state.zoConfig,
  );
  const resolve = (list: SubnavChild[]) => resolveActiveChild(list, route.value, childPath);
  const active = resolve(entry.children) ?? resolve(entry.filtered ?? []);
  const anchorVisible = children.some((c) => childPath(c.name) === entry.item.link);
  const tileLink = anchorVisible
    ? entry.item.link
    : ((children[0] && childPath(children[0].name)) ?? entry.item.link);
  return {
    children,
    sections: sectionNavChildren(children),
    activeKey: active ? childKey(active) : null,
    tileLink,
  };
}

type SidebarRow =
  | { entry: Extract<SidebarEntry, { type: "link" }>; group: null }
  | { entry: Extract<SidebarEntry, { type: "linkGroup" }>; group: GroupView };

// A group whose every child is gated out renders nothing, as on the rail.
const sections = computed(() =>
  buildSidebarSections(railEntries.value, props.linksList)
    .map((section) => ({
      ...section,
      rows: section.entries.flatMap((entry): SidebarRow[] => {
        if (entry.type === "link") return [{ entry, group: null }];
        const group = viewOf(entry);
        return group.children.length ? [{ entry, group }] : [];
      }),
    }))
    .filter((section) => section.rows.length > 0),
);
const mainSections = computed(() => sections.value.filter((s) => s.key !== "bottom"));
const bottomSection = computed(() => sections.value.find((s) => s.key === "bottom"));

const expanded = reactive(new Set<string>());
watch(
  sections,
  (list) => {
    for (const section of list) {
      for (const row of section.rows) {
        if (
          row.group &&
          row.entry.type === "linkGroup" &&
          groupContainsActive(row.entry.children, row.entry.filtered, (c) =>
            resolveActiveChild(c, route.value, childPath),
          )
        ) {
          expanded.add(row.entry.item.name);
        }
      }
    }
  },
  { immediate: true },
);
function toggleGroup(name: string) {
  closeFlyout();
  if (expanded.has(name)) expanded.delete(name);
  else expanded.add(name);
}

// ── Group flyouts: hover intent, aim triangle and viewport fit shared with the classic rail ──
const OPEN_DELAY = 120;
const CLOSE_DELAY = 200;
const FLYOUT_GAP = 6;
const VIEWPORT_MARGIN = 8;
const navRef = ref<HTMLElement | null>(null);
const flyoutRef = ref<HTMLElement | null>(null);
const flyoutName = ref<string | null>(null);
const flyoutStyle = ref<Record<string, string>>({});
let flyoutAnchor: HTMLElement | null = null;
let openTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const flyoutRow = computed(() => {
  if (!flyoutName.value) return null;
  for (const section of sections.value) {
    for (const row of section.rows) {
      if (row.group && row.entry.item.name === flyoutName.value) return row;
    }
  }
  return null;
});

// The rail shows group children only in the hover flyout; the drawer never floats a menu.
const canFlyout = (_name: string) => props.collapsible;
const isRtl = () => document.documentElement.dir === "rtl";

function clearFlyoutTimers() {
  if (openTimer) clearTimeout(openTimer);
  if (closeTimer) clearTimeout(closeTimer);
  openTimer = closeTimer = null;
}

function positionFlyout() {
  const nav = navRef.value;
  if (!flyoutAnchor || !nav) return;
  const row = flyoutAnchor.getBoundingClientRect();
  const edge = nav.getBoundingClientRect();
  const top = flyoutTop({
    tileTop: row.top,
    height: flyoutRef.value?.offsetHeight ?? 0,
    viewportHeight: window.innerHeight,
    margin: VIEWPORT_MARGIN,
  });
  flyoutStyle.value = {
    top: `${top}px`,
    maxHeight: `${window.innerHeight - VIEWPORT_MARGIN * 2}px`,
    zIndex: "6000",
    ...(isRtl()
      ? { right: `${document.documentElement.clientWidth - edge.left + FLYOUT_GAP}px` }
      : { left: `${edge.right + FLYOUT_GAP}px` }),
  };
}

function onOutsidePointerDown(e: PointerEvent) {
  const target = e.target as Node;
  if (flyoutRef.value?.contains(target) || flyoutAnchor?.contains(target)) return;
  closeFlyout();
}

async function openFlyout(name: string, anchor: HTMLElement) {
  if (!canFlyout(name)) return;
  clearFlyoutTimers();
  if (!flyoutName.value) {
    retainPointerTracking();
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
  }
  flyoutName.value = name;
  flyoutAnchor = anchor;
  await nextTick();
  positionFlyout();
}

function closeFlyout() {
  clearFlyoutTimers();
  if (!flyoutName.value) return;
  flyoutName.value = null;
  flyoutAnchor = null;
  aim.exit = aim.flyout = null;
  releasePointerTracking();
  document.removeEventListener("pointerdown", onOutsidePointerDown, true);
}

function scheduleFlyoutOpen(name: string, e: MouseEvent) {
  if (!canFlyout(name)) return;
  const anchor = e.currentTarget as HTMLElement;
  clearFlyoutTimers();
  openTimer = setTimeout(() => openFlyout(name, anchor), OPEN_DELAY);
}

function scheduleFlyoutClose(e?: MouseEvent) {
  clearFlyoutTimers();
  if (!flyoutName.value) return;
  aim.exit = e ? { x: e.clientX, y: e.clientY } : null;
  aim.flyout = e ? flyoutRef.value : null;
  const tryClose = () => {
    if (aim.flyout && isAimingAtOpenFlyout()) {
      closeTimer = setTimeout(tryClose, AIM_IDLE);
      return;
    }
    closeFlyout();
  };
  closeTimer = setTimeout(tryClose, CLOSE_DELAY);
}

const flyoutColumnCount = computed(() =>
  flyoutRow.value?.group
    ? flyoutColumns(flyoutRow.value.group.sections.map((s) => s.children.length))
    : 1,
);
// Static class strings so Tailwind sees them: one 200px column per group.
const FLYOUT_GRID: Record<number, string> = {
  2: "grid grid-cols-[repeat(2,12.5rem)] gap-x-2 gap-y-1.5",
  3: "grid grid-cols-[repeat(3,12.5rem)] gap-x-2 gap-y-1.5",
};

const flyoutItems = () =>
  Array.from(
    flyoutRef.value?.querySelectorAll<HTMLElement>('[data-test^="sidebar-flyout-item-"]') ?? [],
  );

async function onGroupKeydown(name: string, e: KeyboardEvent) {
  const openKey = isRtl() ? "ArrowLeft" : "ArrowRight";
  const activates = props.collapsible && (e.key === "Enter" || e.key === " ");
  if ((e.key === openKey || activates) && canFlyout(name)) {
    e.preventDefault();
    await openFlyout(name, e.currentTarget as HTMLElement);
    flyoutItems()[0]?.focus();
  } else if (e.key === "Escape" && flyoutName.value === name) {
    closeFlyout();
  }
}

function onFlyoutKeydown(e: KeyboardEvent) {
  const items = flyoutItems();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const backKey = isRtl() ? "ArrowRight" : "ArrowLeft";
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  } else if (e.key === "Escape" || e.key === backKey) {
    e.preventDefault();
    const anchor = flyoutAnchor;
    closeFlyout();
    anchor?.focus();
  } else if (e.key === " ") {
    // Links ignore Space natively.
    e.preventDefault();
    (e.target as HTMLElement).click();
  } else if (e.key === "Tab") {
    closeFlyout();
  }
}

watch(() => route.value.fullPath, closeFlyout);
watch(collapsed, closeFlyout);
onBeforeUnmount(closeFlyout);

function linkActive(item: NavItem): boolean {
  const r = route.value;
  if (item.link === "/") return r.name === "home" || r.path === "/" || r.path === "";
  return r.path.indexOf(item.link) === 0;
}
const linkTo = (link: string) => ({ path: link, query: { org_identifier: orgIdentifier.value } });
const childLabel = (c: SubnavChild): I18nText => (c.title ? raw(c.title) : t(c.titleKey));
const iconFor = (item: NavItem) => sidebarIcon(SIDEBAR_ICONS[item.name] ?? item.icon);
const sectionTitle = (s: SidebarSection) => (s.titleKey ? t(s.titleKey) : undefined);
const headingIdBase = useId();
const headingId = (scope: string, group: string, s: ChildSection) =>
  s.titleKey ? `${headingIdBase}-${scope}-${group}-${s.key}` : undefined;
const { isDark } = useTheme();
const zo = computed(() => store.state.zoConfig ?? {});
// Same precedence as the classic header: theme-matched image, then either image, then text.
const customLogo = computed(() => {
  if (config.isEnterprise !== "true") return { text: "", img: "", isSet: false };
  const text: string = zo.value.custom_logo_text || "";
  const raw64: string | null =
    (isDark.value
      ? (zo.value.custom_logo_dark_img ?? zo.value.custom_logo_img)
      : (zo.value.custom_logo_img ?? zo.value.custom_logo_dark_img)) ?? null;
  const img = raw64 ? `data:image; base64, ${raw64}` : "";
  return { text, img, isSet: !!(text || img) };
});
const showSelfLogo = computed(
  () =>
    !customLogo.value.isSet ||
    (zo.value.custom_hide_self_logo === false && !(collapsed.value && customLogo.value.img)),
);
const selfLogoSrc = computed(() =>
  getImageURL(
    collapsed.value || customLogo.value.isSet
      ? isDark.value
        ? "images/common/openobserve_mark_dark.svg"
        : "images/common/openobserve_mark_light.svg"
      : isDark.value
        ? "images/common/openobserve_latest_dark_2.svg"
        : "images/common/openobserve_latest_light_2.svg",
  ),
);
</script>

<template>
  <nav
    ref="navRef"
    :aria-label="t('components.navbar.mainNavigation')"
    data-test="sidebar"
    :data-collapsed="collapsed ? 'true' : undefined"
    class="bg-surface-chrome-deeper flex h-full min-h-0 shrink-0 flex-col overflow-hidden transition-[width] duration-[220ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
    :class="collapsible ? (collapsed ? 'w-13' : 'w-[9.6875rem]') : 'w-full'"
  >
    <div
      v-if="collapsible"
      class="flex h-10 shrink-0 items-center"
      :class="collapsed ? 'justify-center px-2' : 'px-4'"
    >
      <RouterLink
        :to="linkTo('/')"
        class="inline-flex min-w-0 items-center gap-2 text-inherit no-underline"
        data-test="sidebar-logo"
        :aria-label="raw('OpenObserve')"
      >
        <span
          v-if="customLogo.text && !collapsed"
          class="truncate text-lg font-semibold"
          data-test="sidebar-custom-logo-text"
          >{{ customLogo.text }}</span
        >
        <img
          v-if="customLogo.img"
          class="block max-h-7 w-auto min-w-0 shrink object-contain"
          :class="collapsed ? 'max-w-10' : 'max-w-37.5'"
          :src="customLogo.img"
          :alt="t('common.customLogoAlt')"
          data-test="sidebar-custom-logo"
        />
        <img
          v-if="showSelfLogo"
          class="block w-auto shrink-0"
          :class="collapsed || customLogo.isSet ? 'h-5' : 'h-7'"
          :src="selfLogoSrc"
          alt=""
          data-test="sidebar-openobserve-logo"
        />
      </RouterLink>
    </div>

    <div class="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto p-2">
      <div
        v-if="loading"
        class="flex flex-col gap-1 pt-1"
        aria-hidden="true"
        data-test="sidebar-skeleton"
      >
        <OSkeleton v-for="n in 10" :key="n" class="h-8 w-full" />
      </div>
      <template v-else>
        <div
          v-for="section in mainSections"
          :key="section.key"
          role="group"
          :aria-label="sectionTitle(section)"
          class="flex flex-col gap-0.5"
          :data-test="`sidebar-group-${section.key}`"
        >
          <div
            v-if="section.titleKey"
            class="relative shrink-0 overflow-hidden transition-[height] duration-[220ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
            :class="collapsed ? 'h-3.5' : 'h-8'"
            aria-hidden="true"
          >
            <div
              class="overflow-hidden px-2 pt-3 pb-1 text-xs font-semibold tracking-wide whitespace-nowrap text-[var(--color-sidebar-section-label)] transition-opacity duration-150 motion-reduce:transition-none"
              :class="collapsed ? 'opacity-0' : 'opacity-100'"
            >
              {{ sectionTitle(section) }}
            </div>
            <div
              class="border-border-default absolute inset-x-2 top-1/2 border-t transition-opacity duration-150 motion-reduce:transition-none"
              :class="collapsed ? 'opacity-100' : 'opacity-0'"
            />
          </div>
          <template v-for="row in section.rows" :key="row.entry.item.name">
            <OSidebarItem
              v-if="!row.group"
              :label="row.entry.item.title"
              :icon="iconFor(row.entry.item)"
              :to="linkTo(row.entry.item.link)"
              :active="linkActive(row.entry.item)"
              :collapsed="collapsed"
              :locked="row.entry.item.locked"
              :license-locked="row.entry.item.licenseLocked"
              :paywalled="isPaywalled(row.entry.item.link)"
              :data-test="`sidebar-item-${row.entry.item.name}`"
            />
            <template v-else>
              <OSidebarItem
                :label="row.entry.item.title"
                :icon="iconFor(row.entry.item)"
                :to="linkTo(row.group.tileLink)"
                :active="row.group.activeKey !== null"
                :collapsed="collapsed"
                :expanded="collapsible ? undefined : expanded.has(row.entry.item.name)"
                :aria-controls="collapsible ? undefined : `sidebar-children-${row.entry.item.name}`"
                :flyout="collapsible"
                :aria-haspopup="collapsible ? 'menu' : undefined"
                :data-test="`sidebar-item-${row.entry.item.name}`"
                @toggle="toggleGroup(row.entry.item.name)"
                @mouseenter="scheduleFlyoutOpen(row.entry.item.name, $event)"
                @mouseleave="scheduleFlyoutClose($event)"
                @keydown="onGroupKeydown(row.entry.item.name, $event)"
              />
              <div
                v-if="!collapsible"
                :id="`sidebar-children-${row.entry.item.name}`"
                class="grid transition-[grid-template-rows,opacity] duration-[220ms,150ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
                :class="
                  !collapsed && expanded.has(row.entry.item.name)
                    ? 'grid-rows-[1fr] opacity-100'
                    : 'grid-rows-[0fr] opacity-0'
                "
                :inert="collapsed || !expanded.has(row.entry.item.name)"
                :aria-hidden="collapsed || !expanded.has(row.entry.item.name) ? true : undefined"
                :data-test="`sidebar-children-${row.entry.item.name}`"
              >
                <div class="flex min-h-0 flex-col gap-0.5 overflow-hidden">
                  <div
                    v-for="(childSection, sectionIndex) in row.group.sections"
                    :key="childSection.key"
                    :role="childSection.titleKey ? 'group' : 'none'"
                    :aria-labelledby="headingId('inline', row.entry.item.name, childSection)"
                    class="flex flex-col gap-0.5"
                    :class="sectionIndex > 0 ? 'mt-1.5' : ''"
                    :data-test="
                      childSection.titleKey ? `sidebar-section-${childSection.key}` : undefined
                    "
                  >
                    <div
                      v-if="childSection.titleKey"
                      :id="headingId('inline', row.entry.item.name, childSection)"
                      role="presentation"
                      class="text-text-secondary flex items-center gap-1.5 overflow-hidden ps-8.5 pe-2 pt-1 pb-0.5 text-xs font-medium whitespace-nowrap transition-opacity duration-150 motion-reduce:transition-none"
                      :data-test="`sidebar-section-label-${childSection.key}`"
                    >
                      {{ t(childSection.titleKey) }}
                      <BetaBadge
                        v-if="childSection.beta"
                        size="xs"
                        class="px-1! py-px! text-[0.625rem]! leading-none! font-semibold! tracking-normal! normal-case!"
                      />
                    </div>
                    <OSidebarItem
                      v-for="child in childSection.children"
                      :key="childKey(child)"
                      sub
                      :label="childLabel(child)"
                      :to="childLocation(child, route, orgIdentifier)"
                      :active="row.group.activeKey === childKey(child)"
                      :locked="child.locked"
                      :license-locked="child.licenseLocked"
                      :paywalled="isPaywalled(childLocation(child, route, orgIdentifier))"
                      :beta="child.beta && !childSection.beta"
                      :data-test="`sidebar-item-${child.name}${child.tab ? `-${child.tab}` : ''}`"
                    />
                  </div>
                </div>
              </div>
            </template>
          </template>
        </div>
      </template>
    </div>

    <div class="flex shrink-0 flex-col gap-0.5 px-2 pb-2">
      <OSidebarItem
        v-for="row in bottomSection && !loading ? bottomSection.rows : []"
        :key="row.entry.item.name"
        :label="row.entry.item.title"
        :icon="iconFor(row.entry.item)"
        :to="linkTo(row.group ? row.group.tileLink : row.entry.item.link)"
        :active="row.group ? row.group.activeKey !== null : linkActive(row.entry.item)"
        :collapsed="collapsed"
        :locked="row.entry.item.locked"
        :license-locked="row.entry.item.licenseLocked"
        :paywalled="isPaywalled(row.entry.item.link)"
        :data-test="`sidebar-item-${row.entry.item.name}`"
      />
      <button
        v-if="collapsible"
        type="button"
        class="group/nav rounded-default text-text-body hover:bg-dropdown-item-hover-bg focus-visible:ring-accent mt-0.5 flex h-8 w-full min-w-9 cursor-pointer items-center gap-2.5 overflow-hidden border-0 bg-transparent px-2 text-start [font-family:inherit] text-xs font-normal transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset motion-reduce:transition-none"
        :aria-label="toggleLabel"
        :aria-expanded="!collapsed"
        data-test="sidebar-collapse-toggle"
        @click="toggleCollapsed"
      >
        <OIcon
          :name="collapsed ? 'left-panel-open' : 'left-panel-close'"
          size="sm"
          class="text-text-secondary size-4! shrink-0"
        />
        <span
          class="min-w-0 flex-1 truncate transition-opacity duration-150 motion-reduce:transition-none"
          :class="collapsed ? 'opacity-0' : 'opacity-100'"
          :aria-hidden="collapsed ? true : undefined"
          >{{ t("components.sidebar.collapseShort") }}</span
        >
        <OTooltip :content="toggleLabel" shortcut="[" :side="collapsed ? 'right' : 'top'" />
      </button>
    </div>

    <Teleport to="body">
      <div
        v-if="flyoutRow?.group"
        ref="flyoutRef"
        role="menu"
        :aria-label="flyoutRow.entry.item.title"
        class="shadow-overlay rounded-default fixed flex max-w-150 min-w-52 flex-col gap-0.5 overflow-y-auto overscroll-contain border border-[var(--color-sidebar-flyout-border)] bg-[var(--color-sidebar-flyout-bg)] p-1"
        :style="flyoutStyle"
        :data-test="`sidebar-flyout-${flyoutRow.entry.item.name}`"
        @mouseenter="clearFlyoutTimers"
        @mouseleave="scheduleFlyoutClose()"
        @keydown="onFlyoutKeydown"
      >
        <div
          class="text-text-heading text-compact overflow-hidden px-2 pt-1 pb-1 font-semibold whitespace-nowrap transition-opacity duration-150 motion-reduce:transition-none"
          aria-hidden="true"
        >
          {{ flyoutRow.entry.item.title }}
        </div>
        <div
          role="none"
          :class="FLYOUT_GRID[flyoutColumnCount] ?? 'flex flex-col gap-0.5'"
          :data-test="`sidebar-flyout-columns-${flyoutColumnCount}`"
        >
          <!-- A bare <div> is not a valid child of role="menu", so headless runs take role="none". -->
          <div
            v-for="(childSection, sectionIndex) in flyoutRow.group.sections"
            :key="childSection.key"
            :role="childSection.titleKey ? 'group' : 'none'"
            :aria-labelledby="headingId('flyout', flyoutRow.entry.item.name, childSection)"
            class="flex min-w-0 flex-col gap-0.5"
            :class="sectionIndex > 0 && flyoutColumnCount === 1 ? 'mt-1.5' : ''"
            :data-test="
              childSection.titleKey ? `sidebar-flyout-section-${childSection.key}` : undefined
            "
          >
            <div
              v-if="childSection.titleKey"
              :id="headingId('flyout', flyoutRow.entry.item.name, childSection)"
              role="presentation"
              class="flex items-center gap-1.5 overflow-hidden px-2 pt-1 pb-0.5 text-xs font-semibold tracking-wide whitespace-nowrap text-[var(--color-sidebar-section-label)] transition-opacity duration-150 motion-reduce:transition-none"
              :data-test="`sidebar-flyout-section-label-${childSection.key}`"
            >
              {{ t(childSection.titleKey) }}
              <BetaBadge
                v-if="childSection.beta"
                size="xs"
                class="px-1! py-px! text-[0.625rem]! leading-none! font-semibold! tracking-normal! normal-case!"
              />
            </div>
            <OSidebarItem
              v-for="child in childSection.children"
              :key="childKey(child)"
              role="menuitem"
              large
              :label="childLabel(child)"
              :icon="sidebarIcon(child.icon)"
              :to="childLocation(child, route, orgIdentifier)"
              :active="flyoutRow.group.activeKey === childKey(child)"
              :locked="child.locked"
              :license-locked="child.licenseLocked"
              :paywalled="isPaywalled(childLocation(child, route, orgIdentifier))"
              :beta="child.beta && !childSection.beta"
              :data-test="`sidebar-flyout-item-${child.name}${child.tab ? `-${child.tab}` : ''}`"
            />
          </div>
        </div>
      </div>
    </Teleport>
  </nav>
</template>
