<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, toRef, watch } from "vue";
import { RouterLink, useRouter, type NavigationFailure, type RouteLocationRaw } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OListboxOption from "@/lib/navigation/Listbox/OListboxOption.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { NavItem } from "@/lib/core/Navbar/ONavbar.types";
import { useNavGateContext } from "@/lib/core/Navbar/useNavGateContext";
import { buildFeatureGateContext } from "@/utils/enterpriseFeatures";
import type { ResourceKind, ResourceSearchResponse } from "@/ts/interfaces/resources";
import { palettePages } from "./palettePages";
import { useResourceSearch, retryable } from "./useResourceSearch";
import { resourceRoute, creationRoute, recentVisitRoute, markStreamPick } from "./resourceRoutes";
import { useRecentlyViewed } from "./useRecentlyViewed";
import { KIND_LABELS, KIND_ICONS, enabledResourceKinds } from "./presentation";
import useBreakpoint from "@/composables/useBreakpoint";

const props = defineProps<{ open: boolean; links: NavItem[]; flat?: boolean }>();
const emit = defineEmits<{ (_e: "update:open", _open: boolean): void }>();
const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const subject = computed<string>(() => store.state.userInfo?.email ?? "");
const deployment = computed<string>(() => store.state.API_ENDPOINT || window.location.origin);
const history = useRecentlyViewed({ deployment, subject, org });
const gate = useNavGateContext();
const peerKinds = computed(() =>
  enabledResourceKinds(
    (name) => router.hasRoute(name),
    gate.value,
    !!store.state.zoConfig?.synthetics_enabled,
  ),
);
const query = ref("");
const picked = ref<ResourceKind[]>([]);
const filtering = computed(() => picked.value.length > 0);
const activeKey = ref<string | null>(null);
// Set once the keyboard or pointer moves the highlight; new text or types hand it back to the first row.
const chosen = ref(false);
const offline = ref(!navigator.onLine);
const openVersion = ref(0);
const search = useResourceSearch({
  open: toRef(props, "open"),
  org,
  subject,
  query,
  picked,
  kinds: peerKinds,
});
const pages = computed(() =>
  palettePages(
    props.links,
    !!props.flat,
    gate.value,
    buildFeatureGateContext(store.state.zoConfig),
    router,
    org.value,
    t,
  ),
);
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const matches = (text: string) => fold(text).includes(fold(query.value.trim()));
interface Entry {
  id: string;
  name: I18nText;
  route: RouteLocationRaw;
  icon: IconName;
  sub?: string;
  locked?: boolean;
  licenseLocked?: boolean;
}
const pageMatches = computed<Entry[]>(() =>
  pages.value.filter((p) => matches(`${p.name} ${p.id}`)),
);
const pageEntries = computed(() => (filtering.value ? [] : pageMatches.value.slice(0, 5)));
const actionMatches = computed<Entry[]>(() => {
  void openVersion.value;
  const kinds = ["dashboard", "alert", "function", "pipeline"] as const;
  const routeNames = {
    dashboard: "dashboards",
    alert: "alertList",
    function: "functionList",
    pipeline: "pipelines",
  };
  const labels = {
    dashboard: t("dashboard.add"),
    alert: t("alerts.add"),
    function: t("function.add"),
    pipeline: t("pipeline.addPipeline"),
  };
  return kinds
    .filter((kind) =>
      pages.value.some(
        (p) => p.id.startsWith(`${routeNames[kind]}:`) && !p.locked && !p.licenseLocked,
      ),
    )
    .map((kind) => ({
      id: `create:${kind}`,
      name: labels[kind],
      route: creationRoute(kind, org.value),
      icon: "add" as const,
    }))
    .filter((e) => matches(`${e.name} ${e.id}`));
});
const actionEntries = computed(() => (filtering.value ? [] : actionMatches.value));
const recentEntries = computed<Entry[]>(() =>
  !query.value.trim() && !filtering.value
    ? history.items.value.flatMap((item) => {
        const route = recentVisitRoute(item, org.value);
        const icon =
          item.kind === "page"
            ? (pages.value.find((p) => p.id === `${item.id}:`)?.icon ?? "history")
            : KIND_ICONS[item.kind];
        return route
          ? [{ id: `recent:${item.kind}:${item.id}`, name: raw(item.name), route, icon }]
          : [];
      })
    : [],
);
const groups = computed(() =>
  peerKinds.value
    .filter((kind) => !filtering.value || picked.value.includes(kind))
    .map((kind) => {
      const all = results.value?.hits.filter((hit) => hit.type === kind) ?? [];
      const source = results.value?.sources.find((s) => s.type === kind);
      const entries: Entry[] = all.slice(0, filtering.value ? undefined : 3).flatMap((hit) => {
        const route = resourceRoute(hit, org.value);
        return route
          ? [
              {
                id: `${kind}:${hit.id}`,
                name: raw(hit.name),
                route,
                icon: KIND_ICONS[kind],
                sub: hit.folder_name || hit.id,
              },
            ]
          : [];
      });
      return { kind, entries, source, capped: filtering.value && !!source?.has_more };
    })
    .filter((g) => g.entries.length || (!!g.source && retryable(g.source))),
);
const localGroups = computed(() =>
  [
    { id: "recent", label: t("commandPalette.recent"), entries: recentEntries.value },
    { id: "pages", label: t("commandPalette.pages"), entries: pageEntries.value },
    { id: "actions", label: t("commandPalette.actions"), entries: actionEntries.value },
  ].filter((g) => g.entries.length),
);
// Display order, one list per section, for the arrow and page keys.
const sections = computed(() => [
  ...localGroups.value.map((g) => g.entries),
  ...groups.value.map((g) => g.entries),
]);
const entries = computed(() => sections.value.flat());
const optionId = (entry: Entry) => `command-palette-option-${encodeURIComponent(entry.id)}`;
const activeId = computed(() => {
  const entry = entries.value.find((entry) => entry.id === activeKey.value);
  return entry ? optionId(entry) : undefined;
});
const incomplete = computed(() => search.data.value?.sources.some(retryable));
const { isMobile } = useBreakpoint();
// Phones get no key hints, so their footer appears only to offer a retry.
const showFooter = computed(() => !isMobile.value || !!search.error.value || !!incomplete.value);

