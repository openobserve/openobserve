// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { computed, ref, watch } from "vue";

import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18nTyped } from "@/types/i18n";
import { useOrgHasUserData } from "@/composables/useOrgHasUserData";
import { useOrgHasNoResources } from "@/composables/useOrgResources";

import type { FindMoreItem, FindMoreSource } from "./findMore";
import { packs as allPacks, packTitle } from "./usePackCatalog";
import { usePackDismissal, usePackHiddenForOrg } from "./packDismissal";
import type { PackItemKind, StarterPack } from "./types";
import { useBrowserMatches, type BrowserInterrupted } from "./useBrowserMatches";
import { useStarterPackPopup } from "./useStarterPackPopup";

const FIT_KINDS = new Set<PackItemKind>(["dashboard", "alert", "savedView"]);

export type HomePackView =
  | "hidden"
  | "hiddenAdmin"
  | "loading"
  | "dismissed"
  | "interrupted"
  | "installed"
  | "error"
  | "forbidden"
  | "offer"
  | "empty";

/** One pack's state on Home. */
function useHomePack(org: string, pack: StarterPack) {
  const { t } = useI18nTyped();
  const title = packTitle(pack);
  const popup = useStarterPackPopup(org);
  // The popup's own pack state, so a setup started from Home shows in the header at once.
  const { flow, matcher } = popup.entryOf(pack);
  const dismissal = usePackDismissal("home", org, pack.id);
  const orgHide = usePackHiddenForOrg(org, pack.id);
  const undoOpen = ref(false);
  // Kubernetes keeps the original ids, so existing tests still find its elements.
  const testId = (id: string) =>
    pack.id === "kubernetes" ? id : id.replace("home-pack", `home-pack-${pack.id}`);

  void flow.load();
  void orgHide.load();

  // Home is the busiest page, so only a user who can reach the offer pays for the check.
  const wantsMatch = computed(
    () =>
      flow.loaded.value &&
      orgHide.loaded.value &&
      !flow.record.value &&
      !dismissal.dismissed.value &&
      !orgHide.hidden.value,
  );
  watch(
    wantsMatch,
    (wanted) => {
      if (wanted) void matcher.checkShared();
    },
    { immediate: true },
  );
  watch(matcher.state, (state) => {
    if (state === "matched") void flow.loadPreview();
  });

  const view = computed<HomePackView>(() => {
    if (!flow.loaded.value || !orgHide.loaded.value) return "loading";
    if (flow.interrupted.value) return "interrupted";
    if (flow.record.value && !flow.running.value) return "installed";
    if (dismissal.dismissed.value) return "dismissed";
    if (orgHide.hidden.value) return flow.isAdmin.value ? "hiddenAdmin" : "hidden";
    if (flow.loadFailed.value || matcher.state.value === "error") return "error";
    if (matcher.state.value === "checking") return "loading";
    if (flow.forbidden.value) return "forbidden";
    if (matcher.state.value === "matched") return "offer";
    return "empty";
  });

  // Install starts only from the popup's own button, after the user has seen and chosen the items.
  const openPack = () => {
    void matcher.checkShared();
    void popup.openWhenReady({ pack, flow, matcher });
  };
  const startSetup = openPack;
  const retry = () => Promise.all([flow.load(), matcher.retry()]);
  const setHidden = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch {
      toast({ variant: "error", message: t("starterPacks.home.hideFailed") });
    }
  };
  const openDetails = openPack;
  const openUndo = () => (undoOpen.value = true);

  return {
    pack,
    title,
    testId,
    flow,
    matcher,
    dismissal,
    orgHide,
    view,
    undoOpen,
    startSetup,
    retry,
    setHidden,
    openDetails,
    openUndo,
  };
}

export type HomePack = ReturnType<typeof useHomePack>;
/** What a pack row reads, so a page with its own pack state can show the same row. */
export type HomePackRowItem = Pick<
  HomePack,
  "pack" | "title" | "testId" | "flow" | "matcher" | "view" | "startSetup"
>;

const matchItems = (item: HomePack): FindMoreItem[] => {
  const { flow, pack } = item;
  const preview = flow.preview.value;
  if (preview) {
    return preview.items
      .filter(({ kind, status }) => FIT_KINDS.has(kind) && status !== "existing")
      .map(({ kind, itemId }) => ({
        kind: kind as FindMoreItem["kind"],
        id: itemId,
        name: flow.nameOf(itemId),
        queries: 0,
      }));
  }
  return [
    ...pack.dashboards.map(({ id, title }) => ({
      kind: "dashboard" as const,
      id,
      name: title,
      queries: 0,
    })),
    ...pack.alerts.map((id) => ({ kind: "alert" as const, id, name: id, queries: 0 })),
    ...pack.savedViews.map(({ id, name }) => ({
      kind: "savedView" as const,
      id,
      name,
      queries: 0,
    })),
  ];
};

