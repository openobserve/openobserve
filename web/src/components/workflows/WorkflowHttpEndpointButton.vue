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
  <!-- Wrapper mode: a child tooltip after icon-left anchors to the icon alone -->
  <OTooltip side="bottom" :content="tooltip" :disabled="!tooltip">
    <OButton
      variant="outline"
      :size="size"
      icon-left="webhook"
      :data-test="dataTest"
      @click="emit('click')"
    >
      {{ t("workflow.http.editorButton") }}
      <OTag
        v-if="chip"
        :variant="chip.variant"
        size="sm"
        :label="t(chip.labelKey)"
        :data-test="`${dataTest}-chip`"
      />
    </OButton>
  </OTooltip>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { ButtonSize } from "@/lib/core/Button/OButton.types";
import type { HttpButtonChip } from "@/plugins/workflows/useWorkflowHttpButton";

const props = defineProps<{
  chip: HttpButtonChip | null;
  tooltipKey: I18nKey | null;
  dataTest: string;
  size?: ButtonSize;
}>();

const emit = defineEmits<{ (e: "click"): void }>();

const { t } = useI18nTyped();

const tooltip = computed(() => (props.tooltipKey ? t(props.tooltipKey) : undefined));
</script>