// The last answer for this query keeps the counts on screen while the next keystroke is debounced.
const counted = ref<ResourceSearchResponse | null>(null);
const hasQuery = computed(() => !!query.value.trim());
watch(
  () => search.data.value,
  (data) => {
    if (data && hasQuery.value) counted.value = data;
  },
);
watch([hasQuery, org, subject], () => {
  if (!hasQuery.value) counted.value = null;
});
// Between keystrokes the last answer stays up, narrowed to the new text, so the list never empties and refills.
const held = ref<ResourceSearchResponse | null>(null);
watch(
  () => search.data.value,
  (data) => {
    if (data) held.value = data;
  },
);
watch([org, subject], () => {
  held.value = null;
});
const results = computed<ResourceSearchResponse | undefined>(() => {
  if (search.data.value) return search.data.value;
  if (!held.value || search.error.value || (!hasQuery.value && !filtering.value)) return undefined;
  const text = fold(query.value.trim());
  const hits = held.value.hits.filter((hit) =>
    fold(`${hit.name} ${hit.id} ${hit.folder_name ?? ""}`).includes(text),
  );
  return { ...held.value, hits };
});
// Only the first answer has nothing to hold, so placeholder rows keep its place instead.
const awaitingFirst = computed(
  () => !results.value && (hasQuery.value || filtering.value) && search.pending.value,
);
function kindCount(kind: ResourceKind) {
  const source = counted.value?.sources.find((s) => s.type === kind);
  if (!counted.value || !source || source.status === "unavailable") return null;
  const found = counted.value.hits.filter((hit) => hit.type === kind).length;
  return { found, more: !!source.has_more };
}
const countLabel = (count: { found: number; more: boolean } | null) =>
  count ? (count.more ? raw(`${count.found}+`) : count.found) : "—";
