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

import { computed, ref, watch, type InjectionKey, type ShallowRef } from "vue";
import { useRouter } from "vue-router";

import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18nTyped } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";

import { STARTER_PACKS } from "./kubernetesPack";
import { usePackDismissal, usePackHiddenForOrg } from "./packDismissal";
import type { StarterPack } from "./types";
import { useStarterPackFlow } from "./useStarterPackFlow";
import { useStarterPackMatcher } from "./useStarterPackMatcher";

type HomePackView =
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

/** One pack's state on Home, built once and shared by the section and the Overview toolbar. */
function useHomePack(org: string, pack: StarterPack) {
  const { t } = useI18nTyped();
  const title = t(pack.titleKey);
  const flow = useStarterPackFlow(org, pack);
  const matcher = useStarterPackMatcher(org, { pack });
  const dismissal = usePackDismissal("home", org, pack.id);
  const orgHide = usePackHiddenForOrg(org, pack.id);
  const drawerOpen = ref(false);
  const turnOnOpen = ref(false);
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
      if (wanted) void matcher.check();
    },
    { immediate: true },
  );
  watch(drawerOpen, (isOpen) => {
    if (isOpen && matcher.state.value === "checking") void matcher.check();
  });
  watch(
    flow.isAdmin,
    (admin) => {
      if (admin) void orgHide.loadUserCount();
    },
    { immediate: true },
  );
  watch(matcher.state, (state) => {
    if (state === "matched") void flow.loadPreview();
  });

  const canHideForAll = computed(() => flow.isAdmin.value && orgHide.sharedOrg.value);
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

  const startSetup = async () => {
    drawerOpen.value = true;
    if (await flow.install()) {
      drawerOpen.value = false;
      await flow.land();
    }
  };
  const retry = () => Promise.all([flow.load(), matcher.retry()]);
  const keepOff = async () => {
    try {
      await flow.keepOff();
    } catch {
      toast({ variant: "error", message: t("starterPacks.home.keepOffFailed") });
    }
  };
  const setHidden = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch {
      toast({ variant: "error", message: t("starterPacks.home.hideFailed") });
    }
  };
  const copyLink = () => copyToClipboard(flow.packLink(), t);
  const openDetails = () => (drawerOpen.value = true);
  const openTurnOn = () => (turnOnOpen.value = true);
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
    canHideForAll,
    drawerOpen,
    turnOnOpen,
    undoOpen,
    startSetup,
    retry,
    keepOff,
    setHidden,
    copyLink,
    openDetails,
    openTurnOn,
    openUndo,
  };
}

export type HomePack = ReturnType<typeof useHomePack>;

/** Every pack Home offers, plus whether Home shows the setup section or the toolbar menu. */
export function useHomePacks(org: string, packs: StarterPack[] = STARTER_PACKS) {
  const router = useRouter();
  const items = packs.map((pack) => useHomePack(org, pack));
  const menu = usePackDismissal("home", org, "menu");

  const anySetUp = computed(() => items.some((item) => item.view.value === "installed"));
  const offered = computed(() =>
    items.filter((item) => item.view.value === "offer" || item.view.value === "forbidden"),
  );
  const setUp = computed(() => items.filter((item) => item.view.value === "installed"));
  const anyLoading = computed(() => items.some((item) => item.view.value === "loading"));
  // Waits for every pack, so the badge never moves rows and the section never flashes before the menu.
  const showSection = computed(
    () => !anySetUp.value && !anyLoading.value && offered.value.length > 0,
  );
  const showMenu = computed(() => anySetUp.value && !menu.dismissed.value);
  const loading = computed(() => !anySetUp.value && anyLoading.value);
  // Said once for all packs, and only when none has anything else to show.
  const empty = computed(
    () =>
      items.every((item) => item.view.value === "empty" || item.view.value === "hidden") &&
      items.some((item) => item.view.value === "empty"),
  );
  const silent = computed(() => setUp.value.filter((item) => item.flow.remindAlerts.value));
  const library = () =>
    router.push({ name: "starterPacks", query: { org_identifier: org } }).catch(() => {});

  return {
    items,
    menu,
    offered,
    setUp,
    showSection,
    showMenu,
    loading,
    empty,
    silent,
    library,
  };
}

export type HomePacks = ReturnType<typeof useHomePacks>;

export const HOME_PACKS: InjectionKey<ShallowRef<HomePacks | null>> = Symbol("homePacks");
