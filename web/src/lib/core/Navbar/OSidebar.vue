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
import { computed, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBetaBadge from "@/lib/core/Badge/OBetaBadge.vue";
import { useTrialPaywall } from "@/composables/useTrialPaywall";
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
} from "./sidebarModel";
import OSidebarItem from "./OSidebarItem.vue";

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

const RECENTS_GROUP = "__recents";
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
          openGroup(row.entry.item.name);
        }
      }
    }
  },
  { immediate: true },
);
// One menu group open at a time; Recents keeps its own state.
function openGroup(name: string) {
  for (const open of [...expanded]) {
    if (open !== name && open !== RECENTS_GROUP) expanded.delete(open);
  }
  expanded.add(name);
}
function toggleGroup(name: string) {
  if (expanded.has(name)) expanded.delete(name);
  else if (name === RECENTS_GROUP) expanded.add(name);
  else openGroup(name);
}

// ── Collapsed rail peek: the full menu overlays the page once the pointer rests on the rail ──
// The pointer must settle, so a fast pass toward the page's left edge never opens it.
const PEEK_REST_DELAY = 280;
const PEEK_CLOSE_DELAY = 250;
const peek = ref(false);
let peekTimer: ReturnType<typeof setTimeout> | null = null;
// After a navigation the peek stays shut until the pointer leaves the rail.
let peekSuppressed = false;
const railCollapsed = computed(() => collapsed.value && !peek.value);
const navRef = ref<HTMLElement | null>(null);

function clearPeekTimer() {
  if (peekTimer) clearTimeout(peekTimer);
  peekTimer = null;
}
function onRailPointerMove() {
  if (!collapsed.value || peek.value || peekSuppressed) return;
  clearPeekTimer();
  peekTimer = setTimeout(() => (peek.value = true), PEEK_REST_DELAY);
}
function onRailLeave() {
  peekSuppressed = false;
  clearPeekTimer();
  if (peek.value) peekTimer = setTimeout(() => (peek.value = false), PEEK_CLOSE_DELAY);
}
function onRailFocusIn(e: FocusEvent) {
  if (collapsed.value && (e.target as Element | null)?.matches?.(":focus-visible")) {
    clearPeekTimer();
    peek.value = true;
  }
}
function onRailFocusOut(e: FocusEvent) {
  if (peek.value && !navRef.value?.contains(e.relatedTarget as Node | null)) peek.value = false;
}
watch(
  () => route.value.fullPath,
  () => {
    if (!peek.value) return;
    clearPeekTimer();
    peek.value = false;
    peekSuppressed = true;
  },
);
watch(collapsed, () => {
  clearPeekTimer();
  peek.value = false;
});
onBeforeUnmount(clearPeekTimer);

function linkActive(item: NavItem): boolean {
  const r = route.value;
  if (item.link === "/") return r.name === "home" || r.path === "/" || r.path === "";
  return r.path.indexOf(item.link) === 0;
}
const linkTo = (link: string) => ({ path: link, query: { org_identifier: orgIdentifier.value } });
const childLabel = (c: SubnavChild): I18nText => (c.title ? raw(c.title) : t(c.titleKey));
const iconFor = (item: NavItem) => sidebarIcon(SIDEBAR_ICONS[item.name] ?? item.icon);
const sectionTitle = (s: { titleKey?: I18nKey }) => (s.titleKey ? t(s.titleKey) : undefined);

// ── Promoted rows: a group's main pages sit in the menu directly; its secondary pages hide behind a chevron ──
interface PromotedSpec {
  main: string;
  label?: I18nKey;
  sub?: string[];
}
interface GroupPlan {
  section?: { key: string; titleKey: I18nKey };
  rows: PromotedSpec[];
}
const PROMOTED: Record<string, GroupPlan> = {
  traces: {
    rows: [
      {
        main: "traces-traces",
        sub: ["traces-spans", "traces-service-graph", "traces-services-catalog"],
      },
    ],
  },
  dashboards: { rows: [{ main: "dashboards", sub: ["reports"] }] },
  reliability: {
    rows: [
      {
        main: "alertList",
        label: "components.sidebar.alerts",
        sub: [
          "alertDestinations",
          "alertTemplates",
          "alertLibrary",
          "downtimes",
          "alertCalibration",
        ],
      },
      { main: "sloList" },
      {
        main: "onCallResponses",
        label: "components.sidebar.onCall",
        sub: ["onCallTeams", "onCallRouting", "onCallMine"],
      },
      { main: "autobotInvestigate" },
    ],
  },
  infra: {
    section: { key: "infra", titleKey: "components.sidebar.infrastructure" },
    rows: [{ main: "infraHosts" }, { main: "dbmDatabases" }, { main: "infraKubernetes" }],
  },
  experience: {
    section: { key: "experience", titleKey: "components.sidebar.experience" },
    rows: [{ main: "RUM" }, { main: "synthetics" }, { main: "productAnalytics" }],
  },
  data: {
    rows: [
      { main: "logstreams" },
      { main: "pipelines", sub: ["workflows"] },
      { main: "functionList" },
      { main: "enrichmentTables" },
      { main: "ingestion", sub: ["fleet"] },
    ],
  },
};

