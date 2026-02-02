<template>
  <div style="display: flex; align-items: center; width: 100%">
    <q-select
    borderless hide-bottom-space
      v-model="backgroundType"
      :options="colorModeOptions"
      dense
      :label="t('dashboard.colorMode')"
      class="showLabelOnTop selectedLabel tw:w-full"
      stack-label
      emit-value
      :display-value="
        backgroundType
          ? colorModeOptions.find((it: any) => it.value === backgroundType)
              ?.label
          : 'None'
      "
      data-test="dashboard-config-color-mode"
    ></q-select>

    <div v-if="backgroundType === 'single'">
      <div
        class="color-input-wrapper"
        style="margin-top: 36px; margin-left: 5px"
      >
        <input type="color" v-model="backgroundColor" />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import useDashboardPanelData from "@/composables/useDashboardPanel";
import { computed, defineComponent, inject, onBeforeMount, watch } from "vue";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "BackgroundColorConfig",
  setup() {
    // Destructure props and emit if needed
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );
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

<style lang="scss" scoped>
.color-input-wrapper {
  height: 25px;
  width: 25px;
  overflow: hidden;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  position: relative;
}

.color-input-wrapper input[type="color"] {
  position: absolute;
  height: 4em;
  width: 4em;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  overflow: hidden;
  border: none;
  margin: 0;
  padding: 0;
}
</style>
