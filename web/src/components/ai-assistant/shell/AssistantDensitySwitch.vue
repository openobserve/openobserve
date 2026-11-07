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
  <OToggleGroup
    v-if="densities.length > 1"
    :model-value="current"
    :aria-label="t('assistant.shell.density.label')"
    data-test="assistant-density-switch"
    @update:model-value="pick"
  >
    <OToggleGroupItem
      v-for="item in densities"
      :key="item.id"
      :value="item.id"
      size="xs"
      :icon-left="item.icon"
      :disabled="item.disabled"
      :tooltip="compact ? item.label : undefined"
      :data-test="`assistant-density-${item.density}`"
    >
      <span :class="compact ? 'sr-only' : undefined">{{ item.label }}</span>
    </OToggleGroupItem>
  </OToggleGroup>
</template>

<script lang="ts">
import type { DockHostId, Sid } from "@/composables/assistant";

export interface AssistantDensitySwitchProps {
  placement: "sidebar" | "full" | "window";
  sid: Sid | null;
  dockHost?: DockHostId;
  /** Icons only, for the side panel's narrow bar. */
  compact?: boolean;
}

/** The density each placement is called in the thread header. */
export const DENSITY_OF = { full: "full", sidebar: "panel", window: "float" } as const;
</script>

<script setup lang="ts">
import { computed } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { useI18nTyped } from "@/types/i18n";

import { useAssistantPlaces, type PlaceId } from "./useAssistantPlaces";

const props = withDefaults(defineProps<AssistantDensitySwitchProps>(), {
  dockHost: undefined,
  compact: false,
});

const ORDER: readonly PlaceId[] = ["full", "sidebar", "window"];

const ICONS: Record<keyof typeof DENSITY_OF, string> = {
  full: assistantGlyph.openFull,
  sidebar: assistantGlyph.layout,
  window: assistantGlyph.floatingWindow,
};

const { t } = useI18nTyped();
const { places } = useAssistantPlaces(() => ({
  placement: props.placement,
  sid: props.sid,
  sheet: false,
  dockHost: props.dockHost,
}));

const densities = computed(() =>
  ORDER.flatMap((id) => {
    const place = places.value.find((candidate) => candidate.id === id);
    if (!place || id === "dock") return [];
    const density = DENSITY_OF[id];
    return [
      {
        ...place,
        density,
        icon: ICONS[id],
        label: t(`assistant.shell.density.${density}`),
      },
    ];
  }),
);
const current = computed(() => props.placement);

function pick(value: unknown): void {
  const place = densities.value.find((item) => item.id === value);
  if (place && !place.checked && !place.disabled) place.run();
}
</script>