interface PromotedRow {
  kind: "promoted";
  key: string;
  groupItem: NavItem;
  group: GroupView;
  main: SubnavChild;
  label: I18nText;
  beta: boolean;
  subs: SubnavChild[];
}
type DisplayRow = { kind: "row"; row: SidebarRow } | PromotedRow;
interface DisplaySection {
  key: string;
  titleKey?: I18nKey;
  rows: DisplayRow[];
}

const childId = (c: SubnavChild) => `${c.name}${c.tab ? `-${c.tab}` : ""}`;

function promoteGroup(row: SidebarRow, plan: GroupPlan): PromotedRow[] {
  const group = row.group as GroupView;
  const byId = new Map(group.children.map((c) => [childId(c), c]));
  const betaSection = new Set(
    group.sections.filter((s) => s.beta).flatMap((s) => s.children.map(childId)),
  );
  const used = new Set<string>();
  const take = (id: string) => {
    const child = byId.get(id);
    if (!child || used.has(id)) return null;
    used.add(id);
    return child;
  };
  const rows: PromotedRow[] = [];
  const build = (spec: PromotedSpec | null, main: SubnavChild, subs: SubnavChild[]) => {
    const id = childId(main);
    rows.push({
      kind: "promoted",
      key: `p:${id}`,
      groupItem: row.entry.item,
      group,
      main,
      label: spec?.label ? t(spec.label) : childLabel(main),
      beta: !!main.beta || betaSection.has(id),
      subs,
    });
  };
  for (const spec of plan.rows) {
    const subs = (spec.sub ?? []).map(take).filter((c): c is SubnavChild => !!c);
    const main = take(spec.main) ?? subs.shift();
    if (main) build(spec, main, subs);
  }
  // A page the plan does not name still gets its own row, so a new child is never lost.
  for (const child of group.children) {
    if (!used.has(childId(child))) build(null, child, []);
  }
  return rows;
}

const displaySections = computed<DisplaySection[]>(() => {
  const out: DisplaySection[] = [];
  for (const section of mainSections.value) {
    const rows: DisplayRow[] = [];
    const extra: DisplaySection[] = [];
    for (const row of section.rows) {
      const plan = row.group ? PROMOTED[row.entry.item.name] : undefined;
      if (!plan) {
        rows.push({ kind: "row", row });
        continue;
      }
      const promoted = promoteGroup(row, plan);
      if (plan.section) extra.push({ ...plan.section, rows: promoted });
      else rows.push(...promoted);
    }
    if (rows.length) out.push({ key: section.key, titleKey: section.titleKey, rows });
    out.push(...extra);
  }
  return out;
});

const isActiveChild = (r: PromotedRow, c: SubnavChild) => r.group.activeKey === childKey(c);
const subActive = (r: PromotedRow) => r.subs.some((c) => isActiveChild(r, c));
const promotedIcon = (r: PromotedRow) =>
  r.main.icon ? sidebarIcon(r.main.icon) : iconFor(r.groupItem);

watch(
  displaySections,
  (list) => {
    for (const section of list) {
      for (const r of section.rows) {
        if (r.kind === "promoted" && subActive(r)) openGroup(r.key);
      }
    }
  },
  { immediate: true },
);
const headingIdBase = useId();
const headingId = (scope: string, group: string, s: ChildSection) =>
  s.titleKey ? `${headingIdBase}-${scope}-${group}-${s.key}` : undefined;

// ── Recents: the last pages visited from the menu, with the group they belong to ──
const RECENTS_KEY = "o2-sidebar-recents";
const RECENTS_MAX = 5;
interface NavTarget {
  key: string;
  label: I18nText;
  group?: I18nText;
  to: RouteLocationRaw;
}

