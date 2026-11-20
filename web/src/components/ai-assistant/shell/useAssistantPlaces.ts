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

import { computed, watch, type ComputedRef } from "vue";
import { useRoute, useRouter, type RouteLocationNormalizedLoaded, type Router } from "vue-router";

import {
  MAX_FLOATING_CHATS,
  hostRegistry,
  isPageHost,
  isRunning,
  useAssistantHistory,
  useAssistantStore,
  type AssistantSession,
  type DockHostId,
  type Sid,
} from "@/composables/assistant";
import {
  approvalCardOf,
  fullThreadLocation,
  homeQueryFrom,
  isFullThreadRoute,
  leaveFullTabHandoff,
  movedToTab,
  openTabWithoutOpener,
  withoutThread,
  type FullTabHandoff,
} from "@/composables/assistant/pure";
import useBreakpoint from "@/composables/useBreakpoint";
import { trackAssistant, type PlacementMode } from "@/services/assistantAnalytics";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { isSavedSession } from "@/views/home/useThreadUrl";

export type AssistantPlacementName = "sidebar" | "full" | "docked" | "window";

export type PlaceId = "sidebar" | "window" | "full" | "dock";

/** What a container is, so the moves it offers and their telemetry are right. */
export interface AssistantPlacesInput {
  placement: AssistantPlacementName;
  sid: Sid | null;
  sheet: boolean;
  dockHost?: DockHostId;
}

// The Navigation API is not in TypeScript's DOM lib yet; only the entry list is read.
interface NavigationEntries {
  currentEntry: { index: number } | null;
  entries(): { url: string | null }[];
}

export interface AssistantPlace {
  id: PlaceId;
  label: I18nText;
  checked: boolean;
  disabled: boolean;
  /** The move opens the chat in another browser tab, which the button must show. */
  newTab?: boolean;
  run: () => void;
}

export function placementMode(placement: AssistantPlacementName, sheet: boolean): PlacementMode {
  if (placement === "full" || placement === "docked" || placement === "window") return placement;
  return sheet ? "sheet" : "sidebar";
}

/** Leaves the full view by going back past every chat it pushed; Home replaces it when the browser cannot list them. */
export function leaveFullThreadRoute(router: Router, route: RouteLocationNormalizedLoaded): void {
  if (!isFullThreadRoute(route)) return;
  const back = window.history.state?.back;
  // Home's own query (period, org) stays; only the thread key goes.
  const home = { name: String(route.name), query: withoutThread(route.query) };
  if (typeof back !== "string") return void router.push(home);
  if (!isFullThreadRoute(router.resolve(back))) return router.back();
  const steps = stepsPastFullChats(router);
  if (steps > 0) router.go(-steps);
  else void router.replace(home);
}