// Same shape as a pack source from groupFindMore, so the header chip reads both alike.
export const matchSource = (item: HomePack): FindMoreSource => ({
  id: item.pack.id,
  packId: item.pack.id,
  label: item.pack.id,
  streams: [...item.matcher.streams.value],
  items: matchItems(item),
  queriesPerDay: 0,
});

const interruptedOf = (item: HomePack): BrowserInterrupted => ({
  packId: item.pack.id,
  label: item.title,
  done: item.flow.made.value.length,
  total: item.flow.toCreate.value.length,
});

const NOTICE_VIEWS: HomePackView[] = ["hiddenAdmin", "dismissed", "error"];

/** Every pack Home offers, plus whether Home shows the setup section. */
export function useHomePacks(org: string, packs: StarterPack[] = allPacks()) {
  const items = packs.map((pack) => useHomePack(org, pack));
  const { hasUserData } = useOrgHasUserData(org);
  const { noResources } = useOrgHasNoResources(org, () => hasUserData.value === true);
  const browser = useBrowserMatches(org);

  // An unknown answer counts as not empty, so a slow or failed check never shows the offer.
  const orgEmpty = computed(() => hasUserData.value === true && noResources.value);
  const anySetUp = computed(() => items.some((item) => item.view.value === "installed"));
  const offered = computed(() =>
    items.filter((item) => item.view.value === "offer" || item.view.value === "forbidden"),
  );
  const setUp = computed(() => items.filter((item) => item.view.value === "installed"));
  const anyLoading = computed(() => items.some((item) => item.view.value === "loading"));
  const canCreate = computed(
    () => !offered.value.length || offered.value.some((item) => item.view.value === "offer"),
  );
  // A dismissed pack is known at once, so its record read never holds a skeleton over Overview.
  const offerLoading = computed(() =>
    items.some((item) => item.view.value === "loading" && !item.dismissal.dismissed.value),
  );
  const offerable = computed(() => orgEmpty.value && !anySetUp.value);
  // Covers whatever `answered` waits for once a pack is offered, so the strip replaces it with no gap.
  const loading = computed(
    () => offerable.value && anyLoading.value && (offerLoading.value || offered.value.length > 0),
  );
  // Waits for every pack, so no card moves once the strip shows.
  const answered = computed(() => offerable.value && !anyLoading.value && offered.value.length > 0);
  const showSection = computed(() => answered.value && canCreate.value);
  const askAdmin = computed(() => answered.value && !canCreate.value);
  const offerShown = computed(() => loading.value || showSection.value);
  // A stopped setup is said in any org; the rest only belongs next to an offer.
  const notices = computed(() =>
    items.filter(
      (item) =>
        item.view.value === "interrupted" ||
        (orgEmpty.value && NOTICE_VIEWS.includes(item.view.value)),
    ),
  );
  const labelShown = computed(() => offerShown.value || askAdmin.value || notices.value.length > 0);

  // Saved only once every pack answered, so a failed read keeps the last good copy.
  const settled = computed(
    () =>
      !anyLoading.value &&
      items.every((item) => !item.flow.running.value && item.view.value !== "error"),
  );
  // Serialized, so a re-render that changes nothing does not rewrite the browser copy.
  const builtIn = computed(() => {
    if (!settled.value) return null;
    const interrupted = items.find((item) => item.flow.interrupted.value);
    return JSON.stringify({
      sources: offered.value.map(matchSource),
      installed: setUp.value.map((item) => item.pack.id),
      interrupted: interrupted ? interruptedOf(interrupted) : null,
    });
  });
  watch(
    builtIn,
    (state) => {
      if (!state) return;
      const { sources, installed, interrupted } = JSON.parse(state);
      browser.saveBuiltIn(sources, installed, interrupted);
    },
    { immediate: true },
  );

  return {
    items,
    offered,
    setUp,
    showSection,
    askAdmin,
    offerShown,
    notices,
    labelShown,
    loading,
  };
}

export type HomePacks = ReturnType<typeof useHomePacks>;
