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
    <div :class="store.state.theme == 'dark' ? 'theme-dark' : 'theme-light'" class="px-2 pt-1.5 pb-1">
      <div class="metric-legends-title">
        <div class="label">{{ t("search.legendLabel") }}</div>
      </div>
      <div class="border-t my-1 border-dropdown-separator" />
      <div class="legends">
        <div class="grid grid-cols-2 gap-2.5">
          <div
            v-for="(icon, metric) in metricsIconMapping"
            :key="metric"
            :data-test="`metrics-legends-item-${metric}`"
          >
            <OIcon :name="icon" size="md" class="mr-1" />
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