const navTargets = computed(() => {
  const map = new Map<string, NavTarget>();
  for (const section of sections.value) {
    for (const row of section.rows) {
      const name = row.entry.item.name;
      if (!row.group) {
        map.set(`link:${name}`, {
          key: `link:${name}`,
          label: row.entry.item.title,
          to: linkTo(row.entry.item.link),
        });
        continue;
      }
      for (const child of row.group.children) {
        const key = `child:${name}:${childKey(child)}`;
        const label = childLabel(child);
        map.set(key, {
          key,
          label,
          group: String(label) === String(row.entry.item.title) ? undefined : row.entry.item.title,
          to: childLocation(child, route.value, orgIdentifier.value),
        });
      }
    }
  }
  return map;
});

function currentTargetKey(): string | null {
  for (const section of sections.value) {
    for (const row of section.rows) {
      const name = row.entry.item.name;
      if (row.group?.activeKey) return `child:${name}:${row.group.activeKey}`;
      if (!row.group && linkActive(row.entry.item)) return `link:${name}`;
    }
  }
  return null;
}

function readRecents(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}
const recentKeys = ref<string[]>(readRecents());

watch(
  [() => route.value.fullPath, sections],
  () => {
    const key = currentTargetKey();
    if (!key || recentKeys.value[0] === key) return;
    recentKeys.value = [key, ...recentKeys.value.filter((k) => k !== key)].slice(
      0,
      RECENTS_MAX + 1,
    );
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(recentKeys.value));
    } catch {
      // storage blocked: recents still hold for this session
    }
  },
  { immediate: true },
);

// The page already open is not a shortcut, so it is left out.
const recents = computed(() => {
  const current = currentTargetKey();
  return recentKeys.value
    .filter((k) => k !== current)
    .map((k) => navTargets.value.get(k))
    .filter((target): target is NavTarget => !!target)
    .slice(0, RECENTS_MAX);
});
</script>