const typeChips = computed<StatItem[]>(() => {
  const counts = peerKinds.value.map((kind) => ({ kind, count: kindCount(kind) }));
  const known = counts.flatMap(({ count }) => (count ? [count] : []));
  const local = pageMatches.value.length + actionMatches.value.length;
  const total = known.length
    ? {
        found: known.reduce((sum, count) => sum + count.found, local),
        more: known.some((count) => count.more),
      }
    : null;
  return [
    {
      key: "all",
      label: t("commandPalette.allTypes"),
      value: countLabel(total),
      dataTest: "command-type-all",
    },
    ...counts.map(({ kind, count }) => ({
      key: kind,
      label: t(KIND_LABELS[kind]),
      icon: KIND_ICONS[kind],
      value: countLabel(count),
      dataTest: `command-type-${kind}`,
    })),
  ];
});

// Kept in pick order, so Backspace drops the latest pick; result groups keep their own order.
function setTypes(keys: string[]) {
  picked.value = keys.flatMap((key) => peerKinds.value.filter((kind) => kind === key));
}
const inputElement = () =>
  document.querySelector<HTMLInputElement>('input[aria-controls="command-palette-results"]');
function activate(entry: Entry | undefined) {
  if (!entry) return;
  activeKey.value = entry.id;
  document.getElementById(optionId(entry))?.scrollIntoView({ block: "nearest" });
}
function step(direction: 1 | -1) {
  const selectable = entries.value.filter((entry) => !entry.locked);
  const count = selectable.length;
  if (!count) return;
  const index = selectable.findIndex((entry) => entry.id === activeKey.value);
  const start = index < 0 ? (direction === 1 ? -1 : 0) : index;
  activate(selectable[(start + direction + count) % count]);
  chosen.value = true;
}
function jumpSection(direction: 1 | -1) {
  const lists = sections.value
    .map((list) => list.filter((entry) => !entry.locked))
    .filter((list) => list.length);
  if (!lists.length) return;
  const current = lists.findIndex((list) => list.some((entry) => entry.id === activeKey.value));
  const atStart = current >= 0 && lists[current][0].id === activeKey.value;
  const target =
    direction === 1
      ? Math.min(current + 1, lists.length - 1)
      : Math.max(atStart || current < 0 ? current - 1 : current, 0);
  activate(lists[target][0]);
  chosen.value = true;
}
function openActive(newTab: boolean) {
  const option = activeId.value ? document.getElementById(activeId.value) : null;
  if (!option) return;
  const href = option.getAttribute("href");
  if (!newTab) option.click();
  else if (href) window.open(href, "_blank", "noopener");
}
const isPlain = (event: KeyboardEvent) =>
  !event.altKey && !event.shiftKey && !event.metaKey && !event.ctrlKey;
const isTyping = (event: KeyboardEvent) =>
  event.key.length === 1 && event.key !== " " && !event.altKey && !event.metaKey && !event.ctrlKey;
