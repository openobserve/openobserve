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

import { computed, watch } from "vue";

import { useOrgHasUserData } from "@/composables/useOrgHasUserData";
import { useOrgHasNoResources } from "@/composables/useOrgResources";

import type { FindMoreItem, FindMoreSource } from "./findMore";
import { packs as allPacks, packTitle } from "./usePackCatalog";
import type { PackItemKind, StarterPack } from "./types";
import { useBrowserMatches, type BrowserInterrupted } from "./useBrowserMatches";
import { useStarterPackPopup } from "./useStarterPackPopup";

const FIT_KINDS = new Set<PackItemKind>(["dashboard", "alert", "savedView"]);

export type HomePackView =
  "loading" | "interrupted" | "installed" | "error" | "forbidden" | "offer" | "empty";

/** One pack's state on Home. */
function useHomePack(org: string, pack: StarterPack, active: () => boolean) {
  const title = packTitle(pack);
  const popup = useStarterPackPopup(org);
  // The popup's own pack state, so a setup started from Home shows in the header at once.
  const { flow, matcher } = popup.entryOf(pack);
  // Kubernetes keeps the original ids, so existing tests still find its elements.
  const testId = (id: string) =>
    pack.id === "kubernetes" ? id : id.replace("home-pack", `home-pack-${pack.id}`);

  let loadAsked = false;
  watch(
    active,
    (on) => {
      if (!on || loadAsked) return;
      loadAsked = true;
      void flow.load();
    },
    { immediate: true },
  );

  // Home is the busiest page, so only a user who can reach the offer pays for the check.
  const wantsMatch = computed(() => active() && flow.loaded.value && !flow.record.value);
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
    if (!flow.loaded.value) return "loading";
    if (flow.interrupted.value) return "interrupted";
    if (flow.record.value && !flow.running.value) return "installed";
    // A role refused the pack's reads is often refused the match's too, and Retry cannot fix that.
    if (flow.forbidden.value || matcher.forbidden.value) return "forbidden";
    if (flow.loadFailed.value || matcher.state.value === "error") return "error";
    if (matcher.state.value === "checking") return "loading";
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
  const openDetails = openPack;

  return {
    pack,
    title,
    testId,
    flow,
    matcher,
    view,
    startSetup,
    retry,
    openDetails,
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
      }));
  }
  return [
    ...pack.dashboards.map(({ id, title }) => ({
      kind: "dashboard" as const,
      id,
      name: title,
    })),
    ...pack.alerts.map((id) => ({ kind: "alert" as const, id, name: id })),
    ...pack.savedViews.map(({ id, name }) => ({
      kind: "savedView" as const,
      id,
      name,
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
});

const interruptedOf = (item: HomePack): BrowserInterrupted => ({
  packId: item.pack.id,
  label: item.title,
  done: item.flow.made.value.length,
  total: item.flow.toCreate.value.length,
});

/** Every pack Home offers; `active` false (an org past onboarding) starts no pack reads. */
export function useHomePacks(
  org: string,
  packs: StarterPack[] = allPacks(),
  active: () => boolean = () => true,
  // A surface reading only some packs must not overwrite the org's saved copy with that subset.
  { save = true }: { save?: boolean } = {},
) {
  const items = packs.map((pack) => useHomePack(org, pack, active));
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
  const offerable = computed(() => orgEmpty.value && !anySetUp.value);
  // Covers whatever `answered` waits for once a pack is offered, so the strip replaces it with no gap.
  const loading = computed(() => offerable.value && anyLoading.value);
  // Waits for every pack, so no card moves once the strip shows.
  const answered = computed(() => offerable.value && !anyLoading.value && offered.value.length > 0);
  const showSection = computed(() => answered.value && canCreate.value);
  const askAdmin = computed(() => answered.value && !canCreate.value);
  const offerShown = computed(() => loading.value || showSection.value);
  // A stopped setup is said in any org; the rest only belongs next to an offer.
  const notices = computed(() =>
    items.filter(
      (item) =>
        item.view.value === "interrupted" || (orgEmpty.value && item.view.value === "error"),
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
      if (!state || !save) return;
      const { sources, installed, interrupted } = JSON.parse(state);
      browser.saveBuiltIn(sources, installed, interrupted);
    },
    { immediate: true },
  );

  return {
    items,
    offerable,
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
