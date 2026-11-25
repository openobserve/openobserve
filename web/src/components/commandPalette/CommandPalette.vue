<script setup lang="ts">
import { computed, onMounted, onScopeDispose, nextTick, ref, toRef, watch } from "vue";
import { RouterLink, useRouter, type NavigationFailure, type RouteLocationRaw } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { NavItem } from "@/lib/core/Navbar/ONavbar.types";
import { useNavGateContext } from "@/lib/core/Navbar/useNavGateContext";
import { buildFeatureGateContext } from "@/utils/enterpriseFeatures";
import { RESOURCE_KINDS, type ResourceKind } from "@/ts/interfaces/resources";
import { palettePages } from "./palettePages";
import { useResourceSearch, retryable } from "./useResourceSearch";
import { resourceRoute, creationRoute, recentVisitRoute, markStreamPick } from "./resourceRoutes";
import { useRecentlyViewed } from "./useRecentlyViewed";
import { KIND_LABELS, KIND_ICONS, enabledResourceKinds } from "./presentation";

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
const type = ref<ResourceKind | "all">("all");
const activeKey = ref<string | null>(null);
const offline = ref(!navigator.onLine);
const openVersion = ref(0);
const typeStrip = ref<{ $el: HTMLElement } | null>(null);
const typeViewport = computed(() => typeStrip.value?.$el ?? null);
// A vertical wheel or a mouse drag over the type row scrolls it sideways.
function onTypeWheel(event: WheelEvent) {
  const strip = typeViewport.value;
  if (!strip || strip.scrollWidth <= strip.clientWidth) return;
  if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
  event.preventDefault();
  strip.scrollLeft += event.deltaY * (getComputedStyle(strip).direction === "rtl" ? -1 : 1);
}
let typeDrag: { x: number; left: number; moved: boolean } | null = null;
function onTypeDrag(event: PointerEvent) {
  const strip = typeViewport.value;
  if (!strip || !typeDrag) return;
  const delta = event.clientX - typeDrag.x;
  if (!typeDrag.moved && Math.abs(delta) < 4) return;
  typeDrag.moved = true;
  strip.scrollLeft = typeDrag.left - delta;
}
function endTypeDrag() {
  window.removeEventListener("pointermove", onTypeDrag);
  // The click that ends a drag lands after pointerup, so the flag must outlive this event.
  setTimeout(() => (typeDrag = null));
}
function onTypePointerDown(event: PointerEvent) {
  const strip = typeViewport.value;
  if (!strip || event.pointerType !== "mouse" || event.button !== 0) return;
  typeDrag = { x: event.clientX, left: strip.scrollLeft, moved: false };
  window.addEventListener("pointermove", onTypeDrag);
  window.addEventListener("pointerup", endTypeDrag, { once: true });
}
function onTypeClick(event: MouseEvent) {
  if (!typeDrag?.moved) return;
  event.preventDefault();
  event.stopPropagation();
}
onScopeDispose(() => {
  window.removeEventListener("pointermove", onTypeDrag);
  window.removeEventListener("pointerup", endTypeDrag);
});
const search = useResourceSearch({
  open: toRef(props, "open"),
  org,
  subject,
  query,
  type,
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
interface Entry {
  id: string;
  name: I18nText;
  route: RouteLocationRaw;
  sub?: string;
  locked?: boolean;
  licenseLocked?: boolean;
}
const pageEntries = computed<Entry[]>(() =>
  type.value === "all"
    ? pages.value
        .filter((p) => fold(`${p.name} ${p.id}`).includes(fold(query.value.trim())))
        .slice(0, 5)
    : [],
);
const actionEntries = computed<Entry[]>(() => {
  if (type.value !== "all") return [];
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
    }))
    .filter((e) => fold(`${e.name} ${e.id}`).includes(fold(query.value.trim())));
});
const recentEntries = computed<Entry[]>(() =>
  !query.value.trim() && type.value === "all"
    ? history.items.value.flatMap((item) => {
        const route = recentVisitRoute(item, org.value);
        return route ? [{ id: `recent:${item.kind}:${item.id}`, name: raw(item.name), route }] : [];
      })
    : [],
);
const groups = computed(() =>
  peerKinds.value
    .map((kind) => {
      const all = search.data.value?.hits.filter((hit) => hit.type === kind) ?? [];
      const source = search.data.value?.sources.find((s) => s.type === kind);
      const entries: Entry[] = all.slice(0, type.value === "all" ? 3 : undefined).flatMap((hit) => {
        const route = resourceRoute(hit, org.value);
        return route
          ? [
              {
                id: `${kind}:${hit.id}`,
                name: raw(hit.name),
                route,
                sub: hit.folder_name || hit.id,
              },
            ]
          : [];
      });
      return { kind, entries, source };
    })
    .filter((g) => g.entries.length || (!!g.source && retryable(g.source))),
);
const entries = computed(() => [
  ...recentEntries.value,
  ...pageEntries.value,
  ...actionEntries.value,
  ...groups.value.flatMap((g) => g.entries),
]);
const optionId = (entry: Entry) => `command-palette-option-${encodeURIComponent(entry.id)}`;
const activeId = computed(() => {
  const entry = entries.value.find((entry) => entry.id === activeKey.value);
  return entry ? optionId(entry) : undefined;
});
const incomplete = computed(() => search.data.value?.sources.some(retryable));
const localGroups = computed(() =>
  [
    { id: "recent", label: t("commandPalette.recent"), entries: recentEntries.value },
    { id: "pages", label: t("commandPalette.pages"), entries: pageEntries.value },
    { id: "actions", label: t("commandPalette.actions"), entries: actionEntries.value },
  ].filter((g) => g.entries.length),
);
// Clicking the selected type clears it, which searches every type again.
function setType(value: unknown) {
  type.value = RESOURCE_KINDS.find((kind) => kind === value) ?? "all";
}
function onKeydown(event: KeyboardEvent) {
  if (event.isComposing || !["INPUT", "TEXTAREA"].includes((event.target as HTMLElement)?.tagName))
    return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const selectable = entries.value.filter((entry) => !entry.locked);
    const count = selectable.length;
    const index = selectable.findIndex((entry) => entry.id === activeKey.value);
    if (count)
      activeKey.value =
        selectable[(Math.max(0, index) + (event.key === "ArrowDown" ? 1 : count - 1)) % count].id;
    document.getElementById(activeId.value ?? "")?.scrollIntoView({ block: "nearest" });
  } else if (event.key === "Enter" && activeId.value) {
    event.preventDefault();
    document.getElementById(activeId.value)?.click();
  }
}
// Not mouseenter: it also fires when scrolling or a resize moves rows under a still pointer.
function hover(entry: Entry) {
  if (!entry.locked) activeKey.value = entry.id;
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
      type.value = "all";
      activeKey.value = null;
      openVersion.value += 1;
    }
  },
);
watch([query, type, org, subject], () => {
  activeKey.value = null;
});
watch(type, async () => {
  await nextTick();
  typeViewport.value
    ?.querySelector<HTMLElement>(`[data-test="command-type-${type.value}"]`)
    ?.scrollIntoView({ block: "nearest", inline: "nearest" });
});
watch(
  entries,
  (items) => {
    if (!items.some((entry) => entry.id === activeKey.value && !entry.locked))
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
    size="lg"
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
        aria-haspopup="listbox"
        :aria-expanded="open"
        aria-controls="command-palette-results"
        :aria-activedescendant="activeId"
        data-test="command-palette-input"
        @keydown="onKeydown"
      />
      <div
        class="min-w-0"
        @wheel="onTypeWheel"
        @pointerdown="onTypePointerDown"
        @click.capture="onTypeClick"
      >
        <OToggleGroup
          ref="typeStrip"
          :model-value="type"
          deselectable
          class="max-w-full overflow-x-auto"
          @update:model-value="setType"
        >
          <OToggleGroupItem
            v-for="kind in peerKinds"
            :key="kind"
            :value="kind"
            size="sm"
            :icon-left="KIND_ICONS[kind]"
            :data-test="`command-type-${kind}`"
            >{{ t(KIND_LABELS[kind]) }}</OToggleGroupItem
          >
        </OToggleGroup>
      </div>
      <OText v-if="offline" role="status" variant="meta">{{ t("commandPalette.offline") }}</OText>
      <OText v-if="history.storageFailed.value" role="status" variant="meta">{{
        t("commandPalette.historyStorageUnavailable")
      }}</OText>
      <div
        id="command-palette-results"
        role="listbox"
        :aria-label="t('commandPalette.title')"
        class="flex max-h-[60vh] min-h-0 flex-col gap-3 overflow-y-auto"
        data-test="command-palette-results"
      >
        <section
          v-for="group in localGroups"
          :key="group.id"
          :aria-label="group.label"
          role="group"
          class="flex flex-col gap-1"
        >
          <div class="flex items-center justify-between gap-2">
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
            <OButton
              as="a"
              :href="href"
              :id="optionId(entry)"
              role="option"
              :aria-selected="optionId(entry) === activeId"
              :active="optionId(entry) === activeId"
              :disabled="entry.locked"
              variant="ghost"
              class="justify-start text-start"
              block
              :data-test="`command-entry-${entry.id}`"
              @pointermove="hover(entry)"
              @click="navigate($event, go, entry.route)"
              ><OTruncatedText>{{ entry.name }}</OTruncatedText
              ><OIcon v-if="entry.locked || entry.licenseLocked" name="lock" size="xs"
            /></OButton>
          </RouterLink>
        </section>
        <section
          v-for="group in groups"
          :key="group.kind"
          :aria-label="t(KIND_LABELS[group.kind])"
          role="group"
          class="flex flex-col gap-1"
        >
          <OText variant="meta">{{ t(KIND_LABELS[group.kind]) }}</OText>
          <RouterLink
            v-for="entry in group.entries"
            :key="entry.id"
            :to="entry.route"
            custom
            v-slot="{ href, navigate: go }"
            ><OButton
              as="a"
              :href="href"
              :id="optionId(entry)"
              role="option"
              :aria-selected="optionId(entry) === activeId"
              :active="optionId(entry) === activeId"
              variant="ghost"
              class="justify-start text-start"
              block
              :data-test="`command-entry-${entry.id}`"
              @pointermove="hover(entry)"
              @click="navigate($event, go, entry.route)"
              ><OTruncatedText class="min-w-0 flex-1">{{ entry.name }}</OTruncatedText
              ><OTruncatedText
                class="max-w-48 text-xs max-md:max-w-24"
                :class="{ 'text-text-secondary': optionId(entry) !== activeId }"
                >{{ entry.sub }}</OTruncatedText
              ></OButton
            ></RouterLink
          >
          <OText v-if="group.source?.status !== 'complete'" variant="meta" role="status">{{
            group.source?.reason === "loading"
              ? t("commandPalette.loading")
              : group.source?.status === "partial"
                ? t("commandPalette.partial")
                : t("commandPalette.sourceUnavailable")
          }}</OText>
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
          :title="query || type !== 'all' ? t('common.noMatches') : t('commandPalette.emptyHelp')"
        />
      </div>
      <OText
        v-if="search.pending.value"
        variant="meta"
        role="status"
        data-test="command-search-loading"
        >{{ t("commandPalette.loading") }}</OText
      >
      <div
        v-if="search.error.value || incomplete"
        class="flex flex-wrap items-center gap-2"
        role="status"
      >
        <OText variant="meta">{{
          search.error.value ? t("commandPalette.failed") : t("commandPalette.partial")
        }}</OText
        ><OButton
          variant="secondary"
          size="sm"
          @click="incomplete ? search.retryFailed() : search.refetch()"
          >{{ t("common.retry") }}</OButton
        >
      </div>
    </div>
  </ODialog>
</template>