/** The Open as moves a container offers: Side panel, Full page, Floating window and its editor's dock, by viewport and placement. */
export function useAssistantPlaces(input: () => AssistantPlacesInput): {
  places: ComputedRef<AssistantPlace[]>;
  freshFull: ComputedRef<AssistantPlace | null>;
} {
  const { t } = useI18nTyped();
  const store = useAssistantStore();
  const history = useAssistantHistory();
  const hosts = hostRegistry;
  const router = useRouter();
  const route = useRoute();
  const { lgUp } = useBreakpoint();

  const atCap = computed(() => store.state.shell.windows.length >= MAX_FLOATING_CHATS);
  const modalDock = computed(() => {
    const { placement, dockHost } = input();
    if (placement !== "docked" || !dockHost) return false;
    return !isPageHost(hosts.get(dockHost));
  });

  // This chat's editor, when it is mounted and may take the chat back (decision 11).
  const chatDock = computed<DockHostId | null>(() => {
    const { placement, sid } = input();
    const session = sid ? store.state.sessions[sid] : null;
    const origin = session?.origin.container ?? "";
    if (placement === "docked" || !origin.startsWith("docked.")) return null;
    const id = origin.slice("docked.".length) as DockHostId;
    return hosts.has(id) && isPageHost(hosts.get(id)) ? id : null;
  });

  const places = computed<AssistantPlace[]>(() => {
    const { placement, sheet } = input();
    const sidebar: AssistantPlace = {
      id: "sidebar",
      label: t("assistant.shell.sidePanel"),
      checked: placement === "sidebar",
      disabled: false,
      run: toSidebar,
    };
    const window: AssistantPlace = {
      id: "window",
      label: t("assistant.shell.popOut"),
      checked: placement === "window",
      disabled: atCap.value && placement !== "window",
      run: toWindow,
    };
    const full: AssistantPlace = {
      id: "full",
      label: t("assistant.shell.fullPage"),
      checked: placement === "full",
      disabled: false,
      newTab: placement !== "full" && !sheet,
      run: toFull,
    };
    const dock: AssistantPlace = {
      id: "dock",
      label: t("assistant.shell.placeDock"),
      checked: placement === "docked",
      disabled: false,
      run: toDock,
    };
    if (modalDock.value) return [full];
    if (sheet) return placement === "sidebar" ? [full] : [full, sidebar];
    if (!lgUp.value) return [full, sidebar];
    if (placement === "docked") return [full, dock, window];
    return [full, sidebar, window, ...(chatDock.value ? [dock] : [])];
  });

  // Full page carries the chat; from a chat with messages this starts an empty one there instead.
  const freshFull = computed<AssistantPlace | null>(() => {
    const { placement, sid } = input();
    if (placement === "full" || modalDock.value) return null;
    if (!(sid && store.state.sessions[sid]?.messages.length)) return null;
    return {
      id: "full",
      label: t("assistant.shell.newChatFullPage"),
      checked: false,
      disabled: false,
      newTab: true,
      run: toFreshFull,
    };
  });

  function running(): boolean {
    const { sid } = input();
    const session = sid ? store.state.sessions[sid] : null;
    return !!session && isRunning(session.turn);
  }

  function trackMove(to: PlacementMode): void {
    const { placement, sheet } = input();
    trackAssistant("ai_container_moved", {
      from: placementMode(placement, sheet),
      to,
      turn_running: running(),
    });
  }

  function leaveFullView(): void {
    leaveFullThreadRoute(router, route);
  }

  function toSidebar(): void {
    const { placement, sid } = input();
    if (placement === "sidebar") return;
    trackMove("sidebar");
    if (placement === "window" && sid) return store.pinChat(sid);
    store.open({ kind: "sidebar" }, { focus: "composer" });
    if (placement === "full") focusAfterLeaving();
    leaveFullView();
  }

  // The page under the full view mounts its own composer and takes focus; the moved chat asks again once it has.
  function focusAfterLeaving(): void {
    const stop = watch(
      () => isFullThreadRoute(route),
      (full) => {
        if (full) return;
        stop();
        if (store.state.shell.placement.kind === "sidebar")
          store.open({ kind: "sidebar" }, { focus: "composer" });
      },
    );
  }

  function ensureChat(): Sid {
    return (
      input().sid ??
      store.state.shell.activeSid ??
      store.createSession({
        origin: { entryKind: "thread_new", objectKind: "none", container: "window" },
      })
    );
  }

  function toWindow(): void {
    if (input().placement === "window") return;
    const result = store.floatChat(ensureChat());
    if (!result.ok) {
      if (result.reason === "cap") trackAssistant("ai_window_cap_reached", {});
      return;
    }
    trackAssistant("ai_window_opened", { from: "layout" });
    trackMove("window");
    leaveFullView();
  }

  // A chat with messages opens on itself, even mid-run; one never sent opens as a new chat carrying its draft.
  function openFullTab(sid: Sid | null): void {
    const session = sid ? store.state.sessions[sid] : undefined;
    const target = session && (session.messages.length > 0 || isSavedSession(session)) ? sid : null;
    const { userOrgKey } = store.state;
    const handoff = session ? handoffOf(session, target) : null;
    if (userOrgKey && handoff) leaveFullTabHandoff({ userOrgKey, ...handoff, at: Date.now() });
    // The server holds a running turn back until it ends; the browser copy shows it there meanwhile.
    if (target && session && isRunning(session.turn)) void history.save(target, { live: true });
    openTabWithoutOpener(router.resolve(fullThreadLocation(target, homeQueryFrom(route))).href);
  }

  function toFull(): void {
    if (input().placement === "full") return;
    trackMove("full");
    const { placement, sheet } = input();
    const sid = input().sid ?? store.state.shell.activeSid;
    if (sheet) return moveFullHere(sid ?? ensureChat());
    openFullTab(sid);
    // The chat now lives in its own tab; this one stops showing it, so it is never answered twice.
    if (placement === "window" && sid) store.closeWindow(sid, { toTab: true });
    else if (placement === "sidebar") {
      movedToTab.value = { sid };
      store.close("close");
    }
  }

  function moveFullHere(sid: Sid): void {
    if (store.windowOf(sid)) store.open({ kind: "full" }, { sid, focus: "composer" });
    else store.moveTo({ kind: "full" });
    void router.push(fullThreadLocation(sid, homeQueryFrom(route))).catch(() => undefined);
  }

  function toFreshFull(): void {
    trackMove("full");
    openFullTab(null);
  }

  function toDock(): void {
    const hostId = chatDock.value;
    if (!hostId) return;
    trackMove("docked");
    const { sid } = input();
    store.open({ kind: "docked", hostId }, { ...(sid && { sid }), focus: "composer" });
  }

  return { places, freshFull };
}

