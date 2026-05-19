<template>
  <OButton
    data-cy="metric-legends-button"
    variant="ghost"
    size="sm-action"
    class="metric-legends-button"
  >
    <OIcon name="category" size="sm" class="q-mr-sm" />
    <span>{{ t("search.legendLabel") }}</span>

    <q-menu :class="store.state.theme == 'dark' ? 'theme-dark' : 'theme-light'">
      <OCard>
        <OCardSection role="header" class="metric-legends-title">
          <div class="label">{{ t("search.legendLabel") }}</div>
        </OCardSection>
        <OSeparator />
        <OCardSection class="tw:pt-0 legends">
          <div class="legend-grid">
            <div
              class="legend-item"
              v-for="(icon, metric) in metricsIconMapping"
              :key="metric"
            >
              <OIcon :name="icon" size="sm" class="q-mr-sm" />
              <span>{{ metric }}</span>
            </div>
          </div>
        </OCardSection>
      </OCard>
    </q-menu>
  </OButton>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OButton from '@/lib/core/Button/OButton.vue';
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';

export default defineComponent({
  name: "MetricLegends",
  components: { OSeparator, OButton, OCard, OCardSection,
    OIcon,
},
  setup() {
    const { t } = useI18n();
    const store = useStore();

    const metricsIconMapping: Record<string, string> = {
      Summary: "description",
      Gauge: "speed",
      Histogram: "bar_chart",
      Counter: "pin",
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
.legend-item {
  display: flex;
  align-items: center;
  font-size: 14px;
  padding: 6px 0;
}
.q-btn:before {
  border: 0px solid #d5d5d5;
}
.metric-legends-button {
  cursor: pointer;
  text-transform: capitalize;
  padding: 5px 5px;
  height: 30px;
  font-weight: bold;
  border: 1px solid rgba(89, 96, 178, 0.3);
}
.theme-dark .legend-item {
  color: white;
}
.theme-light .legend-item {
  color: black;
}
</style>
