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
  <ODropdown v-if="items.length > 0 || connectorsShown" side="top" align="start" privacy="mask">
    <template #trigger>
      <AssistantIconButton
        :label="t('assistant.composer.plus')"
        :icon="assistantGlyph.addContext"
        :size="BAR_CONTROL_SIZE"
        :disabled="disabled"
        data-test="assistant-composer-plus"
      />
    </template>
    <template v-for="item in items" :key="item.id">
      <ODropdownItem :icon-left="item.icon" :data-test="item.test" @select="choose(item.id)">
        {{ item.label }}
      </ODropdownItem>
      <AssistantConnectorsMenu v-if="item.id === 'attach' && connectorsShown" />
    </template>
    <AssistantConnectorsMenu v-if="connectorsShown && !actions.includes('attach')" />
  </ODropdown>
</template>

<script lang="ts">
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";

/** `connectors` opens its own submenu; the others emit `select`. */
export type ComposerPlusAction = "attach" | "connectors";

export interface AssistantComposerPlusMenuProps {
  /** What the menu offers, always listed as Photo, Connectors (D3). */
  actions: readonly ComposerPlusAction[];
  disabled?: boolean;
}

export interface AssistantComposerPlusMenuEmits {
  (e: "select", action: Exclude<ComposerPlusAction, "connectors">): void;
}

// The image id is the one its old bottom-row button had.
const ITEMS = [
  { id: "attach", icon: assistantGlyph.chipImage, test: "assistant-attach-image" },
] as const satisfies readonly {
  id: Exclude<ComposerPlusAction, "connectors">;
  icon: string;
  test: string;
}[];
</script>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { useLicenseLock } from "@/composables/useFeatureLock";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { useI18nTyped } from "@/types/i18n";
import { buildFeatureGateContext, checkFeatureAccess } from "@/utils/enterpriseFeatures";

import { BAR_CONTROL_SIZE } from "./AssistantComposerBottomRow.vue";
import AssistantConnectorsMenu from "./AssistantConnectorsMenu.vue";

const props = withDefaults(defineProps<AssistantComposerPlusMenuProps>(), { disabled: false });

const emit = defineEmits<AssistantComposerPlusMenuEmits>();

const { t } = useI18nTyped();
const vuex = useStore();
const { locked: toolsetsLocked } = useLicenseLock("ai_toolsets");
const { locked: assistantLocked } = useLicenseLock("ai_assistant");

// The same gates as Settings › Toolsets: the edition offers it and neither license locks the list.
const connectorsShown = computed(
  () =>
    props.actions.includes("connectors") &&
    !toolsetsLocked.value &&
    !assistantLocked.value &&
    checkFeatureAccess("aiToolsets", buildFeatureGateContext(vuex?.state.zoConfig)).allowed,
);

const items = computed(() => {
  const label = { attach: t("assistant.composer.attachImage") };
  return ITEMS.filter((item) => props.actions.includes(item.id)).map((item) => ({
    ...item,
    label: label[item.id],
  }));
});

function choose(action: Exclude<ComposerPlusAction, "connectors">): void {
  emit("select", action);
}
</script>
