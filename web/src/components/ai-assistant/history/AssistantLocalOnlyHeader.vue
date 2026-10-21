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
  <div class="flex min-w-0 items-center gap-1" data-test="assistant-local-only">
    <OText
      :id="descriptionId"
      variant="meta"
      as="p"
      :class="['min-w-0 flex-1', near && 'text-status-warning-text']"
      :data-near="near ? '' : undefined"
      data-test="assistant-local-only-line"
    >
      {{ line }}
    </OText>
    <OPopover
      v-model:open="infoOpen"
      side="bottom"
      align="start"
      :aria-label="t('assistant.history.localOnly.info')"
      content-class="flex w-[min(18rem,calc(100vw-1.5rem))] flex-col gap-2 p-3"
    >
      <template #trigger>
        <OButton
          variant="ghost"
          size="xs"
          :icon-left="assistantGlyph.info"
          class="shrink-0 max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-local-info"
        >
          <span class="max-md:sr-only">{{ t("assistant.history.localOnly.info") }}</span>
        </OButton>
      </template>
      <OText variant="meta" as="p" data-test="assistant-local-info-help">
        {{ t("assistant.history.localOnly.help") }}
      </OText>
      <OCheckbox
        :model-value="clearOnSignOut"
        :label="t('assistant.history.clearOnSignOut')"
        data-test="assistant-local-clear-on-signout"
        @update:model-value="(value) => emit('update:clearOnSignOut', value === true)"
      />
      <template v-if="isAdmin">
        <OText variant="meta" as="p" data-test="assistant-local-info-admin">
          {{ t("assistant.history.localOnly.adminHelp") }}
        </OText>
        <OButton
          variant="outline"
          size="sm"
          as="a"
          :href="SETUP_DOCS_URL"
          target="_blank"
          rel="noopener noreferrer"
          :icon-right="assistantGlyph.newTab"
          class="self-start max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-local-info-admin-link"
        >
          {{ t("assistant.history.localOnly.adminLink") }}
        </OButton>
      </template>
    </OPopover>
  </div>
</template>

<script lang="ts">
export interface AssistantLocalOnlyHeaderProps {
  count: number;
  cap: number;
  isAdmin: boolean;
  /** The persistent "Delete my browser chats when I sign out" preference. */
  clearOnSignOut: boolean;
  /** Lets the list describe itself by this line. */
  descriptionId?: string;
}

/** From here the line warns that the oldest unpinned chat goes next; never red. */
export const NEAR_CAP = 95;
</script>

<script setup lang="ts">
import { computed, ref } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { SETUP_DOCS_URL } from "@/components/ai-assistant/gate/AssistantGateState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<AssistantLocalOnlyHeaderProps>(), {
  descriptionId: undefined,
});

const emit = defineEmits<{ "update:clearOnSignOut": [value: boolean] }>();

const { t } = useI18nTyped();
const infoOpen = ref(false);

const near = computed(() => props.count >= NEAR_CAP);
const line = computed(() =>
  near.value
    ? t("assistant.history.prune", { count: props.count, cap: props.cap })
    : t("assistant.history.localOnly.title", { count: props.count, cap: props.cap }),
);
</script>
