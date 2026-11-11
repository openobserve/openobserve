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
      v-for="item in places"
      :key="item.id"
      role="menuitemradio"
      :aria-checked="item.checked"
      :icon-left="PLACE_ICONS[item.id]"
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
    <ODropdownItem
      v-if="freshFull"
      :icon-left="assistantGlyph.newChat"
      data-test="assistant-shell-place-full-new"
      @select="freshFull.run"
    >
      {{ freshFull.label }}
    </ODropdownItem>
  </template>
  <ODropdown v-else-if="places.length" align="end">
    <template #trigger>
      <OButton
        v-if="labelled"
        variant="ghost"
        size="xs"
        :icon-left="assistantGlyph.openFull"
        :icon-right="mdUp ? assistantGlyph.expand : undefined"
        class="max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11"
        :aria-label="t('assistant.shell.openAs')"
        data-test="assistant-open-as-button"
      >
        <!-- A phone keeps the header's room for the chat title: icon only, its name still read aloud -->
        <span class="max-md:sr-only">{{ t("assistant.shell.openAs") }}</span>
      </OButton>
      <AssistantIconButton
        v-else
        :label="t('assistant.shell.openAs')"
        :icon="assistantGlyph.openFull"
        data-test="assistant-open-as-button"
      />
    </template>
    <ODropdownGroup :label="t('assistant.shell.openAs')" data-test="assistant-open-as">
      <ODropdownItem
        v-for="item in places"
        :key="item.id"
        role="menuitemradio"
        :aria-checked="item.checked"
        :icon-left="PLACE_ICONS[item.id]"
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
    </ODropdownGroup>
    <template v-if="freshFull">
      <ODropdownSeparator />
      <ODropdownItem
        :icon-left="assistantGlyph.newChat"
        data-test="assistant-shell-place-full-new"
        @select="freshFull.run"
      >
        {{ freshFull.label }}
      </ODropdownItem>
    </template>
  </ODropdown>
</template>

<script lang="ts">
import type { DockHostId, Sid } from "@/composables/assistant";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import type { IconName } from "@/lib/core/Icon/OIcon.types";

import type { PlaceId } from "./useAssistantPlaces";

export { placementMode } from "./useAssistantPlaces";

export interface AssistantOpenAsMenuProps {
  placement: "sidebar" | "full" | "docked" | "window";
  /** The chat this container shows; it moves unchanged. */
  sid: Sid | null;
  /** The sidebar drawn as the phone or tablet sheet: only the moves a sheet can do. */
  sheet?: boolean;
  /** Only the items, for a host menu whose own "Open as" entry owns the trigger. */
  bare?: boolean;
  /** The dock this container is, for the modal check. */
  dockHost?: DockHostId;
  /** The trigger reads "Open as" instead of an icon, where the bar has room for it. */
  labelled?: boolean;
}

const PLACE_ICONS: Record<PlaceId, IconName> = {
  sidebar: assistantGlyph.layout,
  full: assistantGlyph.openFull,
  window: assistantGlyph.floatingWindow,
  dock: assistantGlyph.helper,
};
</script>

<script setup lang="ts">
import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import { useI18nTyped } from "@/types/i18n";

import { useAssistantPlaces } from "./useAssistantPlaces";

const props = withDefaults(defineProps<AssistantOpenAsMenuProps>(), {
  sheet: false,
  bare: false,
  dockHost: undefined,
  labelled: false,
});

const { t } = useI18nTyped();
const { mdUp } = useBreakpoint();
const { places, freshFull } = useAssistantPlaces(() => ({
  placement: props.placement,
  sid: props.sid,
  sheet: props.sheet,
  dockHost: props.dockHost,
}));
</script>