<template>
  <div
    class="relative h-full min-h-0 shrink-0 transition-[width] duration-[220ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
    :class="collapsible ? (collapsed ? 'w-13' : 'w-54') : 'w-full'"
    :data-rail="collapsible ? (collapsed ? 'collapsed' : 'expanded') : undefined"
  >
    <nav
      ref="navRef"
      :aria-label="t('components.navbar.mainNavigation')"
      data-test="sidebar"
      :data-collapsed="railCollapsed ? 'true' : undefined"
      :data-peek="peek ? 'true' : undefined"
      class="bg-surface-chrome-deeper absolute inset-y-0 start-0 flex min-h-0 flex-col overflow-hidden transition-[width,box-shadow] duration-[220ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
      :class="[
        collapsible ? (railCollapsed ? 'w-13' : 'w-54') : 'w-full',
        peek ? 'border-border-default z-50 border-e' : '',
      ]"
      @mouseenter="clearPeekTimer"
      @mousemove="onRailPointerMove"
      @mouseleave="onRailLeave"
      @focusin="onRailFocusIn"
      @focusout="onRailFocusOut"
    >
      <div
        class="scrollbar-reveal flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto p-2"
      >
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
            v-for="(section, sectionIdx) in displaySections"
            :key="section.key"
            role="group"
            :aria-label="sectionTitle(section)"
            class="flex flex-col gap-0.5"
            :data-test="`sidebar-group-${section.key}`"
          >
            <div
              v-if="section.titleKey"
              class="relative shrink-0 overflow-hidden transition-[height] duration-[220ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
              :class="railCollapsed ? 'h-3.5' : 'h-8'"
              aria-hidden="true"
            >
              <div
                class="overflow-hidden px-2 pt-4 pb-1 text-xs font-medium whitespace-nowrap text-[var(--color-sidebar-section-label)] transition-opacity duration-150 motion-reduce:transition-none"
                :class="railCollapsed ? 'opacity-0' : 'opacity-100'"
              >
                {{ sectionTitle(section) }}
              </div>
              <div
                class="border-border-default absolute inset-x-2 top-1/2 border-t transition-opacity duration-150 motion-reduce:transition-none"
                :class="railCollapsed ? 'opacity-100' : 'opacity-0'"
              />
            </div>
            <template
              v-for="drow in section.rows"
              :key="drow.kind === 'promoted' ? drow.key : drow.row.entry.item.name"
            >
              <template v-if="drow.kind === 'promoted'">
                <div class="relative">
                  <OSidebarItem
                    :label="drow.label"
                    :icon="promotedIcon(drow)"
                    :to="childLocation(drow.main, route, orgIdentifier)"
                    :active="isActiveChild(drow, drow.main)"
                    :child-active="subActive(drow)"
                    :collapsed="railCollapsed"
                    :locked="drow.main.locked"
                    :license-locked="drow.main.licenseLocked"
                    :paywalled="isPaywalled(childLocation(drow.main, route, orgIdentifier))"
                    :beta="drow.beta"
                    :class="drow.subs.length && !railCollapsed ? 'pe-8!' : ''"
                    :data-test="`sidebar-item-${childId(drow.main)}`"
                  />
                  <button
                    v-if="drow.subs.length && !railCollapsed"
                    type="button"
                    class="rounded-default text-text-secondary hover:bg-surface-hover hover:text-text-body focus-visible:ring-accent absolute inset-y-0.5 end-0.5 flex w-6 cursor-pointer items-center justify-center border-0 bg-transparent transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
                    :aria-label="t('components.sidebar.morePages', { name: String(drow.label) })"
                    :aria-expanded="expanded.has(drow.key)"
                    :aria-controls="`sidebar-children-${drow.key}`"
                    :data-test="`sidebar-expand-${childId(drow.main)}`"
                    @click="toggleGroup(drow.key)"
                  >
                    <OIcon
                      name="sidebar-chevron-right"
                      size="sm"
                      class="size-4! transition-transform duration-150 motion-reduce:transition-none rtl:rotate-180"
                      :class="expanded.has(drow.key) ? 'rotate-90 rtl:rotate-90' : ''"
                    />
                  </button>
                </div>
                <div
                  v-if="drow.subs.length"
                  :id="`sidebar-children-${drow.key}`"
                  class="grid transition-[grid-template-rows,opacity] duration-[220ms,150ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
                  :class="
                    !railCollapsed && expanded.has(drow.key)
                      ? 'grid-rows-[1fr] opacity-100'
                      : 'grid-rows-[0fr] opacity-0'
                  "
                  :inert="railCollapsed || !expanded.has(drow.key)"
                  :aria-hidden="railCollapsed || !expanded.has(drow.key) ? true : undefined"
                >
                  <div
                    class="before:bg-text-secondary/25 relative flex min-h-0 flex-col gap-0.5 overflow-hidden before:absolute before:inset-y-0.5 before:start-4 before:w-px"
                  >
                    <OSidebarItem
                      v-for="child in drow.subs"
                      :key="childKey(child)"
                      sub
                      :label="childLabel(child)"
                      :to="childLocation(child, route, orgIdentifier)"
                      :active="isActiveChild(drow, child)"
                      :locked="child.locked"
                      :license-locked="child.licenseLocked"
                      :paywalled="isPaywalled(childLocation(child, route, orgIdentifier))"
                      :beta="child.beta"
                      :data-test="`sidebar-item-${childId(child)}`"
                    />
                  </div>
                </div>
              </template>
              <template v-else>
                <template v-for="row in [drow.row]" :key="row.entry.item.name">
                  <OSidebarItem
                    v-if="!row.group"
                    :label="row.entry.item.title"
                    :icon="iconFor(row.entry.item)"
                    :to="linkTo(row.entry.item.link)"
                    :active="linkActive(row.entry.item)"
                    :collapsed="railCollapsed"
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
                      :collapsed="railCollapsed"
                      :expanded="railCollapsed ? undefined : expanded.has(row.entry.item.name)"
                      :aria-controls="`sidebar-children-${row.entry.item.name}`"
                      :data-test="`sidebar-item-${row.entry.item.name}`"
                      @toggle="toggleGroup(row.entry.item.name)"
                    />
                    <div
                      :id="`sidebar-children-${row.entry.item.name}`"
                      class="grid transition-[grid-template-rows,opacity] duration-[220ms,150ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
                      :class="
                        !railCollapsed && expanded.has(row.entry.item.name)
                          ? 'grid-rows-[1fr] opacity-100'
                          : 'grid-rows-[0fr] opacity-0'
                      "
                      :inert="railCollapsed || !expanded.has(row.entry.item.name)"
                      :aria-hidden="
                        railCollapsed || !expanded.has(row.entry.item.name) ? true : undefined
                      "
                      :data-test="`sidebar-children-${row.entry.item.name}`"
                    >
                      <div
                        class="before:bg-text-secondary/25 relative flex min-h-0 flex-col gap-0.5 overflow-hidden before:absolute before:inset-y-0.5 before:start-4 before:w-px"
                      >
                        <div
                          v-for="(childSection, sectionIndex) in row.group.sections"
                          :key="childSection.key"
                          :role="childSection.titleKey ? 'group' : 'none'"
                          :aria-labelledby="headingId('inline', row.entry.item.name, childSection)"
                          class="flex flex-col gap-0.5"
                          :class="sectionIndex > 0 ? 'mt-1.5' : ''"
                          :data-test="
                            childSection.titleKey
                              ? `sidebar-section-${childSection.key}`
                              : undefined
                          "
                        >
                          <div
                            v-if="childSection.titleKey"
                            :id="headingId('inline', row.entry.item.name, childSection)"
                            role="presentation"
                            class="text-text-secondary flex items-center gap-1.5 overflow-hidden ps-7 pe-2 pt-1 pb-0.5 text-xs font-medium whitespace-nowrap transition-opacity duration-150 motion-reduce:transition-none"
                            :data-test="`sidebar-section-label-${childSection.key}`"
                          >
                            {{ t(childSection.titleKey) }}
                            <OBetaBadge v-if="childSection.beta" />
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
              </template>
            </template>
            <template v-if="sectionIdx === 0 && recents.length">
              <OSidebarItem
                :label="t('components.sidebar.recents')"
                icon="history"
                :collapsed="railCollapsed"
                :expanded="railCollapsed ? undefined : expanded.has(RECENTS_GROUP)"
                aria-controls="sidebar-children-recents"
                data-test="sidebar-item-recents"
                @toggle="toggleGroup(RECENTS_GROUP)"
              />
              <div
                id="sidebar-children-recents"
                class="grid transition-[grid-template-rows,opacity] duration-[220ms,150ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
                :class="
                  !railCollapsed && expanded.has(RECENTS_GROUP)
                    ? 'grid-rows-[1fr] opacity-100'
                    : 'grid-rows-[0fr] opacity-0'
                "
                :inert="railCollapsed || !expanded.has(RECENTS_GROUP)"
                :aria-hidden="railCollapsed || !expanded.has(RECENTS_GROUP) ? true : undefined"
                data-test="sidebar-children-recents"
              >
                <div
                  class="before:bg-text-secondary/25 relative flex min-h-0 flex-col gap-0.5 overflow-hidden before:absolute before:inset-y-0.5 before:start-4 before:w-px"
                >
                  <OSidebarItem
                    v-for="recent in recents"
                    :key="recent.key"
                    sub
                    :label="recent.label"
                    :hint="recent.group"
                    :to="recent.to"
                    :data-test="`sidebar-recent-${recent.key}`"
                  />
                </div>
              </div>
            </template>
          </div>
        </template>
      </div>

      <div class="border-border-default mx-2 flex shrink-0 flex-col gap-0.5 border-t pt-2 pb-2">
        <OSidebarItem
          v-for="row in bottomSection && !loading ? bottomSection.rows : []"
          :key="row.entry.item.name"
          :label="row.entry.item.title"
          :icon="iconFor(row.entry.item)"
          :to="linkTo(row.group ? row.group.tileLink : row.entry.item.link)"
          :active="row.group ? row.group.activeKey !== null : linkActive(row.entry.item)"
          :collapsed="railCollapsed"
          :locked="row.entry.item.locked"
          :license-locked="row.entry.item.licenseLocked"
          :paywalled="isPaywalled(row.entry.item.link)"
          :data-test="`sidebar-item-${row.entry.item.name}`"
        />
        <button
          v-if="collapsible"
          type="button"
          class="group/nav rounded-default text-text-body hover:bg-dropdown-item-hover-bg focus-visible:ring-accent text-compact mt-0.5 flex h-7 w-full min-w-9 cursor-pointer items-center gap-2.5 overflow-hidden border-0 bg-transparent px-2 text-start [font-family:inherit] font-normal transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset motion-reduce:transition-none"
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
            :class="railCollapsed ? 'opacity-0' : 'opacity-100'"
            :aria-hidden="railCollapsed ? true : undefined"
            >{{
              collapsed
                ? t("components.sidebar.expandShort")
                : t("components.sidebar.collapseShort")
            }}</span
          >
          <OTooltip :content="toggleLabel" shortcut="[" :side="railCollapsed ? 'right' : 'top'" />
        </button>
      </div>
    </nav>
  </div>
</template>
