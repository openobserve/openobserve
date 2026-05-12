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
    class="row items-center no-wrap"
  >
    <OButton
      v-if="error"
      :key="error"
      variant="ghost-warning"
      size="icon"
      data-test="panel-error-data"
    >
      <template #icon-left><q-icon :name="outlinedWarning" /></template>
      <q-tooltip anchor="bottom right" self="top right" max-width="220px">
        <div style="white-space: pre-wrap">
          {{ error }}
        </div>
      </q-tooltip>
    </OButton>
    <OButton
      v-if="maxQueryRangeWarning"
      variant="ghost-warning"
      size="icon"
      data-test="panel-max-duration-warning"
    >
      <template #icon-left><q-icon :name="outlinedWarning" /></template>
      <q-tooltip anchor="bottom right" self="top right" max-width="220px">
        <div style="white-space: pre-wrap">
          {{ maxQueryRangeWarning }}
        </div>
      </q-tooltip>
    </OButton>
    <OButton
      v-if="limitNumberOfSeriesWarningMessage"
      variant="ghost-warning"
      size="icon"
      data-test="panel-limit-number-of-series-warning"
    >
      <template #icon-left
        ><q-icon :name="symOutlinedDataInfoAlert"
      /></template>
      <q-tooltip anchor="bottom right" self="top right">
        <div style="white-space: pre-wrap">
          {{ limitNumberOfSeriesWarningMessage }}
        </div>
      </q-tooltip>
    </OButton>
    <OButton
      v-if="xAliasInconsistencyWarning"
      :icon="outlinedWarning"
      flat
      size="xs"
      padding="2px"
      data-test="panel-x-alias-inconsistency-warning"
      class="warning"
    >
      <q-tooltip anchor="bottom right" self="top right" max-width="260px">
        <div style="white-space: pre-wrap">
          {{ t('dashboard.xAliasInconsistencyWarning') }}
        </div>
      </q-tooltip>
    </OButton>
    <OButton
      v-if="isCachedDataDifferWithCurrentTimeRange"
      variant="ghost-warning"
      size="icon"
      data-test="panel-is-cached-data-differ-with-current-time-range-warning"
    >
      <template #icon-left
        ><q-icon :name="outlinedRunningWithErrors"
      /></template>
      <q-tooltip anchor="bottom right" self="top right">
        <div style="white-space: pre-wrap">
          The data shown is cached and is different from the selected time
          range.
        </div>
      </q-tooltip>
    </OButton>
    <OButton
      v-if="isPartialData && !isPanelLoading"
      variant="ghost-warning"
      size="icon"
      data-test="panel-partial-data-warning"
    >
      <template #icon-left
        ><q-icon :name="symOutlinedClockLoader20"
      /></template>
      <q-tooltip anchor="bottom right" self="top right">
        <div style="white-space: pre-wrap">
          The data shown is incomplete because the loading was interrupted.
          Refresh to load complete data.
        </div>
      </q-tooltip>
    </OButton>

    <!-- Universal Last Refreshed Clock Icon and Time -->
    <span
      v-if="lastTriggeredAt && !viewOnly && !simplifiedPanelView"
      class="lastRefreshedAt"
    >
      <span class="lastRefreshedAtIcon">
        🕑
        <q-tooltip anchor="bottom right" self="top right">
          Last Refreshed: <RelativeTime :timestamp="lastTriggeredAt" />
        </q-tooltip>
      </span>
      <RelativeTime
        :timestamp="lastTriggeredAt"
        fullTimePrefix="Last Refreshed At: "
      />
    </span>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import RelativeTime from "@/components/common/RelativeTime.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import {
  outlinedWarning,
  outlinedRunningWithErrors,
} from "@quasar/extras/material-icons-outlined";
import {
  symOutlinedClockLoader20,
  symOutlinedDataInfoAlert,
} from "@quasar/extras/material-symbols-outlined";
export default defineComponent({
  name: "PanelErrorButtons",
  components: { RelativeTime, OButton },
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
      outlinedWarning,
      outlinedRunningWithErrors,
      symOutlinedClockLoader20,
      symOutlinedDataInfoAlert,
    };
  },
});
</script>

<style scoped>
.warning {
  color: var(--q-warning);
}
.lastRefreshedAt {
  font-size: smaller;
  margin-left: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &::after {
    content: "";
  }

  &::before {
    content: "";
  }

  & .lastRefreshedAtIcon {
    font-size: smaller;
    margin-right: 2px;
  }
}
</style>
