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
  <OButton
    v-if="show && visible"
    variant="ghost-primary"
    size="icon-xs"
    :aria-label="askLabel"
    :data-test="`overview-ask-ai-${kind}-${itemKey}`"
    @click.stop="emit('ask')"
  >
    <template #icon-left>
      <img :src="aiIconSrc" class="h-4 w-4 shrink-0" alt="" />
    </template>
    <OTooltip :content="label ? askLabel : t('overview.askAi.hint')" />
  </OButton>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useAiIcon } from "@/composables/useAiIcon";
import { useI18nTyped } from "@/types/i18n";
import { computed } from "vue";
import { useOverviewAskAi } from "./useOverviewAskAi";

const props = withDefaults(
  defineProps<{ kind: string; itemKey: string; label?: string; show?: boolean }>(),
  { show: true },
);

const emit = defineEmits<{ ask: [] }>();

const { t } = useI18nTyped();
const { aiIconSrc } = useAiIcon();
const { visible } = useOverviewAskAi();
const askLabel = computed(() =>
  props.label ? t("overview.askAi.labelFor", { item: props.label }) : t("overview.askAi.label"),
);
</script>
