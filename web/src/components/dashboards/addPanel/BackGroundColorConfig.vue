<template>
  <div class="flex w-full items-center">
    <OSelect
      v-model="backgroundType"
      :options="colorModeOptions"
      :label="t('dashboard.colorMode')"
      class="flex-1"
      data-test="dashboard-config-color-mode"
    />

    <div v-if="backgroundType === 'single'">
      <div
        data-test="dashboard-config-color-input-wrapper"
        class="relative mt-9 ml-1.25 inline-flex h-6.25 w-6.25 items-center overflow-hidden rounded-full"
      >
        <input
          data-test="dashboard-config-color-input"
          type="color"
          v-model="backgroundColor"
          class="absolute top-1/2 left-1/2 m-0 h-[4em] w-[4em] -translate-x-1/2 -translate-y-1/2 overflow-hidden border-0 p-0"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { computed, defineComponent, inject, watch } from "vue";
import { useI18n } from "vue-i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";

export default defineComponent({
  name: "BackgroundColorConfig",
  components: { OSelect },
  setup() {
    // Destructure props and emit if needed
    const dashboardPanelDataPageKey = inject("dashboardPanelDataPageKey", "dashboard");
    const { dashboardPanelData } = useDashboardPanelData(dashboardPanelDataPageKey);
    const { t } = useI18n();

    const colorModeOptions = [
      { label: t("dashboard.none"), value: "" },
      { label: t("dashboard.singleColor"), value: "single" },
    ];

    // Reactive references for background configuration
    const backgroundType = computed({
      get: () => dashboardPanelData.data.config.background?.type ?? "",
      set: (value) => {
        if (!dashboardPanelData.data.config.background) {
          dashboardPanelData.data.config.background = {
            type: value,
            value: { color: "" },
          };
        } else {
          dashboardPanelData.data.config.background.type = value;
        }
      },
    });

    const backgroundColor = computed({
      get: () => dashboardPanelData.data.config.background?.value?.color ?? "",
      set: (value) => {
        if (!dashboardPanelData.data.config.background) {
          dashboardPanelData.data.config.background = {
            type: "single",
            value: { color: value },
          };
        } else {
          dashboardPanelData.data.config.background.value.color = value;
        }
      },
    });

    watch(
      backgroundType,
      (newType) => {
        if (!newType) {
          backgroundColor.value = "";
        } else if (newType === "single" && !backgroundColor.value) {
          backgroundColor.value = "#808080"; // Only set default color when explicitly choosing "single"
        }
      },
      { immediate: false },
    );

    return {
      backgroundType,
      backgroundColor,
      colorModeOptions,
      t,
    };
  },
});
</script>