function handoffOf(
  session: AssistantSession,
  target: Sid | null,
): Omit<FullTabHandoff, "userOrgKey" | "at"> | null {
  const { text, chips, images } = session.composer;
  const agentId = session.messages.length ? session.nextAgentId : session.agentId;
  const pending = !!target && !isSavedSession(session);
  const card = target ? waitingCard(session) : undefined;
  if (!text.trim() && !chips.length && !images.length && !agentId && !pending && !card) return null;
  return {
    target,
    text,
    chips: [...chips],
    ...(images.length > 0 && { images: images.map((image) => ({ ...image })) }),
    ...(agentId && { agentId }),
    ...(pending && { pending }),
    ...(card && { card }),
  };
}

function waitingCard(session: AssistantSession): FullTabHandoff["card"] {
  const pending = session.pendingApproval;
  const block = pending ? approvalCardOf(session, pending.id) : null;
  if (!pending || !block) return undefined;
  const { sessionId: _sessionId, turnId: _turnId, ...data } = block;
  return { turnId: pending.turnId, block: { ...data, expiresAt: pending.expiresAt } };
}

// Back must skip every chat the full view pushed, or it reopens one at full page (C-06).
function stepsPastFullChats(router: Router): number {
  const nav = (window as { navigation?: NavigationEntries }).navigation;
  const current = nav?.currentEntry?.index ?? -1;
  if (!nav || current < 1) return 0;
  const entries = nav.entries();
  for (let i = current - 1; i >= 0; i -= 1) {
    const path = appPath(entries[i]?.url ?? null, router.options.history.base);
    if (path === null) return 0;
    if (!isFullThreadRoute(router.resolve(path))) return current - i;
  }
  return 0;
}

function appPath(url: string | null, base: string): string | null {
  if (!url) return null;
  const parsed = new URL(url);
  if (parsed.origin !== window.location.origin) return null;
  const inApp = base && parsed.pathname.startsWith(base);
  const path = inApp ? parsed.pathname.slice(base.length) || "/" : parsed.pathname;
  return path + parsed.search + parsed.hash;
}
