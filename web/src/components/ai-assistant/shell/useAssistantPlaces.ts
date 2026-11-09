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

import { computed, type ComputedRef } from "vue";
import { useRoute, useRouter } from "vue-router";

import {
  MAX_FLOATING_CHATS,
  hostRegistry,
  isPageHost,
  isRunning,
  useAssistantStore,
  type DockHostId,
  type Sid,
} from "@/composables/assistant";
import { isFullThreadRoute } from "@/composables/assistant/pure";
import useBreakpoint from "@/composables/useBreakpoint";
import { trackAssistant, type PlacementMode } from "@/services/assistantAnalytics";
import { useI18nTyped, type I18nText } from "@/types/i18n";

export type AssistantPlacementName = "sidebar" | "full" | "docked" | "window";

export type PlaceId = "sidebar" | "window" | "full" | "dock";

/** What a container is, so the moves it offers and their telemetry are right. */
export interface AssistantPlacesInput {
  placement: AssistantPlacementName;
  sid: Sid | null;
  sheet: boolean;
  dockHost?: DockHostId;
}

export interface AssistantPlace {
  id: PlaceId;
  label: I18nText;
  checked: boolean;
  disabled: boolean;
  run: () => void;
}

export function placementMode(placement: AssistantPlacementName, sheet: boolean): PlacementMode {
  if (placement === "full" || placement === "docked" || placement === "window") return placement;
  return sheet ? "sheet" : "sidebar";
}

/** The Open as moves a container offers: Side panel, Full page, Pop out and its editor's dock, by viewport and placement. */
export function useAssistantPlaces(input: () => AssistantPlacesInput): {
  places: ComputedRef<AssistantPlace[]>;
} {
  const { t } = useI18nTyped();
  const store = useAssistantStore();
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
    if (sheet) return placement === "sidebar" ? [full] : [sidebar, full];
    if (!lgUp.value) return [sidebar, full];
    if (placement === "docked") return [dock, full, window];
    return [sidebar, full, window, ...(chatDock.value ? [dock] : [])];
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

  // The full view leaves by going back, so the page it came from returns beneath the chat.
  function leaveFullView(): void {
    if (!isFullThreadRoute(route)) return;
    if (window.history.state?.back) router.back();
    else void router.push("/");
  }

  function toSidebar(): void {
    const { placement, sid } = input();
    if (placement === "sidebar") return;
    trackMove("sidebar");
    if (placement === "window" && sid) return store.pinChat(sid);
    store.open({ kind: "sidebar" }, { focus: "composer" });
    leaveFullView();
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

  function toFull(): void {
    if (input().placement === "full") return;
    trackMove("full");
    const sid = input().sid ?? store.state.shell.activeSid;
    if (sid && store.windowOf(sid)) store.open({ kind: "full" }, { sid, focus: "none" });
    else store.moveTo({ kind: "full" });
    void router.push({ name: "assistant", params: sid ? { chatId: sid } : {} });
  }

  function toDock(): void {
    const hostId = chatDock.value;
    if (!hostId) return;
    trackMove("docked");
    const { sid } = input();
    store.open({ kind: "docked", hostId }, { ...(sid && { sid }), focus: "composer" });
  }

  return { places };
}
