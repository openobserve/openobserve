<template>
  <ODropdown side="bottom" align="start">
    <template #trigger>
      <OButton
        data-cy="metric-legends-button"
        variant="outline"
        size="sm-toolbar"
        class="metric-legends-button"
      >
        <OIcon name="category" size="sm" />
        <span>{{ t("search.legendLabel") }}</span>
      </OButton>
    </template>
    <div :class="store.state.theme == 'dark' ? 'theme-dark' : 'theme-light'" class="tw:px-2 tw:pt-1.5 tw:pb-1">
      <div class="metric-legends-title">
        <div class="label">{{ t("search.legendLabel") }}</div>
      </div>
      <div class="tw:border-t tw:my-1 tw:border-dropdown-separator" />
      <div class="legends">
        <div class="legend-grid">
          <div
            v-for="(icon, metric) in metricsIconMapping"
            :key="metric"
            :data-test="`metrics-legends-item-${metric}`"
          >
            <OIcon :name="icon" size="md" class="tw:mr-1" />
            <span>{{ metric }}</span>
          </div>
        </div>
      </div>
    </div>
  </ODropdown>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OButton from '@/lib/core/Button/OButton.vue';
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";

export default defineComponent({
  name: "MetricLegends",
  components: { OButton, OIcon, ODropdown },
  setup() {
    const { t } = useI18n();
    const store = useStore();

    const metricsIconMapping: Record<string, string> = {
      Summary: "description",
      Gauge: "speed",
      Histogram: "bar-chart",
      Counter: "tag",
    };

    return {
      t,
      store,
      metricsIconMapping,
    };
  },
});
</script>

<style lang="scss" scoped>
.legend-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr); /* Two columns */
  gap: 10px; /* Space between items */
}

.q-btn:before {
  border: 0px solid #d5d5d5;
}
</style>
