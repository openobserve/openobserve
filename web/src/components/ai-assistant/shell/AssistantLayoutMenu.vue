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

<template>
  <component :is="bare ? BareMenu : ODropdown" v-bind="bare ? {} : { align: 'end' }">
    <template v-if="!bare" #trigger>
      <AssistantIconButton
        :label="t('assistant.shell.layout')"
        :icon="assistantGlyph.layout"
        data-test="assistant-layout-button"
      />
    </template>
    <ODropdownItem
      v-for="item in places"
      :key="item.id"
      role="menuitemradio"
      :aria-checked="item.checked"
      :disabled="item.disabled"
      :focusable-unavailable="item.disabled"
      :data-test="`assistant-shell-place-${item.id}`"
      @select="item.run"
    >
      {{ item.label }}
      <template v-if="item.checked" #icon-right>
        <OIcon :name="assistantGlyph.done" size="sm" class="text-assistant-link ms-auto" />
      </template>
    </ODropdownItem>
  </component>
</template>

<script lang="ts">
import type { DockHostId, Sid } from "@/composables/assistant";
import type { PlacementMode } from "@/services/assistantAnalytics";

export interface AssistantLayoutMenuProps {
  placement: "sidebar" | "full" | "docked" | "window";
  /** The chat this container shows. */
  sid: Sid | null;
  /** The sidebar rendered as the phone or tablet sheet: only the moves a sheet can do. */
  sheet?: boolean;
  /** Only the groups, for a host menu (the title bar's More) that owns the trigger. */
  bare?: boolean;
  /** The dock this container is, for the modal check. */
  dockHost?: DockHostId;
}

export function placementMode(
  placement: AssistantLayoutMenuProps["placement"],
  sheet: boolean,
): PlacementMode {
  if (placement === "full" || placement === "docked" || placement === "window") return placement;
  return sheet ? "sheet" : "sidebar";
}
</script>

<script setup lang="ts">
import { computed, type FunctionalComponent } from "vue";
import { useRoute, useRouter } from "vue-router";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import {
  MAX_FLOATING_CHATS,
  hostRegistry,
  isPageHost,
  isRunning,
  useAssistantStore,
} from "@/composables/assistant";
import useBreakpoint from "@/composables/useBreakpoint";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<AssistantLayoutMenuProps>(), {
  sheet: false,
  bare: false,
  dockHost: undefined,
});

const BareMenu: FunctionalComponent = (_props, { slots }) => slots.default?.();

const { t } = useI18nTyped();
const store = useAssistantStore();
const hosts = hostRegistry;
const router = useRouter();
const route = useRoute();
const { lgUp } = useBreakpoint();

const atCap = computed(() => store.state.shell.windows.length >= MAX_FLOATING_CHATS);
const modalDock = computed(() => {
  if (props.placement !== "docked" || !props.dockHost) return false;
  return !isPageHost(hosts.get(props.dockHost));
});

// This chat's editor, when it is mounted and may take the chat back (decision 11).
const chatDock = computed<DockHostId | null>(() => {
  const session = props.sid ? store.state.sessions[props.sid] : null;
  const origin = session?.origin.container ?? "";
  if (props.placement === "docked" || !origin.startsWith("docked.")) return null;
  const id = origin.slice("docked.".length) as DockHostId;
  return hosts.has(id) && isPageHost(hosts.get(id)) ? id : null;
});

const places = computed(() => {
  const sidebar = {
    id: "sidebar",
    label: t("assistant.shell.placeSidebar"),
    checked: props.placement === "sidebar",
    disabled: false,
    run: toSidebar,
  };
  const window = {
    id: "window",
    label: t("assistant.shell.placeWindow"),
    checked: props.placement === "window",
    disabled: atCap.value && props.placement !== "window",
    run: toWindow,
  };
  const full = {
    id: "full",
    label: t("assistant.shell.placeFull"),
    checked: props.placement === "full",
    disabled: false,
    run: toFull,
  };
  const dock = {
    id: "dock",
    label: t("assistant.shell.placeDock"),
    checked: props.placement === "docked",
    disabled: false,
    run: toDock,
  };
  if (modalDock.value) return [full];
  if (props.sheet) return props.placement === "sidebar" ? [full] : [sidebar, full];
  if (!lgUp.value) return [sidebar, full];
  if (props.placement === "docked") return [dock, window, full];
  return [sidebar, window, full, ...(chatDock.value ? [dock] : [])];
});

function running(): boolean {
  const session = props.sid ? store.state.sessions[props.sid] : null;
  return !!session && isRunning(session.turn);
}

function trackMove(to: PlacementMode): void {
  trackAssistant("ai_container_moved", {
    from: placementMode(props.placement, props.sheet),
    to,
    turn_running: running(),
  });
}

// The full view leaves by going back, so the page it came from returns beneath the chat.
function leaveFullView(): void {
  if (route.name !== "assistant") return;
  if (window.history.state?.back) router.back();
  else void router.push("/");
}

function toSidebar(): void {
  if (props.placement === "sidebar") return;
  trackMove("sidebar");
  if (props.placement === "window" && props.sid) return store.pinChat(props.sid);
  store.open({ kind: "sidebar" }, { focus: "composer" });
  leaveFullView();
}

function ensureChat(): Sid {
  return (
    props.sid ??
    store.state.shell.activeSid ??
    store.createSession({
      origin: { entryKind: "thread_new", objectKind: "none", container: "window" },
    })
  );
}

function toWindow(): void {
  if (props.placement === "window") return;
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
  if (props.placement === "full") return;
  trackMove("full");
  const sid = props.sid ?? store.state.shell.activeSid;
  if (sid && store.windowOf(sid)) store.open({ kind: "full" }, { sid, focus: "none" });
  else store.moveTo({ kind: "full" });
  void router.push({ name: "assistant", params: sid ? { chatId: sid } : {} });
}

function toDock(): void {
  const hostId = chatDock.value;
  if (!hostId) return;
  trackMove("docked");
  store.open(
    { kind: "docked", hostId },
    { ...(props.sid && { sid: props.sid }), focus: "composer" },
  );
}
</script>
