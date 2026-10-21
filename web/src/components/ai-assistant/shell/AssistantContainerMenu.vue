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
        :label="t('assistant.shell.moreActions')"
        :icon="assistantGlyph.more"
        data-test="assistant-shell-menu"
      />
    </template>
    <ODropdownGroup :label="t('assistant.shell.layout')" data-test="assistant-shell-mode-menu">
      <ODropdownItem
        v-if="placement === 'sidebar'"
        data-test="assistant-shell-open-in-full-view-item"
        @select="openInFullView"
      >
        {{ t("assistant.shell.openInFullView") }}
      </ODropdownItem>
      <ODropdownItem v-else data-test="assistant-shell-open-in-sidebar" @select="openInSidebar">
        {{ t("assistant.shell.openInSidebar") }}
      </ODropdownItem>
      <template v-if="placement === 'sidebar' && !sheet">
        <ODropdownItem
          role="menuitemradio"
          :aria-checked="!floating"
          :disabled="forcedFloating"
          :focusable-unavailable="forcedFloating"
          :description="pinnedHint"
          data-test="assistant-shell-mode-pinned"
          @select="setMode('pinned')"
        >
          <template #icon-left>
            <span
              class="inline-flex size-4 shrink-0 items-center justify-center"
              aria-hidden="true"
            >
              <OIcon v-if="!floating" :name="assistantGlyph.done" size="sm" />
            </span>
          </template>
          {{ t("assistant.shell.modePinned") }}
        </ODropdownItem>
        <ODropdownItem
          role="menuitemradio"
          :aria-checked="floating"
          :description="floatingHint"
          data-test="assistant-shell-mode-floating"
          @select="setMode('floating')"
        >
          <template #icon-left>
            <span
              class="inline-flex size-4 shrink-0 items-center justify-center"
              aria-hidden="true"
            >
              <OIcon v-if="floating" :name="assistantGlyph.done" size="sm" />
            </span>
          </template>
          {{ t("assistant.shell.modeFloating") }}
        </ODropdownItem>
      </template>
    </ODropdownGroup>
    <template v-if="placement === 'sidebar' && !sheet">
      <ODropdownSeparator />
      <ODropdownGroup :label="t('assistant.shell.width')">
        <ODropdownItem
          v-for="option in widths"
          :key="option.id"
          role="menuitemradio"
          :aria-checked="option.checked"
          :data-test="`assistant-shell-width-${option.id}`"
          @select="setWidth(option.rem)"
        >
          <template #icon-left>
            <span
              class="inline-flex size-4 shrink-0 items-center justify-center"
              aria-hidden="true"
            >
              <OIcon v-if="option.checked" :name="assistantGlyph.done" size="sm" />
            </span>
          </template>
          {{ option.label }}
        </ODropdownItem>
      </ODropdownGroup>
    </template>
  </component>
</template>

<script lang="ts">
import type { PlacementMode } from "@/services/assistantAnalytics";

export interface AssistantContainerMenuProps {
  placement: "sidebar" | "full" | "docked";
  /** The sidebar rendered as the phone or tablet sheet. */
  sheet?: boolean;
  /** Only the groups, for a host menu (the thread header's overflow) that owns the trigger. */
  bare?: boolean;
}

/** Narrow and Wide of the Width group (`20` §2.2, round 2 X-37); Default is the clamp of the viewport. */
export const WIDTH_NARROW_REM = 22;

export const WIDTH_WIDE_REM = 32;

const WIDTH_DEFAULT_SHARE = 0.3;

/** `clamp(22rem, 30vw, 32rem)`, the default sidebar width. */
export function defaultWidthRem(viewportRem: number): number {
  return Math.min(Math.max(viewportRem * WIDTH_DEFAULT_SHARE, WIDTH_NARROW_REM), WIDTH_WIDE_REM);
}

export function placementMode(
  placement: AssistantContainerMenuProps["placement"],
  sheet: boolean,
  mode: "pinned" | "floating",
): PlacementMode {
  if (placement === "full") return "full";
  if (placement === "docked") return "docked";
  return sheet ? "sheet" : mode;
}
</script>

<script setup lang="ts">
import { computed, type FunctionalComponent } from "vue";
import { useRoute, useRouter } from "vue-router";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import {
  useAssistantPlacement,
  useAssistantStore,
  useSidebarFloating,
} from "@/composables/assistant";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<AssistantContainerMenuProps>(), {
  sheet: false,
  bare: false,
});

const BareMenu: FunctionalComponent = (_props, { slots }) => slots.default?.();

const { t } = useI18nTyped();
const store = useAssistantStore();
const router = useRouter();
const route = useRoute();

const view = useAssistantPlacement(store);
const floating = useSidebarFloating(store);
const forcedFloating = computed(() => view.sidebarForcedFloating.value);

const pinnedHint = computed(() => {
  if (forcedFloating.value) return t("assistant.shell.modeFloatingForcedHint");
  return view.sidebarForcedPinned.value
    ? t("assistant.shell.modeForcedPinnedHint")
    : t("assistant.shell.modePinnedHint");
});

const floatingHint = computed(() =>
  forcedFloating.value
    ? t("assistant.shell.modeFloatingForcedHint")
    : t("assistant.shell.modeFloatingHint"),
);

const widths = computed(() => {
  const current = store.state.shell.sidebarWidthRem;
  const options = [
    { id: "narrow", rem: WIDTH_NARROW_REM, label: t("assistant.shell.widthNarrow") },
    {
      id: "default",
      rem: defaultWidthRem(window.innerWidth / 16),
      label: t("assistant.shell.widthDefault"),
    },
    { id: "wide", rem: WIDTH_WIDE_REM, label: t("assistant.shell.widthWide") },
  ];
  // A stored width that matches none of the three checks nothing.
  return options.map((o) => ({ ...o, checked: Math.abs(o.rem - current) < 0.05 }));
});

function trackMove(to: PlacementMode): void {
  const sid = store.state.shell.activeSid;
  const turn = sid ? store.state.sessions[sid]?.turn.state : "idle";
  trackAssistant("ai_container_moved", {
    from: placementMode(props.placement, props.sheet, store.state.shell.sidebarMode),
    to,
    turn_running: !!turn && !["idle", "done", "failed", "refused", "stopped"].includes(turn),
  });
}

function openInFullView(): void {
  trackMove("full");
  const sid = store.state.shell.activeSid;
  store.moveTo({ kind: "full" });
  void router.push({ name: "assistant", params: sid ? { chatId: sid } : {} });
}

// The full view leaves its route by going back, so the sidebar returns beside the page it came from; the move asks for focus.
function openInSidebar(): void {
  trackMove(store.state.shell.sidebarMode);
  store.open({ kind: "sidebar", mode: store.state.shell.sidebarMode }, { focus: "composer" });
  if (route.name !== "assistant") return;
  if (window.history.state?.back) router.back();
  else void router.push("/");
}

function setMode(mode: "pinned" | "floating"): void {
  if (mode === "pinned" && forcedFloating.value) return;
  store.setSidebarMode(mode);
  const current = store.state.shell.placement;
  if (current.kind === "sidebar" && current.mode !== mode)
    store.open({ kind: "sidebar", mode }, { focus: "none" });
  trackAssistant("ai_panel_mode_changed", { mode, forced: forcedFloating.value });
}

function setWidth(rem: number): void {
  store.setSidebarWidth(rem);
  trackAssistant("ai_panel_resized", {
    width_rem: store.state.shell.sidebarWidthRem,
    viewport:
      window.innerWidth >= 1024 ? "desktop" : window.innerWidth >= 768 ? "tablet" : "mobile",
  });
}
</script>
