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
  <div ref="hostRef" class="h-full w-full" data-test="dashboard-custom-chart-sandbox"></div>
</template>

<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref, unref, watch, type Ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { useTheme } from "@/composables/useTheme";
import { getFontSans } from "@/utils/fonts";
import { getColorPalette } from "@/utils/dashboard/colorPalette";
import {
  CUSTOM_CHART_DRILLDOWN_EVENTS,
  createCustomChartSandbox,
  type CustomChartAppearance,
  type CustomChartDrilldown,
  type CustomChartRun,
  type CustomChartSandbox,
} from "@/utils/dashboard/customChartSandbox";

interface HoveredSeriesState {
  panelId: string | number | undefined;
}

const props = defineProps<{
  run: CustomChartRun | null;
}>();

const emit = defineEmits<{
  error: [detail: { message: string; code: string }, run: CustomChartRun | null];
}>();

const { t } = useI18nTyped();
const { isDark } = useTheme();
const hostRef = ref<HTMLElement | null>(null);
const hoveredSeriesState = inject<Ref<HoveredSeriesState> | HoveredSeriesState | null>(
  "hoveredSeriesState",
  null,
);
let sandbox: CustomChartSandbox | null = null;

const appearance = (): CustomChartAppearance => ({
  dark: isDark.value,
  palette: getColorPalette(),
  fontFamily: getFontSans(),
});

const onDrilldown = (drilldown: CustomChartDrilldown) => {
  // Bubbles so the page that owns the drilldown can listen on the document.
  hostRef.value?.dispatchEvent(
    new CustomEvent(CUSTOM_CHART_DRILLDOWN_EVENTS[drilldown.name], {
      detail: drilldown.detail,
      bubbles: true,
    }),
  );
};

const render = () => {
  if (!sandbox) return;
  if (props.run) sandbox.render(props.run, appearance());
  else sandbox.clear();
};

// The parent gets no mouseover over a sandboxed frame, so the frame's own pointer report marks the hover.
const onPointer = () => {
  const state = unref(hoveredSeriesState);
  if (state) state.panelId = props.run?.panelId;
};

onMounted(() => {
  if (!hostRef.value) return;
  sandbox = createCustomChartSandbox(
    hostRef.value,
    {
      onError: (message) => emit("error", { message, code: "" }, props.run),
      onDrilldown,
      onPointer,
    },
    t("dashboard.chartSelection.customChart"),
  );
  render();
});

watch(() => props.run, render);
watch(isDark, () => sandbox?.setAppearance(appearance()));

onUnmounted(() => {
  sandbox?.destroy();
  sandbox = null;
});
</script>