// The keys the search field and the focused result list share.
function onNavigationKey(event: KeyboardEvent) {
  if ((event.key === "ArrowDown" || event.key === "ArrowUp") && isPlain(event)) {
    event.preventDefault();
    step(event.key === "ArrowDown" ? 1 : -1);
  } else if ((event.key === "PageDown" || event.key === "PageUp") && isPlain(event)) {
    event.preventDefault();
    jumpSection(event.key === "PageDown" ? 1 : -1);
  } else if (event.key === "Enter" && activeId.value) {
    event.preventDefault();
    openActive(event.metaKey || event.ctrlKey);
  } else return false;
  return true;
}
function onKeydown(event: KeyboardEvent) {
  if (event.isComposing || !["INPUT", "TEXTAREA"].includes((event.target as HTMLElement)?.tagName))
    return;
  if (onNavigationKey(event)) return;
  if (event.key === "Backspace" && isPlain(event) && !query.value && filtering.value) {
    event.preventDefault();
    picked.value = picked.value.slice(0, -1);
  }
}
const resultsRef = ref<HTMLElement | null>(null);
const typesRef = ref<HTMLElement | null>(null);
const firstSelectable = computed(() => entries.value.find((entry) => !entry.locked));
function focusResults() {
  if (!firstSelectable.value || !resultsRef.value) return inputElement()?.focus();
  resultsRef.value.focus({ preventScroll: true });
  activate(entries.value.find((entry) => entry.id === activeKey.value) ?? firstSelectable.value);
}
// The chips sit between the search field (↑) and the results (↓); Space and Enter toggle a chip.
function onTypesKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.altKey || event.metaKey || event.ctrlKey) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusResults();
  } else if (event.key === "ArrowUp" || isTyping(event)) {
    if (event.key === "ArrowUp") event.preventDefault();
    inputElement()?.focus();
  }
}
// From the list, ↑ on the first row climbs back to the chips and typing goes on in the search field.
function onResultsKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.target !== event.currentTarget) return;
  if (event.key === "ArrowUp" && isPlain(event) && activeKey.value === firstSelectable.value?.id) {
    event.preventDefault();
    typesRef.value?.querySelector<HTMLElement>('button[tabindex="0"]')?.focus();
  } else if (!onNavigationKey(event) && (isTyping(event) || event.key === "Backspace")) {
    inputElement()?.focus();
  }
}
// Not mouseenter: it also fires when scrolling or a resize moves rows under a still pointer.
function hover(entry: Entry) {
  if (entry.locked) return;
  activeKey.value = entry.id;
  chosen.value = true;
}
async function navigate(
  event: MouseEvent,
  action: (_event?: MouseEvent) => Promise<void | NavigationFailure>,
  route: RouteLocationRaw | null = null,
) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
    return;
  markStreamPick(route);
  const failure = await action(event);
  // The page reads the pick while the navigation settles, so it ends with this task.
  setTimeout(() => markStreamPick(null));
  if (!failure) emit("update:open", false);
}
watch(
  () => props.open,
  (open) => {
    if (open) {
      query.value = "";
      picked.value = [];
      activeKey.value = null;
      chosen.value = false;
      openVersion.value += 1;
      held.value = null;
    }
  },
);
watch([query, () => picked.value.join(","), org, subject], () => {
  activeKey.value = null;
  chosen.value = false;
});
// The first row stays highlighted as results change, until the keyboard or pointer picks another.
watch(
  entries,
  (items) => {
    if (!chosen.value || !items.some((entry) => entry.id === activeKey.value && !entry.locked))
      activeKey.value = items.find((entry) => !entry.locked)?.id ?? null;
  },
  { immediate: true },
);
const updateOnline = () => {
  offline.value = !navigator.onLine;
};
onMounted(() => {
  window.addEventListener("online", updateOnline);
  window.addEventListener("offline", updateOnline);
});
onScopeDispose(() => {
  window.removeEventListener("online", updateOnline);
  window.removeEventListener("offline", updateOnline);
});
</script>

