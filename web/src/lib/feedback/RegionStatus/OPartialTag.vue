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

<script setup lang="ts">
import { computed } from "vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped } from "@/types/i18n";
import { isPartial, type Partitions } from "./regionText";

const props = withDefaults(defineProps<{ partitions: Partitions; dataTest?: string }>(), {
  dataTest: "partial-result",
});

const { t } = useI18nTyped();

const named = computed(() => ({ done: props.partitions.done, total: props.partitions.total }));
</script>

<template>
  <!-- Focusable so keyboard users can open the tooltip that says why the result is partial. -->
  <span
    v-if="isPartial(partitions)"
    tabindex="0"
    class="focus-visible:outline-focus-ring-accent inline-flex rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid"
    :data-test="dataTest"
  >
    <!-- First child, so the tooltip binds to this focusable wrapper, not to an earlier sibling. -->
    <OTooltip :content="t('regionStatus.partialTooltip', named)" />
    <OTag variant="warning-soft" icon="warning-amber" size="sm">
      {{ t("regionStatus.partitions", named) }}
    </OTag>
  </span>
</template>
