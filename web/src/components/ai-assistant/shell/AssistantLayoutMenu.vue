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
      :description="item.hint"
      :data-test="`assistant-shell-place-${item.id}`"
      @select="item.run"
    >
      {{ item.label }}
      <template v-if="item.checked" #icon-right>
        <OIcon :name="assistantGlyph.done" size="sm" class="text-assistant-link ms-auto" />
      </template>
    </ODropdownItem>
    <template v-if="placement === 'sidebar' && !sheet">
      <ODropdownSeparator />
      <ODropdownSub :text-value="t('assistant.shell.width')" data-test="assistant-shell-width">
        <template #trigger>{{ t("assistant.shell.width") }}</template>
        <ODropdownItem
          v-for="item in widths"
          :key="item.id"
          :role="item.radio ? 'menuitemradio' : 'menuitem'"
          :aria-checked="item.radio ? item.checked : undefined"
          :disabled="item.disabled"
          :focusable-unavailable="item.disabled"
          :description="item.hint"
          :data-test="item.dataTest"
          @select="item.run"
        >
          {{ item.label }}
          <template v-if="item.checked" #icon-right>
            <OIcon :name="assistantGlyph.done" size="sm" class="text-assistant-link ms-auto" />
          </template>
        </ODropdownItem>
      </ODropdownSub>
      <OText
        v-if="prefersWindow"
        as="p"
        variant="meta"
        class="px-3 py-1.5"
        data-test="assistant-shell-prefers-window-hint"
      >
        {{ t("assistant.shell.prefersWindowHint") }}
      </OText>
    </template>
    <template v-if="placement === 'window' && windowHost">
      <ODropdownSeparator />
      <ODropdownSub :text-value="t('assistant.window.position')">
        <template #trigger>
          <span data-test="assistant-window-position">{{ t("assistant.window.position") }}</span>
        </template>
        <ODropdownItem
          v-for="corner in corners"
          :key="corner.id"
          :data-test="corner.dataTest"
          @select="windowHost.moveTo(corner.id)"
        >
          {{ t("assistant.window.moveTo", { corner: corner.label }) }}
        </ODropdownItem>
        <ODropdownItem
          data-test="assistant-window-move-keyboard"
          @select="windowHost.startMode('move')"
        >
          {{ t("assistant.window.moveKeyboard") }}
        </ODropdownItem>
      </ODropdownSub>
      <ODropdownSub :text-value="t('assistant.window.size')">
        <template #trigger>
          <span data-test="assistant-window-size">{{ t("assistant.window.size") }}</span>
        </template>
        <ODropdownItem
          v-for="step in steps"
          :key="step.id"
          :disabled="step.limited"
          :focusable-unavailable="step.limited"
          :description="step.limited ? t('assistant.window.sizeLimit') : undefined"
          :data-test="`assistant-window-${step.id}`"
          @select="(event: Event) => stepSize(event, step)"
        >
          {{ step.label }}
        </ODropdownItem>
        <ODropdownItem
          data-test="assistant-window-resize-keyboard"
          @select="windowHost.startMode('resize')"
        >
          {{ t("assistant.window.resizeKeyboard") }}
        </ODropdownItem>
        <ODropdownSeparator />
        <ODropdownItem data-test="assistant-window-reset-size" @select="windowHost.resetSize()">
          {{ t("assistant.window.resetSize") }}
        </ODropdownItem>
      </ODropdownSub>
    </template>
  </component>
</template>

<script lang="ts">
import type { DockHostId, Sid, WindowCorner } from "@/composables/assistant";
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

const WIDTH_STEP_REM = 4;

const WIDTH_EPSILON = 0.05;

const CORNER_TEST_IDS: Record<WindowCorner, string> = {
  "top-start": "top-left",
  "top-end": "top-right",
  "bottom-start": "bottom-left",
  "bottom-end": "bottom-right",
};

const CORNER_LABELS = {
  "top-start": "assistant.window.cornerTopStart",
  "top-end": "assistant.window.cornerTopEnd",
  "bottom-start": "assistant.window.cornerBottomStart",
  "bottom-end": "assistant.window.cornerBottomEnd",
} as const;

export function placementMode(
  placement: AssistantLayoutMenuProps["placement"],
  sheet: boolean,
): PlacementMode {
  if (placement === "full" || placement === "docked" || placement === "window") return placement;
  return sheet ? "sheet" : "sidebar";
}
</script>

<script setup lang="ts">
import { computed, inject, type FunctionalComponent } from "vue";
import { useRoute, useRouter } from "vue-router";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import {
  MAX_FLOATING_CHATS,
  SIDEBAR_MIN_REM,
  defaultWidthRem,
  hostRegistry,
  isPageHost,
  isRunning,
  sidebarWidthFor,
  useAssistantStore,
} from "@/composables/assistant";
import useBreakpoint from "@/composables/useBreakpoint";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import ODropdownSub from "@/lib/overlay/Dropdown/ODropdownSub.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { useI18nTyped } from "@/types/i18n";

