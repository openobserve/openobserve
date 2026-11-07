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

export { placementMode } from "./useAssistantPlaces";

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
</script>

<script setup lang="ts">
import type { FunctionalComponent } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { useI18nTyped } from "@/types/i18n";

import { useAssistantPlaces } from "./useAssistantPlaces";

const props = withDefaults(defineProps<AssistantLayoutMenuProps>(), {
  sheet: false,
  bare: false,
  dockHost: undefined,
});

const BareMenu: FunctionalComponent = (_props, { slots }) => slots.default?.();

const { t } = useI18nTyped();
const { places } = useAssistantPlaces(() => ({
  placement: props.placement,
  sid: props.sid,
  sheet: props.sheet,
  dockHost: props.dockHost,
}));
</script>
