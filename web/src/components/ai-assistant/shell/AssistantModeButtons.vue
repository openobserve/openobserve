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
  <template v-if="bare">
    <ODropdownItem
      v-for="item in others"
      :key="item.id"
      :icon-left="PLACE_ICONS[item.id]"
      :data-test="`assistant-shell-place-${item.id}`"
      @select="item.run"
    >
      {{ item.label }}
    </ODropdownItem>
    <ODropdownItem
      v-if="freshFull"
      :icon-left="assistantGlyph.newChat"
      data-test="assistant-shell-place-full-new"
      @select="freshFull.run"
    >
      {{ freshFull.label }}
    </ODropdownItem>
  </template>
  <template v-else>
    <AssistantIconButton
      v-for="item in others"
      :key="item.id"
      :label="item.label"
      :icon="PLACE_ICONS[item.id]"
      :data-test="`assistant-shell-place-${item.id}`"
      @click="item.run"
    />
  </template>
</template>

<script lang="ts">
import type { DockHostId, Sid } from "@/composables/assistant";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import type { IconName } from "@/lib/core/Icon/OIcon.types";

import type { PlaceId } from "./useAssistantPlaces";

export { placementMode } from "./useAssistantPlaces";

export interface AssistantModeButtonsProps {
  placement: "sidebar" | "full" | "docked" | "window";
  /** The chat this container shows; it moves unchanged. */
  sid: Sid | null;
  /** The sidebar drawn as the phone or tablet sheet: only the moves a sheet can do. */
  sheet?: boolean;
  /** Menu items instead of header buttons, for a host menu that owns the trigger. */
  bare?: boolean;
  /** The dock this container is, for the modal check. */
  dockHost?: DockHostId;
}

const PLACE_ICONS: Record<PlaceId, IconName> = {
  sidebar: assistantGlyph.sidePanel,
  full: assistantGlyph.fullPage,
  window: assistantGlyph.floatingWindow,
  dock: assistantGlyph.helper,
};
</script>

<script setup lang="ts">
import { computed } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";

import { useAssistantPlaces } from "./useAssistantPlaces";

const props = withDefaults(defineProps<AssistantModeButtonsProps>(), {
  sheet: false,
  bare: false,
  dockHost: undefined,
});

const { places, freshFull } = useAssistantPlaces(() => ({
  placement: props.placement,
  sid: props.sid,
  sheet: props.sheet,
  dockHost: props.dockHost,
}));
// The container you are in is never offered, and a move that cannot run (window cap) is not drawn dead.
const others = computed(() => places.value.filter((p) => !p.checked && !p.disabled));
</script>