import { assistantWindowHostKey, type WindowSizeStep } from "./assistantWindowHost";

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
const windowHost = inject(assistantWindowHostKey, null);

const viewportRem = () => window.innerWidth / 16;
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
    hint: undefined,
    checked: props.placement === "sidebar",
    disabled: false,
    run: toSidebar,
  };
  const window = {
    id: "window",
    label: t("assistant.shell.placeWindow"),
    hint:
      atCap.value && props.placement !== "window"
        ? t("assistant.shell.placeWindowLimit")
        : undefined,
    checked: props.placement === "window",
    disabled: atCap.value && props.placement !== "window",
    run: toWindow,
  };
  const full = {
    id: "full",
    label: t("assistant.shell.placeFull"),
    hint: undefined,
    checked: props.placement === "full",
    disabled: false,
    run: toFull,
  };
  const dock = {
    id: "dock",
    label: t("assistant.shell.placeDock"),
    hint: undefined,
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

const shownWidth = computed(() =>
  sidebarWidthFor(store.state.shell.sidebarWidthRem, viewportRem()),
);
const expandedRem = computed(() => sidebarWidthFor(Number.POSITIVE_INFINITY, viewportRem()));
const defaultRem = computed(() => defaultWidthRem(viewportRem()));

const widths = computed(() => {
  const current = shownWidth.value;
  const noRoom = expandedRem.value <= defaultRem.value + WIDTH_EPSILON;
  const atMax = current >= expandedRem.value - WIDTH_EPSILON;
  const atMin = current <= SIDEBAR_MIN_REM + WIDTH_EPSILON;
  const limit = t("assistant.shell.widthLimit");
  return [
    {
      id: "default",
      dataTest: "assistant-shell-width-default",
      label: t("assistant.shell.widthDefault"),
      hint: undefined,
      radio: true,
      checked: Math.abs(current - defaultRem.value) < WIDTH_EPSILON,
      disabled: false,
      run: () => setWidth(defaultRem.value),
    },
    {
      id: "expanded",
      dataTest: "assistant-shell-width-expanded",
      label: t("assistant.shell.widthExpanded"),
      hint: noRoom ? t("assistant.shell.widthNoRoom") : t("assistant.shell.widthExpandedHint"),
      radio: true,
      checked: !noRoom && Math.abs(current - expandedRem.value) < WIDTH_EPSILON,
      disabled: noRoom,
      run: () => setWidth(expandedRem.value),
    },
    {
      id: "wider",
      dataTest: "assistant-shell-width-wider",
      label: t("assistant.shell.widthWider"),
      hint: atMax ? limit : undefined,
      radio: false,
      checked: false,
      disabled: atMax,
      run: (event: Event) => stepWidth(event, WIDTH_STEP_REM),
    },
    {
      id: "narrower",
      dataTest: "assistant-shell-width-narrower",
      label: t("assistant.shell.widthNarrower"),
      hint: atMin ? limit : undefined,
      radio: false,
      checked: false,
      disabled: atMin,
      run: (event: Event) => stepWidth(event, -WIDTH_STEP_REM),
    },
    {
      id: "reset",
      dataTest: "assistant-shell-reset-width",
      label: t("assistant.shell.resetWidth"),
      hint: undefined,
      radio: false,
      checked: false,
      disabled: false,
      run: () => setWidth(defaultRem.value),
    },
  ];
});

const prefersWindow = computed(() => {
  const wanted = route.meta?.assistantPrefersFloating;
  return typeof wanted === "function" ? wanted(route) : wanted === true;
});

const corners = computed(() =>
  (windowHost?.otherCorners() ?? []).map((id) => ({
    id,
    label: t(CORNER_LABELS[id]),
    dataTest: `assistant-window-move-to-${CORNER_TEST_IDS[id]}`,
  })),
);

const steps = computed(() =>
  (["wider", "narrower", "taller", "shorter"] as const).map((id) => ({
    id,
    label: t(`assistant.window.${id}`),
    limited: windowHost?.sizeLimited(id) ?? true,
  })),
);

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

function setWidth(rem: number): void {
  store.setSidebarWidth(rem);
  trackAssistant("ai_panel_resized", {
    width_rem: store.state.shell.sidebarWidthRem,
    viewport:
      window.innerWidth >= 1024 ? "desktop" : window.innerWidth >= 768 ? "tablet" : "mobile",
  });
}

// Wider and Narrower keep the menu open, so repeated presses reach every 4 rem step (`20` §2.2).
function stepWidth(event: Event, delta: number): void {
  event.preventDefault();
  setWidth(Math.min(expandedRem.value, shownWidth.value + delta));
}

function stepSize(event: Event, step: { id: WindowSizeStep; limited: boolean }): void {
  event.preventDefault();
  if (!step.limited) windowHost?.stepSize(step.id);
}
</script>
