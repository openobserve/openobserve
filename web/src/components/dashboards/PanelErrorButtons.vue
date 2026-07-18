<template>
  <div
    v-if="
      error ||
      maxQueryRangeWarning ||
      limitNumberOfSeriesWarningMessage || xAliasInconsistencyWarning ||
      isCachedDataDifferWithCurrentTimeRange ||
      (isPartialData && !isPanelLoading) ||
      (lastTriggeredAt && !viewOnly && !simplifiedPanelView)
    "
    class="flex items-center flex-nowrap"
  >
    <OButton
      v-if="error"
      :key="error"
      variant="ghost-warning"
      size="icon"
      icon-left="warning"
      data-test="panel-error-data"
    >
      <OTooltip side="bottom" align="end" max-width="420px" hoverable>
        <template #content><div style="white-space: pre-wrap">{{ error }}</div></template>
      </OTooltip>
    </OButton>
    <OButton
      v-if="maxQueryRangeWarning"
      variant="ghost-warning"
      size="icon"
      icon-left="warning"
      data-test="panel-max-duration-warning"
    >
      <OTooltip side="bottom" align="end" max-width="420px" hoverable>
        <template #content><div data-test="panel-max-duration-warning-content" style="white-space: pre-wrap">{{ maxQueryRangeWarning }}</div></template>
      </OTooltip>
    </OButton>
    <OButton
      v-if="limitNumberOfSeriesWarningMessage"
      variant="ghost-warning"
      size="icon"
      data-test="panel-limit-number-of-series-warning"
    >
      <template #icon-left
        ><OIcon name="data-info-alert" size="sm"
      /></template>
      <OTooltip side="bottom" align="end" hoverable>
        <template #content><div style="white-space: pre-wrap">{{ limitNumberOfSeriesWarningMessage }}</div></template>
      </OTooltip>
    </OButton>
    <OButton
      v-if="xAliasInconsistencyWarning"
      variant="ghost-warning"
      size="icon"
      icon-left="warning"
      data-test="panel-x-alias-inconsistency-warning"
    >
      <OTooltip side="bottom" align="end" max-width="420px" hoverable>
        <template #content>
          <div style="white-space: pre-wrap">{{ t('dashboard.xAliasInconsistencyWarning') }}</div>
        </template>
      </OTooltip>
    </OButton>
    <OButton
      v-if="isCachedDataDifferWithCurrentTimeRange"
      variant="ghost-warning"
      size="icon"
      data-test="panel-is-cached-data-differ-with-current-time-range-warning"
    >
      <template #icon-left
        ><OIcon name="running-with-errors" size="sm"
      /></template>
      <OTooltip side="bottom" align="end" hoverable :content="t('dashboard.panelErrorButtons.cachedDataDiffers')" />
    </OButton>
    <OButton
      v-if="isPartialData && !isPanelLoading"
      variant="ghost-warning"
      size="icon"
      data-test="panel-partial-data-warning"
    >
      <template #icon-left
        ><OIcon name="clock-loader-20" size="sm"
      /></template>
      <OTooltip side="bottom" align="end" hoverable :content="t('dashboard.panelErrorButtons.partialData')" />
    </OButton>

    <!-- Universal Last Refreshed Clock Icon and Time -->
    <span
      v-if="lastTriggeredAt && !viewOnly && !simplifiedPanelView"
      class="lastRefreshedAt text-[smaller] ml-1.25 whitespace-nowrap overflow-hidden text-ellipsis"
      data-test="panel-last-refreshed-at"
    >
      <span class="lastRefreshedAtIcon text-[smaller] mr-0.5">
        🕑
        <OTooltip side="bottom" align="end">
          <template #content>{{ t('dashboard.panelErrorButtons.lastRefreshed') }}<RelativeTime :timestamp="lastTriggeredAt" /></template>
        </OTooltip>
      </span>
      <RelativeTime
        :timestamp="lastTriggeredAt"
        :fullTimePrefix="t('dashboard.panelErrorButtons.lastRefreshedAt')"
      />
    </span>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import RelativeTime from "@/components/common/RelativeTime.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
export default defineComponent({
  name: "PanelErrorButtons",
  components: { RelativeTime, OButton, OIcon, OTooltip },
  props: {
    error: {
      type: String,
      default: "",
    },
    maxQueryRangeWarning: {
      type: String,
      default: "",
    },
    limitNumberOfSeriesWarningMessage: {
      type: String,
      default: "",
    },
    isCachedDataDifferWithCurrentTimeRange: {
      type: Boolean,
      default: false,
    },
    isPartialData: {
      type: Boolean,
      default: false,
    },
    isPanelLoading: {
      type: Boolean,
      default: false,
    },
    lastTriggeredAt: {
      type: [String, Number, Date, null],
      default: null,
    },
    viewOnly: {
      type: Boolean,
      default: false,
    },
    simplifiedPanelView: {
      type: Boolean,
      default: false,
    },
    xAliasInconsistencyWarning: {
      type: Boolean,
      default: false,
    },
  },
  setup() {
    const { t } = useI18n();
    return {
      t,
    };
  },
});
</script>

<style>
.lastRefreshedAt::after {
  content: "";
}

.lastRefreshedAt::before {
  content: "";
}
</style>
