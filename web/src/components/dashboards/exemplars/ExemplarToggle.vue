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
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const props = withDefaults(
  defineProps<{
    on: boolean;
    loading?: boolean;
    count?: number;
    dataTest: string;
    loadingDataTest?: string;
    swapsVariant?: string;
  }>(),
  { loading: false, count: 0, loadingDataTest: "dashboard-panel-exemplars-loading" },
);

const emit = defineEmits<{ (e: "toggle"): void }>();

const { t } = useI18nTyped();

const tooltip = computed(() => {
  if (props.swapsVariant) {
    return props.on
      ? t("metrics.explorer.card.exemplarsHideHeatmap", { count: props.count })
      : t("metrics.explorer.card.exemplarsShowHeatmap");
  }
  return props.on
    ? t("dashboard.exemplars.hide", { count: props.count })
    : t("dashboard.exemplars.show");
});
</script>

<template>
  <span class="inline-flex items-center gap-0.5">
    <OSpinner v-if="on && loading" size="xs" :data-test="loadingDataTest" />
    <OButton
      :variant="on ? 'ghost-primary' : 'ghost'"
      size="icon"
      icon-left="account-tree"
      :aria-pressed="String(on)"
      :aria-label="tooltip"
      :data-test="dataTest"
      :data-swaps-variant="swapsVariant || undefined"
      @click="emit('toggle')"
    >
      <OTooltip :content="tooltip" side="bottom" align="end" />
    </OButton>
  </span>
</template>