<template>
  <ODialog
    :open="open"
    :aria-title="t('commandPalette.title')"
    size="md"
    :show-close="false"
    data-test="command-palette"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex min-w-0 flex-col gap-3">
      <OSearchInput
        v-model="query"
        size="md"
        :placeholder="t('commandPalette.placeholder')"
        role="combobox"
        autocomplete="off"
        aria-haspopup="listbox"
        aria-autocomplete="list"
        :aria-expanded="open"
        aria-controls="command-palette-results"
        :aria-activedescendant="activeId"
        data-test="command-palette-input"
        @keydown="onKeydown"
      />
      <div
        v-if="peerKinds.length"
        ref="typesRef"
        class="flex min-w-0"
        data-test="command-palette-types"
        @keydown="onTypesKeydown"
      >
        <OStatStrip
          :items="typeChips"
          selectable
          multiple
          compact
          dense
          roving
          :row="false"
          :hide-values="!hasQuery"
          :loading="hasQuery && search.pending.value && !counted"
          :reset-key="hasQuery ? 1 : 0"
          :selected-keys="picked"
          default-key="all"
          @update:selected-keys="setTypes"
        />
      </div>
      <OText v-if="offline" role="status" variant="meta">{{ t("commandPalette.offline") }}</OText>
      <OText v-if="history.storageFailed.value" role="status" variant="meta">{{
        t("commandPalette.historyStorageUnavailable")
      }}</OText>
      <div
        id="command-palette-results"
        ref="resultsRef"
        role="listbox"
        :tabindex="firstSelectable ? 0 : -1"
        :aria-label="t('commandPalette.title')"
        :aria-activedescendant="activeId"
        class="-mx-1 flex h-[min(26rem,55vh)] min-h-0 [scrollbar-gutter:stable] flex-col gap-3 overflow-y-auto px-1 outline-none"
        data-test="command-palette-results"
        @keydown="onResultsKeydown"
      >
        <section
          v-for="group in localGroups"
          :key="group.id"
          :aria-label="group.label"
          role="group"
          class="flex flex-col"
        >
          <div class="flex h-7 shrink-0 items-center justify-between gap-2 ps-2">
            <OText variant="meta"
              >{{ group.label
              }}<template v-if="group.id === 'recent'">
                · {{ t("commandPalette.localHistory") }}</template
              ></OText
            ><OButton
              v-if="group.id === 'recent'"
              size="xs"
              variant="ghost"
              data-test="command-clear-recent"
              @click="history.clear()"
              >{{ t("commandPalette.clearRecent") }}</OButton
            >
          </div>
          <RouterLink
            v-for="entry in group.entries"
            :key="entry.id"
            :to="entry.route"
            custom
            v-slot="{ href, navigate: go }"
          >
            <OListboxOption
              :id="optionId(entry)"
              :href="href"
              :icon="entry.icon"
              :highlighted="optionId(entry) === activeId"
              :disabled="entry.locked"
              :data-test="`command-entry-${entry.id}`"
              @pointermove="hover(entry)"
              @select="navigate($event, go, entry.route)"
              >{{ entry.name }}
              <template v-if="entry.locked || entry.licenseLocked" #trailing>
                <OIcon name="lock" size="xs" />
              </template>
            </OListboxOption>
          </RouterLink>
        </section>
        <section
          v-for="group in groups"
          :key="group.kind"
          :aria-label="t(KIND_LABELS[group.kind])"
          role="group"
          class="flex flex-col"
        >
          <div class="flex h-7 shrink-0 items-center ps-2">
            <OText variant="meta">{{ t(KIND_LABELS[group.kind]) }}</OText>
          </div>
          <RouterLink
            v-for="entry in group.entries"
            :key="entry.id"
            :to="entry.route"
            custom
            v-slot="{ href, navigate: go }"
          >
            <OListboxOption
              :id="optionId(entry)"
              :href="href"
              :icon="entry.icon"
              :highlighted="optionId(entry) === activeId"
              :data-test="`command-entry-${entry.id}`"
              @pointermove="hover(entry)"
              @select="navigate($event, go, entry.route)"
              >{{ entry.name }}
              <template v-if="entry.sub" #meta>{{ entry.sub }}</template>
            </OListboxOption>
          </RouterLink>
          <OText
            v-if="group.source?.status !== 'complete'"
            variant="meta"
            role="status"
            class="ps-2 pt-1"
            >{{
              group.source?.reason === "loading"
                ? t("commandPalette.loading")
                : group.source?.status === "partial"
                  ? t("commandPalette.partial")
                  : t("commandPalette.sourceUnavailable")
            }}</OText
          >
          <OText
            v-else-if="group.capped"
            variant="meta"
            class="ps-2 pt-1"
            data-test="command-palette-capped"
            >{{
              t("commandPalette.capped", { count: group.entries.length }, group.entries.length)
            }}</OText
          >
        </section>
        <section
          v-if="awaitingFirst"
          aria-hidden="true"
          class="flex flex-col"
          data-test="command-palette-searching"
        >
          <div class="flex h-7 shrink-0 items-center ps-2">
            <OSkeleton type="text" class="h-2.5 w-16" />
          </div>
          <div
            v-for="width in ['w-2/5', 'w-1/3', 'w-1/2', 'w-1/4']"
            :key="width"
            class="flex h-8 shrink-0 items-center gap-2 px-2"
          >
            <OSkeleton class="size-4 shrink-0" />
            <OSkeleton type="text" class="h-3" :class="width" />
          </div>
        </section>
        <OEmptyState
          v-if="
            !search.pending.value &&
            !entries.length &&
            !search.error.value &&
            !incomplete &&
            !offline
          "
          size="inline"
          class="my-auto"
          :title="hasQuery || filtering ? t('common.noMatches') : t('commandPalette.emptyHelp')"
        />
      </div>
    </div>
    <template v-if="showFooter" #footer>
      <!-- Fixed height: a status or Retry arriving with results must not move the dialog's edge. -->
      <div class="flex h-7 items-center gap-3" data-test="command-palette-footer">
        <div
          v-if="!search.error.value"
          class="flex min-w-0 items-center gap-x-3 max-md:hidden"
          data-test="command-palette-hints"
        >
          <span class="flex items-center gap-1.5">
            <OShortcut :keys="['up', 'down']" />
            <OText variant="meta">{{ t("commandPalette.hintNavigate") }}</OText>
          </span>
          <span class="flex items-center gap-1.5">
            <OShortcut keys="enter" />
            <OText variant="meta">{{ t("commandPalette.hintOpen") }}</OText>
          </span>
          <span class="flex items-center gap-1.5">
            <OShortcut keys="ctrl+enter" />
            <OText variant="meta">{{ t("commandPalette.hintNewTab") }}</OText>
          </span>
          <span class="flex items-center gap-1.5">
            <OShortcut keys="tab" />
            <OText variant="meta">{{ t("commandPalette.hintTypes") }}</OText>
          </span>
          <span class="flex items-center gap-1.5">
            <OShortcut keys="escape" />
            <OText variant="meta">{{ t("commandPalette.hintClose") }}</OText>
          </span>
        </div>
        <div class="ms-auto flex shrink-0 items-center gap-2" role="status">
          <OText v-if="search.pending.value" variant="meta" data-test="command-search-loading">{{
            t("commandPalette.loading")
          }}</OText>
          <template v-else-if="search.error.value">
            <OText variant="meta">{{ t("commandPalette.failed") }}</OText>
            <OButton
              variant="outline"
              size="xs"
              data-test="command-palette-retry"
              @click="incomplete ? search.retryFailed() : search.refetch()"
              >{{ t("common.retry") }}</OButton
            >
          </template>
          <!-- The failed types are named in the list, so a partial answer keeps the hints and offers only Retry. -->
          <OButton
            v-else-if="incomplete"
            variant="outline"
            size="xs"
            data-test="command-palette-retry"
            @click="search.retryFailed()"
            ><span class="sr-only">{{ t("commandPalette.partial") }}</span
            >{{ t("common.retry") }}<OTooltip :content="t('commandPalette.partial')"
          /></OButton>
        </div>
      </div>
    </template>
  </ODialog>
</template>
